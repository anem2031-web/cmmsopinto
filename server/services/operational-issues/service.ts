import { sql } from "drizzle-orm";
import { allocateOperationalFifo } from "../../../shared/operational-dispatch";
import type { WarehouseLotSelection } from "../../../shared/warehouse-lot-selection";
import { replacementPhysicalToOriginal } from "../../supplier-return-followup/fulfillment";
import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { canCreateOperationalIssue, canProcessOperationalIssue, canReadOperationalIssue, operationalNetCost, type OperationalActor, type OperationalOrder, type OperationalLine, type OperationalDelivery, type OperationalStock } from "../../../shared/operational-issues";
import { executionRows as rows } from "./issue-reference";
import { dispatchContext } from "../../../shared/operational-dispatch";
import { addOperationalPurchaseDraft, loadOperationalStock, operationalPurchaseLinks, operationalPurchaseReady, type OperationalPurchasePorts } from "./stock-procurement";
import { applyOperationalReplacementStock, assertOperationalReplacementIdentity, loadOperationalReplacements, replacementStockLines } from "./replacement";

export interface OperationalPorts {
  database(): Promise<any>;
  issue(tx: any, input: any): Promise<any>;
  resolveLot(input: { warehouseId: number; identifier: string }): Promise<any>;
  returnDelivery(tx: any, input: any): Promise<any>;
  purchaseDraft?: OperationalPurchasePorts;
}
function deny(message = "ليس لديك صلاحية لهذا الإجراء"): never { throw new TRPCError({ code: "FORBIDDEN", message }); }
const fingerprint = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export class OperationalIssueService {
  constructor(private ports: OperationalPorts) {}
  private actor(actor: OperationalActor, type: "create" | "warehouse" | "read") {
    if (actor.isActive !== 1 || !(type === "create" ? canCreateOperationalIssue(actor.role) : type === "warehouse" ? canProcessOperationalIssue(actor.role) : canReadOperationalIssue(actor.role))) deny();
  }
  private async order(tx: any, actor: OperationalActor, id: number, lock = false): Promise<OperationalOrder> {
    this.actor(actor, "read");
    const [row] = await rows(tx, sql`SELECT o.*,u.name AS creatorName,c.name AS collectorName,s.name AS siteName,x.name AS sectionName
      FROM operational_issue_orders o LEFT JOIN users u ON u.id=o.createdById LEFT JOIN users c ON c.id=o.collectorId
      LEFT JOIN sites s ON s.id=o.siteId LEFT JOIN sections x ON x.id=o.sectionId WHERE o.id=${id} ${lock ? sql`FOR UPDATE` : sql``}`);
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "أمر الصرف غير موجود" });
    if (!["warehouse", "owner", "admin", "observer"].includes(actor.role) && Number(row.createdById) !== actor.id) deny();
    return row;
  }
  async list(actor: OperationalActor) {
    this.actor(actor, "read"); const db = await this.ports.database();
    return await rows(db, sql`SELECT o.*,u.name AS creatorName,c.name AS collectorName,s.name AS siteName,x.name AS sectionName
      FROM operational_issue_orders o LEFT JOIN users u ON u.id=o.createdById LEFT JOIN users c ON c.id=o.collectorId
      LEFT JOIN sites s ON s.id=o.siteId LEFT JOIN sections x ON x.id=o.sectionId
      WHERE ${["warehouse", "owner", "admin", "observer"].includes(actor.role) ? sql`1=1` : sql`o.createdById=${actor.id}`} ORDER BY o.id DESC LIMIT 500`) as OperationalOrder[];
  }
  async detail(actor: OperationalActor, id: number) {
    this.actor(actor, "read");
    const db = await this.ports.database(); const order = await this.order(db, actor, id);
    const items = await rows(db, sql`SELECT i.*,COALESCE((SELECT SUM(d.quantity) FROM operational_issue_deliveries d WHERE d.orderItemId=i.id),0) AS issuedQuantity FROM operational_issue_items i WHERE i.orderId=${id} ORDER BY i.id`) as OperationalLine[];
    const replacements = await loadOperationalReplacements(db, items);
    for (const line of items) if (replacements.has(Number(line.id))) line.issuedQuantity = replacements.get(Number(line.id))!.issued;
    const deliveries = await rows(db, sql`SELECT x.*,d.deliveryNumber,l.lotCode,COALESCE((SELECT SUM(r.returnedQuantity) FROM warehouse_returns r WHERE r.sourceDeliveryDocumentId=x.deliveryDocumentId),0) AS returnedQuantity
      FROM operational_issue_deliveries x INNER JOIN operational_issue_items i ON i.id=x.orderItemId
      INNER JOIN delivery_documents d ON d.id=x.deliveryDocumentId LEFT JOIN inventory_lots l ON l.id=d.lotId WHERE i.orderId=${id} ORDER BY x.id`) as OperationalDelivery[];
    const prepared = items.some(i => i.dispatchContext != null);
    const [batch] = prepared ? await rows(db, sql`SELECT inputJson FROM operational_issue_batches WHERE orderId=${id}`) : [];
    const dispatch: Array<{ itemId: number; actualCollectorId: number; actualCollectorName: string; notes: string }> = batch ? (typeof batch.inputJson === "string" ? JSON.parse(batch.inputJson) : batch.inputJson) : [];
    return { order, items, deliveries, cost: operationalNetCost(deliveries), dispatch };
  }
  async availability(actor: OperationalActor, id: number) {
    this.actor(actor, "read");
    if (!canProcessOperationalIssue(actor.role) && actor.role !== "observer") deny();
    const db = await this.ports.database(); await this.order(db, actor, id);
    const lines = await rows(db, sql`SELECT * FROM operational_issue_items WHERE orderId=${id} ORDER BY id`) as OperationalLine[];
    const context = dispatchContext(lines[0]?.dispatchContext);
    const replacements = await loadOperationalReplacements(db, lines);
    const ordinaryStock = await loadOperationalStock(db, lines, false, context?.warehouseId);
    const substituteLines = replacementStockLines(replacements);
    const substituteStock: OperationalStock[] = [];
    for (let offset = 0; offset < substituteLines.length; offset += 500)
      substituteStock.push(...await loadOperationalStock(db, substituteLines.slice(offset, offset + 500), false, context?.warehouseId));
    const items = applyOperationalReplacementStock(ordinaryStock, substituteStock, replacements);
    const procurementReady = await operationalPurchaseReady(db);
    const links = procurementReady ? await operationalPurchaseLinks(db, id, lines) : [];
    for (const item of items) item.purchase = links.find(link => link.orderItemId === item.itemId) || null;
    return { items, procurementReady };
  }
  async addToPurchaseDraft(actor: OperationalActor, orderId: number, itemId: number) {
    this.actor(actor, "warehouse");
    const ports = this.ports.purchaseDraft;
    if (!ports) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "ربط الشراء غير متاح حاليًا" });
    const db = await this.ports.database();
    return db.transaction(async (tx: any) => {
      const order = await this.order(tx, actor, orderId, true);
      return addOperationalPurchaseDraft(tx, ports, actor, order, itemId);
    });
  }
  private async stockUnit(tx: any, catalogItemId: number, catalogUnit: string): Promise<string> {
    const units = await rows(tx, sql`SELECT DISTINCT COALESCE(NULLIF(i.issueUnit,''),i.unit) AS unit FROM inventory i INNER JOIN warehouses w ON w.id=i.warehouseId WHERE i.linkedItemId=${catalogItemId} AND i.quantity>0 AND w.isActive=1`);
    const names = Array.from(new Set<string>(units.map(row => String(row.unit || "").trim()).filter(Boolean)));
    if (names.length > 1) throw new TRPCError({ code: "CONFLICT", message: "للصنف أرصدة بوحدات صرف مختلفة؛ يلزم توحيد وحدته قبل إنشاء أمر الصرف" });
    return names[0] || catalogUnit.trim();
  }
  async itemUnits(actor: OperationalActor, catalogItemIds: number[]): Promise<Array<{ catalogItemId: number; unit: string }>> {
    this.actor(actor, "read"); const tx = await this.ports.database(); const result = [];
    for (const id of catalogItemIds) {
      const [item] = await rows(tx, sql`SELECT id,nameAr,nameEn,unit FROM catalog_items WHERE id=${id} AND isActive=1`);
      if (!item?.unit) throw new TRPCError({ code: "BAD_REQUEST", message: "الصنف أو وحدته غير صالحين" });
      result.push({ catalogItemId: id, unit: await this.stockUnit(tx, id, item.unit) });
    }
    return result;
  }
  async create(actor: OperationalActor, input: { siteId: number; sectionId: number; collectorId: number; reason: string; operationKey: string; items: Array<{ catalogItemId: number; quantity: number; unit?: string }> }) {
    if (actor.role === "warehouse") deny("استخدم إنشاء الصرف من المخزون");
    this.actor(actor, "create"); const db = await this.ports.database();
    if (!input.items.length || input.items.length > 20 || new Set(input.items.map(i => i.catalogItemId)).size !== input.items.length) throw new TRPCError({ code: "BAD_REQUEST", message: "أضف من 1 إلى 20 صنفًا دون تكرار" });
    return db.transaction(async (tx: any) => {
      await rows(tx, sql`SELECT id FROM users WHERE id=${actor.id} FOR UPDATE`);
      const requestFingerprint = fingerprint({ ...input, operationKey: undefined });
      const [existing] = await rows(tx, sql`SELECT id,orderNumber,requestFingerprint FROM operational_issue_orders WHERE operationKey=${input.operationKey} AND createdById=${actor.id}`);
      if (existing) {
        if (existing.requestFingerprint !== requestFingerprint) throw new TRPCError({ code: "CONFLICT", message: "معرف العملية مستخدم لأمر مختلف" });
        return { id: existing.id, orderNumber: existing.orderNumber };
      }
      const [section] = await rows(tx, sql`SELECT id FROM sections WHERE id=${input.sectionId} AND siteId=${input.siteId}`);
      const [collector] = await rows(tx, sql`SELECT id FROM users WHERE id=${input.collectorId} AND role='technician' AND isActive=1`);
      if (!section || !collector) throw new TRPCError({ code: "BAD_REQUEST", message: "تحقق من القسم والموقع والفني النشط" });
      const catalog: any[] = [];
      for (const item of input.items) {
        const [row] = await rows(tx, sql`SELECT id,nameAr,nameEn,unit FROM catalog_items WHERE id=${item.catalogItemId} AND isActive=1`);
        if (!row?.unit || !(item.quantity >= 1) || !Number.isInteger(item.quantity)) throw new TRPCError({ code: "BAD_REQUEST", message: "الصنف أو وحدته أو الكمية غير صالحة" });
        const unit = await this.stockUnit(tx, item.catalogItemId, row.unit);
        if (item.unit !== undefined && item.unit.trim() !== unit) throw new TRPCError({ code: "CONFLICT", message: "تغيرت وحدة الصرف؛ حدّث بيانات الصنف قبل الحفظ" });
        catalog.push({ ...row, unit, quantity: item.quantity });
      }
      const inserted = await tx.execute(sql`INSERT INTO operational_issue_orders (createdById,collectorId,siteId,sectionId,reason,operationKey,requestFingerprint,status) VALUES (${actor.id},${input.collectorId},${input.siteId},${input.sectionId},${input.reason},${input.operationKey},${requestFingerprint},'pending')`);
      const id = Number(inserted[0].insertId); if (!id) throw new Error("تعذر إنشاء أمر الصرف");
      const orderNumber = `OPR-${new Date().getFullYear()}-${String(id).padStart(6, "0")}`;
      await tx.execute(sql`UPDATE operational_issue_orders SET orderNumber=${orderNumber} WHERE id=${id}`);
      for (const item of catalog) await tx.execute(sql`INSERT INTO operational_issue_items (orderId,catalogItemId,itemName,unit,quantity) VALUES (${id},${Number(item.id)},${item.nameAr || item.nameEn},${item.unit},${item.quantity})`);
      await this.audit(tx, actor.id, id, "operational_issue_created");
      return { id, orderNumber };
    });
  }
  async approve(actor: OperationalActor, id: number, revision: number) {
    this.actor(actor, "warehouse");
    const db = await this.ports.database();
    return db.transaction(async (tx: any) => {
      const order = await this.order(tx, actor, id, true);
      if (order.status !== "pending" || Number(order.revision) !== revision) throw new TRPCError({ code: "CONFLICT", message: "تغير أمر الصرف؛ حدّث الصفحة" });
      await tx.execute(sql`UPDATE operational_issue_orders SET status='approved',approvedById=${actor.id},revision=revision+1 WHERE id=${id}`);
      await this.audit(tx, actor.id, id, "operational_issue_approved"); return { success: true };
    });
  }
  private async issueSelected(
    actor: OperationalActor,
    input: {
      orderId: number;
      itemId: number;
      warehouseId: number;
      quantity: number;
      operationKey: string;
      selection: WarehouseLotSelection;
    },
  ) {
    const db = await this.ports.database();
    return db.transaction(async (tx: any) => {
      const [fresh] = await rows(
        tx,
        sql`SELECT id,role,isActive FROM users WHERE id=${actor.id} FOR UPDATE`,
      );
      if (
        !fresh ||
        Number(fresh.isActive) !== 1 ||
        fresh.role !== actor.role ||
        !canProcessOperationalIssue(fresh.role)
      )
        deny();
      const order = await this.order(tx, actor, input.orderId, true);
      const saved = await rows(
        tx,
        sql`SELECT userId,newValues FROM audit_logs WHERE entityType='operational_issue' AND entityId=${input.orderId} AND action='operational_issue_full_line' ORDER BY id`,
      );
      const requestFingerprint = fingerprint({
        ...input,
        operationKey: undefined,
      });
      for (const row of saved) {
        const data =
          typeof row.newValues === "string"
            ? JSON.parse(row.newValues)
            : row.newValues;
        if (data?.operationKey === input.operationKey) {
          if (
            Number(row.userId) !== actor.id ||
            data.fingerprint !== requestFingerprint
          )
            throw new TRPCError({
              code: "CONFLICT",
              message: "معرف الصرف مستخدم لعملية مختلفة",
            });
          return data.result;
        }
      }
      const [line] = (await rows(
        tx,
        sql`SELECT i.*,COALESCE((SELECT SUM(d.quantity) FROM operational_issue_deliveries d WHERE d.orderItemId=i.id),0) AS issuedQuantity FROM operational_issue_items i WHERE i.id=${input.itemId} AND i.orderId=${input.orderId} FOR UPDATE`,
      )) as OperationalLine[];
      if (!line || line.dispatchContext != null || order.status !== "approved")
        throw new TRPCError({
          code: "CONFLICT",
          message: "يلزم صرف بند قديم معتمد أو استخدام تأكيد الطلب المجمع",
        });
      const replacements = await loadOperationalReplacements(tx, [line]);
      const required =
        Number(line.quantity) -
        (replacements.get(Number(line.id))?.issued ??
          Number(line.issuedQuantity));
      if (required <= 0 || input.quantity !== required)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "يلزم صرف كامل المتبقي دون صرف جزئي",
        });
      const physical = replacementStockLines(replacements);
      const stocks = await loadOperationalStock(
        tx,
        [line, ...physical],
        true,
        input.warehouseId,
      );
      const [stock] = applyOperationalReplacementStock(
        stocks.filter((s) => s.itemId > 0),
        stocks.filter((s) => s.itemId < 0),
        replacements,
      );
      const allocations = allocateOperationalFifo(
        stock,
        required,
        input.selection,
      );
      const documents = [];
      for (let index = 0; index < allocations.length; index++) {
        const lot = allocations[index];
        documents.push(
          await this.ports.issue(tx, {
            operationalIssueItemId: input.itemId,
            operationalOperationKey: fingerprint([input.operationKey, index]),
            operationalRequestFingerprint: requestFingerprint,
            inventoryId: lot.inventoryId,
            quantity: lot.quantity,
            unit: lot.unit,
            operationalReplacementAware: replacements.has(Number(line.id)),
            performedById: actor.id,
            deliveredToId: Number(order.collectorId),
            lotTrackingToken: lot.trackingToken,
            notes: `${order.orderNumber}: ${order.reason}`,
            costAllocations: [
              {
                beneficiarySiteId: Number(order.siteId),
                beneficiarySectionId: Number(order.sectionId),
                quantity: lot.quantity,
              },
            ],
          }),
        );
      }
      const result = {
        orderId: input.orderId,
        itemId: input.itemId,
        documents,
      };
      await tx.execute(
        sql`INSERT INTO audit_logs (userId,action,entityType,entityId,newValues) VALUES (${actor.id},'operational_issue_full_line','operational_issue',${input.orderId},${JSON.stringify({ operationKey: input.operationKey, fingerprint: requestFingerprint, result })})`,
      );
      return result;
    });
  }

  async issue(actor: OperationalActor, input: { orderId: number; itemId: number; warehouseId: number; lotTrackingToken?: string; quantity: number; operationKey: string; selection?:WarehouseLotSelection }) {
    this.actor(actor, "warehouse");
    if (!Number.isInteger(input.quantity) || input.quantity <= 0) throw new TRPCError({ code: "BAD_REQUEST", message: "كمية الصرف التشغيلي يجب أن تكون عددًا صحيحًا موجبًا" });
    if(input.selection)return this.issueSelected(actor,{...input,selection:input.selection});
    if(!input.lotTrackingToken)throw new TRPCError({code:"BAD_REQUEST",message:"اختر لوتات الصرف"});
    const lotTrackingToken = input.lotTrackingToken;
    const db = await this.ports.database();
    return db.transaction(async (tx: any) => {
      const order = await this.order(tx, actor, input.orderId, true);
      const requestFingerprint = fingerprint({ ...input, operationKey: undefined });
      const [old] = await rows(tx, sql`SELECT x.*,d.deliveryNumber FROM operational_issue_deliveries x INNER JOIN delivery_documents d ON d.id=x.deliveryDocumentId WHERE x.operationKey=${input.operationKey}`);
      if (old) {
        const [line] = await rows(tx, sql`SELECT id FROM operational_issue_items WHERE id=${Number(old.orderItemId)} AND orderId=${input.orderId}`);
        if (!line || old.requestFingerprint !== requestFingerprint || Number(old.orderItemId) !== input.itemId || Number(old.quantity) !== input.quantity) throw new TRPCError({ code: "CONFLICT", message: "معرف العملية مستخدم لعملية مختلفة" });
        return old;
      }
      const [line] = await rows(tx, sql`SELECT * FROM operational_issue_items WHERE id=${input.itemId} AND orderId=${input.orderId} FOR UPDATE`);
      if (line?.dispatchContext != null) throw new TRPCError({ code: "BAD_REQUEST", message: "يلزم تأكيد صرف الطلب بالكامل" });
      if (!line || order.status !== "approved") throw new TRPCError({ code: "BAD_REQUEST", message: "الصنف لا ينتمي إلى أمر معتمد" });
      const lot = await this.ports.resolveLot({ warehouseId: input.warehouseId, identifier: lotTrackingToken });
      const replacement = await assertOperationalReplacementIdentity(tx, line, { catalogItemId: Number(lot.linkedItemId), lotTrackingToken: lot.trackingToken, unit: String(lot.unit || ""), quantity: input.quantity });
      const replacementPlan = replacement?.plans.find(plan => plan.lots.some(allowed => allowed.trackingToken === lot.trackingToken));
      const [issued] = await rows(tx, sql`SELECT COALESCE(SUM(quantity),0) AS issued FROM operational_issue_deliveries WHERE orderItemId=${input.itemId}`);
      const remaining = Number(line.quantity) - (replacement?.issued ?? Number(issued?.issued || 0));
      const covered = replacementPlan ? Number(replacementPhysicalToOriginal(replacementPlan, String(input.quantity))) : input.quantity;
      if (remaining <= 0 || Math.abs(covered - remaining) > .0005) throw new TRPCError({ code: "BAD_REQUEST", message: "يجب صرف كامل المتبقي دون صرف جزئي" });
      const result = await this.ports.issue(tx, {
        operationalIssueItemId: input.itemId, operationalOperationKey: input.operationKey, operationalRequestFingerprint: requestFingerprint,
        inventoryId: lot.inventoryId, quantity: input.quantity, unit: String(lot.unit), operationalReplacementAware: Boolean(replacement),
        performedById: actor.id, deliveredToId: Number(order.collectorId), lotTrackingToken: lot.trackingToken,
        notes: `${order.orderNumber}: ${order.reason}${replacementPlan ? `\nتعويض الاحتياج الأصلي: ${line.itemName}\nالبديل المعتمد: ${replacementPlan.itemName}` : ""}`,
        costAllocations: [{ beneficiarySiteId: Number(order.siteId), beneficiarySectionId: Number(order.sectionId), quantity: input.quantity }],
      });
      await this.audit(tx, actor.id, input.orderId, "operational_issue_delivered"); return result;
    });
  }
  async returnMaterial(actor: OperationalActor, input: { orderId: number; deliveryDocumentId: number; quantity: number; reason: string; operationKey: string }) {
    this.actor(actor, "warehouse"); const db = await this.ports.database();
    return db.transaction(async (tx: any) => {
      await this.order(tx, actor, input.orderId, true);
      const [existing] = await rows(tx, sql`SELECT * FROM operational_issue_return_operations WHERE operationKey=${input.operationKey}`);
      if (existing) {
        if (Number(existing.orderId) !== input.orderId || Number(existing.deliveryDocumentId) !== input.deliveryDocumentId || Number(existing.quantity) !== input.quantity || existing.reason !== input.reason) throw new TRPCError({ code: "CONFLICT", message: "معرف المرتجع مستخدم لعملية أخرى" });
        return typeof existing.resultJson === "string" ? JSON.parse(existing.resultJson) : existing.resultJson;
      }
      const [source] = await rows(tx, sql`SELECT d.id FROM operational_issue_deliveries d INNER JOIN operational_issue_items i ON i.id=d.orderItemId WHERE i.orderId=${input.orderId} AND d.deliveryDocumentId=${input.deliveryDocumentId}`);
      if (!source) throw new TRPCError({ code: "BAD_REQUEST", message: "السند لا يتبع أمر الصرف" });
      const result = await this.ports.returnDelivery(tx, { sourceDeliveryDocumentId: input.deliveryDocumentId, returnedQuantity: input.quantity, reason: input.reason, returnedById: actor.id });
      await tx.execute(sql`INSERT INTO operational_issue_return_operations (operationKey,orderId,deliveryDocumentId,quantity,reason,resultJson) VALUES (${input.operationKey},${input.orderId},${input.deliveryDocumentId},${input.quantity},${input.reason},${JSON.stringify(result)})`);
      await this.audit(tx, actor.id, input.orderId, "operational_issue_returned"); return result;
    });
  }
  private async audit(tx: any, actorId: number, orderId: number, action: string) {
    await tx.execute(sql`INSERT INTO audit_logs (userId,action,entityType,entityId) VALUES (${actorId},${action},'operational_issue',${orderId})`);
  }
}

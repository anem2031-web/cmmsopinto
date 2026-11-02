import { sql } from "drizzle-orm";
import { applyOperationalReplacementStock, loadOperationalReplacements, replacementStockLines } from "./replacement";
import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import {
  canCreateOperationalIssue,
  canProcessOperationalIssue,
  type OperationalActor,
  type OperationalLine,
} from "../../../shared/operational-issues";
import {
  allocateOperationalFifo,
  canUseOperationalCatalog,
  dispatchContext,
  preparedCreateSchema,
  preparedIssueSchema,
  type PreparedCreate,
  type PreparedIssue,
} from "../../../shared/operational-dispatch";
import { executionRows as rows } from "./issue-reference";
import { loadOperationalStock } from "./stock-procurement";
import type { OperationalPorts } from "./service";

const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const invalid = (message: string): never => {
  throw new TRPCError({ code: "CONFLICT", message });
};
const idsSql = (ids: number[]) =>
  sql.join(
    Array.from(new Set(ids))
      .sort((a, b) => a - b)
      .map(id => sql`${id}`),
    sql`, `
  );
export function preparedActor(
  actor: OperationalActor,
  mode: "create" | "issue"
) {
  if (
    actor.isActive !== 1 ||
    !(mode === "create"
      ? canCreateOperationalIssue(actor.role)
      : canProcessOperationalIssue(actor.role))
  )
    throw new TRPCError({ code: "FORBIDDEN" });
}
async function freshActor(
  tx: any,
  actor: OperationalActor,
  mode: "create" | "issue"
) {
  const [current] = await rows(
    tx,
    sql`SELECT id,role,isActive FROM users WHERE id=${actor.id} FOR UPDATE`
  );
  if (!current || current.role !== actor.role)
    throw new TRPCError({ code: "FORBIDDEN" });
  preparedActor(
    { ...current, id: Number(current.id), isActive: Number(current.isActive) },
    mode
  );
}
export async function preparedReady(tx: any) {
  const found = await rows(
    tx,
    sql`SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='operational_issue_items' AND COLUMN_NAME='dispatchContext'`
  );
  const tables = await rows(
    tx,
    sql`SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='operational_issue_batches'`
  );
  return found.length === 1 && tables.length === 1;
}
async function requireReady(tx: any) {
  if (!(await preparedReady(tx)))
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "يلزم تنفيذ إعداد الصرف الجماعي يدويًا أولًا",
    });
}

/** Paginate the catalog/inventory group before enriching stock; at most 50 IDs / two stock queries. */
export async function preparedStockChoices(
  ports: OperationalPorts,
  actor: OperationalActor,
  input: { warehouseId: number; search: string; afterId: number }
) {
  preparedActor(actor, "create");
  const db = await ports.database();
  const term = `%${input.search.trim().replace(/[\\%_]/g, "\\$&")}%`;
  const found = await rows(
    db,
    sql`SELECT c.id,c.code,c.nameAr,c.nameEn,MIN(COALESCE(NULLIF(i.issueUnit,''),i.unit)) AS unit
    FROM catalog_items c INNER JOIN inventory i ON i.linkedItemId=c.id
    INNER JOIN warehouses w ON (w.id=i.warehouseId OR (i.warehouseId IS NULL AND w.id=(SELECT MIN(m.id) FROM warehouses m WHERE m.type='main' AND m.isActive=1)))
    WHERE w.id=${input.warehouseId} AND w.isActive=1 AND i.isFrozen=0 AND i.quantity>0 AND c.isActive=1 AND c.id>${input.afterId}
    AND (c.nameAr LIKE ${term} OR c.nameEn LIKE ${term} OR c.code LIKE ${term})
    GROUP BY c.id,c.code,c.nameAr,c.nameEn ORDER BY c.id LIMIT 51`
  );
  const selected = found.slice(0, 50);
  const stock = await loadOperationalStock(
    db,
    selected.map(
      c =>
        ({
          id: Number(c.id),
          catalogItemId: Number(c.id),
          unit: String(c.unit),
        }) as OperationalLine
    ),
    false,
    input.warehouseId
  );
  return {
    items: selected.map(c => ({
      ...c,
      id: Number(c.id),
      stock: stock.find(s => s.itemId === Number(c.id))!,
    })),
    next: found.length > 50 ? Number(selected[49].id) : null,
  };
}

export async function preparedSelection(
  ports: OperationalPorts,
  actor: OperationalActor,
  warehouseId: number,
  catalogItemIds: number[]
) {
  preparedActor(actor, "create");
  const db = await ports.database();
  const catalog = await rows(
    db,
    sql`SELECT c.id,c.unit,MIN(CASE WHEN w.id IS NOT NULL AND i.quantity>0 AND i.isFrozen=0 THEN COALESCE(NULLIF(i.issueUnit,''),i.unit) END) AS stockUnit
    FROM catalog_items c LEFT JOIN inventory i ON i.linkedItemId=c.id
    LEFT JOIN warehouses w ON w.isActive=1 AND w.id=${warehouseId} AND (w.id=i.warehouseId OR (i.warehouseId IS NULL AND w.id=(SELECT MIN(m.id) FROM warehouses m WHERE m.type='main' AND m.isActive=1)))
    WHERE c.id IN (${idsSql(catalogItemIds)}) AND c.isActive=1 GROUP BY c.id,c.unit ORDER BY c.id`
  );
  return loadOperationalStock(
    db,
    catalog.map(
      c =>
        ({
          id: Number(c.id),
          catalogItemId: Number(c.id),
          unit: String(c.stockUnit || c.unit || "").trim(),
        }) as OperationalLine
    ),
    false,
    warehouseId
  );
}

export async function createPrepared(
  ports: OperationalPorts,
  actor: OperationalActor,
  raw: PreparedCreate
) {
  const input = preparedCreateSchema.parse(raw);
  preparedActor(actor, "create");
  if (
    new Set(input.items.map(i => i.catalogItemId)).size !== input.items.length
  )
    invalid("لا يمكن تكرار الصنف في الطلب");
  if (
    input.items.some(i => i.source === "catalog") &&
    !canUseOperationalCatalog(actor.role)
  )
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "الاختيار من الكتالوج للمالك ومدير النظام فقط",
    });
  const db = await ports.database();
  await requireReady(db);
  return db.transaction(async (tx: any) => {
    await freshActor(tx, actor, "create");
    const fingerprint = hash({ ...input, operationKey: undefined });
    const [old] = await rows(
      tx,
      sql`SELECT id,orderNumber,requestFingerprint FROM operational_issue_orders WHERE operationKey=${input.operationKey} AND createdById=${actor.id}`
    );
    if (old) {
      if (old.requestFingerprint !== fingerprint)
        invalid("معرف الحفظ مستخدم لطلب مختلف");
      return { id: Number(old.id), orderNumber: String(old.orderNumber) };
    }
    const [warehouse] = await rows(
      tx,
      sql`SELECT id,nameAr,nameEn FROM warehouses WHERE id=${input.warehouseId} AND isActive=1`
    );
    if (!warehouse) invalid("المستودع غير موجود أو غير نشط");
    const sections = await rows(
      tx,
      sql`SELECT s.id,s.siteId,s.name,t.name AS siteName FROM sections s INNER JOIN sites t ON t.id=s.siteId WHERE s.id IN (${idsSql(input.items.map(i => i.sectionId))})`
    );
    const collectors = await rows(
      tx,
      sql`SELECT id,name FROM users WHERE id IN (${idsSql(input.items.map(i => i.collectorId))}) AND role='technician' AND isActive=1`
    );
    const catalog = await rows(
      tx,
      sql`SELECT id,nameAr,nameEn,unit FROM catalog_items WHERE id IN (${idsSql(input.items.map(i => i.catalogItemId))}) AND isActive=1`
    );
    const stock = await loadOperationalStock(
      tx,
      input.items.map(
        i =>
          ({
            id: i.catalogItemId,
            catalogItemId: i.catalogItemId,
            unit: i.unit,
          }) as OperationalLine
      ),
      false,
      input.warehouseId
    );
    const prepared = input.items.map(item => {
      const section = sections.find(
        s => Number(s.id) === item.sectionId && Number(s.siteId) === item.siteId
      );
      const collector = collectors.find(u => Number(u.id) === item.collectorId);
      const c = catalog.find(c => Number(c.id) === item.catalogItemId);
      const s = stock.find(s => s.itemId === item.catalogItemId)!;
      if (!section || !collector || !c)
        invalid("تحقق من الصنف والموقع والقسم والفني النشط لكل بند");
      if (s.needsReview)
        invalid(
          "يوجد اختلاف في وحدة الصنف أو أرصدة اللوت؛ حدّث الصنف وراجع المخزون"
        );
      if (item.source === "inventory" && s.totalQuantity <= 0)
        invalid("اختر صنفًا له رصيد في المخزن أو استخدم اختيار الكتالوج المخوّل");
      if (s.totalQuantity > 0) { if (item.quantity <= s.totalQuantity) allocateOperationalFifo(s, item.quantity); }
      else if (String(c.unit).trim() !== item.unit)
        invalid("الوحدة لا تطابق وحدة الصنف");
      return {
        ...item,
        name: c.nameAr || c.nameEn,
        context: {
          version: 1 as const,
          warehouseId: input.warehouseId,
          warehouseName: warehouse.nameAr || warehouse.nameEn,
          siteId: item.siteId,
          siteName: section.siteName,
          sectionId: item.sectionId,
          sectionName: section.name,
          collectorId: item.collectorId,
          collectorName: collector.name,
          source: item.source,
        },
      };
    });
    const first = prepared[0];
    const inserted = await tx.execute(
      sql`INSERT INTO operational_issue_orders (createdById,collectorId,siteId,sectionId,reason,operationKey,requestFingerprint,status) VALUES (${actor.id},${first.collectorId},${first.siteId},${first.sectionId},${input.reason},${input.operationKey},${fingerprint},'pending')`
    );
    const id = Number(inserted[0].insertId);
    if (!id) throw new Error("تعذر حفظ الطلب");
    const orderNumber = `OPR-${new Date().getFullYear()}-${String(id).padStart(6, "0")}`;
    await tx.execute(
      sql`UPDATE operational_issue_orders SET orderNumber=${orderNumber} WHERE id=${id}`
    );
    for (const item of prepared)
      await tx.execute(
        sql`INSERT INTO operational_issue_items (orderId,catalogItemId,itemName,unit,quantity,dispatchContext) VALUES (${id},${item.catalogItemId},${item.name},${item.unit},${item.quantity},${JSON.stringify(item.context)})`
      );
    await tx.execute(
      sql`INSERT INTO audit_logs (userId,action,entityType,entityId) VALUES (${actor.id},'operational_issue_created','operational_issue',${id})`
    );
    return { id, orderNumber };
  });
}

/** One order lock + one transaction, including each canonical physical issue and its documents/costs. */
export async function issuePrepared(
  ports: OperationalPorts,
  actor: OperationalActor,
  raw: PreparedIssue
) {
  const input = preparedIssueSchema.parse(raw);
  preparedActor(actor, "issue");
  if (new Set(input.items.map(i => i.itemId)).size !== input.items.length)
    invalid("تكرار بند في طلب الصرف");
  const normalized = {
    ...input,
    operationKey: undefined,
    items: [...input.items]
      .sort((a, b) => a.itemId - b.itemId)
      .map(i => ({ ...i, actualCollectorId: i.actualCollectorId || null })),
  };
  const fingerprint = hash(normalized);
  const db = await ports.database();
  await requireReady(db);
  return db.transaction(async (tx: any) => {
    await freshActor(tx, actor, "issue");
    const [order] = await rows(
      tx,
      sql`SELECT * FROM operational_issue_orders WHERE id=${input.orderId} FOR UPDATE`
    );
    if (!order) throw new TRPCError({ code: "NOT_FOUND" });
    const [old] = await rows(
      tx,
      sql`SELECT * FROM operational_issue_batches WHERE orderId=${input.orderId}`
    );
    if (old) {
      if (
        old.operationKey !== input.operationKey ||
        old.requestFingerprint !== fingerprint ||
        Number(old.issuedById) !== actor.id
      )
        invalid("تم صرف الطلب مسبقًا؛ حدّث الصفحة");
      if (!old.resultJson) invalid("لم تكتمل عملية الصرف");
      return typeof old.resultJson === "string"
        ? JSON.parse(old.resultJson)
        : old.resultJson;
    }
    if (
      order.status !== "approved" ||
      Number(order.revision) !== input.revision
    )
      invalid("تغير الطلب أو لم يعتمد؛ حدّث الصفحة");
    const lines = (await rows(
      tx,
      sql`SELECT i.*,COALESCE((SELECT SUM(d.quantity) FROM operational_issue_deliveries d WHERE d.orderItemId=i.id),0) AS issuedQuantity FROM operational_issue_items i WHERE i.orderId=${input.orderId} ORDER BY i.id FOR UPDATE`
    )) as OperationalLine[];
    if (
      !lines.length ||
      lines.length !== input.items.length ||
      lines.some(
        l =>
          !input.items.some(i => i.itemId === Number(l.id)) ||
          Number(l.issuedQuantity) !== 0
      )
    )
      invalid("يلزم إرسال جميع بنود الطلب غير المصروفة مرة واحدة");
    const contexts = lines.map(l => dispatchContext(l.dispatchContext));
    if (
      contexts.some(c => !c) ||
      new Set(contexts.map(c => c?.warehouseId)).size !== 1
    )
      invalid("هذا الطلب لا يدعم الصرف الجماعي");
    const recipients = lines.map((line, index) => {
      const supplied = input.items.find(i => i.itemId === Number(line.id))!;
      return {
        itemId: Number(line.id),
        actualCollectorId:
          supplied.actualCollectorId || contexts[index]!.collectorId,
        notes: supplied.notes,
      };
    });
    const people = await rows(
      tx,
      sql`SELECT id,name FROM users WHERE id IN (${idsSql(recipients.map(r => r.actualCollectorId))}) AND role='technician' AND isActive=1`
    );
    if (
      recipients.some(
        r => !people.some(p => Number(p.id) === r.actualCollectorId)
      )
    )
      invalid("المستلم الفعلي يجب أن يكون فنيًا نشطًا");
    // Lock inventory in ID order before any stock mutation. The canonical writer rechecks each physical lot.
    const replacements = await loadOperationalReplacements(tx, lines);
    const substituteLines = replacementStockLines(replacements);
    const allStockLines = [...lines, ...substituteLines];
    if (allStockLines.length > 500) invalid("عدد مراجع اللوتات والتعويضات يتجاوز حد الصرف الجماعي؛ يلزم مراجعة الطلب");
    const allStock = await loadOperationalStock(
      tx,
      allStockLines,
      true,
      contexts[0]!.warehouseId
    );
    const stock = applyOperationalReplacementStock(allStock.filter(s => s.itemId > 0), allStock.filter(s => s.itemId < 0), replacements);
    const allocations = lines.map(line =>
      allocateOperationalFifo(
        stock.find(s => s.itemId === Number(line.id))!,
        Number(line.quantity),
        input.items.find(item=>item.itemId===Number(line.id))?.selection
      )
    );
    const persisted = recipients.map(r => ({
      ...r,
      actualCollectorName: people.find(
        p => Number(p.id) === r.actualCollectorId
      )!.name,
    }));
    await tx.execute(
      sql`INSERT INTO operational_issue_batches (orderId,operationKey,requestFingerprint,issuedById,inputJson) VALUES (${input.orderId},${input.operationKey},${fingerprint},${actor.id},${JSON.stringify(persisted)})`
    );
    const documents: any[] = [];
    for (let n = 0; n < lines.length; n++) {
      const line = lines[n],
        context = contexts[n]!,
        recipient = recipients[n];
      for (let k = 0; k < allocations[n].length; k++) {
        const lot = allocations[n][k];
        documents.push(
          await ports.issue(tx, {
            operationalIssueItemId: Number(line.id),
            operationalBatchKey: input.operationKey,
            operationalOperationKey: hash([input.operationKey, line.id, k]),
            operationalRequestFingerprint: fingerprint,
            operationalReplacementAware: replacements.has(Number(line.id)),
            inventoryId: lot.inventoryId,
            quantity: lot.quantity,
            unit: lot.unit,
            performedById: actor.id,
            deliveredToId: recipient.actualCollectorId,
            assignedTechnicianId: context.collectorId,
            assignedTechnicianName: context.collectorName,
            lotTrackingToken: lot.trackingToken,
            notes: `${order.orderNumber}: ${order.reason}\nالمستلم المحدد: ${context.collectorName}${lot.replacementName ? `\nتعويض الاحتياج الأصلي: ${line.itemName}\nالبديل المعتمد: ${lot.replacementName}` : ""}${recipient.notes ? `\n${recipient.notes}` : ""}`,
            costAllocations: [
              {
                beneficiarySiteId: context.siteId,
                beneficiarySectionId: context.sectionId,
                quantity: lot.quantity,
              },
            ],
          })
        );
      }
    }
    const result = { orderId: input.orderId, documents };
    await tx.execute(
      sql`UPDATE operational_issue_batches SET resultJson=${JSON.stringify(result)} WHERE orderId=${input.orderId}`
    );
    await tx.execute(
      sql`INSERT INTO audit_logs (userId,action,entityType,entityId) VALUES (${actor.id},'operational_issue_batch_delivered','operational_issue',${input.orderId})`
    );
    return result;
  });
}

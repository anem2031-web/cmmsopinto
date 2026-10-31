import { sql } from "drizzle-orm";
import {
  TeamTicketError,
  type Snapshot,
  type LocationRef,
} from "../../../shared/maintenance-team-tickets/model";
import type {
  MaterialGateway,
  PhysicalDelivery,
  SupplyResult,
} from "../../maintenance-team-tickets/ports";
import type { TeamManagementActor } from "../../../shared/maintenance-team-tickets/team-management";
import type { TeamDatabaseTransaction } from "./repository";
import { selectRows, type ExecutionOptions } from "./execution.repository";
import { canExecuteAllTicketTeams } from "../../../shared/maintenance-team-tickets/execution-permissions";
import { exactOriginalAllocation, limitReplacementSourceCoverage, loadReplacementFulfillments, replacementAllocationQuantum, representableReplacementAllocation, replacementOriginalToPhysical, replacementPhysicalToOriginal, type ReplacementFulfillment } from "../../supplier-return-followup/fulfillment";

export interface InventoryWriters {
  transferBatch?(input: any, tx: any): Promise<any>;
  lotsEnabled(): boolean;
  issue(input: any, tx: any): Promise<any>;
  transfer(input: any, tx: any): Promise<any>;
  recipientReturn(input: any, tx: any): Promise<any>;
  createPurchase(data: any, tx: any): Promise<any>;
  createItems(data: any[], tx: any): Promise<any>;
}
async function currentWriters(): Promise<InventoryWriters> {
  const [issues, transfers, purchases, lots] = await Promise.all([
    import("../../_core/db/warehouse-returns"),
    import("../../_core/db/warehouses"),
    import("../../_core/db/purchase"),
    import("../../_core/inventory-lots"),
  ]);
  return {
    lotsEnabled: lots.isInventoryLotsEnabled,
    issue: issues.issueDelivery,
    transfer: transfers.createWarehouseTransfer,
    transferBatch: transfers.createWarehouseTransferBatch,
    recipientReturn: issues.createRecipientWarehouseReturn,
    createPurchase: purchases.createPurchaseOrder,
    createItems: purchases.createPOItems,
  };
}
export class ProductionMaterialGateway implements MaterialGateway {
  purchaseForm?: MaterialGateway["purchaseForm"];
  private replacementLookup?: ReturnType<typeof loadReplacementFulfillments>;
  constructor(
    private readonly tx: TeamDatabaseTransaction,
    private readonly state: Snapshot,
    private readonly actor: TeamManagementActor,
    private readonly options: ExecutionOptions,
    private readonly writers: () => Promise<InventoryWriters> = currentWriters
  ) {}
  private async replacements(needId: number) {
    const n = this.state.needs.find(need => need.id === needId);
    const a = this.state.assignments[0];
    if (!n || n.assignmentId !== a.id) throw new TeamTicketError("CONFLICT", "الاحتياج لا يتبع التذكرة");
    const sources = this.state.supplies.filter(s => s.needId === needId && s.kind === "purchase");
    // The gateway belongs to one authorized read/transaction; batch all sources
    // once and never reuse this snapshot for a subsequent operation.
    this.replacementLookup ??= loadReplacementFulfillments(this.tx,
      this.state.supplies.filter(s => s.kind === "purchase").map(s => s.sourceId));
    const lookup = await this.replacementLookup;
    const plans = sources.flatMap(source => limitReplacementSourceCoverage(lookup.get(source.sourceId) ?? [], String(source.quantity)));
    for (const p of plans) {
      if (p.sourceCatalogItemId !== n.catalogItemId || p.originalUnit !== n.unit || p.sourceTicketId !== a.ticketId || p.sourceTicketItemId !== a.ticketItemId)
        throw new TeamTicketError("CONFLICT", "مصدر البديل لا يطابق احتياج الفريق الأصلي");
    }
    return plans;
  }
  async replacementContext(needId: number) { return (await this.replacements(needId)).length > 0; }
  private async validateReplacementWrites(needId: number) {
    const ids = Array.from(new Set((await this.replacements(needId)).map(plan => plan.catalogItemId)));
    for (let offset = 0; offset < ids.length; offset += 500) {
      const part = ids.slice(offset, offset + 500);
      const rows = await selectRows(this.tx, sql`SELECT c.id,c.isActive,EXISTS (SELECT 1 FROM catalog_units u WHERE u.isActive=0 AND (u.nameAr=c.unit OR u.nameEn=c.unit)) AS inactiveUnit FROM catalog_items c WHERE c.id IN (${sql.join(part.map(id => sql`${id}`), sql`,`)}) FOR UPDATE`);
      if (rows.length !== part.length || rows.some(row => Number(row.isActive) !== 1 || Number(row.inactiveUnit) === 1))
        throw new TeamTicketError("CONFLICT", "صنف البديل أو وحدته غير نشط؛ راجع الكتالوج قبل الصرف أو التحويل");
    }
  }
  private async fulfillmentPlan(needId: number, warehouseId: number, required: number, requireFull = true) {
    const need = this.state.needs.find(n => n.id === needId)!;
    const plans = await this.replacements(needId);
    type Allocation = { catalogItemId: number; unit: string; quantity: number; originalEquivalent: number; lotIds?: number[]; replacement?: ReplacementFulfillment };
    const candidates: Array<{ allocation: Omit<Allocation, "quantity" | "originalEquivalent">; maximum: string; quantum: string }> = [];
    for (const p of plans) {
      const stock = await this.stock(warehouseId, p.catalogItemId);
      const lots = stock.lots.filter(lot => p.lots.some(l => l.lotId === Number(lot.lotId)));
      const prior = this.state.deliveries.filter(d => d.needId === needId && p.lots.some(l => l.lotId === d.lotId))
        .reduce((sum, d) => sum + (d.originalEquivalent ?? Number(replacementPhysicalToOriginal(p, String(d.quantity)))), 0);
      const allowance = Math.min(required, Math.max(0, Number(p.maximumOriginalQuantity) - prior));
      if (allowance <= 0) continue;
      const available = lots.reduce((sum, lot) => sum + Math.floor(Number(lot.quantity)), 0);
      const selected = representableReplacementAllocation(p, { availablePhysical: String(available), maxOriginal: String(allowance), originalStep: "1", physicalStep: "1" });
      if (Number(selected.physicalQuantity) <= 0) continue;
      candidates.push({ allocation: { catalogItemId: p.catalogItemId, unit: p.lots[0].unit, lotIds: lots.map(l => Number(l.lotId)), replacement: p },
        maximum: selected.originalQuantity, quantum: replacementAllocationQuantum(p, { originalStep: "1", physicalStep: "1" }).originalQuantity });
    }
    const originalStock = await this.stock(warehouseId, need.catalogItemId!);
    const approvedLots = new Set(plans.flatMap(plan => plan.lots.map(lot => lot.lotId)));
    // A received replacement lot must retain its approved ratio even when it
    // has the same catalog identity as the source; never count it again 1:1.
    const originalLots = originalStock.lots.filter(lot => !approvedLots.has(Number(lot.lotId)));
    const originalAvailable = Math.min(originalStock.available, originalLots.reduce((sum, lot) => sum + Math.floor(Number(lot.quantity)), 0));
    if (originalAvailable > 0) candidates.push({ allocation: { catalogItemId: need.catalogItemId!, unit: need.unit, lotIds: originalLots.map(lot => Number(lot.lotId)) }, maximum: String(Math.min(required, originalAvailable)), quantum: "1" });
    let chosen = exactOriginalAllocation(String(required), candidates);
    if (!chosen && requireFull) throw new TeamTicketError("CONFLICT", "رصيد الصنف والبديل المعتمد لا يغطي كامل الاحتياج بتوزيع دقيق");
    if (!chosen) {
      let left = required;
      chosen = candidates.map(candidate => {
        const quantum = Number(candidate.quantum), take = Math.floor(Math.min(left, Number(candidate.maximum)) / quantum) * quantum;
        left -= take; return String(take);
      });
    }
    const allocations: Allocation[] = [];
    chosen.forEach((value, index) => {
      const equivalent = Number(value); if (equivalent <= 0) return;
      const candidate = candidates[index].allocation;
      const quantity = candidate.replacement ? Number(replacementOriginalToPhysical(candidate.replacement, value)) : equivalent;
      if (!Number.isSafeInteger(quantity)) throw new TeamTicketError("CONFLICT", "كمية الصرف الفعلية يجب أن تكون صحيحة");
      allocations.push({ ...candidate, quantity, originalEquivalent: equivalent });
    });
    return { allocations, covered: Math.round(allocations.reduce((sum, part) => sum + part.originalEquivalent, 0) * 1000) / 1000 };
  }
  async issueNeed(needId: number, input: Parameters<MaterialGateway["issue"]>[0]) {
    if (!await this.replacementContext(needId)) return this.issue(input);
    await this.validateReplacementWrites(needId);
    const { allocations } = await this.fulfillmentPlan(needId, input.warehouseId, input.quantity);
    const results: PhysicalDelivery[] = [];
    for (const segment of allocations) {
      const rows = await this.issue({ ...input, catalogItemId: segment.catalogItemId, quantity: segment.quantity, unit: segment.unit, lotIds: segment.lotIds });
      for (const row of rows) results.push({ ...row, originalEquivalent: segment.replacement ? Number(replacementPhysicalToOriginal(segment.replacement, String(row.quantity))) : row.quantity,
        ...(segment.replacement ? { replacementPlanId: segment.replacement.planId, replacementName: segment.replacement.itemName } : {}) });
    }
    return results;
  }
  async transferNeed(needId: number, input: Parameters<MaterialGateway["transfer"]>[0]) {
    await this.validateReplacementWrites(needId);
    const inBranch = await this.fulfillmentPlan(needId, input.destinationWarehouseId, input.quantity, false);
    const shortage = Math.round((input.quantity - inBranch.covered) * 1000) / 1000;
    if (shortage <= 0) throw new TeamTicketError("CONFLICT", "الاحتياج والبديل متوفران بمخزن الفريق؛ استخدم الصرف");
    const main = await this.mainWarehouseId();
    const { allocations } = await this.fulfillmentPlan(needId, main, shortage);
    const result: SupplyResult[] = [];
    for (const segment of allocations) {
      const rows = await this.transfer({ ...input, catalogItemId: segment.catalogItemId, quantity: segment.quantity, unit: segment.unit, lotIds: segment.lotIds });
      result.push(...rows.map(row => ({ ...row, originalEquivalent: segment.replacement ? Number(replacementPhysicalToOriginal(segment.replacement, String(row.quantity))) : row.quantity,
        ...(segment.replacement ? { physicalUnit: segment.unit, replacementName: segment.replacement.itemName } : {}) })));
    }
    return result;
  }
  async mainWarehouseId(): Promise<number> {
    const rows = await selectRows(
      this.tx,
      sql`SELECT id FROM warehouses WHERE type='main' AND isActive=1 ORDER BY id FOR UPDATE`
    );
    if (rows.length !== 1)
      throw new TeamTicketError("CONFLICT", "يجب وجود مستودع رئيسي نشط واحد");
    return Number(rows[0].id);
  }
  private async stock(warehouseId: number, catalogItemId: number) {
    const w = await selectRows(
      this.tx,
      sql`SELECT id,isActive FROM warehouses WHERE id=${warehouseId} FOR UPDATE`
    );
    if (!w.length || Number(w[0].isActive) !== 1)
      throw new TeamTicketError("CONFLICT", "المستودع غير نشط");
    const rows = await selectRows(
      this.tx,
      sql`SELECT id,quantity,issueUnit,unit,isFrozen FROM inventory WHERE warehouseId=${warehouseId} AND linkedItemId=${catalogItemId} ORDER BY id LIMIT 2 FOR UPDATE`
    );
    if (rows.length > 1)
      throw new TeamTicketError(
        "CONFLICT",
        "يوجد أكثر من سجل مخزون لهذا الصنف؛ يلزم مراجعة المستودع"
      );
    const inventory = rows[0];
    if (!inventory || Number(inventory.isFrozen) === 1)
      return { inventory: null, lots: [], available: 0 };
    if (!(await this.writers()).lotsEnabled())
      throw new TeamTicketError(
        "CONFLICT",
        "صرف مواد الفريق يتطلب تفعيل اللوت؛ استخدم دورة المخزون المعتمدة"
      );
    const lots = await selectRows(
      this.tx,
      sql`SELECT b.lotId,b.quantity,l.trackingToken,l.lotCode,l.issueUnit,l.catalogItemId FROM inventory_lot_balances b INNER JOIN inventory_lots l ON l.id=b.lotId WHERE b.inventoryId=${Number(inventory.id)} AND b.quantity>0 ORDER BY l.expiryDate,l.createdAt,l.id FOR UPDATE`
    );
    const matching = lots.filter(
      l =>
        Number(l.catalogItemId) === catalogItemId &&
        (l.issueUnit || inventory.issueUnit || inventory.unit) ===
          (inventory.issueUnit || inventory.unit)
    );
    // Quantity columns in ticket needs/documents are integers; fractional Lot balances are never rounded up.
    const available = Math.min(
      Math.floor(Number(inventory.quantity)),
      matching.reduce((n, l) => n + Math.floor(Number(l.quantity)), 0)
    );
    return { inventory, lots: matching, available };
  }
  async availability(warehouseId: number, catalogItemId: number) {
    const a = this.state.assignments[0];
    const candidates = this.state.needs.filter(n => n.assignmentId === a?.id && n.round === a.materialRound && n.catalogItemId === catalogItemId);
    if (candidates.length === 1 && await this.replacementContext(candidates[0].id)) {
      return (await this.fulfillmentPlan(candidates[0].id, warehouseId, candidates[0].requested, false)).covered;
    }
    return (await this.stock(warehouseId, catalogItemId)).available;
  }
  async sourceInventoryId(warehouseId: number, catalogItemId: number) {
    const { inventory } = await this.stock(warehouseId, catalogItemId);
    if (!inventory)
      throw new TeamTicketError("CONFLICT", "بطاقة مخزون المصدر غير متاحة");
    return Number(inventory.id);
  }
  async transferForm(input: {
    fromWarehouseId: number;
    toWarehouseId: number;
    notes?: string;
    items: Array<{
      fromInventoryId: number;
      quantity: number;
      lotTrackingToken?: string;
      notes?: string;
    }>;
  }) {
    const writer = (await this.writers()).transferBatch;
    if (!writer)
      throw new TeamTicketError("UNAVAILABLE", "خدمة التحويل غير متاحة");
    const result = await writer(
      { ...input, createdById: this.actor.id },
      this.tx
    );
    const sources: SupplyResult[] = [];
    for (const item of result.results) {
      if (!item.success)
        throw new TeamTicketError(
          "CONFLICT",
          "فشل تحويل اللوت؛ أُلغيت العملية كاملة"
        );
      const [r] = await selectRows(
        this.tx,
        sql`SELECT id,quantity FROM warehouse_transfers WHERE transferNumber=${item.transferNumber} AND fromInventoryId=${item.fromInventoryId} AND fromWarehouseId=${input.fromWarehouseId} AND toWarehouseId=${input.toWarehouseId} AND lotId=${item.lotId}`
      );
      if (!r) throw new TeamTicketError("CONFLICT", "سند التحويل غير مطابق");
      sources.push({
        sourceId: Number(r.id),
        sourceNumber: item.transferNumber,
        quantity: Number(r.quantity),
        status: "received",
      });
    }
    return { ...result, sources };
  }
  async verifySupply(
    needId: number,
    _kind: "purchase",
    sourceId: number
  ): Promise<SupplyResult> {
    const a = this.state.assignments[0],
      n = this.state.needs.find(x => x.id === needId);
    const [r] = await selectRows(
      this.tx,
      sql`SELECT i.*,p.poNumber,p.ticketId,p.ticketItemId,p.status AS poStatus FROM purchase_order_items i INNER JOIN purchase_orders p ON p.id=i.purchaseOrderId WHERE i.id=${sourceId} FOR UPDATE`
    );
    if (
      !n ||
      !r ||
      Number(r.ticketId) !== a.ticketId ||
      Number(r.ticketItemId) !== a.ticketItemId ||
      Number(r.catalogItemId) !== n.catalogItemId ||
      r.unit !== n.unit ||
      r.poStatus !== "pending_review" ||
      Number(r.quantity) <= 0
    )
      throw new TeamTicketError(
        "CONFLICT",
        "بند الشراء لا يتبع احتياج التذكرة"
      );
    return {
      sourceId,
      sourceNumber: r.poNumber,
      quantity: Number(r.quantity),
      status: "pending",
    };
  }
  private async plan(
    warehouseId: number,
    catalogItemId: number,
    quantity: number,
    unit: string,
    lotIds?: number[]
  ) {
    const stock = await this.stock(warehouseId, catalogItemId);
    if (
      !stock.inventory ||
      stock.available < quantity ||
      (stock.inventory.issueUnit || stock.inventory.unit) !== unit
    )
      throw new TeamTicketError(
        "CONFLICT",
        "الرصيد أو وحدة الصنف لا يغطي كامل الاحتياج"
      );
    let left = quantity;
    const allocations: Array<{ lot: any; quantity: number }> = [];
    for (const lot of stock.lots.filter(lot => !lotIds || lotIds.includes(Number(lot.lotId)))) {
      const take = Math.min(left, Math.floor(Number(lot.quantity)));
      if (take > 0) {
        allocations.push({ lot, quantity: take });
        left -= take;
      }
      if (!left) break;
    }
    if (left)
      throw new TeamTicketError("CONFLICT", "رصيد اللوت لا يغطي كامل الاحتياج");
    return { inventory: stock.inventory, allocations };
  }
  async issue(input: {
    operationKey: string;
    ticketId: number;
    ticketNumber: string;
    warehouseId: number;
    catalogItemId: number;
    quantity: number;
    unit: string;
    receiverId: number;
    location: LocationRef;
    lotIds?: number[];
  }): Promise<PhysicalDelivery[]> {
    const recipient = this.state.users.find(
      x => x.id === input.receiverId && x.active
    );
    const a = this.state.assignments[0];
    const ticket = this.state.tickets.find(t => t.ticketId === a.ticketId);
    const namedItExecutor =
      !!recipient &&
      ["it_manager", "it_member"].includes(recipient.role) &&
      ticket?.responsibleDepartment === "maintenance_report_department_it" &&
      ticket.assignedToId === recipient.id;
    const warehouseIssue =
      ["warehouse", "owner", "admin"].includes(this.actor.role) &&
      recipient &&
      this.state.teams.some(t => t.id === a.teamId && t.active) &&
      (canExecuteAllTicketTeams(recipient.role) ||
        ((recipient.role === "technician" || namedItExecutor) &&
          this.state.memberships.some(
            m => m.teamId === a.teamId && m.userId === recipient.id && m.active
          )));
    if (input.receiverId !== this.actor.id && !warehouseIssue)
      throw new TeamTicketError(
        "FORBIDDEN",
        "الاستلام متاح فقط لمنفذ البلاغ المسند إليه"
      );
    const { inventory, allocations } = await this.plan(
        input.warehouseId,
        input.catalogItemId,
        input.quantity,
        input.unit,
        input.lotIds
      ),
      writers = await this.writers(),
      result: PhysicalDelivery[] = [];
    for (const allocation of allocations) {
      const d = await writers.issue(
        {
          inventoryId: Number(inventory.id),
          quantity: allocation.quantity,
          unit: input.unit,
          performedById: this.actor.id,
          deliveredToId: input.receiverId,
          ticketId: input.ticketId,
          ticketItemId: this.state.assignments[0].ticketItemId,
          ticketNumber: input.ticketNumber,
          assignedTechnicianId: input.receiverId,
          lotTrackingToken: allocation.lot.trackingToken,
          notes: `مواد فريق البلاغ ${input.ticketNumber}`,
          costAllocations: [
            {
              beneficiarySiteId: input.location.siteId,
              beneficiarySectionId: input.location.sectionId,
              beneficiaryAssetId: input.location.assetId,
              quantity: allocation.quantity,
            },
          ],
        },
        this.tx
      );
      result.push({
        deliveryId: Number(d.deliveryDocumentId),
        deliveryNumber: d.deliveryNumber,
        lotId: Number(d.lotId),
        inventoryTransactionId: Number(d.inventoryTransactionId),
        catalogItemId: input.catalogItemId,
        warehouseId: input.warehouseId,
        quantity: allocation.quantity,
        unit: input.unit,
        receivedById: input.receiverId,
      });
    }
    return result;
  }
  async transfer(input: {
    operationKey: string;
    destinationWarehouseId: number;
    catalogItemId: number;
    quantity: number;
    unit: string;
    lotIds?: number[];
  }): Promise<SupplyResult[]> {
    const main = await this.mainWarehouseId(),
      { inventory, allocations } = await this.plan(
        main,
        input.catalogItemId,
        input.quantity,
        input.unit,
        input.lotIds
      ),
      writers = await this.writers(),
      result: SupplyResult[] = [];
    for (const allocation of allocations) {
      const d = await writers.transfer(
        {
          fromWarehouseId: main,
          toWarehouseId: input.destinationWarehouseId,
          fromInventoryId: Number(inventory.id),
          quantity: allocation.quantity,
          createdById: this.actor.id,
          lotTrackingToken: allocation.lot.trackingToken,
          notes: `احتياج فريق البلاغ ${this.state.assignments[0].ticketNumber}`,
        },
        this.tx
      );
      const [r] = await selectRows(
        this.tx,
        sql`SELECT id,quantity FROM warehouse_transfers WHERE transferNumber=${d.transferNumber} AND fromInventoryId=${Number(inventory.id)} AND toWarehouseId=${input.destinationWarehouseId} AND lotId=${Number(d.lotId)}`
      );
      if (!r || Number(r.quantity) !== allocation.quantity)
        throw new TeamTicketError("CONFLICT", "سند التحويل لا يطابق الاحتياج");
      result.push({
        sourceId: Number(r.id),
        sourceNumber: d.transferNumber,
        quantity: allocation.quantity,
        status: "received",
      });
    }
    return result;
  }
  async purchase(input: {
    operationKey: string;
    destinationWarehouseId: number;
    catalogItemId: number;
    quantity: number;
    unit: string;
    location: LocationRef;
  }): Promise<SupplyResult> {
    const a = this.state.assignments[0],
      item = this.state.catalog.find(
        c => c.id === input.catalogItemId && c.active
      );
    if (!item || item.unit !== input.unit)
      throw new TeamTicketError("INVALID", "الصنف أو الوحدة غير نشط");
    const date = this.options.requiredDate;
    if (
      !date ||
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      Number.isNaN(Date.parse(date)) ||
      new Date(date).toISOString().slice(0, 10) !== date
    )
      throw new TeamTicketError("INVALID", "حدد تاريخ الاحتياج الصحيح للشراء");
    const year = new Date().getFullYear();
    // Reuse the existing reservation table inside this same transaction; no alternate numbering scheme.
    const [counter] = (await this.tx.execute(
      sql`INSERT INTO purchase_order_number_counter (year) VALUES (${year})`
    )) as [{ insertId: number }];
    if (!Number(counter?.insertId)) throw new Error("تعذر حجز رقم طلب الشراء");
    const number = `PR-${year}-${String(counter.insertId).padStart(4, "0")}`,
      writers = await this.writers();
    const poId = Number(
      await writers.createPurchase(
        {
          poNumber: number,
          ticketId: a.ticketId,
          ticketItemId: a.ticketItemId,
          requestedById: this.actor.id,
          status: "pending_review",
          submittedAt: new Date(),
          siteId: input.location.siteId,
          sectionId: input.location.sectionId,
          assetId: input.location.assetId,
          notes: `توفير مواد فريق ${a.ticketNumber} — الاستلام بالمستودع الرئيسي ثم التحويل لمستودع الفريق`,
        },
        this.tx
      )
    );
    if (!poId) throw new Error("تعذر إنشاء طلب الشراء");
    await writers.createItems(
      [
        {
          purchaseOrderId: poId,
          catalogItemId: item.id,
          itemName: item.name,
          quantity: input.quantity,
          unit: item.unit,
          requiredDate: date,
          status: "pending",
        },
      ],
      this.tx
    );
    const rows = await selectRows(
      this.tx,
      sql`SELECT id FROM purchase_order_items WHERE purchaseOrderId=${poId}`
    );
    if (rows.length !== 1)
      throw new Error("طلب توفير المادة يجب أن يحوي بندًا واحدًا");
    const recipients = await selectRows(
      this.tx,
      sql`SELECT id FROM users WHERE isActive=1 AND (id=${a.responsibleManagerId} OR role IN ('owner','admin'))`
    );
    for (const u of recipients)
      await this.tx.execute(
        sql`INSERT INTO notifications (userId,title,message,type,relatedTicketId,relatedPoId) VALUES (${Number(u.id)},'طلب شراء مواد فريق',${`${number} — ${a.ticketNumber}`},'info',${a.ticketId},${poId})`
      );
    return {
      sourceId: Number(rows[0].id),
      sourceNumber: number,
      quantity: input.quantity,
      status: "pending",
    };
  }
  async receivePurchase(input: {
    operationKey: string;
    sourceId: number;
  }): Promise<SupplyResult> {
    const a = this.state.assignments[0],
      main = await this.mainWarehouseId();
    const [r] = await selectRows(
      this.tx,
      sql`SELECT i.*,p.poNumber,p.ticketId,p.ticketItemId,p.status AS poStatus FROM purchase_order_items i INNER JOIN purchase_orders p ON p.id=i.purchaseOrderId WHERE i.id=${input.sourceId} FOR UPDATE`
    );
    const link = this.state.supplies.find(
      s => s.kind === "purchase" && s.sourceId === input.sourceId
    );
    const need = link && this.state.needs.find(n => n.id === link.needId);
    if (
      !r ||
      !link ||
      !need ||
      Number(r.ticketId) !== a.ticketId ||
      Number(r.ticketItemId) !== a.ticketItemId ||
      Number(r.catalogItemId) !== need.catalogItemId ||
      r.unit !== need.unit ||
      Number(r.quantity) < link.quantity ||
      ["rejected", "cancelled", "purchase_cancelled"].includes(r.status) ||
      [
        "draft",
        "pending_review",
        "pending_estimate",
        "pending_accounting",
        "pending_management",
        "rejected",
        "revision_needed",
      ].includes(r.poStatus)
    )
      throw new TeamTicketError(
        "CONFLICT",
        "طلب الشراء المرتبط لم يكمل الاعتمادات والاستلام أو لم يعد يطابق الاحتياج"
      );
    const lots = await selectRows(
      this.tx,
      sql`SELECT SUM(b.quantity) AS quantity FROM inventory_lots l INNER JOIN inventory_lot_balances b ON b.lotId=l.id INNER JOIN inventory v ON v.id=b.inventoryId WHERE l.purchaseOrderItemId=${input.sourceId} AND v.warehouseId=${main}`
    );
    if (
      Number(r.receivedQuantity) < link.quantity ||
      !r.receivedAt ||
      Number(lots[0]?.quantity) < link.quantity
    )
      throw new TeamTicketError(
        "CONFLICT",
        "أكمل الاستلام الفعلي للشراء في المستودع الرئيسي أولًا"
      );
    return {
      sourceId: input.sourceId,
      sourceNumber: r.poNumber,
      quantity: link.quantity,
      status: "received",
    };
  }
  async returnToWarehouse(input: {
    operationKey: string;
    sourceDeliveryId: number;
    quantity: number;
    actorId: number;
  }) {
    const d = this.state.deliveries.find(
      x => x.deliveryId === input.sourceDeliveryId
    );
    if (!d || input.actorId !== this.actor.id)
      throw new TeamTicketError("FORBIDDEN", "سند المرتجع لا يتبع هذا الإسناد");
    const [source] = await selectRows(
      this.tx,
      sql`SELECT id,lotId,deliveredToId FROM delivery_documents WHERE id=${d.deliveryId} FOR UPDATE`
    );
    if (
      !source ||
      Number(source.lotId) !== d.lotId ||
      Number(source.deliveredToId) !== d.receivedById
    )
      throw new TeamTicketError(
        "CONFLICT",
        "المستلم أو اللوت في سند الصرف الأصلي غير مطابق"
      );
    const r = await (
      await this.writers()
    ).recipientReturn(
      {
        sourceDeliveryDocumentId: d.deliveryId,
        returnedQuantity: input.quantity,
        reason: `مرتجع مواد فريق البلاغ ${this.state.assignments[0].ticketNumber}`,
        returnedById: this.actor.id,
      },
      this.tx
    );
    return {
      returnId: Number(r.returnId),
      returnNumber: r.returnNumber,
      quantity: Number(r.returnedQuantity),
    };
  }
}

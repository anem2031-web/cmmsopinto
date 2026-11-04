import { TRPCError } from "@trpc/server";
import { sql } from "drizzle-orm";
import { readScopeChunks } from "../_core/authz/read-batch";
import { BYPASS_ALL_ROLES, VISIBILITY_POLICY } from "../_core/authz/policy";
import { canPerformAction } from "../_core/authz/engine";
import {
  CONSTRUCTION_SPECIFICATION_ROLE, canReviewPurchaseSpecifications, canReadSpecificationReturns,
  specificationDecisionInput, specificationListInput, type SpecificationActor,
} from "../../shared/purchase-specifications";

export type PurchaseSpecificationPorts = {
  database(): Promise<any>;
  readGuard(actor: SpecificationActor, orders?: readonly any[]): Promise<(order: any) => void>;
};
async function rows(tx: any, statement: any): Promise<any[]> {
  const response = await tx.execute(statement);
  if (!Array.isArray(response?.[0])) throw Error("تعذر قراءة بيانات مطابقة المواصفات");
  return response[0];
}
const ids = (values: number[]) => sql.join(values.map(value => sql`${value}`), sql`, `);
function capability(actor: SpecificationActor, mode: "review" | "returns") {
  if (!(mode === "review" ? canReviewPurchaseSpecifications(actor) : canReadSpecificationReturns(actor))) {
    throw new TRPCError({ code: "FORBIDDEN", message: "ليس لديك صلاحية لهذا الإجراء في مطابقة المواصفات" });
  }
}
async function currentActor(tx: any, actor: SpecificationActor, mode: "review" | "returns", lock = false) {
  capability(actor, mode);
  const [live] = await rows(tx, sql`SELECT id,role,isActive,name FROM users WHERE id=${actor.id} ${lock ? sql`FOR UPDATE` : sql``}`);
  if (!live || live.role !== actor.role) throw new TRPCError({ code: "FORBIDDEN", message: "الحساب غير نشط أو تغير دوره" });
  capability(live, mode);
  return live as SpecificationActor & { name: string };
}

/** The construction hold needs an identifiable physical lot, even if the legacy flag is disabled. */
export async function assertSpecificationReceiptTracking(tx: any, itemIds: number[], lotsEnabled: boolean): Promise<void> {
  if (lotsEnabled || !itemIds.length) return;
  const matches = await readScopeChunks(itemIds, chunk => rows(tx,
    sql`SELECT id FROM purchase_order_items WHERE id IN (${ids(chunk)}) AND reviewRole=${CONSTRUCTION_SPECIFICATION_ROLE} LIMIT 1`));
  if (matches.length) throw new TRPCError({ code: "BAD_REQUEST", message: "استلام أصناف الإنشاءات يحتاج تفعيل تتبع اللوتات لحفظ قرار مطابقة المواصفات قبل الصرف" });
}

/** Called only by the receipt lot writer, in its existing transaction. Old lots are never backfilled. */
export async function receiptSpecificationFields(tx: any, input: {
  purchaseOrderItemId?: number | null; purchaseOrderId?: number | null;
  receiptId: number; receiptItemId: number; inventoryId: number; createdById: number; issueQuantity: number;
}): Promise<{ specificationStatus: "pending" | null }> {
  if (!input.purchaseOrderItemId) return { specificationStatus: null };
  const [item] = await rows(tx, sql`SELECT id,purchaseOrderId,reviewRole FROM purchase_order_items WHERE id=${input.purchaseOrderItemId}`);
  if (!item || Number(item.purchaseOrderId) !== Number(input.purchaseOrderId)) {
    throw new TRPCError({ code: "CONFLICT", message: "رابط صنف طلب الشراء في الاستلام غير صحيح" });
  }
  if (item.reviewRole !== CONSTRUCTION_SPECIFICATION_ROLE) return { specificationStatus: null };
  const [receipt] = await rows(tx, sql`SELECT ri.id,ri.purchaseOrderItemId,ri.inventoryId,r.status
    FROM warehouse_receipt_items ri JOIN warehouse_receipts r ON r.id=ri.receiptId
    WHERE ri.id=${input.receiptItemId} AND ri.receiptId=${input.receiptId}`);
  if (!receipt || receipt.status !== "confirmed" || Number(receipt.purchaseOrderItemId) !== Number(item.id)
    || Number(receipt.inventoryId) !== Number(input.inventoryId) || !(input.issueQuantity > 0)) {
    throw new TRPCError({ code: "CONFLICT", message: "لا تبدأ مطابقة المواصفات إلا لكمية مستلمة ومثبتة في سند الاستلام" });
  }
  return { specificationStatus: "pending" };
}

/** Distinct parent IDs and one RPC-local guard; no authorization cache survives the request. */
export async function loadSpecificationParentScopes(
  tx: any, actor: SpecificationActor, candidates: readonly any[], readGuard: PurchaseSpecificationPorts["readGuard"],
) {
  const orders = await readScopeChunks(candidates.map(row => Number(row.purchaseOrderId)), chunk =>
    rows(tx, sql`SELECT * FROM purchase_orders WHERE id IN (${ids(chunk)})`));
  const byId = new Map(orders.map(order => [Number(order.id), order]));
  const guard = await readGuard(actor, orders);
  return (row: any) => {
    const order = byId.get(Number(row.purchaseOrderId));
    if (!order) throw new TRPCError({ code: "FORBIDDEN", message: "طلب الشراء المرتبط بالمطابقة غير موجود" });
    guard(order);
    return order;
  };
}

// Each pending/rejected lot still belongs to the exact original receipt Inventory.
// An older lot in the same catalog book is not a member of this inspection.
const sourceFrom = sql`FROM inventory_lots l
  JOIN purchase_order_items pi ON pi.id=l.purchaseOrderItemId AND pi.purchaseOrderId=l.purchaseOrderId
  JOIN purchase_orders p ON p.id=pi.purchaseOrderId
  JOIN warehouse_receipt_items ri ON ri.id=l.receiptItemId AND ri.receiptId=l.receiptId AND ri.purchaseOrderItemId=pi.id
  JOIN warehouse_receipts r ON r.id=ri.receiptId
  JOIN inventory i ON i.id=ri.inventoryId
  JOIN inventory_lot_balances lb ON lb.lotId=l.id AND lb.inventoryId=i.id
  JOIN warehouses w ON w.id=i.warehouseId`;
const sourceColumns = sql`l.id,l.id AS lotId,l.specificationRevision AS revision,l.specificationStatus AS status,
  l.purchaseOrderId,p.poNumber,l.purchaseOrderItemId,pi.itemName,l.originalQuantity AS quantity,
  l.issueUnit AS unit,l.receiptId,l.receiptItemId,r.receiptNumber,i.warehouseId,w.nameAr AS warehouseName,
  i.id AS inventoryId,l.lotCode,l.trackingToken,r.vendorName AS supplierName,r.invoiceNumber,
  l.createdAt AS receivedAt,pi.purchasedPhotoUrl,pi.invoicePhotoUrl,pi.warehousePhotoUrl,
  l.specificationNotes AS notes,l.specificationReviewedAt AS decidedAt,l.specificationReviewedById AS decidedById,
  lb.quantity AS remainingReturnableQuantity`;
const sourceCondition = sql`pi.reviewRole=${CONSTRUCTION_SPECIFICATION_ROLE} AND r.status='confirmed' AND l.sourceType='receipt'`;

function dto(row: any) {
  const numeric = ["id", "lotId", "revision", "purchaseOrderId", "purchaseOrderItemId", "quantity", "receiptId", "receiptItemId", "warehouseId", "inventoryId", "remainingReturnableQuantity"];
  return { ...row, ...Object.fromEntries(numeric.map(key => [key, Number(row[key])])) };
}

// Apply the existing PO visibility policy before COUNT/pagination too. The
// batched parent guard below remains the independent record-level check.
function listParentScope(actor: SpecificationActor) {
  if ((BYPASS_ALL_ROLES as readonly string[]).includes(actor.role)) return sql`1=1`;
  const policy = VISIBILITY_POLICY[actor.role];
  if (policy?.kind === "all") return sql`1=1`;
  if (actor.role !== "warehouse" || policy?.kind !== "status_range") {
    throw new TRPCError({ code: "FORBIDDEN", message: "نطاق قراءة المطابقة غير معرّف لهذا الدور" });
  }
  const visibleStatus = policy.excludedStatuses.length
    ? sql`p.status NOT IN (${sql.join(policy.excludedStatuses.map(status => sql`${status}`), sql`,`)})`
    : sql`1=1`;
  const own = canPerformAction("create", { role: actor.role, userId: actor.id, isActive: actor.isActive })
    ? sql`p.requestedById=${actor.id}` : sql`1=0`;
  return sql`(${visibleStatus} OR ${own})`;
}

export class PurchaseSpecificationsService {
  constructor(private ports: PurchaseSpecificationPorts) {}
  status(actor: SpecificationActor) {
    if (!canReviewPurchaseSpecifications(actor) && !canReadSpecificationReturns(actor)) capability(actor, "review");
    return { enabled: true };
  }
  list(actor: SpecificationActor, rawInput: unknown) { return this.listRows(actor, rawInput, "review"); }
  rejectedReturns(actor: SpecificationActor, rawInput: unknown) { return this.listRows(actor, rawInput, "returns"); }
  private async listRows(actor: SpecificationActor, rawInput: unknown, mode: "review" | "returns") {
    capability(actor, mode);
    const input = specificationListInput.parse(rawInput);
    const db = await this.ports.database();
    if (!db) throw Error("قاعدة البيانات غير متاحة");
    const live = await currentActor(db, actor, mode);
    const state = mode === "review" ? "pending" : "rejected";
    const search = input.search ? `%${input.search}%` : null;
    const searchCondition = search ? sql`AND (pi.itemName LIKE ${search} OR p.poNumber LIKE ${search} OR l.lotCode LIKE ${search} OR r.vendorName LIKE ${search})` : sql``;
    const condition = sql`${sourceCondition} AND ${listParentScope(live)} AND l.specificationStatus=${state} AND lb.quantity>0 AND l.remainingQuantity>0 ${searchCondition}`;
    const [count] = await rows(db, sql`SELECT COUNT(*) AS total ${sourceFrom} WHERE ${condition}`);
    const selected = await rows(db, sql`SELECT ${sourceColumns} ${sourceFrom} WHERE ${condition}
      ORDER BY l.createdAt DESC,l.id DESC LIMIT ${input.pageSize} OFFSET ${(input.page - 1) * input.pageSize}`);
    if (!selected.length) return { rows: [], total: Number(count?.total || 0), page: input.page, pageSize: input.pageSize };
    const authorize = await loadSpecificationParentScopes(db, live, selected, this.ports.readGuard);
    const visible = selected.filter(row => {
      try { authorize(row); return true; }
      catch (error) { if (error instanceof TRPCError && error.code === "FORBIDDEN") return false; throw error; }
    });
    return { rows: visible.map(dto), total: Number(count?.total || 0), page: input.page, pageSize: input.pageSize };
  }
  async rejectedReturnSource(actor: SpecificationActor, id: number) {
    capability(actor, "returns");
    const db = await this.ports.database();
    if (!db) throw Error("قاعدة البيانات غير متاحة");
    const live = await currentActor(db, actor, "returns");
    const [row] = await rows(db, sql`SELECT ${sourceColumns} ${sourceFrom} WHERE l.id=${id} AND ${sourceCondition}
      AND l.specificationStatus='rejected' AND lb.quantity>0 AND l.remainingQuantity>0`);
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "الصنف المرفوض غير متاح للإرجاع أو اكتمل إرجاع كميته" });
    const authorize = await loadSpecificationParentScopes(db, live, [row], this.ports.readGuard);
    authorize(row);
    return dto(row);
  }
  async decide(actor: SpecificationActor, rawInput: unknown) {
    capability(actor, "review");
    const input = specificationDecisionInput.parse(rawInput);
    const db = await this.ports.database();
    if (!db) throw Error("قاعدة البيانات غير متاحة");
    return db.transaction(async (tx: any) => {
      const live = await currentActor(tx, actor, "review", true);
      const [lot] = await rows(tx, sql`SELECT id,specificationStatus,specificationRevision FROM inventory_lots WHERE id=${input.id} FOR UPDATE`);
      if (!lot) throw new TRPCError({ code: "NOT_FOUND", message: "دفعة المطابقة غير موجودة" });
      if (lot.specificationStatus !== "pending" || Number(lot.specificationRevision) !== input.revision) {
        throw new TRPCError({ code: "CONFLICT", message: "سبق اتخاذ قرار أو تغيرت بيانات المطابقة؛ حدّث القائمة" });
      }
      const [row] = await rows(tx, sql`SELECT ${sourceColumns} ${sourceFrom} WHERE l.id=${input.id} AND ${sourceCondition}`);
      if (!row) throw new TRPCError({ code: "FORBIDDEN", message: "دفعة الاستلام لا تخص صنفًا موجّهًا للإنشاءات" });
      const authorize = await loadSpecificationParentScopes(tx, live, [row], this.ports.readGuard);
      authorize(row);
      const notes = input.notes?.trim() || null;
      const result = await tx.execute(sql`UPDATE inventory_lots SET specificationStatus=${input.decision},
        specificationRevision=specificationRevision+1,specificationReviewedById=${live.id},specificationReviewedAt=CURRENT_TIMESTAMP,specificationNotes=${notes}
        WHERE id=${input.id} AND specificationStatus='pending' AND specificationRevision=${input.revision}`);
      if (Number(result?.[0]?.affectedRows) !== 1) throw new TRPCError({ code: "CONFLICT", message: "تغير قرار المطابقة أثناء الحفظ" });
      await tx.execute(sql`INSERT INTO audit_logs(userId,action,entityType,entityId,newValues)
        VALUES (${live.id},${`specification_${input.decision}`},'inventory_lot',${input.id},${JSON.stringify({ purchaseOrderId: row.purchaseOrderId, purchaseOrderItemId: row.purchaseOrderItemId, receiptId: row.receiptId, receiptItemId: row.receiptItemId, status: input.decision, notes, quantity: Number(row.quantity), unit: row.unit })})`);
      return { id: input.id, status: input.decision, revision: input.revision + 1 };
    });
  }
}

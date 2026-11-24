import { sql } from "drizzle-orm";
import { readScopeChunks } from "../_core/authz/read-batch";
import { loadEmergencyItemStates } from "./emergency-purchases/service";

export type SpecificationMovementKind = "issue" | "transfer" | "supplier_return" | "disposal";

function validId(value: unknown): number {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error("معرف دفعة مطابقة المواصفات غير صالح");
  return id;
}

async function readRows(tx: any, query: any): Promise<any[]> {
  const result = await tx.execute(query);
  if (!Array.isArray(result?.[0])) throw new Error("تعذر التحقق من مطابقة مواصفات الدفعة");
  return result[0];
}

function permitted(status: unknown, kind: SpecificationMovementKind): boolean {
  if (status === null || status === "approved") return true;
  return status === "rejected" && kind === "supplier_return";
}

const emergencyHoldMessage = "الدفعة مرتبطة بشراء طارئ بانتظار اعتماد الحسابات والإدارة العليا";

export async function loadEmergencyHolds(tx: any, sourceItemIds: number[]) {
  const states = await loadEmergencyItemStates(tx, sourceItemIds.filter(id => Number.isSafeInteger(id) && id > 0));
  return new Set(Array.from(states.entries()).filter(([, state]) => !state.approved).map(([id]) => id));
}

/** Fresh, locked check at the physical writer; callers cannot authorize from a list snapshot. */
export async function assertSpecificationLotMovement(
  tx: any,
  input: { lotId: number; kind: SpecificationMovementKind },
): Promise<void> {
  const lotId = validId(input.lotId);
  const [lot] = await readRows(tx, sql`SELECT id,specificationStatus,purchaseOrderItemId FROM inventory_lots WHERE id=${lotId} FOR UPDATE`);
  if (!lot) throw new Error("دفعة مطابقة المواصفات غير موجودة");
  if (permitted(lot.specificationStatus, input.kind)) {
    if ((await loadEmergencyHolds(tx, [Number(lot.purchaseOrderItemId)])).size) throw new Error(emergencyHoldMessage);
    return;
  }
  if (lot.specificationStatus === "pending") throw new Error("الدفعة بانتظار مطابقة المواصفات من مدير الإنشاءات؛ لا يمكن التصرف بها قبل القرار");
  if (lot.specificationStatus === "rejected") throw new Error("الدفعة مرفوضة في مطابقة المواصفات؛ يمكن إرجاعها للمورد فقط");
  throw new Error("حالة مطابقة مواصفات الدفعة غير صالحة؛ لا يمكن تنفيذ الحركة");
}

/** Read-only selection filter. Scope belongs to this call and grows by distinct 500-ID chunks. */
export async function filterSpecificationLots<T>(
  tx: any,
  lots: T[],
  getId: (row: T) => number = row => Number((row as any).lotId ?? (row as any).id),
  kind: SpecificationMovementKind = "issue",
): Promise<T[]> {
  const ids = lots.map(row => validId(getId(row)));
  const statuses = await readScopeChunks(ids, chunk => readRows(tx,
    sql`SELECT id,specificationStatus,purchaseOrderItemId FROM inventory_lots WHERE id IN (${sql.join(chunk.map(id => sql`${id}`), sql`,`)})`));
  const specificationEligible = statuses.filter(row => permitted(row.specificationStatus, kind));
  const holds = await loadEmergencyHolds(tx, specificationEligible.map(row => Number(row.purchaseOrderItemId)));
  const allowed = new Set(specificationEligible.filter(row => !holds.has(Number(row.purchaseOrderItemId))).map(row => Number(row.id)));
  return lots.filter((_, index) => allowed.has(ids[index]));
}

/** Disabling Lots cannot expose a held physical receipt through an aggregate-only writer. */
export async function assertNoSpecificationAggregateBypass(tx: any, inventoryId: number): Promise<void> {
  const id = validId(inventoryId);
  const lots = await readRows(tx, sql`SELECT l.id,l.specificationStatus,l.purchaseOrderItemId FROM inventory_lots l
    JOIN inventory_lot_balances b ON b.lotId=l.id
    WHERE b.inventoryId=${id} AND b.quantity>0
      AND (l.purchaseOrderItemId IS NOT NULL OR l.specificationStatus IN ('pending','rejected'))
    ORDER BY l.id FOR UPDATE`);
  if (lots.some(lot => ["pending", "rejected"].includes(lot.specificationStatus))) {
    throw new Error("يوجد رصيد خاضع لمطابقة المواصفات؛ يجب تفعيل تتبع اللوتات واختيار دفعة مسموحة قبل التصرف بالمخزون");
  }
  if ((await loadEmergencyHolds(tx, lots.map(lot => Number(lot.purchaseOrderItemId)))).size) throw new Error(emergencyHoldMessage);
}

/** An old compatible lot cannot mark a different, held purchase line delivered. */
export async function assertSpecificationPurchaseItemCompletion(tx: any, purchaseOrderItemId: number): Promise<void> {
  const id = validId(purchaseOrderItemId);
  if ((await loadEmergencyHolds(tx, [id])).size) throw new Error(emergencyHoldMessage);
  const rows = await readRows(tx, sql`SELECT l.id FROM inventory_lots l
    JOIN inventory_lot_balances b ON b.lotId=l.id
    WHERE l.purchaseOrderItemId=${id} AND b.quantity>0 AND l.specificationStatus IN ('pending','rejected')
    LIMIT 1 FOR UPDATE`);
  if (rows.length) throw new Error("لا يمكن إكمال تسليم صنف طلب الشراء قبل مطابقة المواصفات؛ عالج قرار الإنشاءات أو المرتجع أولًا");
}

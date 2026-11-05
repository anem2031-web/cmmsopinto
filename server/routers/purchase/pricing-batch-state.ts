import * as db from "../../_core/db";
import { isObserverReadScope } from "../../_core/authz/observer-read-scope";

const TERMINAL_ITEM_STATUSES = new Set(["cancelled", "rejected"]);
const PENDING_BATCH_STATUSES = new Set(["pending_accounting", "pending_management"]);

export function isTerminalPricingItem(item: { status: string }): boolean {
  return TERMINAL_ITEM_STATUSES.has(item.status);
}

export function getActivePricingBatchItems<T extends { status: string }>(items: T[]): T[] {
  return items.filter((item) => !isTerminalPricingItem(item));
}

/**
 * يغلق أي دفعة معلّقة لم يعد فيها أي صنف فعّال.
 *
 * السبب في وجود هذا التزامن المركزي: إلغاء آخر صنف داخل دفعة كان يترك سجل
 * الدفعة بحالة pending_accounting/pending_management، فتستمر أزرار الاعتماد
 * بالظهور رغم أن الدفعة لا تحتوي شيئًا يمكن اعتماده. نستخدم حالة rejected
 * الموجودة أصلًا في الجدول كحالة نهائية للدفعة، مع سبب واضح بأنها أُغلقت
 * تلقائيًا بسبب إلغاء/رفض جميع أصنافها.
 */
export async function rejectEmptyPendingPricingBatches(
  purchaseOrderId: number,
  options?: {
    actorId?: number | null;
    actorName?: string | null;
    reason?: string;
    allowedBatchIds?: readonly number[];
  }
): Promise<number[]> {
  if (isObserverReadScope()) return [];
  const [items, batches] = await Promise.all([
    db.getPOItems(purchaseOrderId),
    db.getPOPricingBatches(purchaseOrderId),
  ]);

  const rejectedBatchIds: number[] = [];
  const defaultReason = options?.reason ||
    `أُغلقت الدفعة تلقائيًا لأن جميع أصنافها أُلغيت أو رُفضت${options?.actorName ? ` — آخر إجراء بواسطة ${options.actorName}` : ""}`;

  for (const batch of batches) {
    if (options?.allowedBatchIds && !options.allowedBatchIds.includes(Number(batch.id))) continue;
    if (!PENDING_BATCH_STATUSES.has(batch.status)) continue;

    const batchItems = items.filter((item) => item.batchId === batch.id);
    // الدفعة الفارغة أو التي لم يعد فيها أي صنف فعّال لا يجوز اعتمادها.
    if (batchItems.length > 0 && getActivePricingBatchItems(batchItems).length > 0) continue;

    await db.updatePOPricingBatch(batch.id, {
      status: "rejected",
      rejectedAt: new Date(),
      rejectionReason: defaultReason,
      ...(options?.actorId ? { rejectedById: options.actorId } : {}),
    });
    rejectedBatchIds.push(batch.id);
  }

  return rejectedBatchIds;
}

/** دفاع أخير داخل مسارات الاعتماد ضد الروابط القديمة أو البيانات السابقة. */
export async function rejectPricingBatchIfEmpty(
  batch: { id: number; purchaseOrderId: number; status: string },
  options?: { actorId?: number | null; actorName?: string | null }
): Promise<boolean> {
  const items = (await db.getPOItems(batch.purchaseOrderId)).filter((item) => item.batchId === batch.id);
  if (items.length > 0 && getActivePricingBatchItems(items).length > 0) return false;

  if (PENDING_BATCH_STATUSES.has(batch.status)) {
    await db.updatePOPricingBatch(batch.id, {
      status: "rejected",
      rejectedAt: new Date(),
      rejectionReason: `أُغلقت الدفعة تلقائيًا لأنها لا تحتوي أصنافًا فعّالة${options?.actorName ? ` — بواسطة ${options.actorName}` : ""}`,
      ...(options?.actorId ? { rejectedById: options.actorId } : {}),
    });
  }
  return true;
}

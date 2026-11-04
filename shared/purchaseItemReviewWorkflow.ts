import { isPendingPurchaseItemReview, isRoutedPurchaseItem, type PurchaseReviewItem } from "./purchase-item-review";

export type PurchaseReviewWorkflowItem = PurchaseReviewItem & { batchId?: number | null };
export type PurchaseReviewWorkflowBatch = { id: number; status: string };

export function pendingPurchaseReviewCount(items: readonly PurchaseReviewItem[]): number {
  return items.filter(isPendingPurchaseItemReview).length;
}

/** A routed item only enters the existing delegate workflow after a real review. */
export function hasCommittedPurchaseItemReview(item: PurchaseReviewItem): boolean {
  return isRoutedPurchaseItem(item) && Number.isSafeInteger(item.reviewedById) && Number(item.reviewedById) > 0 && !!item.reviewedAt && item.status !== "pending_review";
}

/** Existing PO stages stay a summary; no item, batch, approval or link is changed. */
export function deriveRoutedPurchaseOrderStage(currentStatus: string, items: readonly PurchaseReviewWorkflowItem[], batches?: readonly PurchaseReviewWorkflowBatch[]): string {
  if (!items.some(isRoutedPurchaseItem) || ["draft", "closed", "rejected", "revision_needed"].includes(currentStatus)) return currentStatus;
  const active = items.filter(item => !["rejected", "cancelled"].includes(item.status || ""));
  if (!active.length) return "rejected";
  const activeBatchIds = new Set(active.map(item => Number(item.batchId)).filter(id => Number.isSafeInteger(id) && id > 0));
  if (batches) {
    const pending = batches.filter(batch => activeBatchIds.has(Number(batch.id)));
    if (pending.some(batch => batch.status === "pending_accounting")) return "pending_accounting";
    if (pending.some(batch => batch.status === "pending_management")) return "pending_management";
  } else if (activeBatchIds.size && ["pending_accounting", "pending_management"].includes(currentStatus)) {
    // Missing batch metadata is not evidence that a financial stage completed.
    return currentStatus;
  }
  const received = (item: PurchaseReviewWorkflowItem) => ["delivered_to_warehouse", "delivered_to_requester"].includes(item.status || "");
  const purchased = (item: PurchaseReviewWorkflowItem) => item.status === "purchased" || received(item);
  if (active.every(received)) return "received";
  if (active.every(purchased)) return "purchased";
  if (active.some(purchased)) return "partial_purchase";
  if (active.some(item => !item.batchId && ["pending", "estimated"].includes(item.status || ""))) return "pending_estimate";
  if (active.some(item => ["approved", "funded"].includes(item.status || ""))) return "approved";
  if (active.some(isPendingPurchaseItemReview)) return "pending_review";
  return currentStatus;
}

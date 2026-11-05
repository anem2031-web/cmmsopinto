import { isRoutedPurchaseItem } from "./purchase-item-review";
import { deriveRoutedPurchaseOrderStage, type PurchaseReviewWorkflowItem, type PurchaseReviewWorkflowBatch } from "./purchaseItemReviewWorkflow";

type StageItem = PurchaseReviewWorkflowItem & { estimatedTotalCost?: string | number | null };

/** A PO header summarizes its actual batches; it never grants a batch approval. */
export function summarizePurchasePricingStage(currentStatus: string, items: readonly StageItem[], batches: readonly PurchaseReviewWorkflowBatch[]) {
  if (!items.length || ["draft", "closed", "rejected", "revision_needed"].includes(currentStatus)) return { status: currentStatus };
  const active = items.filter(item => !["rejected", "cancelled"].includes(item.status || ""));
  if (!active.length) return { status: "rejected" };
  const batchIds = new Set(active.map(item => Number(item.batchId)).filter(id => Number.isSafeInteger(id) && id > 0));
  const actual = batches.filter(batch => batchIds.has(Number(batch.id)));
  if (actual.some(batch => batch.status === "pending_accounting")) return { status: "pending_accounting" };
  if (actual.some(batch => batch.status === "pending_management")) return { status: "pending_management" };
  // A missing batch is not evidence that a prior financial decision completed.
  if (Array.from(batchIds).some(id => !actual.some(batch => Number(batch.id) === id))) return { status: currentStatus };
  if (items.some(isRoutedPurchaseItem)) return { status: deriveRoutedPurchaseOrderStage(currentStatus, items, batches) };
  const received = (item: StageItem) => ["delivered_to_warehouse", "delivered_to_requester"].includes(item.status || "");
  const purchased = (item: StageItem) => item.status === "purchased" || received(item);
  if (active.every(received)) return { status: "received" };
  if (active.every(purchased)) return { status: "purchased" };
  if (active.some(purchased)) return { status: "partial_purchase" };
  // Preserve the historical whole-PO route only for genuinely unbatched quotes.
  const unbatchedQuotes = active.filter(item => !item.batchId && item.status === "estimated");
  if (unbatchedQuotes.length && active.every(item => !item.batchId && ["estimated", "needs_item_revision"].includes(item.status || ""))) {
    return { status: "pending_accounting", totalEstimatedCost: String(unbatchedQuotes.reduce((sum, item) => sum + Number(item.estimatedTotalCost || 0), 0)) };
  }
  if (active.some(item => !item.batchId && ["pending", "estimated"].includes(item.status || ""))) return { status: "pending_estimate" };
  if (active.some(item => ["approved", "funded"].includes(item.status || ""))) return { status: "approved" };
  return { status: currentStatus };
}

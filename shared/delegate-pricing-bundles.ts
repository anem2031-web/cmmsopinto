import { isRoutedPurchaseItem } from "./purchase-item-review";
import { hasCommittedPurchaseItemReview } from "./purchaseItemReviewWorkflow";
import { isDelegateRole } from "./delegate-role";

export const PRICING_BUNDLE_LIMIT = 20;
export function pricingBundleApprovalNotificationPath(eventKey:unknown):string|null {
  if(typeof eventKey!=='string')return null;const match=/^dpb_approval:([1-9][0-9]*)$/.exec(eventKey);
  if(!match||!Number.isSafeInteger(Number(match[1])))return null;
  return `/delegate-pricing-bundles?approval=${match[1]}`;
}
export type PricingBundleActor = { id: number; role: string; isActive: number; name?: string | null };
export type PricingBundleRow = {
  id: number; purchaseOrderId: number; poNumber: string; packageId: number | null;
  itemName: string; categoryName: string; sectionName: string; siteName: string;
  siteId: number | null; sectionId: number | null; ticketId: number | null; ticketItemId: number | null;
  quantity: number; unit: string; estimatedUnitCost: string; estimatedTotalCost: string;
  supplierName: string; delegateId: number; status: string;
  approvalRejectionReason?:string;
  reviewRole?: string;
  reviewedById?: number;
  reviewedAt?: string;
};
export type PricingBundleSnapshot = {
  number: string; submittedAt: string; delegate: { id: number; name: string; signature: string; signatureSource?: string | null };
  rows: PricingBundleRow[];
  /** New review metadata is scoped to the frozen included items; absent for historical snapshots. */
  reviewSignatureVersion?: 2;
  approvedTotal?:string;
  /** Download-only approved variant; never written over the delegate snapshot. */
  financialApprovals?: Array<{
    reference: string; poNumbers: string[]; accountingName: string; accountingAt: string;
    accountingSignature: string; managementName: string; managementAt: string; managementSignature?:string;
    custodyLabel: string; custodyValue: string | null; notes: string;
  }>;
  compensations?: Array<{
    planId: number; caseId: number; purchaseOrderItemId: number; originalPoNumber: string;
    originalBundleNumber: string | null; returnNumber: string; returnedQuantity: string;
    replacementQuantity: string; originalPurchaseValue: string; total: string;
    creditAllocated: string; additionalFunding: string;
  }>;
  signatures: Array<{
    purchaseOrderId: number;
    poNumber: string;
    requesterId?: number | null;
    requesterName: string;
    requesterSignature: string;
    reviewerId?: number | null;
    reviewerName: string;
    reviewerSignature: string;
    requesterSource?: string | null;
    reviewerSource?: string | null;
    purchaseOrderItemIds?: number[];
    reviewedAt?: string;
  }>;
};
export function canReadPricingBundles(actor: PricingBundleActor) {
  return actor.isActive === 1 && (isDelegateRole(actor.role) || ["owner", "admin", "accountant", "senior_management", "observer"].includes(actor.role));
}
export function assertBundleItemEligible(item: any, actorId: number) {
  const routed = isRoutedPurchaseItem(item);
  const blockedStatuses = routed ? ["draft", "closed", "rejected", "revision_needed"] : ["draft", "pending_review", "closed", "rejected", "revision_needed"];
  if (Number(item.delegateId) !== actorId || item.status !== "estimated" || item.batchId || item.delegateChangeRequestedAt || blockedStatuses.includes(item.purchaseOrderStatus)
    || routed && !hasCommittedPurchaseItemReview(item)) throw new Error("الصنف غير جاهز للإضافة أو لم يعد مسندًا إليك");
  const unit = Number(item.estimatedUnitCost), total = Number(item.estimatedTotalCost), quantity = Number(item.quantity);
  if (![unit, total, quantity].every(Number.isFinite) || unit <= 0 || total <= 0 || quantity <= 0 || Math.abs(Math.round(unit * quantity * 100) - Math.round(total * 100)) > 0) throw new Error("احفظ تسعيرًا صحيحًا للصنف قبل إضافته للحزمة");
}

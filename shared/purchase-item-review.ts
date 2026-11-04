import { z } from "zod";

export const PURCHASE_REVIEW_ROLES = ["general_maintenance_manager", "construction_procurement_manager", "senior_management"] as const;
export type PurchaseReviewRole = typeof PURCHASE_REVIEW_ROLES[number];
export const purchaseReviewRoleSchema = z.enum(PURCHASE_REVIEW_ROLES);

export type PurchaseReviewActor = { id: number; role: string; isActive?: number | boolean | null };
export type PurchaseReviewItem = {
  reviewRole?: string | null;
  reviewedById?: number | null;
  reviewedAt?: Date | string | null;
  status?: string;
};

export function isRoutedPurchaseItem(item: PurchaseReviewItem): boolean {
  return PURCHASE_REVIEW_ROLES.includes(item.reviewRole as PurchaseReviewRole);
}

export function isPendingPurchaseItemReview(item: PurchaseReviewItem): boolean {
  return isRoutedPurchaseItem(item) && item.status === "pending_review" && item.reviewedById == null && item.reviewedAt == null;
}

function activeActor(actor: PurchaseReviewActor | null | undefined): actor is PurchaseReviewActor {
  return !!actor && Number.isSafeInteger(actor.id) && actor.id > 0 && (actor.isActive === 1 || actor.isActive === true);
}

export function canReviewPurchaseItem(actor: PurchaseReviewActor | null | undefined, item: PurchaseReviewItem): boolean {
  return activeActor(actor) && isPendingPurchaseItemReview(item)
    && (["owner", "admin"].includes(actor.role) || actor.role === item.reviewRole);
}

/** Workflow stage checks remain at the action boundary; legacy items use the existing guard. */
export function canResolvePurchaseItemReviewer(actor: PurchaseReviewActor | null | undefined, item: PurchaseReviewItem): boolean {
  return activeActor(actor) && isRoutedPurchaseItem(item)
    && (["owner", "admin"].includes(actor.role) || actor.role === item.reviewRole && actor.id === Number(item.reviewedById));
}

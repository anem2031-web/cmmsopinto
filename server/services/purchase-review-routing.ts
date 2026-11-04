import { TRPCError } from "@trpc/server";
import { PURCHASE_REVIEW_ROLES, isRoutedPurchaseItem } from "../../shared/purchase-item-review";
import { hasCommittedPurchaseItemReview } from "../../shared/purchaseItemReviewWorkflow";

/** Form saves and submissions require a route; legacy and automatic writers stay intact. */
export function requirePurchaseReviewSelection(items: Array<{ reviewRole?: string | null; status?: string; itemName?: string }>) {
  items.forEach((item, index) => {
    if (["cancelled", "rejected"].includes(item.status || "")) return;
    if (!isRoutedPurchaseItem(item)) throw new TRPCError({
      code: "BAD_REQUEST", message: `اختر جهة المراجعة للصنف ${index + 1}: ${item.itemName || ""}`,
    });
  });
}

/** One user-directory read per submission; no per-item or per-recipient authorization reads. */
export function purchaseReviewRecipients(users: Array<{ id: number; role: string; isActive?: unknown }>, items: Array<{ reviewRole?: string | null }>, actorId: number) {
  const roles = new Set(items.filter(isRoutedPurchaseItem).map(item => item.reviewRole));
  return users.filter(user => user.id !== actorId && Number(user.isActive) === 1 &&
    (roles.has(user.role as typeof PURCHASE_REVIEW_ROLES[number]) || ["owner", "admin"].includes(user.role)));
}

/** A routed request is never returned wholesale after its items can proceed independently. */
export function assertNoWholeOrderRevisionOfRoutedItems(items: Array<{ reviewRole?: string | null }>) {
  if (items.some(isRoutedPurchaseItem)) throw new TRPCError({
    code: "BAD_REQUEST", message: "هذا الطلب يُراجع على مستوى الأصناف؛ استخدم طلب مراجعة الصنف حتى لا تتأثر بقية الأصناف",
  });
}

export function assertRoutedPurchaseItemReady(order: { status: string }, item: Parameters<typeof hasCommittedPurchaseItemReview>[0]) {
  if (item.reviewRole != null && (!hasCommittedPurchaseItemReview(item) || ["draft", "closed", "rejected", "revision_needed"].includes(order.status))) {
    throw new TRPCError({ code: "FORBIDDEN", message: "يجب اكتمال مراجعة الصنف وإرساله للمندوب قبل متابعة التسعير أو الاعتماد" });
  }
}

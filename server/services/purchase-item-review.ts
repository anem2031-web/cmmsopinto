import { TRPCError } from "@trpc/server";
import { canReviewPurchaseItem, isRoutedPurchaseItem, type PurchaseReviewActor, type PurchaseReviewItem } from "../../shared/purchase-item-review";

type Actor = PurchaseReviewActor & { name?: string | null; signatureUrl?: string | null };
type Item = PurchaseReviewItem & { id: number; purchaseOrderId: number; itemName: string; delegateId?: number | null; reviewerSignatureSnapshot?: string | null; [key: string]: any };
type Order = { id: number; status: string; reviewedById?: number | null; reviewedAt?: Date | string | null; reviewerSignatureSnapshot?: string | null; [key: string]: any };
export type PurchaseItemReviewDecision = { id: number; action: "approve" | "reject"; delegateId?: number; rejectionReason?: string };
export type PurchaseItemReviewPort = {
  lockOrder(id: number): Promise<Order | null>;
  readItems(id: number): Promise<Item[]>;
  readUsers(ids: number[]): Promise<Actor[]>;
  authorize(actor: Actor, order: Order, items: Item[]): Promise<void> | void;
  updateItem(item: Item, changes: Record<string, any>, actor: Actor): Promise<boolean>;
  updateOrder(id: number, changes: Record<string, any>): Promise<void>;
  audit(actor: Actor, order: Order, decisions: PurchaseItemReviewDecision[]): Promise<void>;
  now?(): Date;
};

/** Caller supplies one transaction. No database, configuration or environment imports. */
export async function reviewRoutedPurchaseItems(
  actor: PurchaseReviewActor,
  input: { poId: number; items: PurchaseItemReviewDecision[] },
  port: PurchaseItemReviewPort,
) {
  if (!input.items.length || input.items.length > 20 || new Set(input.items.map(item => item.id)).size !== input.items.length) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "اختر صنفًا واحدًا على الأقل دون تكرار، وبحد أقصى 20 صنفًا" });
  }
  const order = await port.lockOrder(input.poId);
  if (!order) throw new TRPCError({ code: "NOT_FOUND", message: "طلب الشراء غير موجود" });
  if (["draft", "closed", "rejected", "revision_needed"].includes(order.status)) {
    throw new TRPCError({ code: "CONFLICT", message: "طلب الشراء غير متاح لمراجعة الأصناف في حالته الحالية" });
  }
  const allItems = await port.readItems(order.id);
  const byId = new Map(allItems.map(item => [Number(item.id), item]));
  const selected = input.items.map(decision => {
    const item = byId.get(decision.id);
    if (!item || Number(item.purchaseOrderId) !== order.id || !isRoutedPurchaseItem(item)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "أحد الأصناف غير موجود أو لا ينتمي إلى مراجعة هذا الطلب" });
    }
    return item;
  });
  const users = await port.readUsers(Array.from(new Set([actor.id, ...input.items.flatMap(decision => decision.action === "approve" && decision.delegateId ? [decision.delegateId] : [])])).sort((a, b) => a - b));
  const liveActor = users.find(user => user.id === actor.id);
  if (!liveActor || liveActor.role !== actor.role || !selected.every(item => canReviewPurchaseItem(liveActor, item))) {
    throw new TRPCError({ code: "FORBIDDEN", message: "لا يمكنك مراجعة هذه الأصناف أو سبق حسمها" });
  }
  await port.authorize(liveActor, order, selected);
  const decisions = input.items.map(decision => ({ ...decision, rejectionReason: decision.rejectionReason?.trim() }));
  for (const decision of decisions) {
    if (decision.action === "approve") {
      const delegate = users.find(user => user.id === decision.delegateId);
      if (!delegate || delegate.role !== "delegate" || !(delegate.isActive === 1 || delegate.isActive === true)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "يجب اختيار مندوب نشط لكل صنف موافق عليه" });
      }
    } else if (decision.action !== "reject" || !decision.rejectionReason) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "سبب الرفض إلزامي لكل صنف مرفوض" });
    }
  }
  const decidedAt = (port.now?.() || new Date()).toISOString().slice(0, 19).replace("T", " ");
  const rejectedEvents: Array<{ itemId: number; itemName: string; reason: string }> = [];
  const approvedItems: Item[] = [];
  for (const decision of decisions) {
    const item = byId.get(decision.id)!;
    const changes = {
      status: decision.action === "approve" ? "pending" : "rejected",
      reviewedById: liveActor.id, reviewedAt: decidedAt, reviewerSignatureSnapshot: liveActor.signatureUrl || null,
      ...(decision.action === "approve" ? { delegateId: decision.delegateId, delegateAssignedAt: decidedAt, managementRejectionReason: null }
        : { managementRejectionReason: decision.rejectionReason }),
    };
    if (!await port.updateItem(item, changes, liveActor)) {
      throw new TRPCError({ code: "CONFLICT", message: `تغيّرت حالة الصنف "${item.itemName}" أثناء المراجعة؛ حدّث الصفحة` });
    }
    const updated = { ...item, ...changes };
    byId.set(item.id, updated);
    if (decision.action === "approve") approvedItems.push(updated);
    else rejectedEvents.push({ itemId: item.id, itemName: item.itemName, reason: decision.rejectionReason! });
  }
  const resultingItems = Array.from(byId.values());
  const routed = resultingItems.filter(isRoutedPurchaseItem);
  const allRejected = resultingItems.length > 0 && resultingItems.every(item => ["rejected", "cancelled"].includes(item.status || ""));
  const allReviewed = routed.length > 0 && routed.every(item => item.reviewedById != null && item.reviewedAt != null || item.status === "cancelled");
  const changes: Record<string, any> = {};
  if (allRejected) Object.assign(changes, { status: "rejected", rejectedById: liveActor.id, rejectedAt: decidedAt, rejectionReason: `تم رفض جميع الأصناف بواسطة ${liveActor.name || "المراجع"}` });
  else if (order.status === "pending_review" && approvedItems.length > 0) changes.status = "pending_estimate";
  if (allReviewed && !order.reviewedAt) {
    changes.reviewedAt = decidedAt;
    const reviewers = new Set(routed.map(item => item.reviewedById).filter(id => id != null));
    // A header with several reviewers is a summary, never a substitute reviewer.
    if (!order.reviewedById && reviewers.size === 1) {
      changes.reviewedById = Array.from(reviewers)[0];
      if (!order.reviewerSignatureSnapshot) changes.reviewerSignatureSnapshot = routed.find(item => item.reviewerSignatureSnapshot)?.reviewerSignatureSnapshot || null;
    }
  }
  if (Object.keys(changes).length) await port.updateOrder(order.id, changes);
  await port.audit(liveActor, order, decisions);
  return { allRejected, hasApproved: approvedItems.length > 0, rejectedEvents, approvedItems };
}

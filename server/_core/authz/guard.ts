/**
 * ══════════════════════════════════════════════════════════════════════════
 * الحارس المركزي لطلبات الشراء — الطبقة 3: نقطة التنفيذ (Guard / PEP)
 * ══════════════════════════════════════════════════════════════════════════
 *
 * هذا هو الملف الوحيد اللي الراوترات تستورد منه فعليًا. يجمع بين:
 *  - policy.ts  (البيانات: من المسموح له بماذا)
 *  - engine.ts  (القرار النقي: هل هذا مسموح؟)
 *  - استعلامات DB الصغيرة المطلوبة لتغذية القرار (معرّفات المندوب/المساعدين)
 *
 * الهدف: يستبدل كل الأنماط المتكررة يدويًا بكل ملف راوتر (isAdminOrOwner،
 * تكرار فحص الدور، تكرار جلب assistantIds/delegate items) باستدعاء واحد.
 */

import * as db from "../db";
import { isDelegateRole } from "../../../shared/delegate-role";
import { TRPCError } from "@trpc/server";
import { canReviewPurchaseItem, canResolvePurchaseItemReviewer, isRoutedPurchaseItem } from "../../../shared/purchase-item-review";
import {
  assertCanPerformAction,
  assertCanPerformItemAction,
  assertCanPerformItemStatusAction,
  assertCanResolveCreatorReturnedItem,
  assertCanRequestPOItemDelegateChange,
  assertCanResolvePOItemDelegateChange,
  assertItemAssignedToDelegate,
  assertPOVisible,
  isItemAssignedToDelegate,
  isPOVisible,
  type ActionContext,
  type DelegateChangeSubject,
  type ItemActionSubject,
  type POActionSubject,
  type POVisibilitySubject,
  type VisibilityContext,
} from "./engine";
import { ROUTED_REVIEW_BLOCKED_PO_STATUSES, type ActionName } from "./policy";
import { groupLegacyPricingBatchReadScopes } from "./legacy-pricing-batch-read";

export type { ActionName } from "./policy";
export { PO_STATUS } from "./policy";

interface MinimalCtxUser {
  id: number;
  role: string;
  isActive?: number | boolean | null;
}

/**
 * يبني VisibilityContext كاملًا (بما فيه استعلامات DB الإضافية المطلوبة فقط
 * للأدوار التي تحتاجها: food_warehouse_manager و delegate). لباقي الأدوار
 * لا يوجد أي استعلام إضافي — صفر تكلفة أداء زائدة.
 */
async function buildVisibilityContext(user: MinimalCtxUser): Promise<VisibilityContext> {
  const ctx: VisibilityContext = { role: user.role, userId: user.id };

  if (user.role === "food_warehouse_manager") {
    ctx.assistantUserIds = await db.getUserIdsByRole("food_warehouse_assistant");
  }
  if (isDelegateRole(user.role)) {
    const items = await db.getPOItemsByDelegate(user.id);
    ctx.delegateAssignedPoIds = Array.from(new Set(items.map((i: any) => i.purchaseOrderId)));
  }

  return ctx;
}

/**
 * يُستخدم من getById(): يجلب ما يلزم من DB ثم يتحقق من الرؤية، ويرمي
 * FORBIDDEN تلقائيًا إن لم تكن مسموحة.
 */
export async function assertCanViewPurchaseOrder(user: MinimalCtxUser, po: POVisibilitySubject): Promise<void> {
  (await createPurchaseOrderReadScope(user, [po])).assert(po);
}

/** One read-list operation, one visibility context. Never retain across requests
 * or use a previously constructed reader to authorize a write/download. */
export async function createPurchaseOrderReadGuard(user: MinimalCtxUser, orders?: readonly POVisibilitySubject[]) {
  return (await createPurchaseOrderReadScope(user, orders)).assert;
}

/** Share one context between list filtering and per-document checks in the RPC. */
export async function createPurchaseOrderReadScope(user: MinimalCtxUser, orders?: readonly POVisibilitySubject[]) {
  const visCtx = await buildVisibilityContext(user);
  const reviewRows = user.role === "senior_management" && (user.isActive === 1 || user.isActive === true)
    ? await db.getPurchaseItemReviewScopeRows(user, orders?.map(order => Number(order.id))) : [];
  const permittedReviewRows = reviewRows.filter((item: any) => canReviewPurchaseItem(user, item) || canResolvePurchaseItemReviewer(user, item));
  const scopedIds = new Set(permittedReviewRows.map((item: any) => Number(item.id)));
  const routedReviewPoIds = Array.from(new Set(permittedReviewRows.map((item: any) => Number(item.purchaseOrderId))));
  const extended = { ...visCtx, routedReviewPoIds };
  const isRoutedReviewOnly = (po: POVisibilitySubject) => !isPOVisible(visCtx, po) && isPOVisible(extended, po);
  const legacyRows = ["accountant", "senior_management"].includes(user.role) && (user.isActive === 1 || user.isActive === true)
    ? await db.getLegacyPricingBatchReadScopeRows(user, orders?.map(order => Number(order.id))) : [];
  const legacyApprovals = groupLegacyPricingBatchReadScopes(user, legacyRows);
  const legacyByOrder = new Map<number, typeof legacyApprovals>();
  for (const approval of legacyApprovals) {
    const current = legacyByOrder.get(approval.purchaseOrderId) ?? [];
    current.push(approval); legacyByOrder.set(approval.purchaseOrderId, current);
  }
  const legacyFor = (po: POVisibilitySubject) => (ROUTED_REVIEW_BLOCKED_PO_STATUSES as readonly string[]).includes(po.status)
    ? [] : legacyByOrder.get(Number(po.id)) ?? [];
  const canRead = (po: POVisibilitySubject) => isPOVisible(extended, po) || legacyFor(po).length > 0;
  const hasLimitedItemScope = (po: POVisibilitySubject) => !isPOVisible(visCtx, po) && canRead(po);
  const isLegacyApprovalOnly = (po: POVisibilitySubject) => !isPOVisible(extended, po) && legacyFor(po).length > 0;
  const projectOrder = <T extends POVisibilitySubject>(po: T): T => {
    if (!isLegacyApprovalOnly(po)) return po;
    const projected: any = { ...po };
    for (const field of Object.keys(projected)) {
      if (/^(accounting|management)/.test(field) || /SignatureSnapshot$/.test(field) ||
        ["totalEstimatedCost", "totalActualCost", "totalEstimatedText", "custodyAmount", "notes", "rejectedById", "rejectedAt", "rejectionReason"].includes(field)) projected[field] = null;
    }
    // These summaries describe all sibling lines, not just the granted batch.
    for (const field of ["itemNames", "itemNames_ar", "itemNames_en", "itemNames_ur", "delegateBreakdown"]) {
      if (field in projected) projected[field] = [];
    }
    if ("itemCount" in projected) projected.itemCount = new Set(legacyFor(po).flatMap(approval => approval.itemIds)).size;
    if ("delegateCount" in projected) projected.delegateCount = null;
    return projected;
  };
  const permittedItemIds = (po: POVisibilitySubject) => new Set([
    ...legacyFor(po).flatMap(approval => approval.itemIds),
    ...(isRoutedReviewOnly(po) ? Array.from(scopedIds) : []),
  ]);
  const filterItems = <T extends { id: number; purchaseOrderId?: number }>(po: POVisibilitySubject, items: T[]): T[] => {
    if (!canRead(po)) return [];
    if (!hasLimitedItemScope(po)) return items;
    const allowed = permittedItemIds(po);
    return items.filter(item => allowed.has(Number(item.id)) && Number(item.purchaseOrderId ?? po.id) === Number(po.id));
  };
  return {
    assert: (po: POVisibilitySubject): void => { if (!canRead(po)) assertPOVisible(extended, po); },
    filter: <T extends POVisibilitySubject>(orders: T[]): T[] => orders.filter(canRead).map(projectOrder),
    isRoutedReviewOnly,
    hasLimitedItemScope,
    isLegacyApprovalOnly,
    projectOrder,
    legacyApprovals,
    filterItems,
    filterComments: <T extends { purchaseOrderId?: number; purchaseOrderItemId?: number | null }>(po: POVisibilitySubject, comments: T[]): T[] => {
      if (!canRead(po)) return [];
      if (!hasLimitedItemScope(po)) return comments;
      const allowed = permittedItemIds(po), financeOnly = isLegacyApprovalOnly(po);
      return comments.filter(comment => Number(comment.purchaseOrderId ?? po.id) === Number(po.id) &&
        (comment.purchaseOrderItemId == null ? !financeOnly : allowed.has(Number(comment.purchaseOrderItemId))));
    },
    filterBatches: <T extends { id: number; purchaseOrderId?: number }>(po: POVisibilitySubject, batches: T[]): T[] => {
      if (!canRead(po)) return [];
      if (!hasLimitedItemScope(po)) return batches;
      // Existing early routed-review reads keep their pre-existing batch DTO.
      // The new finance exception is the only reason for narrowing this list.
      if (!isLegacyApprovalOnly(po)) return batches;
      const allowed = new Set(legacyFor(po).map(approval => approval.batchId));
      return batches.filter(batch => allowed.has(Number(batch.id)) && Number(batch.purchaseOrderId ?? po.id) === Number(po.id));
    },
  };
}

/**
 * يُستخدم من list(): يجلب ما يلزم من DB مرة واحدة، ثم يفلتر قائمة الطلبات
 * الكاملة لنفس النطاق **تمامًا** المستخدم بـgetById — هذا هو الضمان العملي
 * لتطابق نطاقي القائمة والتفاصيل (بند #3 بجدول الصلاحيات المعتمد).
 */
export async function filterVisiblePurchaseOrders<T extends POVisibilitySubject>(
  user: MinimalCtxUser,
  pos: T[]
): Promise<T[]> {
  return (await createPurchaseOrderReadScope(user, pos)).filter(pos);
}

/**
 * يُستخدم من أي إجراء (reject، approveAccounting، editItem، ...): يتحقق من
 * صلاحية تنفيذ الإجراء على طلب بحالته الحالية، ويرمي FORBIDDEN تلقائيًا.
 *
 * isCreator: يحدّده الراوتر بنفسه (عادة po.requestedById === ctx.user.id)
 * لأن الحارس لا يفترض شكل بيانات الطلب — فقط يستقبل نتيجة الفحص جاهزة.
 */
export function assertCanPerformPOAction(
  action: ActionName,
  user: MinimalCtxUser,
  po?: POActionSubject,
  opts?: { isCreator?: boolean }
): void {
  const actionCtx: ActionContext = { role: user.role, userId: user.id, isCreator: opts?.isCreator, isActive: user.isActive };
  assertCanPerformAction(action, actionCtx, po);
}

/** نسخة بلا رمي خطأ — للاستخدام بمنطق شرطي (مثال: إظهار/إخفاء زر أو فرع كود) */
export function canPerformPOAction(
  action: ActionName,
  user: MinimalCtxUser,
  po?: POActionSubject,
  opts?: { isCreator?: boolean }
): boolean {
  try {
    assertCanPerformPOAction(action, user, po, opts);
    return true;
  } catch {
    return false;
  }
}

/**
 * يُستخدم من editItem/deleteItem: فحص الصلاحية على مستوى الصنف (منطق أعقد من
 * PO-level، راجع policy.ts:ITEM_ACTION_POLICY للتفاصيل الكاملة).
 */
export function assertCanPerformItemPOAction(
  actionName: "editItem" | "deleteItem",
  user: MinimalCtxUser,
  subject: ItemActionSubject & { isCreator: boolean }
): void {
  const actionCtx: ActionContext = { role: user.role, userId: user.id, isCreator: subject.isCreator, isActive: user.isActive };
  assertCanPerformItemAction(actionName, actionCtx, subject);
}

/**
 * يُستخدم من estimateCost/confirmPurchase: هل الصنف مخصَّص لهذا المندوب؟
 * (owner/admin يتجاوزان دائمًا)
 */
export function assertPOItemAssignedToDelegate(
  user: MinimalCtxUser,
  item: { delegateId: number | null | undefined; itemName?: string }
): void {
  assertItemAssignedToDelegate({ role: user.role, userId: user.id }, item);
}

/** نسخة بلا رمي خطأ لنفس الفحص أعلاه — تُستخدم بمنطق الفلترة (مثال: submitPricedBatch) */
export function isItemAssignedToPODelegate(user: MinimalCtxUser, item: { delegateId: number | null | undefined }): boolean {
  return isItemAssignedToDelegate({ role: user.role, userId: user.id }, item);
}

/** طلب تغيير مندوب الصنف — للمندوب الحالي وقبل التسعير فقط. */
export function assertCanRequestDelegateChange(
  user: MinimalCtxUser,
  subject: DelegateChangeSubject
): void {
  assertCanRequestPOItemDelegateChange({ role: user.role, userId: user.id }, subject);
}

/** حسم طلب تغيير المندوب — لمدير الصيانة أو owner/admin. */
export function assertCanResolveDelegateChange(
  user: MinimalCtxUser,
  subject: DelegateChangeSubject
): void {
  assertCanResolvePOItemDelegateChange({ role: user.role, userId: user.id, isActive: user.isActive }, subject);
}

/** Selected rows are freshly loaded by the writer inside its transaction. */
export function assertCanReviewPurchaseOrderItems(
  user: MinimalCtxUser, po: POActionSubject & { id?: number },
  items: Array<{ id?: number; purchaseOrderId?: number; reviewRole?: string | null; reviewedById?: number | null; reviewedAt?: string | Date | null; status?: string }>,
): void {
  if (!items.length || (ROUTED_REVIEW_BLOCKED_PO_STATUSES as readonly string[]).includes(po.status)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "هذه الأصناف غير متاحة للمراجعة في المرحلة الحالية" });
  }
  for (const item of items) {
    if (po.id != null && item.purchaseOrderId != null && Number(item.purchaseOrderId) !== Number(po.id)) {
      throw new TRPCError({ code: "FORBIDDEN", message: "الصنف لا ينتمي إلى طلب الشراء المحدد" });
    }
    if (item.reviewRole != null) {
      if (!isRoutedPurchaseItem(item) || !canReviewPurchaseItem(user, item)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "لا تملك صلاحية مراجعة هذا الصنف أو سبق حسمه" });
      }
    } else assertCanPerformPOAction("reviewItems", user, po);
  }
}

/** No routed edit/delete/cancel is authorized by the PO header alone. */
export function assertCanPerformPurchaseItemReviewAction(
  action: "editItem" | "deleteItem" | "cancelItem", user: MinimalCtxUser,
  po: POActionSubject & { id?: number; requestedById?: number | null },
  item: { id?: number; purchaseOrderId?: number; reviewRole?: string | null; reviewedById?: number | null; reviewedAt?: string | Date | null; status: string },
): void {
  if (item.reviewRole != null && user.isActive !== 1 && user.isActive !== true) {
    throw new TRPCError({ code: "FORBIDDEN", message: "الحساب غير نشط" });
  }
  if (po.id != null && item.purchaseOrderId != null && Number(item.purchaseOrderId) !== Number(po.id)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "الصنف لا ينتمي إلى طلب الشراء المحدد" });
  }
  if (action !== "cancelItem") return assertCanPerformItemPOAction(action, user, {
    itemStatus: item.status, poStatus: po.status, reviewRole: item.reviewRole, reviewedById: item.reviewedById, reviewedAt: item.reviewedAt,
    isCreator: Number(po.requestedById) === user.id,
  });
  if (item.reviewRole != null && item.status === "pending_review") {
    return assertCanReviewPurchaseOrderItems(user, po, [item]);
  }
  if (item.reviewRole != null && ["draft", "pending_review"].includes(po.status) && !["owner", "admin"].includes(user.role)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "تم حسم مراجعة هذا الصنف وإرساله إلى مرحلته التالية" });
  }
  // Financial-stage cancellation remains governed by its existing policy.
  assertCanPerformPOAction("cancelItem", user, po);
}

/**
 * يُستخدم من confirmDeliveryToWarehouse/confirmDeliveryToRequester: الفحص على
 * حالة **الصنف** نفسه، لا حالة الطلب (طلب واحد قد يحوي أصنافًا بحالات مختلفة
 * أثناء الشراء الجزئي).
 */
export function assertCanPerformItemStatusPOAction(
  actionName: "confirmDeliveryToWarehouse" | "confirmDeliveryToRequester",
  user: MinimalCtxUser,
  itemStatus: string
): void {
  assertCanPerformItemStatusAction(actionName, { role: user.role, userId: user.id }, itemStatus);
}

/** حسم صنف أُعيد لمنشئ الطلب بطلب مراجعة أو بإلغاء شراء. */
export function assertCanResolveReturnedPOItem(
  user: MinimalCtxUser,
  subject: { requestedById: number | null; itemStatus: string },
  message?: string
): void {
  assertCanResolveCreatorReturnedItem(
    { role: user.role, userId: user.id },
    subject,
    message
  );
}

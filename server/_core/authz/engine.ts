/**
 * ══════════════════════════════════════════════════════════════════════════
 * الحارس المركزي لطلبات الشراء — الطبقة 2: محرك القرار (Engine / PDP)
 * ══════════════════════════════════════════════════════════════════════════
 *
 * دوال نقية (Pure Functions) — بلا أي استعلام قاعدة بيانات هنا عمدًا، حتى تبقى
 * قابلة للاختبار بدون mock معقّد وبدون أي تكلفة أداء إضافية (نفس مبدأ التصميم
 * المتفق عليه: القرار يُبنى على بيانات already-loaded، لا استعلامات جديدة).
 *
 * أي استعلام DB مطلوب لتغذية هذه الدوال (مثال: قائمة IDs المندوب المخصَّصة له،
 * أو معرّفات مساعدي المستودع الغذائي) تُجلب من الراوتر أو من guard.ts، وتُمرَّر
 * هنا كبيانات جاهزة فقط.
 *
 * Default Deny: أي دور غير موجود بـVISIBILITY_POLICY يُرفض تلقائيًا (رجوع false).
 */

import { TRPCError } from "@trpc/server";
import { canReviewPurchaseItem, canResolvePurchaseItemReviewer, isRoutedPurchaseItem } from "../../../shared/purchase-item-review";
import {
  ACTION_POLICY,
  BYPASS_ALL_ROLES,
  ITEM_ACTION_POLICY,
  ITEM_STATUS_ACTION_POLICY,
  CREATOR_RETURNED_ITEM_STATUSES,
  DELEGATE_CHANGE_REQUEST_ROLES,
  DELEGATE_CHANGE_RESOLVER_ROLES,
  VISIBILITY_POLICY,
  ROUTED_REVIEW_BLOCKED_PO_STATUSES,
  type ActionName,
  type POStatus,
  type Role,
} from "./policy";

// ──────────────────────────────────────────────────────────────────────────
// الرؤية (Visibility) — list() و getById() يستدعيان نفس هذه الدالة بالضبط
// ──────────────────────────────────────────────────────────────────────────

export interface VisibilityContext {
  role: string;
  userId: number;
  /** مطلوبة فقط لدور food_warehouse_manager: معرّفات مستخدمي food_warehouse_assistant */
  assistantUserIds?: number[];
  /** مطلوبة فقط لدور delegate: معرّفات الطلبات التي له فيها صنف مخصَّص */
  delegateAssignedPoIds?: number[];
  /** Loaded inside this read operation only, scoped to the active reviewer. */
  routedReviewPoIds?: number[];
}

export interface POVisibilitySubject {
  id: number;
  status: string;
  requestedById: number | null;
}

/**
 * هل يملك هذا المستخدم صلاحية الاطلاع على هذا الطلب؟ (تُستخدم من getById)
 */
export function isPOVisible(ctx: VisibilityContext, po: POVisibilitySubject): boolean {
  if (BYPASS_ALL_ROLES.includes(ctx.role as Role)) return true;

  const rule = VISIBILITY_POLICY[ctx.role];
  if (!rule) return false; // Default Deny: دور غير معرَّف بالسياسة

  // قاعدة عامة لكل دور معرَّف ومسموح له بإنشاء طلب شراء: يحتفظ منشئ الطلب
  // برؤية طلبه في جميع مراحل الدورة. هذه إضافة إلى نطاق الدور الوظيفي وليست
  // بديلًا عنه، ولا تمنح أي صلاحية تنفيذ/اعتماد إضافية.
  if (
    po.requestedById === ctx.userId &&
    canPerformAction("create", { role: ctx.role, userId: ctx.userId })
  ) {
    return true;
  }

  switch (rule.kind) {
    case "all":
      return true;
    case "own":
      return po.requestedById === ctx.userId;
    case "own_plus_role":
      return po.requestedById === ctx.userId || (ctx.assistantUserIds ?? []).includes(po.requestedById ?? -1);
    case "assigned_items_only":
      return (ctx.delegateAssignedPoIds ?? []).includes(po.id);
    case "status_exact":
      return po.status === rule.status;
    case "status_range":
      return !rule.excludedStatuses.includes(po.status as POStatus) ||
        (ctx.role === "senior_management" && !(ROUTED_REVIEW_BLOCKED_PO_STATUSES as readonly string[]).includes(po.status) &&
          (ctx.routedReviewPoIds ?? []).includes(po.id));
    default:
      return false; // exhaustiveness safety net
  }
}

/**
 * يفلتر قائمة طلبات كاملة لنفس نطاق isPOVisible بالضبط (تُستخدم من list())
 * — نفس الدالة، نفس القرار، فلا يمكن أن ينحرف نطاق القائمة عن نطاق التفاصيل.
 */
export function filterVisiblePOs<T extends POVisibilitySubject>(ctx: VisibilityContext, pos: T[]): T[] {
  return pos.filter((po) => isPOVisible(ctx, po));
}

// ──────────────────────────────────────────────────────────────────────────
// الإجراءات (Actions)
// ──────────────────────────────────────────────────────────────────────────

export interface ActionContext {
  role: string;
  userId: number;
  isActive?: number | boolean | null;
  /** هل منفّذ الإجراء هو منشئ الطلب؟ (يحدده الراوتر، الحارس لا يفترضه) */
  isCreator?: boolean;
}

export interface POActionSubject {
  status: string;
}

/**
 * هل يملك هذا المستخدم صلاحية تنفيذ هذا الإجراء على هذا الطلب (بحالته الحالية)؟
 * لإجراءات لا تتطلب طلبًا محدَّدًا بعد (مثل create)، مرّر po كـundefined.
 */
export function canPerformAction(action: ActionName, ctx: ActionContext, po?: POActionSubject): boolean {
  if (BYPASS_ALL_ROLES.includes(ctx.role as Role)) return true;

  const clauses = ACTION_POLICY[action];
  if (!clauses) return false; // Default Deny: إجراء غير معرَّف بالسياسة

  return clauses.some((clause) => {
    if (!clause.roles.includes(ctx.role as Role)) return false;
    if (clause.statuses !== "any") {
      if (!po) return false; // الإجراء يتطلب حالة طلب لكن ما تم تمرير طلب
      if (!clause.statuses.includes(po.status as POStatus)) return false;
    }
    if (clause.ownership === "creator" && !ctx.isCreator) return false;
    return true;
  });
}

/**
 * نسخة "ارمِ خطأ" من canPerformAction — تُستخدم مباشرة داخل معالجات tRPC.
 * هذا هو الاستدعاء الوحيد اللي تحتاجه أغلب الراوترات؛ يفشل بـFORBIDDEN مباشرة
 * إذا لم يكن الإجراء مسموحًا، تمامًا مثل التحقق اللي كنا نكرره يدويًا بكل ملف.
 */
export function assertCanPerformAction(
  action: ActionName,
  ctx: ActionContext,
  po?: POActionSubject,
  message = "ليس لديك صلاحية لتنفيذ هذا الإجراء بمرحلته الحالية"
): void {
  if (!canPerformAction(action, ctx, po)) {
    throw new TRPCError({ code: "FORBIDDEN", message });
  }
}

/** نسخة "ارمِ خطأ" من isPOVisible — تُستخدم مباشرة داخل getById */
export function assertPOVisible(
  ctx: VisibilityContext,
  po: POVisibilitySubject,
  message = "ليس لديك صلاحية للاطلاع على هذا الطلب"
): void {
  if (!isPOVisible(ctx, po)) {
    throw new TRPCError({ code: "FORBIDDEN", message });
  }
}

// ──────────────────────────────────────────────────────────────────────────
// إجراءات مستوى الصنف (Item-level) — editItem / deleteItem
// ──────────────────────────────────────────────────────────────────────────

export interface ItemActionSubject {
  /** حالة الصنف نفسه */
  itemStatus: string;
  /** حالة الطلب الأب الذي يتبعه الصنف */
  poStatus: string;
  reviewRole?: string | null;
  reviewedById?: number | null;
  reviewedAt?: string | Date | null;
}

/**
 * منطق editItem/deleteItem على مستوى الصنف.
 * owner/admin يملكان تجاوزًا مطلقًا لقواعد الدور والملكية والحالة، باستثناء
 * الصنف الملغى نهائيًا؛ cancelled سجل مرجعي غير قابل للتعديل أو الحذف عبر
 * المسارات العادية. تبقى بقية قيود سلامة البيانات البنيوية داخل الراوتر.
 */
export function canPerformItemAction(
  actionName: "editItem" | "deleteItem",
  ctx: ActionContext,
  subject: ItemActionSubject
): boolean {
  // cancelled حالة نهائية غير قابلة لإعادة التفعيل أو تغيير السجل التاريخي،
  // حتى بواسطة owner/admin. أي استعادة مستقبلية يجب أن تكون بإجراء صريح مستقل.
  if (subject.itemStatus === "cancelled") return false;

  if (subject.reviewRole != null && ctx.isActive !== 1 && ctx.isActive !== true) return false;
  if (subject.reviewRole != null && subject.itemStatus === "pending_review" &&
    (ROUTED_REVIEW_BLOCKED_PO_STATUSES as readonly string[]).includes(subject.poStatus)) return false;

  if (BYPASS_ALL_ROLES.includes(ctx.role as Role)) return true;

  if (subject.reviewRole != null) {
    // A routed item must never inherit another manager's broad header-stage grant.
    // Returned-item choices remain with their creator under the existing rules.
    if (ctx.isCreator && CREATOR_RETURNED_ITEM_STATUSES.includes(subject.itemStatus as any)) return true;
    return !(ROUTED_REVIEW_BLOCKED_PO_STATUSES as readonly string[]).includes(subject.poStatus) &&
      canReviewPurchaseItem({ id: ctx.userId, role: ctx.role, isActive: ctx.isActive }, {
        reviewRole: subject.reviewRole, reviewedById: subject.reviewedById, reviewedAt: subject.reviewedAt, status: subject.itemStatus,
      });
  }

  const rule = ITEM_ACTION_POLICY[actionName];
  if (!rule) return false;

  const creatorException =
    !!ctx.isCreator &&
    (rule.creatorExceptionItemStatuses.includes(subject.itemStatus) ||
      rule.creatorExceptionPOStatuses.includes(subject.poStatus as POStatus));

  if (!creatorException) {
    if (!rule.privilegedRoles.includes(ctx.role as Role)) return false;
    if (!rule.privilegedEditableStatuses.includes(subject.poStatus as POStatus)) return false;
  }

  // بعض حالات الطلب تبقى مقصورة على المنشئ لبقية الأدوار غير bypass.
  if (rule.creatorOnlyPOStatuses.includes(subject.poStatus as POStatus) && !ctx.isCreator) {
    return false;
  }

  return true;
}

export function assertCanPerformItemAction(
  actionName: "editItem" | "deleteItem",
  ctx: ActionContext,
  subject: ItemActionSubject,
  message?: string
): void {
  if (!canPerformItemAction(actionName, ctx, subject)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: message ?? "ليس لديك صلاحية لتنفيذ هذا الإجراء على هذا الصنف بحالته الحالية",
    });
  }
}

/**
 * حسم صنف أعاده المندوب إلى منشئ الطلب، سواء بطلب مراجعة أو بإلغاء الشراء.
 * القرار النهائي (إعادة الإرسال أو الإلغاء النهائي) لمنشئ الطلب فقط، مع تجاوز
 * owner/admin. لا يمنح هذا الفحص صلاحية على أي صنف بحالة أخرى.
 */
export function canResolveCreatorReturnedItem(
  ctx: { role: string; userId: number },
  subject: { requestedById: number | null; itemStatus: string }
): boolean {
  const isReturnedStatus = CREATOR_RETURNED_ITEM_STATUSES.includes(
    subject.itemStatus as (typeof CREATOR_RETURNED_ITEM_STATUSES)[number]
  );
  if (!isReturnedStatus) return false;
  if (BYPASS_ALL_ROLES.includes(ctx.role as Role)) return true;
  return subject.requestedById === ctx.userId;
}

export function assertCanResolveCreatorReturnedItem(
  ctx: { role: string; userId: number },
  subject: { requestedById: number | null; itemStatus: string },
  message = "فقط منشئ الطلب أو الإدارة يمكنه معالجة هذا الصنف"
): void {
  if (!canResolveCreatorReturnedItem(ctx, subject)) {
    throw new TRPCError({ code: "FORBIDDEN", message });
  }
}

/**
 * ملكية الصنف للمندوب — تُستخدم من estimateCost/confirmPurchase. أبسط بكثير
 * من editItem/deleteItem: هنا BYPASS_ALL_ROLES يُطبَّق بشكل طبيعي (owner/admin
 * يتجاوزان دائمًا، مطابقة للسلوك الأصلي بالكود: `if (!isAdminOrOwner && poItem.delegateId !== ctx.user.id)`).
 */
export function isItemAssignedToDelegate(
  ctx: { role: string; userId: number },
  item: { delegateId: number | null | undefined }
): boolean {
  if (BYPASS_ALL_ROLES.includes(ctx.role as Role)) return true;
  return item.delegateId === ctx.userId;
}

export function assertItemAssignedToDelegate(
  ctx: { role: string; userId: number },
  item: { delegateId: number | null | undefined; itemName?: string },
  message?: string
): void {
  if (!isItemAssignedToDelegate(ctx, item)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: message ?? `${item.itemName ? `الصنف "${item.itemName}" ` : "هذا الصنف "}غير مخصص لك`,
    });
  }
}

// ──────────────────────────────────────────────────────────────────────────
// طلب تغيير مندوب الصنف قبل التسعير
// ──────────────────────────────────────────────────────────────────────────

export interface DelegateChangeSubject {
  delegateId: number | null | undefined;
  itemStatus: string;
  batchId: number | null | undefined;
  estimatedUnitCost?: string | number | null;
  delegateChangeRequestedAt: string | Date | null | undefined;
  /**
   * صاحب قرار الحسم — نفس من راجع واعتمد أصناف الطلب واختار المندوب لهذا
   * الصنف أصلًا (purchaseOrders.reviewedById)، لا أي مستخدم يحمل دورًا مؤهَّلاً.
   * راجع assertCanResolvePOItemDelegateChange أدناه لسبب هذا القيد (2026-08-13).
   */
  reviewedById?: number | null;
  reviewRole?: string | null;
}

export function canRequestPOItemDelegateChange(
  ctx: { role: string; userId: number },
  subject: DelegateChangeSubject
): boolean {
  return (
    DELEGATE_CHANGE_REQUEST_ROLES.includes(ctx.role as Role) &&
    subject.delegateId === ctx.userId &&
    subject.itemStatus === "pending" &&
    !subject.batchId &&
    (subject.estimatedUnitCost === null || subject.estimatedUnitCost === undefined || subject.estimatedUnitCost === "") &&
    !subject.delegateChangeRequestedAt
  );
}

export function assertCanRequestPOItemDelegateChange(
  ctx: { role: string; userId: number },
  subject: DelegateChangeSubject
): void {
  if (!canRequestPOItemDelegateChange(ctx, subject)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "يمكن للمندوب الحالي فقط طلب تغيير المندوب قبل تسعير الصنف وإرساله",
    });
  }
}

export function canResolvePOItemDelegateChange(
  ctx: { role: string; userId: number; isActive?: number | boolean | null },
  subject: DelegateChangeSubject
): boolean {
  if (subject.reviewRole != null) {
    return isRoutedPurchaseItem(subject) && subject.itemStatus === "pending" && !subject.batchId &&
      !!subject.delegateChangeRequestedAt && canResolvePurchaseItemReviewer(
        { id: ctx.userId, role: ctx.role, isActive: ctx.isActive }, subject,
      );
  }
  const baseEligible =
    DELEGATE_CHANGE_RESOLVER_ROLES.includes(ctx.role as Role) &&
    subject.itemStatus === "pending" &&
    !subject.batchId &&
    !!subject.delegateChangeRequestedAt;
  if (!baseEligible) return false;

  // ⚠️ 2026-08-13: الحسم يعود حصرًا لنفس المستخدم الذي راجع الطلب واختار
  // المندوب لهذا الصنف أصلًا (purchaseOrders.reviewedById) — لا لأي مستخدم
  // يحمل أحد أدوار DELEGATE_CHANGE_RESOLVER_ROLES. سابقًا كان أي مدير من
  // الأدوار الثلاثة (صيانة/صيانة عامة/إنشاءات ومشتريات) يستطيع حسم طلب لم
  // يراجعه أصلًا، وهي ثغرة ملكية حقيقية: قد يحوّل مدير غير مطّلع الصنف
  // لمندوب لا يعرف السياق الذي اختير المندوب الأول لأجله.
  if (BYPASS_ALL_ROLES.includes(ctx.role as Role)) return true;
  // Fallback: طلبات شراء قديمة بلا reviewedById مسجَّل (نادر) — لا يُحجب
  // القرار عن كل المديرين بسبب نقص بيانات تاريخي.
  if (subject.reviewedById === null || subject.reviewedById === undefined) return true;
  return subject.reviewedById === ctx.userId;
}

export function assertCanResolvePOItemDelegateChange(
  ctx: { role: string; userId: number; isActive?: number | boolean | null },
  subject: DelegateChangeSubject
): void {
  if (!canResolvePOItemDelegateChange(ctx, subject)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "لا يمكن حسم طلب تغيير المندوب بهذه الصلاحية أو بحالة الصنف الحالية",
    });
  }
}

// ──────────────────────────────────────────────────────────────────────────
// إجراءات تُفحص بحالة الصنف حصرًا (لا حالة الطلب) — confirmDeliveryToWarehouse
// و confirmDeliveryToRequester. BYPASS_ALL_ROLES يُطبَّق طبيعيًا هنا (owner/admin
// يتجاوزان، كما بالسلوك الأصلي بالكود — لا استثناء خاص هنا خلافًا لـeditItem/deleteItem).
// ──────────────────────────────────────────────────────────────────────────

export function canPerformItemStatusAction(
  actionName: "confirmDeliveryToWarehouse" | "confirmDeliveryToRequester",
  ctx: ActionContext,
  itemStatus: string
): boolean {
  if (BYPASS_ALL_ROLES.includes(ctx.role as Role)) return true;
  const clauses = ITEM_STATUS_ACTION_POLICY[actionName];
  if (!clauses) return false;
  return clauses.some((clause) => clause.roles.includes(ctx.role as Role) && clause.itemStatuses.includes(itemStatus));
}

export function assertCanPerformItemStatusAction(
  actionName: "confirmDeliveryToWarehouse" | "confirmDeliveryToRequester",
  ctx: ActionContext,
  itemStatus: string,
  message = "لا يمكن تنفيذ هذا الإجراء على الصنف بحالته الحالية"
): void {
  if (!canPerformItemStatusAction(actionName, ctx, itemStatus)) {
    throw new TRPCError({ code: "FORBIDDEN", message });
  }
}

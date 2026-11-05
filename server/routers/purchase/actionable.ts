/**
 * ══════════════════════════════════════════════════════════════════════════
 * "بانتظار إجرائي" — تحديد الطلبات التي تنتظر إجراءً من المستخدم الحالي
 * ══════════════════════════════════════════════════════════════════════════
 *
 * المشكلة المعالَجة (بكلام صاحب المشروع): «الطلبات كثيرة ولا أعرف ما يحتاج
 * موافقتي فيضيع ضمن صفوف الطلبات، ولا أعرف موقع الطلب الآن».
 *
 * المبدأ: لا نسأل «ما مرحلة الطلب؟» بل «هل هذا الطلب واقف بانتظار فعل من هذا
 * المستخدم تحديدًا؟» — وهي ثلاث فئات مختلفة، لا فئة واحدة:
 *
 *   1. طلب بمرحلة يستطيع دور المستخدم التصرف فيها (اعتماد/مراجعة/تسعير/استلام).
 *   2. طلب رُدّ لمنشئه للمراجعة (revision_needed).
 *   3. طلب فيه صنف ملغى أو يحتاج مراجعة، والقرار بيد منشئ الطلب.
 *
 * الفئتان 2 و3 هما الأخطر عمليًا: الطلب واقف تمامًا، وحالته العامة لا تدل على
 * أن الكرة بملعب المستخدم، فيسهل ضياعه — وهذا جوهر الشكوى الأصلية.
 *
 * ⚠️ مبدأ تصميمي: هذا الملف **لا يعرّف صلاحيات جديدة إطلاقًا**. يستدعي
 * `canPerformAction` من الحارس المركزي (server/_core/authz) كمصدر وحيد للحقيقة.
 * فما يظهر هنا هو بالضبط ما يستطيع المستخدم تنفيذه فعليًا — لا أكثر ولا أقل.
 */

import { canPerformAction, canPerformItemAction, canResolvePOItemDelegateChange } from "../../_core/authz/engine";
import { PO_STATUS, ROUTED_REVIEW_BLOCKED_PO_STATUSES, type ActionName } from "../../_core/authz/policy";
import { canReviewPurchaseItem, isRoutedPurchaseItem } from "../../../shared/purchase-item-review";
import { hasCommittedPurchaseItemReview } from "../../../shared/purchaseItemReviewWorkflow";
import { isDelegateRole } from "../../../shared/roles";
import type { LegacyPricingBatchReadScope } from "../../_core/authz/legacy-pricing-batch-read";

/** حالات الأصناف التي تتطلب قرارًا من منشئ الطلب */
const ITEM_STATUSES_NEEDING_CREATOR = ["needs_item_revision", "purchase_cancelled"];

export interface ActionablePO {
  id: number;
  poNumber: string;
  status: string;
  /** سبب ظهور الطلب — نص عربي مفهوم يُعرض للمستخدم مباشرة */
  reason: string;
  /** الإجراء المقترح — نص الزر */
  actionLabel: string;
  /** ملخص الأصناف: "تم شراء 3 من 5" — يُعرض عند وجود تقدم جزئي */
  itemsSummary?: string;
  /** وضع الإجراء للمندوب — يُستخدم للتوجيه الصحيح من شاشة «بانتظار إجرائي». */
  actionMode?: "estimate" | "purchase" | "mixed";
  /** Keep per-item review navigation separate from a later header finance stage. */
  reviewAction?: "review" | "delegate_change";
  /** Independent legacy finance work; never replace the true PO header status. */
  approvalAction?: "accounting" | "management";
  actionKey?: string;
}

interface UserCtx {
  id: number;
  role: string;
  isActive?: number | boolean | null;
}

interface POInput {
  id: number;
  poNumber: string;
  status: string;
  requestedById: number | null;
  /** لتقييد ظهور طلب تغيير المندوب على نفس من راجع واختار المندوب أصلًا (2026-08-13) */
  reviewedById?: number | null;
}

interface ItemInput {
  id?: number;
  purchaseOrderId: number;
  status: string;
  delegateId?: number | null;
  batchId?: number | null;
  delegateChangeRequestedAt?: string | Date | null;
  reviewRole?: string | null;
  reviewedById?: number | null;
  reviewedAt?: string | Date | null;
}

export type DelegateItemActionMode = "estimate" | "purchase";

/**
 * مصدر الحقيقة المشترك لحسم ما إذا كان بند المندوب يحتاج تدخله الآن.
 * يُستخدم في «بانتظار إجرائي» وفي تبويب «أصنافي بانتظار المعالجة» حتى لا
 * تنحرف القائمتان عن بعضهما مع الوقت.
 */
export function getDelegateItemActionMode(
  poStatus: string,
  item: Pick<ItemInput, "status" | "batchId" | "delegateChangeRequestedAt" | "reviewRole" | "reviewedById" | "reviewedAt">
): DelegateItemActionMode | null {
  if (item.delegateChangeRequestedAt) return null;
  if (isRoutedPurchaseItem(item)) {
    if (!hasCommittedPurchaseItemReview(item) || [PO_STATUS.DRAFT, PO_STATUS.REVISION_NEEDED, PO_STATUS.CLOSED, PO_STATUS.REJECTED].includes(poStatus as any)) return null;
    if (!item.batchId && ["pending", "estimated"].includes(item.status)) return "estimate";
    if (["approved", "funded"].includes(item.status)) return "purchase";
    return null;
  }

  const blocked = [
    PO_STATUS.DRAFT,
    PO_STATUS.PENDING_REVIEW,
    PO_STATUS.REVISION_NEEDED,
    PO_STATUS.CLOSED,
    PO_STATUS.REJECTED,
  ].includes(poStatus as any);
  if (blocked) return null;

  if (!item.batchId && ["pending", "estimated"].includes(item.status)) {
    return "estimate";
  }

  if (
    ["approved", "funded"].includes(item.status) &&
    ([PO_STATUS.APPROVED, PO_STATUS.PARTIAL_PURCHASE].includes(poStatus as any) ||
      ([PO_STATUS.PENDING_ESTIMATE, PO_STATUS.PENDING_ACCOUNTING, PO_STATUS.PENDING_MANAGEMENT].includes(poStatus as any) && !!item.batchId))
  ) {
    return "purchase";
  }

  return null;
}

/**
 * ترجمة حالة الطلب إلى سبب مفهوم + إجراء، للفئة الأولى (مرحلة الدور).
 * تُرجع null إذا لم يكن للمستخدم إجراء بهذي المرحلة.
 */
/**
 * خريطة المرحلة ← الإجراء المطلوب فيها. مرتبة بترتيب دورة الحياة.
 * ملاحظة: تُقاد بحالة الطلب أولًا (لا بما يستطيع المستخدم فعله)، لأن
 * owner/admin يتجاوزان كل فحوصات الحارس — فلو اعتمدنا على `canPerformAction`
 * وحده لتحديد **أي** إجراء، لأعاد لهما دائمًا أول بند بالقائمة، فتظهر لهما كل
 * الطلبات بسبب واحد مضلّل. (خلل اكتُشف بالاستخدام الفعلي وصُحّح 2026-07-30.)
 */
const STAGE_ACTIONS: Array<{
  status: string;
  action: ActionName;
  /** السبب المعروض لمن يملك الإجراء فعلًا */
  ownReason: string;
  /** السبب المعروض للمشرف (owner/admin) — صادق عن الجهة المنتظَرة */
  supervisorReason: string;
  actionLabel: string;
}> = [
  { status: PO_STATUS.PENDING_REVIEW,     action: "reviewItems",       ownReason: "يحتاج مراجعتك وتوزيع الأصناف", supervisorReason: "بانتظار مراجعة مدير الصيانة", actionLabel: "راجع" },
  { status: PO_STATUS.PENDING_ESTIMATE,   action: "estimateCost",      ownReason: "بانتظار تسعيرك",               supervisorReason: "بانتظار تسعير المندوب",       actionLabel: "تسعير" },
  { status: PO_STATUS.PENDING_ACCOUNTING, action: "approveAccounting", ownReason: "يحتاج اعتمادك المحاسبي",       supervisorReason: "بانتظار اعتماد الحسابات",     actionLabel: "اعتمد" },
  { status: PO_STATUS.PENDING_MANAGEMENT, action: "approveManagement", ownReason: "يحتاج اعتمادك الإداري",        supervisorReason: "بانتظار اعتماد الإدارة العليا", actionLabel: "اعتمد" },
  { status: PO_STATUS.APPROVED,           action: "confirmPurchase",   ownReason: "بانتظار تنفيذ الشراء",          supervisorReason: "بانتظار شراء المندوب",        actionLabel: "تنفيذ الشراء" },
  { status: PO_STATUS.PARTIAL_PURCHASE,   action: "confirmPurchase",   ownReason: "بانتظار إكمال الشراء",          supervisorReason: "بانتظار إكمال شراء المندوب",  actionLabel: "إكمال الشراء" },
];

const SUPERVISOR_ROLES = ["owner", "admin"];

function describeStageAction(ctx: UserCtx, po: POInput): { reason: string; actionLabel: string } | null {
  const stage = STAGE_ACTIONS.find((s) => s.status === po.status);
  if (!stage) return null;

  // المشرف (owner/admin): يرى كل مرحلة بسبب صادق عن الجهة المنتظَرة فعلًا،
  // بدل رسالة موحّدة مضلّلة — قرار صاحب المشروع: صلاحياتهما مطلقة على كل شيء.
  if (SUPERVISOR_ROLES.includes(ctx.role)) {
    return { reason: stage.supervisorReason, actionLabel: stage.actionLabel };
  }

  // باقي الأدوار: يظهر الطلب فقط إن كان الدور يملك هذا الإجراء فعلًا
  const canAct = canPerformAction(stage.action, { role: ctx.role, userId: ctx.id }, { status: po.status });
  return canAct ? { reason: stage.ownReason, actionLabel: stage.actionLabel } : null;
}

/** يبني ملخص الأصناف: "تم شراء 3 من 5" — يُعرض فقط عند وجود تقدم جزئي فعلي */
function buildItemsSummary(items: ItemInput[]): string | undefined {
  if (items.length === 0) return undefined;
  const purchased = items.filter((i) =>
    ["purchased", "delivered_to_warehouse", "delivered_to_requester"].includes(i.status)
  ).length;
  if (purchased === 0 || purchased === items.length) return undefined;
  return `تم شراء ${purchased} من ${items.length}`;
}

/**
 * الدالة الرئيسية: تُرجع الطلبات التي تنتظر إجراءً من هذا المستخدم، مع سبب
 * ظهور كل طلب والإجراء المقترح.
 *
 * @param pos    الطلبات التي يملك المستخدم صلاحية رؤيتها (مفلترة مسبقًا بالحارس)
 * @param items  كل أصناف تلك الطلبات (لتفادي استعلام منفصل لكل طلب)
 */
export function computeActionablePOs(
  ctx: UserCtx,
  pos: POInput[],
  items: ItemInput[],
  legacyApprovals: readonly LegacyPricingBatchReadScope[] = [],
): ActionablePO[] {
  const itemsByPO = new Map<number, ItemInput[]>();
  for (const it of items) {
    const list = itemsByPO.get(it.purchaseOrderId) ?? [];
    list.push(it);
    itemsByPO.set(it.purchaseOrderId, list);
  }

  const result: ActionablePO[] = [];

  for (const po of pos) {
    const poItems = itemsByPO.get(po.id) ?? [];
    const isCreator = po.requestedById === ctx.id;
    const itemsSummary = buildItemsSummary(poItems);

    // A legacy standalone batch remains actionable while a different batch or
    // review changes the summary header. PB submissions and unified DPB roots
    // keep their own aggregate cards; the read loader excludes unified roots.
    const financeStage = ctx.role === "accountant" ? "accounting" : ctx.role === "senior_management" ? "management" : null;
    const finance = financeStage && (ctx.isActive === 1 || ctx.isActive === true) &&
      !(ROUTED_REVIEW_BLOCKED_PO_STATUSES as readonly string[]).includes(po.status)
      ? legacyApprovals.filter(approval => approval.purchaseOrderId === po.id && approval.stage === financeStage &&
        approval.purchasePackageSubmissionId == null && poItems.some(item => item.purchaseOrderId === po.id &&
          item.batchId === approval.batchId && item.status === "estimated" && item.id != null && approval.itemIds.includes(item.id))) : [];
    const hasFinanceAction = finance.length > 0;
    if (hasFinanceAction) {
      result.push({ id: po.id, poNumber: po.poNumber, status: po.status,
        approvalAction: financeStage!, actionKey: `${financeStage}:${po.id}`,
        reason: financeStage === "management" ? "دفعة تسعير تحتاج اعتمادك الإداري" : "دفعة تسعير تحتاج اعتمادك المحاسبي",
        actionLabel: "اعتمد", itemsSummary });
    }

    const myReviewItems = !(ROUTED_REVIEW_BLOCKED_PO_STATUSES as readonly string[]).includes(po.status)
      ? poItems.filter(item => canReviewPurchaseItem(ctx, item)) : [];
    if (myReviewItems.length) {
      result.push({
        id: po.id, poNumber: po.poNumber, status: po.status,
        reason: `أصناف موجّهة لمراجعتك — ${myReviewItems.length} صنف`, actionLabel: "راجع الأصناف",
        reviewAction: "review",
        itemsSummary: buildItemsSummary(myReviewItems),
      });
      continue;
    }

    // ── طلب تغيير مندوب صنف — بانتظار قرار نفس من راجع واختار المندوب أصلًا ──
    // ⚠️ 2026-08-13: سابقًا كان يظهر لأي مستخدم يحمل أحد الأدوار الثلاثة، لا
    // لمن راجع هذا الطلب تحديدًا — نفس الثغرة المصلَحة في الحارس المركزي
    // canResolvePOItemDelegateChange. الشرط هنا يطابقه حرفيًا حتى لا تُري
    // القائمة طلبًا لا يملك المستخدم صلاحية فعلية للتصرف به.
    const isEligibleDelegateChangeResolver =
      ["owner", "admin"].includes(ctx.role) ||
      (["maintenance_manager", "general_maintenance_manager", "construction_procurement_manager"].includes(ctx.role) &&
        (po.reviewedById === null || po.reviewedById === undefined || po.reviewedById === ctx.id));
    const delegateChangeItems = poItems.filter((i) => i.reviewRole != null
      ? canResolvePOItemDelegateChange({ role: ctx.role, userId: ctx.id, isActive: ctx.isActive }, {
        ...i, delegateId: i.delegateId, itemStatus: i.status, batchId: i.batchId,
        delegateChangeRequestedAt: i.delegateChangeRequestedAt,
      }) : isEligibleDelegateChangeResolver && Boolean(i.delegateChangeRequestedAt));
    if (delegateChangeItems.length > 0) {
      result.push({
        id: po.id, poNumber: po.poNumber, status: po.status,
        reason: `طلب تغيير مندوب — ${delegateChangeItems.length} من ${poItems.length} أصناف`,
        actionLabel: "اختيار مندوب",
        reviewAction: "delegate_change",
        itemsSummary,
      });
      continue;
    }

    // ── الفئة 4: مسودة لم تُرسل بعد — بانتظار منشئها لإكمالها ──────────
    // (أُضيفت 2026-07-30: المسودة **بانتظار إجراء منشئها فعلًا** — هو من يُكملها
    //  ويرسلها — لكنها كانت لا تظهر بالتبويب إطلاقًا، فيفتح المستخدم الصفحة
    //  ويجدها فارغة رغم وجود مسودة لم يُكملها. اكتُشف بالاستخدام الفعلي.)
    if (po.status === PO_STATUS.DRAFT) {
      if (isCreator || SUPERVISOR_ROLES.includes(ctx.role)) {
        result.push({
          id: po.id, poNumber: po.poNumber, status: po.status,
          reason: isCreator ? "مسودة لم تُرسل بعد" : "مسودة لم يُرسلها منشئها بعد",
          actionLabel: isCreator ? "إكمال وإرسال" : "فتح",
          itemsSummary,
        });
      }
      continue;
    }

    // ── الفئة 2: طلب رُدّ لمنشئه للمراجعة ─────────────────────────────
    if (po.status === PO_STATUS.REVISION_NEEDED && (isCreator || SUPERVISOR_ROLES.includes(ctx.role))) {
      result.push({
        id: po.id, poNumber: po.poNumber, status: po.status,
        reason: isCreator ? "رُدّ إليك للمراجعة" : "رُدّ لمنشئه للمراجعة",
        actionLabel: "تعديل وإعادة إرسال",
        itemsSummary,
      });
      continue;
    }

    // ── الفئة 3: صنف ملغى أو يحتاج مراجعة، والقرار بيد منشئ الطلب ─────
    const needyItems = poItems.filter((i) => ITEM_STATUSES_NEEDING_CREATOR.includes(i.status));
    if (needyItems.length > 0) {
      // نتحقق عبر الحارس المركزي أن المستخدم يستطيع فعلًا التصرف بهذا الصنف
      const canAct = canPerformItemAction(
        "editItem",
        { role: ctx.role, userId: ctx.id, isCreator },
        { itemStatus: needyItems[0].status, poStatus: po.status }
      );
      if (canAct) {
        const cancelled = needyItems.filter((i) => i.status === "purchase_cancelled").length;
        const label = cancelled > 0 ? "صنف ملغى يحتاج قرارك" : "صنف يحتاج مراجعتك";
        result.push({
          id: po.id, poNumber: po.poNumber, status: po.status,
          reason: `${label} — ${needyItems.length} من ${poItems.length} أصناف`,
          actionLabel: "معالجة",
          itemsSummary,
        });
        continue;
      }
    }

    // حماية للبيانات القديمة: إذا بقيت حالة الطلب بانتظار الحسابات/الإدارة
    // رغم أن جميع أصنافه أصبحت cancelled/rejected، فلا يوجد إجراء حقيقي ويجب
    // ألا يظهر في "بانتظار إجرائي". مسارات الإلغاء الجديدة تغلق الدفعة والطلب
    // فورًا، وهذا الشرط يمنع ظهور السجلات القديمة المعلقة.
    if (
      [PO_STATUS.PENDING_ACCOUNTING, PO_STATUS.PENDING_MANAGEMENT].includes(po.status as any) &&
      poItems.length > 0 &&
      poItems.every((i) => ["cancelled", "rejected"].includes(i.status))
    ) {
      continue;
    }

    // ── المندوب: «بانتظار إجرائي» يُحسم من أصنافه هو، لا من حالة PR العامة ──
    // طلب واحد قد يكون partial_purchase لأن بعض أصنافه اكتملت، بينما يبقى
    // صنف آخر لنفس المندوب pending للتسعير. الاعتماد على po.status وحده كان
    // يعرض «إكمال الشراء» ثم يفتح صفحة بلا أصناف لأن الصنف الحقيقي pending.
    // كذلك كان الطلب يبقى ظاهرًا للمندوب حتى لو كان الصنف المتبقي لمندوب آخر.
    if (isDelegateRole(ctx.role)) {
      const delegateItems = poItems.filter((i) => i.delegateId === ctx.id);
      const pricingItems = delegateItems.filter((i) => getDelegateItemActionMode(po.status, i) === "estimate");
      const purchaseItems = delegateItems.filter((i) => getDelegateItemActionMode(po.status, i) === "purchase");

      if (pricingItems.length > 0 || purchaseItems.length > 0) {
        if (pricingItems.length > 0 && purchaseItems.length > 0) {
          result.push({
            id: po.id, poNumber: po.poNumber, status: po.status,
            reason: `لديك ${pricingItems.length} صنف للتسعير و${purchaseItems.length} صنف للشراء`,
            actionLabel: "فتح",
            actionMode: "mixed",
            itemsSummary,
          });
        } else if (pricingItems.length > 0) {
          result.push({
            id: po.id, poNumber: po.poNumber, status: po.status,
            reason: "بانتظار تسعيرك",
            actionLabel: "تسعير",
            actionMode: "estimate",
            itemsSummary,
          });
        } else {
          result.push({
            id: po.id, poNumber: po.poNumber, status: po.status,
            reason: po.status === PO_STATUS.PARTIAL_PURCHASE ? "بانتظار إكمال الشراء" : "بانتظار تنفيذ الشراء",
            actionLabel: po.status === PO_STATUS.PARTIAL_PURCHASE ? "إكمال الشراء" : "تنفيذ الشراء",
            actionMode: "purchase",
            itemsSummary,
          });
        }
      }

      // للمندوب لا نعود إلى خريطة مرحلة PR العامة؛ إن لم يوجد صنف يحتاج
      // تدخله الآن فلا يوجد شيء في «بانتظار إجرائي» حتى لو كان PR جزئيًا.
      continue;
    }

    // ── الفئة 1: طلب بمرحلة يستطيع دور المستخدم التصرف فيها ───────────
    // Routed rows never fall through to an unrelated manager's header-only review.
    if (po.status === PO_STATUS.PENDING_REVIEW && poItems.length > 0 && poItems.every(item => item.reviewRole != null)) continue;
    const stage = describeStageAction(ctx, po);
    if (stage && !hasFinanceAction) {
      result.push({
        id: po.id, poNumber: po.poNumber, status: po.status,
        reason: stage.reason,
        actionLabel: stage.actionLabel,
        itemsSummary,
      });
    }
  }

  return result;
}

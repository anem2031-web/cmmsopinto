import { z } from "zod";
import { isDelegateRole } from "../../../shared/roles";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, accountantProcedure, managementProcedure } from "../_shared/procedures";
import * as db from "../../_core/db";
import {
  assertCanPerformPOAction,
  assertCanViewPurchaseOrder,
  filterVisiblePurchaseOrders,
  createPurchaseOrderReadScope,
} from "../../_core/authz/guard";
import { PO_STATUS } from "../../_core/authz/policy";
import { submitPricedBatchForPO, enrichExternalWorkshopPricingItems } from "./purchase-orders.router";
import { getActivePricingBatchItems } from "./pricing-batch-state";
import { syncPathBTicketFromPurchaseOrder } from "./ticket-purchase-workflow";
import { notifyItemRejection } from "../_shared/router-helpers";
import { generatePurchaseRequestPDF } from "../../services/export/exportService";
import { captureAccountingSignature } from "../../services/pdf/accountingSignature";
import { storagePut } from "../../_core/storage";
import { queuePurchaseTranslation } from "./translation-queue";
import { withPurchaseSubmissionTime } from "../../../shared/purchaseSubmissionTime";
import { localizeMasterDataReferences } from "../../services/translation/localizedMasterData";
import { purchaseDocumentPermission } from "../../_core/authz/purchase-document";
import { loadDocumentListPort } from "../../_core/db/document-list";
import { groupReadRows } from "../../_core/authz/read-batch";
import { assertLegacyApprovalOutsideUnifiedBundle } from "../../services/delegate-pricing-bundles/unified-feature";

// ============================================================
// [PB] راوتر حزمة الشراء — حاوية عليا فوق طلبات الشراء (2026-08-29)
//
// المبدأ الحاكم: "الحزمة مرآة لطلب الشراء، لا آلية جديدة".
//
// حتى المرحلة الأولى كانت الحزمة طبقة تجميع/رؤية فقط. ابتداءً من مسار
// approveAccountingSubmission المعتمد صراحةً في 2026-08-31، أضيف اعتماد
// محاسبي على مستوى **دفعة الإرسال** مع إبقاء جميع مسارات الطلب المفرد
// والاعتماد القديم كما هي دون استبدال أو حذف. الشراء والاستلام لا يتغيران.
// ============================================================


/**
 * [PB-DELEGATE-PRICING-DOC 2026-08-31] أرشفة مستند تسعير واحد صادر من
 * المندوب لكل دفعة إرسال حزمة. لا ننشئ مستندًا لكل PR داخل الحزمة؛ الارتباط
 * يكون مباشرةً بـ purchase_package_submissions.id. فشل الأرشفة لا يلغي
 * الإرسال الناجح للحسابات.
 */
async function archiveDelegatePackageSubmissionPricingPdf(args: {
  submissionId: number;
  submissionNumber: string;
  firstPurchaseOrderId: number;
  delegateId: number;
}): Promise<boolean> {
  try {
    const buffer = await generatePurchaseRequestPDF(
      args.firstPurchaseOrderId,
      args.delegateId,
      undefined,
      args.submissionId,
    );
    const fileName = `${args.submissionNumber}-تسعير-مندوب.pdf`;
    const key = `cmms/delegate-pricing-documents/package-submissions/submission-${args.submissionId}-${Date.now()}.pdf`;
    const { key: fileKey } = await storagePut(key, buffer, "application/pdf");
    const proxyUrl = `/api/media?key=${encodeURIComponent(fileKey)}`;

    await db.createAttachment({
      entityType: "delegate_package_submission_pricing",
      entityId: args.submissionId,
      fileName,
      fileUrl: proxyUrl,
      fileKey,
      mimeType: "application/pdf",
      fileSize: buffer.length,
      uploadedById: args.delegateId,
    });
    return true;
  } catch (e: any) {
    console.error("[ArchiveDelegatePackageSubmissionPricingPdf] Failed:", e?.message || e);
    return false;
  }
}

/**
 * [PB-FIN-DOC 2026-08-31] أرشفة مستند مالي واحد لدفعة إرسال الحزمة.
 *
 * الارتباط مستقل عن po_financial_batch القديم: entityId هنا هو
 * purchase_package_submissions.id، لذلك لا يحدث أي خلط بين رقم دفعة التسعير
 * ورقم دفعة الإرسال. فشل الأرشفة لا يلغي الاعتماد المالي الناجح، مطابقًا
 * لسلوك أرشفة المستندات المالية القديمة.
 */
async function archiveApprovedPackageSubmissionPdf(args: {
  submissionId: number;
  submissionNumber: string;
  firstPurchaseOrderId: number;
  userId: number;
}): Promise<boolean> {
  try {
    const buffer = await generatePurchaseRequestPDF(
      args.firstPurchaseOrderId,
      args.userId,
      undefined,
      args.submissionId,
    );
    const fileName = `${args.submissionNumber}-معتمدة-حسابات.pdf`;
    const key = `cmms/financial-documents/package-submissions/submission-${args.submissionId}-${Date.now()}.pdf`;
    const { key: fileKey } = await storagePut(key, buffer, "application/pdf");
    const proxyUrl = `/api/media?key=${encodeURIComponent(fileKey)}`;

    await db.createAttachment({
      entityType: "purchase_package_submission_financial",
      entityId: args.submissionId,
      fileName,
      fileUrl: proxyUrl,
      fileKey,
      mimeType: "application/pdf",
      fileSize: buffer.length,
      uploadedById: args.userId,
    });
    return true;
  } catch (e: any) {
    console.error("[ArchiveApprovedPackageSubmissionPdf] Failed:", e?.message || e);
    return false;
  }
}

/** الحالة الوحيدة المسموح فيها بالتجميع — حيث يقع دور المراجع اليوم. */
const GROUPABLE_STATUS = PO_STATUS.PENDING_REVIEW;

/**
 * [PB-P1 2026-08-30] حارس نطاق إدارة الحزمة.
 *
 * createPurchasePackage يحدد (الدور × حالة الطلب) فقط. أما نطاق الرؤية
 * الفعلي للطلب — وبالأخص food_warehouse_manager الذي يقتصر على طلباته
 * وطلبات food_warehouse_assistant — فمصدره المركزي هو نفس حارس طلبات
 * الشراء المستعمل في getById/list.
 *
 * الجمع بين الحارسين هنا لا يضيف Workflow أو صلاحية جديدة؛ بل يمنع الحزمة
 * من أن تصبح طريقًا جانبيًا لتجاوز نطاق طلب الشراء الأصلي.
 */
async function assertCanManageOrderThroughPackage(user: any, po: any) {
  await assertCanViewPurchaseOrder(user, po);
  assertCanPerformPOAction("createPurchasePackage", user, po);
}

/**
 * [PB-P1] يُرجع فقط طلبات الحزمة التي يستطيع المستخدم رؤيتها كطلبات شراء
 * مستقلة، ثم يعيد أصناف الطلب بنفس سلوك purchaseOrders.getById الحالي.
 * مهم: لا نضيّق أو نوسّع رؤية الأصناف هنا؛ الحزمة ترث سلوك الطلب المفرد
 * حرفيًا حتى لا تغيّر وظيفة قائمة لدى العميل.
 */
async function getVisiblePackageOrdersWithItems(user: any, packageId: number) {
  const packageOrders = await db.getPurchaseOrdersByPackage(packageId);
  const scope = await createPurchaseOrderReadScope(user, packageOrders as any[]);
  const visibleOrders = scope.filter(packageOrders as any[]);
  const items = groupReadRows(await db.getFullPOItemsForPOs(visibleOrders.map(po => Number(po.id))), row => Number(row.purchaseOrderId));
  return visibleOrders.map((po: any) => ({
    ...po,
    items: scope.filterItems(po, items.get(Number(po.id)) ?? []),
  }));
}

/**
 * [PB-P1] قبل تعديل عضوية حزمة موجودة، لا نسمح للمستخدم بتغيير حزمة
 * تحتوي طلبات خارج نطاق رؤيته. الفحص هنا رؤية فقط ولا يفحص حالة الطلبات،
 * لذلك لا يضيف أي شرط Workflow جديد على الطلبات الموجودة أصلًا بالحزمة.
 */
async function assertCanAccessExistingPackageContents(user: any, packageId: number) {
  const existingOrders = await db.getPurchaseOrdersByPackage(packageId);
  for (const existingPo of existingOrders) {
    await assertCanViewPurchaseOrder(user, existingPo);
  }
}

export const purchasePackagesRouter = router({
  /**
   * إنشاء حزمة جديدة تضم عدة طلبات شراء.
   *
   * التحقق يتم على **كل** طلب على حدة قبل أي كتابة: الطلب موجود، بحالة
   * pending_review، غير منتمٍ لحزمة أخرى، والمستخدم يملك صلاحية التجميع
   * عليه وفق ACTION_POLICY (نفس أدوار وحالة reviewItems).
   */
  create: protectedProcedure
    .input(z.object({
      orderIds: z.array(z.number()).min(2, "الحزمة تحتاج طلبين على الأقل"),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const orders = [];

      for (const orderId of input.orderIds) {
        const po = await db.getPurchaseOrderById(orderId);
        if (!po) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: `طلب الشراء رقم ${orderId} غير موجود`,
          });
        }

        // نفس صلاحية الطلب + نفس نطاق رؤيته. لا تسمح الحزمة بتوسيع النطاق.
        await assertCanManageOrderThroughPackage(ctx.user, po);

        if (po.status !== GROUPABLE_STATUS) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `طلب الشراء ${po.poNumber} ليس بحالة "بانتظار المراجعة" — لا يمكن تجميعه`,
          });
        }

        if (po.packageId) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `طلب الشراء ${po.poNumber} منتمٍ بالفعل لحزمة أخرى`,
          });
        }

        orders.push(po);
      }

      const created = await db.createPurchasePackage(
        input.orderIds,
        ctx.user.id,
        input.notes
      );

      if (!created) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "تعذّر إنشاء حزمة الشراء",
        });
      }

      if (input.notes?.trim()) {
        await queuePurchaseTranslation("PO_PACKAGE", Number(created.id), [
          { fieldName: "notes", text: input.notes.trim() },
        ], ctx.user.id);
      }

      return created;
    }),

  /**
   * جلب حزمة كاملة: رأسها + طلباتها + أصناف كل طلب.
   * قراءة صرفة — تجمّع من الدوال القائمة بلا اشتقاق حالة جديد.
   */
  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input, ctx }) => {
      assertCanPerformPOAction("viewPurchasePackage", ctx.user);

      const pkg = await db.getPurchasePackageById(input.id);
      if (!pkg) {
        throw new TRPCError({ code: "NOT_FOUND", message: "حزمة الشراء غير موجودة" });
      }

      const ordersWithItems = await getVisiblePackageOrdersWithItems(ctx.user, input.id);

      // لا نكشف حتى رأس الحزمة لمستخدم لا يملك رؤية أي طلب داخلها.
      if (ordersWithItems.length === 0) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "ليس لديك صلاحية للاطلاع على طلبات هذه الحزمة",
        });
      }

      const response = { ...pkg, orders: ordersWithItems.map(po => withPurchaseSubmissionTime({ ...po, items: isDelegateRole(ctx.user.role) ? po.items.filter((item: any) => Number(item.delegateId) === ctx.user.id) : po.items })) };
      const enrichedItems = await enrichExternalWorkshopPricingItems(response.orders.flatMap((po: any) => po.items));
      const enrichedById = new Map(enrichedItems.map((item: any) => [item.id, item]));
      response.orders = response.orders.map((po: any) => ({ ...po, items: po.items.map((item: any) => enrichedById.get(item.id) || item) }));
      if (isDelegateRole(ctx.user.role)) {
        return localizeMasterDataReferences({ ...response, createdByName: null,
          orders: response.orders.map((po: any) => ({ ...po, requestedByName: po.requestedByName ?? null,
            items: po.items.map((item: any) => ({ ...item, delegateName: null })) })) }, (ctx.user.preferredLanguage || "ar") as any);
      }
      return response;
    }),

  /** قائمة الحزم (بلا طلباتها) — للاستخدام الإداري/التشخيصي. */
  list: protectedProcedure.query(async ({ ctx }) => {
    assertCanPerformPOAction("viewPurchasePackage", ctx.user);
    const [packages, allOrders] = await Promise.all([
      db.getPurchasePackagesList(),
      db.getPurchaseOrders({}),
    ]);
    const visibleOrders = await filterVisiblePurchaseOrders(ctx.user, allOrders as any[]);
    const visiblePackageIds = new Set(
      visibleOrders
        .map((po: any) => po.packageId)
        .filter((id: any): id is number => typeof id === "number" && id > 0)
    );
    return packages.filter((pkg: any) => visiblePackageIds.has(pkg.id));
  }),

  /**
   * القائمة الموحّدة: بطاقة حزمة أو بطاقة طلب مفرد، بمفتاح مركّب
   * `package:<id>` / `po:<id>`. هذه هي الدالة التي تستهلكها كل شاشات
   * الدورة — نفس نمط getWarehouseTransferBatchCards المعتمد بالمشروع.
   *
   * فلترة المندوب: لو كان المستدعي مندوبًا، تُعاد له الطلبات التي لديه
   * فيها صنف واحد على الأقل فقط — بنفس فلترة getPOItemsByDelegate
   * الحالية حرفيًا، فلا صلاحية رؤية جديدة تُمنح.
   */
  cards: protectedProcedure.query(async ({ ctx }) => {
    assertCanPerformPOAction("viewPurchasePackage", ctx.user);
    const delegateId = isDelegateRole(ctx.user.role) ? ctx.user.id : undefined;
    const cards = await db.getPurchaseCards({ delegateId });

    // getPurchaseCards مسؤولة عن التجميع فقط. القرار الأمني النهائي يبقى
    // للحارس المركزي نفسه المستخدم في purchaseOrders.list/getById.
    const allCardOrders = cards.flatMap((card: any) =>
      card.cardType === "package" ? card.orders : [card.order]
    );
    const scope = await createPurchaseOrderReadScope(ctx.user, allCardOrders);
    const visibleOrders = scope.filter(allCardOrders);
    const visibleOrderIds = new Set(visibleOrders.map((po: any) => po.id));

    return cards.flatMap((card: any) => {
      if (card.cardType === "order") {
        return visibleOrderIds.has(card.order.id) ? [{ ...card, order: { ...card.order, items: scope.filterItems(card.order, card.order.items ?? []) } }] : [];
      }

      const orders = card.orders.filter((po: any) => visibleOrderIds.has(po.id)).map((po: any) => ({ ...po, items: scope.filterItems(po, po.items ?? []) }));
      return orders.length > 0 ? [{ ...card, orders }] : [];
    });
  }),

  /**
   * [PB-ACTIONABLE 2026-08-31] دفعات الإرسال التي تنتظر إجراء الحسابات
   * أو الإدارة العليا. قراءة فقط: لا تغيّر أي حالة أو ارتباط.
   *
   * الهدف هو أن يعرض تبويب «بانتظار إجرائي» دفعة الإرسال مرة واحدة بدل
   * تكرار كل PR تابع لها. الطلبات المفردة تبقى من purchaseOrders.actionableForMe
   * كما هي، وتقوم الواجهة فقط بإزالة PR الذي تم تمثيله بهذه الدفعة.
   */
  actionableSubmissionsForMe: protectedProcedure.query(async ({ ctx }) => {
    const targetBatchStatus =
      ctx.user.role === "accountant"
        ? "pending_accounting"
        : ctx.user.role === "senior_management"
          ? "pending_management"
          : null;

    // لا نضيف «إجراء» لأي دور آخر. المدير التنفيذي استعراض فقط، وبقية
    // الأدوار تستمر على actionableForMe الحالي دون تغيير.
    if (!targetBatchStatus) return { items: [], total: 0 };

    assertCanPerformPOAction("viewPurchasePackage", ctx.user);

    const [packages, allOrders] = await Promise.all([
      db.getPurchasePackagesList(),
      db.getPurchaseOrders({}),
    ]);
    const approvalReadScope = await createPurchaseOrderReadScope(ctx.user, allOrders as any[]);
    const visibleOrders = approvalReadScope.filter(allOrders as any[]);
    const visibleOrderById = new Map<number, any>(
      visibleOrders.map((po: any) => [Number(po.id), po] as [number, any])
    );
    const allOrderById = new Map<number, any>(allOrders.map((po: any) => [Number(po.id), po]));
    const visiblePoIdsByPackage = new Map<number, Set<number>>();

    for (const po of visibleOrders as any[]) {
      const packageId = Number(po.packageId || 0);
      if (!packageId) continue;
      const ids = visiblePoIdsByPackage.get(packageId) ?? new Set<number>();
      ids.add(Number(po.id));
      visiblePoIdsByPackage.set(packageId, ids);
    }

    const items: any[] = [];
    const submissionGroups = groupReadRows(
      await db.getPackageSubmissionsWithBatchesForPackages(Array.from(visiblePoIdsByPackage.keys())),
      row => Number(row.purchasePackageId),
    );

    for (const pkg of packages as any[]) {
      const visiblePoIds = visiblePoIdsByPackage.get(Number(pkg.id));
      if (!visiblePoIds || visiblePoIds.size === 0) continue;

      const submissions = submissionGroups.get(Number(pkg.id)) ?? [];
      for (const sub of submissions as any[]) {
        // الحسابات تقبل الإرسال الجديد ذي status=NULL أو pending_accounting.
        // الإدارة لا ترى إلا إرسالًا انتقل فعليًا إليها. هذه الشروط تطابق
        // حارسي الاعتماد الحاليين ولا تنشئ حالة جديدة.
        const submissionIsActionable =
          targetBatchStatus === "pending_accounting"
            ? sub.status == null || sub.status === "pending_accounting"
            : sub.status === "pending_management";
        if (!submissionIsActionable) continue;

        const actionableBatches = (sub.batches ?? []).filter((batch: any) => {
          const parent = visibleOrderById.get(Number(batch.purchaseOrderId));
          return parent && visiblePoIds.has(Number(batch.purchaseOrderId)) && batch.status === targetBatchStatus &&
            approvalReadScope.filterBatches(parent, [batch]).length > 0;
        });
        if (actionableBatches.length === 0) continue;
        const newlyScoped = actionableBatches.some((batch: any) =>
          approvalReadScope.isLegacyApprovalOnly(visibleOrderById.get(Number(batch.purchaseOrderId))));
        // The legacy button approves the complete submission. A new narrow
        // parent read must not turn a visible subset into an aggregate action.
        if (newlyScoped && (sub.batches ?? []).some((batch: any) => {
          const parent = allOrderById.get(Number(batch.purchaseOrderId));
          if (!parent || Number(parent.packageId) !== Number(pkg.id) || Number(batch.purchasePackageSubmissionId) !== Number(sub.id)) return true;
          if (batch.status === "rejected") return false;
          return batch.status !== targetBatchStatus || approvalReadScope.filterBatches(parent, [batch]).length === 0;
        })) continue;

        const orderIds = Array.from(new Set(
          actionableBatches.map((batch: any) => Number(batch.purchaseOrderId))
        ));
        const poNumbers = orderIds
          .map((id) => (visibleOrderById.get(id) as any)?.poNumber)
          .filter(Boolean);

        const batchesTotal = actionableBatches.reduce(
          (sum: number, batch: any) => sum + Number(batch.totalEstimatedCost || 0),
          0
        );
        const totalEstimatedCost =
          sub.totalEstimatedCost != null
            ? String(sub.totalEstimatedCost)
            : batchesTotal.toFixed(2);

        items.push({
          id: Number(sub.id),
          submissionId: Number(sub.id),
          packageId: Number(pkg.id),
          packageNumber: pkg.packageNumber,
          submissionNumber: `${pkg.packageNumber}-${sub.subNumber}`,
          subNumber: Number(sub.subNumber),
          status: targetBatchStatus,
          reason:
            targetBatchStatus === "pending_accounting"
              ? "دفعة إرسال تحتاج اعتمادك المحاسبي"
              : "دفعة إرسال تحتاج اعتمادك الإداري",
          actionLabel: "فتح الدفعة",
          orderIds,
          poNumbers,
          orderCount: orderIds.length,
          totalEstimatedCost,
          custodyBalance: sub.custodyBalance ?? null,
          createdAt: sub.createdAt,
        });
      }
    }

    items.sort((a, b) => {
      const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      if (aTime !== bTime) return bTime - aTime;
      return b.submissionId - a.submissionId;
    });

    return { items, total: items.length };
  }),

  /** إضافة طلب قائم إلى حزمة موجودة — بنفس شروط create. */
  addOrder: protectedProcedure
    .input(z.object({ packageId: z.number(), orderId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const pkg = await db.getPurchasePackageById(input.packageId);
      if (!pkg) {
        throw new TRPCError({ code: "NOT_FOUND", message: "حزمة الشراء غير موجودة" });
      }

      const po = await db.getPurchaseOrderById(input.orderId);
      if (!po) {
        throw new TRPCError({ code: "NOT_FOUND", message: "طلب الشراء غير موجود" });
      }

      // لا يغيّر المستخدم حزمة تحتوي طلبات لا يراها أصلًا. هذا تقييد
      // صلاحية فقط ولا يغيّر حالة أي طلب أو شرط مرحلة قائم.
      await assertCanAccessExistingPackageContents(ctx.user, input.packageId);
      await assertCanManageOrderThroughPackage(ctx.user, po);

      if (po.status !== GROUPABLE_STATUS) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `طلب الشراء ${po.poNumber} ليس بحالة "بانتظار المراجعة"`,
        });
      }

      if (po.packageId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `طلب الشراء ${po.poNumber} منتمٍ بالفعل لحزمة أخرى`,
        });
      }

      await db.addOrderToPackage(input.packageId, input.orderId);
      return { success: true };
    }),

  /**
   * إخراج طلب من حزمته — تصفير العمود فقط. الطلب وأصنافه وحالته ومساره
   * تبقى كما هي حرفيًا.
   */
  removeOrder: protectedProcedure
    .input(z.object({ orderId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const po = await db.getPurchaseOrderById(input.orderId);
      if (!po) {
        throw new TRPCError({ code: "NOT_FOUND", message: "طلب الشراء غير موجود" });
      }

      await assertCanManageOrderThroughPackage(ctx.user, po);

      if (!po.packageId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `طلب الشراء ${po.poNumber} غير منتمٍ لأي حزمة`,
        });
      }

      await db.removeOrderFromPackage(input.orderId);
      return { success: true };
    }),

  /**
   * حذف الحزمة: تصفير packageId على كل طلباتها ثم حذف رأسها.
   * هذا هو اختبار التراجع بعينه — بعده يعود النظام لعرض الطلبات مفردة
   * بسلوكه الحالي حرفيًا.
   */
  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const pkg = await db.getPurchasePackageById(input.id);
      if (!pkg) {
        throw new TRPCError({ code: "NOT_FOUND", message: "حزمة الشراء غير موجودة" });
      }

      // الحزمة الفارغة لا تحتوي PO نستمد منه الصلاحية؛ لذلك نثبت أن
      // المستدعي من الأدوار التي تملك أصلًا إدارة التجميع. لا كتابة هنا.
      assertCanPerformPOAction("createPurchasePackage", ctx.user, { status: GROUPABLE_STATUS });

      const orders = await db.getPurchaseOrdersByPackage(input.id);
      for (const po of orders) {
        await assertCanManageOrderThroughPackage(ctx.user, po);
      }

      await db.deletePurchasePackage(input.id);
      return { success: true };
    }),

  /**
   * [PB] إرسال دفعة فرعية: المندوب يسعّر أصنافًا من عدة طلبات داخل الحزمة
   * ثم يرسلها بضغطة واحدة.
   *
   * خلف الكواليس لا تُنشأ "دفعة تسعير عابرة للطلبات" — بل تُنشأ **دفعة
   * تسعير مستقلة لكل طلب** عبر نفس منطق الإرسال الحالي حرفيًا
   * (submitPricedBatchForPO)، وتُربط جميعها برقم إرسال فرعي واحد
   * (PB01-1، PB01-2...) لأغراض التتبّع والمستندات فقط.
   *
   * بهذا تصل الحسابات دفعات تسعير بنفس شكلها وآلية اعتمادها المعتادة
   * تمامًا، ولا يوجد مسار اعتماد ثانٍ موازٍ.
   *
   * الفشل الجزئي متوقّع وطبيعي: طلب بلا أصناف جاهزة يُتجاوَز بهدوء ويُبلَّغ
   * عنه في النتيجة، بدل إسقاط العملية كلها.
   */
  submitPackageBatch: protectedProcedure
    .input(z.object({ packageId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      if (!isDelegateRole(ctx.user.role)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "إرسال دفعة التسعير متاح للمندوب فقط",
        });
      }

      const pkg = await db.getPurchasePackageById(input.packageId);
      if (!pkg) {
        throw new TRPCError({ code: "NOT_FOUND", message: "حزمة الشراء غير موجودة" });
      }

      const packageOrders = await db.getPurchaseOrdersByPackage(input.packageId);
      if (packageOrders.length === 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "الحزمة لا تحتوي طلبات" });
      }

      // الدفعة الفرعية تُنشأ في نفس موضعها السابق بلا تغيير في ترتيب
      // الـWorkflow أو أثر الإرسال الحالي.
      const submission = await db.createPurchasePackageSubmission(
        input.packageId,
        ctx.user.id
      );
      if (!submission) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "تعذّر إنشاء الدفعة الفرعية",
        });
      }

      // [PB-P1] بعد إنشاء سجل الإرسال بنفس ترتيب السلوك السابق، نقصر
      // المعالجة والنتيجة على الطلبات التي يراها المندوب أصلًا. لا نغيّر
      // منطق submitPricedBatchForPO ولا توقيته ولا حالات الطلب/الصنف.
      const orders = await filterVisiblePurchaseOrders(ctx.user, packageOrders as any[]);

      const sent: { poNumber: string; batchId: any; itemCount: number }[] = [];
      const skipped: { poNumber: string; reason: string }[] = [];
      let firstSentPurchaseOrderId: number | null = null;

      for (const po of orders) {
        try {
          const res = await submitPricedBatchForPO(po.id, ctx.user, {
            purchasePackageSubmissionId: submission.id,
          });
          sent.push({
            poNumber: po.poNumber,
            batchId: res.batchId,
            itemCount: res.itemCount,
          });
          if (firstSentPurchaseOrderId == null) firstSentPurchaseOrderId = po.id;
        } catch (err: any) {
          // لا أصناف جاهزة بهذا الطلب — حالة طبيعية بالإرسال الجزئي، لا خطأ.
          skipped.push({
            poNumber: po.poNumber,
            reason: err?.message || "تعذّر الإرسال",
          });
        }
      }

      if (sent.length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "لا توجد أصناف مسعّرة جاهزة للإرسال في أي من طلبات الحزمة",
        });
      }

      const submissionNumber = `${(pkg as any).packageNumber}-${submission.subNumber}`;
      const pricingDocumentArchived = firstSentPurchaseOrderId != null
        ? await archiveDelegatePackageSubmissionPricingPdf({
            submissionId: submission.id,
            submissionNumber,
            firstPurchaseOrderId: firstSentPurchaseOrderId,
            delegateId: ctx.user.id,
          })
        : false;

      return {
        success: true,
        submissionNumber,
        subNumber: submission.subNumber,
        sent,
        skipped,
        pricingDocumentArchived,
      };
    }),

  /**
   * [PB-ACC 2026-08-31] اعتماد الحسابات على مستوى دفعة الإرسال الواحدة.
   *
   * هذا مسار إضافي للحزم فقط؛ approveAccountingBatch للطلب المفرد لم يتغير.
   * العهدة تُسجل مرة واحدة على purchase_package_submissions، ولا تُكرر على
   * Pricing Batches التابعة. حالات الأصناف لا تتغير هنا.
   */
  approveAccountingSubmission: accountantProcedure
    .input(z.object({
      submissionId: z.number(),
      custodyBalance: z.string().trim().min(1, "إجمالي رصيد العهد مطلوب"),
    }))
    .mutation(async ({ input, ctx }) => {
      await assertLegacyApprovalOutsideUnifiedBundle(await db.getDb(),{submissionId:input.submissionId});
      const custodyValue = Number(input.custodyBalance);
      if (!Number.isFinite(custodyValue) || custodyValue <= 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "إجمالي رصيد العهد التي على المندوب يجب أن يكون أكبر من صفر",
        });
      }

      const submission = await db.getPurchasePackageSubmissionById(input.submissionId);
      if (!submission) {
        throw new TRPCError({ code: "NOT_FOUND", message: "دفعة الإرسال غير موجودة" });
      }
      if (submission.status && submission.status !== "pending_accounting") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "دفعة الإرسال ليست بانتظار اعتماد الحسابات",
        });
      }

      const pkg = await db.getPurchasePackageById(submission.purchasePackageId);
      if (!pkg) {
        throw new TRPCError({ code: "NOT_FOUND", message: "حزمة الشراء المرتبطة غير موجودة" });
      }

      const batches = await db.getPricingBatchesBySubmission(input.submissionId);
      if (batches.length === 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "دفعة الإرسال لا تحتوي دفعات تسعير" });
      }

      // الدفعات المرفوضة بالكامل من الحسابات تعتبر نهائية ولا تعطل انتقال
      // بقية دفعة الإرسال. أي حالة أخرى غير pending_accounting/rejected تعني
      // أن الإرسال أصبح مختلط المراحل، وعندها لا ننفذ كتابة جزئية.
      const conflictingBatch = batches.find(
        (batch: any) => !["pending_accounting", "rejected"].includes(batch.status),
      );
      if (conflictingBatch) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "تعذر اعتماد دفعة الإرسال لأن إحدى دفعاتها انتقلت بالفعل لمرحلة أخرى؛ حدّث الصفحة",
        });
      }
      const approvableBatches = (batches as any[]).filter((batch: any) => batch.status === "pending_accounting");
      if (approvableBatches.length === 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "لا توجد دفعات تسعير بانتظار اعتماد الحسابات" });
      }

      const poById = new Map<number, any>();
      for (const batch of batches as any[]) {
        const po = await db.getPurchaseOrderById(batch.purchaseOrderId);
        if (!po) {
          throw new TRPCError({ code: "NOT_FOUND", message: "أحد طلبات الشراء المرتبطة بالدفعة غير موجود" });
        }
        await assertCanViewPurchaseOrder(ctx.user, po);
        poById.set(po.id, po);

        if (batch.status === "pending_accounting") {
          const batchItems = (await db.getPOItems(po.id)).filter((item: any) => item.batchId === batch.id);
          if (getActivePricingBatchItems(batchItems).length === 0) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `دفعة التسعير ${batch.batchNumber} في الطلب ${po.poNumber} لا تحتوي أصنافًا فعالة؛ حدّث الصفحة`,
            });
          }
        }
      }

      let result: any;
      try {
        result = await db.approvePackageSubmissionAccountingAtomic({
          submissionId: input.submissionId,
          actorId: ctx.user.id,
          custodyBalance: custodyValue.toFixed(2),
          accountingSignatureSnapshot: captureAccountingSignature(ctx.user),
        });
      } catch (error: any) {
        const message = String(error?.message || error || "");
        if (message.includes("STATUS_CONFLICT") || message.includes("EMPTY_BATCH") || message.includes("NO_APPROVABLE")) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "تغيرت بيانات دفعة الإرسال أثناء الاعتماد؛ حدّث الصفحة وحاول مرة أخرى",
          });
        }
        throw error;
      }

      // نحافظ على سجلات التدقيق لكل Pricing Batch حتى تبقى قابلية التتبع
      // الموجودة اليوم، لكن لا نؤرشف مستندًا منفصلًا لكل طلب لأن العهدة
      // أصبحت على مستوى دفعة الإرسال الواحدة. بعد هذه السجلات نؤرشف مستندًا
      // موحدًا واحدًا مرتبطًا مباشرةً بـ purchase_package_submission.
      for (const batch of result.batches as any[]) {
        await db.createAuditLog({
          userId: ctx.user.id,
          action: "approve_accounting_batch",
          entityType: "po_pricing_batch",
          entityId: Number(batch.id),
        });
      }

      const packageSubmissionNumber = `${(pkg as any).packageNumber}-${result.subNumber}`;
      const financialDocumentArchived = await archiveApprovedPackageSubmissionPdf({
        submissionId: input.submissionId,
        submissionNumber: packageSubmissionNumber,
        firstPurchaseOrderId: Number(result.poIds[0]),
        userId: ctx.user.id,
      });

      const mgmt = await db.getUsersByRole("senior_management");
      for (const manager of mgmt) {
        await db.createNotification({
          userId: manager.id,
          title: "دفعة طلبات بانتظار اعتماد الإدارة",
          message: `دفعة الإرسال ${packageSubmissionNumber} بانتظار اعتماد الإدارة العليا. إجمالي رصيد العهد التي على المندوب: ${custodyValue.toLocaleString("ar-SA")} ر.س.`,
          type: "warning",
          allowSeniorManagement: true,
        });
      }

      for (const poId of result.poIds as number[]) {
        await syncPathBTicketFromPurchaseOrder(
          poId,
          ctx.user.id,
          "تم اعتماد دفعة إرسال الحزمة من الحسابات",
        );
      }

      await db.createAuditLog({
        userId: ctx.user.id,
        action: "approve_accounting_package_submission",
        entityType: "purchase_package_submission",
        entityId: input.submissionId,
        newValues: {
          custodyBalance: custodyValue.toFixed(2),
          totalEstimatedCost: result.totalEstimatedCost,
        },
      });

      return {
        success: true,
        submissionId: input.submissionId,
        submissionNumber: packageSubmissionNumber,
        batchCount: result.batchIds.length,
        totalEstimatedCost: result.totalEstimatedCost,
        custodyBalance: custodyValue.toFixed(2),
        financialDocumentArchived,
      };
    }),

  /**
   * [PB-MGMT 2026-08-31] اعتماد الإدارة العليا على مستوى دفعة الإرسال.
   *
   * مسار الحزم فقط؛ approveManagementBatch للطلب المفرد يبقى كما هو.
   * يمكن تمرير أصناف مرفوضة من أزرار الصنف في الواجهة، وتُطبق مع الاعتماد
   * داخل نفس معاملة قاعدة البيانات حتى لا تنتج حالة اعتماد جزئي.
   */
  approveManagementSubmission: managementProcedure
    .input(z.object({
      submissionId: z.number(),
      rejections: z.array(z.object({
        itemId: z.number(),
        reason: z.string().trim().min(10, "سبب رفض الصنف يجب ألا يقل عن 10 أحرف"),
      })).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      await assertLegacyApprovalOutsideUnifiedBundle(await db.getDb(),{submissionId:input.submissionId});
      if (ctx.user.role === "executive_director") {
        throw new TRPCError({ code: "FORBIDDEN", message: "المدير التنفيذي لديه صلاحية استعراض فقط" });
      }

      const submission = await db.getPurchasePackageSubmissionById(input.submissionId);
      if (!submission) {
        throw new TRPCError({ code: "NOT_FOUND", message: "دفعة الإرسال غير موجودة" });
      }
      if (submission.status !== "pending_management") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "دفعة الإرسال ليست بانتظار اعتماد الإدارة" });
      }

      const pkg = await db.getPurchasePackageById(submission.purchasePackageId);
      if (!pkg) {
        throw new TRPCError({ code: "NOT_FOUND", message: "حزمة الشراء المرتبطة غير موجودة" });
      }

      const batches = await db.getPricingBatchesBySubmission(input.submissionId);
      if (batches.length === 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "دفعة الإرسال لا تحتوي دفعات تسعير" });
      }

      const conflictingBatch = (batches as any[]).find(
        (batch: any) => !["pending_management", "rejected"].includes(batch.status),
      );
      if (conflictingBatch) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "تعذر اعتماد دفعة الإرسال لأن إحدى دفعاتها ليست في مرحلة الإدارة؛ حدّث الصفحة",
        });
      }
      const approvableBatches = (batches as any[]).filter((batch: any) => batch.status === "pending_management");
      if (approvableBatches.length === 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "لا توجد دفعات تسعير بانتظار اعتماد الإدارة" });
      }

      const poById = new Map<number, any>();
      const validItemIds = new Set<number>();
      for (const batch of approvableBatches) {
        const po = await db.getPurchaseOrderById(batch.purchaseOrderId);
        if (!po) {
          throw new TRPCError({ code: "NOT_FOUND", message: "أحد طلبات الشراء المرتبطة بالدفعة غير موجود" });
        }
        await assertCanViewPurchaseOrder(ctx.user, po);
        poById.set(Number(po.id), po);

        const batchItems = (await db.getPOItems(po.id)).filter((item: any) => item.batchId === batch.id);
        if (getActivePricingBatchItems(batchItems).length === 0) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `دفعة التسعير ${batch.batchNumber} في الطلب ${po.poNumber} لا تحتوي أصنافًا فعالة؛ حدّث الصفحة`,
          });
        }
        for (const item of batchItems) {
          if (!["rejected", "cancelled"].includes(item.status)) validItemIds.add(Number(item.id));
        }
      }

      const rejections = input.rejections ?? [];
      const seen = new Set<number>();
      for (const rejection of rejections) {
        if (seen.has(rejection.itemId)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "تم إرسال نفس الصنف المرفوض أكثر من مرة" });
        }
        seen.add(rejection.itemId);
        if (!validItemIds.has(rejection.itemId)) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "أحد الأصناف المحددة للرفض لا ينتمي لدفعة الإرسال الحالية أو تغيرت حالته",
          });
        }
      }

      let result: any;
      try {
        result = await db.approvePackageSubmissionManagementAtomic({
          submissionId: input.submissionId,
          actorId: ctx.user.id,
          rejections,
        });
      } catch (error: any) {
        const message = String(error?.message || error || "");
        if (
          message.includes("STATUS_CONFLICT") ||
          message.includes("REJECTION_ITEM") ||
          message.includes("DUPLICATE_REJECTION") ||
          message.includes("NO_APPROVABLE")
        ) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "تغيرت بيانات دفعة الإرسال أثناء الاعتماد؛ حدّث الصفحة وحاول مرة أخرى",
          });
        }
        throw error;
      }

      const submissionNumber = `${(pkg as any).packageNumber}-${result.subNumber}`;

      // إشعارات رفض الأصناف تبقى على مستوى الصنف نفسه، كما في المسار الحالي.
      for (const rejectedItem of result.rejectedItems as any[]) {
        const po = poById.get(Number(rejectedItem.poId)) || await db.getPurchaseOrderById(Number(rejectedItem.poId));
        if (!po) continue;
        await notifyItemRejection({
          poId: Number(po.id),
          poNumber: po.poNumber,
          requestedById: Number(po.requestedById),
          itemId: Number(rejectedItem.itemId),
          itemName: rejectedItem.itemName,
          actorId: ctx.user.id,
          actorName: ctx.user.name || "مستخدم",
          actorRole: ctx.user.role,
          reason: rejectedItem.reason,
          kind: "rejected",
        });
      }

      // إذا أُغلق طلب بالكامل لأن كل أصنافه رُفضت/أُلغيت، نحافظ على إشعار
      // إغلاق الطلب الموجود في المسار القديم.
      for (const poId of result.rejectedPoIds as number[]) {
        const po = poById.get(Number(poId)) || await db.getPurchaseOrderById(Number(poId));
        if (!po) continue;
        await db.createNotification({
          userId: po.requestedById,
          title: "❌ طلب شراء مرفوض",
          message: `تم إغلاق طلب الشراء رقم ${po.poNumber || po.id} لأن جميع أصنافه أُلغيت أو رُفضت.`,
          type: "error",
          relatedPoId: po.id,
        });
      }

      // إشعار واحد للمندوب عن دفعة الإرسال بدل تكرار العهدة على كل طلب.
      if ((result.approvedBatchIds as number[]).length > 0 && result.delegateId) {
        const custodyText = result.custodyBalance
          ? ` إجمالي رصيد العهد التي عليك لهذه الدفعة: ${Number(result.custodyBalance).toLocaleString("ar-SA")} ر.س.`
          : "";
        await db.createNotification({
          userId: Number(result.delegateId),
          title: "✅ تم اعتماد دفعة الطلبات - ابدأ الشراء الآن",
          message: `تم اعتماد دفعة الإرسال ${submissionNumber} من الإدارة العليا.${custodyText} يمكنك البدء بشراء الأصناف المعتمدة.`,
          type: "success",
        });
      }

      for (const batchId of result.batchIds as number[]) {
        await db.createAuditLog({
          userId: ctx.user.id,
          action: "approve_management_batch",
          entityType: "po_pricing_batch",
          entityId: Number(batchId),
        });
      }

      for (const poId of result.poIds as number[]) {
        await syncPathBTicketFromPurchaseOrder(
          poId,
          ctx.user.id,
          "تم اعتماد دفعة إرسال الحزمة من الإدارة العليا",
        );
      }

      await db.createAuditLog({
        userId: ctx.user.id,
        action: "approve_management_package_submission",
        entityType: "purchase_package_submission",
        entityId: input.submissionId,
        newValues: {
          status: result.submissionStatus,
          rejectedItemCount: result.rejectedItems.length,
        },
      });

      return {
        success: true,
        submissionId: input.submissionId,
        submissionNumber,
        status: result.submissionStatus,
        approvedBatchCount: result.approvedBatchIds.length,
        rejectedBatchCount: result.rejectedBatchIds.length,
        rejectedItemCount: result.rejectedItems.length,
        custodyBalance: result.custodyBalance,
      };
    }),

  /**
   * [PB] الدفعات الفرعية لحزمة، مع دفعات التسعير التابعة لكل منها وأصنافها.
   *
   * هذا ما تراه الحسابات: إرسال واحد (PB01-1) يضم عدة دفعات تسعير، واحدة لكل
   * طلب. بعد اعتماد مسار الحزم الجديد، تبقى هذه الدالة للقراءة والعرض فقط،
   * بينما الاعتماد الجماعي يتم عبر approveAccountingSubmission أعلاه.
   */
  submissions: protectedProcedure
    .input(z.object({ packageId: z.number() }))
    .query(async ({ input, ctx }) => {
      assertCanPerformPOAction("viewPurchasePackage", ctx.user);

      const pkg = await db.getPurchasePackageById(input.packageId);
      if (!pkg) {
        throw new TRPCError({ code: "NOT_FOUND", message: "حزمة الشراء غير موجودة" });
      }

      const packageOrders = await db.getPurchaseOrdersByPackage(input.packageId);
      const readScope = await createPurchaseOrderReadScope(ctx.user, packageOrders);
      const visibleOrders = readScope.filter(packageOrders as any[]);
      const visiblePoIds = new Set(visibleOrders.map((po: any) => po.id));

      if (visiblePoIds.size === 0) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "ليس لديك صلاحية للاطلاع على دفعات هذه الحزمة",
        });
      }

      const subs = await db.getPackageSubmissionsWithBatches(input.packageId);
      const scope = await loadDocumentListPort(subs.map((sub: any) => ({
        entityType: "purchase_package_submission_financial", entityId: Number(sub.id),
      })), undefined, { actor: ctx.user, orders: packageOrders, authorize: readScope.assert });
      const orderById = new Map(packageOrders.map((po: any) => [Number(po.id), po]));
      const itemsByBatch = groupReadRows((await db.getFullPOItemsForPOs(Array.from(visiblePoIds).map(Number))).filter((item: any) => {
        const parent = orderById.get(Number(item.purchaseOrderId));
        return parent && readScope.filterItems(parent, [item]).length > 0;
      }), row => Number(row.batchId));

      // إثراء كل دفعة تسعير برقم طلبها وأصنافها — لعرض "رقم الطلب أمام كل صنف"
      // لا نضيف قيدًا خاصًا بالمندوب على الإرسال نفسه؛ نطاق الرؤية هنا
      // مشتق فقط من صلاحية طلب الشراء، مطابقةً لمبدأ المرحلة الأولى.
      const enriched = await Promise.all(
        subs.map(async (sub: any) => {
          const visibleBatches = (sub.batches ?? []).filter((b: any) => {
            const parent = orderById.get(Number(b.purchaseOrderId));
            return parent && visiblePoIds.has(b.purchaseOrderId) && readScope.filterBatches(parent, [b]).length > 0;
          });
          const presented = { ...sub };
          if (visibleBatches.length !== (sub.batches ?? []).length && visibleBatches.some((batch: any) =>
            readScope.isLegacyApprovalOnly(orderById.get(Number(batch.purchaseOrderId))))) {
            for (const field of Object.keys(presented)) {
              if (/^(accounting|management)/.test(field) || /SignatureSnapshot$/.test(field) ||
                ["totalEstimatedCost", "custodyBalance", "custodyAmount", "notes"].includes(field)) presented[field] = null;
            }
          }

          return {
            ...presented,
            ...await purchaseDocumentPermission(ctx.user, Number(visibleBatches[0]?.purchaseOrderId), undefined, Number(sub.id), scope),
            batches: visibleBatches.map((b: any) => {
              const po = orderById.get(Number(b.purchaseOrderId));
              const items = (itemsByBatch.get(Number(b.id)) ?? []).filter(i => Number(i.purchaseOrderId) === Number(b.purchaseOrderId));
              return {
                ...b,
                poNumber: po?.poNumber ?? "-",
                poStatus: po?.status ?? null,
                items,
              };
            }),
          };
        })
      );

      // لا نعيد إرسالًا أصبح بلا أي دفعة مرئية بعد تطبيق صلاحيات PO.
      return enriched.filter((sub: any) => (sub.batches ?? []).length > 0);
    }),
});

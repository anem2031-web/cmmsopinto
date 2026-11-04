import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { router, protectedProcedure, managerProcedure, accountantProcedure, managementProcedure } from "../_shared/procedures";
import * as db from "../../_core/db";
import { notifyItemRejection } from "../_shared/router-helpers";
import { assertCanPerformPOAction, assertCanReviewPurchaseOrderItems } from "../../_core/authz/guard";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { auditLogs, purchaseOrderItems, purchaseOrders, users } from "../../../drizzle/schema";
import { isRoutedPurchaseItem } from "../../../shared/purchase-item-review";
import { reviewRoutedPurchaseItems } from "../../services/purchase-item-review";
import { getActivePricingBatchItems, rejectPricingBatchIfEmpty } from "./pricing-batch-state";
import { syncPathBTicketFromPurchaseOrder } from "./ticket-purchase-workflow";
import { generatePurchaseRequestPDF } from "../../services/export/exportService";
import { captureAccountingSignature } from "../../services/pdf/accountingSignature";
import { storagePut } from "../../_core/storage";
import { createTranslatedProcurementComment, queuePurchaseTranslation } from "./translation-queue";
import { approveReplacementAccounting, approveReplacementManagement } from "../../supplier-return-followup/pricing-bridge";
import { assertNoReplacementOrder, assertSingleReplacementRejection, returnReplacementToDelegate } from "../../supplier-return-followup/repricing";
import { ReturnFollowupError } from "../../supplier-return-followup/policy";
import { assertLegacyApprovalOutsideUnifiedBundle } from "../../services/delegate-pricing-bundles/unified-feature";

/**
 * أرشفة نسخة PDF معتمدة من دفعة تسعير — قسم "الوثائق المالية المعتمدة"
 * بمركز المستندات (2026-08-10). تُستدعى **فقط** عند اعتماد الدفعة فعليًا من
 * الحسابات (لا عند رفضها بالكامل) — مستند "معتمد" لا معنى له لدفعة مرفوضة.
 *
 * تُستخدم **نفس** `generatePurchaseRequestPDF` التي يستدعيها زر "تصدير PDF
 * لهذه الدفعة" حرفيًا — لا تكرار منطق توليد PDF بمكان آخر.
 *
 * ⚠️ قرار مقصود (بموافقة صريحة): **لا تفشل عملية الاعتماد نفسها** لو فشلت
 * الأرشفة لأي سبب تقني (تخزين، شبكة...). الاعتماد المالي (تحديث الحالة
 * بقاعدة البيانات، الإشعارات) عملية حرجة يجب ألا تتوقف بسبب خطوة توثيقية
 * لاحقة — الخطأ يُسجَّل فقط، والمستخدم يستطيع دائمًا توليد نفس المستند يدويًا
 * عبر زر "تصدير PDF لهذه الدفعة" القائم أصلًا لو فشلت الأرشفة التلقائية.
 */
async function archiveApprovedFinancialBatchPdf(args: {
  poId: number;
  poNumber: string;
  batchId: number;
  batchNumber: number;
  userId: number;
}): Promise<boolean> {
  try {
    const buffer = await generatePurchaseRequestPDF(args.poId, args.userId, args.batchId);
    const fileName = `${args.poNumber}-دفعة${args.batchNumber}-معتمدة-حسابات.pdf`;
    // ⚠️ إصلاح 2026-08-10: المسار يجب أن يبدأ بـ "cmms/" (شرط صريح بحارس
    // `/api/media`)، والرابط المُخزَّن يجب أن يكون رابط البروكسي الداخلي لا
    // رابط التخزين الخام — نفس نمط `/api/upload` بالضبط (راجع تعليقه:
    // "Always return proxy URL so images load reliably regardless of bucket
    // ACL or CORS"). الرابط الخام كان يُحوِّل المستخدم لموقع iDrive نفسه بدل
    // الملف، لأن باكت iDrive e2 لا يضمن وصولاً عامًا موثوقًا بالرابط المباشر.
    const key = `cmms/financial-documents/po-${args.poId}/batch-${args.batchId}-${Date.now()}.pdf`;
    const { key: fileKey } = await storagePut(key, buffer, "application/pdf");
    const proxyUrl = `/api/media?key=${encodeURIComponent(fileKey)}`;
    await db.createAttachment({
      entityType: "po_financial_batch",
      entityId: args.batchId,
      fileName,
      fileUrl: proxyUrl,
      fileKey,
      mimeType: "application/pdf",
      fileSize: buffer.length,
      uploadedById: args.userId,
    });
    return true;
  } catch (e: any) {
    console.error("[ArchiveApprovedFinancialBatchPdf] Failed:", e?.message || e);
    // عمدًا: لا رمي خطأ هنا — راجع التعليق أعلى الدالة.
    return false;
  }
}

async function rejectPurchaseOrderIfAllItemsTerminal(
  po: any,
  actor: { id: number; name?: string | null },
  reason: string
): Promise<boolean> {
  const allItems = await db.getPOItems(po.id);
  const allTerminal = allItems.length > 0 && allItems.every((item) =>
    ["cancelled", "rejected"].includes(item.status)
  );
  if (!allTerminal) return false;

  if (po.status !== "rejected") {
    await db.updatePurchaseOrder(po.id, {
      status: "rejected",
      rejectedById: actor.id,
      rejectedAt: new Date(),
      rejectionReason: reason,
    });
    await db.createNotification({
      userId: po.requestedById,
      title: "❌ طلب شراء مرفوض",
      message: `تم إغلاق طلب الشراء رقم ${po.poNumber || po.id} لأن جميع أصنافه أُلغيت أو رُفضت.`,
      type: "error",
      relatedPoId: po.id,
    });
  }
  return true;
}

export const approvalsRouter = router({
  approveAccounting: accountantProcedure.input(z.object({
    id: z.number(),
    notes: z.string().optional(),
    custodyAmount: z.string().optional(),
    rejectedItemIds: z.array(z.number()).optional(),
    rejectionReason: z.string().optional(),
  })).mutation(async ({ input, ctx }) => {
    await assertLegacyApprovalOutsideUnifiedBundle(await db.getDb(),{poId:input.id});
    const po = await db.getPurchaseOrderById(input.id);
    if (!po) throw new TRPCError({ code: "NOT_FOUND", message: "طلب الشراء غير موجود" });
    // ✅ إصلاح: لم يكن هناك أي تحقق من مرحلة الطلب سابقًا — أي محاسب يقدر
    // يستدعي هذا الإجراء على طلب تجاوز مرحلة المحاسبة من زمان (معتمد، مرفوض،
    // مشترى...). الآن يُشترط أن يكون الطلب بالضبط بمرحلة pending_accounting.
    assertCanPerformPOAction("approveAccounting", ctx.user, po);
    await db.withTransaction(tx => assertNoReplacementOrder(tx, po.id));
    const items = await db.getPOItems(input.id);
    if (items.some((item: any) => item.reviewRole != null)) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "الطلب يحتوي مراجعات مستقلة للأصناف؛ اعتمد دفعة التسعير أو حزمة التسعير المحددة فقط" });
    
    // Process item rejections if any
    if (input.rejectedItemIds && input.rejectedItemIds.length > 0) {
      for (const itemId of input.rejectedItemIds) {
        // Verify item belongs to PO
        const item = items.find(i => i.id === itemId);
        if (item) {
          const reason = input.rejectionReason || "مرفوض من قبل الحسابات";
          const updated = await db.updatePOItemIfNotTerminal(itemId, {
            status: "rejected",
            managementRejectionReason: reason,
          });
          await queuePurchaseTranslation("PO_ITEM", itemId, [
            { fieldName: "managementRejectionReason", text: reason },
          ], ctx.user.id);
          if (!updated) {
            throw new TRPCError({ code: "CONFLICT", message: `الصنف "${item.itemName}" ملغى أو تغيرت حالته؛ قم بتحديث الصفحة` });
          }
          await db.createAuditLog({ 
            userId: ctx.user.id, 
            action: "reject_po_item", 
            entityType: "purchase_order_item", 
            entityId: itemId,
            newValues: { reason }
          });
          if (po) {
            await notifyItemRejection({
              poId: po.id,
              poNumber: po.poNumber,
              requestedById: po.requestedById,
              itemId: item.id,
              itemName: item.itemName,
              actorId: ctx.user.id,
              actorName: ctx.user.name || "مستخدم",
              actorRole: ctx.user.role,
              reason,
              kind: "rejected",
            });
          }
        }
      }
    }

          // Check if all items are now rejected or cancelled (needs_item_revision تُعدّ جانباً مؤقتاً)
    const updatedItems = await db.getPOItems(input.id);
    // الأصناف التي تُحسب للتقدم: تجاهل needs_item_revision — هي معلّقة ولكن لا تمنع الباقين
    const activeForAccounting = updatedItems.filter(i => i.status !== "needs_item_revision");
    const allRejected = activeForAccounting.length > 0 &&
      activeForAccounting.every(i => i.status === "rejected" || i.status === "cancelled");
    if (allRejected) {
      // If all items are rejected/cancelled, reject the entire PO
      await db.updatePurchaseOrder(input.id, { 
        status: "rejected", 
        rejectedById: ctx.user.id, 
        rejectedAt: new Date(), 
        rejectionReason: input.rejectionReason
          ? `${input.rejectionReason} (بواسطة ${ctx.user.name})`
          : `تم رفض جميع الأصناف من قبل الحسابات بواسطة ${ctx.user.name}`
      });
      
      // Notify PO creator
      if (po) {
        await db.createNotification({ userId: po.requestedById, title: "❌ طلب شراء مرفوض", message: `تم رفض جميع أصناف طلب الشراء رقم ${po.poNumber || input.id} من قبل الحسابات بواسطة ${ctx.user.name}.${input.rejectionReason ? ` السبب: ${input.rejectionReason}` : ""}`, type: "error", relatedPoId: input.id });
      }
    } else {
      // مبلغ العهدة إلزامي عند الاعتماد الفعلي (غير مطلوب في حالة الرفض الكامل أعلاه)
      const custodyValue = input.custodyAmount ? parseFloat(input.custodyAmount) : NaN;
      if (!input.custodyAmount || !input.custodyAmount.trim() || isNaN(custodyValue) || custodyValue <= 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "مبلغ العهدة إلزامي لاعتماد الطلب من الحسابات" });
      }
      // Normal flow: PO goes to management
      await db.updatePurchaseOrder(input.id, { status: "pending_management", accountingApprovedById: ctx.user.id, accountingApprovedAt: new Date(), accountingSignatureSnapshot: captureAccountingSignature(ctx.user), accountingNotes: input.notes, custodyAmount: input.custodyAmount || null });
      await queuePurchaseTranslation("PO", input.id, [
        { fieldName: "accountingNotes", text: input.notes },
      ], ctx.user.id);
      
      // Notify senior management
      const mgmt = await db.getUsersByRole("senior_management");
      const custodyMsg = input.custodyAmount ? ` مبلغ العهدة: ${Number(input.custodyAmount).toLocaleString("ar-SA")} ر.س.` : "";
      for (const m of mgmt) {
        await db.createNotification({ userId: m.id, title: "طلب شراء بانتظار اعتمادك", message: `طلب شراء رقم ${po?.poNumber || input.id} بانتظار اعتماد الإدارة العليا.${custodyMsg}`, type: "warning", relatedPoId: input.id, allowSeniorManagement: true });
      }
    }
    
    await syncPathBTicketFromPurchaseOrder(input.id, ctx.user.id, "تم اعتماد طلب الشراء من الحسابات");
    await db.createAuditLog({ userId: ctx.user.id, action: "approve_accounting", entityType: "purchase_order", entityId: input.id });
    return { success: true };
  }),

  // ── اعتماد دفعة تسعير واحدة من الحسابات (لا تؤثر على باقي الدفعات) ──
  approveAccountingBatch: accountantProcedure.input(z.object({
    batchId: z.number(),
    notes: z.string().optional(),
    custodyAmount: z.string().optional(),
    rejectedItemIds: z.array(z.number()).optional(),
    rejectionReason: z.string().optional(),
  })).mutation(async ({ input, ctx }) => {
    await assertLegacyApprovalOutsideUnifiedBundle(await db.getDb(),{batchId:input.batchId});
    const batch = await db.getPOPricingBatchById(input.batchId);
    if (!batch) throw new TRPCError({ code: "NOT_FOUND", message: "دفعة التسعير غير موجودة" });

    // [PB-ACC-GUARD 2026-09-02] دفعة التسعير المرتبطة بحزمة لا تُعتمد
    // منفردة؛ العهدة والاعتماد المالي موحّدان على purchase_package_submission.
    // هذا الحارس لا يغيّر مسار PR المستقل غير المرتبط بحزمة.
    if (batch.purchasePackageSubmissionId != null) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "هذه الدفعة تابعة لدفعة إرسال حزمة؛ اعتماد الحسابات وإجمالي رصيد العهد يتمان من دفعة الإرسال فقط",
      });
    }

    if (batch.status !== "pending_accounting") {
      throw new TRPCError({ code: "BAD_REQUEST", message: "هذه الدفعة ليست بانتظار اعتماد الحسابات" });
    }

    const po = await db.getPurchaseOrderById(batch.purchaseOrderId);
    if (!po) throw new TRPCError({ code: "NOT_FOUND", message: "طلب الشراء غير موجود" });

    const batchItems = (await db.getPOItems(batch.purchaseOrderId)).filter(i => i.batchId === batch.id);
    if (await rejectPricingBatchIfEmpty(batch, { actorId: ctx.user.id, actorName: ctx.user.name })) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "تم إغلاق هذه الدفعة لأن جميع أصنافها أُلغيت أو رُفضت؛ لا يوجد شيء لاعتماده",
      });
    }

    // معالجة رفض أصناف ضمن الدفعة (إن وجدت)
    if (input.rejectedItemIds && input.rejectedItemIds.length > 0) {
      await db.withTransaction(tx => assertSingleReplacementRejection(tx, po.id, input.rejectedItemIds!));
      if (input.rejectedItemIds.length === 1) {
        let returned = false;
        try {
          returned = await db.withTransaction(tx => returnReplacementToDelegate(tx, ctx.user.id, ctx.user.role,
            "accounting", batch.id, input.rejectedItemIds![0], input.rejectionReason || ""));
        } catch (error) {
          if (error instanceof ReturnFollowupError) throw new TRPCError({ code: error.code === "INVALID" ? "BAD_REQUEST" : error.code, message: error.message });
          throw error;
        }
        if (returned) {
          await db.createAuditLog({ userId: ctx.user.id, action: "return_replacement_for_repricing", entityType: "po_item",
            entityId: input.rejectedItemIds[0], newValues: { reason: input.rejectionReason, stage: "accounting" } });
          return { success: true, financialDocumentArchived: null };
        }
      }
      for (const itemId of input.rejectedItemIds) {
        const item = batchItems.find(i => i.id === itemId);
        if (item) {
          const reason = input.rejectionReason || "مرفوض من قبل الحسابات";
          const updated = await db.updatePOItemIfNotTerminal(itemId, { status: "rejected", managementRejectionReason: reason });
          await queuePurchaseTranslation("PO_ITEM", itemId, [
            { fieldName: "managementRejectionReason", text: reason },
          ], ctx.user.id);
          if (!updated) {
            throw new TRPCError({ code: "CONFLICT", message: `الصنف "${item.itemName}" ملغى أو تغيرت حالته؛ قم بتحديث الصفحة` });
          }
          await notifyItemRejection({
            poId: po.id, poNumber: po.poNumber, requestedById: po.requestedById,
            itemId: item.id, itemName: item.itemName, actorId: ctx.user.id, actorName: ctx.user.name || "مستخدم",
            actorRole: ctx.user.role, reason, kind: "rejected",
          });
        }
      }
    }

    const refreshedAccountingBatchItems = (await db.getPOItems(batch.purchaseOrderId)).filter(i => i.batchId === batch.id);
    const allBatchRejected = getActivePricingBatchItems(refreshedAccountingBatchItems).length === 0;
    let financialDocumentArchived: boolean | null = null;

    if (allBatchRejected) {
      await db.updatePOPricingBatch(batch.id, {
        status: "rejected", rejectedById: ctx.user.id, rejectedAt: new Date(), rejectionReason: input.rejectionReason,
      });
      await queuePurchaseTranslation("PO_BATCH", batch.id, [
        { fieldName: "rejectionReason", text: input.rejectionReason },
      ], ctx.user.id);
      await rejectPurchaseOrderIfAllItemsTerminal(
        po,
        ctx.user,
        input.rejectionReason || `تم إغلاق جميع أصناف الطلب أثناء اعتماد الحسابات بواسطة ${ctx.user.name || "مستخدم"}`
      );
    } else {
      // مبلغ العهدة إلزامي عند اعتماد الدفعة فعلياً (غير مطلوب في حالة رفض الدفعة بالكامل أعلاه)
      let replacementApproved = false;
      try {
        replacementApproved = await db.withTransaction(tx => approveReplacementAccounting(tx, ctx.user.id, batch.id,
          input.custodyAmount, input.notes, captureAccountingSignature(ctx.user)));
      } catch (error) {
        if (error instanceof ReturnFollowupError) throw new TRPCError({ code: error.code === "INVALID" ? "BAD_REQUEST" : error.code, message: error.message });
        throw error;
      }
      if (!replacementApproved) {
        const custodyValue = input.custodyAmount ? parseFloat(input.custodyAmount) : NaN;
        if (!input.custodyAmount || !input.custodyAmount.trim() || isNaN(custodyValue) || custodyValue <= 0) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "مبلغ العهدة إلزامي لاعتماد الدفعة من الحسابات" });
        }
        await db.updatePOPricingBatch(batch.id, {
          status: "pending_management",
          accountingApprovedById: ctx.user.id,
          accountingApprovedAt: new Date(),
          accountingSignatureSnapshot: captureAccountingSignature(ctx.user),
          accountingNotes: input.notes,
          custodyAmount: input.custodyAmount || null,
        });
      }
      // Synchronize the header before translation/PDF work. Otherwise a reader
      // can see an approved batch but the old header throughout PDF generation.
      const allBatchesAfterAccounting = await db.getPOPricingBatches(po.id);
      const anyStillPendingAccounting = allBatchesAfterAccounting.some(b => b.status === "pending_accounting");
      if (!anyStillPendingAccounting && po.status === "pending_accounting") {
        await db.updatePurchaseOrder(po.id, { status: "pending_management" });
      }
      await queuePurchaseTranslation("PO_BATCH", batch.id, [
        { fieldName: "accountingNotes", text: input.notes },
      ], ctx.user.id);

      // أرشفة نسخة معتمدة من مستند الدفعة — "الوثائق المالية المعتمدة" بمركز
      // المستندات (2026-08-10). راجع تعليق الدالة لسبب عدم رمي خطأ عند الفشل.
      financialDocumentArchived = await archiveApprovedFinancialBatchPdf({
        poId: po.id,
        poNumber: po.poNumber,
        batchId: batch.id,
        batchNumber: batch.batchNumber,
        userId: ctx.user.id,
      });

      const mgmt = await db.getUsersByRole("senior_management");
      for (const m of mgmt) {
        await db.createNotification({
          userId: m.id,
          title: "طلب شراء بانتظار اعتمادك",
          message: `طلب شراء رقم ${po.poNumber} — الدفعة رقم ${batch.batchNumber} (${batchItems.length} صنف) بانتظار اعتماد الإدارة العليا.`,
          type: "warning", relatedPoId: po.id, allowSeniorManagement: true,
        });
      }
    }

    await syncPathBTicketFromPurchaseOrder(
      po.id,
      ctx.user.id,
      "تم اعتماد دفعة تسعير من الحسابات",
    );
    await db.createAuditLog({
      userId: ctx.user.id, action: "approve_accounting_batch",
      entityType: "po_pricing_batch", entityId: batch.id,
    });
    return { success: true, financialDocumentArchived };
  }),

  /**
   * رفض صنف واحد فوريًا أثناء مراجعة الحسابات لدفعة تسعير — بند جديد
   * (2026-08-10)، بقرار صريح: الرفض ينفّذ فورًا ويخرج الصنف من الدفعة على
   * الفور، بدل تجميع الرفوضات وإرسالها مع اعتماد الدفعة النهائي.
   *
   * سبب مستقل لكل صنف (لا سبب مشترك) — الحد الأدنى 10 أحرف مفروض بالخادم لا
   * الواجهة فقط. مستقلة تمامًا عن `approveAccountingBatch` أعلاه (لم تُلمس).
   */
  /**
   * رفض صنف واحد فوريًا أثناء مراجعة الحسابات — بند (2026-08-10)، عُمِّم
   * لاحقًا بنفس اليوم ليخدم **مسارين معًا بإجراء واحد موحَّد**، بقرار صريح:
   * "وحّده ليشتغل بنفس طريقة رفض الصنف الفوري الجديدة" بدل زر "رفض الطلب
   * بالكامل" المنفصل بالمسار الاحتياطي القديم.
   *
   * - **صنف ضمن دفعة تسعير** (`item.batchId` موجود): يتحقق أن الدفعة
   *   `pending_accounting`، ويُغلقها تلقائيًا لو كان آخر صنف فعّال فيها.
   * - **صنف بلا دفعة** (المسار الاحتياطي القديم — طلبات لم تدخل نظام
   *   الدفعات): يتحقق أن **الطلب نفسه** `pending_accounting`، ويرفض الطلب
   *   كاملًا تلقائيًا لو كان آخر صنف فعّال به (نفس آلية `rejectPurchaseOrderIfAllItemsTerminal`
   *   المستخدَمة أصلًا بالمسارين).
   *
   * كلا المسارين يشتركان بنفس القيد (10 أحرف كحد أدنى بالخادم) ونفس مبدأ
   * "رفض فوري مستقل لكل صنف" — لا سبب مشترك، لا تجميع مع اعتماد لاحق.
   */
  rejectAccountingBatchItem: accountantProcedure.input(z.object({
    itemId: z.number(),
    reason: z.string().trim().min(10, "سبب الرفض يجب أن يكون 10 أحرف على الأقل"),
  })).mutation(async ({ input, ctx }) => {
    const item = await db.getPOItemById(input.itemId);
    if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "الصنف غير موجود" });
    if(item.batchId)await assertLegacyApprovalOutsideUnifiedBundle(await db.getDb(),{batchId:item.batchId});

    const po = await db.getPurchaseOrderById(item.purchaseOrderId);
    if (!po) throw new TRPCError({ code: "NOT_FOUND", message: "طلب الشراء غير موجود" });

    const batch = item.batchId ? await db.getPOPricingBatchById(item.batchId) : null;
    if (item.batchId && (!batch || batch.status !== "pending_accounting")) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "هذه الدفعة ليست بانتظار اعتماد الحسابات" });
    }
    // ⚠️ إصلاح 2026-08-10: بالمسار الاحتياطي (صنف بلا دفعة)، لا يكفي أن يكون
    // *الطلب* pending_accounting — قد يكون كذلك بسبب أصناف أخرى جاهزة بينما
    // هذا الصنف تحديدًا لا يزال عالقًا بمرحلة أبكر (مثال مؤكَّد: بانتظار حسم
    // "طلب تغيير المندوب"). الفحص الآن على *الصنف نفسه* أيضًا — إنفاذ حقيقي
    // بالخادم لا مجرد إخفاء زر بالواجهة.
    if (!item.batchId && (po.status !== "pending_accounting" || item.status !== "estimated" || item.delegateChangeRequestedAt)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "هذا الصنف ليس بانتظار اعتماد الحسابات" });
    }

    if (batch) {
      let returned = false;
      try {
        returned = await db.withTransaction(tx => returnReplacementToDelegate(tx, ctx.user.id, ctx.user.role,
          "accounting", batch.id, item.id, input.reason));
      } catch (error) {
        if (error instanceof ReturnFollowupError) throw new TRPCError({ code: error.code === "INVALID" ? "BAD_REQUEST" : error.code, message: error.message });
        throw error;
      }
      if (returned) {
        await db.createAuditLog({ userId: ctx.user.id, action: "return_replacement_for_repricing", entityType: "po_item",
          entityId: item.id, newValues: { reason: input.reason, stage: "accounting" } });
        return { success: true, batchNowClosed: true, poNowClosed: false };
      }
    }

    const updated = await db.updatePOItemIfNotTerminal(input.itemId, {
      status: "rejected",
      managementRejectionReason: input.reason,
    });
    if (!updated) {
      throw new TRPCError({ code: "CONFLICT", message: `الصنف "${item.itemName}" ملغى أو تغيرت حالته بالفعل؛ قم بتحديث الصفحة` });
    }

    await notifyItemRejection({
      poId: po.id, poNumber: po.poNumber, requestedById: po.requestedById,
      itemId: item.id, itemName: item.itemName, actorId: ctx.user.id, actorName: ctx.user.name || "مستخدم",
      actorRole: ctx.user.role, reason: input.reason, kind: "rejected",
    });

    let batchNowClosed = false;
    let poNowClosed = false;

    if (batch) {
      // لو كان هذا آخر صنف فعّال بالدفعة، أُغلقها تلقائيًا كمرفوضة بالكامل —
      // نفس نمط rejectPricingBatchIfEmpty المستخدَم بإجراءات أخرى بهذا الملف.
      const refreshedItems = (await db.getPOItems(item.purchaseOrderId)).filter(i => i.batchId === batch.id);
      const stillActive = getActivePricingBatchItems(refreshedItems);
      if (stillActive.length === 0) {
        await db.updatePOPricingBatch(batch.id, {
          status: "rejected", rejectedById: ctx.user.id, rejectedAt: new Date(), rejectionReason: input.reason,
        });
        await rejectPurchaseOrderIfAllItemsTerminal(
          po, ctx.user,
          `تم رفض جميع أصناف الدفعة أثناء مراجعة الحسابات بواسطة ${ctx.user.name || "مستخدم"}`,
        );
        const currentItems = await db.getPOItems(po.id);
        if (currentItems.some(i => !["cancelled", "rejected"].includes(i.status))) {
          const batches = await db.getPOPricingBatches(po.id);
          const hasPending = batches.some(b => b.status === "pending_accounting" || b.status === "pending_management");
          if (!hasPending && po.status === "pending_accounting" && batches.some(b => b.status === "approved")) {
            await db.updatePurchaseOrder(po.id, { status: "approved" });
          }
        }
        batchNowClosed = true;
      }
    } else {
      // المسار الاحتياطي بلا دفعة: الطلب يُرفض كاملًا تلقائيًا لو كان هذا آخر صنف فعّال به.
      poNowClosed = await rejectPurchaseOrderIfAllItemsTerminal(
        po, ctx.user,
        `تم رفض جميع أصناف الطلب أثناء مراجعة الحسابات بواسطة ${ctx.user.name || "مستخدم"}`,
      );
    }

    await db.createAuditLog({
      userId: ctx.user.id, action: "reject_accounting_batch_item",
      entityType: "po_item", entityId: item.id, newValues: { reason: input.reason },
    });

    return { success: true, batchNowClosed, poNowClosed };
  }),

  // ── اعتماد دفعة تسعير واحدة من الإدارة العليا (بعد اعتماد الحسابات لها) ──
  approveManagementBatch: managementProcedure.input(z.object({
    batchId: z.number(),
    notes: z.string().optional(),
    rejectedItemIds: z.array(z.number()).optional(),
    rejectionReason: z.string().optional(),
  })).mutation(async ({ input, ctx }) => {
    await assertLegacyApprovalOutsideUnifiedBundle(await db.getDb(),{batchId:input.batchId});
    if (ctx.user.role === "executive_director") {
      throw new TRPCError({ code: "FORBIDDEN", message: "المدير التنفيذي لديه صلاحية استعراض فقط" });
    }
    const batch = await db.getPOPricingBatchById(input.batchId);
    if (!batch) throw new TRPCError({ code: "NOT_FOUND", message: "دفعة التسعير غير موجودة" });
    if (batch.status !== "pending_management") {
      throw new TRPCError({ code: "BAD_REQUEST", message: "هذه الدفعة ليست بانتظار اعتماد الإدارة" });
    }

    const po = await db.getPurchaseOrderById(batch.purchaseOrderId);
    if (!po) throw new TRPCError({ code: "NOT_FOUND", message: "طلب الشراء غير موجود" });
    const batchItems = (await db.getPOItems(batch.purchaseOrderId)).filter(i => i.batchId === batch.id);
    if (await rejectPricingBatchIfEmpty(batch, { actorId: ctx.user.id, actorName: ctx.user.name })) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "تم إغلاق هذه الدفعة لأن جميع أصنافها أُلغيت أو رُفضت؛ لا يوجد شيء لاعتماده",
      });
    }

    if (input.rejectedItemIds && input.rejectedItemIds.length > 0) {
      await db.withTransaction(tx => assertSingleReplacementRejection(tx, po.id, input.rejectedItemIds!));
      if (input.rejectedItemIds.length === 1) {
        let returned = false;
        try {
          returned = await db.withTransaction(tx => returnReplacementToDelegate(tx, ctx.user.id, ctx.user.role,
            "management", batch.id, input.rejectedItemIds![0], input.rejectionReason || ""));
        } catch (error) {
          if (error instanceof ReturnFollowupError) throw new TRPCError({ code: error.code === "INVALID" ? "BAD_REQUEST" : error.code, message: error.message });
          throw error;
        }
        if (returned) {
          await db.createAuditLog({ userId: ctx.user.id, action: "return_replacement_for_repricing", entityType: "po_item",
            entityId: input.rejectedItemIds[0], newValues: { reason: input.rejectionReason, stage: "management" } });
          return { success: true };
        }
      }
      for (const itemId of input.rejectedItemIds) {
        const item = batchItems.find(i => i.id === itemId);
        if (item) {
          const reason = input.rejectionReason || "مرفوض من قبل الإدارة";
          const updated = await db.updatePOItemIfNotTerminal(itemId, { status: "rejected", managementRejectionReason: reason });
          await queuePurchaseTranslation("PO_ITEM", itemId, [
            { fieldName: "managementRejectionReason", text: reason },
          ], ctx.user.id);
          if (!updated) {
            throw new TRPCError({ code: "CONFLICT", message: `الصنف "${item.itemName}" ملغى أو تغيرت حالته؛ قم بتحديث الصفحة` });
          }
          await notifyItemRejection({
            poId: po.id, poNumber: po.poNumber, requestedById: po.requestedById,
            itemId: item.id, itemName: item.itemName, actorId: ctx.user.id, actorName: ctx.user.name || "مستخدم",
            actorRole: ctx.user.role, reason, kind: "rejected",
          });
        }
      }
    }

    const refreshedManagementBatchItems = (await db.getPOItems(batch.purchaseOrderId)).filter(i => i.batchId === batch.id);
    const allBatchRejected = getActivePricingBatchItems(refreshedManagementBatchItems).length === 0;

    if (allBatchRejected) {
      await db.updatePOPricingBatch(batch.id, {
        status: "rejected", rejectedById: ctx.user.id, rejectedAt: new Date(), rejectionReason: input.rejectionReason,
      });
      await queuePurchaseTranslation("PO_BATCH", batch.id, [
        { fieldName: "rejectionReason", text: input.rejectionReason },
      ], ctx.user.id);
      await rejectPurchaseOrderIfAllItemsTerminal(
        po,
        ctx.user,
        input.rejectionReason || `تم إغلاق جميع أصناف الطلب أثناء اعتماد الإدارة بواسطة ${ctx.user.name || "مستخدم"}`
      );
    } else {
      let replacementApproved = false;
      try {
        replacementApproved = await db.withTransaction(tx => approveReplacementManagement(tx, ctx.user.id, batch.id, input.notes));
      } catch (error) {
        if (error instanceof ReturnFollowupError) throw new TRPCError({ code: error.code === "INVALID" ? "BAD_REQUEST" : error.code, message: error.message });
        throw error;
      }
      if (!replacementApproved) await db.updatePOPricingBatch(batch.id, {
        status: "approved", managementApprovedById: ctx.user.id, managementApprovedAt: new Date(), managementNotes: input.notes,
      });
      await queuePurchaseTranslation("PO_BATCH", batch.id, [
        { fieldName: "managementNotes", text: input.notes },
      ], ctx.user.id);

      for (const item of replacementApproved ? [] : refreshedManagementBatchItems) {
        if (item.status !== "rejected" && item.status !== "cancelled") {
          await db.updatePOItem(item.id, { status: "approved" });
        }
      }

      // ── تحديث حالة الطلب العامة على أساس مجموع الدفعات ──
      const allBatches = await db.getPOPricingBatches(po.id);
      const anyPending = allBatches.some(b => b.status === "pending_accounting" || b.status === "pending_management");
      if (!anyPending && po.status !== "approved") {
        await db.updatePurchaseOrder(po.id, { status: "approved", managementApprovedById: ctx.user.id, managementApprovedAt: new Date() });
      }

      const approvedBatchItems = (await db.getPOItems(batch.purchaseOrderId)).filter(
        i => i.batchId === batch.id && i.status === "approved"
      );
      const delegateIds = Array.from(new Set(approvedBatchItems.filter(i => i.delegateId).map(i => i.delegateId!)));
      const custodyInfoBatch = batch.custodyAmount
        ? ` مبلغ العهدة المُصرف لك: ${Number(batch.custodyAmount).toLocaleString("ar-SA")} ر.س.`
        : "";
      for (const dId of delegateIds) {
        const delegateItems = approvedBatchItems.filter(i => i.delegateId === dId);
        const itemNames = delegateItems.map(i => i.itemName).join("، ");
        await db.createNotification({
          userId: dId,
          title: "✅ تم اعتماد دفعة من طلب الشراء - ابدأ الشراء الآن",
          message: `تم اعتماد الدفعة رقم ${batch.batchNumber} من طلب الشراء رقم ${po.poNumber}. الأصناف: ${itemNames}.${custodyInfoBatch} يمكنك البدء بالشراء فوراً.`,
          type: "success", relatedPoId: po.id,
        });
      }
    }

    await syncPathBTicketFromPurchaseOrder(
      po.id,
      ctx.user.id,
      "تم اعتماد دفعة تسعير من الإدارة",
    );
    await db.createAuditLog({
      userId: ctx.user.id, action: "approve_management_batch",
      entityType: "po_pricing_batch", entityId: batch.id,
    });
    return { success: true };
  }),

  approveManagement: managementProcedure.input(z.object({
    id: z.number(),
    notes: z.string().optional(),
    rejectedItemIds: z.array(z.number()).optional(),
    rejectionReason: z.string().optional(),
  })).mutation(async ({ input, ctx }) => {
    await assertLegacyApprovalOutsideUnifiedBundle(await db.getDb(),{poId:input.id});
    const po = await db.getPurchaseOrderById(input.id);
    if (!po) throw new TRPCError({ code: "NOT_FOUND", message: "طلب الشراء غير موجود" });
    // ✅ الحارس المركزي: يستبدل الفحص اليدوي لاستثناء executive_director (نفس
    // النتيجة، موحَّدة بـpolicy.ts)، ويضيف فحصًا كان غائبًا تمامًا: يُشترط أن
    // يكون الطلب بالضبط بمرحلة pending_management (كان أي senior_management
    // يقدر يعتمد طلبًا تجاوز هذي المرحلة من زمان).
    assertCanPerformPOAction("approveManagement", ctx.user, po);
    await db.withTransaction(tx => assertNoReplacementOrder(tx, po.id));
    const items = await db.getPOItems(input.id);
    if (items.some((item: any) => item.reviewRole != null)) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "الطلب يحتوي مراجعات مستقلة للأصناف؛ اعتمد دفعة التسعير أو حزمة التسعير المحددة فقط" });

    // Process item rejections if any
    if (input.rejectedItemIds && input.rejectedItemIds.length > 0) {
      for (const itemId of input.rejectedItemIds) {
        // Verify item belongs to PO
        const item = items.find(i => i.id === itemId);
        if (item) {
          const reason = input.rejectionReason || "مرفوض من قبل الإدارة";
          const updated = await db.updatePOItemIfNotTerminal(itemId, {
            status: "rejected",
            managementRejectionReason: reason,
          });
          await queuePurchaseTranslation("PO_ITEM", itemId, [
            { fieldName: "managementRejectionReason", text: reason },
          ], ctx.user.id);
          if (!updated) {
            throw new TRPCError({ code: "CONFLICT", message: `الصنف "${item.itemName}" ملغى أو تغيرت حالته؛ قم بتحديث الصفحة` });
          }
          await db.createAuditLog({ 
            userId: ctx.user.id, 
            action: "reject_po_item", 
            entityType: "purchase_order_item", 
            entityId: itemId,
            newValues: { reason }
          });
          if (po) {
            await notifyItemRejection({
              poId: po.id,
              poNumber: po.poNumber,
              requestedById: po.requestedById,
              itemId: item.id,
              itemName: item.itemName,
              actorId: ctx.user.id,
              actorName: ctx.user.name || "مستخدم",
              actorRole: ctx.user.role,
              reason,
              kind: "rejected",
            });
          }
        }
      }
    }

    // Check if all items are now rejected or cancelled
    const updatedItems = await db.getPOItems(input.id);
    const allRejected = updatedItems.every(i => i.status === "rejected" || i.status === "cancelled");

    if (allRejected) {
      // If all items are rejected/cancelled, reject the entire PO
      await db.updatePurchaseOrder(input.id, { 
        status: "rejected", 
        rejectedById: ctx.user.id, 
        rejectedAt: new Date(), 
        rejectionReason: input.rejectionReason
          ? `${input.rejectionReason} (بواسطة ${ctx.user.name})`
          : `تم رفض جميع الأصناف من قبل الإدارة بواسطة ${ctx.user.name}`
      });
      
      // Notify PO creator
      if (po) {
        await db.createNotification({ userId: po.requestedById, title: "❌ طلب شراء مرفوض", message: `تم رفض جميع أصناف طلب الشراء رقم ${po.poNumber || input.id} من قبل الإدارة بواسطة ${ctx.user.name}.${input.rejectionReason ? ` السبب: ${input.rejectionReason}` : ""}`, type: "error", relatedPoId: input.id });
      }
      
      await syncPathBTicketFromPurchaseOrder(input.id, ctx.user.id, "رُفضت جميع أصناف طلب الشراء");
      await db.createAuditLog({ userId: ctx.user.id, action: "approve_management", entityType: "purchase_order", entityId: input.id, newValues: { status: "rejected_all_items" } });
      return { success: true };
    }

    // Normal flow: PO is approved (partially or fully)
    await db.updatePurchaseOrder(input.id, {
      status: "approved",
      managementApprovedById: ctx.user.id,
      managementApprovedAt: new Date(),
      managementNotes: input.notes
    });
    await queuePurchaseTranslation("PO", input.id, [
      { fieldName: "managementNotes", text: input.notes },
    ], ctx.user.id);

    // ── اعتمد الأصناف الجاهزة فقط ──
    // الأصناف في needs_item_revision تبقى كما هي — ستُعتمد تلقائياً لاحقاً
    // عندما يسعّرها المندوب بعد تعديل المنشئ، تنتقل مباشرة لـ approved
    for (const item of updatedItems) {
      if (
        item.status !== "rejected" &&
        item.status !== "cancelled" &&
        item.status !== "needs_item_revision"
      ) {
        await db.updatePOItem(item.id, { status: "approved" });
      }
    }

    // Notify delegates — only for non-rejected/non-cancelled items
    const approvedItemsForNotif = updatedItems.filter(
      i =>
        i.status !== "rejected" &&
        i.status !== "cancelled" &&
        i.status !== "needs_item_revision"
    );

    const delegateIds = Array.from(
      new Set(
        approvedItemsForNotif
          .filter(i => i.delegateId)
          .map(i => i.delegateId!)
      )
    );

    for (const dId of delegateIds) {
      const delegateItems = items.filter(i => i.delegateId === dId);
      const itemNames = delegateItems.map(i => i.itemName).join("، ");
      const custodyInfo = po?.custodyAmount
        ? ` مبلغ العهدة المُصرف لك: ${Number(po.custodyAmount).toLocaleString("ar-SA")} ر.س.`
        : "";

      await db.createNotification({
        userId: dId,
        title: "✅ تم اعتماد طلب الشراء - ابدأ الشراء الآن",
        message: `تم اعتماد طلب الشراء رقم ${po?.poNumber || input.id} من قِبل الإدارة. الأصناف المطلوبة منك: ${itemNames}.${custodyInfo} يمكنك البدء بالشراء فوراً.`,
        type: "success",
        relatedPoId: input.id
      });
    }

    // If no delegates assigned, notify managers
    if (delegateIds.length === 0) {
      const managers = await db.getPurchaseManagerUsers();
      for (const mgr of managers) {
        await db.createNotification({
          userId: mgr.id,
          title: "✅ تم اعتماد طلب الشراء",
          message: `تم اعتماد طلب الشراء رقم ${po?.poNumber || input.id}. لا يوجد مندوب مُعيَّن للأصناف.`,
          type: "warning",
          relatedPoId: input.id
        });
      }
    }
    // المسار C يبقى لدى المندوب بعد الاعتماد، ولا تُخطر الحراسة بالدخول إلا بعد تأكيد اكتمال الصيانة الخارجية.
    await syncPathBTicketFromPurchaseOrder(input.id, ctx.user.id, "تم اعتماد طلب الشراء من الإدارة");
    await db.createAuditLog({ userId: ctx.user.id, action: "approve_management", entityType: "purchase_order", entityId: input.id });
    return { success: true };
  }),

  reject: protectedProcedure.input(z.object({
    id: z.number(),
    reason: z.string().min(1),
  })).mutation(async ({ input, ctx }) => {
    const poReject = await db.getPurchaseOrderById(input.id);
    if (!poReject) throw new TRPCError({ code: "NOT_FOUND", message: "طلب الشراء غير موجود" });

    // ✅ الحارس المركزي (server/_core/authz) — يستبدل الفحص اليدوي الذي كان هنا
    // سابقًا. القاعدة (accountant فقط بـpending_accounting، senior_management
    // فقط بـpending_management، admin/owner دائمًا) معرَّفة الآن بـpolicy.ts فقط.
    assertCanPerformPOAction("reject", ctx.user, poReject);
    if ((await db.getPOItems(input.id)).some((item: any) => item.reviewRole != null)) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "هذا الطلب يحوي أصنافًا بمراجعات مستقلة؛ ارفض الأصناف من دفعة أو حزمة التسعير الخاصة بها" });
    }
    await assertLegacyApprovalOutsideUnifiedBundle(await db.getDb(),{poId:input.id,pendingOnly:true});
    await db.withTransaction(tx => assertNoReplacementOrder(tx, poReject.id));

    await db.updatePurchaseOrder(input.id, { status: "rejected", rejectedById: ctx.user.id, rejectedAt: new Date(), rejectionReason: input.reason });
    await queuePurchaseTranslation("PO", input.id, [
      { fieldName: "rejectionReason", text: input.reason },
    ], ctx.user.id);
    await createTranslatedProcurementComment(db, {
      purchaseOrderId: input.id,
      userId: ctx.user.id,
      userName: ctx.user.name || "مستخدم",
      userRole: ctx.user.role,
      actionType: "po_rejected",
      note: `تم رفض طلب الشراء بالكامل\n\nالسبب:\n${input.reason}`,
    });
    // Notify PO creator and managers
    if (poReject?.requestedById && poReject.requestedById !== ctx.user.id) {
      await db.createNotification({ userId: poReject.requestedById, title: "❌ تم رفض طلب الشراء", message: `تم رفض طلب الشراء رقم ${poReject.poNumber} بواسطة ${ctx.user.name}. السبب: ${input.reason}`, type: "critical", relatedPoId: input.id });
    }
    const managersReject = await db.getPurchaseManagerUsers();
    for (const mgr of managersReject) {
      if (mgr.id !== ctx.user.id) {
        await db.createNotification({ userId: mgr.id, title: "❌ رفض طلب شراء", message: `تم رفض طلب الشراء رقم ${poReject?.poNumber || input.id} بواسطة ${ctx.user.name}. السبب: ${input.reason}`, type: "critical", relatedPoId: input.id });
      }
    }
    await syncPathBTicketFromPurchaseOrder(input.id, ctx.user.id, "تم رفض طلب الشراء");
    return { success: true };
  }),

  reviewItems: protectedProcedure.input(z.object({
    poId: z.number(),
    items: z.array(z.object({
      id: z.number(),
      action: z.enum(["approve", "reject"]),
      delegateId: z.number().optional(),
      rejectionReason: z.string().optional(),
    })),
  })).mutation(async ({ input, ctx }) => {
    const po = await db.getPurchaseOrderById(input.poId);
    if (!po) throw new TRPCError({ code: "NOT_FOUND", message: "طلب الشراء غير موجود" });

    const routedOrder = (await db.getPOItems(input.poId)).some(isRoutedPurchaseItem);
    // Historical orders keep their original all-items review and role grants.
    if (!routedOrder) assertCanPerformPOAction("reviewItems", ctx.user, po);

    // مدير المستودع الغذائي: مقيّد إضافيًا بطلبات مساعد المستودع الغذائي أو
    // طلباته هو شخصياً فقط — هذا قيد ملكية خاص بالدور، غير معرَّف بـpolicy.ts
    // العام (نفس نمط getById لهذا الدور)، فيُفحص هنا إضافةً على فحص الحارس.
    if (ctx.user.role === "food_warehouse_manager") {
      const requester = po.requestedById ? await db.getUserById(po.requestedById) : null;
      const isOwnRequest = po.requestedById === ctx.user.id;
      const isAssistantRequest = (requester as any)?.role === "food_warehouse_assistant";
      if (!isOwnRequest && !isAssistantRequest) {
        throw new TRPCError({ code: "FORBIDDEN", message: "لا يمكنك اعتماد هذا الطلب" });
      }
    }

    // جميع قرارات المراجعة وتغيير حالة الطلب تُنفذ داخل معاملة واحدة. كما أن
    // كل تحديث صنف مشروط ببقائه غير cancelled/rejected لحظة الكتابة، حتى لا
    // يعيد سباق تزامن مع الإلغاء تنشيط الصنف بعد إلغائه.
    const result = routedOrder ? await db.withTransaction(async (tx: any) => reviewRoutedPurchaseItems(ctx.user, input, {
      lockOrder: async id => (await tx.select().from(purchaseOrders).where(eq(purchaseOrders.id, id)).limit(1).for("update"))[0] || null,
      readItems: id => db.getPOItems(id, tx),
      readUsers: ids => tx.select().from(users).where(inArray(users.id, ids)).for("update"),
      authorize: (actor, currentOrder, items) => assertCanReviewPurchaseOrderItems(actor, currentOrder, items),
      updateItem: async (item, changes, actor) => {
        const updated: any = await tx.update(purchaseOrderItems).set(changes).where(and(
          eq(purchaseOrderItems.id, item.id), eq(purchaseOrderItems.purchaseOrderId, input.poId),
          eq(purchaseOrderItems.reviewRole, item.reviewRole as any), eq(purchaseOrderItems.status, "pending_review"),
          isNull(purchaseOrderItems.reviewedById), isNull(purchaseOrderItems.reviewedAt),
        ));
        if (Number(updated?.[0]?.affectedRows ?? 0) !== 1) return false;
        await db.createPOItemHistoryEvent({
          purchaseOrderItemId: item.id, purchaseOrderId: input.poId, eventType: "review_decision",
          previousStatus: item.status, newStatus: changes.status,
          previousDelegateId: item.delegateId, newDelegateId: changes.delegateId ?? item.delegateId,
          actorUserId: actor.id, actorName: actor.name,
          note: changes.status === "pending" ? "موافقة المراجع وإرسال الصنف للمندوب" : changes.managementRejectionReason,
          metadata: { reviewRole: item.reviewRole, reviewedById: actor.id },
        }, tx);
        return true;
      },
      updateOrder: (id, changes) => db.updatePurchaseOrder(id, changes, tx),
      audit: async (actor, currentOrder, decisions) => {
        await tx.insert(auditLogs).values({ userId: actor.id, action: "review_po_items", entityType: "purchase_order", entityId: currentOrder.id,
          newValues: { itemIds: decisions.map(item => item.id), decisions, routedReview: true },
        });
      },
    })) : await db.withTransaction(async (tx: any) => {
      const dbItems = await db.getPOItems(input.poId, tx);
      const reviewableItems = dbItems.filter(
        (item: any) => !["cancelled", "rejected"].includes(item.status)
      );

      if (input.items.length !== reviewableItems.length) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `يجب مراجعة جميع الأصناف القابلة للمراجعة (${reviewableItems.length} صنف). تم إرسال ${input.items.length} فقط`,
        });
      }

      const reviewableById = new Map(reviewableItems.map((item: any) => [item.id, item]));
      for (const reviewItem of input.items) {
        if (!reviewableById.has(reviewItem.id)) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `الصنف رقم ${reviewItem.id} غير قابل للمراجعة أو لا ينتمي لطلب الشراء هذا`,
          });
        }
        if (reviewItem.action === "approve" && !reviewItem.delegateId) {
          throw new TRPCError({ code: "BAD_REQUEST", message: `الصنف رقم ${reviewItem.id}: يجب تعيين مندوب للأصناف المعتمدة` });
        }
        if (reviewItem.action === "reject" && !reviewItem.rejectionReason) {
          throw new TRPCError({ code: "BAD_REQUEST", message: `الصنف رقم ${reviewItem.id}: يجب إدخال سبب رفض الأصناف المرفوضة` });
        }
      }

      const rejectedEvents: Array<{ itemId: number; itemName: string; reason: string }> = [];
      for (const reviewItem of input.items) {
        const currentItem: any = reviewableById.get(reviewItem.id);
        const updated = reviewItem.action === "approve"
          ? await db.updatePOItemIfNotTerminal(reviewItem.id, {
              status: "pending",
              delegateId: reviewItem.delegateId,
              delegateAssignedAt: new Date(),
              managementRejectionReason: null,
            }, tx)
          : await db.updatePOItemIfNotTerminal(reviewItem.id, {
              status: "rejected",
              managementRejectionReason: reviewItem.rejectionReason,
            }, tx);

        if (!updated) {
          throw new TRPCError({
            code: "CONFLICT",
            message: `تغيرت حالة الصنف "${currentItem?.itemName || reviewItem.id}" أثناء المراجعة؛ قم بتحديث الصفحة`,
          });
        }
        if (reviewItem.action === "reject") {
          rejectedEvents.push({
            itemId: reviewItem.id,
            itemName: currentItem.itemName,
            reason: reviewItem.rejectionReason!,
          });
        }
      }

      const allItems = await db.getPOItems(input.poId, tx);
      const hasApproved = allItems.some((item: any) => item.status === "pending");
      const allRejected = allItems.every((item: any) => item.status === "rejected" || item.status === "cancelled");

      if (allRejected) {
        await db.updatePurchaseOrder(input.poId, {
          status: "rejected",
          rejectedById: ctx.user.id,
          rejectedAt: new Date(),
          rejectionReason: `تم رفض جميع الأصناف بواسطة ${ctx.user.name}`,
        }, tx);
      } else if (hasApproved) {
        await db.updatePurchaseOrder(input.poId, {
          status: "pending_estimate",
          reviewedById: ctx.user.id,
          reviewedAt: new Date(),
        }, tx);
      }

      return {
        allRejected,
        hasApproved,
        rejectedEvents,
        approvedItems: allItems.filter((item: any) => item.status === "pending" && item.delegateId),
      };
    });

    // الإشعارات تُرسل بعد نجاح المعاملة فقط، حتى لا تصل رسائل عن قرار تم rollback له.
    for (const rejectedEvent of result.rejectedEvents) {
      await notifyItemRejection({
        poId: po.id,
        poNumber: po.poNumber,
        requestedById: po.requestedById,
        itemId: rejectedEvent.itemId,
        itemName: rejectedEvent.itemName,
        actorId: ctx.user.id,
        actorName: ctx.user.name || "مستخدم",
        actorRole: ctx.user.role,
        reason: rejectedEvent.reason,
        kind: "rejected",
      });
    }

    if (result.allRejected) {
      if (po.requestedById && po.requestedById !== ctx.user.id) {
        await db.createNotification({
          userId: po.requestedById,
          title: "❌ تم رفض جميع أصناف طلب الشراء",
          message: `تم رفض جميع أصناف طلب الشراء رقم ${po.poNumber} بواسطة ${ctx.user.name}.`,
          type: "critical",
          relatedPoId: input.poId,
        });
      }
    } else if (result.hasApproved) {
      const delegateIds = Array.from(new Set<number>(result.approvedItems.map((item: any) => item.delegateId as number)));
      for (const delegateId of delegateIds) {
        const delegateItems = result.approvedItems.filter((item: any) => item.delegateId === delegateId);
        const itemNames = delegateItems.map((item: any) => item.itemName).join("، ");
        await db.createNotification({
          userId: delegateId,
          title: "طلب شراء جديد — ابدأ التسعير",
          message: `تم تخصيص الأصناف التالية لك في طلب الشراء ${po.poNumber}: ${itemNames}`,
          type: "info",
          relatedPoId: input.poId,
        });
      }
    }

    await syncPathBTicketFromPurchaseOrder(input.poId, ctx.user.id, "تمت مراجعة أصناف طلب الشراء");
    await db.createAuditLog({ userId: ctx.user.id, action: "review_po_items", entityType: "purchase_order", entityId: input.poId });
    return { success: true };
    }),
});

// ============================================================
// server/routers/inventory/invoiceDraft.router.ts
// راوتر مسودة الفاتورة + الاعتماد
// ============================================================

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { router, warehouseProcedure } from "../_shared/procedures";
import * as db from "../../db";
import { analyzeInvoiceFromUrl } from "../../services/ocr/invoiceOcr.service";

export const invoiceDraftRouter = router({

  // ══════════════════════════════════════════════════════════
  // 1. تحليل صورة الفاتورة وحفظها في ocr_jobs
  //    يُستدعى عندما يصور المستودع الفاتورة
  // ══════════════════════════════════════════════════════════
  analyzeAndSave: warehouseProcedure
    .input(z.object({
      purchaseOrderId:      z.number(),
      purchaseOrderItemId:  z.number().optional(),
      invoiceImageUrl:      z.string(),
      goodsImageUrl:        z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      // إنشاء سجل OCR
      const ocrJobId = await db.createOcrJobV2({
        purchaseOrderId:     input.purchaseOrderId,
        purchaseOrderItemId: input.purchaseOrderItemId,
        imageUrl:            input.invoiceImageUrl,
        createdById:         ctx.user.id,
        status:              "processing",
      });

      try {
        const { result, rawResponse, processingMs } = await analyzeInvoiceFromUrl(input.invoiceImageUrl);

        const confidence    = result.overallConfidence * 100;
        const needsReview   = confidence < 80 || !result.invoiceNumber || !result.items?.length;

        await db.updateOcrJobStatus(ocrJobId!, {
          status:           needsReview ? "needs_review" : "ocr_completed",
          extractedData:    result,
          rawResponse,
          confidence:       confidence,
          confidenceScore:  confidence,
          needsManualReview: needsReview,
          processingMs,
          completedAt:      new Date(),
        });

        return {
          ocrJobId,
          status:           needsReview ? "needs_review" : "ocr_completed",
          confidence:       result.overallConfidence,
          needsReview,
          invoiceData:      result,
        };

      } catch (err: any) {
        await db.updateOcrJobStatus(ocrJobId!, {
          status:       "failed",
          errorMessage: err.message,
          completedAt:  new Date(),
        });
        throw new TRPCError({
          code:    "INTERNAL_SERVER_ERROR",
          message: `فشل في تحليل الفاتورة: ${err.message}`,
        });
      }
    }),

  // ══════════════════════════════════════════════════════════
  // 2. تجميع الأصناف وإنشاء مسودة فاتورة
  //    بعد انتهاء المستودع من تصوير جميع الأصناف
  // ══════════════════════════════════════════════════════════
  createDraft: warehouseProcedure
    .input(z.object({
      purchaseOrderId: z.number(),
    }))
    .mutation(async ({ input, ctx }) => {
      // تجميع الأصناف حسب الفاتورة
      const invoiceGroups = await db.groupPOItemsByInvoice(input.purchaseOrderId);

      if (!invoiceGroups.length) {
        throw new TRPCError({
          code:    "NOT_FOUND",
          message: "لا توجد فواتير محللة لهذا الطلب — قم بتصوير الفواتير أولاً",
        });
      }

      const createdDrafts = [];

      for (const group of invoiceGroups) {
        // التحقق من التكرار
        if (group.invoiceNumber) {
          const duplicate = await db.checkDuplicateInvoiceV2({
            invoiceNumber: group.invoiceNumber,
          });
          if (duplicate) {
            createdDrafts.push({
              status:       "duplicate",
              invoiceNumber: group.invoiceNumber,
              existingId:   duplicate.id,
            });
            continue;
          }
        }

        // توليد رقم الفاتورة
        const receiptNumber = await db.getNextReceiptNumber();

        // إنشاء مسودة الفاتورة
        const receiptId = await db.createWarehouseReceiptDraft({
          receiptNumber,
          purchaseOrderId:  input.purchaseOrderId,
          receivedById:     ctx.user.id,
          totalItems:       group.items.length,
          vendorName:       group.vendorName,
          vendorTaxNumber:  group.vendorTaxNumber,
          invoiceNumber:    group.invoiceNumber,
          invoiceDate:      group.invoiceDate ? new Date(group.invoiceDate) : undefined,
          subtotal:         group.subtotal?.toString(),
          taxAmount:        group.taxAmount?.toString(),
          grandTotal:       group.grandTotal?.toString(),
        });

        // إضافة الأصناف للمسودة
        for (const item of group.items) {
          await db.createWarehouseReceiptItem({
            receiptId:           receiptId!,
            purchaseOrderItemId: item.purchaseOrderItemId,
            itemName:            item.itemName || "صنف غير محدد",
            itemName_ar:         item.itemName_ar,
            itemName_en:         item.itemNameEn,
            receivedQuantity:    (item.quantity || 1).toString(),
            purchaseUnit:        item.unit || "قطعة",
            unitCost:            (item.unitPrice || 0).toString(),
            taxRate:             (item.taxRate || 15).toString(),
            taxAmount:           (item.taxAmount || 0).toString(),
            lineTotal:           (item.lineTotal || 0).toString(),
            ocrExtracted:        true,
          });
        }

        // ربط OCR jobs بالمسودة
        for (const jobId of group.ocrJobIds) {
          await db.updateOcrJobStatus(jobId, {
            status:    "approved",
            approvedAt: new Date(),
          });
        }

        createdDrafts.push({
          status:        "created",
          receiptId,
          receiptNumber,
          invoiceNumber: group.invoiceNumber,
          vendorName:    group.vendorName,
          itemCount:     group.items.length,
        });
      }

      return { drafts: createdDrafts };
    }),

  // ══════════════════════════════════════════════════════════
  // 3. جلب مسودة بالـ ID
  // ══════════════════════════════════════════════════════════
  getDraft: warehouseProcedure
    .input(z.object({ receiptId: z.number() }))
    .query(async ({ input }) => {
      const draft = await db.getWarehouseReceiptDraft(input.receiptId);
      if (!draft) throw new TRPCError({ code: "NOT_FOUND", message: "المسودة غير موجودة" });
      return draft;
    }),

  // ══════════════════════════════════════════════════════════
  // 4. قائمة المسودات المعلقة لطلب شراء
  // ══════════════════════════════════════════════════════════
  listDrafts: warehouseProcedure
    .input(z.object({ purchaseOrderId: z.number().optional() }))
    .query(async ({ input }) => {
      return db.listDraftReceipts(input.purchaseOrderId);
    }),

  // ══════════════════════════════════════════════════════════
  // 5. تعديل بند في المسودة قبل الاعتماد
  // ══════════════════════════════════════════════════════════
  updateDraftItem: warehouseProcedure
    .input(z.object({
      itemId:           z.number(),
      itemName:         z.string().optional(),
      receivedQuantity: z.number().optional(),
      unitCost:         z.string().optional(),
      taxRate:          z.number().optional(),
    }))
    .mutation(async ({ input }) => {
      const { itemId, ...updates } = input;
      await db.updateWarehouseReceiptItem(itemId, {
        ...updates,
        manuallyEdited: true,
      });
    }),

  // ══════════════════════════════════════════════════════════
  // 6. اعتماد الفاتورة → إدخال المخزون فعلياً
  // ══════════════════════════════════════════════════════════
  approveDraft: warehouseProcedure
    .input(z.object({
      receiptId: z.number(),
      notes:     z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const draft = await db.getWarehouseReceiptDraft(input.receiptId);
      if (!draft) throw new TRPCError({ code: "NOT_FOUND", message: "المسودة غير موجودة" });
      if (!(draft as any).isDraft) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "هذه الفاتورة تم اعتمادها مسبقاً" });
      }

      // إدخال المخزون فعلياً
      await db.processApprovedReceiptItems(input.receiptId, ctx.user.id);

      // اعتماد الفاتورة
      await db.approveWarehouseReceipt(input.receiptId, ctx.user.id);

      // Audit Log
      await db.createAuditLog({
        userId:     ctx.user.id,
        action:     "approve_invoice_draft",
        entityType: "warehouse_receipt",
        entityId:   input.receiptId,
        newValues:  { approvedAt: new Date(), notes: input.notes },
      });

      return {
        success:       true,
        receiptId:     input.receiptId,
        receiptNumber: (draft as any).receiptNumber,
        itemsProcessed: (draft as any).items?.length || 0,
      };
    }),

  // ══════════════════════════════════════════════════════════
  // 7. OCR jobs لطلب شراء معين
  // ══════════════════════════════════════════════════════════
  getOcrJobs: warehouseProcedure
    .input(z.object({ purchaseOrderId: z.number() }))
    .query(async ({ input }) => {
      return db.getOcrJobsByPO(input.purchaseOrderId);
    }),
});

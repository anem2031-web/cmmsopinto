// ============================================================
// server/routers/inventory/receipts.v2.router.ts
// راوتر استلام المستودع المطوّر - الإصدار الثاني
// ============================================================

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { router, protectedProcedure, warehouseProcedure } from "../_shared/procedures";
import * as db from "../../_core/db";
import { analyzeInvoiceFromUrl, analyzeInvoiceFromBase64 } from "../../services/ocr/invoiceOcr.service";

// ─── مخطط الصنف المستلم ─────────────────────────────────────
const receivedItemSchema = z.object({
  // اختياري: الفاتورة الفعلية قد تحتوي أصنافاً زائدة عن طلب الشراء الأصلي
  // (المورد أضافها، أو لم تكن مطلوبة أصلاً) — هذه تُستلم للمخزون مباشرة
  // دون ربطها ببند طلب، ودون تحديث حالة أي بند طلب لأجلها
  purchaseOrderItemId:  z.number().optional(),
  inventoryId:          z.number().optional(),
  linkedItemId:         z.number().optional(),
  itemName:             z.string().min(1),
  itemName_ar:          z.string().optional(),
  itemName_en:          z.string().optional(),
  itemType:             z.enum(["spare_part", "consumable", "tool", "food"]).default("consumable"),
  receivedQuantity:     z.number().positive(),
  expectedQuantity:     z.number().optional(),
  purchaseUnit:         z.string().min(1),
  issueUnit:            z.string().optional(),
  conversionFactor:     z.number().positive().default(1),
  unitCost:             z.string().min(1),
  expectedUnitCost:     z.string().optional(),
  taxRate:              z.number().min(0).max(100).default(15),
  taxAmount:            z.string().default("0"),
  lineTotal:            z.string().default("0"),
  manufacturerBarcode:  z.string().optional(),
  expiryDate:           z.string().optional(),
  assetId:              z.number().optional(),
  warehouseId:          z.number().default(1),
  ocrExtracted:         z.boolean().default(false),
  manuallyEdited:       z.boolean().default(false),
});

export const receiptsV2Router = router({

  analyzeInvoice: warehouseProcedure
    .input(z.object({
      imageUrl:        z.string().optional(),
      base64Image:     z.string().optional(),
      mimeType:        z.string().default("image/jpeg"),
      purchaseOrderId: z.number().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      if (!input.imageUrl && !input.base64Image) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "يجب توفير صورة الفاتورة" });
      }

      // إنشاء OCR job مع معالجة الخطأ بشكل منفصل
      let ocrJobId: number | null = null;
      try {
        console.log("[OCR] Creating job...");
        ocrJobId = await db.createOcrJob({
          purchaseOrderId: input.purchaseOrderId,
          imageUrl: input.imageUrl || "base64",
          createdById: ctx.user.id,
          status: "processing",
        });
        console.log("[OCR] Job created, id:", ocrJobId);
      } catch (jobErr: any) {
        console.error("[OCR] createOcrJob failed:", jobErr.message);
        // نكمل حتى لو فشل إنشاء الـ job
      }

      try {
        // تحليل الفاتورة
        let analysisResult;
        if (input.imageUrl) {
          const fullUrl = input.imageUrl.startsWith("/")
            ? `http://localhost:3000${input.imageUrl}`
            : input.imageUrl;
          console.log("[OCR] Analyzing URL:", fullUrl.substring(0, 80));
          analysisResult = await analyzeInvoiceFromUrl(fullUrl);
        } else {
          analysisResult = await analyzeInvoiceFromBase64(input.base64Image!, input.mimeType);
        }
        const { result, rawResponse, processingMs } = analysisResult;
        console.log("[OCR] Analysis done, confidence:", result.overallConfidence, "items:", result?.items?.length);

        // مطابقة الأصناف مع المخزون الحالي
        console.log("[OCR] Step 1: enriching items...");
        const enrichedItems = await enrichItemsWithInventoryData(result.items);
        console.log("[OCR] Step 1 done, enriched:", enrichedItems.length);

        // كشف الفاتورة المكررة
        console.log("[OCR] Step 2: checking duplicate...");
        let duplicateCheck = null;
        if (result.invoiceNumber) {
          duplicateCheck = await db.checkDuplicateInvoice({
            invoiceNumber: result.invoiceNumber,
            vendorTaxNumber: result.vendorTaxNumber,
          });
        }
        console.log("[OCR] Step 2 done, isDuplicate:", !!duplicateCheck);

        // تحديث OCR job إن وجد
        console.log("[OCR] Step 3: updating ocr job...");
        if (ocrJobId) {
          await db.updateOcrJob(ocrJobId, {
            status: "ocr_completed",
            rawResponse,
            extractedData: { ...result, items: enrichedItems },
            confidence: result.overallConfidence * 100,
            processingMs,
            completedAt: new Date(),
          });
        }
        console.log("[OCR] Step 3 done");

        return {
          ocrJobId,
          invoiceData: { ...result, items: enrichedItems },
          isDuplicate: !!duplicateCheck,
          duplicateReceiptId: duplicateCheck?.id,
          processingMs,
          confidence: result.overallConfidence,
        };

      } catch (error: any) {
        console.error("[OCR] Analysis error:", error.message);
        console.error("[OCR] Stack:", error.stack?.split("\n").slice(0,5).join(" | "));
        if (ocrJobId) {
          await db.updateOcrJob(ocrJobId, {
            status: "failed",
            errorMessage: error.message,
            completedAt: new Date(),
          });
        }
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `فشل في تحليل الفاتورة: ${error.message}`,
        });
      }
    }),

  checkDuplicate: warehouseProcedure
    .input(z.object({
      invoiceNumber:   z.string(),
      vendorTaxNumber: z.string().optional(),
    }))
    .query(async ({ input }) => {
      const duplicate = await db.checkDuplicateInvoice(input);
      return { isDuplicate: !!duplicate, existingReceipt: duplicate };
    }),

  findSimilarItems: warehouseProcedure
    .input(z.object({ itemName: z.string().min(2) }))
    .query(async ({ input }) => {
      return db.findSimilarInventoryItems(input.itemName);
    }),

  // ── استلام مستقل بلا طلب شراء — لدعم فاتورة شراء عامة/مصاريف نثرية من
  //   شاشة المخزون مباشرة، بلا أي دورة طلب شراء وراءها. كل الأصناف هنا
  //   بالتعريف بلا purchaseOrderItemId (لا يوجد بند طلب لتربطها به).
  receiveStandaloneV2: warehouseProcedure
    .input(z.object({
      vendorName:       z.string().optional(),
      vendorNameEn:     z.string().optional(),
      vendorTaxNumber:  z.string().optional(),
      invoiceNumber:    z.string().optional(),
      invoiceDate:      z.string().optional(),
      subtotal:         z.number().optional(),
      taxAmount:        z.number().optional(),
      grandTotal:       z.number().optional(),
      invoicePhotoUrl:  z.string().optional(),
      goodsPhotoUrl:    z.string().optional(),
      ocrJobId:         z.number().optional(),
      hasDiscrepancy:   z.boolean().default(false),
      discrepancyNotes: z.string().optional(),
      // إلزامي عمداً: الاستلام المستقل بلا طلب شراء يحتاج توثيق السبب
      // (مثال: "بضاعة وصلت مباشرة من المورد بدون طلب شراء مسبق")
      notes: z.string().trim().min(10, {
        message: "سبب الاستلام المستقل إلزامي — يرجى توضيح لماذا وصل هذا الصنف بدون طلب شراء مسبق (10 أحرف على الأقل)",
      }),
      items:            z.array(receivedItemSchema),
    }))
    .mutation(async ({ input, ctx }) => {
      if (input.items.length === 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "لا توجد أصناف للاستلام" });
      }

      if (input.invoiceNumber) {
        const dup = await db.checkDuplicateInvoice({
          invoiceNumber:   input.invoiceNumber,
          vendorTaxNumber: input.vendorTaxNumber,
        });
        if (dup) {
          throw new TRPCError({
            code: "CONFLICT",
            message: `رقم الفاتورة ${input.invoiceNumber} مستلم مسبقاً (سند ${dup.receiptNumber})`,
          });
        }
      }

      const { receiptId, receiptNumber, processedItems } = await db.withTransaction(async (tx) => {
        const receiptNumber = await db.getNextReceiptNumber(tx);

        const receiptId = await db.createWarehouseReceiptV2({
          receiptNumber,
          // بلا purchaseOrderId عمداً — استلام مستقل
          receivedById:     ctx.user.id,
          notes:            input.notes,
          totalItems:       input.items.length,
          status:           "confirmed",
          vendorName:       input.vendorName,
          vendorNameEn:     input.vendorNameEn,
          vendorTaxNumber:  input.vendorTaxNumber,
          invoiceNumber:    input.invoiceNumber,
          invoiceDate:      input.invoiceDate ? new Date(input.invoiceDate) : undefined,
          subtotal:         input.subtotal?.toString(),
          taxAmount:        input.taxAmount?.toString(),
          grandTotal:       input.grandTotal?.toString(),
          invoicePhotoUrl:  input.invoicePhotoUrl,
          goodsPhotoUrl:    input.goodsPhotoUrl,
          hasDiscrepancy:   input.hasDiscrepancy,
          discrepancyNotes: input.discrepancyNotes,
        }, tx);

        const processedItems: any[] = [];

        for (const item of input.items) {
          const processed = await processReceiptItem({
            item,
            receiptId: receiptId!,
            receiptNumber,
            performedById: ctx.user.id,
            tx,
            // لا purchaseOrderId ولا poNumber — استلام مستقل
          });
          processedItems.push(processed);

          await db.createWarehouseReceiptItem({
            receiptId: receiptId!,
            inventoryId: processed.inventoryId,
            // بلا purchaseOrderItemId — لا يوجد بند طلب أصلاً
            itemName: item.itemName,
            itemName_ar: item.itemName_ar,
            itemName_en: item.itemName_en,
            receivedQuantity: item.receivedQuantity.toString(),
            purchaseUnit: item.purchaseUnit,
            unitCost: item.unitCost,
            taxRate: item.taxRate.toString(),
            taxAmount: item.taxAmount,
            lineTotal: item.lineTotal,
            ocrExtracted: item.ocrExtracted,
            manuallyEdited: item.manuallyEdited,
          }, tx);
        }

        return { receiptId, receiptNumber, processedItems };
      });

      if (input.ocrJobId) {
        await db.updateOcrJob(input.ocrJobId, { receiptId: receiptId! });
      }

      const managers = await db.getManagerUsers();
      for (const mgr of managers) {
        await db.createNotification({
          userId: mgr.id,
          title: `📦 استلام مستقل ${receiptNumber}`,
          message: `تم استلام ${input.items.length} صنف (بلا طلب شراء)` +
            (input.hasDiscrepancy ? " ⚠️ يوجد فروقات" : ""),
          type: input.hasDiscrepancy ? "warning" : "info",
        });
      }

      await db.createAuditLog({
        userId: ctx.user.id,
        action: "warehouse_receive_standalone_v2",
        entityType: "warehouse_receipt",
        entityId: receiptId!,
        newValues: {
          receiptNumber,
          totalItems:      input.items.length,
          vendorName:      input.vendorName,
          invoiceNumber:   input.invoiceNumber,
          grandTotal:      input.grandTotal,
          hasDiscrepancy:  input.hasDiscrepancy,
        },
      });

      const inventoryItems = await Promise.all(
        processedItems.map(async (p: any) => {
          if (!p.inventoryId) return null;
          const inv = await db.getInventoryItemById(p.inventoryId);
          return inv ? {
            inventoryId:        inv.id,
            itemName:           inv.itemName,
            internalCode:       inv.internalCode,
            manufacturerBarcode: inv.manufacturerBarcode,
            quantity:           inv.quantity,
            unit:               inv.unit,
          } : null;
        })
      );

      return {
        receiptId,
        receiptNumber,
        inventoryItems: inventoryItems.filter(Boolean),
        hasDiscrepancy: input.hasDiscrepancy,
      };
    }),

  receiveFromPurchaseV2: warehouseProcedure
    .input(z.object({
      purchaseOrderId:  z.number(),
      vendorName:       z.string().optional(),
      vendorNameEn:     z.string().optional(),
      vendorTaxNumber:  z.string().optional(),
      invoiceNumber:    z.string().optional(),
      invoiceDate:      z.string().optional(),
      subtotal:         z.number().optional(),
      taxAmount:        z.number().optional(),
      grandTotal:       z.number().optional(),
      invoicePhotoUrl:  z.string().optional(),
      goodsPhotoUrl:    z.string().optional(),
      ocrJobId:         z.number().optional(),
      hasDiscrepancy:   z.boolean().default(false),
      discrepancyNotes: z.string().optional(),
      notes:            z.string().optional(),
      items:            z.array(receivedItemSchema),
    }))
    .mutation(async ({ input, ctx }) => {
      const po = await db.getPurchaseOrderById(input.purchaseOrderId);
      if (!po) throw new TRPCError({ code: "NOT_FOUND", message: "طلب الشراء غير موجود" });

      // ── حاجز أمان: نمنع كتابة أي بيانات على بند لا ينتمي فعلاً لهذا الطلب
      //   أو ليس بحالة "توريد للمستودع" — لكن فقط للأصناف التي اختار
      //   المستخدم ربطها ببند (purchaseOrderItemId موجود). الأصناف بلا ربط
      //   (صنف زائد بالفاتورة لا يقابله بند بالطلب) مسموحة عمداً.
      const poItemsAll = await db.getPOItems(input.purchaseOrderId);
      const validItemIds = new Set(
        poItemsAll.filter((i: any) => i.status === "delivered_to_warehouse").map((i: any) => i.id)
      );
      const invalidItems = input.items.filter(
        it => it.purchaseOrderItemId != null && !validItemIds.has(it.purchaseOrderItemId)
      );
      if (invalidItems.length > 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `أصناف غير صالحة للاستلام (غير منتمية لهذا الطلب أو لم تُؤكَّد توريدها للمستودع بعد): ${invalidItems.map(i => i.itemName).join("، ")}`,
        });
      }

      if (input.invoiceNumber) {
        const duplicate = await db.checkDuplicateInvoice({
          invoiceNumber: input.invoiceNumber,
          vendorTaxNumber: input.vendorTaxNumber,
        });
        if (duplicate) {
          throw new TRPCError({
            code: "CONFLICT",
            message: `فاتورة مكررة - تم استلام هذه الفاتورة مسبقاً برقم ${duplicate.receiptNumber}`,
          });
        }
      }

      // ── الجزء الحرج محاسبياً (الإيصال + بنوده + تحديث المخزون + حالة
      //   بنود الطلب) يُنفَّذ كمعاملة واحدة: إما ينجح بالكامل أو يُلغى
      //   بالكامل (rollback) — لا حالة وسطى ممزقة عند أي فشل جزئي.
      const { receiptId, receiptNumber, processedItems } = await db.withTransaction(async (tx) => {
        const receiptNumber = await db.getNextReceiptNumber(tx);

        const receiptId = await db.createWarehouseReceiptV2({
          receiptNumber,
          purchaseOrderId:  input.purchaseOrderId,
          receivedById:     ctx.user.id,
          notes:            input.notes,
          totalItems:       input.items.length,
          status:           "confirmed",
          vendorName:       input.vendorName,
          vendorNameEn:     input.vendorNameEn,
          vendorTaxNumber:  input.vendorTaxNumber,
          invoiceNumber:    input.invoiceNumber,
          invoiceDate:      input.invoiceDate ? new Date(input.invoiceDate) : undefined,
          subtotal:         input.subtotal?.toString(),
          taxAmount:        input.taxAmount?.toString(),
          grandTotal:       input.grandTotal?.toString(),
          invoicePhotoUrl:  input.invoicePhotoUrl,
          goodsPhotoUrl:    input.goodsPhotoUrl,
          hasDiscrepancy:   input.hasDiscrepancy,
          discrepancyNotes: input.discrepancyNotes,
        }, tx);

        const processedItems: any[] = [];

        for (const item of input.items) {
          const processed = await processReceiptItem({
            item,
            receiptId: receiptId!,
            purchaseOrderId: input.purchaseOrderId,
            poNumber: po.poNumber,
            receiptNumber,
            performedById: ctx.user.id,
            tx,
          });
          processedItems.push(processed);

          await db.createWarehouseReceiptItem({
            receiptId: receiptId!,
            inventoryId: processed.inventoryId,
            purchaseOrderItemId: item.purchaseOrderItemId,
            itemName: item.itemName,
            itemName_ar: item.itemName_ar,
            itemName_en: item.itemName_en,
            receivedQuantity: item.receivedQuantity.toString(),
            purchaseUnit: item.purchaseUnit,
            unitCost: item.unitCost,
            taxRate: item.taxRate.toString(),
            taxAmount: item.taxAmount,
            lineTotal: item.lineTotal,
            expectedQuantity: item.expectedQuantity?.toString(),
            quantityDiff: item.expectedQuantity
              ? (item.receivedQuantity - item.expectedQuantity).toString()
              : undefined,
            expectedUnitCost: item.expectedUnitCost,
            priceDiff: item.expectedUnitCost
              ? (parseFloat(item.unitCost) - parseFloat(item.expectedUnitCost)).toString()
              : undefined,
            ocrExtracted: item.ocrExtracted,
            manuallyEdited: item.manuallyEdited,
          }, tx);

          // تحديث بند الطلب فقط للأصناف المربوطة فعلياً ببند حقيقي — الأصناف
          // الزائدة عن الطلب (بلا purchaseOrderItemId) تُستلم للمخزون فقط
          // دون أي أثر على بنود الطلب أو حالته
          if (item.purchaseOrderItemId) {
            await db.updatePOItem(item.purchaseOrderItemId, {
              status:            "delivered_to_warehouse",
              receivedAt:        new Date(),
              receivedById:      ctx.user.id,
              receivedQuantity:  item.receivedQuantity,
              supplierName:      input.vendorName,
              actualUnitCost:    item.unitCost,
              actualTotalCost:   item.lineTotal,
              warehousePhotoUrl: input.goodsPhotoUrl,
            }, tx);
          }
        }

        const allItems = await db.getPOItems(input.purchaseOrderId, tx);
        const activeItems = allItems.filter((i: any) => !["rejected", "cancelled"].includes(i.status));
        const allInWarehouse = activeItems.every((i: any) =>
          ["delivered_to_warehouse", "delivered_to_requester"].includes(i.status)
        );
        if (allInWarehouse) {
          await db.updatePurchaseOrder(input.purchaseOrderId, { status: "received" }, tx);
        }

        return { receiptId, receiptNumber, processedItems };
      });

      // ── ما بعد المعاملة: آثار جانبية غير حرجة محاسبياً (إشعارات، سجل
      //   تدقيق، تحديث OCR job). فشلها لا يجب أن يُلغي عملية استلام ناجحة
      //   فعلياً، فتبقى خارج نطاق الـ transaction عمداً.
      if (input.ocrJobId) {
        await db.updateOcrJob(input.ocrJobId, { receiptId: receiptId! });
      }

      const managers = await db.getManagerUsers();
      for (const mgr of managers) {
        await db.createNotification({
          userId: mgr.id,
          title: `📦 استلام ${receiptNumber}`,
          message: `تم استلام ${input.items.length} صنف من طلب ${po.poNumber}` +
            (input.hasDiscrepancy ? " ⚠️ يوجد فروقات" : ""),
          type: input.hasDiscrepancy ? "warning" : "info",
          relatedPOId: input.purchaseOrderId,
        });
      }

      await db.createAuditLog({
        userId: ctx.user.id,
        action: "warehouse_receive_v2",
        entityType: "warehouse_receipt",
        entityId: receiptId!,
        newValues: {
          receiptNumber,
          totalItems:      input.items.length,
          vendorName:      input.vendorName,
          invoiceNumber:   input.invoiceNumber,
          grandTotal:      input.grandTotal,
          hasDiscrepancy:  input.hasDiscrepancy,
        },
      });

      // جلب بيانات المخزون بعد الحفظ لطباعة الباركود
      const inventoryItems = await Promise.all(
        processedItems.map(async (p: any) => {
          if (!p.inventoryId) return null;
          const inv = await db.getInventoryItemById(p.inventoryId);
          return inv ? {
            inventoryId:        inv.id,
            itemName:           inv.itemName,
            internalCode:       inv.internalCode,
            manufacturerBarcode: inv.manufacturerBarcode,
            quantity:           inv.quantity,
            unit:               inv.unit,
          } : null;
        })
      );


      return {
        receiptId,
        receiptNumber,
        processedItems,
        hasDiscrepancy:  input.hasDiscrepancy,
        inventoryItems:  inventoryItems.filter(Boolean),
      };
    }),

  // توليد رقم باركود فريد للصنف
  // توليد أرقام باركود — يستخدم AUTO_INCREMENT لضمان عدم التكرار
  generateItemBarcodes: warehouseProcedure
    .input(z.object({ count: z.number().min(1).max(100) }))
    .mutation(async ({ input }) => {
      const barcodes = await db.getNextItemBarcodes(input.count);
      return { barcodes };
    }),

  generateItemBarcode: warehouseProcedure
    .mutation(async () => {
      const barcode = await db.getNextItemBarcode();
      return { barcode };
    }),

  listV2: warehouseProcedure
    .input(z.object({
      purchaseOrderId: z.number().optional(),
      limit:           z.number().default(50),
      offset:          z.number().default(0),
    }).optional())
    .query(async ({ input }) => {
      return db.listWarehouseReceiptsV2(input);
    }),

  getByIdV2: warehouseProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const receipt = await db.getWarehouseReceiptWithItems(input.id);
      if (!receipt) throw new TRPCError({ code: "NOT_FOUND", message: "الفاتورة غير موجودة" });
      return receipt;
    }),

  scanBarcode: warehouseProcedure
    .input(z.object({ code: z.string().min(1) }))
    .query(async ({ input }) => {
      return db.getInventoryByBarcode(input.code);
    }),

  searchInventory: warehouseProcedure
    .input(z.object({ search: z.string().min(1) }))
    .query(async ({ input }) => {
      return db.getInventoryBySearch(input.search);
    }),
});

interface ProcessedItem {
  inventoryId:    number;
  isNew:          boolean;
  internalCode:   string;
  newAverageCost: number;
}

async function processReceiptItem(params: {
  item:            z.infer<typeof receivedItemSchema>;
  receiptId:       number;
  purchaseOrderId?: number;
  poNumber?:       string; // غير موجود = استلام مستقل بلا طلب شراء
  receiptNumber:   string;
  performedById:   number;
  tx:              any;
}): Promise<ProcessedItem> {
  const { item, receiptId, poNumber, receiptNumber, performedById, tx } = params;
  const sourceLabel = poNumber ? `طلب شراء ${poNumber}` : "استلام مستقل (بلا طلب شراء)";
  let inventoryId = item.inventoryId;
  let isNew = false;
  let internalCode = "";

  const unitCost = parseFloat(item.unitCost);
  const issueQuantity = item.receivedQuantity * item.conversionFactor;

  if (inventoryId) {
    const existing = await db.getInventoryItemById(inventoryId, tx);
    if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: `الصنف ${inventoryId} غير موجود` });

    const oldQty     = existing.quantity || 0;
    const oldAvgCost = parseFloat((existing as any).averageCost || "0");
    const newQty     = oldQty + issueQuantity;
    const newAvgCost = newQty > 0
      ? ((oldQty * oldAvgCost) + (issueQuantity * unitCost)) / newQty
      : unitCost;

    await db.updateInventoryItemV2(inventoryId, {
      lastRestockedAt: new Date(),
      averageCost:     newAvgCost.toFixed(4),
      totalCostValue:  (newQty * newAvgCost).toFixed(2),
      ...(item.linkedItemId ? { linkedItemId: item.linkedItemId } : {}),
      // نحفظ الباركود المولَّد أثناء إدخال الفاتورة فقط إذا كان الصنف
      // الموجود لا يملك باركوداً أصلاً — حتى لا نستبدل باركوداً صحيحاً
      // مطبوعاً ومستخدماً فعلياً على الرفوف
      ...(!((existing as any).manufacturerBarcode) && item.manufacturerBarcode
        ? { manufacturerBarcode: item.manufacturerBarcode }
        : {}),
    }, tx);

    internalCode = (existing as any).internalCode || "";

    await db.addInventoryTransactionV2({
      inventoryId,
      type:                "in",
      quantity:            issueQuantity,
      unitCost:            unitCost.toFixed(4),
      totalCost:           (issueQuantity * unitCost).toFixed(2),
      reason:              `استلام من ${sourceLabel} - فاتورة ${receiptNumber}`,
      purchaseOrderItemId: item.purchaseOrderItemId,
      performedById,
      transactionType:     "purchase",
      receiptId,
    }, tx);

    return { inventoryId, isNew: false, internalCode, newAverageCost: newAvgCost };

  } else {
    isNew = true;
    internalCode = await db.getNextInventoryCode(tx);

    inventoryId = await db.createInventoryItemV2({
      itemName:            item.itemName,
      itemName_ar:         item.itemName_ar,
      itemName_en:         item.itemName_en,
      itemType:            item.itemType,
      quantity:            0,
      unit:                item.issueUnit || item.purchaseUnit,
      purchaseUnit:        item.purchaseUnit,
      issueUnit:           item.issueUnit,
      conversionFactor:    item.conversionFactor.toString(),
      minQuantity:         0,
      averageCost:         unitCost.toFixed(4),
      totalCostValue:      "0",
      internalCode,
      manufacturerBarcode: item.manufacturerBarcode,
      expiryDate:          item.expiryDate ? new Date(item.expiryDate) : undefined,
      linkedItemId:        item.linkedItemId,
      assetId:             item.assetId,
      warehouseId:         item.warehouseId || 1,
      receiptId,
    }, tx) as number;

    await db.addInventoryTransactionV2({
      inventoryId,
      type:                "in",
      quantity:            issueQuantity,
      unitCost:            unitCost.toFixed(4),
      totalCost:           (issueQuantity * unitCost).toFixed(2),
      reason:              `استلام أول - ${sourceLabel} - فاتورة ${receiptNumber}`,
      purchaseOrderItemId: item.purchaseOrderItemId,
      performedById,
      transactionType:     "purchase",
      receiptId,
    }, tx);

    return { inventoryId, isNew, internalCode, newAverageCost: unitCost };
  }
}

async function enrichItemsWithInventoryData(items: any[] = []): Promise<any[]> {
  if (!Array.isArray(items)) {
    console.warn("[OCR] items is not array:", typeof items, items);
    return [];
  }
  return Promise.all(items.map(async (item) => {
    const itemName = item.itemName || "";
    if (!itemName.trim()) {
      return { ...item, existsInSystem: false, matchedItems: [], suggestedItemId: null };
    }
    const matched = await db.findSimilarInventoryItems(itemName);
    return {
      ...item,
      existsInSystem:  matched.length > 0,
      matchedItems:    matched,
      suggestedItemId: matched[0]?.id ?? null,
    };
  }));
}

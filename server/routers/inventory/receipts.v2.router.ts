// ============================================================
// server/routers/inventory/receipts.v2.router.ts
// راوتر استلام المستودع المطوّر - الإصدار الثاني
// ============================================================

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { and, eq, inArray, sql } from "drizzle-orm";
import { catalogAuditLogs, catalogItems, catalogUnits, catalogSuppliers, catalogSupplierAliases, catalogSupplierItemAliases, catalogSupplierCandidates, warehouseReceipts, warehouses } from "../../../drizzle/schema";
import { INVALID_CONVERSION_MESSAGE, receiptInOrderUnits } from "../../../shared/receipt-conversion";
import { getActiveCatalogUnitCanonicalName } from "../../_core/catalog-unit-governance";
import { router, inventoryReadProcedure, warehouseProcedure } from "../_shared/procedures";
import * as db from "../../_core/db";
import { analyzeInvoiceFromUrl, analyzeInvoiceFromBase64 } from "../../services/ocr/invoiceOcr.service";
import {
  calculateInventoryValue,
  calculateIssueQuantity,
  calculateIssueUnitCost,
  calculateMovementTotal,
  calculateMovingWeightedAverage,
} from "../../_core/inventory-costing";
import { normalizeSupplierName } from "../../_core/catalog-supplier-matching";
import { extractNormalizedMeasurements, normalizeCatalogItemText, normalizeSupplierItemCode } from "../../_core/catalog-item-matching";
import { validateCatalogItemDecision } from "../../_core/catalog-item-decision";
import { ensurePendingCatalogItemCandidate } from "../../_core/catalog-item-candidate";
import { createReceiptInventoryLot, isInventoryLotsEnabled } from "../../_core/inventory-lots";

import { getPurchaseReceiptContext, lockAndValidatePurchaseReceiptItems, receiptOrderScope } from "../../services/inventory/purchaseReceiptEligibility";

import { createPurchaseReceiptContextProcedure } from "./purchaseReceiptContext.procedure";
import { readRows, trialEnabled } from "../../supplier-return-followup/runtime";
import { linkReplacementReceipt } from "../../supplier-return-followup/receipt-bridge";

// ─── مخطط الصنف المستلم ─────────────────────────────────────
const receivedItemSchema = z.object({
  // اختياري: الفاتورة الفعلية قد تحتوي أصنافاً زائدة عن طلب الشراء الأصلي
  // (المورد أضافها، أو لم تكن مطلوبة أصلاً) — هذه تُستلم للمخزون مباشرة
  // دون ربطها ببند طلب، ودون تحديث حالة أي بند طلب لأجلها
  purchaseOrderItemId:  z.number().optional(),
  inventoryId:          z.number().optional(),
  linkedItemId:         z.number().optional(),
  // 2B-3: كود/SKU المورد كما يظهر على الفاتورة؛ لا يغيّر هوية Catalog Item.
  supplierItemCode:     z.string().optional(),
  // 2B-4: قرار Master Data صريح؛ لا ينشئ Catalog Item في هذه المرحلة.
  isNewCatalogItem:     z.boolean().default(false),
  itemName:             z.string().min(1),
  itemName_ar:          z.string().optional(),
  itemName_en:          z.string().optional(),
  itemType:             z.enum(["spare_part", "consumable", "tool", "food"]).default("consumable"),
  receivedQuantity:     z.number().min(0.001, "الكمية يجب أن تكون 0.001 أو أكثر"),
  expectedQuantity:     z.number().optional(),
  purchaseUnit:         z.string().min(1),
  issueUnit:            z.string().trim().min(1, "اختر وحدة الصرف"),
  conversionFactor:     z.number().finite().positive(INVALID_CONVERSION_MESSAGE),
  unitCost:             z.string().min(1).refine(value => Number.isFinite(Number(value)) && Number(value) >= 0, "تكلفة الوحدة غير صالحة"),
  expectedUnitCost:     z.string().optional(),
  taxRate:              z.number().min(0).max(100).default(15),
  taxAmount:            z.string().default("0"),
  lineTotal:            z.string().default("0"),
  manufacturerBarcode:  z.string().optional(),
  expiryDate:           z.string().optional(),
  assetId:              z.number().optional(),
  warehouseId:          z.number().optional(),
  ocrExtracted:         z.boolean().default(false),
  manuallyEdited:       z.boolean().default(false),
});

export const receiptsV2Router = router({

  purchaseReceiptContext: createPurchaseReceiptContextProcedure(db.getDb),

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
          message: error.message,
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

      const lotsEnabled = isInventoryLotsEnabled();
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
          // ✅ إصلاح حرج #8: هذا استلام مستقل بلا طلب شراء عمداً. أي قيمة
          // purchaseOrderItemId قد تصل من الواجهة هنا (مثل ترقيم صف محلي في
          // القائمة) لا معنى لها إطلاقاً ولا يجوز كتابتها في inventory_transactions
          // كما كان يحدث سابقاً عبر processReceiptItem المشتركة — نتجاهلها صراحة.
          const itemForProcessing = { ...item, purchaseOrderItemId: undefined };
          const processed = await processReceiptItem({
            item: itemForProcessing,
            receiptId: receiptId!,
            receiptNumber,
            performedById: ctx.user.id,
            tx,
            deferTransaction: lotsEnabled,
            // لا purchaseOrderId ولا poNumber — استلام مستقل
          });
          processedItems.push(processed);

          const receiptItemId = await db.createWarehouseReceiptItem({
            receiptId: receiptId!,
            inventoryId: processed.inventoryId,
            // بلا purchaseOrderItemId — لا يوجد بند طلب أصلاً
            // 2B-7: إذا حُسم Catalog Item أثناء المراجعة نحفظ هويته مباشرة.
            catalogItemId: item.linkedItemId,
            itemName: item.itemName,
            itemNameAr: item.itemName_ar,
            itemNameEn: item.itemName_en,
            isNewCatalogItem: item.isNewCatalogItem,
            receivedQuantity: item.receivedQuantity.toString(),
            purchaseUnit: item.purchaseUnit,
            unitCost: item.unitCost,
            taxRate: item.taxRate.toString(),
            taxAmount: item.taxAmount,
            lineTotal: item.lineTotal,
            ocrExtracted: item.ocrExtracted,
            manuallyEdited: item.manuallyEdited,
          }, tx);

          if (lotsEnabled) {
            if (!receiptItemId) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "تعذر إنشاء سطر الاستلام قبل إنشاء الدفعة" });
            const lot = await createReceiptInventoryLot({
              tx,
              catalogItemId: item.linkedItemId ?? null,
              inventoryId: processed.inventoryId,
              receiptId: receiptId!,
              receiptItemId: Number(receiptItemId),
              issueQuantity: processed.issueQuantity,
              purchaseUnit: item.purchaseUnit,
              issueUnit: item.issueUnit || item.purchaseUnit,
              conversionFactor: item.conversionFactor,
              purchaseUnitCost: processed.purchaseUnitCost,
              issueUnitCost: processed.issueUnitCost,
              supplierItemName: item.itemName,
              supplierItemCode: item.supplierItemCode,
              expiryDate: item.expiryDate,
              createdById: ctx.user.id,
            });
            processed.lotId = lot.lotId;
            processed.lotCode = lot.lotCode;
            processed.trackingToken = lot.trackingToken;

            await db.addInventoryTransactionV2({
              inventoryId: processed.inventoryId,
              lotId: lot.lotId,
              type: "in",
              quantity: processed.issueQuantity,
              unitCost: processed.issueUnitCost.toFixed(4),
              totalCost: calculateMovementTotal(processed.issueQuantity, processed.issueUnitCost).toFixed(2),
              reason: processed.transactionReason,
              performedById: ctx.user.id,
              transactionType: "purchase",
              receiptId: receiptId!,
            }, tx);
          }

          // 2B-5: "صنف جديد" لا ينتظر اعتماد Catalog Master. بعد دخول الكمية
          // للمخزون ننشئ مهمة Master Data مرتبطة بنفس inventoryId وسطر الاستلام.
          if (item.isNewCatalogItem && receiptItemId) {
            const candidate = await ensurePendingCatalogItemCandidate(tx, {
              inventoryId: processed.inventoryId,
              sourceReceiptId: receiptId!,
              sourceReceiptItemId: Number(receiptItemId),
              invoiceNumber: input.invoiceNumber,
              itemName: item.itemName,
              itemNameAr: item.itemName_ar,
              itemNameEn: item.itemName_en,
              supplierItemCode: item.supplierItemCode,
              purchaseUnit: item.purchaseUnit,
              manufacturerBarcode: item.manufacturerBarcode,
              createdById: ctx.user.id,
            });
            processed.catalogItemCandidateId = candidate.id;
            processed.catalogItemCandidateCreated = candidate.created;
          }
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
          catalogSupplierId: input.catalogSupplierId,
          isNewSupplier:    input.isNewSupplier,
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

      const lotLabels = processedItems.flatMap((p: ProcessedItem, index: number) =>
        p.lotId && p.trackingToken && p.lotCode ? [{
          lotId: p.lotId,
          lotCode: p.lotCode,
          trackingToken: p.trackingToken,
          itemName: input.items[index]?.itemName || `Inventory #${p.inventoryId}`,
          quantity: p.issueQuantity,
          unit: input.items[index]?.issueUnit || input.items[index]?.purchaseUnit || "",
          sourceType: "receipt" as const,
          receiptNumber,
        }] : []
      );

      return {
        receiptId,
        receiptNumber,
        inventoryItems: inventoryItems.filter(Boolean),
        inventoryLotsEnabled: lotsEnabled,
        lotLabels,
        hasDiscrepancy: input.hasDiscrepancy,
      };
    }),

  receiveFromPurchaseV2: warehouseProcedure
    .input(z.object({
      purchaseOrderId:  z.number().int().positive(),
      purchaseOrderIds: z.array(z.number().int().positive()).min(1).max(500).optional(),
      sourceInvoiceNumber: z.string().max(100).optional(),
      vendorName:       z.string().optional(),
      vendorNameEn:     z.string().optional(),
      vendorTaxNumber:  z.string().optional(),
      // 2B-2: إما مورد Master موجود أو "مورد جديد" يتحول إلى Candidate.
      catalogSupplierId: z.number().optional(),
      isNewSupplier:     z.boolean().default(false),
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
      items:            z.array(receivedItemSchema).min(1, "أضف صنفاً واحداً على الأقل للاستلام").max(500),
    }))
    .mutation(async ({ input, ctx }) => {
      const po = await db.getPurchaseOrderById(input.purchaseOrderId);
      if (!po) throw new TRPCError({ code: "NOT_FOUND", message: "طلب الشراء غير موجود" });
      if (input.invoiceNumber) {
        const duplicate = await db.checkDuplicateInvoice({
          invoiceNumber: input.invoiceNumber,
          vendorTaxNumber: input.vendorTaxNumber,
        });
        if (duplicate) {
          throw new TRPCError({ code: "CONFLICT", message: `فاتورة مكررة - تم استلام هذه الفاتورة مسبقاً برقم ${duplicate.receiptNumber}` });
        }
      }
      const receiptOrderIds = receiptOrderScope(input.purchaseOrderId, input.purchaseOrderIds, input.sourceInvoiceNumber);
      // Re-read the exact receipt scope at this write boundary. The URL/read
      // snapshot never grants membership to a different PO or invoice.
      const groupedContext = receiptOrderIds.length > 1
        ? await getPurchaseReceiptContext(await db.getDb(), input.purchaseOrderId, input.sourceInvoiceNumber, receiptOrderIds)
        : null;
      const orderNumbers = new Map<number, string>(
        ((groupedContext as any)?.purchaseOrders || [po]).map((order: any) => [Number(order.id), order.poNumber]),
      );

      if (input.catalogSupplierId && input.isNewSupplier) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "اختر مورداً موجوداً أو حدد مورد جديد، وليس الاثنين معاً" });
      }
      if (!input.catalogSupplierId && !input.isNewSupplier) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "يجب تأكيد المورد الموجود أو تحديد أن المورد جديد" });
      }
      if (input.isNewSupplier && !input.vendorName?.trim()) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "اسم المورد مطلوب عند تحديد مورد جديد" });
      }

      let selectedCatalogSupplier: any = null;
      if (input.catalogSupplierId) {
        const coreDb = await db.getDb();
        if (!coreDb) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "تعذر الاتصال بقاعدة البيانات" });
        const supplierRows = await coreDb.select().from(catalogSuppliers)
          .where(and(eq(catalogSuppliers.id, input.catalogSupplierId), eq(catalogSuppliers.isActive, true)))
          .limit(1);
        selectedCatalogSupplier = supplierRows[0];
        if (!selectedCatalogSupplier) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "المورد المركزي المختار غير موجود أو غير نشط" });
        }
      }

      // ── حاجز أمان: نمنع كتابة أي بيانات على بند لا ينتمي فعلاً لهذا الطلب
      //   أو ليس بحالة "توريد للمستودع" — لكن فقط للأصناف التي اختار
      //   المستخدم ربطها ببند (purchaseOrderItemId موجود). الأصناف بلا ربط
      //   (صنف زائد بالفاتورة لا يقابله بند بالطلب) مسموحة عمداً.
      const poItemsAll = groupedContext ? groupedContext.items : await db.getPOItems(input.purchaseOrderId);
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

      // 2B-4: لا نقبل سطراً غامضاً أو قراراً متناقضاً.
      // Catalog-linked PO أقوى من أي Checkbox قادم من الواجهة.
      const poCatalogByItemId = new Map<number, number | null>(
        poItemsAll.map((i: any) => [Number(i.id), i.catalogItemId ? Number(i.catalogItemId) : null])
      );
      for (const item of input.items) {
        const poCatalogItemId = item.purchaseOrderItemId
          ? poCatalogByItemId.get(Number(item.purchaseOrderItemId))
          : null;
        const decision = validateCatalogItemDecision(item, poCatalogItemId);
        if (!decision.ok) {
          throw new TRPCError({ code: "BAD_REQUEST", message: decision.message || "قرار صنف الكتالوج غير صالح" });
        }
      }

      // 2B-10-2B: أي ربط Catalog جديد أثناء الاستلام يجب أن يشير إلى صنف نشط.
      // الاستثناء الوحيد هو استمرار نفس هوية Catalog المحفوظة مسبقاً على بند PO:
      // إذا تعطّل الـMaster Item بعد إنشاء الطلب، لا نكسر الاستلام التاريخي بسببه.
      const linkedCatalogIds = [...new Set(input.items
        .map(item => item.linkedItemId)
        .filter((id): id is number => typeof id === "number"))];
      if (linkedCatalogIds.length > 0) {
        const coreDb = await db.getDb();
        if (!coreDb) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "تعذر الاتصال بقاعدة البيانات" });
        const catalogRows = await coreDb.select({ id: catalogItems.id, isActive: catalogItems.isActive })
          .from(catalogItems)
          .where(inArray(catalogItems.id, linkedCatalogIds));
        const catalogStateById = new Map((catalogRows as any[]).map(row => [Number(row.id), Number(row.isActive) === 1]));

        for (const item of input.items) {
          if (!item.linkedItemId) continue;
          const linkedId = Number(item.linkedItemId);
          if (!catalogStateById.has(linkedId)) {
            throw new TRPCError({ code: "BAD_REQUEST", message: `صنف الكتالوج ${linkedId} غير موجود` });
          }
          const inheritedPoCatalogItemId = item.purchaseOrderItemId
            ? poCatalogByItemId.get(Number(item.purchaseOrderItemId))
            : null;
          const isHistoricalContinuation = inheritedPoCatalogItemId === linkedId;
          if (!isHistoricalContinuation && !catalogStateById.get(linkedId)) {
            throw new TRPCError({ code: "BAD_REQUEST", message: `لا يمكن إنشاء رابط استلام جديد إلى صنف كتالوج غير نشط (${linkedId})` });
          }
        }
      }

      // ── الجزء الحرج محاسبياً (الإيصال + بنوده + تحديث المخزون + حالة
      //   بنود الطلب) يُنفَّذ كمعاملة واحدة: إما ينجح بالكامل أو يُلغى
      //   بالكامل (rollback) — لا حالة وسطى ممزقة عند أي فشل جزئي.
      const lotsEnabled = isInventoryLotsEnabled();
      const { receiptId, receiptNumber, processedItems } = await db.withTransaction(async (tx) => {
        await lockAndValidatePurchaseReceiptItems(tx, input.purchaseOrderId, input.items, input.purchaseOrderIds, input.sourceInvoiceNumber);
        const replacementItemIds = await trialEnabled(tx)
          ? new Set((await readRows(tx, sql`SELECT purchaseOrderItemId FROM supplier_return_replacement_plans
              WHERE purchaseOrderId IN (${sql.join(receiptOrderIds.map(id => sql`${id}`), sql`,`)}) AND purchaseOrderItemId IS NOT NULL`))
              .map(row => Number(row.purchaseOrderItemId)))
          : new Set<number>();
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
          catalogSupplierId: input.catalogSupplierId,
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

        let supplierCandidateId: number | undefined;

        if (input.isNewSupplier) {
          const candidateResult = await tx.insert(catalogSupplierCandidates).values({
            receiptId: receiptId!,
            purchaseOrderId: input.purchaseOrderId,
            invoiceNumber: input.invoiceNumber || null,
            invoicePhotoUrl: input.invoicePhotoUrl || null,
            extractedName: input.vendorName!.trim(),
            extractedNameEn: input.vendorNameEn?.trim() || null,
            taxNumber: input.vendorTaxNumber?.trim() || null,
            status: "pending",
            createdById: ctx.user.id,
          } as any);
          supplierCandidateId = Number((candidateResult as any)[0]?.insertId || 0) || undefined;
          if (supplierCandidateId) {
            await tx.update(warehouseReceipts).set({ supplierCandidateId } as any)
              .where(eq(warehouseReceipts.id, receiptId!));
            await tx.insert(catalogAuditLogs).values({
              userId: ctx.user.id,
              action: "create_supplier_candidate",
              entityType: "supplier_candidate",
              entityId: supplierCandidateId,
              newValues: JSON.stringify({
                receiptId,
                purchaseOrderId: input.purchaseOrderId,
                invoiceNumber: input.invoiceNumber || null,
                extractedName: input.vendorName!.trim(),
                taxNumber: input.vendorTaxNumber?.trim() || null,
                status: "pending",
              }),
            } as any);
          }
        } else if (selectedCatalogSupplier && input.vendorName?.trim()) {
          const aliasName = input.vendorName.trim();
          const normalizedAlias = normalizeSupplierName(aliasName);
          const masterNames = [selectedCatalogSupplier.nameAr, selectedCatalogSupplier.nameEn]
            .map((v: string | null) => normalizeSupplierName(v));
          if (normalizedAlias && !masterNames.includes(normalizedAlias)) {
            const existingAlias = await tx.select({ id: catalogSupplierAliases.id })
              .from(catalogSupplierAliases)
              .where(and(
                eq(catalogSupplierAliases.supplierId, selectedCatalogSupplier.id),
                eq(catalogSupplierAliases.normalizedAlias, normalizedAlias),
              )).limit(1);
            if (existingAlias.length === 0) {
              const aliasResult = await tx.insert(catalogSupplierAliases).values({
                supplierId: selectedCatalogSupplier.id,
                aliasName,
                normalizedAlias,
                source: "invoice",
                createdById: ctx.user.id,
              } as any);
              const aliasId = Number((aliasResult as any)[0]?.insertId || 0) || undefined;
              await tx.insert(catalogAuditLogs).values({
                userId: ctx.user.id,
                action: "create_supplier_alias",
                entityType: "supplier_alias",
                entityId: aliasId,
                newValues: JSON.stringify({
                  supplierId: selectedCatalogSupplier.id,
                  aliasName,
                  source: "invoice",
                  receiptId,
                }),
              } as any);
            }
          }
        }

        const processedItems: any[] = [];

        for (const item of input.items) {
          const orderedItem = poItemsAll.find((candidate: any) => Number(candidate.id) === Number(item.purchaseOrderItemId));
          // Receipt header retains the entry PO for compatibility; each receipt
          // line, lot and movement keeps its actual source PO/item identity.
          const sourcePurchaseOrderId = orderedItem?.purchaseOrderId ?? input.purchaseOrderId;
          const processed = await processReceiptItem({
            item,
            receiptId: receiptId!,
            purchaseOrderId: sourcePurchaseOrderId,
            poNumber: orderNumbers.get(sourcePurchaseOrderId),
            receiptNumber,
            performedById: ctx.user.id,
            tx,
            deferTransaction: lotsEnabled,
          });
          processedItems.push(processed);

          const orderUnit = (await getActiveCatalogUnitCanonicalName(orderedItem?.unit, tx)) || orderedItem?.unit || "";
          const receivedUnit = (await getActiveCatalogUnitCanonicalName(item.purchaseUnit, tx)) || item.purchaseUnit;
          const inOrderUnits = receiptInOrderUnits({ orderUnit, receivedUnit, issueUnit: item.issueUnit,
            quantity: item.receivedQuantity, unitCost: processed.purchaseUnitCost, factor: item.conversionFactor });


          const receiptItemId = await db.createWarehouseReceiptItem({
            receiptId: receiptId!,
            inventoryId: processed.inventoryId,
            purchaseOrderItemId: item.purchaseOrderItemId,
            // 2B-7: سطر الاستلام/الفاتورة يحمل Catalog identity مباشرة.
            // للصنف الجديد تبقى NULL حتى يحسم Catalog Candidate لاحقاً.
            catalogItemId: item.linkedItemId,
            itemName: item.itemName,
            itemNameAr: item.itemName_ar,
            itemNameEn: item.itemName_en,
            isNewCatalogItem: item.isNewCatalogItem,
            receivedQuantity: item.receivedQuantity.toString(),
            purchaseUnit: item.purchaseUnit,
            unitCost: item.unitCost,
            taxRate: item.taxRate.toString(),
            taxAmount: item.taxAmount,
            lineTotal: item.lineTotal,
            expectedQuantity: item.expectedQuantity?.toString(),
            quantityDiff: orderedItem && inOrderUnits ? (inOrderUnits.quantity - Number(orderedItem.quantity)).toString() : undefined,
            expectedUnitCost: item.expectedUnitCost,
            priceDiff: item.expectedUnitCost && inOrderUnits ? (inOrderUnits.unitCost - parseFloat(item.expectedUnitCost)).toString() : undefined,
            ocrExtracted: item.ocrExtracted,
            manuallyEdited: item.manuallyEdited,
          }, tx);

          if (lotsEnabled) {
            if (!receiptItemId) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "تعذر إنشاء سطر الاستلام قبل إنشاء الدفعة" });
            const lot = await createReceiptInventoryLot({
              tx,
              catalogItemId: item.linkedItemId ?? null,
              inventoryId: processed.inventoryId,
              receiptId: receiptId!,
              receiptItemId: Number(receiptItemId),
              purchaseOrderId: sourcePurchaseOrderId,
              purchaseOrderItemId: item.purchaseOrderItemId ?? null,
              catalogSupplierId: selectedCatalogSupplier?.id ?? null,
              supplierCandidateId: supplierCandidateId ?? null,
              issueQuantity: processed.issueQuantity,
              purchaseUnit: item.purchaseUnit,
              issueUnit: item.issueUnit || item.purchaseUnit,
              conversionFactor: item.conversionFactor,
              purchaseUnitCost: processed.purchaseUnitCost,
              issueUnitCost: processed.issueUnitCost,
              supplierItemName: item.itemName,
              supplierItemCode: item.supplierItemCode,
              expiryDate: item.expiryDate,
              createdById: ctx.user.id,
            });
            processed.lotId = lot.lotId;
            processed.lotCode = lot.lotCode;
            processed.trackingToken = lot.trackingToken;

            await db.addInventoryTransactionV2({
              inventoryId: processed.inventoryId,
              lotId: lot.lotId,
              type: "in",
              quantity: processed.issueQuantity,
              unitCost: processed.issueUnitCost.toFixed(4),
              totalCost: calculateMovementTotal(processed.issueQuantity, processed.issueUnitCost).toFixed(2),
              reason: processed.transactionReason,
              purchaseOrderItemId: item.purchaseOrderItemId,
              performedById: ctx.user.id,
              transactionType: "purchase",
              receiptId: receiptId!,
            }, tx);
          }

          if (item.purchaseOrderItemId && replacementItemIds.has(Number(item.purchaseOrderItemId))) {
            if (!receiptItemId || !inOrderUnits || !orderedItem?.unit) throw new TRPCError({ code: "CONFLICT", message: "تعذر تحديد كمية البديل بوحدة طلب الشراء" });
            await linkReplacementReceipt(tx, ctx.user.id, {
              purchaseOrderId: Number(sourcePurchaseOrderId), purchaseOrderItemId: Number(item.purchaseOrderItemId),
              receiptId: Number(receiptId), receiptItemId: Number(receiptItemId), lotId: processed.lotId ?? null,
              quantityInOrderUnits: String(inOrderUnits.quantity), orderUnit: orderedItem.unit,
            });
          }

          // 2B-5: إنشاء/إعادة استخدام Catalog Item Candidate للصنف الجديد
          // داخل نفس transaction، بدون انتظار أي اعتماد من مسؤول الكتالوج.
          if (item.isNewCatalogItem && receiptItemId) {
            const candidate = await ensurePendingCatalogItemCandidate(tx, {
              inventoryId: processed.inventoryId,
              sourceReceiptId: receiptId!,
              sourceReceiptItemId: Number(receiptItemId),
              purchaseOrderId: sourcePurchaseOrderId,
              purchaseOrderItemId: item.purchaseOrderItemId,
              catalogSupplierId: selectedCatalogSupplier?.id,
              supplierCandidateId,
              invoiceNumber: input.invoiceNumber,
              itemName: item.itemName,
              itemNameAr: item.itemName_ar,
              itemNameEn: item.itemName_en,
              supplierItemCode: item.supplierItemCode,
              purchaseUnit: item.purchaseUnit,
              manufacturerBarcode: item.manufacturerBarcode,
              createdById: ctx.user.id,
            });
            processed.catalogItemCandidateId = candidate.id;
            processed.catalogItemCandidateCreated = candidate.created;
          }

          // 2B-3: بعد تأكيد المستخدم لـ Catalog Item نحفظ اسم/SKU المورد
          // كذاكرة تعلم مستقبلية. لا نغيّر السعر ولا ننشئ Catalog Item جديداً هنا.
          if (selectedCatalogSupplier && item.linkedItemId) {
            const inheritedPoCatalogItemId = item.purchaseOrderItemId
              ? poCatalogByItemId.get(Number(item.purchaseOrderItemId))
              : null;
            await rememberSupplierItemAlias({
              tx,
              supplierId: selectedCatalogSupplier.id,
              catalogItemId: item.linkedItemId,
              supplierItemName: item.itemName,
              supplierItemCode: item.supplierItemCode,
              unit: item.purchaseUnit,
              createdById: ctx.user.id,
              allowInactiveCatalogItem: inheritedPoCatalogItemId === Number(item.linkedItemId),
            });
          }

          // تحديث بند الطلب فقط للأصناف المربوطة فعلياً ببند حقيقي — الأصناف
          // الزائدة عن الطلب (بلا purchaseOrderItemId) تُستلم للمخزون فقط
          // دون أي أثر على بنود الطلب أو حالته
          if (item.purchaseOrderItemId) {
            await db.updatePOItem(item.purchaseOrderItemId, {
              status:            "delivered_to_warehouse",
              receivedAt:        new Date(),
              receivedById:      ctx.user.id,
              ...(inOrderUnits ? { receivedQuantity: inOrderUnits.quantity, actualUnitCost: inOrderUnits.unitCost.toFixed(4) } : {}),
              supplierName:      input.vendorName,
              actualTotalCost:   item.lineTotal,
              warehousePhotoUrl: input.goodsPhotoUrl,
              ...(item.linkedItemId ? { catalogItemId: item.linkedItemId } : {}),
            }, tx);
          }
        }

        for (const receiptOrderId of receiptOrderIds) {
          const allItems = await db.getPOItems(receiptOrderId, tx);
          const activeItems = allItems.filter((i: any) => !["rejected", "cancelled"].includes(i.status));
          // ✅ إصلاح حرج #6: نفس تحقق length > 0 قبل every() لمنع الصدق الفارغ
          const allInWarehouse = activeItems.length > 0 && activeItems.every((i: any) =>
            ["delivered_to_warehouse", "delivered_to_requester"].includes(i.status)
          );
          if (allInWarehouse) {
            await db.updatePurchaseOrder(receiptOrderId, { status: "received" }, tx);
          }
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
          relatedPoId: input.purchaseOrderId,
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


      const lotLabels = processedItems.flatMap((p: ProcessedItem, index: number) =>
        p.lotId && p.trackingToken && p.lotCode ? [{
          lotId: p.lotId,
          lotCode: p.lotCode,
          trackingToken: p.trackingToken,
          itemName: input.items[index]?.itemName || `Inventory #${p.inventoryId}`,
          quantity: p.issueQuantity,
          unit: input.items[index]?.issueUnit || input.items[index]?.purchaseUnit || "",
          sourceType: "receipt" as const,
          receiptNumber,
        }] : []
      );

      return {
        receiptId,
        receiptNumber,
        processedItems,
        inventoryLotsEnabled: lotsEnabled,
        lotLabels,
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
  // 2B-8: movement values are returned so the caller can create Receipt Item + Lot
  // first, then persist the purchase transaction with the exact lotId in the same DB tx.
  issueQuantity:   number;
  purchaseUnitCost: number;
  issueUnitCost:   number;
  transactionReason: string;
  lotId?:          number;
  lotCode?:        string;
  trackingToken?:  string;
  // 2B-5: present only when this operational inventory identity is awaiting Catalog review.
  catalogItemCandidateId?: number;
  catalogItemCandidateCreated?: boolean;
}

async function rememberSupplierItemAlias(params: {
  tx: any;
  supplierId: number;
  catalogItemId: number;
  supplierItemName: string;
  supplierItemCode?: string;
  unit?: string;
  createdById: number;
  allowInactiveCatalogItem?: boolean;
}): Promise<void> {
  const { tx, supplierId, catalogItemId, supplierItemName, supplierItemCode, unit, createdById, allowInactiveCatalogItem } = params;

  const catalogRows = await tx.select({ id: catalogItems.id, isActive: catalogItems.isActive })
    .from(catalogItems)
    .where(eq(catalogItems.id, catalogItemId))
    .limit(1);
  const catalogRow = catalogRows[0] as any;
  if (!catalogRow) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `صنف الكتالوج ${catalogItemId} غير موجود` });
  }
  if (!catalogRow.isActive) {
    if (allowInactiveCatalogItem) {
      // استمرار تاريخي مسموح، لكن لا ننشئ/نعيد تنشيط Supplier Alias جديداً
      // إلى Master Item معطّل؛ هذا يمنع علاقة مستقبلية جديدة مع الحفاظ على الاستلام.
      return;
    }
    throw new TRPCError({ code: "BAD_REQUEST", message: `صنف الكتالوج ${catalogItemId} غير نشط` });
  }

  const normalizedName = normalizeCatalogItemText(supplierItemName);
  if (!normalizedName) return;
  const normalizedItemCode = normalizeSupplierItemCode(supplierItemCode) || null;
  const measurements = extractNormalizedMeasurements([supplierItemName, unit].filter(Boolean).join(" "));

  const sameNameRows = await tx.select({
    id: catalogSupplierItemAliases.id,
    confirmationCount: catalogSupplierItemAliases.confirmationCount,
    normalizedItemCode: catalogSupplierItemAliases.normalizedItemCode,
  }).from(catalogSupplierItemAliases).where(and(
    eq(catalogSupplierItemAliases.supplierId, supplierId),
    eq(catalogSupplierItemAliases.catalogItemId, catalogItemId),
    eq(catalogSupplierItemAliases.normalizedName, normalizedName),
  ));

  // نفس الاسم قد يملك أكثر من SKU تاريخياً عند المورد نفسه؛ لا نستبدل كوداً
  // مختلفاً. نزيد التأكيد فقط عندما يتطابق الاسم والكود المنظف معاً.
  const existing = (sameNameRows as any[]).find(row =>
    (row.normalizedItemCode || null) === normalizedItemCode
  );

  if (existing) {
    const nextConfirmationCount = Number(existing.confirmationCount || 1) + 1;
    await tx.update(catalogSupplierItemAliases).set({
      supplierItemName: supplierItemName.trim(),
      supplierItemCode: supplierItemCode?.trim() || null,
      normalizedItemCode,
      normalizedMeasurements: measurements as any,
      confirmationCount: nextConfirmationCount,
      lastConfirmedAt: new Date(),
      isActive: 1,
    } as any).where(eq(catalogSupplierItemAliases.id, existing.id));
    await tx.insert(catalogAuditLogs).values({
      userId: createdById,
      action: "confirm_supplier_item_alias",
      entityType: "supplier_item_alias",
      entityId: existing.id,
      oldValues: JSON.stringify({ confirmationCount: Number(existing.confirmationCount || 1) }),
      newValues: JSON.stringify({
        supplierId,
        catalogItemId,
        supplierItemName: supplierItemName.trim(),
        supplierItemCode: supplierItemCode?.trim() || null,
        confirmationCount: nextConfirmationCount,
        source: "invoice",
        isActive: true,
      }),
    } as any);
    return;
  }

  const aliasResult = await tx.insert(catalogSupplierItemAliases).values({
    supplierId,
    catalogItemId,
    supplierItemName: supplierItemName.trim(),
    normalizedName,
    supplierItemCode: supplierItemCode?.trim() || null,
    normalizedItemCode,
    normalizedMeasurements: measurements as any,
    source: "invoice",
    confirmationCount: 1,
    lastConfirmedAt: new Date(),
    createdById,
    isActive: 1,
  } as any);
  const aliasId = Number((aliasResult as any)[0]?.insertId || 0) || undefined;
  await tx.insert(catalogAuditLogs).values({
    userId: createdById,
    action: "create_supplier_item_alias",
    entityType: "supplier_item_alias",
    entityId: aliasId,
    newValues: JSON.stringify({
      supplierId,
      catalogItemId,
      supplierItemName: supplierItemName.trim(),
      supplierItemCode: supplierItemCode?.trim() || null,
      source: "invoice",
      isActive: true,
    }),
  } as any);
}

async function resolveReceiptWarehouseId(item: z.infer<typeof receivedItemSchema>, tx: any): Promise<number> {
  const explicitWarehouseId = Number(item.warehouseId || 0);
  if (explicitWarehouseId > 0) {
    const rows = await tx.select({ id: warehouses.id, isActive: warehouses.isActive })
      .from(warehouses)
      .where(eq(warehouses.id, explicitWarehouseId))
      .limit(1);
    if (!rows[0]) throw new TRPCError({ code: "BAD_REQUEST", message: "المستودع المحدد للاستلام غير موجود" });
    if (!rows[0].isActive) throw new TRPCError({ code: "BAD_REQUEST", message: "المستودع المحدد للاستلام غير مفعّل" });
    return explicitWarehouseId;
  }

  // Existing Inventory identity is stronger than any historical implicit main-warehouse fallback.
  if (item.inventoryId) {
    const existing = await db.getInventoryItemById(Number(item.inventoryId), tx);
    const existingWarehouseId = Number((existing as any)?.warehouseId || 0);
    if (existingWarehouseId > 0) return existingWarehouseId;
  }

  // No hard-coded warehouse id: resolve the single active Main warehouse dynamically.
  const mainRows = await tx.select({ id: warehouses.id })
    .from(warehouses)
    .where(and(eq(warehouses.type, "main"), eq(warehouses.isActive, 1)))
    .orderBy(warehouses.id)
    .limit(2);
  if (mainRows.length === 0) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "لا يوجد مستودع رئيسي مفعّل يمكن استخدامه للاستلام" });
  }
  if (mainRows.length > 1) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "يوجد أكثر من مستودع رئيسي مفعّل؛ يجب تحديد المستودع صراحة قبل الاستلام" });
  }
  return Number(mainRows[0].id);
}

async function processReceiptItem(params: {
  item:            z.infer<typeof receivedItemSchema>;
  receiptId:       number;
  purchaseOrderId?: number;
  poNumber?:       string; // غير موجود = استلام مستقل بلا طلب شراء
  receiptNumber:   string;
  performedById:   number;
  tx:              any;
  // 2B-8: عند تفعيل Lots نؤجل حركة الشراء حتى إنشاء receipt item والـLot،
  // ثم تُسجل الحركة مع lotId داخل نفس transaction.
  deferTransaction?: boolean;
}): Promise<ProcessedItem> {
  const { item, receiptId, poNumber, receiptNumber, performedById, tx } = params;
  const sourceLabel = poNumber ? `طلب شراء ${poNumber}` : "استلام مستقل (بلا طلب شراء)";
  const receiptWarehouseId = await resolveReceiptWarehouseId(item, tx);
  const [issueUnitRecord] = await tx.select({ id: catalogUnits.id }).from(catalogUnits)
    .where(and(eq(catalogUnits.nameAr, item.issueUnit), eq(catalogUnits.isActive, 1))).limit(1);
  if (!issueUnitRecord) throw new TRPCError({ code: "BAD_REQUEST", message: "اختر وحدة صرف فعالة من قائمة الوحدات" });
  if (item.linkedItemId) {
    const [catalogItem] = await tx.select({ unit: catalogItems.unit }).from(catalogItems).where(eq(catalogItems.id, item.linkedItemId)).limit(1);
    const catalogIssueUnit = (await getActiveCatalogUnitCanonicalName(catalogItem?.unit, tx)) || catalogItem?.unit;
    if (catalogIssueUnit && catalogIssueUnit !== item.issueUnit) throw new TRPCError({ code: "BAD_REQUEST", message: `وحدة صرف صنف الكتالوج هي «${catalogIssueUnit}». اختر الوحدة المطابقة؛ تغيير الوحدة الأساسية للسجلات السابقة يحتاج معالجة مستقلة.` });
  }
  let inventoryId = item.inventoryId;

  // Phase 2 deferred identity decision — future-facing protection only:
  // Catalog Item is the master identity. If the client did not explicitly supply an
  // Inventory row, reuse the single existing stock row for the same Catalog Item +
  // Warehouse. Legacy duplicates are left untouched; ambiguity is blocked instead of
  // silently creating a third row or choosing one arbitrarily.
  if (!inventoryId && item.linkedItemId) {
    const matches = await db.getInventoryMatchesByCatalogItemAndWarehouse(
      Number(item.linkedItemId),
      receiptWarehouseId,
      tx,
      isInventoryLotsEnabled() ? item.issueUnit : undefined,
    );

    if (matches.length > 1) {
      throw new TRPCError({
        code: "CONFLICT",
        message: "يوجد أكثر من سجل مخزون قديم لنفس صنف الكتالوج داخل المستودع. لن ينشئ النظام سجلًا جديدًا؛ يجب معالجة التكرار القديم بشكل مستقل.",
      });
    }

    if (matches[0]) {
      inventoryId = Number(matches[0].id);
    }
  }

  let isNew = false;
  let internalCode = "";

  // تكلفة الفاتورة تكون بوحدة الشراء، بينما رصيد المخزون محفوظ بوحدة الصرف.
  const purchaseUnitCost = parseFloat(item.unitCost);
  const issueQuantity = calculateIssueQuantity(item.receivedQuantity, item.conversionFactor);
  const issueUnitCost = calculateIssueUnitCost(purchaseUnitCost, item.conversionFactor);

  let newAverageCost = issueUnitCost;
  let transactionReason = `استلام أول - ${sourceLabel} - فاتورة ${receiptNumber}`;

  if (inventoryId) {
    await tx.execute(sql`SELECT id FROM inventory WHERE id = ${inventoryId} FOR UPDATE`);
    const existing = await db.getInventoryItemById(inventoryId, tx);
    if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: `الصنف ${inventoryId} غير موجود` });
    const storedIssueUnit = String((existing as any).issueUnit || existing.unit || "").trim();
    const currentIssueUnit = (await getActiveCatalogUnitCanonicalName(storedIssueUnit, tx)) || storedIssueUnit;
    if (currentIssueUnit && currentIssueUnit !== item.issueUnit) {
      throw new TRPCError({ code: "BAD_REQUEST", message: `وحدة صرف الصنف المخزنية هي «${currentIssueUnit}». لا يمكن دمج أرصدة بوحدات مختلفة أو تغيير الرصيد القديم أثناء الاستلام.` });
    }
    const existingWarehouseId = Number((existing as any).warehouseId || 0);
    if (existingWarehouseId > 0 && existingWarehouseId !== receiptWarehouseId) {
      throw new TRPCError({ code: "CONFLICT", message: "سجل المخزون المحدد لا ينتمي إلى مستودع الاستلام" });
    }

    const oldQty     = Number(existing.quantity || 0);
    const oldAvgCost = parseFloat((existing as any).averageCost || "0");
    const newQty     = oldQty + issueQuantity;
    newAverageCost = calculateMovingWeightedAverage({
      currentQuantity: oldQty,
      currentAverageCost: oldAvgCost,
      incomingQuantity: issueQuantity,
      incomingUnitCost: issueUnitCost,
    });

    await db.updateInventoryItemV2(inventoryId, {
      lastRestockedAt: new Date(),
      averageCost:     newAverageCost.toFixed(4),
      totalCostValue:  calculateInventoryValue(newQty, newAverageCost).toFixed(2),
      ...(item.linkedItemId ? { linkedItemId: item.linkedItemId } : {}),
      ...(!((existing as any).manufacturerBarcode) && item.manufacturerBarcode
        ? { manufacturerBarcode: item.manufacturerBarcode }
        : {}),
    }, tx);

    internalCode = (existing as any).internalCode || "";
    transactionReason = `استلام من ${sourceLabel} - فاتورة ${receiptNumber}`;
  } else {
    isNew = true;
    internalCode = await db.getNextInventoryCode(tx);

    inventoryId = await db.createInventoryItemV2({
      itemName:             item.itemName,
      itemNameAr:           item.itemName_ar,
      itemNameEn:           item.itemName_en,
      itemType:             item.itemType,
      quantity:             0,
      unit:                 item.issueUnit || item.purchaseUnit,
      purchaseUnit:         item.purchaseUnit,
      issueUnit:            item.issueUnit,
      conversionFactor:     item.conversionFactor.toString(),
      minQuantity:          0,
      averageCost:          issueUnitCost.toFixed(4),
      totalCostValue:       "0",
      internalCode,
      manufacturerBarcode:  item.manufacturerBarcode,
      expiryDate:           item.expiryDate ? new Date(item.expiryDate) : undefined,
      linkedItemId:         item.linkedItemId,
      assetId:              item.assetId,
      warehouseId:          receiptWarehouseId,
      receiptId,
    }, tx) as number;
  }

  const processed: ProcessedItem = {
    inventoryId: Number(inventoryId),
    isNew,
    internalCode,
    newAverageCost,
    issueQuantity,
    purchaseUnitCost,
    issueUnitCost,
    transactionReason,
  };

  if (!params.deferTransaction) {
    await db.addInventoryTransactionV2({
      inventoryId: processed.inventoryId,
      type:                "in",
      quantity:            issueQuantity,
      unitCost:            issueUnitCost.toFixed(4),
      totalCost:           calculateMovementTotal(issueQuantity, issueUnitCost).toFixed(2),
      reason:              transactionReason,
      purchaseOrderItemId: item.purchaseOrderItemId,
      performedById,
      transactionType:     "purchase",
      receiptId,
    }, tx);
  }

  return processed;
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

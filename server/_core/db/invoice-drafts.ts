// ============================================================
// db/invoice-drafts.ts — مسودات الفواتير واعتمادها
// (مُقسَّم من db.ts الأصلي حسب المجال الوظيفي)
// ============================================================
import { eq, desc, asc, and, sql, count, sum, inArray, notInArray, like, or, gte, lte, lt, isNull, isNotNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { alias } from "drizzle-orm/mysql-core";
import mysql from "mysql2/promise";
import {
  InsertUser, users, tickets, purchaseOrders, purchaseOrderItems,
  inventory, inventoryTransactions, notifications, auditLogs,
  ticketStatusHistory, attachments, sites, backups,
  assets, preventivePlans, pmWorkOrders, assetSpareParts, pmJobs, assetMetrics,
  pmChecklistItems, pmWorkOrderBranches,
  twoFactorSecrets, twoFactorAuditLogs,
  pushSubscriptions, sections, technicians, inspectionResults,
  type InsertAsset, type InsertPreventivePlan, type PreventivePlan, type InsertPMWorkOrder,
  type InsertSection, type InsertInspectionResult,
  assetCategories,
  procurementComments,
  type InsertProcurementComment,
  warehouseReceipts,
  warehouseReturns,
  warehouseReceiptItems,
  ocrJobs,
  type InsertWarehouseReceipt,
  type InsertWarehouseReturn,
  ticketConfirmations,
  type InsertTicketConfirmation,
  deliveryDocuments,
  returnDocuments,
  deliveryNumberCounter,
  itemBarcodeCounter,
  disposalOperations,
  disposalItems,
  disposalNumberCounter,
  poPricingBatches,
  type InsertPOPricingBatch,
  inventoryCountOperations,
  inventoryCountItems,
  inventoryCountSnapshots,
  warehouses,
  inventorySettlements,
  inventorySettlementItems,
  inventoryCountNumberCounter,
  inventorySettlementNumberCounter,
  inventorySettlementDrafts,
  inventoryCountCorrections,
  catalogItems,
  catalogItemCandidates,
  catalogNodes,
  inventoryLots,
  inventoryLotBalances,
} from "../../../drizzle/schema";
import { ENV } from '../env';


import { getDb } from "./client";
import { getInventoryItemById, getUserById } from "./deletes";
import { getNextInventoryCode, getNextItemBarcode } from "./warehouse-receipts";
import { createInventoryItemV2 } from "./warehouse-returns";
import { getInventoryMatchesByCatalogItemAndWarehouse } from "./inventory";
import {
  applyInventoryLotCountAdjustment,
  createReceiptInventoryLot,
  createOpeningBalanceInventoryLot,
  isInventoryLotsEnabled,
  resolveInventoryLotForCount,
} from "../inventory-lots";
import {
  calculateInventoryValue,
  calculateMovementTotal,
  calculateMovingWeightedAverage,
  normalizeInventoryQuantity,
  roundTo,
} from "../inventory-costing";

export async function createWarehouseReceiptDraft(data: {
  receiptNumber:    string;
  purchaseOrderId:  number;
  receivedById:     number;
  notes?:           string;
  totalItems?:      number;
  vendorName?:      string;
  vendorNameEn?:    string;
  vendorTaxNumber?: string;
  invoiceNumber?:   string;
  invoiceDate?:     Date;
  subtotal?:        string;
  taxAmount?:       string;
  grandTotal?:      string;
  invoicePhotoUrl?: string;
  goodsPhotoUrl?:   string;
  hasDiscrepancy?:  boolean;
  discrepancyNotes?: string;
}) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.insert(warehouseReceipts).values({
    ...data,
    status: "draft",
    isDraft: true,
  } as any);
  return result[0].insertId as number;
}

export async function approveWarehouseReceipt(
  receiptId: number,
  approvedById: number
) {
  const db = await getDb();
  if (!db) return;
  await db.update(warehouseReceipts)
    .set({ status: "approved", isDraft: false, approvedById, approvedAt: new Date() } as any)
    .where(eq(warehouseReceipts.id, receiptId));
}

export async function getWarehouseReceiptDraft(id: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(warehouseReceipts)
    .where(eq(warehouseReceipts.id, id)).limit(1);
  if (!rows[0]) return null;
  const items = await db.select().from(warehouseReceiptItems)
    .where(eq(warehouseReceiptItems.receiptId, id));
  return { ...rows[0], items };
}

export async function listDraftReceipts(purchaseOrderId?: number) {
  const db = await getDb();
  if (!db) return [];
  let q = db.select().from(warehouseReceipts)
    .where(eq((warehouseReceipts as any).isDraft, true))
    .orderBy(desc(warehouseReceipts.createdAt));
  return q.limit(50);
}

// ─────────────────────────────────────────────────────────────
// تجميع أصناف PO حسب الفاتورة (نفس رقم الفاتورة + المورد)
// ─────────────────────────────────────────────────────────────
export async function groupPOItemsByInvoice(purchaseOrderId: number) {
  const db = await getDb();
  if (!db) return [];

  // جلب كل OCR jobs المكتملة لهذا الطلب
  const jobs = await db.select().from(ocrJobs)
    .where(
      and(
        eq(ocrJobs.purchaseOrderId, purchaseOrderId),
        eq(ocrJobs.status, "ocr_completed" as any),
      )
    )
    .orderBy(desc(ocrJobs.createdAt));

  if (!jobs.length) return [];

  // تجميع حسب رقم الفاتورة + المورد
  const groups: Record<string, {
    invoiceKey:     string;
    invoiceNumber?: string;
    vendorName?:    string;
    vendorTaxNumber?: string;
    invoiceDate?:   string;
    subtotal?:      number;
    taxAmount?:     number;
    grandTotal?:    number;
    items:          any[];
    ocrJobIds:      number[];
  }> = {};

  for (const job of jobs) {
    const data = job.extractedData as any;
    if (!data) continue;

    const invoiceKey = `${data.invoiceNumber || "unknown"}_${data.vendorTaxNumber || data.vendorName || "unknown"}`;

    if (!groups[invoiceKey]) {
      groups[invoiceKey] = {
        invoiceKey,
        invoiceNumber:   data.invoiceNumber,
        vendorName:      data.vendorName,
        vendorTaxNumber: data.vendorTaxNumber,
        invoiceDate:     data.invoiceDate,
        subtotal:        data.subtotal,
        taxAmount:       data.taxAmount,
        grandTotal:      data.grandTotal,
        items:           [],
        ocrJobIds:       [],
      };
    }

    groups[invoiceKey].ocrJobIds.push(job.id);

    // إضافة الأصناف من هذا الـ OCR job
    if (Array.isArray(data.items)) {
      for (const item of data.items) {
        groups[invoiceKey].items.push({
          ...item,
          purchaseOrderItemId: job.purchaseOrderItemId,
          ocrJobId:            job.id,
        });
      }
    }
  }

  return Object.values(groups);
}

// ─────────────────────────────────────────────────────────────
// OCR JOBS - تحديث مع الحقول الجديدة
// ─────────────────────────────────────────────────────────────

export async function createOcrJobV2(data: {
  receiptId?:           number;
  purchaseOrderId?:     number;
  purchaseOrderItemId?: number;
  imageUrl:             string;
  createdById:          number;
  status?:              string;
}) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.insert(ocrJobs).values({
    ...data,
    status: (data.status || "pending") as any,
  });
  return result[0].insertId as number;
}

export async function updateOcrJobStatus(id: number, data: {
  status:           string;
  extractedData?:   any;
  rawResponse?:     any;
  confidence?:      number;
  confidenceScore?: number;
  needsManualReview?: boolean;
  errorMessage?:    string;
  processingMs?:    number;
  completedAt?:     Date;
  approvedById?:    number;
  approvedAt?:      Date;
}) {
  const db = await getDb();
  if (!db) return;
  await db.update(ocrJobs).set(data as any).where(eq(ocrJobs.id, id));
}

export async function getOcrJobsByPO(purchaseOrderId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(ocrJobs)
    .where(eq(ocrJobs.purchaseOrderId, purchaseOrderId))
    .orderBy(desc(ocrJobs.createdAt));
}

// ─────────────────────────────────────────────────────────────
// كشف الفاتورة المكررة (بعد إصلاح Schema)
// ─────────────────────────────────────────────────────────────

export async function checkDuplicateInvoiceV2(data: {
  invoiceNumber:    string;
  vendorTaxNumber?: string;
}) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select({
    id:            warehouseReceipts.id,
    receiptNumber: warehouseReceipts.receiptNumber,
    invoiceNumber: warehouseReceipts.invoiceNumber,
    createdAt:     warehouseReceipts.createdAt,
  })
    .from(warehouseReceipts)
    .where(eq(warehouseReceipts.invoiceNumber, data.invoiceNumber))
    .limit(1);
  return rows[0] || null;
}

// ─────────────────────────────────────────────────────────────
// إدخال المخزون بعد الاعتماد
// ─────────────────────────────────────────────────────────────

export async function processApprovedReceiptItems(
  receiptId: number,
  performedById: number
) {
  const db = await getDb();
  if (!db) return;

  const receipt = await getWarehouseReceiptDraft(receiptId);
  if (!receipt) throw new Error("الفاتورة غير موجودة");

  const lotsEnabled = isInventoryLotsEnabled();
  const lotLabels: Array<{
    lotId: number;
    lotCode: string;
    trackingToken: string;
    itemName: string;
    quantity: number;
    unit: string;
    sourceType: "receipt";
    receiptNumber: string;
  }> = [];

  const applyApprovedReceipt = async (writer: any) => {
    let receiptWarehouseId: number | null = null;
    const getReceiptWarehouseId = async () => {
      if (receiptWarehouseId) return receiptWarehouseId;
      const mainRows = await writer.select({ id: warehouses.id })
        .from(warehouses)
        .where(and(eq(warehouses.type, "main"), eq(warehouses.isActive, 1)))
        .orderBy(warehouses.id)
        .limit(2);
      if (mainRows.length === 0) throw new Error("لا يوجد مستودع رئيسي مفعّل يمكن استخدامه للاستلام");
      if (mainRows.length > 1) throw new Error("يوجد أكثر من مستودع رئيسي مفعّل؛ يجب تحديد المستودع صراحة قبل الاستلام");
      receiptWarehouseId = Number(mainRows[0].id);
      return receiptWarehouseId;
    };

    for (const item of (receipt as any).items || []) {
      const qty      = normalizeInventoryQuantity(parseFloat(item.receivedQuantity || "1"));
      const unitCost = parseFloat(item.unitCost || "0");
      if (qty < 0.001) throw new Error(`كمية الاستلام للصنف "${item.itemName}" يجب أن تكون 0.001 أو أكثر`);

      // Same future-facing protection as receipts.v2. This legacy draft path has no
      // warehouseId on warehouse_receipts, so resolve the single active Main warehouse
      // dynamically instead of relying on a fixed numeric id.
      if (!item.inventoryId && item.catalogItemId) {
        const matches = await getInventoryMatchesByCatalogItemAndWarehouse(
          Number(item.catalogItemId),
          await getReceiptWarehouseId(),
          writer,
          lotsEnabled ? String(item.purchaseUnit || "قطعة") : undefined,
        );
        if (matches.length > 1) {
          throw new Error("يوجد أكثر من سجل مخزون قديم لنفس صنف الكتالوج داخل المستودع. لن ينشئ النظام سجلًا جديدًا؛ يجب معالجة التكرار القديم بشكل مستقل.");
        }
        if (matches[0]) {
          item.inventoryId = Number(matches[0].id);
          await writer.update(warehouseReceiptItems).set({
            inventoryId: item.inventoryId,
          } as any).where(eq(warehouseReceiptItems.id, item.id));
        }
      }

      if (item.inventoryId) {
        await writer.execute(sql`SELECT id FROM inventory WHERE id = ${item.inventoryId} FOR UPDATE`);
        const existing = await getInventoryItemById(item.inventoryId, writer);
        if (existing) {
          const oldQty     = Number(existing.quantity || 0);
          const oldCost    = parseFloat((existing as any).averageCost || "0");
          const newQty     = normalizeInventoryQuantity(oldQty + qty);
          const newAvgCost = calculateMovingWeightedAverage({
            currentQuantity: oldQty,
            currentAverageCost: oldCost,
            incomingQuantity: qty,
            incomingUnitCost: unitCost,
          });

          await writer.update(inventory).set({
            quantity:       newQty,
            averageCost:    newAvgCost.toFixed(4),
            totalCostValue: calculateInventoryValue(newQty, newAvgCost).toFixed(2),
            lastRestockedAt: new Date(),
          } as any).where(eq(inventory.id, item.inventoryId));
        }
      } else {
        const internalCode = await getNextInventoryCode(writer);
        const result = await writer.insert(inventory).values({
          itemName:        item.itemName,
          itemNameAr:      item.itemName_ar,
          itemNameEn:      item.itemName_en,
          itemType:        item.itemType || "consumable",
          // Legacy behavior remains unchanged while the lot rollout is gated off.
          // Once lot tracking is explicitly enabled, the approved receipt must have
          // aggregate Inventory equal to its initial Lot balance from the same tx.
          quantity:        lotsEnabled ? qty : 0,
          unit:            item.purchaseUnit || "قطعة",
          purchaseUnit:    item.purchaseUnit,
          issueUnit:       item.purchaseUnit,
          conversionFactor: "1.0000",
          averageCost:     unitCost.toFixed(4),
          totalCostValue:  lotsEnabled ? calculateInventoryValue(qty, unitCost).toFixed(2) : "0",
          internalCode,
          receiptId,
          linkedItemId:    item.catalogItemId || undefined,
          warehouseId:     await getReceiptWarehouseId(),
        } as any);
        item.inventoryId = Number((result as any)[0]?.insertId || 0);
        if (!item.inventoryId) throw new Error(`تعذر إنشاء Inventory للصنف "${item.itemName}"`);

        await writer.update(warehouseReceiptItems).set({
          inventoryId: item.inventoryId,
        } as any).where(eq(warehouseReceiptItems.id, item.id));
      }

      let lotId: number | undefined;
      if (lotsEnabled) {
        const lot = await createReceiptInventoryLot({
          tx: writer,
          catalogItemId: item.catalogItemId ?? null,
          inventoryId: Number(item.inventoryId),
          receiptId,
          receiptItemId: Number(item.id),
          purchaseOrderId: (receipt as any).purchaseOrderId ?? null,
          purchaseOrderItemId: item.purchaseOrderItemId ?? null,
          catalogSupplierId: (receipt as any).catalogSupplierId ?? null,
          supplierCandidateId: (receipt as any).supplierCandidateId ?? null,
          issueQuantity: qty,
          purchaseUnit: item.purchaseUnit || "قطعة",
          issueUnit: item.purchaseUnit || "قطعة",
          conversionFactor: 1,
          purchaseUnitCost: unitCost,
          issueUnitCost: unitCost,
          supplierItemName: item.itemName,
          expiryDate: item.expiryDate ?? null,
          createdById: performedById,
        });
        lotId = lot.lotId;
        lotLabels.push({
          lotId: lot.lotId,
          lotCode: lot.lotCode,
          trackingToken: lot.trackingToken,
          itemName: item.itemName,
          quantity: qty,
          unit: item.purchaseUnit || "قطعة",
          sourceType: "receipt",
          receiptNumber: (receipt as any).receiptNumber || String(receiptId),
        });
      }

      await writer.insert(inventoryTransactions).values({
        inventoryId:         item.inventoryId,
        lotId,
        type:                "in",
        quantity:            normalizeInventoryQuantity(qty),
        unitCost:            unitCost.toFixed(4),
        totalCost:           calculateMovementTotal(qty, unitCost).toFixed(2),
        reason:              `اعتماد فاتورة ${(receipt as any).receiptNumber || receiptId}`,
        purchaseOrderItemId: item.purchaseOrderItemId,
        performedById,
        transactionType:     "purchase",
        receiptId,
      } as any);

      if (item.purchaseOrderItemId) {
        await writer.update(purchaseOrderItems)
          .set({ status: "delivered_to_warehouse", receivedAt: new Date(), receivedById: performedById } as any)
          .where(eq(purchaseOrderItems.id, item.purchaseOrderItemId));
      }
    }

    await writer.update(warehouseReceipts)
      .set({ status: "confirmed", isDraft: false } as any)
      .where(eq(warehouseReceipts.id, receiptId));
  };

  if (lotsEnabled) {
    // 2B-8: receipt + aggregate inventory + lot balance + movement must commit together.
    await db.transaction(async (tx) => applyApprovedReceipt(tx));
    return { inventoryLotsEnabled: true, lotLabels };
  }

  // Preserve the pre-2B-8 execution path until the feature is explicitly activated.
  await applyApprovedReceipt(db);
  return { inventoryLotsEnabled: false, lotLabels: [] as typeof lotLabels };
}

export async function updateWarehouseReceiptItem(id: number, data: {
  itemName?:         string;
  receivedQuantity?: number;
  unitCost?:         string;
  taxRate?:          number;
  manuallyEdited?:   boolean;
}) {
  const db = await getDb();
  if (!db) return;
  await db.update(warehouseReceiptItems)
    .set(data as any)
    .where(eq(warehouseReceiptItems.id, id));
}

export async function getInventoryByPOItemId(purchaseOrderItemId: number) {
  const db = await getDb();
  if (!db) return null;
  // ابحث عن آخر حركة دخول مرتبطة بهذا الصنف
  const txRows = await db.select({
    inventoryId: inventoryTransactions.inventoryId,
  })
    .from(inventoryTransactions)
    .where(
      and(
        eq(inventoryTransactions.purchaseOrderItemId, purchaseOrderItemId),
        eq(inventoryTransactions.type, "in" as any),
      )
    )
    .orderBy(desc(inventoryTransactions.id))
    .limit(1);

  if (!txRows[0]) return null;
  const rows = await db.select().from(inventory)
    .where(eq(inventory.id, txRows[0].inventoryId))
    .limit(1);
  return rows[0] || null;
}

// ═══════════════════════════════════════════════════════════════════════
// وحدة الجرد وتسوية المخزون
// النمط: الجرد يسجّل فقط (لا يمس المخزون) — التسوية هي الوحيدة اللي تُطبّق فعلياً
// ═══════════════════════════════════════════════════════════════════════

// ── توليد الأرقام التسلسلية ──
export async function generateCountNumber(): Promise<string> {
  const db = await getDb();
  const year = new Date().getFullYear();
  if (!db) return `CNT-${year}-0001`;
  const [result] = await db.insert(inventoryCountNumberCounter).values({ year });
  const seq = (result as any).insertId as number;
  return `CNT-${year}-${String(seq).padStart(4, "0")}`;
}

async function generateSettlementNumberWith(writer: any): Promise<string> {
  const year = new Date().getFullYear();
  const [result] = await writer.insert(inventorySettlementNumberCounter).values({ year });
  const seq = (result as any).insertId as number;
  return `ADJ-${year}-${String(seq).padStart(4, "0")}`;
}

export async function generateSettlementNumber(): Promise<string> {
  const db = await getDb();
  const year = new Date().getFullYear();
  if (!db) return `ADJ-${year}-0001`;
  return generateSettlementNumberWith(db);
}

// ── حساب تاريخ/يوم/وقت الرياض من ساعة الخادم نفسها (مو من جهاز/هاتف المستخدم) ──
function getRiyadhNow() {
  const now = new Date(); // وقت الخادم الفعلي (server wall clock) — المصدر الوحيد الموثوق
  const riyadhDate = now.toLocaleDateString("en-CA", { timeZone: "Asia/Riyadh" }); // YYYY-MM-DD
  const riyadhDayName = now.toLocaleDateString("ar-SA-u-ca-gregory", { timeZone: "Asia/Riyadh", weekday: "long" });
  const riyadhStartTime = now.toLocaleTimeString("en-GB", { timeZone: "Asia/Riyadh", hour12: false }); // HH:MM:SS
  return { riyadhDate, riyadhDayName, riyadhStartTime };
}

// ── 1) بدء عملية جرد جديدة: يلقط صورة لحظية من كميات النظام الحالية ──
// ملاحظة: لو scope="partial" و itemIds فاضية و allowEmpty=true → يبدأ الجرد فاضي
// تماماً (وضع "يدوي/باركود")، وتُضاف الأصناف لاحقاً تباعاً عبر scanCountItem.
// التاريخ/اليوم/الوقت تُحسب دائماً من ساعة الخادم بتوقيت الرياض — غير قابلة للتعديل
// ولا تُستقبل من المستخدم إطلاقاً (حماية من تلاعب توقيت الجهاز/الهاتف).
// 2B-9 — رمز ثابت لاختراق نطاق التصنيف. الواجهة تترجمه حسب لغة المستخدم
// بدل الاعتماد على نص Backend عربي ثابت.
export const COUNT_LOT_OUTSIDE_CATEGORY_SCOPE = "COUNT_LOT_OUTSIDE_CATEGORY_SCOPE";
export const COUNT_LOT_NOT_IN_OPENING_SNAPSHOT = "COUNT_LOT_NOT_IN_OPENING_SNAPSHOT";
export const COUNT_ITEM_NOT_IN_OPENING_SNAPSHOT = "COUNT_ITEM_NOT_IN_OPENING_SNAPSHOT";

async function getCatalogSubtreeNodeIds(db: any, rootNodeId: number): Promise<number[]> {
  const nodes = await db.select({
    id: catalogNodes.id,
    parentId: catalogNodes.parentId,
  }).from(catalogNodes);

  const rootExists = (nodes as any[]).some((node: any) => Number(node.id) === Number(rootNodeId));
  if (!rootExists) throw new Error("التصنيف المحدد للجرد غير موجود في الكتالوج");

  const childrenByParent = new Map<number, number[]>();
  for (const node of nodes as any[]) {
    if (node.parentId == null) continue;
    const parentId = Number(node.parentId);
    const list = childrenByParent.get(parentId) || [];
    list.push(Number(node.id));
    childrenByParent.set(parentId, list);
  }

  const result: number[] = [];
  const queue = [Number(rootNodeId)];
  const visited = new Set<number>();
  while (queue.length) {
    const nodeId = queue.shift()!;
    if (visited.has(nodeId)) continue;
    visited.add(nodeId);
    result.push(nodeId);
    for (const childId of childrenByParent.get(nodeId) || []) queue.push(childId);
  }
  return result;
}

async function assertInventoryMatchesOperationCatalogScope(
  db: any,
  catalogNodeId: number | null | undefined,
  linkedCatalogItemId: number | null | undefined,
) {
  if (!catalogNodeId) return;
  if (!linkedCatalogItemId) throw new Error(COUNT_LOT_OUTSIDE_CATEGORY_SCOPE);

  const catalogRows = await db.select({ nodeId: catalogItems.nodeId })
    .from(catalogItems)
    .where(eq(catalogItems.id, Number(linkedCatalogItemId)))
    .limit(1);
  const itemNodeId = Number(catalogRows[0]?.nodeId || 0);
  if (!itemNodeId) throw new Error(COUNT_LOT_OUTSIDE_CATEGORY_SCOPE);

  const subtreeNodeIds = await getCatalogSubtreeNodeIds(db, Number(catalogNodeId));
  if (!subtreeNodeIds.includes(itemNodeId)) {
    throw new Error(COUNT_LOT_OUTSIDE_CATEGORY_SCOPE);
  }
}

export async function createCountOperation(params: {
  operationTitle?: string;
  scope: "full" | "partial";
  countType?: "periodic" | "opening_balance";
  catalogNodeId?: number;   // 2B-9: NULL = كل المخزن/جرد يدوي غير مصنف؛ قيمة = Catalog subtree
  warehouseId?: number;      // NULL = يغطي كل المخازن (periodic only)
  itemIds?: number[];        // مطلوبة لو scope = "partial" (إلا لو allowEmpty)
  allowEmpty?: boolean;
  createdById: number;
}) {
  const db = await getDb();
  if (!db) throw new Error("تعذر الاتصال بقاعدة البيانات");

  const countType = params.countType || "periodic";
  if (countType === "opening_balance") {
    if (!isInventoryLotsEnabled()) {
      throw new Error("الرصيد الافتتاحي بنظام الدفعات غير مفعّل بعد. أكمل تفعيل 2B-8 أولاً");
    }
    if (!params.warehouseId) {
      throw new Error("الرصيد الافتتاحي يتطلب تحديد المستودع");
    }
    if (params.catalogNodeId) {
      throw new Error("نطاق التصنيف مخصص للجرد الدوري وليس للرصد الافتتاحي");
    }
  }
  if (params.catalogNodeId && !params.warehouseId) {
    throw new Error("الجرد حسب التصنيف يتطلب تحديد المستودع");
  }
  if (params.catalogNodeId && !isInventoryLotsEnabled()) {
    throw new Error("الجرد حسب التصنيف في 2B-9 يتطلب تفعيل نظام Lot/QR");
  }

  let catalogSubtreeNodeIds: number[] | null = null;
  let scopedCatalogItemIds: number[] | null = null;
  if (params.catalogNodeId) {
    catalogSubtreeNodeIds = await getCatalogSubtreeNodeIds(db, Number(params.catalogNodeId));
    const catalogRows = await db.select({ id: catalogItems.id })
      .from(catalogItems)
      .where(inArray(catalogItems.nodeId, catalogSubtreeNodeIds));
    scopedCatalogItemIds = (catalogRows as any[]).map((row: any) => Number(row.id));
  }

  const operationNumber = await generateCountNumber();
  const { riyadhDate, riyadhDayName, riyadhStartTime } = getRiyadhNow();
  const defaultTitle = countType === "opening_balance"
    ? `رصيد افتتاحي ${riyadhDate}`
    : `جرد يوم ${riyadhDayName} بتاريخ ${riyadhDate}`;
  const title = params.operationTitle?.trim() || defaultTitle;
  const effectiveScope: "full" | "partial" = countType === "opening_balance"
    ? "partial"
    : params.catalogNodeId ? "partial" : params.scope;

  const [opResult] = await db.insert(inventoryCountOperations).values({
    operationNumber,
    operationTitle: title,
    operationDate: new Date(riyadhDate),
    riyadhDayName,
    riyadhStartTime,
    scope: effectiveScope,
    countType,
    catalogNodeId: params.catalogNodeId ?? null,
    warehouseId: params.warehouseId,
    status: "in_progress",
    createdById: params.createdById,
  } as any);
  const operationId = (opResult as any).insertId as number;

  // Opening balance starts empty by design. Items are selected from Master Catalog
  // and do not affect Inventory until the settlement is applied.
  if (countType === "opening_balance") {
    return { operationId, operationNumber, operationTitle: title, itemCount: 0, countType };
  }

  // 2B-8: بعد تفعيل Lots يصبح الجرد الدوري على مستوى Lot/QR داخل مستودع محدد.
  // في الوضع التلقائي نلتقط Snapshot لكل Lot Balance موجب؛ في الوضع اليدوي
  // الجزئي نبدأ فارغاً وتضاف الدفعات فقط بمسح trackingToken.
  if (isInventoryLotsEnabled()) {
    if (!params.warehouseId) {
      throw new Error("الجرد الدوري بنظام الدفعات يتطلب تحديد المستودع");
    }

    // الجرد الجزئي اليدوي بلا تصنيف سيبقى فارغاً في واجهة العد، لكننا نلتقط
    // Snapshot افتتاحياً لكل Lots الموجودة في المستودع قبل السماح بأي مسح لاحق.
    // أما catalogNodeId فيقصر الـSnapshot على Catalog subtree المختار.

    const lotConditions: any[] = [
      eq(inventory.warehouseId, params.warehouseId),
    ];
    if (params.catalogNodeId) {
      if (!scopedCatalogItemIds?.length) {
        await db.delete(inventoryCountOperations).where(eq(inventoryCountOperations.id, operationId));
        throw new Error("لا توجد أصناف مرتبطة بالتصنيف المحدد للجرد");
      }
      lotConditions.push(inArray(inventory.linkedItemId, scopedCatalogItemIds));
    }

    // Main Phase 3 / Step 1: snapshot every existing Lot balance row in the warehouse,
    // including zero balances. A known QR with system balance zero may later reveal a
    // positive physical discrepancy, so it must retain its opening-state identity.
    // averageCostSnapshot is the Inventory moving weighted average at operation opening.
    const openingSnapshots = await db.select({
      inventoryId: inventory.id,
      lotId: inventoryLots.id,
      systemQuantity: inventoryLotBalances.quantity,
      averageCostSnapshot: inventory.averageCost,
      expiryDate: inventoryLots.expiryDate,
    })
      .from(inventoryLotBalances)
      .innerJoin(inventoryLots, eq(inventoryLots.id, inventoryLotBalances.lotId))
      .innerJoin(inventory, eq(inventory.id, inventoryLotBalances.inventoryId))
      .where(and(...lotConditions));

    if (openingSnapshots.length > 0) {
      await db.insert(inventoryCountSnapshots).values(openingSnapshots.map((row: any) => ({
        operationId,
        inventoryId: Number(row.inventoryId),
        lotId: Number(row.lotId),
        systemQuantity: Number(row.systemQuantity || 0).toFixed(3),
        averageCostSnapshot: Number(row.averageCostSnapshot || 0).toFixed(4),
        expiryDate: row.expiryDate ?? null,
      })) as any);
    }

    // Manual partial QR count keeps the UI/workflow empty, but the immutable opening
    // snapshot already exists. Scanning later selects from this snapshot instead of
    // reading a newer quantity/cost from Inventory/Lot balances.
    if (effectiveScope === "partial" && !params.catalogNodeId) {
      return { operationId, operationNumber, operationTitle: title, itemCount: 0, countType };
    }

    const countTargets = openingSnapshots.filter((row: any) => Number(row.systemQuantity || 0) > 0);
    if (countTargets.length === 0) {
      // لا نترك رأس عملية فارغاً إذا لم يوجد أي Lot موجب يطابق نطاق الجرد الشامل/المصنّف.
      await db.delete(inventoryCountSnapshots).where(eq(inventoryCountSnapshots.operationId, operationId));
      await db.delete(inventoryCountOperations).where(eq(inventoryCountOperations.id, operationId));
      throw new Error("لا توجد دفعات ذات رصيد مطابق لنطاق الجرد المحدد");
    }

    for (const row of countTargets) {
      await db.insert(inventoryCountItems).values({
        operationId,
        inventoryId: row.inventoryId,
        lotId: row.lotId,
        systemQuantity: Number(row.systemQuantity || 0).toFixed(3),
        expiryDate: row.expiryDate ?? null,
      } as any);
    }

    return { operationId, operationNumber, operationTitle: title, itemCount: countTargets.length, countType };
  }

  // Legacy pre-Lot path: capture the opening state before an empty/manual barcode
  // workflow can add an Inventory row later. This preserves the same Phase 3 rule even
  // when the Lot feature flag is off.
  const conditions = [];
  if (params.warehouseId) conditions.push(eq(inventory.warehouseId, params.warehouseId));
  if (effectiveScope === "partial" && params.itemIds?.length) {
    conditions.push(inArray(inventory.id, params.itemIds));
  }

  const targetItems = await db
    .select()
    .from(inventory)
    .where(conditions.length ? and(...conditions) : undefined);

  if (targetItems.length > 0) {
    await db.insert(inventoryCountSnapshots).values(targetItems.map((item: any) => ({
      operationId,
      inventoryId: Number(item.id),
      lotId: null,
      systemQuantity: Number(item.quantity || 0).toFixed(3),
      averageCostSnapshot: Number(item.averageCost || 0).toFixed(4),
      expiryDate: item.expiryDate ?? null,
    })) as any);
  }

  // وضع يدوي/باركود: واجهة الجرد تبدأ فارغة، لكن Snapshot الافتتاحي محفوظ.
  if (effectiveScope === "partial" && params.allowEmpty && !params.itemIds?.length) {
    return { operationId, operationNumber, operationTitle: title, itemCount: 0, countType };
  }

  if (targetItems.length === 0) {
    await db.delete(inventoryCountOperations).where(eq(inventoryCountOperations.id, operationId));
    throw new Error("لا توجد أصناف مطابقة لنطاق الجرد المحدد");
  }

  // إنشاء سطر جرد فارغ لكل صنف من نفس Snapshot الافتتاحي.
  for (const item of targetItems) {
    await db.insert(inventoryCountItems).values({
      operationId,
      inventoryId: item.id,
      systemQuantity: Number(item.quantity || 0).toFixed(3),
      lotNumber: null,
      expiryDate: item.expiryDate ?? null,
    });
  }

  return { operationId, operationNumber, operationTitle: title, itemCount: targetItems.length, countType };
}

// ── 1ب) إضافة/زيادة صنف بجرد جارٍ عبر مسح باركود أو اختيار مباشر ──
// لو الصنف مو مضاف بعد للجرد: يُنشأ سطر جديد بكمية معدودة = incrementBy.
// لو مضاف مسبقاً: تُزاد كميته المعدودة بمقدار incrementBy (مسح متكرر = عدّ تراكمي).
// ── تحقق مشترك: يمنع إضافة صنف ينتمي لمخزن مختلف عن مخزن عملية الجرد ──
// (فجوة IDOR-مثل اكتُشفت 2026-08-05 بوضع الجرد اليدوي/الباركود — كان بالإمكان
// نظرياً مسح/إضافة صنف من مخزن آخر أثناء عملية جرد مخصَّصة لمخزن معيّن).
// عمليات الجرد القديمة (قبل هذا التعديل) بلا warehouseId لا تخضع لهذا التحقق.
async function assertItemMatchesOperationWarehouse(
  db: any,
  opWarehouseId: number | null | undefined,
  itemWarehouseId: number | null | undefined,
) {
  if (!opWarehouseId) return; // عملية جرد قديمة تغطي كل المخازن — لا تحقق
  if (itemWarehouseId === opWarehouseId) return;
  // المخزن الرئيسي يشمل أيضاً الأصناف القديمة بلا مخزن محدد — نفس قاعدة
  // التوافق المستخدمة بشاشتَي المستودع والجرد بالواجهة.
  if (!itemWarehouseId) {
    const whRows = await db.select().from(warehouses).where(eq(warehouses.id, opWarehouseId)).limit(1);
    if (whRows[0]?.type === "main") return;
  }
  throw new Error("هذا الصنف لا ينتمي لمخزن عملية الجرد الحالية");
}

async function getCountOpeningSnapshotForInventory(db: any, operationId: number, inventoryId: number) {
  const rows = await db.select().from(inventoryCountSnapshots).where(and(
    eq(inventoryCountSnapshots.operationId, operationId),
    eq(inventoryCountSnapshots.inventoryId, inventoryId),
    isNull(inventoryCountSnapshots.lotId),
  )).limit(2);
  if (rows.length > 1) {
    throw new Error("يوجد أكثر من Snapshot افتتاحي لنفس الصنف في عملية الجرد");
  }
  return rows[0] || null;
}

async function getCountOpeningSnapshotForLot(db: any, operationId: number, lotId: number) {
  const rows = await db.select().from(inventoryCountSnapshots).where(and(
    eq(inventoryCountSnapshots.operationId, operationId),
    eq(inventoryCountSnapshots.lotId, lotId),
  )).limit(2);
  if (rows.length > 1) {
    throw new Error("يوجد أكثر من Snapshot افتتاحي لنفس Lot في عملية الجرد");
  }
  return rows[0] || null;
}

type CountWriter = NonNullable<Awaited<ReturnType<typeof getDb>>>;

// All count writers serialize with finalization, review corrections and posting.
// A request that started before finalization cannot change the reviewed count later.
async function withLockedMutableCount<T>(operationId: number, work: (writer: CountWriter) => Promise<T>): Promise<T> {
  const connection = await getDb();
  if (!connection) throw new Error("تعذر الاتصال بقاعدة البيانات");
  return connection.transaction(async tx => {
    await tx.execute(sql`SELECT id FROM inventory_count_operations WHERE id = ${operationId} FOR UPDATE`);
    const operations = await tx.select().from(inventoryCountOperations)
      .where(eq(inventoryCountOperations.id, operationId)).limit(1).for("update");
    if (!operations[0]) throw new Error("عملية الجرد غير موجودة");
    if (operations[0].status !== "in_progress") throw new Error("هذا الجرد محفوظ نهائياً ولا يمكن التعديل عليه");
    return work(tx as unknown as CountWriter);
  });
}

export async function scanCountItem(params: {
  operationId: number;
  inventoryId: number;
  incrementBy?: number;   // افتراضي 1 (كل مسحة = وحدة واحدة)
  countedById: number;
}) {
  return withLockedMutableCount(params.operationId, async db => {

  // حماية: لا إضافة/تعديل على جرد مقفل نهائياً
  const opRows = await db.select().from(inventoryCountOperations)
    .where(eq(inventoryCountOperations.id, params.operationId)).limit(1);
  const op = opRows[0];
  if (op?.status === "completed") {
    throw new Error("هذا الجرد محفوظ نهائياً ولا يمكن التعديل عليه");
  }
  if ((op as any)?.countType === "opening_balance") {
    throw new Error("الرصيد الافتتاحي يُضاف من Master Catalog وليس من مسح Inventory القديم");
  }
  if (isInventoryLotsEnabled()) {
    throw new Error("الجرد الدوري بعد تفعيل الدفعات يتطلب مسح QR للـLot وليس باركود Inventory");
  }

  const increment = params.incrementBy ?? 1;

  const existingRows = await db.select().from(inventoryCountItems)
    .where(and(
      eq(inventoryCountItems.operationId, params.operationId),
      eq(inventoryCountItems.inventoryId, params.inventoryId),
    )).limit(1);

  if (existingRows[0]) {
    const row = existingRows[0];
    const newCounted = (parseFloat(row.countedQuantity || "0")) + increment;
    const diff = newCounted - parseFloat(row.systemQuantity);
    await db.update(inventoryCountItems).set({
      countedQuantity: String(newCounted),
      diffQuantity: String(diff),
      countedById: params.countedById,
      countedAt: new Date(),
    }).where(eq(inventoryCountItems.id, row.id));
    return { countItemId: row.id, countedQuantity: newCounted, diffQuantity: diff, isNew: false };
  }

  const invRows = await db.select().from(inventory).where(eq(inventory.id, params.inventoryId)).limit(1);
  const inv = invRows[0];
  if (!inv) throw new Error("الصنف غير موجود بالمخزون");
  await assertItemMatchesOperationWarehouse(db, op?.warehouseId, inv.warehouseId);

  const openingSnapshot = await getCountOpeningSnapshotForInventory(db, params.operationId, params.inventoryId);
  if (!openingSnapshot) throw new Error(COUNT_ITEM_NOT_IN_OPENING_SNAPSHOT);
  const openingSystemQuantity = Number(openingSnapshot.systemQuantity || 0);
  const diff = increment - openingSystemQuantity;
  const [result] = await db.insert(inventoryCountItems).values({
    operationId: params.operationId,
    inventoryId: params.inventoryId,
    systemQuantity: openingSystemQuantity.toFixed(3),
    countedQuantity: String(increment),
    diffQuantity: String(diff),
    expiryDate: openingSnapshot.expiryDate ?? null,
    countedById: params.countedById,
    countedAt: new Date(),
  });
  const countItemId = (result as any).insertId as number;
  return { countItemId, countedQuantity: increment, diffQuantity: diff, isNew: true };
  });
}


// ── بحث موحد داخل الجرد الدوري / الرصيد الافتتاحي ──
// periodic + Lots: البحث يكون على Snapshot افتتاح العملية فقط حتى لا يُدخل Lot وصل بعد بدء الجرد.
// opening_balance: البحث يكون على Master Catalog، مع الاستفادة من باركود المصنع التاريخي
// الموجود في Inventory أو Catalog Item Candidate المرتبط، بدون إضافة عمود جديد للكتالوج.
export async function searchInventoryCountCandidates(params: {
  operationId: number;
  search?: string;
  catalogNodeId?: number;
  limit?: number;
}) {
  const db = await getDb();
  if (!db) throw new Error("تعذر الاتصال بقاعدة البيانات");

  const opRows = await db.select().from(inventoryCountOperations)
    .where(eq(inventoryCountOperations.id, params.operationId)).limit(1);
  const op: any = opRows[0];
  if (!op) throw new Error("عملية الجرد غير موجودة");
  if (op.status !== "in_progress") return [];

  const search = String(params.search || "").trim();
  const term = search ? `%${search}%` : null;
  const limit = Math.min(50, Math.max(1, Number(params.limit || 20)));

  const operationScopeNodeId = Number(op.catalogNodeId || 0) || null;
  const requestedNodeId = Number(params.catalogNodeId || 0) || null;
  let effectiveNodeIds: number[] | null = null;

  if (operationScopeNodeId) {
    effectiveNodeIds = await getCatalogSubtreeNodeIds(db, operationScopeNodeId);
  }
  if (requestedNodeId) {
    const requestedNodeIds = await getCatalogSubtreeNodeIds(db, requestedNodeId);
    effectiveNodeIds = effectiveNodeIds
      ? effectiveNodeIds.filter(id => requestedNodeIds.includes(id))
      : requestedNodeIds;
  }
  if ((operationScopeNodeId || requestedNodeId) && effectiveNodeIds?.length === 0) return [];

  if (op.countType === "opening_balance") {
    const barcodeCatalogItemIds = new Set<number>();

    if (term) {
      const inventoryBarcodeRows = await db.select({
        catalogItemId: inventory.linkedItemId,
      }).from(inventory).where(and(
        isNotNull(inventory.linkedItemId),
        like(inventory.manufacturerBarcode, term),
      ));
      for (const row of inventoryBarcodeRows as any[]) {
        const id = Number(row.catalogItemId || 0);
        if (id > 0) barcodeCatalogItemIds.add(id);
      }

      const candidateBarcodeRows = await db.select({
        catalogItemId: catalogItemCandidates.resolvedCatalogItemId,
      }).from(catalogItemCandidates).where(and(
        isNotNull(catalogItemCandidates.resolvedCatalogItemId),
        like(catalogItemCandidates.manufacturerBarcode, term),
      ));
      for (const row of candidateBarcodeRows as any[]) {
        const id = Number(row.catalogItemId || 0);
        if (id > 0) barcodeCatalogItemIds.add(id);
      }
    }

    const conditions: any[] = [eq(catalogItems.isActive, 1)];
    if (effectiveNodeIds) conditions.push(inArray(catalogItems.nodeId, effectiveNodeIds));
    if (term) {
      const textConditions: any[] = [
        like(catalogItems.code, term),
        like(catalogItems.nameAr, term),
        like(catalogItems.nameEn, term),
      sql`EXISTS (SELECT 1 FROM inventory aliases WHERE aliases.linkedItemId=${catalogItems.id} AND aliases.itemName LIKE ${term})`,
      isInventoryLotsEnabled() ? sql`EXISTS (SELECT 1 FROM inventory_lots aliases WHERE aliases.catalogItemId=${catalogItems.id} AND aliases.supplierItemName LIKE ${term})` : undefined,
      sql`EXISTS (SELECT 1 FROM catalog_item_candidates aliases WHERE aliases.resolvedCatalogItemId=${catalogItems.id} AND aliases.itemName LIKE ${term})`,
      ];
      if (barcodeCatalogItemIds.size > 0) {
        textConditions.push(inArray(catalogItems.id, Array.from(barcodeCatalogItemIds)));
      }
      conditions.push(or(...textConditions));
    }

    const rows = await db.select({
      id: catalogItems.id,
      code: catalogItems.code,
      nameAr: catalogItems.nameAr,
      nameEn: catalogItems.nameEn,
      unit: catalogItems.unit,
      manufacturer: catalogItems.manufacturer,
      nodeId: catalogItems.nodeId,
    }).from(catalogItems)
      .where(and(...conditions))
      .orderBy(asc(catalogItems.code), asc(catalogItems.nameAr))
      .limit(limit);

    const catalogItemIds = (rows as any[]).map(row => Number(row.id));
    const barcodeByCatalogItemId = new Map<number, Set<string>>();
    const rememberBarcode = (catalogItemId: number, barcode: unknown) => {
      const normalized = String(barcode || "").trim();
      if (!catalogItemId || !normalized) return;
      const values = barcodeByCatalogItemId.get(catalogItemId) || new Set<string>();
      values.add(normalized);
      barcodeByCatalogItemId.set(catalogItemId, values);
    };

    if (catalogItemIds.length > 0) {
      const inventoryBarcodes = await db.select({
        catalogItemId: inventory.linkedItemId,
        barcode: inventory.manufacturerBarcode,
      }).from(inventory).where(and(
        inArray(inventory.linkedItemId, catalogItemIds),
        isNotNull(inventory.manufacturerBarcode),
      ));
      for (const row of inventoryBarcodes as any[]) {
        rememberBarcode(Number(row.catalogItemId || 0), row.barcode);
      }

      const candidateBarcodes = await db.select({
        catalogItemId: catalogItemCandidates.resolvedCatalogItemId,
        barcode: catalogItemCandidates.manufacturerBarcode,
      }).from(catalogItemCandidates).where(and(
        inArray(catalogItemCandidates.resolvedCatalogItemId, catalogItemIds),
        isNotNull(catalogItemCandidates.manufacturerBarcode),
      ));
      for (const row of candidateBarcodes as any[]) {
        rememberBarcode(Number(row.catalogItemId || 0), row.barcode);
      }
    }

    return (rows as any[]).map(row => ({
      kind: "catalog" as const,
      id: Number(row.id),
      catalogItemId: Number(row.id),
      code: row.code ?? null,
      nameAr: row.nameAr,
      nameEn: row.nameEn,
      unit: row.unit ?? null,
      manufacturer: row.manufacturer ?? null,
      nodeId: Number(row.nodeId),
      manufacturerBarcodes: Array.from(barcodeByCatalogItemId.get(Number(row.id)) || []),
    }));
  }

  if (!isInventoryLotsEnabled()) return [];
  if (op.countType !== "periodic") return [];

  const conditions: any[] = [
    eq(inventoryCountSnapshots.operationId, params.operationId),
    isNotNull(inventoryCountSnapshots.lotId),
  ];
  if (effectiveNodeIds) conditions.push(inArray(catalogItems.nodeId, effectiveNodeIds));
  if (term) {
    conditions.push(or(
      like(catalogItems.code, term),
      like(catalogItems.nameAr, term),
      like(catalogItems.nameEn, term),
      sql`EXISTS (SELECT 1 FROM inventory aliases WHERE aliases.linkedItemId=${catalogItems.id} AND aliases.itemName LIKE ${term})`,
      isInventoryLotsEnabled() ? sql`EXISTS (SELECT 1 FROM inventory_lots aliases WHERE aliases.catalogItemId=${catalogItems.id} AND aliases.supplierItemName LIKE ${term})` : undefined,
      sql`EXISTS (SELECT 1 FROM catalog_item_candidates aliases WHERE aliases.resolvedCatalogItemId=${catalogItems.id} AND aliases.itemName LIKE ${term})`,
      like(inventory.itemName, term),
      like(inventory.itemNameAr, term),
      like(inventory.itemNameEn, term),
      like(inventory.manufacturerBarcode, term),
      like(inventoryLots.lotCode, term),
      like(inventoryLots.trackingToken, term),
    ));
  }

  const rows = await db.select({
    inventoryId: inventory.id,
    lotId: inventoryLots.id,
    lotCode: inventoryLots.lotCode,
    trackingToken: inventoryLots.trackingToken,
    catalogItemId: inventory.linkedItemId,
    catalogItemCode: catalogItems.code,
    catalogItemNameAr: catalogItems.nameAr,
    catalogItemNameEn: catalogItems.nameEn,
    catalogNodeId: catalogItems.nodeId,
    itemName: inventory.itemName,
    itemNameAr: inventory.itemNameAr,
    itemNameEn: inventory.itemNameEn,
    manufacturerBarcode: inventory.manufacturerBarcode,
    unit: inventory.issueUnit,
    fallbackUnit: inventory.unit,
    systemQuantity: inventoryCountSnapshots.systemQuantity,
  })
    .from(inventoryCountSnapshots)
    .innerJoin(inventory, eq(inventory.id, inventoryCountSnapshots.inventoryId))
    .innerJoin(inventoryLots, eq(inventoryLots.id, inventoryCountSnapshots.lotId))
    .leftJoin(catalogItems, eq(catalogItems.id, inventory.linkedItemId))
    .where(and(...conditions))
    .orderBy(asc(catalogItems.code), asc(inventoryLots.lotCode))
    .limit(limit);

  return (rows as any[]).map(row => ({
    kind: "lot" as const,
    id: Number(row.lotId),
    lotId: Number(row.lotId),
    inventoryId: Number(row.inventoryId),
    lotCode: row.lotCode,
    trackingToken: row.trackingToken,
    catalogItemId: row.catalogItemId == null ? null : Number(row.catalogItemId),
    code: row.catalogItemCode ?? null,
    nameAr: row.catalogItemNameAr || row.itemNameAr || row.itemName,
    nameEn: row.catalogItemNameEn || row.itemNameEn || null,
    nodeId: row.catalogNodeId == null ? null : Number(row.catalogNodeId),
    manufacturerBarcode: row.manufacturerBarcode ?? null,
    unit: row.unit || row.fallbackUnit || null,
    systemQuantity: Number(row.systemQuantity || 0),
  }));
}

// ── 1ب-Lot) مسح QR أو إدخال رقم Lot أثناء الجرد الدوري ──
// المسح لا يغيّر أي رصيد. يحدد Lot + Inventory داخل مستودع عملية الجرد،
// ويعيد/ينشئ سطر الجرد الخاص بهذه الدفعة ثم تُسجّل الكمية الفعلية عبر recordCountItem.
export async function scanCountLot(params: {
  operationId: number;
  trackingToken: string;
}) {
  return withLockedMutableCount(params.operationId, async db => {
  if (!isInventoryLotsEnabled()) throw new Error("نظام الدفعات غير مفعّل");

  const opRows = await db.select().from(inventoryCountOperations)
    .where(eq(inventoryCountOperations.id, params.operationId)).limit(1);
  const op = opRows[0];
  if (!op) throw new Error("عملية الجرد غير موجودة");
  if (op.status === "completed") throw new Error("هذا الجرد محفوظ نهائياً ولا يمكن التعديل عليه");
  if ((op as any).countType !== "periodic") throw new Error("مسح Lot متاح للجرد الدوري فقط");
  if (!op.warehouseId) throw new Error("الجرد الدوري بالدفعات يتطلب مستودعاً محدداً");

  const lot = await resolveInventoryLotForCount({
    tx: db,
    trackingToken: params.trackingToken,
    warehouseId: Number(op.warehouseId),
  });

  const invRows = await db.select().from(inventory).where(eq(inventory.id, lot.inventoryId)).limit(1);
  const inv = invRows[0];
  if (!inv) throw new Error("سجل المخزون المرتبط بالدفعة غير موجود");

  // 2B-9 — التحقق Server-side إلزامي. فلتر الواجهة وحده غير كافٍ لأن QR قد
  // يُمسح مباشرة. الصنف يجب أن ينتمي للتصنيف المختار أو أحد أبنائه.
  await assertInventoryMatchesOperationCatalogScope(
    db,
    Number((op as any).catalogNodeId || 0) || null,
    Number((inv as any).linkedItemId || 0) || null,
  );

  // Phase 3 opening-time rule: a QR scanned later must resolve to the immutable
  // snapshot captured when this operation was opened. A Lot that entered the
  // warehouse after opening is outside this count's historical state.
  const openingSnapshot = await getCountOpeningSnapshotForLot(db, params.operationId, lot.lotId);
  if (!openingSnapshot) throw new Error(COUNT_LOT_NOT_IN_OPENING_SNAPSHOT);
  if (Number(openingSnapshot.inventoryId) !== lot.inventoryId) {
    throw new Error("Snapshot افتتاح الجرد للدفعة لا يطابق سجل المخزون الحالي");
  }

  const existingRows = await db.select().from(inventoryCountItems).where(and(
    eq(inventoryCountItems.operationId, params.operationId),
    eq(inventoryCountItems.lotId, lot.lotId),
  )).limit(2);
  if (existingRows.length > 1) {
    throw new Error("يوجد أكثر من سطر جرد لنفس Lot في العملية الحالية؛ راجع بيانات الجرد");
  }

  let row = existingRows[0] as any;
  if (!row) {
    const [result] = await db.insert(inventoryCountItems).values({
      operationId: params.operationId,
      inventoryId: lot.inventoryId,
      lotId: lot.lotId,
      systemQuantity: Number(openingSnapshot.systemQuantity || 0).toFixed(3),
      expiryDate: openingSnapshot.expiryDate ?? null,
    } as any);
    const id = Number((result as any).insertId);
    const rows = await db.select().from(inventoryCountItems)
      .where(eq(inventoryCountItems.id, id)).limit(1);
    row = rows[0];
  }

  if (Number(row.inventoryId) !== lot.inventoryId) {
    throw new Error("سطر الجرد المحفوظ للدفعة لا يطابق سجل المخزون الحالي");
  }

  return {
    countItemId: Number(row.id),
    inventoryId: lot.inventoryId,
    lotId: lot.lotId,
    lotCode: lot.lotCode,
    trackingToken: lot.trackingToken,
    itemName: inv.itemName,
    unit: (inv as any).issueUnit || inv.unit,
    systemQuantity: Number(row.systemQuantity || 0),
    averageCostSnapshot: Number(openingSnapshot.averageCostSnapshot || 0),
    countedQuantity: row.countedQuantity !== null ? Number(row.countedQuantity) : null,
    notes: row.notes ?? null,
  };
  });
}

// ── 1ج) إضافة صنف لعملية جرد جارية بدون تحديد كمية (يظهر بالجدول بانتظار العدّ) ──
// يُستخدم من لوحة "إضافة صنف للجرد" (بحث بالاسم/الرقم/الباركود): يضمن وجود سطر
// للصنف بالجرد ثم تُدخل الكمية الفعلية لاحقاً عبر recordItem — لا يُخمَّن أي رقم.
// لو الصنف مضاف مسبقاً لنفس الجرد: يُعاد سطره الحالي كما هو (بدون تكرار ولا تصفير لما عُدَّ سابقاً).
export async function addItemToCount(params: {
  operationId: number;
  inventoryId: number;
}) {
  return withLockedMutableCount(params.operationId, async db => {

  const opRows = await db.select().from(inventoryCountOperations)
    .where(eq(inventoryCountOperations.id, params.operationId)).limit(1);
  if (!opRows[0]) throw new Error("عملية الجرد غير موجودة");
  if (opRows[0].status === "completed") {
    throw new Error("هذا الجرد محفوظ نهائياً ولا يمكن التعديل عليه");
  }
  if ((opRows[0] as any).countType === "opening_balance") {
    throw new Error("الرصيد الافتتاحي يُضاف من Master Catalog وليس من قائمة Inventory القديمة");
  }
  if (isInventoryLotsEnabled()) {
    throw new Error("الجرد الدوري بعد تفعيل الدفعات يتطلب مسح QR للـLot");
  }

  const existingRows = await db.select().from(inventoryCountItems)
    .where(and(
      eq(inventoryCountItems.operationId, params.operationId),
      eq(inventoryCountItems.inventoryId, params.inventoryId),
    )).limit(1);

  const invRows = await db.select().from(inventory).where(eq(inventory.id, params.inventoryId)).limit(1);
  const inv = invRows[0];
  if (!inv) throw new Error("الصنف غير موجود بالمخزون");

  if (!existingRows[0]) {
    await assertItemMatchesOperationWarehouse(db, opRows[0].warehouseId, inv.warehouseId);
  }

  if (existingRows[0]) {
    const row = existingRows[0];
    return {
      countItemId: row.id,
      itemName: inv.itemName,
      unit: inv.unit,
      systemQuantity: parseFloat(row.systemQuantity),
      countedQuantity: row.countedQuantity !== null ? parseFloat(row.countedQuantity) : null,
      lotNumber: row.lotNumber,
      expiryDate: row.expiryDate,
      notes: row.notes,
      isNew: false,
    };
  }

  const openingSnapshot = await getCountOpeningSnapshotForInventory(db, params.operationId, params.inventoryId);
  if (!openingSnapshot) throw new Error(COUNT_ITEM_NOT_IN_OPENING_SNAPSHOT);

  const [result] = await db.insert(inventoryCountItems).values({
    operationId: params.operationId,
    inventoryId: params.inventoryId,
    systemQuantity: Number(openingSnapshot.systemQuantity || 0).toFixed(3),
    expiryDate: openingSnapshot.expiryDate ?? null,
  });
  const countItemId = (result as any).insertId as number;

  return {
    countItemId,
    itemName: inv.itemName,
    unit: inv.unit,
    systemQuantity: Number(openingSnapshot.systemQuantity || 0),
    countedQuantity: null,
    lotNumber: null,
    expiryDate: inv.expiryDate ?? null,
    notes: null,
    isNew: true,
  };
  });
}

// ── 1د) إضافة صنف جديد كليّاً (غير موجود بالمخزون أصلاً) أثناء عملية جرد جارية ──
// يُستخدم فقط من شاشة الجرد اليدوي حين يُكتشف صنف فعلي غير مسجّل بالنظام إطلاقاً.
// الفرق عن addItemToCount: هنا الصنف غير موجود بجدول inventory إطلاقاً، فيُنشأ من الصفر
// بنفس آلية أي صنف عادي (كود داخلي INV-YYYY-NNNN + باركود مصنع تسلسلي)، ويدخل المخزون
// فوراً بالكمية المُدخلة (بعكس الفروقات العادية اللي تنتظر مرحلة التسوية).
export async function addNewItemDuringCount(params: {
  operationId: number;
  catalogItemId?: number;
  itemName?: string;
  unit?: string;
  quantity: number;
  cost?: number;           // التكلفة اختيارية دائماً
  createdById: number;
}) {
  return withLockedMutableCount(params.operationId, async db => {

  const opRows = await db.select().from(inventoryCountOperations)
    .where(eq(inventoryCountOperations.id, params.operationId)).limit(1);
  const op = opRows[0];
  if (!op) throw new Error("عملية الجرد غير موجودة");
  if (op.status === "completed") {
    throw new Error("هذا الجرد محفوظ نهائياً ولا يمكن الإضافة عليه");
  }

  const cost = Number(params.cost ?? 0);
  const quantity = normalizeInventoryQuantity(params.quantity);
  if (!(quantity > 0)) throw new Error("الكمية يجب أن تكون أكبر من صفر");

  // 2B-8: الرصيد الافتتاحي لا ينشئ Master Item من اسم حر. يجب أن يبدأ من Catalog Item
  // معتمد، ويظل Inventory = 0 حتى تطبيق التسوية التي تنشئ Opening Balance Lot + QR.
  if ((op as any).countType === "opening_balance") {
    if (!isInventoryLotsEnabled()) {
      throw new Error("الرصيد الافتتاحي بنظام الدفعات غير مفعّل بعد");
    }
    if (!op.warehouseId) throw new Error("عملية الرصيد الافتتاحي يجب أن تكون مرتبطة بمستودع");
    if (!params.catalogItemId) throw new Error("اختيار صنف من الكتالوج إلزامي للرصد الافتتاحي");

    const catalogRows = await db.select().from(catalogItems)
      .where(and(eq(catalogItems.id, params.catalogItemId), eq(catalogItems.isActive, 1)))
      .limit(1);
    const catalog = catalogRows[0];
    if (!catalog) throw new Error("صنف الكتالوج غير موجود أو غير نشط");

    const matchingInventory = await db.select().from(inventory).where(and(
      eq(inventory.linkedItemId, catalog.id),
      eq(inventory.warehouseId, op.warehouseId),
    ));
    if (matchingInventory.length > 1) {
      throw new Error(`يوجد أكثر من سجل Inventory لنفس صنف الكتالوج داخل المستودع. أصلح التكرار قبل الرصيد الافتتاحي`);
    }

    let inventoryId: number;
    let internalCode: string;
    if (matchingInventory[0]) {
      const existing = matchingInventory[0];
      if (normalizeInventoryQuantity(Number(existing.quantity || 0)) !== 0) {
        throw new Error("هذا الصنف لديه رصيد قائم في المستودع. الرصيد الافتتاحي مخصص للتأسيس على رصيد صفري");
      }
      inventoryId = existing.id;
      internalCode = (existing as any).internalCode || "";
      await db.update(inventory).set({
        linkedItemId: catalog.id,
        itemName: catalog.nameAr,
        itemNameAr: catalog.nameAr,
        itemNameEn: catalog.nameEn,
        unit: catalog.unit || (existing as any).unit || "قطعة",
        purchaseUnit: catalog.unit || (existing as any).purchaseUnit || (existing as any).unit || "قطعة",
        issueUnit: catalog.unit || (existing as any).issueUnit || (existing as any).unit || "قطعة",
        averageCost: cost.toFixed(4),
        totalCostValue: "0.00",
        updatedAt: new Date(),
      } as any).where(eq(inventory.id, inventoryId));
    } else {
      internalCode = await getNextInventoryCode(db);
      inventoryId = Number(await createInventoryItemV2({
        itemName:            catalog.nameAr,
        itemNameAr:          catalog.nameAr,
        itemNameEn:          catalog.nameEn,
        quantity:            0,
        unit:                catalog.unit || "قطعة",
        purchaseUnit:        catalog.unit || "قطعة",
        issueUnit:           catalog.unit || "قطعة",
        conversionFactor:    "1.0000",
        internalCode,
        averageCost:         cost.toFixed(4),
        totalCostValue:      "0.00",
        linkedItemId:        catalog.id,
        warehouseId:         op.warehouseId,
      }, db));
      if (!inventoryId) throw new Error("تعذر إنشاء سجل المخزون للرصد الافتتاحي");
    }

    const duplicateRows = await db.select().from(inventoryCountItems).where(and(
      eq(inventoryCountItems.operationId, params.operationId),
      eq(inventoryCountItems.inventoryId, inventoryId),
    )).limit(1);
    if (duplicateRows[0]) {
      throw new Error("هذا الصنف مضاف بالفعل إلى عملية الرصيد الافتتاحي الحالية");
    }

    const [countItemResult] = await db.insert(inventoryCountItems).values({
      operationId: params.operationId,
      inventoryId,
      systemQuantity: "0.000",
      countedQuantity: quantity.toFixed(3),
      diffQuantity: quantity.toFixed(3),
      countedById: params.createdById,
      countedAt: new Date(),
      notes: "رصيد افتتاحي من Master Catalog — بانتظار تطبيق التسوية وإنشاء QR للدفعة",
    } as any);
    const countItemId = Number((countItemResult as any).insertId);

    return {
      countItemId,
      inventoryId,
      catalogItemId: catalog.id,
      itemName: catalog.nameAr,
      itemNameEn: catalog.nameEn,
      unit: catalog.unit || "قطعة",
      quantity,
      internalCode,
      openingBalancePending: true,
    };
  }

  // بعد تفعيل Lots لا يسمح الجرد الدوري بإنشاء Aggregate Inventory من اسم حر،
  // لأن أي كمية جديدة يجب أن يكون لها مصدر/دفعة معروفة. هذا المسار التاريخي يبقى فقط والـGate مغلق.
  if (isInventoryLotsEnabled()) {
    throw new Error("لا يمكن إنشاء صنف حر أثناء الجرد الدوري بعد تفعيل الدفعات؛ استخدم QR لدفعة معروفة أو مسار الرصيد الافتتاحي المعتمد");
  }

  const itemName = params.itemName?.trim();
  const unit = params.unit?.trim();
  if (!itemName) throw new Error("اسم الصنف مطلوب");
  if (!unit) throw new Error("الوحدة مطلوبة");

  const internalCode = await getNextInventoryCode();
  const manufacturerBarcode = await getNextItemBarcode();
  const totalCostValue = calculateInventoryValue(quantity, cost);

  const inventoryId = await createInventoryItemV2({
    itemName,
    quantity,
    unit,
    internalCode,
    manufacturerBarcode,
    averageCost:          String(cost),
    totalCostValue:       String(totalCostValue),
    warehouseId:          op.warehouseId ?? undefined,
  }, db);

  await db.insert(inventoryTransactions).values({
    inventoryId,
    type:            "in",
    quantity,
    unitCost:        cost.toFixed(4),
    totalCost:       calculateMovementTotal(quantity, cost).toFixed(2),
    reason:          `صنف جديد أُضيف أثناء عملية الجرد ${op.operationNumber}`,
    performedById:   params.createdById,
    transactionType: "adjustment",
    documentUrl:     op.operationNumber,
  });

  const [countItemResult] = await db.insert(inventoryCountItems).values({
    operationId:    params.operationId,
    inventoryId,
    systemQuantity: String(quantity),
    countedQuantity: String(quantity),
    diffQuantity:    "0",
    countedById:     params.createdById,
    countedAt:       new Date(),
    notes:           "صنف جديد أُضيف أثناء الجرد",
  });
  const countItemId = (countItemResult as any).insertId as number;

  return {
    countItemId,
    inventoryId,
    itemName,
    unit,
    quantity,
    internalCode,
    manufacturerBarcode,
  };
  });
}

// ── 2) تسجيل الكمية المعدودة فعلياً لصنف واحد ضمن عملية جرد ──
export async function recordCountItem(params: {
  countItemId: number;
  countedQuantity: number;
  entryMode?: "qr" | "manual";
  trackingToken?: string;
  lotNumber?: string;
  expiryDate?: string;
  notes?: string;
  countedById: number;
}) {
  const db = await getDb();
  if (!db) throw new Error("تعذر الاتصال بقاعدة البيانات");

  const rows = await db.select().from(inventoryCountItems)
    .where(eq(inventoryCountItems.id, params.countItemId)).limit(1);
  const row = rows[0];
  if (!row) throw new Error("سطر الجرد غير موجود");

  return withLockedMutableCount(row.operationId, async db => {
  const freshRows = await db.select().from(inventoryCountItems)
    .where(eq(inventoryCountItems.id, params.countItemId)).limit(1).for("update");
  const row = freshRows[0];
  if (!row) throw new Error("سطر الجرد غير موجود");

  // حماية: لا تعديل إطلاقاً على جرد تم حفظه نهائياً (مقفل)
  const opRows = await db.select().from(inventoryCountOperations)
    .where(eq(inventoryCountOperations.id, row.operationId)).limit(1);
  if (opRows[0]?.status === "completed") {
    throw new Error("هذا الجرد محفوظ نهائياً ولا يمكن التعديل عليه");
  }

  const isPeriodicLotCount = isInventoryLotsEnabled() && (opRows[0] as any)?.countType === "periodic";
  let lotCode: string | undefined;
  if (isPeriodicLotCount) {
    if (!row.lotId) throw new Error("سطر الجرد لا يحتوي Lot؛ أعد تحديد الدفعة");
    if (!opRows[0]?.warehouseId) throw new Error("عملية الجرد لا تحتوي مستودعاً محدداً");

    const entryMode = params.entryMode === "manual" ? "manual" : "qr";
    if (entryMode === "manual") {
      // 2B-9: الإدخال اليدوي لا يعني Aggregate-only. المستخدم يعد سطر Lot محدداً
      // موجوداً أصلاً داخل عملية الجرد. نعيد التحقق Server-side من المخزن، هوية
      // الـLot، ونطاق Catalog قبل قبول الكمية، حتى لا يكون زر الواجهة طريقاً
      // لتجاوز QR أو نطاق التصنيف.
      const invRows = await db.select().from(inventory)
        .where(eq(inventory.id, Number(row.inventoryId))).limit(1);
      const inv = invRows[0];
      if (!inv) throw new Error("سجل المخزون المرتبط بسطر الجرد غير موجود");

      await assertItemMatchesOperationWarehouse(db, opRows[0].warehouseId, inv.warehouseId);
      await assertInventoryMatchesOperationCatalogScope(
        db,
        Number((opRows[0] as any).catalogNodeId || 0) || null,
        Number((inv as any).linkedItemId || 0) || null,
      );

      const lotRows = await db.select({
        id: inventoryLots.id,
        lotCode: inventoryLots.lotCode,
        catalogItemId: inventoryLots.catalogItemId,
      }).from(inventoryLots)
        .where(eq(inventoryLots.id, Number(row.lotId))).limit(1);
      const storedLot = lotRows[0];
      if (!storedLot) throw new Error("الدفعة المرتبطة بسطر الجرد غير موجودة");
      if (storedLot.catalogItemId && (inv as any).linkedItemId && Number(storedLot.catalogItemId) !== Number((inv as any).linkedItemId)) {
        throw new Error("هوية Catalog للدفعة لا تطابق سجل المخزون في سطر الجرد");
      }

      const balanceRows = await db.select({ quantity: inventoryLotBalances.quantity })
        .from(inventoryLotBalances)
        .where(and(
          eq(inventoryLotBalances.lotId, Number(row.lotId)),
          eq(inventoryLotBalances.inventoryId, Number(row.inventoryId)),
        )).limit(1);
      if (!balanceRows[0]) {
        throw new Error("الدفعة لم تعد مرتبطة بسجل المخزون الخاص بعملية الجرد");
      }
      lotCode = storedLot.lotCode;
    } else {
      if (!params.trackingToken?.trim()) throw new Error("يجب مسح QR أو إدخال رقم اللوت قبل حفظ الكمية المعدودة");

      const lot = await resolveInventoryLotForCount({
        tx: db,
        trackingToken: params.trackingToken,
        warehouseId: Number(opRows[0].warehouseId),
      });
      if (lot.lotId !== Number(row.lotId) || lot.inventoryId !== Number(row.inventoryId)) {
        throw new Error("رقم اللوت أو QR لا يطابق الدفعة المحددة في سطر الجرد");
      }
      lotCode = lot.lotCode;
    }
  }

  const countedQuantity = normalizeInventoryQuantity(params.countedQuantity);
  if (countedQuantity < 0) throw new Error("الكمية المعدودة لا يمكن أن تكون سالبة");
  const diff = normalizeInventoryQuantity(countedQuantity - parseFloat(row.systemQuantity));

  await db.update(inventoryCountItems).set({
    countedQuantity: countedQuantity.toFixed(3),
    diffQuantity: diff.toFixed(3),
    ...(isPeriodicLotCount ? {} : {
      lotNumber: params.lotNumber ?? row.lotNumber,
      expiryDate: params.expiryDate ? new Date(params.expiryDate) : row.expiryDate,
    }),
    notes: params.notes,
    countedById: params.countedById,
    countedAt: new Date(),
  } as any).where(eq(inventoryCountItems.id, params.countItemId));

  return { diffQuantity: diff, lotCode };
  });
}

// ── 3) إنهاء عملية الجرد (تسجيل فقط — لا يمس المخزون) ──
export async function completeCountOperation(operationId: number) {
  return withLockedMutableCount(operationId, async db => {

  const opRows = await db.select().from(inventoryCountOperations)
    .where(eq(inventoryCountOperations.id, operationId)).limit(1);
  if (opRows[0]?.status === "completed") {
    throw new Error("هذا الجرد محفوظ نهائياً مسبقاً");
  }

  const items = await db.select().from(inventoryCountItems)
    .where(eq(inventoryCountItems.operationId, operationId));

  const counted = items.filter(i => i.countedQuantity !== null);
  const discrepancies = counted.filter(i => parseFloat(i.diffQuantity || "0") !== 0);

  if (isInventoryLotsEnabled() && (opRows[0] as any)?.countType === "periodic") {
    const uncountedLots = items.filter(i => i.lotId && i.countedQuantity === null);
    if (uncountedLots.length > 0) {
      throw new Error(`لا يمكن إنهاء الجرد: توجد ${uncountedLots.length} دفعة لم يتم عدّها بعد. امسح QR لكل دفعة وسجل الكمية`);
    }
    if (counted.length === 0) {
      throw new Error("لا يمكن إنهاء جرد دفعات بدون عدّ أي Lot");
    }
  }

  await db.update(inventoryCountOperations).set({
    status: "completed",
    totalItemsCounted: counted.length,
    totalDiscrepancies: discrepancies.length,
    completedAt: new Date(),
  }).where(eq(inventoryCountOperations.id, operationId));

  return { totalItemsCounted: counted.length, totalDiscrepancies: discrepancies.length };
  });
}

// ── 3ب) حذف مسودة جرد بالكامل (مسموح فقط طالما لم تُحفظ نهائياً) ──
export async function deleteCountOperation(operationId: number) {
  return withLockedMutableCount(operationId, async db => {

  const opRows = await db.select().from(inventoryCountOperations)
    .where(eq(inventoryCountOperations.id, operationId)).limit(1);
  if (!opRows[0]) throw new Error("عملية الجرد غير موجودة");
  if (opRows[0].status === "completed") {
    throw new Error("لا يمكن حذف جرد محفوظ نهائياً — المسودات فقط قابلة للحذف");
  }

  await db.delete(inventoryCountItems).where(eq(inventoryCountItems.operationId, operationId));
  await db.delete(inventoryCountSnapshots).where(eq(inventoryCountSnapshots.operationId, operationId));
  await db.delete(inventoryCountOperations).where(eq(inventoryCountOperations.id, operationId));

  return { success: true };
  });
}

// ── 4) الأصناف الغير مجرودة بعد ضمن عملية جارية ──
export async function getUncountedItems(operationId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select({
    countItemId: inventoryCountItems.id,
    inventoryId: inventoryCountItems.inventoryId,
    lotId: inventoryCountItems.lotId,
    lotCode: inventoryLots.lotCode,
    catalogItemId: inventory.linkedItemId,
    itemName: inventory.itemName,
    unit: inventory.unit,
    systemQuantity: inventoryCountItems.systemQuantity,
  })
    .from(inventoryCountItems)
    .innerJoin(inventory, eq(inventory.id, inventoryCountItems.inventoryId))
    .leftJoin(inventoryLots, eq(inventoryLots.id, inventoryCountItems.lotId))
    .where(and(
      eq(inventoryCountItems.operationId, operationId),
      isNull(inventoryCountItems.countedQuantity),
    ));
}

// ── Main Phase 3 / Step 2: ربط نتائج الجرد بتكلفة Snapshot الافتتاحية ──
function countSnapshotKey(inventoryId: number, lotId: number | null | undefined) {
  return `${Number(inventoryId)}:${lotId == null ? "legacy" : Number(lotId)}`;
}

async function attachCountOpeningValuation(db: any, operationId: number, rows: any[]) {
  const snapshots = await db.select().from(inventoryCountSnapshots)
    .where(eq(inventoryCountSnapshots.operationId, operationId));

  const byKey = new Map<string, any>();
  for (const snapshot of snapshots as any[]) {
    const key = countSnapshotKey(Number(snapshot.inventoryId), snapshot.lotId == null ? null : Number(snapshot.lotId));
    if (byKey.has(key)) {
      throw new Error("يوجد أكثر من Snapshot افتتاحي لنفس بند الجرد");
    }
    byKey.set(key, snapshot);
  }

  return (rows as any[]).map((row: any) => {
    const key = countSnapshotKey(Number(row.inventoryId), row.lotId == null ? null : Number(row.lotId));
    const snapshot = byKey.get(key);
    const snapshotCost = snapshot ? Number(snapshot.averageCostSnapshot || 0) : null;
    const systemQuantity = Number(row.systemQuantity || 0);
    const countedQuantity = row.countedQuantity == null ? null : Number(row.countedQuantity);
    const diffQuantity = row.diffQuantity == null ? null : Number(row.diffQuantity);

    return {
      ...row,
      // Do not fall back to current Inventory.averageCost for historical valuation.
      // Old operations without an opening snapshot remain explicitly unvalued.
      averageCostSnapshot: snapshot ? Number(snapshot.averageCostSnapshot || 0).toFixed(4) : null,
      systemValueSnapshot: snapshotCost == null ? null : (systemQuantity * snapshotCost).toFixed(2),
      countedValueAtSnapshotCost: countedQuantity == null || snapshotCost == null
        ? null
        : (countedQuantity * snapshotCost).toFixed(2),
      diffValue: diffQuantity == null || snapshotCost == null
        ? null
        : (diffQuantity * snapshotCost).toFixed(2),
      hasOpeningCostSnapshot: Boolean(snapshot),
    };
  });
}

// ── 5) تفاصيل عملية جرد كاملة (لعرض الشاشة) ──
export async function getCountOperationDetails(operationId: number) {
  const connection = await getDb();
  if (!connection) return null;
  return connection.transaction(async tx => {
  const db = tx as unknown as CountWriter;
  // A regenerated document must pair the current count with its correction history.
  await db.execute(sql`SELECT id FROM inventory_count_operations WHERE id = ${operationId} FOR UPDATE`);

  const op = await db.select().from(inventoryCountOperations)
    .where(eq(inventoryCountOperations.id, operationId)).limit(1);
  if (!op[0]) return null;

  const creator = await getUserById(op[0].createdById);
  let catalogScopeNode: any = null;
  if ((op[0] as any).catalogNodeId) {
    const nodeRows = await db.select({
      id: catalogNodes.id,
      nameAr: catalogNodes.nameAr,
      nameEn: catalogNodes.nameEn,
      code: catalogNodes.code,
    }).from(catalogNodes).where(eq(catalogNodes.id, Number((op[0] as any).catalogNodeId))).limit(1);
    catalogScopeNode = nodeRows[0] || null;
  }

  const rawItems = await db.select({
    countItemId: inventoryCountItems.id,
    inventoryId: inventoryCountItems.inventoryId,
    lotId: inventoryCountItems.lotId,
    lotCode: inventoryLots.lotCode,
    sourceType: inventoryLots.sourceType,
    itemName: inventory.itemName,
    unit: inventory.unit,
    // Current cost remains exposed only for operational compatibility; Step 2 valuation
    // uses averageCostSnapshot exclusively and never this changing value.
    averageCost: inventory.averageCost,
    systemQuantity: inventoryCountItems.systemQuantity,
    countedQuantity: inventoryCountItems.countedQuantity,
    diffQuantity: inventoryCountItems.diffQuantity,
    lotNumber: inventoryCountItems.lotNumber,
    batchNumber: inventoryLots.batchNumber,
    expiryDate: inventoryCountItems.expiryDate,
    lotExpiryDate: inventoryLots.expiryDate,
    notes: inventoryCountItems.notes,
    countedAt: inventoryCountItems.countedAt,
  })
    .from(inventoryCountItems)
    .innerJoin(inventory, eq(inventory.id, inventoryCountItems.inventoryId))
    .leftJoin(inventoryLots, eq(inventoryLots.id, inventoryCountItems.lotId))
    .where(eq(inventoryCountItems.operationId, operationId));

  const items = await attachCountOpeningValuation(db, operationId, rawItems);
  const requestedBy = alias(users, "countCorrectionRequestedBy");
  const correctedBy = alias(users, "countCorrectionCorrectedBy");
  const corrections = await db.select({
    id: inventoryCountCorrections.id,
    requestedByName: requestedBy.name,
    correctedByName: correctedBy.name,
    requestedReason: inventoryCountCorrections.requestedReason,
    correctionReason: inventoryCountCorrections.correctionReason,
    correctedAt: inventoryCountCorrections.correctedAt,
    beforeSnapshot: inventoryCountCorrections.beforeSnapshot,
    afterSnapshot: inventoryCountCorrections.afterSnapshot,
  }).from(inventoryCountCorrections)
    .leftJoin(requestedBy, eq(requestedBy.id, inventoryCountCorrections.requestedById))
    .leftJoin(correctedBy, eq(correctedBy.id, inventoryCountCorrections.correctedById))
    .where(and(eq(inventoryCountCorrections.operationId, operationId), eq(inventoryCountCorrections.status, "corrected")))
    .orderBy(asc(inventoryCountCorrections.id));
  const countCorrections = corrections.map(correction => {
    const before: any = typeof correction.beforeSnapshot === "string" ? JSON.parse(correction.beforeSnapshot) : correction.beforeSnapshot;
    const after: any = typeof correction.afterSnapshot === "string" ? JSON.parse(correction.afterSnapshot) : correction.afterSnapshot;
    if (!Array.isArray(before?.items) || !Array.isArray(after?.items)) throw new Error("سجل تصحيح الجرد غير مكتمل؛ يلزم مراجعته قبل طباعة المستند");
    const changes = after.items.flatMap((item: any) => {
      const previous = before.items.find((entry: any) => entry.countItemId === item.countItemId);
      return previous && Number(previous.countedQuantity) !== Number(item.countedQuantity)
        ? [{ countItemId: item.countItemId, itemName: item.itemName, previousQuantity: previous.countedQuantity, correctedQuantity: item.countedQuantity }]
        : [];
    });
    const { beforeSnapshot: _before, afterSnapshot: _after, ...summary } = correction;
    return { ...summary, changes };
  });

  return {
    operation: {
      ...op[0],
      creatorName: (creator as any)?.name || "—",
      catalogNodeNameAr: catalogScopeNode?.nameAr ?? null,
      catalogNodeNameEn: catalogScopeNode?.nameEn ?? null,
      catalogNodeCode: catalogScopeNode?.code ?? null,
      correctionVersion: countCorrections.length,
    },
    items,
    countCorrections,
  };
  });
}

// ── 6) قائمة عمليات الجرد (للأرشيف) ──
export async function listCountOperations() {
  const db = await getDb();
  if (!db) return [];
  const operations = await db.select().from(inventoryCountOperations)
    .orderBy(desc(inventoryCountOperations.createdAt));

  const nodeIds = Array.from(new Set(
    (operations as any[])
      .map((op: any) => Number(op.catalogNodeId || 0))
      .filter((id: number) => id > 0),
  ));
  if (nodeIds.length === 0) return operations;

  const nodes = await db.select({
    id: catalogNodes.id,
    nameAr: catalogNodes.nameAr,
    nameEn: catalogNodes.nameEn,
    code: catalogNodes.code,
  }).from(catalogNodes).where(inArray(catalogNodes.id, nodeIds));
  const nodeById = new Map<number, any>((nodes as any[]).map((node: any) => [Number(node.id), node]));

  return (operations as any[]).map((op: any) => {
    const node = nodeById.get(Number(op.catalogNodeId || 0));
    return {
      ...op,
      catalogNodeNameAr: node?.nameAr ?? null,
      catalogNodeNameEn: node?.nameEn ?? null,
      catalogNodeCode: node?.code ?? null,
    };
  });
}

// ── 7) فروقات جرد مكتمل (تُستخدم لتعبئة شاشة التسوية تلقائياً) ──
export async function getCountDiscrepancies(operationId: number) {
  const details = await getCountOperationDetails(operationId);
  if (!details) return [];
  return (details.items as any[]).filter((item: any) =>
    item.countedQuantity !== null
    && item.countedQuantity !== undefined
    && Number(item.diffQuantity || 0) !== 0
  );
}

// ── 8) تطبيق تسوية المخزون فعلياً (التطبيق الوحيد المسموح على الكميات) ──
export async function applySettlement(params: {
  sourceType: "from_count" | "manual";
  sourceCountOperationId?: number;
  reason: string;               // إلزامي دائماً
  reference?: string;           // optional external/document/business reference
  appliedById: number;
  items: Array<{
    inventoryId: number;
    lotId?: number;
    afterQuantity: number;      // legacy: Inventory النهائي / Lot-mode: رصيد الـLot النهائي
    lotNumber?: string;
    expiryDate?: string;
  }>;
}, options?: { writer?: any; reviewDraftId?: number }) {
  // Review approval reuses the existing posting engine in its own transaction.
  // This option is server-internal; no RPC accepts a writer or a review bypass.
  const db = options?.writer ?? await getDb();
  if (!db) throw new Error("تعذر الاتصال بقاعدة البيانات");

  if (!params.reason || params.reason.trim().length < 10) {
    throw new Error("سبب التسوية إلزامي (10 أحرف على الأقل)");
  }
  if (params.items.length === 0) {
    throw new Error("لا توجد أصناف للتسوية");
  }
  const itemKeys = params.items.map(item => `${item.inventoryId}:${item.lotId ?? 0}`);
  if (new Set(itemKeys).size !== itemKeys.length) {
    throw new Error("لا يمكن تكرار الصنف أو الدفعة داخل التسوية");
  }

  let sourceCountOperation: any = null;
  if (params.sourceType === "from_count" && params.sourceCountOperationId) {
    const rows = await db.select().from(inventoryCountOperations)
      .where(eq(inventoryCountOperations.id, params.sourceCountOperationId)).limit(1);
    sourceCountOperation = rows[0] || null;
    if (!sourceCountOperation) throw new Error("عملية الجرد المصدر غير موجودة");
  }

  const lotsEnabled = isInventoryLotsEnabled();
  const isOpeningBalance = sourceCountOperation?.countType === "opening_balance";
  const isPeriodicLotSettlement = lotsEnabled
    && params.sourceType === "from_count"
    && sourceCountOperation?.countType === "periodic";

  if (isOpeningBalance && !lotsEnabled) {
    throw new Error("لا يمكن تطبيق الرصيد الافتتاحي قبل تفعيل نظام الدفعات 2B-8");
  }
  if (lotsEnabled && !isOpeningBalance && !isPeriodicLotSettlement) {
    // التسوية اليدوية Aggregate-only تبقى موقوفة بعد تفعيل Lots حتى يتم اعتماد
    // Workflow مستقل لها. التسوية من الجرد الدوري أصبحت Lot-aware في 2B-8.
    throw new Error("التسوية اليدوية القديمة موقوفة عند تفعيل Lots؛ استخدم الجرد الدوري بالـQR أو Workflow معتمد للدفعات");
  }
  if ((isOpeningBalance || isPeriodicLotSettlement) && sourceCountOperation?.status !== "completed") {
    throw new Error("يجب إنهاء عملية الجرد وحفظها نهائياً قبل تطبيق التسوية");
  }

  const lotLabels: Array<{
    lotId: number;
    lotCode: string;
    trackingToken: string;
    itemName: string;
    quantity: number;
    unit: string;
    sourceType: "opening_balance";
    settlementNumber: string;
  }> = [];

  const readCountSnapshotCost = async (writer: any, inventoryId: number, lotId?: number | null) => {
    if (!params.sourceCountOperationId) {
      throw new Error("التسوية من الجرد تتطلب عملية جرد مصدر");
    }

    const lotCondition = lotId == null
      ? isNull(inventoryCountSnapshots.lotId)
      : eq(inventoryCountSnapshots.lotId, lotId);
    const snapshotRows = await writer.select({
      systemQuantity: inventoryCountSnapshots.systemQuantity,
      averageCostSnapshot: inventoryCountSnapshots.averageCostSnapshot,
    }).from(inventoryCountSnapshots).where(and(
      eq(inventoryCountSnapshots.operationId, params.sourceCountOperationId),
      eq(inventoryCountSnapshots.inventoryId, inventoryId),
      lotCondition,
    )).limit(2);

    if (snapshotRows.length !== 1) {
      throw new Error(`تعذر تحديد Opening Snapshot موثوق للصنف Inventory #${inventoryId}${lotId == null ? "" : ` / Lot #${lotId}`}`);
    }

    const unitCostUsed = roundTo(Number(snapshotRows[0].averageCostSnapshot || 0), 4);
    if (unitCostUsed < 0) {
      throw new Error(`Opening Snapshot للصنف Inventory #${inventoryId} يحتوي تكلفة غير صالحة`);
    }

    return {
      systemQuantity: normalizeInventoryQuantity(Number(snapshotRows[0].systemQuantity || 0)),
      unitCostUsed,
    };
  };

  const applyWith = async (writer: any) => {
    // Main Phase 4 / 4.2.3: every supported posting path executes inside one DB
    // transaction. Count-based posting also locks and re-validates the source
    // operation in that same transaction before duplicate/discrepancy checks.
    if (params.sourceType === "from_count" && params.sourceCountOperationId) {
      await writer.execute(sql`SELECT id FROM inventory_count_operations WHERE id = ${params.sourceCountOperationId} FOR UPDATE`);
      const lockedCountRows = await writer.select({
        id: inventoryCountOperations.id,
        status: inventoryCountOperations.status,
        countType: inventoryCountOperations.countType,
      }).from(inventoryCountOperations)
        .where(eq(inventoryCountOperations.id, params.sourceCountOperationId))
        .limit(1).for("update");
      const lockedCount = lockedCountRows[0];
      if (!lockedCount) throw new Error("عملية الجرد المصدر غير موجودة");
      if (lockedCount.status !== "completed") {
        throw new Error("يجب إنهاء عملية الجرد وحفظها نهائياً قبل تطبيق التسوية");
      }
      if (sourceCountOperation && lockedCount.countType !== sourceCountOperation.countType) {
        throw new Error("تغير نوع عملية الجرد أثناء تطبيق التسوية؛ أعد المحاولة بعد تحديث البيانات");
      }

      // A prepared review cannot be bypassed through the legacy direct RPC.
      // The count lock serializes review, correction and both posting paths.
      const reviews = await writer.select().from(inventorySettlementDrafts)
        .where(eq(inventorySettlementDrafts.sourceCountOperationId, params.sourceCountOperationId))
        .limit(1).for("update");
      const review = reviews[0];
      if (review && review.status !== "applied" && Number(review.id) !== options?.reviewDraftId) {
        throw new Error("لهذا الجرد مسودة تسوية للمراجعة؛ يجب اعتمادها من دورة المراجعة");
      }
      if (options?.reviewDraftId && (!review || Number(review.id) !== options.reviewDraftId || review.status !== "pending_review")) {
        throw new Error("مسودة التسوية ليست بانتظار الاعتماد أو لا تخص هذا الجرد");
      }
      const pendingCorrections = await writer.select({ id: inventoryCountCorrections.id })
        .from(inventoryCountCorrections).where(and(
          eq(inventoryCountCorrections.operationId, params.sourceCountOperationId),
          eq(inventoryCountCorrections.status, "pending"),
        )).limit(1);
      if (pendingCorrections.length > 0) {
        throw new Error("يوجد طلب تصحيح للجرد لم يكتمل؛ لا يمكن تطبيق التسوية");
      }

      const alreadyApplied = await writer.select({ id: inventorySettlements.id })
        .from(inventorySettlements)
        .where(and(
          eq(inventorySettlements.sourceCountOperationId, params.sourceCountOperationId),
          eq(inventorySettlements.status, "applied"),
        ))
        .limit(1).for("update");
      if (alreadyApplied[0]) {
        throw new Error("تم تطبيق تسوية لهذا الجرد مسبقاً؛ لا يمكن تطبيق فرق الجرد مرتين");
      }
    }

    // A periodic Lot count is settled as one frozen discrepancy set. The client
    // may not omit a discrepancy or inject an unrelated Lot.
    if (isPeriodicLotSettlement && params.sourceCountOperationId) {
      const sourceRows = await writer.select({
        inventoryId: inventoryCountItems.inventoryId,
        lotId: inventoryCountItems.lotId,
        countedQuantity: inventoryCountItems.countedQuantity,
        diffQuantity: inventoryCountItems.diffQuantity,
      }).from(inventoryCountItems)
        .where(eq(inventoryCountItems.operationId, params.sourceCountOperationId));

      const sourceDiscrepancies = (sourceRows as any[]).filter((row: any) =>
        row.countedQuantity != null && normalizeInventoryQuantity(Number(row.diffQuantity || 0)) !== 0
      );
      const expectedKeys = new Set(sourceDiscrepancies.map((row: any) => `${Number(row.inventoryId)}:${Number(row.lotId || 0)}`));
      const submittedKeys = new Set(params.items.map((row: any) => `${Number(row.inventoryId)}:${Number(row.lotId || 0)}`));
      if (
        expectedKeys.size !== submittedKeys.size ||
        [...expectedKeys].some((key) => !submittedKeys.has(key))
      ) {
        throw new Error("يجب تطبيق التسوية على جميع فروقات الجرد المحفوظة معاً دون حذف أو إضافة دفعات");
      }
    }

    // Lock every affected aggregate in deterministic order before reading its
    // current value. Concurrent receipts must not be lost by a stale value read.
    for (const inventoryId of Array.from(new Set(params.items.map(item => item.inventoryId))).sort((a, b) => a - b)) {
      await writer.execute(sql`SELECT id FROM inventory WHERE id = ${inventoryId} FOR UPDATE`);
    }

    // Allocate/persist the settlement counter row through the same transaction
    // writer as the posting. MySQL AUTO_INCREMENT may still consume an id on
    // rollback; this change does not alter the DB numbering schema or guarantee gapless numbers.
    const settlementNumber = await generateSettlementNumberWith(writer);

    const [settlementResult] = await writer.insert(inventorySettlements).values({
      settlementNumber,
      sourceType: params.sourceType,
      sourceCountOperationId: params.sourceCountOperationId,
      status: "applied",
      reason: params.reason,
      reference: params.reference?.trim() || null,
      appliedById: params.appliedById,
    });
    const settlementId = Number((settlementResult as any).insertId);
    if (!settlementId) throw new Error("تعذر إنشاء التسوية");

    for (const item of params.items) {
      const invRows = await writer.select().from(inventory)
        .where(eq(inventory.id, item.inventoryId)).limit(1).for("update");
      const inv = invRows[0];
      if (!inv) throw new Error(`الصنف رقم ${item.inventoryId} غير موجود بالمخزون`);
      const averageCost = parseFloat((inv as any).averageCost || "0");

      // ─────────────────────────────────────────────────────────────
      // Opening Balance: ينشئ Lot جديداً من Catalog Item كما تم اعتماده.
      // ─────────────────────────────────────────────────────────────
      if (isOpeningBalance) {
        const before = normalizeInventoryQuantity(Number(inv.quantity || 0));
        const after = normalizeInventoryQuantity(item.afterQuantity);
        const diff = normalizeInventoryQuantity(after - before);

        if (!params.sourceCountOperationId) throw new Error("الرصيد الافتتاحي يتطلب عملية جرد مصدر");
        if (!inv.linkedItemId) throw new Error(`Inventory #${item.inventoryId} غير مربوط بصنف Catalog`);
        if (before !== 0) throw new Error(`Inventory #${item.inventoryId} ليس صفرياً؛ لا يمكن تأسيس رصيد افتتاحي فوق رصيد قائم`);
        if (!(after > 0)) throw new Error("كمية الرصيد الافتتاحي يجب أن تكون أكبر من صفر");
        if (sourceCountOperation?.warehouseId && inv.warehouseId !== sourceCountOperation.warehouseId) {
          throw new Error(`Inventory #${item.inventoryId} لا ينتمي لمستودع عملية الرصيد الافتتاحي`);
        }

        const countRows = await writer.select().from(inventoryCountItems).where(and(
          eq(inventoryCountItems.operationId, params.sourceCountOperationId),
          eq(inventoryCountItems.inventoryId, item.inventoryId),
        )).limit(2);
        if (countRows.length !== 1) {
          throw new Error(`يجب أن يوجد سطر رصيد افتتاحي واحد فقط للصنف Inventory #${item.inventoryId}`);
        }
        const countItem = countRows[0];
        if (countItem.lotId) throw new Error(`تم إنشاء Lot مسبقاً لسطر الرصيد الافتتاحي #${countItem.id}`);

        const openingBalanceAdjustmentValue = roundTo(diff * averageCost, 2);
        const [settlementItemResult] = await writer.insert(inventorySettlementItems).values({
          settlementId,
          inventoryId: item.inventoryId,
          beforeQuantity: before.toFixed(3),
          afterQuantity: after.toFixed(3),
          diffQuantity: diff.toFixed(3),
          // Opening Balance has no inventory_count_snapshots row by design. Preserve its
          // established cost basis and only record the valuation fields added in Phase 4.
          unitCostUsed: averageCost.toFixed(4),
          adjustmentValue: openingBalanceAdjustmentValue.toFixed(2),
          lotNumber: item.lotNumber,
          expiryDate: item.expiryDate ? new Date(item.expiryDate) : null,
        } as any);
        const settlementItemId = Number((settlementItemResult as any).insertId);

        const lot = await createOpeningBalanceInventoryLot({
          tx: writer,
          catalogItemId: Number(inv.linkedItemId),
          inventoryId: item.inventoryId,
          sourceCountOperationId: Number(params.sourceCountOperationId),
          sourceSettlementId: settlementId,
          sourceSettlementItemId: settlementItemId,
          quantity: after,
          unit: (inv as any).issueUnit || inv.unit,
          unitCost: averageCost,
          expiryDate: item.expiryDate || countItem?.expiryDate || null,
          createdById: params.appliedById,
        });

        await writer.update(inventorySettlementItems).set({ lotId: lot.lotId } as any)
          .where(eq(inventorySettlementItems.id, settlementItemId));
        await writer.update(inventoryCountItems).set({ lotId: lot.lotId } as any)
          .where(eq(inventoryCountItems.id, countItem.id));

        lotLabels.push({
          lotId: lot.lotId,
          lotCode: lot.lotCode,
          trackingToken: lot.trackingToken,
          itemName: inv.itemName,
          quantity: after,
          unit: (inv as any).issueUnit || inv.unit || "",
          sourceType: "opening_balance",
          settlementNumber,
        });

        await writer.update(inventory).set({
          quantity: after,
          totalCostValue: calculateInventoryValue(after, averageCost).toFixed(2),
          expiryDate: item.expiryDate ? new Date(item.expiryDate) : inv.expiryDate,
          updatedAt: new Date(),
        } as any).where(eq(inventory.id, item.inventoryId));

        if (diff !== 0) {
          const movementQuantity = Math.abs(diff);
          await writer.insert(inventoryTransactions).values({
            inventoryId: item.inventoryId,
            lotId: lot.lotId,
            type: diff > 0 ? "in" : "out",
            quantity: normalizeInventoryQuantity(movementQuantity),
            unitCost: averageCost.toFixed(4),
            totalCost: calculateMovementTotal(movementQuantity, averageCost).toFixed(2),
            reason: params.reason,
            performedById: params.appliedById,
            transactionType: "adjustment",
            documentUrl: settlementNumber,
          } as any);
        }
        continue;
      }

      // ─────────────────────────────────────────────────────────────
      // 2B-8 periodic Lot count: afterQuantity = الكمية المعدودة لنفس Lot.
      // لا نضبط Inventory إلى رقم Count؛ نضيف الفرق فقط حتى لا نمس Lots أخرى.
      // ─────────────────────────────────────────────────────────────
      if (isPeriodicLotSettlement) {
        if (!params.sourceCountOperationId) throw new Error("التسوية الدورية تتطلب عملية جرد مصدر");
        if (!item.lotId) throw new Error(`سطر التسوية للصنف Inventory #${item.inventoryId} لا يحتوي Lot`);

        const countRows = await writer.select().from(inventoryCountItems).where(and(
          eq(inventoryCountItems.operationId, params.sourceCountOperationId),
          eq(inventoryCountItems.inventoryId, item.inventoryId),
          eq(inventoryCountItems.lotId, item.lotId),
        )).limit(2);
        if (countRows.length !== 1) {
          throw new Error(`تعذر تحديد سطر الجرد للـLot #${item.lotId} بشكل فريد`);
        }
        const countItem = countRows[0];
        if (countItem.countedQuantity == null) {
          throw new Error(`Lot #${item.lotId} لم تُسجل له كمية معدودة`);
        }

        const expectedBalance = normalizeInventoryQuantity(Number(countItem.systemQuantity || 0));
        // Count settlement is immutable after final save: never trust an editable
        // client afterQuantity. The frozen counted quantity is the only source.
        const countedAfter = normalizeInventoryQuantity(Number(countItem.countedQuantity || 0));
        const frozenDiff = normalizeInventoryQuantity(Number(countItem.diffQuantity || 0));
        if (frozenDiff !== normalizeInventoryQuantity(countedAfter - expectedBalance)) {
          throw new Error(`بيانات فرق الجرد للـLot #${item.lotId} غير متسقة؛ أوقف التسوية وراجع عملية الجرد`);
        }

        // Main Phase 4 / 4.2.2: Count valuation is frozen at count opening.
        // Never substitute the current Inventory average cost here.
        const snapshot = await readCountSnapshotCost(writer, item.inventoryId, Number(item.lotId));
        if (snapshot.systemQuantity !== expectedBalance) {
          throw new Error(`Opening Snapshot للـLot #${item.lotId} لا يطابق رصيد افتتاح الجرد المحفوظ`);
        }
        const unitCostUsed = snapshot.unitCostUsed;

        const adjustment = await applyInventoryLotCountAdjustment({
          tx: writer,
          lotId: Number(item.lotId),
          inventoryId: item.inventoryId,
          expectedBalanceQuantity: expectedBalance,
          countedQuantity: countedAfter,
        });
        const adjustmentValue = roundTo(adjustment.diffQuantity * unitCostUsed, 2);
        const currentTotalCostValue = Number((inv as any).totalCostValue || 0);
        // Preserve the established zero-quantity convention: zero stock carries zero
        // total value while averageCost itself is left unchanged. Otherwise derive the
        // resulting average from current value + the historical count adjustment.
        const newTotalCostValue = adjustment.afterInventoryQuantity === 0
          ? 0
          : roundTo(currentTotalCostValue + adjustmentValue, 2);
        const newAverageCost = adjustment.afterInventoryQuantity === 0
          ? averageCost
          : roundTo(newTotalCostValue / adjustment.afterInventoryQuantity, 4);

        await writer.insert(inventorySettlementItems).values({
          settlementId,
          inventoryId: item.inventoryId,
          lotId: Number(item.lotId),
          beforeQuantity: adjustment.beforeLotQuantity.toFixed(3),
          afterQuantity: adjustment.afterLotQuantity.toFixed(3),
          diffQuantity: adjustment.diffQuantity.toFixed(3),
          unitCostUsed: unitCostUsed.toFixed(4),
          adjustmentValue: adjustmentValue.toFixed(2),
          lotNumber: item.lotNumber,
          expiryDate: item.expiryDate ? new Date(item.expiryDate) : null,
        } as any);

        // quantity عُدّلت داخل helper بنفس Transaction؛ هنا نحدّث القيمة ومتوسط التكلفة.
        await writer.update(inventory).set({
          totalCostValue: newTotalCostValue.toFixed(2),
          averageCost: newAverageCost.toFixed(4),
          updatedAt: new Date(),
        } as any).where(eq(inventory.id, item.inventoryId));

        if (adjustment.diffQuantity !== 0) {
          const movementQuantity = Math.abs(adjustment.diffQuantity);
          await writer.insert(inventoryTransactions).values({
            inventoryId: item.inventoryId,
            lotId: Number(item.lotId),
            type: adjustment.diffQuantity > 0 ? "in" : "out",
            quantity: normalizeInventoryQuantity(movementQuantity),
            unitCost: unitCostUsed.toFixed(4),
            totalCost: calculateMovementTotal(movementQuantity, unitCostUsed).toFixed(2),
            reason: params.reason,
            performedById: params.appliedById,
            transactionType: "adjustment",
            documentUrl: settlementNumber,
          } as any);
        }

        continue;
      }

      // ─────────────────────────────────────────────────────────────
      // Legacy non-Lot path (Feature Gate OFF): نحافظ على Workflow الكمية، مع تطبيق تقييم Phase 4.
      // ─────────────────────────────────────────────────────────────
      const before = normalizeInventoryQuantity(Number(inv.quantity || 0));
      const after = normalizeInventoryQuantity(item.afterQuantity);
      const diff = normalizeInventoryQuantity(after - before);
      const currentTotalCostValue = Number((inv as any).totalCostValue || 0);

      let unitCostUsed = averageCost;
      let adjustmentValue = roundTo(diff * unitCostUsed, 2);
      let newAverageCost = averageCost;

      if (params.sourceType === "from_count") {
        // Feature Gate OFF still uses the same Phase 4 Count valuation rule. The
        // legacy Snapshot has lotId=NULL, so match operation + inventory + NULL Lot.
        const snapshot = await readCountSnapshotCost(writer, item.inventoryId, null);
        unitCostUsed = snapshot.unitCostUsed;
        adjustmentValue = roundTo(diff * unitCostUsed, 2);
        const newTotalForAverage = after === 0
          ? 0
          : roundTo(currentTotalCostValue + adjustmentValue, 2);
        newAverageCost = after === 0
          ? averageCost
          : roundTo(newTotalForAverage / after, 4);
      }

      // Manual Settlement uses Current Average Cost. Count Settlement uses the
      // Opening Snapshot above. Do not recompute legacy current value from scratch:
      // future postings move the current value only by this settlement adjustment.
      const newTotalCostValue = after === 0
        ? 0
        : roundTo(currentTotalCostValue + adjustmentValue, 2);

      await writer.insert(inventorySettlementItems).values({
        settlementId,
        inventoryId: item.inventoryId,
        beforeQuantity: before.toFixed(3),
        afterQuantity: after.toFixed(3),
        diffQuantity: diff.toFixed(3),
        unitCostUsed: unitCostUsed.toFixed(4),
        adjustmentValue: adjustmentValue.toFixed(2),
        lotNumber: item.lotNumber,
        expiryDate: item.expiryDate ? new Date(item.expiryDate) : null,
      } as any);

      await writer.update(inventory).set({
        quantity: after,
        totalCostValue: newTotalCostValue.toFixed(2),
        averageCost: newAverageCost.toFixed(4),
        expiryDate: item.expiryDate ? new Date(item.expiryDate) : inv.expiryDate,
        updatedAt: new Date(),
      } as any).where(eq(inventory.id, item.inventoryId));

      if (diff !== 0) {
        const movementQuantity = Math.abs(diff);
        await writer.insert(inventoryTransactions).values({
          inventoryId: item.inventoryId,
          type: diff > 0 ? "in" : "out",
          quantity: normalizeInventoryQuantity(movementQuantity),
          unitCost: unitCostUsed.toFixed(4),
          totalCost: calculateMovementTotal(movementQuantity, unitCostUsed).toFixed(2),
          reason: params.reason,
          performedById: params.appliedById,
          transactionType: "adjustment",
          documentUrl: settlementNumber,
        } as any);
      }
    }

    return { settlementId, settlementNumber };
  };

  // Main Phase 4 / 4.2.3: all supported Settlement posting paths are atomic,
  // including legacy non-Lot Count/Manual paths. Validation without DB effects
  // may happen before this point; all persistent posting effects use this tx.
  const result = options?.writer
    ? await applyWith(options.writer)
    : await db.transaction(async (tx: any) => applyWith(tx));
  if (isOpeningBalance || isPeriodicLotSettlement) {
    return { ...result, inventoryLotsEnabled: true, lotLabels };
  }
  return { ...result, inventoryLotsEnabled: false, lotLabels: [] as typeof lotLabels };
}

// ── 9) قائمة التسويات (للأرشيف) ──
export async function listSettlements() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(inventorySettlements)
    .orderBy(desc(inventorySettlements.createdAt));
}

// ── 10) تفاصيل تسوية كاملة (رأس + أصناف) — للعرض والطباعة بالأرشيف ──
export async function getSettlementDetails(settlementId: number) {
  const db = await getDb();
  if (!db) return null;

  const header = await db.select().from(inventorySettlements)
    .where(eq(inventorySettlements.id, settlementId)).limit(1);
  if (!header[0]) return null;

  const appliedBy = await getUserById(header[0].appliedById);
  let sourceCountType: string | null = null;
  if (header[0].sourceCountOperationId) {
    const sourceCountRows = await db.select({ countType: inventoryCountOperations.countType })
      .from(inventoryCountOperations)
      .where(eq(inventoryCountOperations.id, Number(header[0].sourceCountOperationId)))
      .limit(1);
    sourceCountType = sourceCountRows[0]?.countType ?? null;
  }

  const items = await db.select({
    id: inventorySettlementItems.id,
    inventoryId: inventorySettlementItems.inventoryId,
    lotId: inventorySettlementItems.lotId,
    lotCode: inventoryLots.lotCode,
    sourceType: inventoryLots.sourceType,
    batchNumber: inventoryLots.batchNumber,
    lotExpiryDate: inventoryLots.expiryDate,
    catalogItemId: inventory.linkedItemId,
    itemName: inventory.itemName,
    unit: inventory.unit,
    beforeQuantity: inventorySettlementItems.beforeQuantity,
    afterQuantity: inventorySettlementItems.afterQuantity,
    diffQuantity: inventorySettlementItems.diffQuantity,
    unitCostUsed: inventorySettlementItems.unitCostUsed,
    adjustmentValue: inventorySettlementItems.adjustmentValue,
    lotNumber: inventorySettlementItems.lotNumber,
    expiryDate: inventorySettlementItems.expiryDate,
  })
    .from(inventorySettlementItems)
    .innerJoin(inventory, eq(inventory.id, inventorySettlementItems.inventoryId))
    .leftJoin(inventoryLots, eq(inventoryLots.id, inventorySettlementItems.lotId))
    .where(eq(inventorySettlementItems.settlementId, settlementId));

  return {
    settlement: {
      ...header[0],
      sourceCountType,
      appliedByName: (appliedBy as any)?.name || "—",
    },
    items,
  };
}

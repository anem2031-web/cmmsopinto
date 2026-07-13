// ============================================================
// db/invoice-drafts.ts — مسودات الفواتير واعتمادها
// (مُقسَّم من db.ts الأصلي حسب المجال الوظيفي)
// ============================================================
import { eq, desc, asc, and, sql, count, sum, inArray, notInArray, like, or, gte, lte, lt, isNull, isNotNull, ne } from "drizzle-orm";
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
  inventorySettlements,
  inventorySettlementItems,
  inventoryCountNumberCounter,
  inventorySettlementNumberCounter,
} from "../../../drizzle/schema";
import { ENV } from '../env';


import { getDb } from "./client";
import { getInventoryItemById, getUserById } from "./deletes";
import { getNextInventoryCode, getNextItemBarcode } from "./warehouse-receipts";
import { createInventoryItemV2 } from "./warehouse-returns";

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

  for (const item of (receipt as any).items || []) {
    const qty       = parseFloat(item.receivedQuantity || "1");
    const unitCost  = parseFloat(item.unitCost || "0");

    if (item.inventoryId) {
      // صنف موجود — تحديث الرصيد ومتوسط التكلفة
      const existing = await getInventoryItemById(item.inventoryId);
      if (existing) {
        const oldQty     = existing.quantity || 0;
        const oldCost    = parseFloat((existing as any).averageCost || "0");
        const newQty     = oldQty + qty;
        const newAvgCost = newQty > 0
          ? ((oldQty * oldCost) + (qty * unitCost)) / newQty
          : unitCost;

        await db.update(inventory).set({
          quantity:       newQty,
          averageCost:    newAvgCost.toFixed(4),
          totalCostValue: (newQty * newAvgCost).toFixed(2),
          lastRestockedAt: new Date(),
        } as any).where(eq(inventory.id, item.inventoryId));
      }
    } else {
      // صنف جديد — إنشاء في المخزون
      const internalCode = await getNextInventoryCode();
      const result = await db.insert(inventory).values({
        itemName:        item.itemName,
        itemName_ar:     item.itemName_ar,
        itemName_en:     item.itemName_en,
        itemType:        item.itemType || "consumable",
        quantity:        0,
        unit:            item.purchaseUnit || "قطعة",
        purchaseUnit:    item.purchaseUnit,
        averageCost:     unitCost.toFixed(4),
        totalCostValue:  "0",
        internalCode,
        receiptId,
      } as any);
      item.inventoryId = result[0].insertId;
    }

    // تسجيل حركة الدخول
    await db.insert(inventoryTransactions).values({
      inventoryId:         item.inventoryId,
      type:                "in",
      quantity:            Math.round(qty),
      reason:              `اعتماد فاتورة ${(receipt as any).receiptNumber || receiptId}`,
      purchaseOrderItemId: item.purchaseOrderItemId,
      performedById,
      transactionType:     "purchase",
      receiptId,
    } as any);

    // تحديث حالة بند طلب الشراء
    if (item.purchaseOrderItemId) {
      await db.update(purchaseOrderItems)
        .set({ status: "delivered_to_warehouse", receivedAt: new Date(), receivedById: performedById } as any)
        .where(eq(purchaseOrderItems.id, item.purchaseOrderItemId));
    }
  }

  // تحديث حالة الفاتورة
  await db.update(warehouseReceipts)
    .set({ status: "confirmed", isDraft: false } as any)
    .where(eq(warehouseReceipts.id, receiptId));
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

export async function generateSettlementNumber(): Promise<string> {
  const db = await getDb();
  const year = new Date().getFullYear();
  if (!db) return `ADJ-${year}-0001`;
  const [result] = await db.insert(inventorySettlementNumberCounter).values({ year });
  const seq = (result as any).insertId as number;
  return `ADJ-${year}-${String(seq).padStart(4, "0")}`;
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
export async function createCountOperation(params: {
  operationTitle?: string;
  scope: "full" | "partial";
  warehouseId?: number;      // NULL = يغطي كل المخازن
  itemIds?: number[];        // مطلوبة لو scope = "partial" (إلا لو allowEmpty)
  allowEmpty?: boolean;
  createdById: number;
}) {
  const db = await getDb();
  if (!db) throw new Error("تعذر الاتصال بقاعدة البيانات");

  const operationNumber = await generateCountNumber();
  const { riyadhDate, riyadhDayName, riyadhStartTime } = getRiyadhNow();
  const title = params.operationTitle?.trim() || `جرد يوم ${riyadhDayName} بتاريخ ${riyadhDate}`;

  const [opResult] = await db.insert(inventoryCountOperations).values({
    operationNumber,
    operationTitle: title,
    operationDate: new Date(riyadhDate),
    riyadhDayName,
    riyadhStartTime,
    scope: params.scope,
    warehouseId: params.warehouseId,
    status: "in_progress",
    createdById: params.createdById,
  });
  const operationId = (opResult as any).insertId as number;

  // وضع يدوي/باركود: نبدأ الجرد فاضي تماماً بدون أي أصناف مسبقة
  if (params.scope === "partial" && params.allowEmpty && !params.itemIds?.length) {
    return { operationId, operationNumber, operationTitle: title, itemCount: 0 };
  }

  // جلب الأصناف المستهدفة: حسب المخزن و/أو قائمة محددة (جزئي)
  const conditions = [];
  if (params.warehouseId) conditions.push(eq(inventory.warehouseId, params.warehouseId));
  if (params.scope === "partial" && params.itemIds?.length) {
    conditions.push(inArray(inventory.id, params.itemIds));
  }

  const targetItems = await db
    .select()
    .from(inventory)
    .where(conditions.length ? and(...conditions) : undefined);

  if (targetItems.length === 0) {
    throw new Error("لا توجد أصناف مطابقة لنطاق الجرد المحدد");
  }

  // إنشاء سطر جرد فارغ (بانتظار العد) لكل صنف، مع صورة لحظية من كمية النظام
  for (const item of targetItems) {
    await db.insert(inventoryCountItems).values({
      operationId,
      inventoryId: item.id,
      systemQuantity: String(item.quantity),
      lotNumber: null,
      expiryDate: item.expiryDate ?? null,
    });
  }

  return { operationId, operationNumber, operationTitle: title, itemCount: targetItems.length };
}

// ── 1ب) إضافة/زيادة صنف بجرد جارٍ عبر مسح باركود أو اختيار مباشر ──
// لو الصنف مو مضاف بعد للجرد: يُنشأ سطر جديد بكمية معدودة = incrementBy.
// لو مضاف مسبقاً: تُزاد كميته المعدودة بمقدار incrementBy (مسح متكرر = عدّ تراكمي).
export async function scanCountItem(params: {
  operationId: number;
  inventoryId: number;
  incrementBy?: number;   // افتراضي 1 (كل مسحة = وحدة واحدة)
  countedById: number;
}) {
  const db = await getDb();
  if (!db) throw new Error("تعذر الاتصال بقاعدة البيانات");

  // حماية: لا إضافة/تعديل على جرد مقفل نهائياً
  const opRows = await db.select().from(inventoryCountOperations)
    .where(eq(inventoryCountOperations.id, params.operationId)).limit(1);
  if (opRows[0]?.status === "completed") {
    throw new Error("هذا الجرد محفوظ نهائياً ولا يمكن التعديل عليه");
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

  const diff = increment - inv.quantity;
  const [result] = await db.insert(inventoryCountItems).values({
    operationId: params.operationId,
    inventoryId: params.inventoryId,
    systemQuantity: String(inv.quantity),
    countedQuantity: String(increment),
    diffQuantity: String(diff),
    expiryDate: inv.expiryDate ?? null,
    countedById: params.countedById,
    countedAt: new Date(),
  });
  const countItemId = (result as any).insertId as number;
  return { countItemId, countedQuantity: increment, diffQuantity: diff, isNew: true };
}

// ── 1ج) إضافة صنف لعملية جرد جارية بدون تحديد كمية (يظهر بالجدول بانتظار العدّ) ──
// يُستخدم من لوحة "إضافة صنف للجرد" (بحث بالاسم/الرقم/الباركود): يضمن وجود سطر
// للصنف بالجرد ثم تُدخل الكمية الفعلية لاحقاً عبر recordItem — لا يُخمَّن أي رقم.
// لو الصنف مضاف مسبقاً لنفس الجرد: يُعاد سطره الحالي كما هو (بدون تكرار ولا تصفير لما عُدَّ سابقاً).
export async function addItemToCount(params: {
  operationId: number;
  inventoryId: number;
}) {
  const db = await getDb();
  if (!db) throw new Error("تعذر الاتصال بقاعدة البيانات");

  const opRows = await db.select().from(inventoryCountOperations)
    .where(eq(inventoryCountOperations.id, params.operationId)).limit(1);
  if (!opRows[0]) throw new Error("عملية الجرد غير موجودة");
  if (opRows[0].status === "completed") {
    throw new Error("هذا الجرد محفوظ نهائياً ولا يمكن التعديل عليه");
  }

  const existingRows = await db.select().from(inventoryCountItems)
    .where(and(
      eq(inventoryCountItems.operationId, params.operationId),
      eq(inventoryCountItems.inventoryId, params.inventoryId),
    )).limit(1);

  const invRows = await db.select().from(inventory).where(eq(inventory.id, params.inventoryId)).limit(1);
  const inv = invRows[0];
  if (!inv) throw new Error("الصنف غير موجود بالمخزون");

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

  const [result] = await db.insert(inventoryCountItems).values({
    operationId: params.operationId,
    inventoryId: params.inventoryId,
    systemQuantity: String(inv.quantity),
    expiryDate: inv.expiryDate ?? null,
  });
  const countItemId = (result as any).insertId as number;

  return {
    countItemId,
    itemName: inv.itemName,
    unit: inv.unit,
    systemQuantity: inv.quantity,
    countedQuantity: null,
    lotNumber: null,
    expiryDate: inv.expiryDate ?? null,
    notes: null,
    isNew: true,
  };
}

// ── 1د) إضافة صنف جديد كليّاً (غير موجود بالمخزون أصلاً) أثناء عملية جرد جارية ──
// يُستخدم فقط من شاشة الجرد اليدوي حين يُكتشف صنف فعلي غير مسجّل بالنظام إطلاقاً.
// الفرق عن addItemToCount: هنا الصنف غير موجود بجدول inventory إطلاقاً، فيُنشأ من الصفر
// بنفس آلية أي صنف عادي (كود داخلي INV-YYYY-NNNN + باركود مصنع تسلسلي)، ويدخل المخزون
// فوراً بالكمية المُدخلة (بعكس الفروقات العادية اللي تنتظر مرحلة التسوية).
export async function addNewItemDuringCount(params: {
  operationId: number;
  itemName: string;
  unit: string;
  quantity: number;
  cost?: number;           // التكلفة اختيارية دائماً
  createdById: number;
}) {
  const db = await getDb();
  if (!db) throw new Error("تعذر الاتصال بقاعدة البيانات");

  const opRows = await db.select().from(inventoryCountOperations)
    .where(eq(inventoryCountOperations.id, params.operationId)).limit(1);
  const op = opRows[0];
  if (!op) throw new Error("عملية الجرد غير موجودة");
  if (op.status === "completed") {
    throw new Error("هذا الجرد محفوظ نهائياً ولا يمكن الإضافة عليه");
  }

  // توليد نفس معرّفَي أي صنف عادي — لضمان التطابق الكامل مع باقي المخزون بالتقارير
  const internalCode = await getNextInventoryCode();
  const manufacturerBarcode = await getNextItemBarcode();

  const cost = params.cost ?? 0;
  const totalCostValue = cost * params.quantity;

  const inventoryId = await createInventoryItemV2({
    itemName:            params.itemName,
    quantity:             params.quantity,
    unit:                 params.unit,
    internalCode,
    manufacturerBarcode,
    averageCost:          String(cost),
    totalCostValue:       String(totalCostValue),
    warehouseId:          op.warehouseId ?? undefined,
  }, db);

  // دخول فوري للمخزون (بعكس فروقات الجرد العادية) — يوثَّق كحركة "in" من نوع تسوية
  await db.insert(inventoryTransactions).values({
    inventoryId,
    type:            "in",
    quantity:        Math.round(params.quantity),
    reason:          `صنف جديد أُضيف أثناء عملية الجرد ${op.operationNumber}`,
    performedById:   params.createdById,
    transactionType: "adjustment",
    documentUrl:     op.operationNumber,
  });

  // سطر توثيقي بجدول الجرد — systemQuantity = countedQuantity لأن الرصيد
  // حُدّث بنفس اللحظة، فلا يبقى فرق فعلي يحتاج تسوية لاحقة لهذا الصنف تحديداً.
  const [countItemResult] = await db.insert(inventoryCountItems).values({
    operationId:    params.operationId,
    inventoryId,
    systemQuantity: String(params.quantity),
    countedQuantity: String(params.quantity),
    diffQuantity:    "0",
    countedById:     params.createdById,
    countedAt:       new Date(),
    notes:           "صنف جديد أُضيف أثناء الجرد",
  });
  const countItemId = (countItemResult as any).insertId as number;

  return {
    countItemId,
    inventoryId,
    itemName: params.itemName,
    unit: params.unit,
    quantity: params.quantity,
    internalCode,
    manufacturerBarcode,
  };
}

// ── 2) تسجيل الكمية المعدودة فعلياً لصنف واحد ضمن عملية جرد ──
export async function recordCountItem(params: {
  countItemId: number;
  countedQuantity: number;
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

  // حماية: لا تعديل إطلاقاً على جرد تم حفظه نهائياً (مقفل)
  const opRows = await db.select().from(inventoryCountOperations)
    .where(eq(inventoryCountOperations.id, row.operationId)).limit(1);
  if (opRows[0]?.status === "completed") {
    throw new Error("هذا الجرد محفوظ نهائياً ولا يمكن التعديل عليه");
  }

  const diff = params.countedQuantity - parseFloat(row.systemQuantity);

  await db.update(inventoryCountItems).set({
    countedQuantity: String(params.countedQuantity),
    diffQuantity: String(diff),
    lotNumber: params.lotNumber ?? row.lotNumber,
    expiryDate: params.expiryDate ? new Date(params.expiryDate) : row.expiryDate,
    notes: params.notes,
    countedById: params.countedById,
    countedAt: new Date(),
  }).where(eq(inventoryCountItems.id, params.countItemId));

  return { diffQuantity: diff };
}

// ── 3) إنهاء عملية الجرد (تسجيل فقط — لا يمس المخزون) ──
export async function completeCountOperation(operationId: number) {
  const db = await getDb();
  if (!db) throw new Error("تعذر الاتصال بقاعدة البيانات");

  const opRows = await db.select().from(inventoryCountOperations)
    .where(eq(inventoryCountOperations.id, operationId)).limit(1);
  if (opRows[0]?.status === "completed") {
    throw new Error("هذا الجرد محفوظ نهائياً مسبقاً");
  }

  const items = await db.select().from(inventoryCountItems)
    .where(eq(inventoryCountItems.operationId, operationId));

  const counted = items.filter(i => i.countedQuantity !== null);
  const discrepancies = counted.filter(i => parseFloat(i.diffQuantity || "0") !== 0);

  await db.update(inventoryCountOperations).set({
    status: "completed",
    totalItemsCounted: counted.length,
    totalDiscrepancies: discrepancies.length,
    completedAt: new Date(),
  }).where(eq(inventoryCountOperations.id, operationId));

  return { totalItemsCounted: counted.length, totalDiscrepancies: discrepancies.length };
}

// ── 3ب) حذف مسودة جرد بالكامل (مسموح فقط طالما لم تُحفظ نهائياً) ──
export async function deleteCountOperation(operationId: number) {
  const db = await getDb();
  if (!db) throw new Error("تعذر الاتصال بقاعدة البيانات");

  const opRows = await db.select().from(inventoryCountOperations)
    .where(eq(inventoryCountOperations.id, operationId)).limit(1);
  if (!opRows[0]) throw new Error("عملية الجرد غير موجودة");
  if (opRows[0].status === "completed") {
    throw new Error("لا يمكن حذف جرد محفوظ نهائياً — المسودات فقط قابلة للحذف");
  }

  await db.delete(inventoryCountItems).where(eq(inventoryCountItems.operationId, operationId));
  await db.delete(inventoryCountOperations).where(eq(inventoryCountOperations.id, operationId));

  return { success: true };
}

// ── 4) الأصناف الغير مجرودة بعد ضمن عملية جارية ──
export async function getUncountedItems(operationId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select({
    countItemId: inventoryCountItems.id,
    inventoryId: inventoryCountItems.inventoryId,
    itemName: inventory.itemName,
    unit: inventory.unit,
    systemQuantity: inventoryCountItems.systemQuantity,
  })
    .from(inventoryCountItems)
    .innerJoin(inventory, eq(inventory.id, inventoryCountItems.inventoryId))
    .where(and(
      eq(inventoryCountItems.operationId, operationId),
      isNull(inventoryCountItems.countedQuantity),
    ));
}

// ── 5) تفاصيل عملية جرد كاملة (لعرض الشاشة) ──
export async function getCountOperationDetails(operationId: number) {
  const db = await getDb();
  if (!db) return null;

  const op = await db.select().from(inventoryCountOperations)
    .where(eq(inventoryCountOperations.id, operationId)).limit(1);
  if (!op[0]) return null;

  const creator = await getUserById(op[0].createdById);

  const items = await db.select({
    countItemId: inventoryCountItems.id,
    inventoryId: inventoryCountItems.inventoryId,
    itemName: inventory.itemName,
    unit: inventory.unit,
    systemQuantity: inventoryCountItems.systemQuantity,
    countedQuantity: inventoryCountItems.countedQuantity,
    diffQuantity: inventoryCountItems.diffQuantity,
    lotNumber: inventoryCountItems.lotNumber,
    expiryDate: inventoryCountItems.expiryDate,
    notes: inventoryCountItems.notes,
    countedAt: inventoryCountItems.countedAt,
  })
    .from(inventoryCountItems)
    .innerJoin(inventory, eq(inventory.id, inventoryCountItems.inventoryId))
    .where(eq(inventoryCountItems.operationId, operationId));

  return { operation: { ...op[0], creatorName: (creator as any)?.name || "—" }, items };
}

// ── 6) قائمة عمليات الجرد (للأرشيف) ──
export async function listCountOperations() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(inventoryCountOperations)
    .orderBy(desc(inventoryCountOperations.createdAt));
}

// ── 7) فروقات جرد مكتمل (تُستخدم لتعبئة شاشة التسوية تلقائياً) ──
export async function getCountDiscrepancies(operationId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select({
    countItemId: inventoryCountItems.id,
    inventoryId: inventoryCountItems.inventoryId,
    itemName: inventory.itemName,
    unit: inventory.unit,
    systemQuantity: inventoryCountItems.systemQuantity,
    countedQuantity: inventoryCountItems.countedQuantity,
    diffQuantity: inventoryCountItems.diffQuantity,
    lotNumber: inventoryCountItems.lotNumber,
    expiryDate: inventoryCountItems.expiryDate,
  })
    .from(inventoryCountItems)
    .innerJoin(inventory, eq(inventory.id, inventoryCountItems.inventoryId))
    .where(and(
      eq(inventoryCountItems.operationId, operationId),
      isNotNull(inventoryCountItems.countedQuantity),
      ne(inventoryCountItems.diffQuantity, "0"),
    ));
}

// ── 8) تطبيق تسوية المخزون فعلياً (التطبيق الوحيد المسموح على الكميات) ──
export async function applySettlement(params: {
  sourceType: "from_count" | "manual";
  sourceCountOperationId?: number;
  reason: string;               // إلزامي دائماً
  appliedById: number;
  items: Array<{
    inventoryId: number;
    afterQuantity: number;      // الكمية النهائية بعد التسوية (قابلة للتعديل اليدوي حتى لو من جرد)
    lotNumber?: string;
    expiryDate?: string;
  }>;
}) {
  const db = await getDb();
  if (!db) throw new Error("تعذر الاتصال بقاعدة البيانات");

  if (!params.reason || params.reason.trim().length < 10) {
    throw new Error("سبب التسوية إلزامي (10 أحرف على الأقل)");
  }
  if (params.items.length === 0) {
    throw new Error("لا توجد أصناف للتسوية");
  }

  const settlementNumber = await generateSettlementNumber();

  const [settlementResult] = await db.insert(inventorySettlements).values({
    settlementNumber,
    sourceType: params.sourceType,
    sourceCountOperationId: params.sourceCountOperationId,
    status: "applied",
    reason: params.reason,
    appliedById: params.appliedById,
  });
  const settlementId = (settlementResult as any).insertId as number;

  for (const item of params.items) {
    const invRows = await db.select().from(inventory)
      .where(eq(inventory.id, item.inventoryId)).limit(1);
    const inv = invRows[0];
    if (!inv) throw new Error(`الصنف رقم ${item.inventoryId} غير موجود بالمخزون`);

    const before = inv.quantity;
    const after = item.afterQuantity;
    const diff = after - before;

    // 1) تسجيل تفاصيل سطر التسوية
    await db.insert(inventorySettlementItems).values({
      settlementId,
      inventoryId: item.inventoryId,
      beforeQuantity: String(before),
      afterQuantity: String(after),
      diffQuantity: String(diff),
      lotNumber: item.lotNumber,
      expiryDate: item.expiryDate ? new Date(item.expiryDate) : null,
    });

    // 2) التطبيق الفعلي على المخزون
    await db.update(inventory).set({
      quantity: after,
      expiryDate: item.expiryDate ? new Date(item.expiryDate) : inv.expiryDate,
      updatedAt: new Date(),
    }).where(eq(inventory.id, item.inventoryId));

    // 3) تسجيل حركة تظهر تلقائياً بصفحة "تتبع صنف" (نوع adjustment)
    if (diff !== 0) {
      await db.insert(inventoryTransactions).values({
        inventoryId:     item.inventoryId,
        type:            diff > 0 ? "in" : "out",
        quantity:        Math.abs(Math.round(diff)),
        reason:          params.reason,
        performedById:   params.appliedById,
        transactionType: "adjustment",
        documentUrl:     settlementNumber,
      });
    }
  }

  return { settlementId, settlementNumber };
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

  const items = await db.select({
    id: inventorySettlementItems.id,
    inventoryId: inventorySettlementItems.inventoryId,
    itemName: inventory.itemName,
    unit: inventory.unit,
    beforeQuantity: inventorySettlementItems.beforeQuantity,
    afterQuantity: inventorySettlementItems.afterQuantity,
    diffQuantity: inventorySettlementItems.diffQuantity,
    lotNumber: inventorySettlementItems.lotNumber,
    expiryDate: inventorySettlementItems.expiryDate,
  })
    .from(inventorySettlementItems)
    .innerJoin(inventory, eq(inventory.id, inventorySettlementItems.inventoryId))
    .where(eq(inventorySettlementItems.settlementId, settlementId));

  return { settlement: { ...header[0], appliedByName: (appliedBy as any)?.name || "—" }, items };
}

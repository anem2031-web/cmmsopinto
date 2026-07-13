// ============================================================
// db/warehouse-returns.ts — إرجاعات المستودع
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
import { getPOItemById, getPurchaseOrderById } from "./purchase";
import { getNextDeliveryNumber } from "./warehouse-receipts";

export async function createWarehouseReturn(data: InsertWarehouseReturn) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.insert(warehouseReturns).values(data);
  return result[0].insertId;
}

export async function getWarehouseReturns(filters?: { purchaseOrderId?: number; inventoryId?: number }) {
  const db = await getDb();
  if (!db) return [];
  const conditions = [];
  if (filters?.purchaseOrderId) conditions.push(eq(warehouseReturns.purchaseOrderId, filters.purchaseOrderId));
  if (filters?.inventoryId) conditions.push(eq(warehouseReturns.inventoryId, filters.inventoryId));
  return conditions.length > 0
    ? db.select().from(warehouseReturns).where(and(...conditions)).orderBy(desc(warehouseReturns.createdAt))
    : db.select().from(warehouseReturns).orderBy(desc(warehouseReturns.createdAt));
}

// ── مصادر الإرجاع المحتملة لصنف معيّن: كل عمليات الاستلام (dobre "in"/"purchase")
//   السابقة لهذا الصنف، مع الكمية المستلمة والمُرجَعة سابقاً لكل سند. نستخدم
//   LEFT JOIN عمداً (لا INNER) لأن الاستلام قد يكون مستقلاً بلا طلب شراء (0035)
//   — في هذي الحالة purchaseOrderId/vendorName من الطلب تكون NULL وهذا متوقَّع.
//   لا نحسب "الكمية المتاحة لهذا السند تحديداً" لأن النظام لا يدعم تتبّع دفعات
//   (Batch/Lot) فعلياً؛ الرصيد الحقيقي القابل للإرجاع هو رصيد المخزون الكلي فقط،
//   ونعرض هنا فقط "الكمية المستلمة" و"المُرجَع سابقاً ضد هذا السند تحديداً"
//   كمعلومة استرشادية للموظف لا كحد ملزم.
export async function getReturnSources(inventoryId: number) {
  const db = await getDb();
  if (!db) return [];

  const receiveRows = await db
    .select({
      receiptId:           inventoryTransactions.receiptId,
      purchaseOrderItemId: inventoryTransactions.purchaseOrderItemId,
      receivedQty:         inventoryTransactions.quantity,
      receiptNumber:       warehouseReceipts.receiptNumber,
      invoiceNumber:       warehouseReceipts.invoiceNumber,
      receiptDate:         warehouseReceipts.invoiceDate,
      receiptCreatedAt:    warehouseReceipts.createdAt,
      vendorName:          warehouseReceipts.vendorName,
      purchaseOrderId:     warehouseReceipts.purchaseOrderId,
      poNumber:            purchaseOrders.poNumber,
    })
    .from(inventoryTransactions)
    .leftJoin(warehouseReceipts, eq(inventoryTransactions.receiptId, warehouseReceipts.id))
    .leftJoin(purchaseOrders, eq(warehouseReceipts.purchaseOrderId, purchaseOrders.id))
    .where(and(
      eq(inventoryTransactions.inventoryId, inventoryId),
      eq(inventoryTransactions.type, "in"),
      eq(inventoryTransactions.transactionType, "purchase"),
      isNotNull(inventoryTransactions.receiptId),
    ))
    .orderBy(desc(warehouseReceipts.createdAt));

  if (receiveRows.length === 0) return [];

  // مجموع ما أُرجع سابقاً ضد كل receiptId (من حركات type=out, transactionType=return)
  const returnRows = await db
    .select({
      receiptId: inventoryTransactions.receiptId,
      quantity:  inventoryTransactions.quantity,
    })
    .from(inventoryTransactions)
    .where(and(
      eq(inventoryTransactions.inventoryId, inventoryId),
      eq(inventoryTransactions.type, "out"),
      eq(inventoryTransactions.transactionType, "return"),
      isNotNull(inventoryTransactions.receiptId),
    ));

  const returnedByReceipt = new Map<number, number>();
  for (const r of returnRows) {
    if (!r.receiptId) continue;
    returnedByReceipt.set(r.receiptId, (returnedByReceipt.get(r.receiptId) || 0) + r.quantity);
  }

  // دمج الأسطر بحسب receiptId (قد يكون فيه أكثر من بند بنفس السند لنفس الصنف نادراً)
  const byReceipt = new Map<number, any>();
  for (const row of receiveRows) {
    if (!row.receiptId) continue;
    const existing = byReceipt.get(row.receiptId);
    if (existing) {
      existing.receivedQty += row.receivedQty;
    } else {
      byReceipt.set(row.receiptId, {
        receiptId:           row.receiptId,
        purchaseOrderId:     row.purchaseOrderId ?? null,
        purchaseOrderItemId: row.purchaseOrderItemId ?? null,
        receiptNumber:       row.receiptNumber,
        invoiceNumber:       row.invoiceNumber ?? null,
        receiptDate:         row.receiptDate ?? row.receiptCreatedAt,
        vendorName:          row.vendorName ?? null,
        poNumber:            row.poNumber ?? null,
        receivedQty:         row.receivedQty,
      });
    }
  }

  return Array.from(byReceipt.values()).map(s => ({
    ...s,
    returnedQty: returnedByReceipt.get(s.receiptId) || 0,
  }));
}

export async function getInventoryTransactions(inventoryId?: number) {
  const db = await getDb();
  if (!db) return [];
  return inventoryId
    ? db.select().from(inventoryTransactions).where(eq(inventoryTransactions.inventoryId, inventoryId)).orderBy(desc(inventoryTransactions.createdAt))
    : db.select().from(inventoryTransactions).orderBy(desc(inventoryTransactions.createdAt));
}

// ── سجل التوريد لصنف معيّن: كل فاتورة دخل منها هذا الصنف ─────────────────
// المرجع الصحيح هو inventory_transactions (وليس receiptId الثابت في inventory)
// لأن الصنف الواحد قد يتوارد من عدة فواتير عبر الزمن (مرتبط عبر "ربط بصنف موجود")
export async function getInventoryPurchaseHistory(inventoryId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select({
      transactionId: inventoryTransactions.id,
      quantity:      inventoryTransactions.quantity,
      unitCost:      inventoryTransactions.unitCost,
      createdAt:     inventoryTransactions.createdAt,
      receiptId:     inventoryTransactions.receiptId,
      receiptNumber: warehouseReceipts.receiptNumber,
      invoiceNumber: warehouseReceipts.invoiceNumber,
      invoiceDate:   warehouseReceipts.invoiceDate,
      vendorName:    warehouseReceipts.vendorName,
      purchaseOrderId: warehouseReceipts.purchaseOrderId,
      poNumber:      purchaseOrders.poNumber,
    })
    .from(inventoryTransactions)
    .leftJoin(warehouseReceipts, eq(inventoryTransactions.receiptId, warehouseReceipts.id))
    .leftJoin(purchaseOrders, eq(warehouseReceipts.purchaseOrderId, purchaseOrders.id))
    .where(and(
      eq(inventoryTransactions.inventoryId, inventoryId),
      eq(inventoryTransactions.type, "in"),
      eq(inventoryTransactions.transactionType, "purchase"),
    ))
    .orderBy(desc(inventoryTransactions.createdAt));
}

// ── Phase 2C: سجل الحركة الكامل لصنف معيّن — كشف حساب بنكي ──────────────
// المرجع enum ثابت من الآن، يستوعب كل أنواع الحركات المستقبلية (تحويل/استبعاد)
// بدون الحاجة لإعادة بناء الجدول لاحقاً — فقط تُعبّأ القيمة عند توفرها
export async function getInventoryLedger(inventoryId: number) {
  const db = await getDb();
  if (!db) return [];

  const transactions = await db
    .select()
    .from(inventoryTransactions)
    .where(eq(inventoryTransactions.inventoryId, inventoryId))
    .orderBy(asc(inventoryTransactions.createdAt));

  if (transactions.length === 0) return [];

  // مراجع التوريد (receiptNumber) لكل معاملات الشراء دفعة واحدة
  const receiptIds = transactions.map(t => t.receiptId).filter((id): id is number => !!id);
  const receiptsMap = new Map<number, string>();
  if (receiptIds.length > 0) {
    const receipts = await db
      .select({ id: warehouseReceipts.id, receiptNumber: warehouseReceipts.receiptNumber })
      .from(warehouseReceipts)
      .where(inArray(warehouseReceipts.id, receiptIds));
    for (const r of receipts) receiptsMap.set(r.id, r.receiptNumber);
  }

  // مراجع الصرف (deliveryNumber) — الربط عبر purchaseOrderItemId (poItemId بجدول deliveryDocuments)
  const poItemIds = transactions
    .filter(t => t.type === "out" && t.purchaseOrderItemId)
    .map(t => t.purchaseOrderItemId!) as number[];
  const deliveryMap = new Map<number, string>();
  if (poItemIds.length > 0) {
    const deliveries = await db
      .select({ poItemId: deliveryDocuments.poItemId, deliveryNumber: deliveryDocuments.deliveryNumber })
      .from(deliveryDocuments)
      .where(inArray(deliveryDocuments.poItemId, poItemIds));
    for (const d of deliveries) deliveryMap.set(d.poItemId, d.deliveryNumber);
  }

  // حساب الرصيد التراكمي بعد كل حركة (بترتيب زمني تصاعدي)
  let runningBalance = 0;
  const ledger = transactions.map(tx => {
    const inQty  = tx.type === "in"  ? tx.quantity : 0;
    const outQty = tx.type === "out" ? tx.quantity : 0;
    runningBalance += inQty - outQty;

    // تحديد المرجع حسب نوع الحركة — enum ثابت يستوعب التحويل والاستبعاد مستقبلاً بدون تعديل بنيوي
    let reference: string | null = null;
    if (tx.transactionType === "purchase" && tx.receiptId) {
      reference = receiptsMap.get(tx.receiptId) ?? null;
    } else if (tx.transactionType === "delivery") {
      // المصدر الموثوق: رقم السند المخزَّن مباشرة على الحركة (منذ توحيد خدمة الصرف issueDelivery)
      // مع fallback للحركات القديمة السابقة لهذا التوحيد، عبر الربط غير المباشر بطلب الشراء
      reference = tx.documentUrl ?? (tx.purchaseOrderItemId ? deliveryMap.get(tx.purchaseOrderItemId) ?? null : null);
    } else if (tx.transactionType === "disposal") {
      // رقم عملية الاستبعاد محفوظ مباشرة على الحركة في حقل documentUrl (DO-YYYY-NNNNNN)
      reference = tx.documentUrl ?? null;
    }
    // transactionType === "return" أو "adjustment" (تحويل/جرد مستقبلاً): لا مرجع بعد

    return {
      transactionId:   tx.id,
      createdAt:        tx.createdAt,
      type:             tx.type,                 // "in" | "out"
      transactionType:  tx.transactionType,       // "purchase" | "return" | "delivery" | "adjustment"
      inQty,
      outQty,
      balanceAfter:     runningBalance,
      reference,                                   // null = "غير متاح بعد"
      reason:           tx.reason,
    };
  });

  return ledger.reverse(); // الأحدث أولاً للعرض
}

// ── Delivery Documents ─────────────────────────────────────────────────────

export async function createDeliveryDocument(data: {
  deliveryNumber: string;
  poItemId: number;
  itemName: string;
  deliveredByName: string;
  deliveredToName: string;
  quantity: number;
  unit?: string;
  supplierName?: string;
  actualUnitCost?: string;
  poNumber?: string;
  warehousePhotoUrl?: string;
  notes?: string;
  pdfKey?: string;
  pdfUrl?: string;
}) {
  const db = await getDb();
  if (!db) return null;
  const [result] = await db.insert(deliveryDocuments).values(data);
  return result;
}

// ── Return Documents — وثيقة مرتجع تلقائية (0037) ────────────────────────
export async function createReturnDocument(data: {
  returnNumber:     string;
  returnId:         number;
  itemName:         string;
  internalCode?:    string;
  manufacturerBarcode?: string;
  returnedQuantity: number;
  unit?:            string;
  reason:           string;
  returnedByName:   string;
  recipientName?:   string;
  receiptNumber?:   string;
  invoiceNumber?:   string;
  vendorName?:      string;
  poNumber?:        string;
}, tx?: any) {
  const db = tx || await getDb();
  if (!db) return null;
  await db.insert(returnDocuments).values(data as any);
}

export async function getReturnDocuments() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(returnDocuments).orderBy(desc(returnDocuments.createdAt));
}

export async function incrementReturnDocPrintCount(id: number) {
  const db = await getDb();
  if (!db) return 0;
  const row = await db.select({ printCount: returnDocuments.printCount }).from(returnDocuments).where(eq(returnDocuments.id, id)).limit(1);
  const newCount = (row[0]?.printCount || 0) + 1;
  await db.update(returnDocuments).set({ printCount: newCount }).where(eq(returnDocuments.id, id));
  return newCount;
}

// ═══════════════════════════════════════════════════════════════
// خدمة موحّدة لدورة سند الصرف (Delivery Document Flow)
// كل مسار صرف (سواء من دورة الشراء أو من المخزون مباشرة) يستدعي
// هذه الدالة الواحدة، فيضمن: توليد رقم + تسجيل حركة + إنشاء سند
// رسمي بجدول delivery_documents — بدون اعتماد على أن تتذكر
// الواجهة استدعاء createDeliveryDocument بشكل منفصل.
// ═══════════════════════════════════════════════════════════════
export async function issueDelivery(params: {
  inventoryId:          number;
  quantity:              number;
  unit?:                 string;
  performedById:         number;       // المستخدم المسلِّم (يُجلب اسمه هنا، لا يُمرَّر من الواجهة)
  deliveredToId?:        number;       // الفني/الطالب المُستلِم (اختياري — موجود غالباً)
  purchaseOrderItemId?:  number;       // إن وُجد، يُربط بطلب الشراء وسنده
  notes?:                string;
  warehousePhotoUrl?:    string;
}) {
  const db = await getDb();
  if (!db) throw new Error("تعذر الاتصال بقاعدة البيانات");

  // 1) تنفيذ عملية الصرف الفعلية (خصم الرصيد + تسجيل الحركة في inventory_transactions)
  const item = await getInventoryItemById(params.inventoryId);
  if (!item) throw new Error("الصنف غير موجود في المخزون");
  if (params.quantity > (item.quantity || 0)) {
    throw new Error(`الكمية المطلوبة (${params.quantity}) أكبر من الرصيد المتاح (${item.quantity})`);
  }

  // 2) توليد رقم السند — مرجع واحد يُستخدم بكل الخطوات التالية
  const deliveryNumber = await getNextDeliveryNumber();

  await addInventoryTransactionV2({
    inventoryId:          params.inventoryId,
    type:                 "out",
    quantity:              params.quantity,
    reason:                params.notes || "تسليم من المخزون",
    purchaseOrderItemId:   params.purchaseOrderItemId,
    performedById:         params.performedById,
    transactionType:       "delivery",
    documentUrl:           deliveryNumber, // ربط الحركة برقم السند مباشرة — يُستخدم لاحقاً في سجل الحركة كمرجع موثوق
  });

  // 3) جلب أسماء المُسلِّم والمُستلِم من قاعدة البيانات (وليس من مدخلات الواجهة، لضمان الدقة)
  const performer = await getUserById(params.performedById);
  const receiver  = params.deliveredToId ? await getUserById(params.deliveredToId) : null;

  // جلب بيانات طلب الشراء المرتبط إن وُجد (المورد، رقم الطلب)
  let poNumber: string | undefined;
  let supplierName: string | undefined;
  let actualUnitCost: string | undefined;
  if (params.purchaseOrderItemId) {
    const poItem = await getPOItemById(params.purchaseOrderItemId);
    if (poItem) {
      supplierName   = (poItem as any).supplierName;
      actualUnitCost = (poItem as any).actualUnitCost;
      const po = await getPurchaseOrderById((poItem as any).purchaseOrderId);
      poNumber = (po as any)?.poNumber;
    }
  }

  // 4) إنشاء السند الرسمي بجدول delivery_documents — مضمون الحدوث دائماً مع كل عملية صرف
  await createDeliveryDocument({
    deliveryNumber,
    poItemId:          params.purchaseOrderItemId ?? 0,
    itemName:           item.itemName,
    deliveredByName:    (performer as any)?.name || "مستخدم المستودع",
    deliveredToName:    (receiver as any)?.name || "غير محدد",
    quantity:            params.quantity,
    unit:                params.unit || item.unit || undefined,
    supplierName,
    actualUnitCost,
    poNumber,
    warehousePhotoUrl:   params.warehousePhotoUrl,
    notes:               params.notes,
  });

  // 5) إتاحة طباعة PDF — الرقم والبيانات جاهزة للواجهة لتوليد الوثيقة وحفظ رابطها لاحقاً عبر updateDeliveryDocumentPdf
  return {
    deliveryNumber,
    itemName:         item.itemName,
    deliveredByName:  (performer as any)?.name || "مستخدم المستودع",
    deliveredToName:  (receiver as any)?.name || "غير محدد",
    quantity:          params.quantity,
    unit:              params.unit || item.unit || "",
    supplierName,
    actualUnitCost,
    poNumber,
    deliveredAt:       new Date().toLocaleDateString("ar-SA", { year: "numeric", month: "long", day: "numeric" }),
  };
}

export async function updateDeliveryDocumentPdf(id: number, pdfKey: string, pdfUrl: string) {
  const db = await getDb();
  if (!db) return;
  await db.update(deliveryDocuments).set({ pdfKey, pdfUrl }).where(eq(deliveryDocuments.id, id));
}

export async function incrementDeliveryDocPrintCount(id: number) {
  const db = await getDb();
  if (!db) return;
  await db.update(deliveryDocuments)
    .set({ printCount: sql`${deliveryDocuments.printCount} + 1` })
    .where(eq(deliveryDocuments.id, id));
  const rows = await db.select({ printCount: deliveryDocuments.printCount })
    .from(deliveryDocuments).where(eq(deliveryDocuments.id, id)).limit(1);
  return rows[0]?.printCount ?? 1;
}

export async function getDeliveryDocuments() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(deliveryDocuments).orderBy(desc(deliveryDocuments.createdAt));
}

// الاستيرادات المطلوبة موجودة مسبقاً في db.ts

// ─────────────────────────────────────────────────────────────
// OCR JOBS
// ─────────────────────────────────────────────────────────────

export async function createOcrJob(data: {
  receiptId?:       number;
  purchaseOrderId?: number;
  imageUrl:         string;
  createdById:      number;
  status:           string;
}) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.insert(ocrJobs).values({
    ...data,
    status: data.status as any,
  });
  return result[0].insertId;
}

export async function updateOcrJob(id: number, data: {
  status?:        string;
  receiptId?:     number;
  rawResponse?:   string;
  extractedData?: any;
  confidence?:    number;
  errorMessage?:  string;
  processingMs?:  number;
  completedAt?:   Date;
}) {
  const db = await getDb();
  if (!db) return;
  await db.update(ocrJobs).set(data as any).where(eq(ocrJobs.id, id));
}

// ─────────────────────────────────────────────────────────────
// INVENTORY V2 - إنشاء وتحديث مع الحقول الجديدة
// ─────────────────────────────────────────────────────────────

export async function createInventoryItemV2(data: {
  itemName:           string;
  itemName_ar?:       string;
  itemName_en?:       string;
  itemType?:          string;
  quantity:           number;
  unit?:              string;
  purchaseUnit?:      string;
  issueUnit?:         string;
  conversionFactor?:  string;
  minQuantity?:       number;
  averageCost?:       string;
  totalCostValue?:    string;
  internalCode?:      string;
  manufacturerBarcode?: string;
  expiryDate?:        Date;
  linkedItemId?:      number;
  assetId?:           number;
  warehouseId?:       number;
  receiptId?:         number;
  siteId?:            number;
}, tx?: any) {
  const db = tx || await getDb();
  if (!db) return null;
  const result = await db.insert(inventory).values(data as any);
  return result[0].insertId;
}

export async function updateInventoryItemV2(id: number, data: {
  lastRestockedAt?: Date;
  averageCost?:     string;
  totalCostValue?:  string;
  linkedItemId?:    number;
  itemName_ar?:     string;
  itemName_en?:     string;
  itemType?:        string;
  expiryDate?:      Date;
  manufacturerBarcode?: string;
}, tx?: any) {
  const db = tx || await getDb();
  if (!db) return;
  await db.update(inventory).set(data as any).where(eq(inventory.id, id));
}

// ─────────────────────────────────────────────────────────────
// INVENTORY TRANSACTIONS V2
// ─────────────────────────────────────────────────────────────

export async function addInventoryTransactionV2(data: {
  inventoryId:          number;
  type:                 "in" | "out";
  quantity:             number;
  unitCost?:            string;
  totalCost?:           string;
  reason?:              string;
  ticketId?:            number;
  purchaseOrderItemId?: number;
  performedById:        number;
  transactionType?:     string;
  receiptId?:           number;
  returnId?:            number;
  projectId?:           number;
  departmentId?:        number;
  assetId?:             number;
  documentUrl?:         string;
  invoiceNumber?:       string;
}, tx?: any) {
  const db = tx || await getDb();
  if (!db) return;

  // إدراج الحركة
  await db.insert(inventoryTransactions).values(data as any);

  // تحديث رصيد المخزون
  const item = await db.select().from(inventory).where(eq(inventory.id, data.inventoryId)).limit(1);
  if (item[0]) {
    const currentQty = item[0].quantity || 0;
    const newQty = data.type === "in"
      ? currentQty + data.quantity
      : Math.max(0, currentQty - data.quantity);

    const newTotalValue = newQty * parseFloat((item[0] as any).averageCost || "0");

    await db.update(inventory).set({
      quantity:       newQty,
      totalCostValue: newTotalValue.toFixed(2),
    } as any).where(eq(inventory.id, data.inventoryId));
  }
}

// ─────────────────────────────────────────────────────────────
// WAREHOUSE RECEIPTS V2
// ─────────────────────────────────────────────────────────────

export async function createWarehouseReceiptV2(data: {
  receiptNumber:    string;
  purchaseOrderId?: number; // اختياري: غير موجود = استلام مستقل بلا طلب شراء
  receivedById:     number;
  notes?:           string;
  totalItems?:      number;
  status?:          string;
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
}, tx?: any) {
  const db = tx || await getDb();
  if (!db) return null;
  const result = await db.insert(warehouseReceipts).values(data as any);
  return result[0].insertId;
}

export async function createWarehouseReceiptItem(data: {
  receiptId:            number;
  inventoryId?:         number;
  purchaseOrderItemId?: number;
  itemName:             string;
  itemName_ar?:         string;
  itemName_en?:         string;
  receivedQuantity:     string;
  purchaseUnit?:        string;
  unitCost:             string;
  taxRate?:             string;
  taxAmount?:           string;
  lineTotal?:           string;
  expectedQuantity?:    string;
  quantityDiff?:        string;
  expectedUnitCost?:    string;
  priceDiff?:           string;
  ocrExtracted?:        boolean;
  manuallyEdited?:      boolean;
}, tx?: any) {
  const db = tx || await getDb();
  if (!db) return null;
  const result = await db.insert(warehouseReceiptItems).values(data as any);
  return result[0].insertId;
}

export async function getWarehouseReceiptWithItems(id: number) {
  const db = await getDb();
  if (!db) return null;
  const receipt = await db.select().from(warehouseReceipts).where(eq(warehouseReceipts.id, id)).limit(1);
  if (!receipt[0]) return null;
  const items = await db.select().from(warehouseReceiptItems)
    .where(eq(warehouseReceiptItems.receiptId, id))
    .orderBy(warehouseReceiptItems.id);
  return { ...receipt[0], items };
}

export async function listWarehouseReceiptsV2(input?: {
  purchaseOrderId?: number;
  limit?:           number;
  offset?:          number;
}) {
  const db = await getDb();
  if (!db) return [];
  let query = db.select().from(warehouseReceipts).orderBy(desc(warehouseReceipts.createdAt));
  if (input?.purchaseOrderId) {
    query = query.where(eq(warehouseReceipts.purchaseOrderId, input.purchaseOrderId)) as any;
  }
  return query.limit(input?.limit || 50).offset(input?.offset || 0);
}

// ─────────────────────────────────────────────────────────────
// كشف الفاتورة المكررة
// ─────────────────────────────────────────────────────────────

export async function checkDuplicateInvoice(data: {
  invoiceNumber:    string;
  vendorTaxNumber?: string;
}) {
  const db = await getDb();
  if (!db) return null;
  if (!data.invoiceNumber?.trim()) return null;

  // نطابق برقم الفاتورة، ونضيّق بالرقم الضريبي للمورد إن وُجد لتفادي
  // تصادم رقم فاتورة متطابق صدفة من مورّدين مختلفين
  const conditions = [eq(warehouseReceipts.invoiceNumber, data.invoiceNumber)];
  if (data.vendorTaxNumber?.trim()) {
    conditions.push(eq(warehouseReceipts.vendorTaxNumber, data.vendorTaxNumber));
  }

  const rows = await db.select({
    id:            warehouseReceipts.id,
    receiptNumber: warehouseReceipts.receiptNumber,
    invoiceNumber: warehouseReceipts.invoiceNumber,
    createdAt:     warehouseReceipts.createdAt,
  })
    .from(warehouseReceipts)
    .where(and(...conditions))
    .limit(1);

  return rows[0] || null;
}

// ─────────────────────────────────────────────────────────────
// البحث عن أصناف مشابهة (للكشف عن المكرر عند الإدخال)
// ─────────────────────────────────────────────────────────────

export async function findSimilarInventoryItems(itemName: string) {
  const db = await getDb();
  if (!db) return [];

  // استخراج الكلمات الرئيسية (أول 3 كلمات)
  const keywords = itemName.trim().split(/\s+/).slice(0, 3);

  const results = await db.select({
    id:                  inventory.id,
    itemName:            inventory.itemName,
    internalCode:        inventory.internalCode,
    quantity:            inventory.quantity,
    unit:                inventory.unit,
    manufacturerBarcode: inventory.manufacturerBarcode,
  })
    .from(inventory)
    .where(
      or(
        like(inventory.itemName, `%${keywords[0]}%`),
        like(inventory.itemName, `%${itemName.substring(0, 10)}%`),
      )
    )
    .orderBy(desc(inventory.updatedAt))
    .limit(5);

  return results;
}

// ─────────────────────────────────────────────────────────────
// تقرير قيمة المخزون الكلية (للوحة التحكم)
// ─────────────────────────────────────────────────────────────

export async function getInventoryTotalValue() {
  const db = await getDb();
  if (!db) return { totalValue: 0, totalItems: 0, lowStockCount: 0 };

  const allItems = await db.select({
    quantity:       inventory.quantity,
    minQuantity:    inventory.minQuantity,
    averageCost:    (inventory as any).averageCost,
    totalCostValue: (inventory as any).totalCostValue,
  }).from(inventory);

  const totalValue = allItems.reduce((sum, i) =>
    sum + parseFloat((i as any).totalCostValue || "0"), 0);

  const lowStockCount = allItems.filter(i =>
    (i.minQuantity || 0) > 0 && i.quantity <= (i.minQuantity || 0)
  ).length;

  return {
    totalValue:    Math.round(totalValue * 100) / 100,
    totalItems:    allItems.length,
    lowStockCount,
  };
}

export async function getLowStockInventoryItems() {
  const db = await getDb();
  if (!db) return [];
  const items = await db.select().from(inventory).orderBy(desc(inventory.updatedAt));
  return items.filter((i: any) => (i.minQuantity || 0) > 0 && i.quantity <= (i.minQuantity || 0));
}

// ============================================================
// INVOICE DRAFT V2 - مسودة الفاتورة والاعتماد
// ============================================================

// ─────────────────────────────────────────────────────────────
// WAREHOUSE RECEIPTS V2 - مع حقول الفاتورة الكاملة
// ─────────────────────────────────────────────────────────────


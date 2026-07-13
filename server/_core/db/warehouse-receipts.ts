// ============================================================
// db/warehouse-receipts.ts — استلامات المستودع
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

export async function getNextReceiptNumber(tx?: any): Promise<string> {
  const db = tx || await getDb();
  if (!db) return `RCV-${new Date().getFullYear()}-0001`;
  const year = new Date().getFullYear();
  const rows = await db.select({ id: warehouseReceipts.id })
    .from(warehouseReceipts)
    .where(like(warehouseReceipts.receiptNumber, `RCV-${year}-%`))
    .orderBy(desc(warehouseReceipts.id))
    .limit(1);
  const next = rows.length > 0
    ? parseInt(rows[0].id.toString()) + 1
    : 1;
  return `RCV-${year}-${String(next).padStart(4, "0")}`;
}

export async function getNextInventoryCode(tx?: any): Promise<string> {
  const db = tx || await getDb();
  if (!db) return `INV-${new Date().getFullYear()}-0001`;
  const year = new Date().getFullYear();
  const rows = await db.select({ id: inventory.id })
    .from(inventory)
    .where(like(inventory.internalCode, `INV-${year}-%`))
    .orderBy(desc(inventory.id))
    .limit(1);
  const next = rows.length > 0
    ? parseInt(rows[0].id.toString()) + 1
    : 1;
  return `INV-${year}-${String(next).padStart(4, "0")}`;
}

// ─────────────────────────────────────────────────────────────
// توليد رقم صنف فريد بصيغة السنة + تسلسل (مثل 20261، 20262)
// لا يتكرر حتى لو حُذف الصنف
// ─────────────────────────────────────────────────────────────
// توليد أرقام باركود فريدة باستخدام AUTO_INCREMENT في قاعدة البيانات
// يضمن عدم التكرار حتى مع عدة مستخدمين في نفس الوقت
export async function getNextItemBarcodes(count: number): Promise<string[]> {
  const db = await getDb();
  const year = new Date().getFullYear();
  if (!db) return Array.from({ length: count }, (_, i) => `${year}${i + 1}`);

  const barcodes: string[] = [];
  for (let i = 0; i < count; i++) {
    const [result] = await db.insert(itemBarcodeCounter).values({ year });
    const seq = (result as any).insertId as number;
    barcodes.push(`${year}${seq}`);
  }
  return barcodes;
}

export async function getNextItemBarcode(): Promise<string> {
  const result = await getNextItemBarcodes(1);
  return result[0];
}

export async function getNextDeliveryNumber(): Promise<string> {
  const db = await getDb();
  const year = new Date().getFullYear();
  if (!db) return `DLV-${year}-0001`;
  // نُدرج سجلاً جديداً في جدول العداد — قاعدة البيانات تضمن AUTO_INCREMENT فريداً حتى مع الطلبات المتزامنة
  const [result] = await db.insert(deliveryNumberCounter).values({ year });
  const seq = (result as any).insertId as number;
  return `DLV-${year}-${String(seq).padStart(4, "0")}`;
}

// ═══════════════════════════════════════════════════════════════
// عمليات الاستبعاد — Disposal Operations
// النمط المعماري: عملية → مستند → تفاصيل → خدمة تنفيذ → حركات → رصيد
// ═══════════════════════════════════════════════════════════════

// 1) توليد رقم عملية الاستبعاد التسلسلي (atomic — آمن مع الطلبات المتزامنة)
export async function generateDisposalNumber(): Promise<string> {
  const db = await getDb();
  const year = new Date().getFullYear();
  if (!db) return `DO-${year}-000001`;
  const [result] = await db.insert(disposalNumberCounter).values({ year });
  const seq = (result as any).insertId as number;
  return `DO-${year}-${String(seq).padStart(6, "0")}`;
}

// 2) تنفيذ حركات المخزون الفعلية لعملية استبعاد موجودة بالقاعدة
// تستقبل رقم العملية فقط — مصدر الحقيقة القاعدة وليس الواجهة
export async function issueDisposal(disposalOperationId: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("تعذر الاتصال بقاعدة البيانات");

  // قراءة تفاصيل الأصناف من القاعدة مباشرة
  const items = await db
    .select()
    .from(disposalItems)
    .where(eq(disposalItems.operationId, disposalOperationId));

  if (items.length === 0) throw new Error("لا توجد أصناف مرتبطة بهذه العملية");

  const op = await db
    .select()
    .from(disposalOperations)
    .where(eq(disposalOperations.id, disposalOperationId))
    .limit(1);

  if (!op[0]) throw new Error("عملية الاستبعاد غير موجودة");

  for (const item of items) {
    // التحقق من الرصيد الكافي
    const invRows = await db
      .select()
      .from(inventory)
      .where(eq(inventory.id, item.inventoryId))
      .limit(1);

    const inv = invRows[0];
    if (!inv) throw new Error(`الصنف رقم ${item.inventoryId} غير موجود في المخزون`);

    const qty = parseFloat(item.quantity);
    if (qty > inv.quantity) {
      throw new Error(`الكمية المطلوب استبعادها (${qty}) أكبر من الرصيد المتاح (${inv.quantity}) للصنف "${inv.itemName}"`);
    }

    // خصم الرصيد
    await db
      .update(inventory)
      .set({
        quantity: inv.quantity - qty,
        updatedAt: new Date(),
      })
      .where(eq(inventory.id, item.inventoryId));

    // تسجيل حركة المخزون
    await db.insert(inventoryTransactions).values({
      inventoryId:     item.inventoryId,
      type:            "out",
      quantity:        Math.round(qty),
      reason:          item.notes || `استبعاد — ${item.reason}`,
      performedById:   op[0].createdBy,
      transactionType: "disposal",
      documentUrl:     op[0].operationNumber, // المرجع المباشر في سجل الحركة
      unitCost:        item.unitCost,
      totalCost:       item.totalCost,
    });
  }
}

// 3) إنشاء عملية استبعاد كاملة داخل Transaction واحدة
export async function createDisposal(params: {
  operationDate:  string;
  warehouseId?:   number;
  notes?:         string;
  createdBy:      number;
  items: Array<{
    inventoryId:  number;
    quantity:     number;
    reason:       "damaged" | "expired" | "missing" | "other";
    unitCost:     number;
    totalCost:    number;
    attachments?: any;
    notes?:       string;
  }>;
}) {
  const db = await getDb();
  if (!db) throw new Error("تعذر الاتصال بقاعدة البيانات");

  // توليد رقم العملية
  const operationNumber = await generateDisposalNumber();

  // إنشاء المستند الرئيسي
  const [opResult] = await db.insert(disposalOperations).values({
    operationNumber,
    operationDate: new Date(params.operationDate),
    warehouseId:   params.warehouseId,
    status:        "COMPLETED",
    notes:         params.notes,
    createdBy:     params.createdBy,
  });

  const disposalOperationId = (opResult as any).insertId as number;

  // إنشاء تفاصيل الأصناف
  for (const item of params.items) {
    await db.insert(disposalItems).values({
      operationId:  disposalOperationId,
      inventoryId:  item.inventoryId,
      quantity:     String(item.quantity),
      reason:       item.reason,
      unitCost:     String(item.unitCost),
      totalCost:    String(item.totalCost),
      attachments:  item.attachments ?? null,
      notes:        item.notes,
    });
  }

  // تنفيذ الحركات المخزنية — تقرأ من القاعدة مباشرة (مصدر الحقيقة)
  await issueDisposal(disposalOperationId);

  return { disposalOperationId, operationNumber };
}

// 4) قائمة عمليات الاستبعاد للجدول الرئيسي
export async function listDisposalOperations() {
  const db = await getDb();
  if (!db) return [];

  const ops = await db
    .select()
    .from(disposalOperations)
    .orderBy(desc(disposalOperations.createdAt));

  // إحضار إجمالي الأصناف والكمية والقيمة لكل عملية
  const result = await Promise.all(ops.map(async (op) => {
    const items = await db
      .select()
      .from(disposalItems)
      .where(eq(disposalItems.operationId, op.id));

    const totalItems    = items.length;
    const totalQuantity = items.reduce((s, i) => s + parseFloat(i.quantity), 0);
    const totalValue    = items.reduce((s, i) => s + parseFloat(i.totalCost), 0);

    const creator = await getUserById(op.createdBy);

    return {
      ...op,
      totalItems,
      totalQuantity,
      totalValue,
      creatorName: (creator as any)?.name || "—",
    };
  }));

  return result;
}

// 5) تفاصيل عملية استبعاد واحدة (getById)
export async function getDisposalById(id: number) {
  const db = await getDb();
  if (!db) return null;

  const opRows = await db
    .select()
    .from(disposalOperations)
    .where(eq(disposalOperations.id, id))
    .limit(1);

  if (!opRows[0]) return null;

  const items = await db
    .select()
    .from(disposalItems)
    .where(eq(disposalItems.operationId, id));

  // إضافة اسم الصنف لكل بند
  const itemsWithNames = await Promise.all(items.map(async (item) => {
    const inv = await getInventoryItemById(item.inventoryId);
    return {
      ...item,
      itemName: (inv as any)?.itemName || "—",
      unit:     (inv as any)?.unit || "",
    };
  }));

  const creator = await getUserById(opRows[0].createdBy);

  return {
    ...opRows[0],
    creatorName: (creator as any)?.name || "—",
    items: itemsWithNames,
  };
}

export async function getNextReturnNumber(): Promise<string> {
  const db = await getDb();
  if (!db) return `RTN-${new Date().getFullYear()}-0001`;
  const year = new Date().getFullYear();
  const rows = await db.select({ id: warehouseReturns.id })
    .from(warehouseReturns)
    .where(like(warehouseReturns.returnNumber, `RTN-${year}-%`))
    .orderBy(desc(warehouseReturns.id))
    .limit(1);
  const next = rows.length > 0
    ? parseInt(rows[0].id.toString()) + 1
    : 1;
  return `RTN-${year}-${String(next).padStart(4, "0")}`;
}

export async function createWarehouseReceipt(data: InsertWarehouseReceipt) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.insert(warehouseReceipts).values(data);
  return result[0].insertId;
}

export async function getWarehouseReceiptById(id: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(warehouseReceipts).where(eq(warehouseReceipts.id, id)).limit(1);
  return rows[0] || null;
}

export async function getWarehouseReceiptByPO(purchaseOrderId: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(warehouseReceipts)
    .where(eq(warehouseReceipts.purchaseOrderId, purchaseOrderId))
    .orderBy(desc(warehouseReceipts.createdAt));
  return rows;
}

export async function listWarehouseReceipts() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(warehouseReceipts).orderBy(desc(warehouseReceipts.createdAt));
}

// ============================================================
// INVENTORY BARCODE SEARCH
// ============================================================


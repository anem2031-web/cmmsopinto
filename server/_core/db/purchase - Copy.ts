// ============================================================
// db/purchase.ts — المشتريات: أوامر الشراء وبنودها ودفعات التسعير وتعليقاتها
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

// ============================================================
// PROCUREMENT COMMENT OPERATIONS
// ============================================================
export async function createProcurementComment(data: InsertProcurementComment) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.insert(procurementComments).values(data);
  return result[0].insertId;
}

export async function getProcurementComments(purchaseOrderId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(procurementComments)
    .where(eq(procurementComments.purchaseOrderId, purchaseOrderId))
    .orderBy(asc(procurementComments.createdAt));
}

export async function getUsersByRole(role: string) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(users).where(eq(users.role, role as any));
}

/**
 * Returns all users who should receive "manager-level" notifications:
 * maintenance_manager + owner + admin roles.
 * This ensures admins/owners always receive operational alerts.
 */
export async function getManagerUsers() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(users).where(
    inArray(users.role, ["maintenance_manager", "owner", "admin"] as any[])
  );
}

// ── أرجاع IDs كل المستخدمين بدور معيّن — تُستخدم لفلترة الطلبات حسب من أنشأها ──
export async function getUserIdsByRole(role: string): Promise<number[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select({ id: users.id }).from(users).where(eq(users.role, role as any));
  return rows.map(r => r.id);
}

export async function updateUserRole(userId: number, role: string) {
  const db = await getDb();
  if (!db) return;
  await db.update(users).set({ role: role as any }).where(eq(users.id, userId));
}

// ============================================================
// PURCHASE ORDERS
// ============================================================
export async function getNextPONumber() {
  const db = await getDb();
  if (!db) return "PR-2026-0001";
  const year = new Date().getFullYear();
  const prefix = `PR-${year}-`;
  // جلب آخر رقم طلب في هذه السنة بدلاً من عد الكل — يمنع التكرار عند الحذف أو التزامن
  const result = await db
    .select({ poNumber: purchaseOrders.poNumber })
    .from(purchaseOrders)
    .where(like(purchaseOrders.poNumber, `${prefix}%`))
    .orderBy(desc(purchaseOrders.id))
    .limit(1);
  if (!result[0]?.poNumber) return `${prefix}0001`;
  const lastNum = parseInt(result[0].poNumber.replace(prefix, "")) || 0;
  return `${prefix}${String(lastNum + 1).padStart(4, "0")}`;
}

export async function createPurchaseOrder(data: any) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.insert(purchaseOrders).values(data);
  return result[0].insertId;
}

export async function getPurchaseOrders(filters?: {
  status?: string;
  requestedById?: number;
  dateFrom?: string;
  dateTo?: string;
}) {
  const db = await getDb();
  if (!db) return [];
  const conditions: any[] = [];
  if (filters?.status) conditions.push(eq(purchaseOrders.status, filters.status as any));
  if (filters?.requestedById) conditions.push(eq(purchaseOrders.requestedById, filters.requestedById));
  if (filters?.dateFrom) conditions.push(gte(purchaseOrders.createdAt, new Date(filters.dateFrom)));
  if (filters?.dateTo) {
    const to = new Date(filters.dateTo);
    to.setHours(23, 59, 59, 999);
    conditions.push(lte(purchaseOrders.createdAt, to));
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  // استعلام 1: جلب الطلبات مع اسم المنشئ
  const poList = await db
.select({
      id: purchaseOrders.id,
      poNumber: purchaseOrders.poNumber,
      ticketId: purchaseOrders.ticketId,
      status: purchaseOrders.status,
      requestedById: purchaseOrders.requestedById,
      requestedByName: users.name,
      totalEstimatedCost: purchaseOrders.totalEstimatedCost,
      totalActualCost: purchaseOrders.totalActualCost,
      notes: purchaseOrders.notes,
      createdAt: purchaseOrders.createdAt,
      updatedAt: purchaseOrders.updatedAt,
      reviewedById: purchaseOrders.reviewedById,
      reviewedAt: purchaseOrders.reviewedAt,
      accountingApprovedById: purchaseOrders.accountingApprovedById,
      accountingApprovedAt: purchaseOrders.accountingApprovedAt,
      managementApprovedById: purchaseOrders.managementApprovedById,
      managementApprovedAt: purchaseOrders.managementApprovedAt,
      custodyAmount: purchaseOrders.custodyAmount,
    })
    .from(purchaseOrders)
    .leftJoin(users, eq(purchaseOrders.requestedById, users.id))
    .where(where)
    .orderBy(desc(purchaseOrders.createdAt));

  if (poList.length === 0) return [];

  // استعلام 2: جلب عدد الأصناف لكل طلب دفعة واحدة
  const poIds = poList.map(p => p.id);
  const itemCounts = await db
    .select({
      purchaseOrderId: purchaseOrderItems.purchaseOrderId,
      itemCount: count(purchaseOrderItems.id),
    })
    .from(purchaseOrderItems)
    .where(inArray(purchaseOrderItems.purchaseOrderId, poIds))
    .groupBy(purchaseOrderItems.purchaseOrderId);

  // عدد المناديب المختلفين المسندة لهم أصناف بكل طلب — لتمييز الطلبات الموزَّعة على أكثر من مندوب
  const delegateRows = await db
    .select({
      purchaseOrderId: purchaseOrderItems.purchaseOrderId,
      delegateId: purchaseOrderItems.delegateId,
    })
    .from(purchaseOrderItems)
    .where(inArray(purchaseOrderItems.purchaseOrderId, poIds));
  const delegateSetByPO = new Map<number, Set<number>>();
  for (const row of delegateRows) {
    if (row.delegateId == null) continue;
    const set = delegateSetByPO.get(row.purchaseOrderId) ?? new Set<number>();
    set.add(row.delegateId);
    delegateSetByPO.set(row.purchaseOrderId, set);
  }

  // استعلام 3: جلب أسماء الأصناف لكل طلب دفعة واحدة (للبحث الديناميكي)
  const itemRows = await db
    .select({
      purchaseOrderId: purchaseOrderItems.purchaseOrderId,
      itemName: purchaseOrderItems.itemName,
      itemName_ar: purchaseOrderItems.itemName_ar,
      itemName_en: purchaseOrderItems.itemName_en,
      itemName_ur: purchaseOrderItems.itemName_ur,
    })
    .from(purchaseOrderItems)
    .where(inArray(purchaseOrderItems.purchaseOrderId, poIds));

  const namesMap = new Map<number, string[]>();
  const namesMapEn = new Map<number, string[]>();
  const namesMapAr = new Map<number, string[]>();
  const namesMapUr = new Map<number, string[]>();
  for (const row of itemRows) {
    const arr = namesMap.get(row.purchaseOrderId) ?? [];
    arr.push(row.itemName);
    namesMap.set(row.purchaseOrderId, arr);
    // translated names
    if (row.itemName_en) { const a = namesMapEn.get(row.purchaseOrderId) ?? []; a.push(row.itemName_en); namesMapEn.set(row.purchaseOrderId, a); }
    if (row.itemName_ar) { const a = namesMapAr.get(row.purchaseOrderId) ?? []; a.push(row.itemName_ar); namesMapAr.set(row.purchaseOrderId, a); }
    if (row.itemName_ur) { const a = namesMapUr.get(row.purchaseOrderId) ?? []; a.push(row.itemName_ur); namesMapUr.set(row.purchaseOrderId, a); }
  }

  // دمج النتائج
  const countMap = new Map(itemCounts.map(r => [r.purchaseOrderId, Number(r.itemCount)]));
  return poList.map(po => ({
    ...po,
    itemCount: countMap.get(po.id) ?? 0,
    delegateCount: delegateSetByPO.get(po.id)?.size ?? 0,
    itemNames: namesMap.get(po.id) ?? [],
    itemNames_en: namesMapEn.get(po.id) ?? [],
    itemNames_ar: namesMapAr.get(po.id) ?? [],
    itemNames_ur: namesMapUr.get(po.id) ?? [],
  }));
}


export async function getPurchaseOrderById(id: number) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, id)).limit(1);
  return result[0] || null;
}

export async function updatePurchaseOrder(id: number, data: any, tx?: any) {
  const db = tx || await getDb();
  if (!db) return;
  await db.update(purchaseOrders).set(data).where(eq(purchaseOrders.id, id));
}

// ============================================================
// PURCHASE ORDER ITEMS
// ============================================================
export async function createPOItems(items: any[]) {
  const db = await getDb();
  if (!db) return;
  if (items.length > 0) await db.insert(purchaseOrderItems).values(items);
}

export async function getPOItems(purchaseOrderId: number, tx?: any) {
  const db = tx || await getDb();
  if (!db) return [];
  return db.select().from(purchaseOrderItems).where(eq(purchaseOrderItems.purchaseOrderId, purchaseOrderId)).orderBy(purchaseOrderItems.id);
}

export async function getPOItemsByDelegate(delegateId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(purchaseOrderItems).where(eq(purchaseOrderItems.delegateId, delegateId)).orderBy(desc(purchaseOrderItems.createdAt));
}

export async function updatePOItem(id: number, data: any, tx?: any) {
  const db = tx || await getDb();
  if (!db) return;
  await db.update(purchaseOrderItems).set(data).where(eq(purchaseOrderItems.id, id));
}

export async function getPOItemById(id: number) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.select().from(purchaseOrderItems).where(eq(purchaseOrderItems.id, id)).limit(1);
  return result[0] || null;
}

// ============================================================
// PO PRICING BATCHES (دفعات التسعير)
// ============================================================
export async function createPOPricingBatch(data: InsertPOPricingBatch) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.insert(poPricingBatches).values(data);
  return result[0].insertId;
}

export async function getNextBatchNumber(purchaseOrderId: number) {
  const db = await getDb();
  if (!db) return 1;
  const rows = await db
    .select({ batchNumber: poPricingBatches.batchNumber })
    .from(poPricingBatches)
    .where(eq(poPricingBatches.purchaseOrderId, purchaseOrderId))
    .orderBy(desc(poPricingBatches.batchNumber))
    .limit(1);
  return rows.length > 0 ? rows[0].batchNumber + 1 : 1;
}

export async function getPOPricingBatches(purchaseOrderId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(poPricingBatches)
    .where(eq(poPricingBatches.purchaseOrderId, purchaseOrderId))
    .orderBy(poPricingBatches.batchNumber);
}

export async function getPOPricingBatchById(id: number) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.select().from(poPricingBatches).where(eq(poPricingBatches.id, id)).limit(1);
  return result[0] || null;
}

export async function updatePOPricingBatch(id: number, data: any) {
  const db = await getDb();
  if (!db) return;
  await db.update(poPricingBatches).set(data).where(eq(poPricingBatches.id, id));
}

export async function getPOItemsByStatus(status: string) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(purchaseOrderItems).where(eq(purchaseOrderItems.status, status as any)).orderBy(desc(purchaseOrderItems.createdAt));
}

// ══════════════════════════════════════════════════════════════════════════════
// ARCHITECTURAL DECISION — مرجع رسمي — لا تعدّل هذا الاستعلام بدون مراجعة
// ══════════════════════════════════════════════════════════════════════════════
//
// مصدر الحقيقة لمرحلة "إدخال المخزون" هو:
//   warehouse_receipt_items المرتبط بـ warehouse_receipts.status = 'confirmed'
//
// دورة العمل المعتمدة:
//   delivered_to_warehouse → تعني: البضاعة وصلت المستودع فقط
//   وجود warehouse_receipt (confirmed) → يعني: البضاعة دخلت المخزون رسمياً
//
// لماذا لا نعتمد على status وحده؟
//   لأن delivered_to_warehouse لا تتغير بعد إدخال المخزون —
//   تغيير دورة العمل يتطلب قراراً معمارياً كاملاً.
//
// لماذا لا نعتمد على مجرد وجود سجل في warehouse_receipt_items؟
//   لأن invoiceDraft.router.ts ينشئ سجلات warehouse_receipt_items أثناء
//   مرحلة تحليل OCR (قبل التأكيد النهائي) — لو اعتمدنا على الوجود فقط
//   سيختفي البند من التبويب فور تحليل الفاتورة وقبل اعتمادها.
//
// القاعدة الذهبية:
//   لا تضف Status جديدة لهذا الغرض إلا إذا تغيرت دورة العمل بالكامل.
//   الفهرس idx_receipt_items_poItemId موجود لدعم هذا الاستعلام مع نمو البيانات.
// ══════════════════════════════════════════════════════════════════════════════
export async function getPOItemsPendingInventoryEntry() {
  const db = await getDb();
  if (!db) return [];

  const [rows] = await (db as any).execute(`
    SELECT poi.*
    FROM purchase_order_items poi
    WHERE poi.status = 'delivered_to_warehouse'
      AND NOT EXISTS (
        SELECT 1
        FROM warehouse_receipt_items wri
        JOIN warehouse_receipts wr ON wri.receiptId = wr.id
        WHERE wri.purchaseOrderItemId = poi.id
          AND wr.status = 'confirmed'
      )
    ORDER BY poi.createdAt DESC
  `);

  return rows as any[];
}

// ══════════════════════════════════════════════════════════════════════════════
// ITEM TRACKER — خطوة 1: البحث عن الأسماء المطابقة فقط (بدون تفاصيل)
// تُستخدم لعرض قائمة اختيار للمستخدم قبل جلب التايم لاين الكامل، لتفادي دمج
// أصناف مختلفة (مثل "سلك تربيط" و"سلك كهرباء" و"سلك نحاس") بنتيجة واحدة مبهمة.
// ══════════════════════════════════════════════════════════════════════════════
export async function searchItemNames(searchTerm: string) {
  const db = await getDb();
  if (!db) return [];

  const like = `%${searchTerm.trim()}%`;

  const [poNames] = await (db as any).execute(sql`
    SELECT DISTINCT itemName FROM purchase_order_items WHERE itemName LIKE ${like}
  `);
  const [invNames] = await (db as any).execute(sql`
    SELECT DISTINCT itemName FROM inventory WHERE itemName LIKE ${like}
  `);

  const namesSet = new Set<string>();
  for (const row of poNames as any[]) namesSet.add(row.itemName);
  for (const row of invNames as any[]) namesSet.add(row.itemName);

  return Array.from(namesSet).sort((a, b) => a.localeCompare(b, "ar"));
}

// ══════════════════════════════════════════════════════════════════════════════
// ITEM TRACKER — تتبع دورة حياة صنف بالاسم عبر كل الجداول (بديل استعلامات SQL
// اليدوية). كل حدث بالتايم لاين موسوم بمصدر الإدخال:
//   - "purchase_cycle": الصنف دخل عبر دورة شراء رسمية (purchase_order_items)
//   - "inventory": الصنف دخل كاستلام مستقل بدون طلب شراء (warehouse_receipts
//     بدون purchaseOrderId)
// ══════════════════════════════════════════════════════════════════════════════
export async function trackItemHistory(searchTerm: string, exactMatch: boolean = false) {
  const db = await getDb();
  if (!db) return { events: [], sourceType: null as null };

  // ملاحظة: LIKE بدون علامتي % تتصرف كمطابقة تامة بـ MySQL، فلا حاجة لتغيير
  // أي من الاستعلامات أدناه — فقط نتحكم بوجود % من عدمه هنا.
  const like = exactMatch ? searchTerm.trim() : `%${searchTerm.trim()}%`;

  // 1) بنود طلبات الشراء المطابقة (دورة الشراء الرسمية)
  const [poItemRows] = await (db as any).execute(sql`
    SELECT poi.id, poi.purchaseOrderId, po.poNumber, poi.itemName, poi.quantity, poi.unit,
           poi.status, poi.supplierName, poi.supplierInvoiceNumber,
           poi.estimatedUnitCost, poi.actualUnitCost, poi.actualTotalCost,
           poi.purchasedAt, poi.purchasedById, up.name AS purchasedByName,
           poi.receivedAt, poi.receivedById, ur.name AS receivedByName, poi.receivedQuantity,
           poi.deliveredAt, poi.deliveredById, ud.name AS deliveredByName, poi.deliveredToId, ut.name AS deliveredToName,
           poi.deliveredQuantity, poi.deliveryNumber,
           poi.returnedQuantity, poi.returnReason, poi.returnedAt,
           poi.createdAt
    FROM purchase_order_items poi
    JOIN purchase_orders po ON po.id = poi.purchaseOrderId
    LEFT JOIN users up ON up.id = poi.purchasedById
    LEFT JOIN users ur ON ur.id = poi.receivedById
    LEFT JOIN users ud ON ud.id = poi.deliveredById
    LEFT JOIN users ut ON ut.id = poi.deliveredToId
    WHERE poi.itemName LIKE ${like}
    ORDER BY poi.createdAt DESC
  `);

  // 2) سجلات المخزون المطابقة + هل مصدرها استلام مستقل أو مرتبط بطلب شراء
  // ملاحظة مهمة: التصنيف يعتمد على ربط البند نفسه (warehouse_receipt_items.purchaseOrderItemId)
  // وليس رأس الإيصال (warehouse_receipts.purchaseOrderId) — لأنه ممكن يكون الإيصال
  // مرتبط برأسه بطلب شراء، لكن أحد بنوده (مستخرج عبر OCR) غير مطابق لأي بند فعلي
  // بذلك الطلب (حالة حقيقية رصدناها: إيصال RCV-2026-210012).
  const [inventoryRows] = await (db as any).execute(sql`
    SELECT inv.id, inv.itemName, inv.quantity, inv.unit, inv.internalCode,
           inv.receiptId, wr.receiptNumber, wr.vendorName, wr.invoiceNumber,
           wr.receivedAt, wr.receivedById, u.name AS receivedByName, wr.notes AS receiptNotes,
           wri.purchaseOrderItemId AS linkedPoItemId
    FROM inventory inv
    LEFT JOIN warehouse_receipts wr ON wr.id = inv.receiptId
    LEFT JOIN users u ON u.id = wr.receivedById
    LEFT JOIN warehouse_receipt_items wri
           ON wri.receiptId = inv.receiptId AND wri.itemName = inv.itemName
    WHERE inv.itemName LIKE ${like}
  `);

  // 3) حركات المخزون (in/out) لكل سجل مخزون مطابق
  const inventoryIds = (inventoryRows as any[]).map(r => r.id);
  let transactionRows: any[] = [];
  if (inventoryIds.length > 0) {
    const [txRows] = await (db as any).execute(sql`
      SELECT it.id, it.inventoryId, it.type, it.transactionType, it.quantity, it.reason,
             it.performedById, u.name AS performedByName, it.createdAt,
             it.unitCost, it.totalCost, it.receiptId, it.returnId
      FROM inventory_transactions it
      LEFT JOIN users u ON u.id = it.performedById
      WHERE it.inventoryId IN ${inventoryIds}
      ORDER BY it.createdAt ASC
    `);
    transactionRows = txRows as any[];
  }

  // 4) وثائق التسليم المطابقة
  const [deliveryRows] = await (db as any).execute(sql`
    SELECT * FROM delivery_documents WHERE itemName LIKE ${like} ORDER BY createdAt ASC
  `);
  const deliveryDocs = deliveryRows as any[];

  // ── بناء التايم لاين الموحّد ──────────────────────────────────────────────
  const events: any[] = [];

  for (const poi of poItemRows as any[]) {
    events.push({
      date: poi.createdAt, sourceType: "purchase_cycle",
      stage: "طلب شراء", title: `إنشاء بند بطلب الشراء ${poi.poNumber}`,
      itemName: poi.itemName, poNumber: poi.poNumber, status: poi.status,
    });
    if (poi.purchasedAt) {
      events.push({
        date: poi.purchasedAt, sourceType: "purchase_cycle",
        stage: "تم الشراء", title: `اشتراه ${poi.purchasedByName || "—"}`,
        itemName: poi.itemName, poNumber: poi.poNumber,
        supplierName: poi.supplierName, unitCost: poi.actualUnitCost,
      });
    }
    if (poi.receivedAt) {
      events.push({
        date: poi.receivedAt, sourceType: "purchase_cycle",
        stage: "استلام بالمستودع", title: `استلمه ${poi.receivedByName || "—"} بكمية ${poi.receivedQuantity ?? "—"}`,
        itemName: poi.itemName, poNumber: poi.poNumber,
      });
    }
    if (poi.deliveredAt) {
      events.push({
        date: poi.deliveredAt, sourceType: "purchase_cycle",
        stage: "تسليم للطالب/الفني", title: `سلّمه ${poi.deliveredByName || "—"} إلى ${poi.deliveredToName || "—"} (${poi.deliveryNumber || "—"})`,
        itemName: poi.itemName, poNumber: poi.poNumber, quantity: poi.deliveredQuantity,
      });
    }
    if (poi.returnedAt) {
      events.push({
        date: poi.returnedAt, sourceType: "purchase_cycle",
        stage: "مرتجع", title: `أُرجعت كمية ${poi.returnedQuantity} — السبب: ${poi.returnReason || "—"}`,
        itemName: poi.itemName, poNumber: poi.poNumber,
      });
    }
  }

  for (const inv of inventoryRows as any[]) {
    const isStandalone = inv.linkedPoItemId === null || inv.linkedPoItemId === undefined;
    events.push({
      date: inv.receivedAt, sourceType: isStandalone ? "inventory" : "purchase_cycle",
      stage: "إضافة للمخزون",
      title: isStandalone
        ? `استلام مستقل (بلا طلب شراء) — ${inv.receiptNumber || "—"} من ${inv.vendorName || "—"}`
        : `إضافة للمخزون عبر دورة شراء — ${inv.receiptNumber || "—"} من ${inv.vendorName || "—"}`,
      itemName: inv.itemName, receiptNumber: inv.receiptNumber,
      receivedBy: inv.receivedByName, invoiceNumber: inv.invoiceNumber,
      standaloneReason: isStandalone ? inv.receiptNotes : null,
      currentQuantity: inv.quantity, internalCode: inv.internalCode,
    });
  }

  const txTypeLabels: Record<string, string> = {
    return: "مرتجع",
    delivery: "تسليم/صرف",
    adjustment: "تسوية جرد",
    disposal: "إتلاف/استبعاد",
  };

  for (const tx of transactionRows) {
    if (tx.transactionType === "purchase") continue; // مغطاة أعلاه ضمن "إضافة للمخزون"
    const typeLabel = txTypeLabels[tx.transactionType] || tx.transactionType;
    events.push({
      date: tx.createdAt,
      sourceType: "inventory",
      stage: tx.type === "in" ? `زيادة مخزون (${typeLabel})` : `خصم مخزون (${typeLabel})`,
      title: `${tx.reason || typeLabel} — بواسطة ${tx.performedByName || "—"} (كمية ${tx.quantity})`,
      quantity: tx.quantity,
    });
  }

  events.sort((a, b) => new Date(a.date || 0).getTime() - new Date(b.date || 0).getTime());

  return {
    events,
    poItemsFound: (poItemRows as any[]).length,
    inventoryRecordsFound: (inventoryRows as any[]).length,
  };
}


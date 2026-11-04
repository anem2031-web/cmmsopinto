import { readScopeChunks } from "../authz/read-batch";
import { APP_ROLE } from "../../../shared/roles";
import { pricingBundlesEnabled, assertItemOutsidePricingBundle } from "../../services/delegate-pricing-bundles/reservations";
import { getPackageSubmissionsWithBatchesForPackages } from "./purchase-read-lists";
// ============================================================
// db/purchase.ts — المشتريات: أوامر الشراء وبنودها ودفعات التسعير وتعليقاتها
// (مُقسَّم من db.ts الأصلي حسب المجال الوظيفي)
// ============================================================
import { eq, desc, asc, and, sql, count, sum, inArray, notInArray, like, or, gte, lte, lt, isNull, isNotNull, ne, getTableColumns } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { alias } from "drizzle-orm/mysql-core";
import mysql from "mysql2/promise";
import {
  InsertUser, users, tickets, ticketItems, purchaseOrders, purchaseOrderItems,
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
  purchaseOrderItemHistory,
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
  externalMaintenanceJobs,
  catalogItems,
  purchasePackages,
  purchasePackageNumberCounter,
  purchasePackageSubmissions,
  centerCategories,
} from "../../../drizzle/schema";
import { ENV } from '../env';


import { getDb } from "./client";

// ============================================================
// CENTER CATEGORIES
// ============================================================
export async function listCenterCategories(activeOnly = false) {
  const db = await getDb();
  if (!db) return [];
  const query = db.select().from(centerCategories);
  if (activeOnly) {
    return query.where(eq(centerCategories.isActive, 1)).orderBy(asc(centerCategories.name));
  }
  return query.orderBy(desc(centerCategories.isActive), asc(centerCategories.name));
}

export async function getCenterCategoryById(id: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(centerCategories).where(eq(centerCategories.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function createCenterCategory(name: string) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.insert(centerCategories).values({ name: name.trim(), isActive: 1, systemKey: null });
  return { id: Number(result[0].insertId), name: name.trim(), systemKey: null, isActive: 1 };
}

export async function updateCenterCategory(id: number, data: { name?: string; isActive?: boolean }) {
  const db = await getDb();
  if (!db) return null;
  const payload: Record<string, any> = {};
  if (data.name !== undefined) payload.name = data.name.trim();
  if (data.isActive !== undefined) payload.isActive = data.isActive ? 1 : 0;
  if (Object.keys(payload).length > 0) {
    await db.update(centerCategories).set(payload).where(eq(centerCategories.id, id));
  }
  return getCenterCategoryById(id);
}

export async function getCenterCategoryUsageCount(id: number) {
  const db = await getDb();
  if (!db) return { purchaseOrders: 0, tickets: 0, total: 0 };
  const [poRows, ticketRows] = await Promise.all([
    db.select({ total: count(purchaseOrders.id) }).from(purchaseOrders).where(eq(purchaseOrders.categoryId, id)),
    db.select({ total: count(tickets.id) }).from(tickets).where(eq(tickets.categoryId, id)),
  ]);
  const purchaseOrderCount = Number(poRows[0]?.total ?? 0);
  const ticketCount = Number(ticketRows[0]?.total ?? 0);
  return { purchaseOrders: purchaseOrderCount, tickets: ticketCount, total: purchaseOrderCount + ticketCount };
}

export async function deleteCenterCategory(id: number) {
  const db = await getDb();
  if (!db) return null;
  await db.delete(centerCategories).where(eq(centerCategories.id, id));
  return { id };
}

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


export interface POItemHistoryMeta {
  actorUserId?: number | null;
  actorName?: string | null;
  eventType?: string;
  note?: string | null;
  metadata?: Record<string, any> | null;
}

function historyJsonValue(value: any) {
  if (value instanceof Date) return value.toISOString();
  if (value === null || ["string", "number", "boolean"].includes(typeof value)) return value;
  return undefined;
}

/**
 * كتابة حدث صريح بتاريخ بند طلب الشراء. تستخدمها المسارات التي لا تمر عبر
 * updatePOItem (مثل بعض عمليات المستودع/الصيانة الخارجية)، بينما المسارات
 * الاعتيادية تُسجَّل تلقائيًا من دوال التحديث المركزية أدناه.
 */
export async function createPOItemHistoryEvent(input: {
  purchaseOrderItemId: number;
  purchaseOrderId: number;
  eventType: string;
  previousStatus?: string | null;
  newStatus?: string | null;
  previousDelegateId?: number | null;
  newDelegateId?: number | null;
  actorUserId?: number | null;
  actorName?: string | null;
  note?: string | null;
  metadata?: Record<string, any> | null;
  createdAt?: Date | string | null;
}, tx?: any) {
  const writer = tx || await getDb();
  if (!writer) return null;
  const result = await writer.insert(purchaseOrderItemHistory).values({
    purchaseOrderItemId: input.purchaseOrderItemId,
    purchaseOrderId: input.purchaseOrderId,
    eventType: input.eventType,
    previousStatus: input.previousStatus ?? null,
    newStatus: input.newStatus ?? null,
    previousDelegateId: input.previousDelegateId ?? null,
    newDelegateId: input.newDelegateId ?? null,
    actorUserId: input.actorUserId ?? null,
    actorName: input.actorName ?? null,
    note: input.note ?? null,
    metadata: input.metadata ?? null,
    ...(input.createdAt ? { createdAt: input.createdAt as any } : {}),
  } as any);
  return result?.[0]?.insertId ?? null;
}

async function readPOItemHistorySnapshot(writer: any, id: number) {
  const rows = await writer
    .select({
      id: purchaseOrderItems.id,
      purchaseOrderId: purchaseOrderItems.purchaseOrderId,
      status: purchaseOrderItems.status,
      delegateId: purchaseOrderItems.delegateId,
      delegateAssignedAt: purchaseOrderItems.delegateAssignedAt,
      batchId: purchaseOrderItems.batchId,
      delegateChangeRequestedAt: purchaseOrderItems.delegateChangeRequestedAt,
      estimatedUnitCost: purchaseOrderItems.estimatedUnitCost,
      actualUnitCost: purchaseOrderItems.actualUnitCost,
      supplierName: purchaseOrderItems.supplierName,
      returnedQuantity: purchaseOrderItems.returnedQuantity,
      returnedAt: purchaseOrderItems.returnedAt,
    })
    .from(purchaseOrderItems)
    .where(eq(purchaseOrderItems.id, id))
    .limit(1);
  return rows[0] || null;
}

function inferPOItemHistoryActor(data: any, meta?: POItemHistoryMeta) {
  if (meta?.actorUserId != null) return meta.actorUserId;
  for (const key of [
    "purchasedById",
    "receivedById",
    "deliveredById",
    "purchaseCancelledById",
    "itemRevisionRequestedById",
    "estimatedById",
  ]) {
    if (data?.[key] != null) return Number(data[key]);
  }
  return null;
}

async function recordPOItemMutationHistory(
  writer: any,
  before: any,
  data: any,
  meta?: POItemHistoryMeta,
) {
  if (!before) return;
  const has = (key: string) => Object.prototype.hasOwnProperty.call(data || {}, key);
  const nextStatus = has("status") ? data.status : before.status;
  const nextDelegateId = has("delegateId") ? data.delegateId : before.delegateId;
  const nextBatchId = has("batchId") ? data.batchId : before.batchId;

  const statusChanged = has("status") && nextStatus !== before.status;
  const delegateChanged = has("delegateId") && nextDelegateId !== before.delegateId;
  const batchChanged = has("batchId") && nextBatchId !== before.batchId;
  const delegateChangeRequested = has("delegateChangeRequestedAt") && !!data.delegateChangeRequestedAt;
  const returned = has("returnedAt") || has("returnedQuantity") || has("returnReason");
  const estimateChanged = has("estimatedUnitCost") || has("estimatedTotalCost");
  const purchaseDetailsChanged = has("actualUnitCost") || has("actualTotalCost") || has("supplierName") || has("supplierInvoiceNumber");
  const receiptChanged = has("receivedAt") || has("receivedQuantity");
  const deliveryChanged = has("deliveredAt") || has("deliveredQuantity");

  if (!(statusChanged || delegateChanged || batchChanged || delegateChangeRequested || returned || estimateChanged || purchaseDetailsChanged || receiptChanged || deliveryChanged || meta?.eventType)) {
    return;
  }

  let eventType = meta?.eventType;
  if (!eventType) {
    if (delegateChangeRequested) eventType = "delegate_change_requested";
    else if (statusChanged) eventType = "status_changed";
    else if (delegateChanged) eventType = "delegate_changed";
    else if (batchChanged) eventType = "pricing_batch_changed";
    else if (returned) eventType = "returned";
    else if (receiptChanged) eventType = "warehouse_received";
    else if (deliveryChanged) eventType = "delivered";
    else if (purchaseDetailsChanged) eventType = "purchase_details_updated";
    else if (estimateChanged) eventType = "estimate_updated";
    else eventType = "item_updated";
  }

  const changedFields: Record<string, any> = {};
  for (const key of [
    "batchId", "estimatedUnitCost", "estimatedTotalCost", "actualUnitCost", "actualTotalCost",
    "supplierName", "supplierInvoiceNumber", "receivedAt", "receivedQuantity", "deliveredAt",
    "deliveredQuantity", "returnedAt", "returnedQuantity", "returnReason", "delegateChangeRequestedAt",
  ]) {
    if (!has(key)) continue;
    const normalized = historyJsonValue(data[key]);
    if (normalized !== undefined) changedFields[key] = normalized;
  }

  try {
    await writer.insert(purchaseOrderItemHistory).values({
      purchaseOrderItemId: before.id,
      purchaseOrderId: before.purchaseOrderId,
      eventType,
      previousStatus: before.status ?? null,
      newStatus: nextStatus ?? null,
      previousDelegateId: before.delegateId ?? null,
      newDelegateId: nextDelegateId ?? null,
      actorUserId: inferPOItemHistoryActor(data, meta),
      actorName: meta?.actorName ?? null,
      note: meta?.note ?? null,
      metadata: {
        ...(meta?.metadata || {}),
        ...(Object.keys(changedFields).length ? { changedFields } : {}),
        ...(batchChanged ? { previousBatchId: before.batchId ?? null, newBatchId: nextBatchId ?? null } : {}),
      },
    } as any);
  } catch (error) {
    // سجل المتابعة ثانوي ولا يجوز أن يحول نجاح حركة شراء إلى فشل جزئي إذا
    // لم تُطبّق migration بعد أو حدث عطل مؤقت في جدول التاريخ.
    console.error("[PO_ITEM_HISTORY] failed to record mutation", { itemId: before.id, eventType, error });
  }
}

export async function getUsersByRole(role: string) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(users).where(role===APP_ROLE.DELEGATE?inArray(users.role,[APP_ROLE.DELEGATE,APP_ROLE.DELEGATE_MANAGER]):eq(users.role, role as any));
}

async function getUsersByRoles(roles: string[]) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(users).where(inArray(users.role, roles as any[]));
}

/** Legacy manager recipients. Kept for modules excluded from both derived roles (warehouse). */
export async function getManagerUsers() {
  return getUsersByRoles(["maintenance_manager", "owner", "admin"]);
}

/** Ticket/triage recipients: legacy manager + general maintenance role. */
export async function getTicketManagerUsers() {
  return getUsersByRoles([
    "maintenance_manager",
    "general_maintenance_manager",
    "owner",
    "admin",
  ]);
}

/** Purchase recipients: all maintenance-manager variants. */
export async function getPurchaseManagerUsers() {
  return getUsersByRoles([
    "maintenance_manager",
    "general_maintenance_manager",
    "construction_procurement_manager",
    "owner",
    "admin",
  ]);
}

/** Shared operational modules retained by both derived roles (PM, improvements, reports). */
export async function getOperationalManagerUsers() {
  return getPurchaseManagerUsers();
}

// ── أرجاع IDs كل المستخدمين بدور معيّن — تُستخدم لفلترة الطلبات حسب من أنشأها ──
export async function getUserIdsByRole(role: string): Promise<number[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select({ id: users.id }).from(users).where(role===APP_ROLE.DELEGATE?inArray(users.role,[APP_ROLE.DELEGATE,APP_ROLE.DELEGATE_MANAGER]):eq(users.role, role as any));
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

  // PR number reservation is DB-backed and atomic.
  // The counter table is intentionally independent from purchase_orders so concurrent
  // requests cannot read the same "last" PR number and generate a duplicate.
  const [result] = await (db as any).execute(sql`
    INSERT INTO purchase_order_number_counter (year)
    VALUES (${year})
  `);
  const seq = Number((result as any)?.insertId ?? 0);
  if (!seq) throw new Error("Failed to reserve purchase request number");

  return `${prefix}${String(seq).padStart(4, "0")}`;
}

/**
 * رقم المسودة (2026-08-13) — تسلسل مستقل تمامًا عن getNextPONumber أعلاه، بادئة
 * مختلفة (DFT- بدل PR-) قصدًا: حفظ مسودة يجب ألا يستهلك أو يحجز رقمًا من تسلسل
 * طلبات الشراء الرسمية. بما أن getNextPONumber يفلتر بـ`LIKE 'PR-{year}-%'`،
 * فصفوف المسودات بادئتها DFT- لا تُحسَب ضمنه أصلًا بلا أي تعديل على تلك الدالة —
 * التمييز يقع بالكامل على البادئة، لا بحقل status، فلا خطر من عدّ مسودة سهوًا
 * ضمن تسلسل الأرقام الرسمية حتى لو تغيّرت حالتها لاحقًا لأي سبب.
 * يُستبدَل هذا الرقم برقم رسمي حقيقي عبر getNextPONumber عند submitDraft فقط —
 * راجع purchase-orders.router.ts::submitDraft.
 */
export async function getNextDraftNumber() {
  const db = await getDb();
  if (!db) return "DFT-2026-0001";
  const year = new Date().getFullYear();
  const prefix = `DFT-${year}-`;
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

export async function createPurchaseOrder(data: any, tx?: any) {
  const db = tx || await getDb();
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

  // ✅ فلترة "الطلبات التي تحتوي صنفًا واحدًا على الأقل بحالة معيّنة" — لحالتين
  // موجودتين فقط على مستوى الصنف (purchase_order_items.status) وليس على مستوى
  // الطلب نفسه (purchase_orders.status): ملغى الشراء (purchase_cancelled)
  // وبحاجة مراجعة (needs_item_revision). فلترة مباشرة بـ eq() على عمود الطلب
  // لن تُطابق أي شيء أبداً لهاتين القيمتين تحديداً، فنستخدم بحثاً فرعياً بدلاً منها.
  const ITEM_LEVEL_STATUS_FILTERS = new Set(["purchase_cancelled", "needs_item_revision"]);
  if (filters?.status && ITEM_LEVEL_STATUS_FILTERS.has(filters.status)) {
    const matchingPOItems = await db
      .selectDistinct({ purchaseOrderId: purchaseOrderItems.purchaseOrderId })
      .from(purchaseOrderItems)
      .where(eq(purchaseOrderItems.status, filters.status as any));
    const matchingPOIds = matchingPOItems.map(r => r.purchaseOrderId);
    conditions.push(matchingPOIds.length > 0 ? inArray(purchaseOrders.id, matchingPOIds) : sql`1 = 0`);
  } else if (filters?.status) {
    conditions.push(eq(purchaseOrders.status, filters.status as any));
  }

  if (filters?.requestedById) conditions.push(eq(purchaseOrders.requestedById, filters.requestedById));
  // ✅ الفلترة بتاريخ الإرسال الرسمي لا تاريخ إنشاء المسودة (2026-07-28).
  // COALESCE: الطلبات القديمة (submittedAt = NULL) تُفلتر بـcreatedAt كما كانت
  // تمامًا، فلا يتغيّر سلوكها ولا تحتاج تعبئة رجعية.
  if (filters?.dateFrom) {
    conditions.push(sql`COALESCE(${purchaseOrders.submittedAt}, ${purchaseOrders.createdAt}) >= ${new Date(filters.dateFrom)}`);
  }
  if (filters?.dateTo) {
    const to = new Date(filters.dateTo);
    to.setHours(23, 59, 59, 999);
    conditions.push(sql`COALESCE(${purchaseOrders.submittedAt}, ${purchaseOrders.createdAt}) <= ${to}`);
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
      submittedAt: purchaseOrders.submittedAt,
      updatedAt: purchaseOrders.updatedAt,
      reviewedById: purchaseOrders.reviewedById,
      reviewedAt: purchaseOrders.reviewedAt,
      accountingApprovedById: purchaseOrders.accountingApprovedById,
      accountingApprovedAt: purchaseOrders.accountingApprovedAt,
      managementApprovedById: purchaseOrders.managementApprovedById,
      managementApprovedAt: purchaseOrders.managementApprovedAt,
      custodyAmount: purchaseOrders.custodyAmount,
      // [PB] حقلا عرض فقط — يمكّنان الواجهة من تجميع الطلبات تحت بطاقة
      // حزمتها. NULL لكل طلب غير مجمّع (وهو حال كل الطلبات القائمة)،
      // فلا يتغيّر شيء في سلوك أو شكل الطلب المفرد.
      packageId: purchaseOrders.packageId,
      packageNumber: purchasePackages.packageNumber,
    })
    .from(purchaseOrders)
    .leftJoin(users, eq(purchaseOrders.requestedById, users.id))
    .leftJoin(purchasePackages, eq(purchaseOrders.packageId, purchasePackages.id))
    .where(where)
    // ✅ الترتيب بتاريخ الإرسال الرسمي لا تاريخ إنشاء المسودة (2026-07-28) —
    // يمنع ضياع الطلب المُرسَل حديثًا بين الطلبات القديمة إذا بقيت مسودته مدة.
    .orderBy(sql`COALESCE(${purchaseOrders.submittedAt}, ${purchaseOrders.createdAt}) DESC`);

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

  // توزيع الأصناف على المناديب لكل طلب — لعرض ملخص مختصر (المطلوب/تم الشراء/المتبقي)
  // مباشرة على بطاقة القائمة بدون فتح الطلب
  const delegateRows = await db
    .select({
      purchaseOrderId: purchaseOrderItems.purchaseOrderId,
      delegateId: purchaseOrderItems.delegateId,
      status: purchaseOrderItems.status,
    })
    .from(purchaseOrderItems)
    .where(inArray(purchaseOrderItems.purchaseOrderId, poIds));

  const purchasedOrBeyondStatuses = new Set(["purchased", "delivered_to_warehouse", "delivered_to_requester"]);
  const excludedStatuses = new Set(["rejected", "cancelled"]);

  const delegateSetByPO = new Map<number, Set<number>>();
  // purchaseOrderId -> delegateId -> { total, purchased }
  const delegateBreakdownByPO = new Map<number, Map<number, { total: number; purchased: number }>>();

  for (const row of delegateRows) {
    if (row.delegateId == null) continue;
    const set = delegateSetByPO.get(row.purchaseOrderId) ?? new Set<number>();
    set.add(row.delegateId);
    delegateSetByPO.set(row.purchaseOrderId, set);

    if (excludedStatuses.has(row.status)) continue; // لا تُحتسب ضمن الملخص المختصر
    const poMap = delegateBreakdownByPO.get(row.purchaseOrderId) ?? new Map();
    const entry = poMap.get(row.delegateId) ?? { total: 0, purchased: 0 };
    entry.total += 1;
    if (purchasedOrBeyondStatuses.has(row.status)) entry.purchased += 1;
    poMap.set(row.delegateId, entry);
    delegateBreakdownByPO.set(row.purchaseOrderId, poMap);
  }

  // استعلام 3: جلب أسماء الأصناف لكل طلب دفعة واحدة (للبحث الديناميكي)
  // ملاحظة: أسماء مفاتيح الإخراج (itemName_ar/en/ur) أُبقيت كما هي عمداً للتوافق
  // مع الكود الذي يقرأها لاحقاً بنفس الملف (سطر ~259)؛ المُعدَّل هو فقط اسم خاصية
  // الجدول المصدر بعد تحديث schema.ts (itemName_ar → itemNameAr، إلخ).
  const itemRows = await db
    .select({
      purchaseOrderId: purchaseOrderItems.purchaseOrderId,
      itemName: purchaseOrderItems.itemName,
      itemName_ar: purchaseOrderItems.itemNameAr,
      itemName_en: purchaseOrderItems.itemNameEn,
      itemName_ur: purchaseOrderItems.itemNameUr,
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
    // ملخص مختصر للتوزيع على كل مندوب — يُستخدم لعرضه مباشرة على بطاقة القائمة
    delegateBreakdown: Array.from((delegateBreakdownByPO.get(po.id) ?? new Map()).entries()).map(
      ([delegateId, v]) => ({ delegateId, total: v.total, purchased: v.purchased, remaining: v.total - v.purchased })
    ),
    itemNames: namesMap.get(po.id) ?? [],
    itemNames_en: namesMapEn.get(po.id) ?? [],
    itemNames_ar: namesMapAr.get(po.id) ?? [],
    itemNames_ur: namesMapUr.get(po.id) ?? [],
  }));
}


/** Whether at least one purchase order is linked to a maintenance ticket. */
export async function getPurchaseOrdersByTicketId(ticketId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(purchaseOrders)
    .where(eq(purchaseOrders.ticketId, ticketId))
    .orderBy(asc(purchaseOrders.id));
}

/**
 * طلبات الشراء المرتبطة ببند بلاغ بعينه — الخطوة 4 من ميزة البلاغ متعدد
 * الجهات (2026-08-08). تُستخدم بدل getPurchaseOrdersByTicketId عندما يكون
 * الطلب مرتبطًا ببند تحديدًا لا بالبلاغ كاملًا (فرز متعدد الجهات).
 */
export async function getPurchaseOrdersByTicketItemId(ticketItemId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(purchaseOrders)
    .where(eq(purchaseOrders.ticketItemId, ticketItemId))
    .orderBy(asc(purchaseOrders.id));
}

export async function hasPurchaseOrderForTicket(ticketId: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const rows = await db
    .select({ id: purchaseOrders.id })
    .from(purchaseOrders)
    .where(eq(purchaseOrders.ticketId, ticketId))
    .limit(1);
  return rows.length > 0;
}

export async function getPurchaseOrderById(id: number, tx?: any) {
  const db = tx || await getDb();
  if (!db) return null;
  // ✅ يُرجِع الآن أيضاً الاسم الكامل لمن راجع الأصناف / اعتمدت الحسابات / اعتمدت
  // الإدارة العليا، عبر ثلاثة LEFT JOIN مستقلة (aliased) لجدول users نفسه —
  // بدل الاكتفاء بمعرّفات (IDs) خام لا تُترجَم لاسم في واجهة تفاصيل الطلب.
  const reviewer = alias(users, "reviewer");
  const accountingApprover = alias(users, "accountingApprover");
  const managementApprover = alias(users, "managementApprover");
  const result = await db
    .select({
      ...getTableColumns(purchaseOrders),
      reviewedByName: reviewer.name,
      accountingApprovedByName: accountingApprover.name,
      managementApprovedByName: managementApprover.name,
    })
    .from(purchaseOrders)
    .leftJoin(reviewer, eq(purchaseOrders.reviewedById, reviewer.id))
    .leftJoin(accountingApprover, eq(purchaseOrders.accountingApprovedById, accountingApprover.id))
    .leftJoin(managementApprover, eq(purchaseOrders.managementApprovedById, managementApprover.id))
    .where(eq(purchaseOrders.id, id))
    .limit(1);
  return result[0] || null;
}

export async function updatePurchaseOrder(id: number, data: any, tx?: any) {
  const db = tx || await getDb();
  if (!db) return;
  await db.update(purchaseOrders).set(data).where(eq(purchaseOrders.id, id));
}

// 2B-1: إرجاع هويات أصناف الكتالوج الموجودة للتحقق من الروابط قبل حفظ
// بنود طلب الشراء. لا نفرض حالة isActive هنا حتى لا يصبح تعطيل صنف لاحقًا
// سببًا لكسر تعديل مسودة تاريخية مرتبطة به؛ اختيار أصناف جديدة من الواجهة
// ما زال محصورًا بالأصناف النشطة أصلًا.
export async function getExistingCatalogItemIds(ids: number[]): Promise<number[]> {
  const db = await getDb();
  if (!db || ids.length === 0) return [];
  const uniqueIds = [...new Set(ids.filter(id => Number.isInteger(id) && id > 0))];
  if (uniqueIds.length === 0) return [];
  const rows = await db
    .select({ id: catalogItems.id })
    .from(catalogItems)
    .where(inArray(catalogItems.id, uniqueIds));
  return rows.map(row => Number(row.id));
}

// 2B-10-2B: الهوية الجديدة في Purchase workflow يجب أن تشير إلى Master Item نشط.
// تبقى الدالة السابقة أعلاه لفحص "الوجود" فقط حتى نستطيع السماح للرابط التاريخي
// نفسه داخل مسودة قديمة إذا تعطّل الصنف لاحقاً، بدون السماح بإنشاء رابط جديد إليه.
export async function getActiveCatalogItemIds(ids: number[]): Promise<number[]> {
  const db = await getDb();
  if (!db || ids.length === 0) return [];
  const uniqueIds = [...new Set(ids.filter(id => Number.isInteger(id) && id > 0))];
  if (uniqueIds.length === 0) return [];
  const rows = await db
    .select({ id: catalogItems.id })
    .from(catalogItems)
    .where(and(
      inArray(catalogItems.id, uniqueIds),
      eq(catalogItems.isActive, 1),
    ));
  return rows.map(row => Number(row.id));
}

// ============================================================
// PURCHASE ORDER ITEMS
// ============================================================
export async function createPOItems(items: any[], tx?: any) {
  const db = tx || await getDb();
  if (!db) return;
  // ✅ جزء من إصلاح حرج #5: لا يجوز السماح بإنشاء طلب شراء بلا بند واحد على
  // الأقل من اللحظة الأولى. سابقاً كانت مصفوفة فارغة تمر بصمت بدون أي كتابة
  // وبدون أي خطأ، مما يسمح بنجاح إنشاء رأس الطلب فقط دون أصنافه.
  if (!items || items.length === 0) {
    throw new Error("Purchase order must have at least one item — refusing to create header without items");
  }
  await db.insert(purchaseOrderItems).values(items);
}

export async function getPOItems(purchaseOrderId: number, tx?: any) {
  const db = tx || await getDb();
  if (!db) return [];
  return db.select().from(purchaseOrderItems).where(eq(purchaseOrderItems.purchaseOrderId, purchaseOrderId)).orderBy(purchaseOrderItems.id);
}

export async function getPOItemsByDelegate(delegateId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select({
    ...getTableColumns(purchaseOrderItems),
    requestedById: purchaseOrders.requestedById,
    requestedByName: users.name,
  }).from(purchaseOrderItems)
    .innerJoin(purchaseOrders, eq(purchaseOrderItems.purchaseOrderId, purchaseOrders.id))
    .leftJoin(users, eq(purchaseOrders.requestedById, users.id))
    .where(eq(purchaseOrderItems.delegateId, delegateId))
    .orderBy(desc(purchaseOrderItems.createdAt));
}

/**
 * Flat source for the «متابعة التوريد» tab. Draft orders are intentionally
 * excluded because their required dates are not operational commitments yet.
 * Passing delegateId enforces delegate scope at query level.
 */
export async function getPurchaseSupplyTrackingItems(delegateId?: number) {
  const db = await getDb();
  if (!db) return [];
  const delegateUser = alias(users, "supplyTrackingDelegate");
  const requesterUser = alias(users, "supplyTrackingRequester");
  // «متابعة التوريد» تتابع مسؤولية المندوب حتى التسليم الفعلي للمستودع.
  // لذلك: لا نعرض ما لم يُسند لمندوب، ونبقي purchased ظاهراً، ثم نخفي
  // الصنف فقط بعد وصوله للمستودع أو إذا خرج نهائياً من دورة المندوب.
  const conditions: any[] = [
    ne(purchaseOrders.status, "draft" as any),
    isNotNull(purchaseOrderItems.delegateId),
    notInArray(purchaseOrderItems.status, [
      "delivered_to_warehouse",
      "delivered_to_requester",
      "rejected",
      "cancelled",
      "needs_item_revision",
      "purchase_cancelled",
    ] as any),
  ];
  if (delegateId) conditions.push(eq(purchaseOrderItems.delegateId, delegateId));

  return db
    .select({
      ...getTableColumns(purchaseOrderItems),
      purchaseOrderNumber: purchaseOrders.poNumber,
      purchaseOrderStatus: purchaseOrders.status,
      purchaseOrderCreatedAt: purchaseOrders.createdAt,
      purchaseOrderSubmittedAt: purchaseOrders.submittedAt,
      requestedById: purchaseOrders.requestedById,
      requestedByName: requesterUser.name,
      delegateName: delegateUser.name,
      pricingBatchStatus: poPricingBatches.status,
      itemMaintenancePath: ticketItems.maintenancePath,
    })
    .from(purchaseOrderItems)
    .innerJoin(purchaseOrders, eq(purchaseOrderItems.purchaseOrderId, purchaseOrders.id))
    .leftJoin(delegateUser, eq(purchaseOrderItems.delegateId, delegateUser.id))
    .leftJoin(requesterUser, eq(purchaseOrders.requestedById, requesterUser.id))
    .leftJoin(poPricingBatches, eq(purchaseOrderItems.batchId, poPricingBatches.id))
    .leftJoin(ticketItems, eq(purchaseOrders.ticketItemId, ticketItems.id))
    .where(and(...conditions))
    .orderBy(asc(purchaseOrderItems.requiredDate), asc(purchaseOrderItems.id));
}


/** جميع أصناف طلبات الشراء التي أنشأها مستخدم معيّن، لواجهة «متابعة أصنافي». */
export async function getPOItemsRequestedBy(requestedById: number) {
  const db = await getDb();
  if (!db) return [];
  const delegateUser = alias(users, "requestedItemDelegate");
  return db
    .select({
      ...getTableColumns(purchaseOrderItems),
      purchaseOrderNumber: purchaseOrders.poNumber,
      purchaseOrderStatus: purchaseOrders.status,
      purchaseOrderCreatedAt: purchaseOrders.createdAt,
      purchaseOrderSubmittedAt: purchaseOrders.submittedAt,
      delegateName: delegateUser.name,
    })
    .from(purchaseOrderItems)
    .innerJoin(purchaseOrders, eq(purchaseOrderItems.purchaseOrderId, purchaseOrders.id))
    .leftJoin(delegateUser, eq(purchaseOrderItems.delegateId, delegateUser.id))
    .where(and(
      eq(purchaseOrders.requestedById, requestedById),
      ne(purchaseOrders.status, "draft" as any),
    ))
    .orderBy(desc(purchaseOrderItems.updatedAt), desc(purchaseOrderItems.id));
}

/**
 * تاريخ بند واحد بالهوية الثابتة، لا بالاسم. يجمع السجل الموحد الجديد مع
 * المصادر التاريخية القائمة قبل إضافة الجدول (comments / audit / timestamps /
 * pricing batch / warehouse receipt) حتى لا يبدأ الـTimeline من يوم التحديث فقط.
 */
export async function getPOItemTimeline(itemId: number) {
  const db = await getDb();
  if (!db) return null;

  const delegateUser = alias(users, "timelineDelegate");
  const requesterUser = alias(users, "timelineRequester");
  const itemRows = await db
    .select({
      ...getTableColumns(purchaseOrderItems),
      purchaseOrderNumber: purchaseOrders.poNumber,
      purchaseOrderStatus: purchaseOrders.status,
      requestedById: purchaseOrders.requestedById,
      requestedByName: requesterUser.name,
      delegateName: delegateUser.name,
    })
    .from(purchaseOrderItems)
    .innerJoin(purchaseOrders, eq(purchaseOrderItems.purchaseOrderId, purchaseOrders.id))
    .leftJoin(delegateUser, eq(purchaseOrderItems.delegateId, delegateUser.id))
    .leftJoin(requesterUser, eq(purchaseOrders.requestedById, requesterUser.id))
    .where(eq(purchaseOrderItems.id, itemId))
    .limit(1);
  const item: any = itemRows[0];
  if (!item) return null;

  const historyActor = alias(users, "historyActor");
  let historyRows: any[] = [];
  try {
    historyRows = await db
      .select({
        id: purchaseOrderItemHistory.id,
        eventType: purchaseOrderItemHistory.eventType,
        previousStatus: purchaseOrderItemHistory.previousStatus,
        newStatus: purchaseOrderItemHistory.newStatus,
        previousDelegateId: purchaseOrderItemHistory.previousDelegateId,
        newDelegateId: purchaseOrderItemHistory.newDelegateId,
        actorUserId: purchaseOrderItemHistory.actorUserId,
        actorNameSnapshot: purchaseOrderItemHistory.actorName,
        actorNameCurrent: historyActor.name,
        note: purchaseOrderItemHistory.note,
        metadata: purchaseOrderItemHistory.metadata,
        createdAt: purchaseOrderItemHistory.createdAt,
      })
      .from(purchaseOrderItemHistory)
      .leftJoin(historyActor, eq(purchaseOrderItemHistory.actorUserId, historyActor.id))
      .where(eq(purchaseOrderItemHistory.purchaseOrderItemId, itemId))
      .orderBy(asc(purchaseOrderItemHistory.createdAt), asc(purchaseOrderItemHistory.id));
  } catch (error) {
    // التوافق الرجعي: إذا لم تُطبّق migration بعد نعرض السجل القديم من المصادر
    // القائمة بدل إسقاط شاشة المتابعة كلها. بعد إنشاء الجدول يبدأ التسجيل الجديد.
    console.error("[PO_ITEM_HISTORY] unable to read unified history table", { itemId, error });
  }

  const commentRows = await db
    .select()
    .from(procurementComments)
    .where(eq(procurementComments.purchaseOrderItemId, itemId))
    .orderBy(asc(procurementComments.createdAt), asc(procurementComments.id));

  const auditActor = alias(users, "auditActor");
  const auditRows = await db
    .select({
      id: auditLogs.id,
      action: auditLogs.action,
      oldValues: auditLogs.oldValues,
      newValues: auditLogs.newValues,
      createdAt: auditLogs.createdAt,
      userId: auditLogs.userId,
      actorName: auditActor.name,
    })
    .from(auditLogs)
    .leftJoin(auditActor, eq(auditLogs.userId, auditActor.id))
    .where(and(
      eq(auditLogs.entityType, "purchase_order_item"),
      eq(auditLogs.entityId, itemId),
    ))
    .orderBy(asc(auditLogs.createdAt), asc(auditLogs.id));

  const receiptActor = alias(users, "receiptActor");
  const receiptRows = await db
    .select({
      id: warehouseReceiptItems.id,
      receiptNumber: warehouseReceipts.receiptNumber,
      receiptStatus: warehouseReceipts.status,
      receivedAt: warehouseReceipts.receivedAt,
      receivedQuantity: warehouseReceiptItems.receivedQuantity,
      receivedById: warehouseReceipts.receivedById,
      receivedByName: receiptActor.name,
      invoiceNumber: warehouseReceipts.invoiceNumber,
      vendorName: warehouseReceipts.vendorName,
    })
    .from(warehouseReceiptItems)
    .innerJoin(warehouseReceipts, eq(warehouseReceiptItems.receiptId, warehouseReceipts.id))
    .leftJoin(receiptActor, eq(warehouseReceipts.receivedById, receiptActor.id))
    .where(eq(warehouseReceiptItems.purchaseOrderItemId, itemId))
    .orderBy(asc(warehouseReceipts.receivedAt), asc(warehouseReceiptItems.id));

  const currentBatchRows = item.batchId
    ? await db.select().from(poPricingBatches).where(eq(poPricingBatches.id, item.batchId)).limit(1)
    : [];
  const currentBatch: any = currentBatchRows[0] || null;

  const events: any[] = [{
    id: `created:${item.id}`,
    source: "item",
    eventType: "created",
    title: "إضافة الصنف إلى طلب الشراء",
    date: item.createdAt,
    actorUserId: item.requestedById,
    actorName: item.requestedByName || null,
    note: item.purchaseOrderNumber,
  }];

  for (const row of historyRows as any[]) {
    const statusTitle = row.eventType === "status_changed"
      ? ({
          pending: "أصبح الصنف بانتظار التسعير",
          estimated: "تم حفظ تسعير الصنف",
          approved: "تم اعتماد الصنف للشراء",
          funded: "تم تمويل الصنف",
          purchased: "تم شراء الصنف",
          delivered_to_warehouse: "وصل الصنف إلى المستودع",
          delivered_to_requester: "تم تسليم الصنف للطالب",
          needs_item_revision: "طُلبت مراجعة الصنف",
          purchase_cancelled: "أُلغي شراء الصنف",
          cancelled: "أُلغي الصنف نهائيًا",
          rejected: "رُفض الصنف",
        } as Record<string, string>)[String(row.newStatus || "")] || "تغيّرت حالة الصنف"
      : null;
    events.push({
      id: `history:${row.id}`,
      source: "history",
      eventType: row.eventType,
      title: statusTitle || (row.eventType === "delegate_changed" ? "تغيّر المندوب المسؤول"
        : row.eventType === "delegate_change_requested" ? "طُلب تغيير المندوب"
        : row.eventType === "pricing_batch_changed" ? "تغيّرت دفعة التسعير"
        : row.eventType === "estimate_updated" ? "تم تحديث التسعير"
        : row.eventType === "purchase_details_updated" ? "تم تحديث بيانات الشراء"
        : row.eventType === "warehouse_received" ? "تم تحديث بيانات الاستلام"
        : row.eventType === "delivered" ? "تم تحديث بيانات التسليم"
        : row.eventType === "returned" ? "تم تسجيل مرتجع"
        : "تحديث على الصنف"),
      date: row.createdAt,
      actorUserId: row.actorUserId,
      actorName: row.actorNameSnapshot || row.actorNameCurrent || null,
      previousStatus: row.previousStatus,
      newStatus: row.newStatus,
      previousDelegateId: row.previousDelegateId,
      newDelegateId: row.newDelegateId,
      note: row.note,
      metadata: row.metadata,
    });
  }

  for (const row of commentRows as any[]) {
    events.push({
      id: `comment:${row.id}`,
      source: "comment",
      eventType: row.actionType,
      title: "إجراء/ملاحظة على الصنف",
      date: row.createdAt,
      actorUserId: row.userId,
      actorName: row.userName,
      actorRole: row.userRole,
      note: row.note,
    });
  }

  for (const row of auditRows as any[]) {
    events.push({
      id: `audit:${row.id}`,
      source: "audit",
      eventType: row.action,
      title: "سجل تدقيق",
      date: row.createdAt,
      actorUserId: row.userId,
      actorName: row.actorName || null,
      oldValues: row.oldValues,
      newValues: row.newValues,
    });
  }

  // حقول زمنية تاريخية كانت موجودة قبل جدول history الجديد.
  const legacyDates = [
    [item.purchasedAt, "purchased", "تم شراء الصنف", item.purchasedById],
    [item.receivedAt, "received", "تم استلام الصنف", item.receivedById],
    [item.deliveredAt, "delivered", "تم تسليم الصنف", item.deliveredById],
    [item.returnedAt, "returned", "تم تسجيل مرتجع", null],
    [item.itemRevisionRequestedAt, "item_revision_requested", "طُلبت مراجعة الصنف", item.itemRevisionRequestedById],
    [item.purchaseCancelledAt, "purchase_cancelled", "أُلغي شراء الصنف", item.purchaseCancelledById],
    [item.delegateChangeRequestedAt, "delegate_change_requested", "طُلب تغيير المندوب", item.delegateChangeRequestedById],
  ] as const;
  const legacyStatusByEvent: Record<string, string | null> = {
    purchased: "purchased",
    received: "delivered_to_warehouse",
    delivered: "delivered_to_requester",
    item_revision_requested: "needs_item_revision",
    purchase_cancelled: "purchase_cancelled",
    delegate_change_requested: null,
    returned: null,
  };
  for (const [date, eventType, title, actorUserId] of legacyDates) {
    if (!date) continue;
    const targetTime = new Date(date as any).getTime();
    const expectedStatus = legacyStatusByEvent[eventType];
    const duplicatedByUnifiedHistory = (historyRows as any[]).some((row: any) => {
      const timeDiff = Math.abs(new Date(row.createdAt || 0).getTime() - targetTime);
      if (timeDiff > 60_000) return false;
      if (eventType === "delegate_change_requested") return row.eventType === "delegate_change_requested";
      return expectedStatus ? row.eventType === "status_changed" && row.newStatus === expectedStatus : false;
    });
    if (duplicatedByUnifiedHistory) continue;

    events.push({
      id: `legacy:${eventType}:${String(date)}`,
      source: "legacy_field",
      eventType,
      title,
      date,
      actorUserId,
      note: eventType === "returned" ? item.returnReason
        : eventType === "item_revision_requested" ? item.itemRevisionNote
        : eventType === "purchase_cancelled" ? item.purchaseCancelReason
        : eventType === "delegate_change_requested" ? item.delegateChangeReason
        : null,
    });
  }

  if (currentBatch) {
    const batchEvents = [
      [currentBatch.submittedAt, "pricing_submitted", "أُرسل تسعير الصنف ضمن دفعة للحسابات", currentBatch.submittedById],
      [currentBatch.accountingApprovedAt, "accounting_approved", "اعتمدت الحسابات دفعة التسعير", currentBatch.accountingApprovedById],
      [currentBatch.managementApprovedAt, "management_approved", "اعتمدت الإدارة دفعة التسعير", currentBatch.managementApprovedById],
      [currentBatch.rejectedAt, "pricing_rejected", "رُفضت دفعة التسعير", currentBatch.rejectedById],
    ] as const;
    for (const [date, eventType, title, actorUserId] of batchEvents) {
      if (!date) continue;
      events.push({
        id: `batch:${currentBatch.id}:${eventType}`,
        source: "pricing_batch",
        eventType,
        title,
        date,
        actorUserId,
        note: eventType === "pricing_rejected" ? currentBatch.rejectionReason : null,
        batchNumber: currentBatch.batchNumber,
      });
    }
  }

  for (const row of receiptRows as any[]) {
    events.push({
      id: `receipt:${row.id}`,
      source: "warehouse_receipt",
      eventType: "warehouse_receipt",
      title: `استلام مستودع ${row.receiptNumber || ""}`.trim(),
      date: row.receivedAt,
      actorUserId: row.receivedById,
      actorName: row.receivedByName || null,
      note: [row.vendorName, row.invoiceNumber ? `فاتورة ${row.invoiceNumber}` : null].filter(Boolean).join(" — ") || null,
      quantity: row.receivedQuantity,
      receiptStatus: row.receiptStatus,
    });
  }

  // أكمل أسماء المنفذين للأحداث التاريخية التي كانت تحفظ ID فقط.
  const actorIds = Array.from(new Set(events
    .filter((event: any) => !event.actorName && Number(event.actorUserId) > 0)
    .map((event: any) => Number(event.actorUserId))));
  if (actorIds.length > 0) {
    const actorRows = await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, actorIds));
    const actorNameById = new Map(actorRows.map(row => [Number(row.id), row.name]));
    for (const event of events) {
      if (!event.actorName && Number(event.actorUserId) > 0) {
        event.actorName = actorNameById.get(Number(event.actorUserId)) || null;
      }
    }
  }

  events.sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime());

  return {
    item: {
      id: item.id,
      purchaseOrderId: item.purchaseOrderId,
      purchaseOrderNumber: item.purchaseOrderNumber,
      itemName: item.itemName,
      status: item.status,
      quantity: item.quantity,
      unit: item.unit,
      delegateId: item.delegateId,
      delegateName: item.delegateName,
      requestedById: item.requestedById,
      requestedByName: item.requestedByName,
    },
    events,
  };
}

export async function updatePOItem(id: number, data: any, tx?: any, historyMeta?: POItemHistoryMeta, expectedBatchId?: number | null) {
  const db = tx || await getDb();
  if (!db) return;
  if (pricingBundlesEnabled() && ["estimatedUnitCost", "estimatedTotalCost", "quantity", "unit", "itemName", "supplierName"].some(key => key in data)) {
    if (!tx) return db.transaction((locked: any) => updatePOItem(id, data, locked, historyMeta, expectedBatchId));
    const [current] = await tx.select({ id: purchaseOrderItems.id, batchId: purchaseOrderItems.batchId }).from(purchaseOrderItems).where(eq(purchaseOrderItems.id, id)).for("update");
    if (expectedBatchId !== undefined && current?.batchId !== expectedBatchId) throw new Error("تغير إرسال الصنف للحسابات؛ حدّث الصفحة قبل التعديل");
    await assertItemOutsidePricingBundle(tx, id);
  }
  const before = await readPOItemHistorySnapshot(db, id);
  await db.update(purchaseOrderItems).set(data).where(eq(purchaseOrderItems.id, id));
  await recordPOItemMutationHistory(db, before, data, historyMeta);
}

/**
 * تحديث صنف فقط إذا لم يكن في حالة نهائية مرجعية.
 * يُستخدم داخل مراجعة الأصناف لمنع سباق التزامن مع إلغاء الصنف: إذا أُلغي
 * الصنف قبل لحظة الكتابة فلن يستطيع مسار المراجعة إعادته إلى pending.
 */
export async function updatePOItemIfNotTerminal(id: number, data: any, tx?: any, historyMeta?: POItemHistoryMeta): Promise<boolean> {
  const db = tx || await getDb();
  if (!db) return false;
  const before = await readPOItemHistorySnapshot(db, id);
  const result: any = await db
    .update(purchaseOrderItems)
    .set(data)
    .where(and(
      eq(purchaseOrderItems.id, id),
      notInArray(purchaseOrderItems.status, ["cancelled", "rejected"] as any),
    ));
  if (Number(result?.[0]?.affectedRows ?? 0) === 1) {
    await recordPOItemMutationHistory(db, before, data, historyMeta);
    return true;
  }

  const row = await db
    .select({ status: purchaseOrderItems.status })
    .from(purchaseOrderItems)
    .where(eq(purchaseOrderItems.id, id))
    .limit(1);
  return !!row[0] && !["cancelled", "rejected"].includes(row[0].status);
}

/**
 * تحديث شرطي يمنع سباق التزامن بين طلب تغيير المندوب وحفظ السعر.
 * يمكن كذلك اشتراط بقاء الصنف على حالة محددة حتى لحظة الكتابة، لمنع إعادة
 * تنشيط صنف أُلغي بالتزامن مع حفظ السعر.
 */
export async function updatePOItemIfDelegateChangeUnlocked(
  id: number,
  data: any,
  expectedStatus?: string,
  historyMeta?: POItemHistoryMeta,
  tx?: any,
  expectedBatchId?: number | null,
  expectedDelegateId?: number,
): Promise<boolean> {
  const db = tx || await getDb();
  if (!db) return false;
  if (pricingBundlesEnabled() || expectedDelegateId!==undefined) {
    if (!tx) return db.transaction((locked: any) => updatePOItemIfDelegateChangeUnlocked(id, data, expectedStatus, historyMeta, locked, expectedBatchId,expectedDelegateId));
    await tx.select({ id: purchaseOrderItems.id }).from(purchaseOrderItems).where(eq(purchaseOrderItems.id, id)).for("update");
    if(pricingBundlesEnabled())await assertItemOutsidePricingBundle(tx, id);
  }
  const before = await readPOItemHistorySnapshot(db, id);
  const conditions = [
    eq(purchaseOrderItems.id, id),
    isNull(purchaseOrderItems.delegateChangeRequestedAt),
  ];
  if(expectedDelegateId!==undefined)conditions.push(eq(purchaseOrderItems.delegateId,expectedDelegateId));
  if (pricingBundlesEnabled() && expectedBatchId !== undefined) conditions.push(expectedBatchId == null ? isNull(purchaseOrderItems.batchId) : eq(purchaseOrderItems.batchId, expectedBatchId));
  if (expectedStatus) {
    conditions.push(eq(purchaseOrderItems.status, expectedStatus as any));
  }
  const result: any = await db
    .update(purchaseOrderItems)
    .set(data)
    .where(and(...conditions));
  if (Number(result?.[0]?.affectedRows ?? 0) === 1) {
    await recordPOItemMutationHistory(db, before, data, historyMeta);
    return true;
  }

  // قد يعيد MySQL صفرًا إذا كانت القيم الجديدة مطابقة تمامًا رغم مطابقة WHERE.
  // نميّز ذلك عن حالة القفل/تغير الحالة بإعادة قراءة الحقول الحاكمة.
  const row = await db
    .select({
      delegateChangeRequestedAt: purchaseOrderItems.delegateChangeRequestedAt,
      status: purchaseOrderItems.status,
      batchId: purchaseOrderItems.batchId,
      delegateId: purchaseOrderItems.delegateId,
    })
    .from(purchaseOrderItems)
    .where(eq(purchaseOrderItems.id, id))
    .limit(1);
  return !!row[0]
    && !row[0].delegateChangeRequestedAt
    && (!expectedStatus || row[0].status === expectedStatus)
    && (expectedDelegateId===undefined || row[0].delegateId===expectedDelegateId)
    && (!pricingBundlesEnabled() || expectedBatchId === undefined || row[0].batchId === expectedBatchId);
}

/** تسجيل طلب تغيير المندوب بصورة ذرية: لا ينجح إذا بدأ التسعير أو سبق تقديم طلب. */
export async function requestPOItemDelegateChangeAtomic(input: {
  itemId: number;
  delegateId: number;
  reason: string;
  requestedAt: Date;
  actorName?: string | null;
}): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const before = await readPOItemHistorySnapshot(db, input.itemId);
  const patch = {
    delegateChangeRequestedById: input.delegateId,
    delegateChangeReason: input.reason,
    delegateChangeRequestedAt: input.requestedAt,
  };
  const result: any = await db
    .update(purchaseOrderItems)
    .set(patch)
    .where(and(
      eq(purchaseOrderItems.id, input.itemId),
      eq(purchaseOrderItems.delegateId, input.delegateId),
      eq(purchaseOrderItems.status, "pending"),
      isNull(purchaseOrderItems.batchId),
      isNull(purchaseOrderItems.estimatedUnitCost),
      isNull(purchaseOrderItems.delegateChangeRequestedAt),
    ));
  const ok = Number(result?.[0]?.affectedRows ?? 0) === 1;
  if (ok) {
    await recordPOItemMutationHistory(db, before, patch, {
      actorUserId: input.delegateId,
      actorName: input.actorName ?? null,
      eventType: "delegate_change_requested",
      note: input.reason,
    });
  }
  return ok;
}

/** حسم طلب تغيير المندوب بصورة ذرية مع إبقاء الصنف pending وجاهزًا للتسعير. */
export async function resolvePOItemDelegateChangeAtomic(input: {
  itemId: number;
  newDelegateId: number;
  actorUserId?: number | null;
  actorName?: string | null;
  reviewRole?: string | null;
  reviewedById?: number | null;
}, tx?: any): Promise<boolean> {
  const db = tx || await getDb();
  if (!db) return false;
  const before = await readPOItemHistorySnapshot(db, input.itemId);
  const patch = {
    delegateId: input.newDelegateId,
    ...(before?.delegateId !== input.newDelegateId ? { delegateAssignedAt: new Date() } : {}),
    status: "pending",
    batchId: null,
    delegateChangeRequestedById: null,
    delegateChangeReason: null,
    delegateChangeRequestedAt: null,
  };
  const result: any = await db
    .update(purchaseOrderItems)
    .set(patch)
    .where(and(
      eq(purchaseOrderItems.id, input.itemId),
      ...(input.reviewRole ? [eq(purchaseOrderItems.reviewRole, input.reviewRole as any), eq(purchaseOrderItems.reviewedById, Number(input.reviewedById))] : []),
      eq(purchaseOrderItems.status, "pending"),
      isNull(purchaseOrderItems.batchId),
      isNotNull(purchaseOrderItems.delegateChangeRequestedAt),
    ));
  const ok = Number(result?.[0]?.affectedRows ?? 0) === 1;
  if (ok) {
    await recordPOItemMutationHistory(db, before, patch, {
      actorUserId: input.actorUserId ?? null,
      actorName: input.actorName ?? null,
      eventType: "delegate_changed",
      note: "تم حسم طلب تغيير المندوب",
    });
  }
  return ok;
}

export async function getPOItemById(id: number, tx?: any) {
  const db = tx || await getDb();
  if (!db) return null;
  const result = await db.select().from(purchaseOrderItems).where(eq(purchaseOrderItems.id, id)).limit(1);
  return result[0] || null;
}

// ============================================================
// PO PRICING BATCHES (دفعات التسعير)
// ============================================================
export async function createPOPricingBatch(data: InsertPOPricingBatch, tx?: any) {
  const db = tx || await getDb();
  if (!db) return null;
  const result = await db.insert(poPricingBatches).values(data);
  return result[0].insertId;
}

export async function getNextBatchNumber(purchaseOrderId: number, tx?: any) {
  const db = tx || await getDb();
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

/** Approval metadata for list cards, without a query per purchase order. */
export async function getPOPricingBatchesForPOs(purchaseOrderIds: number[]) {
  if (!purchaseOrderIds.length) return [];
  const db = await getDb();
  if (!db) throw new Error("تعذر التحقق من اعتماد مستندات الشراء");
  const result: Array<typeof poPricingBatches.$inferSelect> = [];
  for (let offset = 0; offset < purchaseOrderIds.length; offset += 500) {
    result.push(...await db.select().from(poPricingBatches).where(inArray(poPricingBatches.purchaseOrderId, purchaseOrderIds.slice(offset, offset + 500))));
  }
  return result;
}

export async function getPurchaseDocumentItemsForPOs(purchaseOrderIds: number[]) {
  if (!purchaseOrderIds.length) return [];
  const db = await getDb();
  if (!db) throw new Error("تعذر التحقق من أصناف مستندات الشراء");
  const result: any[] = [];
  for (let offset = 0; offset < purchaseOrderIds.length; offset += 500) {
    result.push(...await db.select({ purchaseOrderId: purchaseOrderItems.purchaseOrderId, batchId: purchaseOrderItems.batchId,
      status: purchaseOrderItems.status, estimatedUnitCost: purchaseOrderItems.estimatedUnitCost, actualUnitCost: purchaseOrderItems.actualUnitCost })
      .from(purchaseOrderItems).where(inArray(purchaseOrderItems.purchaseOrderId, purchaseOrderIds.slice(offset, offset + 500))));
  }
  return result;
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
// أداء — مرجع رسمي — لا تُعِد بنود دورة الشراء لحلقة "استعلام لكل بند"
// ══════════════════════════════════════════════════════════════════════════════
//
// المشكلة التي يحلّها هذا الاستعلام:
//   إثراء كل بند شراء ببيانات (طلب الشراء / البلاغ المرتبط / سجل الصيانة الخارجية)
//   كان يتم سابقًا بدالة تُستدعى لكل بند على حدة (getPurchaseOrderTicketContext)،
//   أي رحلتين إلى ثلاث رحلات لقاعدة البيانات × عدد البنود، بالتتابع أحيانًا.
//   مع قاعدة بيانات بعيدة (سحابية) هذا يعني تأخيرًا محسوسًا يتضاعف مع كل بند إضافي.
//
// الحل الدائم: استعلام JOIN واحد يجلب كل السياق لكل أوامر الشراء المطلوبة دفعة
// واحدة، ثم يُبنى Map في الذاكرة لإثراء البنود محليًا بدون أي رحلة إضافية.
//
// القاعدة الذهبية لأي مطوّر/نموذج يعمل على هذا الملف مستقبلًا:
//   لو احتجت بيانات مرتبطة (po/ticket/...) لقائمة بنود، لا تكتب حلقة await لكل
//   بند — أضف حقلها لهذا الاستعلام المجمّع (أو استعلام JOIN مشابه) واستخدمه.
// ══════════════════════════════════════════════════════════════════════════════
export async function getPurchaseOrderTicketContextBatch(purchaseOrderIds: number[]) {
  type Context = { po: any; ticket: any; externalJob: any };
  const contextMap = new Map<number, Context>();
  const db = await getDb();
  const uniqueIds = Array.from(new Set(purchaseOrderIds.filter((id): id is number => !!id)));
  if (!db || uniqueIds.length === 0) return contextMap;

  const rows = await db
    .select({
      po: purchaseOrders,
      ticket: tickets,
      externalJob: externalMaintenanceJobs,
    })
    .from(purchaseOrders)
    .leftJoin(tickets, eq(purchaseOrders.ticketId, tickets.id))
    .leftJoin(externalMaintenanceJobs, eq(externalMaintenanceJobs.purchaseOrderId, purchaseOrders.id))
    .where(inArray(purchaseOrders.id, uniqueIds));

  for (const row of rows) {
    contextMap.set(row.po.id, { po: row.po, ticket: row.ticket, externalJob: row.externalJob });
  }
  return contextMap;
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


/**
 * جلب أصناف عدة طلبات دفعة واحدة — لتفادي استعلام منفصل لكل طلب (N+1)
 * عند بناء قائمة "بانتظار إجرائي".
 */
export async function getPOItemsForPOs(poIds: number[]) {
  const db = await getDb();
  if (!db || poIds.length === 0) return [];
  return readScopeChunks(poIds, ids => db
    .select({
      id: purchaseOrderItems.id,
      purchaseOrderId: purchaseOrderItems.purchaseOrderId,
      status: purchaseOrderItems.status,
      delegateId: purchaseOrderItems.delegateId,
      reviewRole: purchaseOrderItems.reviewRole,
      reviewedById: purchaseOrderItems.reviewedById,
      reviewedAt: purchaseOrderItems.reviewedAt,
      batchId: purchaseOrderItems.batchId,
      delegateChangeRequestedAt: purchaseOrderItems.delegateChangeRequestedAt,
    })
    .from(purchaseOrderItems)
    .where(inArray(purchaseOrderItems.purchaseOrderId, ids)));
}

// ============================================================
// PURCHASE PACKAGES (PB) — حاوية عليا فوق طلبات الشراء (2026-08-29)
//
// المبدأ: "الحزمة مرآة لطلب الشراء، لا آلية جديدة". كل دالة هنا تكتب فقط
// على purchase_packages / purchase_orders.packageId / الجداول الجديدة —
// صفر استدعاء لأي دالة تغيّر حالة طلب أو صنف، وصفر استدعاء لمزامنة
// البلاغ (syncPathBTicketFromPurchaseOrder). راجع الخطة المتفق عليها:
// معايير القبول 1-16.
// ============================================================

/**
 * توليد رقم الحزمة التالي عبر عدّاد مستقل (INSERT فيُرجِع insertId) —
 * لا يعتمد على SELECT MAX الذي يعيد استخدام الرقم بعد الحذف (نفس السبب
 * الذي وثّقناه سابقًا في مشكلة ترقيم البلاغات الحقيقية بالإنتاج).
 * بخلاف ticket_number_counter (أُنشئ جدوله ولم يُربط فعليًا بالكود قط)،
 * هذه الدالة تكتب فعليًا في purchase_package_number_counter من أول استخدام.
 */
export async function getNextPurchasePackageNumber(tx?: any): Promise<string> {
  const db = tx || await getDb();
  const year = new Date().getFullYear();
  if (!db) return `PB-${year}-00001`;
  const result: any = await db
    .insert(purchasePackageNumberCounter)
    .values({ year });
  const seq = Number(result[0]?.insertId ?? 0);
  return `PB-${year}-${String(seq).padStart(5, "0")}`;
}

/**
 * إنشاء حزمة شراء جديدة تضم عدة طلبات شراء قائمة. لا تغيّر حالة أي طلب
 * أو صنف، ولا تستدعي أي مزامنة بلاغ — تكتب فقط رأس الحزمة وعمود الربط.
 * الشرط (طلبات pending_review وغير منتمية لحزمة أخرى) يُتحقَّق منه في
 * طبقة الراوتر (المرحلة 3)، لا هنا، إبقاءً لهذه الدالة كتابة صرفة.
 */
export async function createPurchasePackage(
  orderIds: number[],
  createdById: number,
  notes?: string
): Promise<{ id: number; packageNumber: string } | null> {
  const db = await getDb();
  if (!db || orderIds.length === 0) return null;

  const packageNumber = await getNextPurchasePackageNumber();
  const result: any = await db.insert(purchasePackages).values({
    packageNumber,
    createdById,
    notes: notes || null,
  });
  const packageId = Number(result[0]?.insertId);

  await db
    .update(purchaseOrders)
    .set({ packageId })
    .where(inArray(purchaseOrders.id, orderIds));

  return { id: packageId, packageNumber };
}

export async function getPurchasePackageById(id: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(purchasePackages).where(eq(purchasePackages.id, id)).limit(1);
  return rows[0] || null;
}

/** كل طلبات الشراء المنتمية لحزمة معيّنة — بلا تعديل على شكلها الحالي. */
export async function getPurchaseOrdersByPackage(packageId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(purchaseOrders).where(eq(purchaseOrders.packageId, packageId)).orderBy(purchaseOrders.id);
}

export async function getPurchasePackagesList() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(purchasePackages).orderBy(desc(purchasePackages.createdAt));
}

/**
 * إضافة طلب شراء قائم إلى حزمة موجودة. التحقق من أن الطلب pending_review
 * وغير منتمٍ لحزمة أخرى يقع في طبقة الراوتر.
 */
export async function addOrderToPackage(packageId: number, orderId: number) {
  const db = await getDb();
  if (!db) return;
  await db.update(purchaseOrders).set({ packageId }).where(eq(purchaseOrders.id, orderId));
}

/** إخراج طلب من حزمته — تصفير العمود فقط، الطلب نفسه بلا أي تغيير آخر. */
export async function removeOrderFromPackage(orderId: number) {
  const db = await getDb();
  if (!db) return;
  await db.update(purchaseOrders).set({ packageId: null }).where(eq(purchaseOrders.id, orderId));
}

/**
 * حذف حزمة: تصفير packageId على كل طلباتها ثم حذف رأس الحزمة. الطلبات
 * والأصناف تعود لسلوكها الحالي حرفيًا — هذا هو اختبار التراجع (معيار 11).
 */
export async function deletePurchasePackage(packageId: number) {
  const db = await getDb();
  if (!db) return;
  await db.update(purchaseOrders).set({ packageId: null }).where(eq(purchaseOrders.packageId, packageId));
  await db.delete(purchasePackages).where(eq(purchasePackages.id, packageId));
}

/**
 * إنشاء دفعة فرعية جديدة (PB01-1, PB01-2...) لتتبّع إرسال واحد من
 * المندوب قد يضم أصنافًا من عدة طلبات داخل نفس الحزمة. subNumber يُحسب
 * تسلسليًا داخل نفس الحزمة فقط (عدّاد محلي بالحزمة، لا عالمي).
 */
export async function createPurchasePackageSubmission(
  purchasePackageId: number,
  createdById: number,
  tx?: any
): Promise<{ id: number; subNumber: number } | null> {
  const db = tx || await getDb();
  if (!db) return null;

  const lastSub = await db
    .select({ subNumber: purchasePackageSubmissions.subNumber })
    .from(purchasePackageSubmissions)
    .where(eq(purchasePackageSubmissions.purchasePackageId, purchasePackageId))
    .orderBy(desc(purchasePackageSubmissions.subNumber))
    .limit(1);
  const subNumber = (lastSub[0]?.subNumber ?? 0) + 1;

  const result: any = await db.insert(purchasePackageSubmissions).values({
    purchasePackageId,
    subNumber,
    createdById,
  });
  return { id: Number(result[0]?.insertId), subNumber };
}

/**
 * [PB] كل دفعات التسعير المنتمية لدفعة فرعية واحدة (إرسال واحد من المندوب).
 * هذه هي الرابطة التي تجعل عدة دفعات تسعير — واحدة لكل طلب — تُعرض وتُعتمد
 * وتُوثَّق كوحدة واحدة، دون أن تتحول لدفعة تسعير عابرة للطلبات.
 */
export async function getPricingBatchesBySubmission(submissionId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(poPricingBatches)
    .where(eq(poPricingBatches.purchasePackageSubmissionId, submissionId))
    .orderBy(asc(poPricingBatches.id));
}

/**
 * [PB] كل الدفعات الفرعية لحزمة، مع دفعات التسعير التابعة لكل منها.
 * تُستخدم في عرض الحسابات المجمّع.
 */
export async function getPackageSubmissionsWithBatches(purchasePackageId: number) {
  const db = await getDb();
  if (!db) return [];
  return getPackageSubmissionsWithBatchesForPackages([purchasePackageId], db);
}

export async function getPurchasePackageSubmissionById(id: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(purchasePackageSubmissions).where(eq(purchasePackageSubmissions.id, id)).limit(1);
  return rows[0] || null;
}

/**
 * [PB-ACC 2026-08-31] اعتماد الحالة المحاسبية لدفعة إرسال كاملة داخل
 * معاملة قاعدة بيانات واحدة. هذه الدالة لا تستبدل اعتماد دفعة التسعير
 * القديمة؛ هي مسار إضافي خاص بـ purchase_package_submissions فقط.
 *
 * التحديث الذري يشمل:
 * - كل Pricing Batches التابعة للإرسال -> pending_management
 * - حالة طلب الشراء العامة فقط إذا لم تبق له دفعة pending_accounting أخرى
 * - سجل دفعة الإرسال نفسه + إجمالي رصيد العهد
 *
 * لا تغيّر حالات الأصناف ولا الشراء ولا الاستلام.
 */
export async function approvePackageSubmissionAccountingAtomic(args: {
  submissionId: number;
  actorId: number;
  custodyBalance: string;
  accountingSignatureSnapshot: string;
}) {
  const database = await getDb();
  if (!database) throw new Error("DATABASE_UNAVAILABLE");

  return database.transaction(async (tx: any) => {
    const submissionRows = await tx
      .select()
      .from(purchasePackageSubmissions)
      .where(eq(purchasePackageSubmissions.id, args.submissionId))
      .limit(1);
    const submission = submissionRows[0];
    if (!submission) throw new Error("PACKAGE_SUBMISSION_NOT_FOUND");
    if (submission.status && submission.status !== "pending_accounting") {
      throw new Error("PACKAGE_SUBMISSION_STATUS_CONFLICT");
    }

    // نحجز سجل دفعة الإرسال أولاً بشرط حالته الحالية لمنع ضغط اعتماد مزدوج
    // متزامن. إذا سبق طلب آخر واعتمدها، affectedRows=0 ونلغي المعاملة.
    const approvedAt = new Date();
    const claimResult: any = await tx
      .update(purchasePackageSubmissions)
      .set({
        custodyBalance: args.custodyBalance,
        status: "pending_management",
        accountingApprovedById: args.actorId,
        accountingApprovedAt: approvedAt as any,
        accountingSignatureSnapshot: args.accountingSignatureSnapshot,
      })
      .where(and(
        eq(purchasePackageSubmissions.id, args.submissionId),
        or(
          isNull(purchasePackageSubmissions.status),
          eq(purchasePackageSubmissions.status, "pending_accounting"),
        ),
      ));
    if (Number(claimResult?.[0]?.affectedRows ?? 0) !== 1) {
      throw new Error("PACKAGE_SUBMISSION_STATUS_CONFLICT");
    }

    const batches = await tx
      .select()
      .from(poPricingBatches)
      .where(eq(poPricingBatches.purchasePackageSubmissionId, args.submissionId))
      .orderBy(asc(poPricingBatches.id));

    if (batches.length === 0) throw new Error("PACKAGE_SUBMISSION_HAS_NO_BATCHES");
    if (batches.some((batch: any) => !["pending_accounting", "rejected"].includes(batch.status))) {
      throw new Error("PACKAGE_SUBMISSION_BATCH_STATUS_CONFLICT");
    }

    const approvableBatches = (batches as any[]).filter((batch: any) => batch.status === "pending_accounting");
    if (approvableBatches.length === 0) throw new Error("PACKAGE_SUBMISSION_HAS_NO_APPROVABLE_BATCHES");

    // دفاع أخير داخل المعاملة: لا نعتمد دفعة تسعير بلا أصناف فعالة.
    let activeEstimatedTotal = 0;
    for (const batch of approvableBatches) {
      const batchItems = await tx
        .select({
          id: purchaseOrderItems.id,
          status: purchaseOrderItems.status,
          estimatedTotalCost: purchaseOrderItems.estimatedTotalCost,
        })
        .from(purchaseOrderItems)
        .where(eq(purchaseOrderItems.batchId, batch.id));
      const activeItems = batchItems.filter((item: any) => !["cancelled", "rejected"].includes(item.status));
      if (activeItems.length === 0) {
        throw new Error(`PACKAGE_SUBMISSION_EMPTY_BATCH:${batch.id}`);
      }
      activeEstimatedTotal += activeItems.reduce(
        (sum: number, item: any) => sum + Number(item.estimatedTotalCost || 0),
        0,
      );
    }

    await tx
      .update(poPricingBatches)
      .set({
        status: "pending_management",
        accountingApprovedById: args.actorId,
        accountingApprovedAt: approvedAt as any,
        accountingSignatureSnapshot: args.accountingSignatureSnapshot,
      })
      .where(and(
        eq(poPricingBatches.purchasePackageSubmissionId, args.submissionId),
        eq(poPricingBatches.status, "pending_accounting"),
      ));

    const poIds = Array.from(new Set(approvableBatches.map((batch: any) => Number(batch.purchaseOrderId))));
    for (const poId of poIds) {
      const poRows = await tx
        .select({ id: purchaseOrders.id, status: purchaseOrders.status })
        .from(purchaseOrders)
        .where(eq(purchaseOrders.id, poId))
        .limit(1);
      const po = poRows[0];
      if (!po || po.status !== "pending_accounting") continue;

      const stillPending = await tx
        .select({ id: poPricingBatches.id })
        .from(poPricingBatches)
        .where(and(
          eq(poPricingBatches.purchaseOrderId, poId),
          eq(poPricingBatches.status, "pending_accounting"),
        ))
        .limit(1);

      if (stillPending.length === 0) {
        await tx
          .update(purchaseOrders)
          .set({ status: "pending_management" })
          .where(eq(purchaseOrders.id, poId));
      }
    }

    const totalEstimatedCost = activeEstimatedTotal.toFixed(2);

    await tx
      .update(purchasePackageSubmissions)
      .set({ totalEstimatedCost })
      .where(eq(purchasePackageSubmissions.id, args.submissionId));

    return {
      submissionId: args.submissionId,
      purchasePackageId: Number(submission.purchasePackageId),
      subNumber: Number(submission.subNumber),
      totalEstimatedCost,
      batchIds: approvableBatches.map((batch: any) => Number(batch.id)),
      poIds,
      batches: approvableBatches,
    };
  });
}

/**
 * [PB-MGMT 2026-08-31] اعتماد الإدارة العليا لدفعة إرسال كاملة داخل
 * معاملة قاعدة بيانات واحدة. هذا مسار إضافي للحزم فقط ولا يستبدل
 * approveManagementBatch للطلب المفرد.
 *
 * داخل المعاملة:
 * - يمكن رفض أصناف محددة من نفس دفعة الإرسال قبل الاعتماد النهائي.
 * - دفعة التسعير التي لا يبقى فيها صنف فعّال تصبح rejected.
 * - بقية دفعات التسعير تصبح approved وأصنافها الفعالة تصبح approved.
 * - حالة طلب الشراء تُحسم بنفس قاعدة المسار الحالي بعد انتهاء دفعاته.
 * - سجل purchase_package_submissions يصبح approved أو rejected.
 *
 * لا شراء ولا استلام ولا تغيير لأي ارتباط batchId/packageId.
 */
export async function approvePackageSubmissionManagementAtomic(args: {
  submissionId: number;
  actorId: number;
  rejections?: Array<{ itemId: number; reason: string }>;
}) {
  const database = await getDb();
  if (!database) throw new Error("DATABASE_UNAVAILABLE");

  return database.transaction(async (tx: any) => {
    const submissionRows = await tx
      .select()
      .from(purchasePackageSubmissions)
      .where(eq(purchasePackageSubmissions.id, args.submissionId))
      .limit(1);
    const submission = submissionRows[0];
    if (!submission) throw new Error("PACKAGE_SUBMISSION_NOT_FOUND");
    if (submission.status !== "pending_management") {
      throw new Error("PACKAGE_SUBMISSION_STATUS_CONFLICT");
    }

    // نحجز الاعتماد بدون تغيير الحالة النهائية بعد، حتى نستطيع تحديد ما إذا
    // كانت النتيجة approved أو rejected بعد معالجة رفض الأصناف. أي خطأ لاحق
    // يلغي كامل المعاملة بما فيها هذا الحجز.
    const approvedAt = new Date();
    const claimResult: any = await tx
      .update(purchasePackageSubmissions)
      .set({
        managementApprovedById: args.actorId,
        managementApprovedAt: approvedAt as any,
      })
      .where(and(
        eq(purchasePackageSubmissions.id, args.submissionId),
        eq(purchasePackageSubmissions.status, "pending_management"),
        isNull(purchasePackageSubmissions.managementApprovedAt),
      ));
    if (Number(claimResult?.[0]?.affectedRows ?? 0) !== 1) {
      throw new Error("PACKAGE_SUBMISSION_STATUS_CONFLICT");
    }

    const batches = await tx
      .select()
      .from(poPricingBatches)
      .where(eq(poPricingBatches.purchasePackageSubmissionId, args.submissionId))
      .orderBy(asc(poPricingBatches.id));

    if (batches.length === 0) throw new Error("PACKAGE_SUBMISSION_HAS_NO_BATCHES");
    if (batches.some((batch: any) => !["pending_management", "rejected"].includes(batch.status))) {
      throw new Error("PACKAGE_SUBMISSION_BATCH_STATUS_CONFLICT");
    }

    const approvableBatches = (batches as any[]).filter((batch: any) => batch.status === "pending_management");
    if (approvableBatches.length === 0) throw new Error("PACKAGE_SUBMISSION_HAS_NO_APPROVABLE_BATCHES");

    const batchIds = approvableBatches.map((batch: any) => Number(batch.id));
    const poIds = Array.from(new Set(approvableBatches.map((batch: any) => Number(batch.purchaseOrderId))));

    // صورة حالية لكل أصناف دفعات هذه الإرسال قبل تنفيذ أي رفض، للتحقق أن
    // كل itemId مرسل من الواجهة يخص هذه الدفعة فعلًا ولم يتغير لحالة نهائية.
    const itemsByBatch = new Map<number, any[]>();
    const itemById = new Map<number, any>();
    for (const batch of approvableBatches) {
      const batchItems = await tx
        .select()
        .from(purchaseOrderItems)
        .where(eq(purchaseOrderItems.batchId, batch.id));
      itemsByBatch.set(Number(batch.id), batchItems as any[]);
      for (const item of batchItems as any[]) itemById.set(Number(item.id), item);
    }

    const requestedRejections = args.rejections ?? [];
    const seenRejectionIds = new Set<number>();
    const rejectedItems: Array<{
      itemId: number;
      itemName: string;
      poId: number;
      reason: string;
    }> = [];

    for (const rejection of requestedRejections) {
      if (seenRejectionIds.has(rejection.itemId)) throw new Error("PACKAGE_SUBMISSION_DUPLICATE_REJECTION");
      seenRejectionIds.add(rejection.itemId);

      const item = itemById.get(Number(rejection.itemId));
      if (!item) throw new Error("PACKAGE_SUBMISSION_REJECTION_ITEM_NOT_FOUND");
      if (["rejected", "cancelled"].includes(item.status)) {
        throw new Error("PACKAGE_SUBMISSION_REJECTION_ITEM_STATUS_CONFLICT");
      }

      const reason = String(rejection.reason || "").trim();
      if (reason.length < 10) throw new Error("PACKAGE_SUBMISSION_REJECTION_REASON_INVALID");

      const updateResult: any = await tx
        .update(purchaseOrderItems)
        .set({ status: "rejected", managementRejectionReason: reason })
        .where(and(
          eq(purchaseOrderItems.id, Number(item.id)),
          notInArray(purchaseOrderItems.status, ["rejected", "cancelled"]),
        ));
      if (Number(updateResult?.[0]?.affectedRows ?? 0) !== 1) {
        throw new Error("PACKAGE_SUBMISSION_REJECTION_ITEM_STATUS_CONFLICT");
      }

      rejectedItems.push({
        itemId: Number(item.id),
        itemName: String(item.itemName || `صنف #${item.id}`),
        poId: Number(item.purchaseOrderId),
        reason,
      });
    }

    const approvedBatchIds: number[] = [];
    const rejectedBatchIds: number[] = [];

    // نحسم كل دفعة تسعير وفق الأصناف المتبقية بعد الرفض. هذه نفس دلالة
    // approveManagementBatch الحالية: صفر أصناف فعالة = رفض الدفعة، وإلا
    // اعتماد الدفعة واعتماد أصنافها الفعالة.
    for (const batch of approvableBatches) {
      const refreshedItems = await tx
        .select()
        .from(purchaseOrderItems)
        .where(eq(purchaseOrderItems.batchId, batch.id));
      const activeItems = (refreshedItems as any[]).filter(
        (item: any) => !["rejected", "cancelled"].includes(item.status),
      );

      if (activeItems.length === 0) {
        await tx
          .update(poPricingBatches)
          .set({
            status: "rejected",
            rejectedById: args.actorId,
            rejectedAt: approvedAt as any,
            rejectionReason: "تم رفض جميع أصناف دفعة التسعير من الإدارة العليا ضمن دفعة الإرسال",
          })
          .where(and(
            eq(poPricingBatches.id, Number(batch.id)),
            eq(poPricingBatches.status, "pending_management"),
          ));
        rejectedBatchIds.push(Number(batch.id));
        continue;
      }

      await tx
        .update(poPricingBatches)
        .set({
          status: "approved",
          managementApprovedById: args.actorId,
          managementApprovedAt: approvedAt as any,
        })
        .where(and(
          eq(poPricingBatches.id, Number(batch.id)),
          eq(poPricingBatches.status, "pending_management"),
        ));

      await tx
        .update(purchaseOrderItems)
        .set({ status: "approved" })
        .where(and(
          eq(purchaseOrderItems.batchId, Number(batch.id)),
          notInArray(purchaseOrderItems.status, ["rejected", "cancelled"]),
        ));

      approvedBatchIds.push(Number(batch.id));
    }

    const approvedPoIds: number[] = [];
    const rejectedPoIds: number[] = [];

    // نفس قاعدة الطلب الحالية: لا يتحول الطلب إلى approved إلا إذا لم تبق
    // له أي دفعة حسابات/إدارة معلقة. وإذا انتهت كل أصنافه رفض/إلغاء يُغلق rejected.
    for (const poId of poIds) {
      const poRows = await tx
        .select()
        .from(purchaseOrders)
        .where(eq(purchaseOrders.id, poId))
        .limit(1);
      const po = poRows[0];
      if (!po) throw new Error("PACKAGE_SUBMISSION_PURCHASE_ORDER_NOT_FOUND");

      const pendingRows = await tx
        .select({ id: poPricingBatches.id })
        .from(poPricingBatches)
        .where(and(
          eq(poPricingBatches.purchaseOrderId, poId),
          inArray(poPricingBatches.status, ["pending_accounting", "pending_management"]),
        ))
        .limit(1);
      if (pendingRows.length > 0) continue;

      const allPoItems = await tx
        .select({ id: purchaseOrderItems.id, status: purchaseOrderItems.status })
        .from(purchaseOrderItems)
        .where(eq(purchaseOrderItems.purchaseOrderId, poId));
      const allTerminal = allPoItems.length > 0 && (allPoItems as any[]).every(
        (item: any) => ["rejected", "cancelled"].includes(item.status),
      );

      if (allTerminal) {
        if (po.status !== "rejected") {
          await tx
            .update(purchaseOrders)
            .set({
              status: "rejected",
              rejectedById: args.actorId,
              rejectedAt: approvedAt as any,
              rejectionReason: "تم إغلاق جميع أصناف الطلب أثناء اعتماد الإدارة لدفعة الإرسال",
            })
            .where(eq(purchaseOrders.id, poId));
        }
        rejectedPoIds.push(poId);
      } else {
        if (po.status !== "approved") {
          await tx
            .update(purchaseOrders)
            .set({
              status: "approved",
              managementApprovedById: args.actorId,
              managementApprovedAt: approvedAt as any,
            })
            .where(eq(purchaseOrders.id, poId));
        }
        approvedPoIds.push(poId);
      }
    }

    // إذا لم يبق أي Batch معتمد في هذه الإرسال فحالتها rejected؛ خلاف ذلك
    // approved تعني أن مراجعة الإدارة اكتملت وقد تحتوي أصنافًا مرفوضة جزئيًا.
    const submissionStatus = approvedBatchIds.length > 0 ? "approved" : "rejected";
    await tx
      .update(purchasePackageSubmissions)
      .set({ status: submissionStatus })
      .where(eq(purchasePackageSubmissions.id, args.submissionId));

    return {
      submissionId: args.submissionId,
      purchasePackageId: Number(submission.purchasePackageId),
      subNumber: Number(submission.subNumber),
      custodyBalance: submission.custodyBalance == null ? null : String(submission.custodyBalance),
      totalEstimatedCost: submission.totalEstimatedCost == null ? null : String(submission.totalEstimatedCost),
      submissionStatus,
      batchIds,
      approvedBatchIds,
      rejectedBatchIds,
      poIds,
      approvedPoIds,
      rejectedPoIds,
      rejectedItems,
      delegateId: Number(submission.createdById),
    };
  });
}

/**
 * [PB] معلومات حزمة كل طلب من قائمة طلبات — استعلام واحد مجمّع لتفادي N+1.
 * تُرجِع Map من purchaseOrderId إلى { packageId, packageNumber }. الطلبات
 * غير المجمّعة لا تظهر بالـMap إطلاقًا.
 */
export async function getPackageInfoForPOs(poIds: number[]) {
  const map = new Map<number, { packageId: number; packageNumber: string }>();
  const db = await getDb();
  if (!db || poIds.length === 0) return map;

  const rows = await db
    .select({
      purchaseOrderId: purchaseOrders.id,
      packageId: purchaseOrders.packageId,
      packageNumber: purchasePackages.packageNumber,
    })
    .from(purchaseOrders)
    .innerJoin(purchasePackages, eq(purchaseOrders.packageId, purchasePackages.id))
    .where(inArray(purchaseOrders.id, poIds));

  for (const r of rows as any[]) {
    if (r.packageId) {
      map.set(r.purchaseOrderId, {
        packageId: r.packageId,
        packageNumber: r.packageNumber,
      });
    }
  }
  return map;
}

/**
 * القراءة الموحّدة للقوائم: تُرجِع مصفوفة بطاقات بمفتاح مركّب
 * `package:<id>` أو `po:<id>` — نفس نمط getWarehouseTransferBatchCards
 * (رؤوس مجمَّعة + سجلات مستقلة قديمة بلا معرّف تجميع). دالة قراءة فقط،
 * لا تكتب شيئًا ولا تشتق أي حالة جديدة. لو مُرِّر delegateId، تُفلتَر
 * الطلبات لتشمل فقط ما لدى ذلك المندوب من أصناف — بنفس فلترة
 * getPOItemsByDelegate الحالية (معيار القرار 3 من الخطة).
 */
export async function getPurchaseCards(filters?: { delegateId?: number }) {
  const db = await getDb();
  if (!db) return [];

  // 1) الطلبات ذات الصلة: كل الطلبات، أو (لو دُعم لاحقًا) طلبات مفلترة
  //    بحسب صلاحية المستدعي — الفلترة بحسب الدور تبقى في طبقة الراوتر
  //    كما هي اليوم؛ هذه الدالة تجمع فقط ما يُمرَّر إليها.
  const allOrders = await db.select().from(purchaseOrders).orderBy(desc(purchaseOrders.id));

  const orderIds = allOrders.map((o: any) => o.id);
  const allItems = orderIds.length ? await getPOItemsForPOs(orderIds) : [];

  const itemsByOrder = new Map<number, any[]>();
  for (const item of allItems) {
    if (filters?.delegateId && item.delegateId !== filters.delegateId) continue;
    const list = itemsByOrder.get(item.purchaseOrderId) || [];
    list.push(item);
    itemsByOrder.set(item.purchaseOrderId, list);
  }

  // لو فُلتر بمندوب، نُبقي فقط الطلبات التي لديه صنف واحد فيها على الأقل
  const relevantOrders = filters?.delegateId
    ? allOrders.filter((o: any) => (itemsByOrder.get(o.id) || []).length > 0)
    : allOrders;

  // 2) تجميع الطلبات حسب packageId
  const packagedOrderIds = relevantOrders.filter((o: any) => o.packageId).map((o: any) => o.id);
  const standaloneOrders = relevantOrders.filter((o: any) => !o.packageId);

  const packageIds = Array.from(new Set(relevantOrders.filter((o: any) => o.packageId).map((o: any) => o.packageId)));
  const packages = packageIds.length
    ? await db.select().from(purchasePackages).where(inArray(purchasePackages.id, packageIds as number[]))
    : [];

  const ordersByPackage = new Map<number, any[]>();
  for (const o of relevantOrders) {
    if (!o.packageId) continue;
    const list = ordersByPackage.get(o.packageId) || [];
    list.push({ ...o, items: itemsByOrder.get(o.id) || [] });
    ordersByPackage.set(o.packageId, list);
  }

  const packageCards = packages.map((pkg: any) => ({
    cardType: "package" as const,
    key: `package:${pkg.id}`,
    id: pkg.id,
    packageNumber: pkg.packageNumber,
    createdById: pkg.createdById,
    createdAt: pkg.createdAt,
    orders: ordersByPackage.get(pkg.id) || [],
  }));

  const standaloneCards = standaloneOrders.map((o: any) => ({
    cardType: "order" as const,
    key: `po:${o.id}`,
    id: o.id,
    order: { ...o, items: itemsByOrder.get(o.id) || [] },
  }));

  // ترتيب موحّد: الأحدث أولًا، بغض النظر عن كون البطاقة حزمة أو طلبًا مفردًا
  return [...packageCards, ...standaloneCards].sort((a: any, b: any) => {
    const aDate = a.cardType === "package" ? a.createdAt : a.order.createdAt;
    const bDate = b.cardType === "package" ? b.createdAt : b.order.createdAt;
    return new Date(bDate).getTime() - new Date(aDate).getTime();
  });
}


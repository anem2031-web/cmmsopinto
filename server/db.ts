import { eq, desc, asc, and, sql, count, sum, inArray, notInArray, like, or, gte, lte, lt, isNull, isNotNull, ne } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { alias } from "drizzle-orm/mysql-core";
import mysql from "mysql2/promise";
import {
  InsertUser, users, tickets, purchaseOrders, purchaseOrderItems,
  inventory, inventoryTransactions, notifications, auditLogs,
  ticketStatusHistory, attachments, sites, backups,
  assets, preventivePlans, pmWorkOrders, assetSpareParts, pmJobs, assetMetrics,
  twoFactorSecrets, twoFactorAuditLogs,
  pushSubscriptions, sections, technicians, inspectionResults,
  type InsertAsset, type InsertPreventivePlan, type InsertPMWorkOrder,
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
} from "../drizzle/schema";
import { ENV } from './_core/env';


let _db: ReturnType<typeof drizzle> | null = null;
let _pool: mysql.Pool | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      // استخدام Pool بدل اتصال واحد — يعيد الاتصال تلقائياً عند الانقطاع
      _pool = mysql.createPool({
        uri:                process.env.DATABASE_URL,
        waitForConnections: true,
        connectionLimit:    10,
        queueLimit:         0,
        enableKeepAlive:    true,
        keepAliveInitialDelay: 30000,
        connectTimeout:     60000,
      });
      _db = drizzle(_pool as any);
      console.log("[Database] Pool created successfully");
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db   = null;
      _pool = null;
    }
  }
  return _db;
}

// ─────────────────────────────────────────────────────────────
// تنفيذ مجموعة عمليات ضمن معاملة DB واحدة (Atomicity)
// أي دالة تُستدعى داخل fn يجب أن تستقبل ويستخدم نفس الـ tx الممرَّر
// (وإلا فهي تعمل على اتصال منفصل من الـ Pool ولا تكون جزءاً من المعاملة)
// عند فشل أي خطوة، تُلغى (rollback) كل الكتابات السابقة داخل نفس fn تلقائياً
// ─────────────────────────────────────────────────────────────
export async function withTransaction<T>(fn: (tx: any) => Promise<T>): Promise<T> {
  const database = await getDb();
  if (!database) throw new Error("قاعدة البيانات غير متاحة");
  return database.transaction(fn);
}

// إعادة الاتصال عند انقطاع ECONNRESET
export async function resetDb() {
  console.warn("[Database] Resetting connection pool...");
  try { await _pool?.end(); } catch {}
  _db   = null;
  _pool = null;
  return getDb();
}

// معالجة أخطاء الاتصال تلقائياً
process.on("uncaughtException", async (err: any) => {
  if (err?.code === "ECONNRESET" || err?.cause?.code === "ECONNRESET") {
    console.warn("[Database] ECONNRESET detected — resetting pool...");
    await resetDb();
  }
});

// ============================================================
// USER OPERATIONS
// ============================================================
export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) return;
  try {
    const values: InsertUser = { openId: user.openId };
    const updateSet: Record<string, unknown> = {};
    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];
    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };
    textFields.forEach(assignNullable);
    if (user.lastSignedIn !== undefined) { values.lastSignedIn = user.lastSignedIn; updateSet.lastSignedIn = user.lastSignedIn; }
    if (user.role !== undefined) { values.role = user.role; updateSet.role = user.role; }
    else if (user.openId === ENV.ownerOpenId) { values.role = 'owner'; updateSet.role = 'owner'; }
    if (!values.lastSignedIn) values.lastSignedIn = new Date();
    if (Object.keys(updateSet).length === 0) updateSet.lastSignedIn = new Date();
    await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
  } catch (error) { console.error("[Database] Failed to upsert user:", error); throw error; }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function getUserByUsername(username: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.username, username)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function createLocalUser(data: { username: string; passwordHash: string; name: string; role: string; email?: string; phone?: string; department?: string }) {
  const db = await getDb();
  if (!db) return null;
// openId ثابت مبني على username فقط — بدون Date.now()
  const openId = `local_${data.username}`;

  const result = await db.insert(users).values({
    openId,
    username: data.username,
    passwordHash: data.passwordHash,
    name: data.name,
    role: data.role as any,
    email: data.email || null,
    phone: data.phone || null,
    department: data.department || null,
    loginMethod: "local",
    lastSignedIn: new Date(),
  });
  return result[0].insertId;
}

export async function updateUserPassword(userId: number, passwordHash: string) {
  const db = await getDb();
  if (!db) return;
  await db.update(users).set({ passwordHash }).where(eq(users.id, userId));
}

export async function getAllUsers() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(users).where(
    or(
      isNotNull(users.username),
      isNotNull(users.name)
    )
  );
}

export async function updateLastSignedIn(openId: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.update(users)
    .set({ lastSignedIn: new Date() })
    .where(eq(users.openId, openId));
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

export async function updateUserRole(userId: number, role: string) {
  const db = await getDb();
  if (!db) return;
  await db.update(users).set({ role: role as any }).where(eq(users.id, userId));
}

// ============================================================
// SITES
// ============================================================
export async function getAllSites() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(sites).orderBy(desc(sites.createdAt));
}

export async function createSite(data: { name: string; address?: string; description?: string; nameEn?: string; nameUr?: string }) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.insert(sites).values(data);
  return result[0].insertId;
}

// ============================================================
// SECTIONS
// ============================================================
export async function getSections(siteId?: number) {
  const db = await getDb();
  if (!db) return [];
  if (siteId) return db.select().from(sections).where(eq(sections.siteId, siteId)).orderBy(asc(sections.name));
  return db.select().from(sections).orderBy(asc(sections.siteId), asc(sections.name));
}
export async function createSection(data: InsertSection) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.insert(sections).values(data);
  return result[0].insertId;
}
export async function updateSection(id: number, data: { name?: string; description?: string; isActive?: boolean }) {
  const db = await getDb();
  if (!db) return;
  await db.update(sections).set(data).where(eq(sections.id, id));
}
export async function deleteSection(id: number) {
  const db = await getDb();
  if (!db) return;
  await db.delete(sections).where(eq(sections.id, id));
}

// ============================================================
// TECHNICIANS
// ============================================================
export async function getAllTechnicians(activeOnly = false) {
  const db = await getDb();
  if (!db) return [];
  if (activeOnly) return db.select().from(technicians).where(eq(technicians.status, "active")).orderBy(asc(technicians.name));
  return db.select().from(technicians).orderBy(asc(technicians.name));
}
export async function getTechnicianById(id: number) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.select().from(technicians).where(eq(technicians.id, id)).limit(1);
  return result[0] || null;
}
export async function createTechnician(data: { name: string; specialty?: string; nameEn?: string; nameUr?: string; specialtyEn?: string; specialtyUr?: string }) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.insert(technicians).values({ ...data, status: "active" });
  return result[0].insertId;
}
export async function updateTechnician(id: number, data: { name?: string; specialty?: string; status?: "active" | "inactive" }) {
  const db = await getDb();
  if (!db) return;
  await db.update(technicians).set(data).where(eq(technicians.id, id));
}
export async function deleteTechnician(id: number) {
  const db = await getDb();
  if (!db) return;
  await db.delete(technicians).where(eq(technicians.id, id));
}

export async function getTechnicianOpenTicketCounts(): Promise<Record<number, number>> {
  const db = await getDb();
  if (!db) return {};
  const rows = await db
    .select({ technicianId: tickets.assignedTechnicianId, cnt: count() })
    .from(tickets)
    .where(and(isNotNull(tickets.assignedTechnicianId), isNull(tickets.closedAt)))
    .groupBy(tickets.assignedTechnicianId);
  const result: Record<number, number> = {};
  for (const row of rows) {
    if (row.technicianId != null) result[row.technicianId] = row.cnt;
  }
  return result;
}

// ============================================================
// TICKETS
// ============================================================
export async function getNextTicketNumber() {
  const db = await getDb();
  if (!db) return "MT-2026-00001";
  
  const year = new Date().getFullYear();
  const prefix = `MT-${year}-`;

  // Find the last ticket created in the current year
  const lastTicket = await db
    .select({ ticketNumber: tickets.ticketNumber })
    .from(tickets)
    .where(like(tickets.ticketNumber, `${prefix}%`))
    .orderBy(desc(tickets.ticketNumber))
    .limit(1);

  let nextNum = 1;
  if (lastTicket && lastTicket.length > 0) {
    // Extract the numeric part (e.g., from MT-2026-00014 we get 14)
    const parts = lastTicket[0].ticketNumber.split("-");
    const lastNumStr = parts[parts.length - 1];
    const lastNum = parseInt(lastNumStr || "0", 10);
    if (!isNaN(lastNum)) {
      nextNum = lastNum + 1;
    }
  }

  return `${prefix}${String(nextNum).padStart(5, "0")}`;
}

export async function createTicket(data: any) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.insert(tickets).values(data);
  return result[0].insertId;
}

type TicketListFilters = { status?: string; priority?: string; siteId?: number; sectionId?: number; assetId?: number; assignedToId?: number; assignedTechnicianId?: number; reportedById?: number; search?: string; category?: string };

// شرط الفلترة المشترك بين getTickets (بدون صفحات) وgetTicketsPaginated (مع صفحات)
function buildTicketsWhere(filters?: TicketListFilters) {
  const conditions: any[] = [];
  if (filters?.status) {
    if (filters.status === "open") {
      conditions.push(ne(tickets.status, "closed" as any));
    } else {
      conditions.push(eq(tickets.status, filters.status as any));
    }
  }
  if (filters?.priority) conditions.push(eq(tickets.priority, filters.priority as any));
  if (filters?.siteId) conditions.push(eq(tickets.siteId, filters.siteId));
  if (filters?.sectionId) conditions.push(eq(tickets.sectionId, filters.sectionId));
  if (filters?.assetId) conditions.push(eq(tickets.assetId, filters.assetId));
  if (filters?.assignedToId) conditions.push(eq(tickets.assignedToId, filters.assignedToId));
  if (filters?.assignedTechnicianId) conditions.push(eq(tickets.assignedTechnicianId, filters.assignedTechnicianId));
  if (filters?.reportedById) conditions.push(eq(tickets.reportedById, filters.reportedById));
  if (filters?.search) conditions.push(or(
    like(tickets.title, `%${filters.search}%`),
    like(tickets.title_ar, `%${filters.search}%`),
    like(tickets.title_en, `%${filters.search}%`),
    like(tickets.title_ur, `%${filters.search}%`),
    like(tickets.ticketNumber, `%${filters.search}%`)
  ));
  if (filters?.category) conditions.push(eq(tickets.category, filters.category as any));
  return conditions.length > 0 ? and(...conditions) : undefined;
}

export async function getTickets(filters?: TicketListFilters) {
  const db = await getDb();
  if (!db) return [];
  const where = buildTicketsWhere(filters);
  // Phase 4: join both external technicians table AND internal users table
  // to resolve display names for both assignment paths.
  const assignedUser = alias(users, "assignedUser");
  const rows = await db
    .select({
      ticket: tickets,
      technicianName: technicians.name,           // external technician name
      assignedUserName: assignedUser.name,         // internal user name
    })
    .from(tickets)
    .leftJoin(technicians, eq(tickets.assignedTechnicianId, technicians.id))
    .leftJoin(assignedUser, eq(tickets.assignedToId, assignedUser.id))
    .where(where)
    .orderBy(desc(tickets.createdAt));
  return rows.map(r => ({
    ...r.ticket,
    assignedTechnicianName: r.technicianName ?? null,   // legacy external path
    assignedToUserName: r.assignedUserName ?? null,     // Phase 4: internal path
  }));
}

// صفحات حقيقية لقائمة البلاغات: ترجع فقط عناصر الصفحة المطلوبة + العدد الإجمالي
// لحساب عدد الصفحات بالواجهة (limit/offset على مستوى قاعدة البيانات بعد تطبيق نفس الفلاتر والبحث)
export async function getTicketsPaginated(filters: TicketListFilters | undefined, page: number = 1, pageSize: number = 10) {
  const db = await getDb();
  if (!db) return { tickets: [] as any[], total: 0, page: 1, pageSize, totalPages: 1 };

  const where = buildTicketsWhere(filters);

  const [{ cnt }] = await db.select({ cnt: count() }).from(tickets).where(where);
  const total = Number(cnt) || 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const offset = (safePage - 1) * pageSize;

  const assignedUser = alias(users, "assignedUser");
  const rows = await db
    .select({
      ticket: tickets,
      technicianName: technicians.name,
      assignedUserName: assignedUser.name,
    })
    .from(tickets)
    .leftJoin(technicians, eq(tickets.assignedTechnicianId, technicians.id))
    .leftJoin(assignedUser, eq(tickets.assignedToId, assignedUser.id))
    .where(where)
    .orderBy(desc(tickets.createdAt))
    .limit(pageSize)
    .offset(offset);

  return {
    tickets: rows.map(r => ({
      ...r.ticket,
      assignedTechnicianName: r.technicianName ?? null,
      assignedToUserName: r.assignedUserName ?? null,
    })),
    total,
    page: safePage,
    pageSize,
    totalPages,
  };
}

export async function getTicketById(id: number) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.select().from(tickets).where(eq(tickets.id, id)).limit(1);
  return result[0] || null;
}

export async function getTicketsByAsset(assetId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(tickets).where(eq(tickets.assetId, assetId)).orderBy(desc(tickets.createdAt));
}

export async function updateTicket(id: number, data: any) {
  const db = await getDb();
  if (!db) return;
  await db.update(tickets).set(data).where(eq(tickets.id, id));
}

// ============================================================
// TICKET STATUS HISTORY
// ============================================================
export async function addTicketStatusHistory(data: { ticketId: number; fromStatus?: string; toStatus: string; changedById: number; notes?: string }) {
  const db = await getDb();
  if (!db) return;
  await db.insert(ticketStatusHistory).values(data);
}

// ============================================================
// TICKET CONFIRMATIONS (requester confirms completion after closure)
// ============================================================
export async function createTicketConfirmation(data: InsertTicketConfirmation) {
  const db = await getDb();
  if (!db) return;
  await db.insert(ticketConfirmations).values(data);
}

export async function getTicketConfirmation(ticketId: number) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.select().from(ticketConfirmations).where(eq(ticketConfirmations.ticketId, ticketId)).orderBy(desc(ticketConfirmations.createdAt)).limit(1);
  return result[0] || null;
}

export async function getTicketHistory(ticketId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(ticketStatusHistory).where(eq(ticketStatusHistory.ticketId, ticketId)).orderBy(desc(ticketStatusHistory.createdAt));
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

// ============================================================
// INVENTORY
// ============================================================
export async function getInventoryItems() {
  const db = await getDb();
  if (!db) return [];

  const items = await db.select().from(inventory).orderBy(desc(inventory.updatedAt));
  if (items.length === 0) return [];
  const itemIds = items.map(i => i.id);

  // آخر معاملة "شراء" لكل صنف — المصدر الصحيح لتاريخ آخر توريد وآخر سعر شراء فعلي
  // (وليس receiptId الثابت في inventory، ولا averageCost المتوسط التراكمي)
  const lastPurchases = await db
    .select({
      inventoryId: inventoryTransactions.inventoryId,
      invoiceDate: warehouseReceipts.invoiceDate,
      unitCost:    inventoryTransactions.unitCost,
    })
    .from(inventoryTransactions)
    .leftJoin(warehouseReceipts, eq(inventoryTransactions.receiptId, warehouseReceipts.id))
    .where(and(
      inArray(inventoryTransactions.inventoryId, itemIds),
      eq(inventoryTransactions.type, "in"),
      eq(inventoryTransactions.transactionType, "purchase"),
    ))
    .orderBy(desc(inventoryTransactions.createdAt));

  // آخر معاملة "صرف" لكل صنف — المصدر الصحيح لتاريخ آخر صرف
  const lastIssues = await db
    .select({
      inventoryId: inventoryTransactions.inventoryId,
      createdAt:   inventoryTransactions.createdAt,
    })
    .from(inventoryTransactions)
    .where(and(
      inArray(inventoryTransactions.inventoryId, itemIds),
      eq(inventoryTransactions.type, "out"),
    ))
    .orderBy(desc(inventoryTransactions.createdAt));

  // نأخذ أول ظهور لكل inventoryId (الأحدث، بسبب الترتيب التنازلي أعلاه)
  const latestInvoiceDateByItem = new Map<number, Date | null>();
  const latestPurchasePriceByItem = new Map<number, string | null>();
  for (const tx of lastPurchases) {
    if (!latestInvoiceDateByItem.has(tx.inventoryId)) {
      latestInvoiceDateByItem.set(tx.inventoryId, tx.invoiceDate);
      latestPurchasePriceByItem.set(tx.inventoryId, tx.unitCost);
    }
  }
  const latestIssueDateByItem = new Map<number, Date | null>();
  for (const tx of lastIssues) {
    if (!latestIssueDateByItem.has(tx.inventoryId)) {
      latestIssueDateByItem.set(tx.inventoryId, tx.createdAt);
    }
  }

  return items.map(item => ({
    ...item,
    invoiceDate:        latestInvoiceDateByItem.get(item.id) ?? null,
    lastPurchasePrice:  latestPurchasePriceByItem.get(item.id) ?? null,
    lastIssuedAt:       latestIssueDateByItem.get(item.id) ?? null,
  }));
}

export async function createInventoryItem(data: any) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.insert(inventory).values(data);
  return result[0].insertId;
}

export async function updateInventoryItem(id: number, data: any) {
  const db = await getDb();
  if (!db) return;
  await db.update(inventory).set(data).where(eq(inventory.id, id));
}

export async function addInventoryTransaction(data: any) {
  const db = await getDb();
  if (!db) return;
  await db.insert(inventoryTransactions).values(data);
  // Update inventory quantity
  const item = await db.select().from(inventory).where(eq(inventory.id, data.inventoryId)).limit(1);
  if (item[0]) {
    const newQty = data.type === "in" ? item[0].quantity + data.quantity : item[0].quantity - data.quantity;
    await db.update(inventory).set({ quantity: Math.max(0, newQty) }).where(eq(inventory.id, data.inventoryId));
  }
}

// ============================================================
// NOTIFICATIONS
// ============================================================
// Lazy import to avoid circular deps
let _webPush: typeof import('./webPush') | null = null;
async function getWebPush() {
  if (!_webPush) _webPush = await import('./webPush');
  return _webPush;
}

export async function createNotification(data: { userId: number; title: string; message: string; type?: string; relatedTicketId?: number; relatedPOId?: number; allowSeniorManagement?: boolean }) {
  const db = await getDb();
  if (!db) return;

  // ── Senior Management notification policy ───────────────────────────────
  // دور "الإدارة العليا" (senior_management) لا يستقبل أي إشعارات إطلاقاً،
  // باستثناء حالة واحدة فقط: طلب شراء بانتظار اعتماده بعد موافقة الحسابات.
  // أي استدعاء آخر (حالي أو مستقبلي) يستهدف هذا الدور يُحظر تلقائياً هنا،
  // ما لم يُمرَّر allowSeniorManagement: true صراحةً من نقطة الاستدعاء المصرّح بها.
  if (!data.allowSeniorManagement) {
    const recipient = await getUserById(data.userId);
    if (recipient?.role === "senior_management") {
      console.warn(
        `[Notifications] Blocked notification to senior_management (userId=${data.userId}): "${data.title}" — not in the allowed exception list.`
      );
      return;
    }
  }

  await db.insert(notifications).values({
    userId: data.userId,
    title: data.title,
    message: data.message,
    type: data.type as any,
    relatedTicketId: data.relatedTicketId,
    relatedPOId: data.relatedPOId,
  });

  // Send Web Push notification asynchronously (fire-and-forget)
  getWebPush().then(wp => {
    const url = data.relatedTicketId ? `/tickets/${data.relatedTicketId}` :
                data.relatedPOId ? `/purchase-orders/${data.relatedPOId}` : "/notifications";
    wp.sendPushToUser(data.userId, {
      title: data.title,
      body: data.message,
      type: data.type || "info",
      tag: `notif-${data.userId}-${Date.now()}`,
      url,
    }).catch(() => {}); // Ignore push errors
  }).catch(() => {});
}

export async function getUserNotifications(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(notifications).where(eq(notifications.userId, userId)).orderBy(desc(notifications.createdAt)).limit(50);
}

export async function markNotificationRead(id: number, userId: number) {
  const db = await getDb();
  if (!db) return;
  await db.update(notifications).set({ isRead: true }).where(and(eq(notifications.id, id), eq(notifications.userId, userId)));
}

export async function markAllNotificationsRead(userId: number) {
  const db = await getDb();
  if (!db) return;
  await db.update(notifications).set({ isRead: true }).where(eq(notifications.userId, userId));
}

export async function getUnreadNotificationCount(userId: number) {
  const db = await getDb();
  if (!db) return 0;
  const result = await db.select({ cnt: count() }).from(notifications).where(and(eq(notifications.userId, userId), eq(notifications.isRead, false)));
  return result[0]?.cnt || 0;
}

// ============================================================
// AUDIT LOG
// ============================================================
export async function createAuditLog(data: { userId?: number; action: string; entityType: string; entityId?: number; oldValues?: any; newValues?: any; ipAddress?: string; userAgent?: string }) {
  const db = await getDb();
  if (!db) return;
  await db.insert(auditLogs).values(data as any);
}

export async function getAuditLogs(filters?: { entityType?: string; entityId?: number; userId?: number }) {
  const db = await getDb();
  if (!db) return [];
  const conditions: any[] = [];
  if (filters?.entityType) conditions.push(eq(auditLogs.entityType, filters.entityType));
  if (filters?.entityId) conditions.push(eq(auditLogs.entityId, filters.entityId));
  if (filters?.userId) conditions.push(eq(auditLogs.userId, filters.userId));
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  return db.select().from(auditLogs).where(where).orderBy(desc(auditLogs.createdAt)).limit(200);
}

// ============================================================
// TECHNICIAN PERFORMANCE REPORT
// ============================================================
export async function getTechnicianPerformance(filters?: { dateFrom?: Date; dateTo?: Date; siteId?: number; sectionId?: number; technicianName?: string }) {
  const db = await getDb();
  if (!db) return [];

  const dateFrom = filters?.dateFrom;
  const dateTo = filters?.dateTo;
  const siteId = filters?.siteId;
  const sectionId = filters?.sectionId;
  const technicianName = filters?.technicianName?.trim().toLowerCase();

  // Build date condition helper
  const withDateFilter = (baseConditions: any[], dateField: any) => {
    const conds = [...baseConditions];
    if (dateFrom) conds.push(gte(dateField, dateFrom));
    if (dateTo) conds.push(lte(dateField, dateTo));
    return conds;
  };

  // Build site/section condition for tickets
  const siteSecCond = () => {
    const c: any[] = [];
    if (siteId) c.push(eq(tickets.siteId, siteId));
    if (sectionId) c.push(eq(tickets.sectionId, sectionId));
    return c;
  };

  // Get all technicians (filtered by name if provided)
  let techs = await db.select().from(users).where(eq(users.role, "technician" as any));
  if (technicianName) {
    techs = techs.filter(t => (t.name || "").toLowerCase().includes(technicianName));
  }

  const results = [];
  for (const tech of techs) {
    const baseCond = [eq(tickets.assignedToId, tech.id), ...siteSecCond()];
    const dateFilteredCond = withDateFilter(baseCond, tickets.createdAt);

    // Total assigned tickets (within date range)
    const [totalAssigned] = await db.select({ cnt: count() }).from(tickets).where(and(...dateFilteredCond));

    // Completed tickets (repaired, verified, closed) within date range
    const [completed] = await db.select({ cnt: count() }).from(tickets).where(
      and(...dateFilteredCond, or(eq(tickets.status, "repaired"), eq(tickets.status, "verified"), eq(tickets.status, "closed")))
    );

    // In progress tickets within date range
    const [inProgress] = await db.select({ cnt: count() }).from(tickets).where(
      and(...dateFilteredCond, eq(tickets.status, "in_progress"))
    );

    // Closed tickets with resolution time within date range
    const closedCond = withDateFilter([eq(tickets.assignedToId, tech.id), eq(tickets.status, "closed"), ...siteSecCond()], tickets.closedAt);
    const closedTickets = await db.select({
      id: tickets.id,
      createdAt: tickets.createdAt,
      closedAt: tickets.closedAt,
      priority: tickets.priority,
      category: tickets.category,
    }).from(tickets).where(and(...closedCond));

    // Calculate avg resolution time in hours
    let totalHours = 0;
    let resolvedCount = 0;
    const resolutionTimes: number[] = [];
    for (const t of closedTickets) {
      if (t.closedAt && t.createdAt) {
        const hours = (new Date(t.closedAt).getTime() - new Date(t.createdAt).getTime()) / (1000 * 60 * 60);
        totalHours += hours;
        resolvedCount++;
        resolutionTimes.push(hours);
      }
    }
    const avgResolutionHours = resolvedCount > 0 ? totalHours / resolvedCount : 0;
    const minResolutionHours = resolutionTimes.length > 0 ? Math.min(...resolutionTimes) : 0;
    const maxResolutionHours = resolutionTimes.length > 0 ? Math.max(...resolutionTimes) : 0;

    // Tickets by priority (within date range)
    const priorityBreakdown: Record<string, number> = {};
    const allTechTickets = await db.select({ priority: tickets.priority, category: tickets.category }).from(tickets).where(and(...dateFilteredCond));
    allTechTickets.forEach(t => { priorityBreakdown[t.priority] = (priorityBreakdown[t.priority] || 0) + 1; });

    // Tickets by category (within date range)
    const catBreak: Record<string, number> = {};
    allTechTickets.forEach(t => { catBreak[t.category] = (catBreak[t.category] || 0) + 1; });

    // Monthly trend (last 6 months or within date range)
    const monthlyTrend: { month: string; completed: number; assigned: number }[] = [];
    const trendMonths = 6;
    for (let i = trendMonths - 1; i >= 0; i--) {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      const monthStr = d.toISOString().slice(0, 7);
      const monthStart = new Date(d.getFullYear(), d.getMonth(), 1);
      const monthEnd = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59);

      const [assigned] = await db.select({ cnt: count() }).from(tickets).where(
        and(eq(tickets.assignedToId, tech.id), gte(tickets.createdAt, monthStart), lte(tickets.createdAt, monthEnd), ...siteSecCond())
      );
      const [comp] = await db.select({ cnt: count() }).from(tickets).where(
        and(eq(tickets.assignedToId, tech.id), eq(tickets.status, "closed"), gte(tickets.closedAt, monthStart), lte(tickets.closedAt, monthEnd), ...siteSecCond())
      );
      monthlyTrend.push({ month: monthStr, assigned: assigned?.cnt || 0, completed: comp?.cnt || 0 });
    }

    // Completion rate
    const totalAssignedCount = totalAssigned?.cnt || 0;
    const completedCount = completed?.cnt || 0;
    const completionRate = totalAssignedCount > 0 ? Math.round((completedCount / totalAssignedCount) * 100) : 0;

    // Performance score (0-100)
    let score = 0;
    if (totalAssignedCount > 0) {
      const rateScore = completionRate * 0.4;
      const speedScore = avgResolutionHours > 0 ? Math.max(0, (1 - avgResolutionHours / (30 * 24)) * 100) * 0.3 : 0;
      const volumeScore = Math.min(100, totalAssignedCount * 5) * 0.3;
      score = Math.round(rateScore + speedScore + volumeScore);
    }

    results.push({
      technician: { id: tech.id, name: tech.name, email: tech.email, phone: (tech as any).phone, department: (tech as any).department },
      totalAssigned: totalAssignedCount,
      completed: completedCount,
      inProgress: inProgress?.cnt || 0,
      pending: totalAssignedCount - completedCount - (inProgress?.cnt || 0),
      completionRate,
      avgResolutionHours: Math.round(avgResolutionHours * 10) / 10,
      minResolutionHours: Math.round(minResolutionHours * 10) / 10,
      maxResolutionHours: Math.round(maxResolutionHours * 10) / 10,
      priorityBreakdown,
      categoryBreakdown: catBreak,
      monthlyTrend,
      performanceScore: score,
    });
  }

  return results.sort((a, b) => b.performanceScore - a.performanceScore);
}

// ============================================================
// EXTERNAL TECHNICIAN PERFORMANCE
// ============================================================
export async function getExternalTechnicianPerformance(filters?: { dateFrom?: Date; dateTo?: Date }) {
  const db = await getDb();
  if (!db) return [];
  const dateFrom = filters?.dateFrom;
  const dateTo = filters?.dateTo;
  const withDateFilter = (baseConditions: any[], dateField: any) => {
    const conds = [...baseConditions];
    if (dateFrom) conds.push(gte(dateField, dateFrom));
    if (dateTo) conds.push(lte(dateField, dateTo));
    return conds;
  };
  const techs = await db.select().from(technicians);
  const results = [];
  for (const tech of techs) {
    const baseCond = [eq(tickets.assignedTechnicianId, tech.id)];
    const dateFilteredCond = withDateFilter(baseCond, tickets.createdAt);
    const [totalAssigned] = await db.select({ cnt: count() }).from(tickets).where(and(...dateFilteredCond));
    const [completed] = await db.select({ cnt: count() }).from(tickets).where(
      and(...dateFilteredCond, or(eq(tickets.status, "repaired"), eq(tickets.status, "verified"), eq(tickets.status, "closed")))
    );
    const [inProgress] = await db.select({ cnt: count() }).from(tickets).where(
      and(...dateFilteredCond, eq(tickets.status, "in_progress"))
    );
    const closedCond = withDateFilter([eq(tickets.assignedTechnicianId, tech.id), eq(tickets.status, "closed")], tickets.closedAt);
    const closedTickets = await db.select({
      id: tickets.id,
      assignedAt: tickets.assignedAt,
      closedAt: tickets.closedAt,
      priority: tickets.priority,
      category: tickets.category,
    }).from(tickets).where(and(...closedCond));
    let totalHours = 0;
    let resolvedCount = 0;
    const resolutionTimes: number[] = [];
    for (const t of closedTickets) {
      if (t.closedAt && t.assignedAt) {
        const hours = (new Date(t.closedAt).getTime() - new Date(t.assignedAt).getTime()) / (1000 * 60 * 60);
        totalHours += hours;
        resolvedCount++;
        resolutionTimes.push(hours);
      }
    }
    const avgResolutionHours = resolvedCount > 0 ? totalHours / resolvedCount : 0;
    const minResolutionHours = resolutionTimes.length > 0 ? Math.min(...resolutionTimes) : 0;
    const maxResolutionHours = resolutionTimes.length > 0 ? Math.max(...resolutionTimes) : 0;
    const allTechTickets = await db.select({ priority: tickets.priority, category: tickets.category }).from(tickets).where(and(...dateFilteredCond));
    const priorityBreakdown: Record<string, number> = {};
    allTechTickets.forEach(t => { priorityBreakdown[t.priority] = (priorityBreakdown[t.priority] || 0) + 1; });
    const catBreak: Record<string, number> = {};
    allTechTickets.forEach(t => { catBreak[t.category] = (catBreak[t.category] || 0) + 1; });
    const totalAssignedCount = totalAssigned?.cnt || 0;
    const completedCount = completed?.cnt || 0;
    const completionRate = totalAssignedCount > 0 ? Math.round((completedCount / totalAssignedCount) * 100) : 0;
    let score = 0;
    if (totalAssignedCount > 0) {
      const rateScore = completionRate * 0.4;
      const speedScore = avgResolutionHours > 0 ? Math.max(0, (1 - avgResolutionHours / (30 * 24)) * 100) * 0.3 : 0;
      const volumeScore = Math.min(100, totalAssignedCount * 5) * 0.3;
      score = Math.round(rateScore + speedScore + volumeScore);
    }
    results.push({
      technician: { id: tech.id, name: tech.name, email: null, specialty: tech.specialty, status: tech.status, isExternal: true },
      totalAssigned: totalAssignedCount,
      completed: completedCount,
      inProgress: inProgress?.cnt || 0,
      pending: totalAssignedCount - completedCount - (inProgress?.cnt || 0),
      completionRate,
      avgResolutionHours: Math.round(avgResolutionHours * 10) / 10,
      minResolutionHours: Math.round(minResolutionHours * 10) / 10,
      maxResolutionHours: Math.round(maxResolutionHours * 10) / 10,
      priorityBreakdown,
      categoryBreakdown: catBreak,
      performanceScore: score,
    });
  }
  return results.sort((a, b) => b.performanceScore - a.performanceScore);
}
// ============================================================
// ATTACHMENTS
// ============================================================
export async function createAttachment(data: any) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.insert(attachments).values(data);
  return result[0].insertId;
}

export async function getAttachments(entityType: string, entityId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(attachments).where(and(eq(attachments.entityType, entityType), eq(attachments.entityId, entityId))).orderBy(desc(attachments.createdAt));
}

export async function getAttachmentById(id: number) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.select().from(attachments).where(eq(attachments.id, id)).limit(1);
  return result[0] || null;
}

export async function deleteAttachment(id: number) {
  const db = await getDb();
  if (!db) return;
  await db.delete(attachments).where(eq(attachments.id, id));
}

// ============================================================
// DASHBOARD STATS
// ============================================================
export async function getDashboardStats() {
  const db = await getDb();
  if (!db) return null;
  const [openTickets] = await db.select({ cnt: count() }).from(tickets).where(ne(tickets.status, "closed"));
  const [closedToday] = await db.select({ cnt: count() }).from(tickets).where(and(eq(tickets.status, "closed"), gte(tickets.closedAt, sql`CURDATE()`)));
  const [criticalTickets] = await db.select({ cnt: count() }).from(tickets).where(and(eq(tickets.priority, "critical"), ne(tickets.status, "closed")));
  const [pendingPOs] = await db.select({ cnt: count() }).from(purchaseOrders).where(or(eq(purchaseOrders.status, "pending_accounting"), eq(purchaseOrders.status, "pending_management")));
  const [totalCostResult] = await db.select({ total: sum(purchaseOrderItems.actualTotalCost) }).from(purchaseOrderItems).where(or(eq(purchaseOrderItems.status, "delivered_to_warehouse"), eq(purchaseOrderItems.status, "delivered_to_requester")));
  const [pendingItems] = await db.select({ cnt: count() }).from(purchaseOrderItems).where(ne(purchaseOrderItems.status, "purchased"));
  const [purchasedItems] = await db.select({ cnt: count() }).from(purchaseOrderItems).where(eq(purchaseOrderItems.status, "purchased"));
  // New workflow stats
  const [pendingTriageCount] = await db.select({ cnt: count() }).from(tickets).where(eq(tickets.status, "pending_triage"));
  const [underInspectionCount] = await db.select({ cnt: count() }).from(tickets).where(eq(tickets.status, "under_inspection"));
  // 7-day trend: tickets created per day for the last 7 days
  const trend7: number[] = [];
  for (let i = 6; i >= 0; i--) {
    const dayStart = sql`DATE_SUB(CURDATE(), INTERVAL ${i} DAY)`;
    const dayEnd = sql`DATE_SUB(CURDATE(), INTERVAL ${i - 1} DAY)`;
    const [row] = await db.select({ cnt: count() }).from(tickets).where(
      and(gte(tickets.createdAt, dayStart as any), lt(tickets.createdAt, dayEnd as any))
    );
    trend7.push(row?.cnt || 0);
  }
  // SLA breaches: tickets in non-closed status for > 48 hours
  const [slaBreaches] = await db.select({ cnt: count() }).from(tickets).where(
    and(ne(tickets.status, "closed"), lt(tickets.createdAt, sql`DATE_SUB(NOW(), INTERVAL 48 HOUR)` as any))
  );
  return {
    openTickets: openTickets?.cnt || 0,
    closedToday: closedToday?.cnt || 0,
    criticalTickets: criticalTickets?.cnt || 0,
    pendingApprovals: pendingPOs?.cnt || 0,
    totalMaintenanceCost: totalCostResult?.total || "0",
    pendingPurchaseItems: pendingItems?.cnt || 0,
    purchasedItems: purchasedItems?.cnt || 0,
    pendingTriage: pendingTriageCount?.cnt || 0,
    underInspection: underInspectionCount?.cnt || 0,
    trend7,
    slaBreaches: slaBreaches?.cnt || 0,
  };
}

// ============================================================
// DELETE OPERATIONS
// ============================================================
export async function deleteTicket(id: number) {
  const db = await getDb();
  if (!db) return;
  // Delete related records first
  await db.delete(ticketStatusHistory).where(eq(ticketStatusHistory.ticketId, id));
  await db.delete(attachments).where(and(eq(attachments.entityType, "ticket"), eq(attachments.entityId, id)));
  await db.delete(notifications).where(eq(notifications.relatedTicketId, id));
  await db.delete(tickets).where(eq(tickets.id, id));
}

export async function deletePurchaseOrder(id: number) {
  const db = await getDb();
  if (!db) return;
  await db.delete(purchaseOrderItems).where(eq(purchaseOrderItems.purchaseOrderId, id));
  await db.delete(attachments).where(and(eq(attachments.entityType, "purchase_order"), eq(attachments.entityId, id)));
  await db.delete(notifications).where(eq(notifications.relatedPOId, id));
  await db.delete(purchaseOrders).where(eq(purchaseOrders.id, id));
}

export async function deletePOItem(id: number) {
  const db = await getDb();
  if (!db) return;
  await db.delete(purchaseOrderItems).where(eq(purchaseOrderItems.id, id));
}

export async function deleteInventoryItem(id: number) {
  const db = await getDb();
  if (!db) return;
  await db.delete(inventoryTransactions).where(eq(inventoryTransactions.inventoryId, id));
  await db.delete(inventory).where(eq(inventory.id, id));
}

export async function deleteSite(id: number) {
  const db = await getDb();
  if (!db) return;
  await db.delete(sites).where(eq(sites.id, id));
}

export async function updateSite(id: number, data: { name?: string; address?: string; description?: string }) {
  const db = await getDb();
  if (!db) return;
  await db.update(sites).set(data).where(eq(sites.id, id));
}

export async function deleteUser(id: number) {
  const db = await getDb();
  if (!db) return;
  await db.delete(notifications).where(eq(notifications.userId, id));
  await db.delete(users).where(eq(users.id, id));
}

export async function updateUser(id: number, data: { name?: string; email?: string; role?: string; phone?: string; department?: string; specialty?: string; specialtyEn?: string; specialtyUr?: string }) {
  const db = await getDb();
  if (!db) return;
  await db.update(users).set(data as any).where(eq(users.id, id));
}

export async function toggleUserActive(id: number, isActive: boolean) {
  const db = await getDb();
  if (!db) return;
  await db.update(users).set({ isActive }).where(eq(users.id, id));
}

export async function getSiteById(id: number) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.select().from(sites).where(eq(sites.id, id)).limit(1);
  return result.length > 0 ? result[0] : null;
}

export async function getInventoryItemById(id: number, tx?: any) {
  const db = tx || await getDb();
  if (!db) return null;
  const result = await db.select().from(inventory).where(eq(inventory.id, id)).limit(1);
  return result.length > 0 ? result[0] : null;
}

export async function getUserById(id: number) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return result.length > 0 ? result[0] : null;
}

// Enhanced audit log with action filter
export async function getAuditLogsEnhanced(filters?: { entityType?: string; entityId?: number; userId?: number; action?: string; dateFrom?: Date; dateTo?: Date; limit?: number }) {
  const db = await getDb();
  if (!db) return [];
  const conditions: any[] = [];
  if (filters?.entityType) conditions.push(eq(auditLogs.entityType, filters.entityType));
  if (filters?.entityId) conditions.push(eq(auditLogs.entityId, filters.entityId));
  if (filters?.userId) conditions.push(eq(auditLogs.userId, filters.userId));
  if (filters?.action) conditions.push(eq(auditLogs.action, filters.action));
  if (filters?.dateFrom) conditions.push(gte(auditLogs.createdAt, filters.dateFrom));
  if (filters?.dateTo) conditions.push(lte(auditLogs.createdAt, filters.dateTo));
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  return db.select().from(auditLogs).where(where).orderBy(desc(auditLogs.createdAt)).limit(filters?.limit || 500);
}

// ============================================================
// BACKUPS
// ============================================================
export async function createBackup(data: { name: string; description?: string; fileUrl: string; fileKey: string; fileSize?: number; tablesCount?: number; recordsCount?: number; createdById: number }) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.insert(backups).values(data);
  return result[0].insertId;
}

export async function getBackups() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(backups).orderBy(desc(backups.createdAt));
}

export async function getBackupById(id: number) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.select().from(backups).where(eq(backups.id, id)).limit(1);
  return result[0] || null;
}

export async function deleteBackup(id: number) {
  const db = await getDb();
  if (!db) return;
  await db.delete(backups).where(eq(backups.id, id));
}

// Export all tables data for backup
export async function exportAllTablesData() {
  const db = await getDb();
  if (!db) return null;
  
  const [
    usersData, sitesData, ticketsData, ticketHistoryData,
    posData, poItemsData, inventoryData, invTransData,
    notificationsData, auditData, attachmentsData
  ] = await Promise.all([
    db.select().from(users),
    db.select().from(sites),
    db.select().from(tickets),
    db.select().from(ticketStatusHistory),
    db.select().from(purchaseOrders),
    db.select().from(purchaseOrderItems),
    db.select().from(inventory),
    db.select().from(inventoryTransactions),
    db.select().from(notifications),
    db.select().from(auditLogs),
    db.select().from(attachments),
  ]);

  const data = {
    users: usersData,
    sites: sitesData,
    tickets: ticketsData,
    ticket_status_history: ticketHistoryData,
    purchase_orders: posData,
    purchase_order_items: poItemsData,
    inventory: inventoryData,
    inventory_transactions: invTransData,
    notifications: notificationsData,
    audit_logs: auditData,
    attachments: attachmentsData,
  };

  let totalRecords = 0;
  for (const table of Object.values(data)) {
    totalRecords += table.length;
  }

  return { data, tablesCount: Object.keys(data).length, recordsCount: totalRecords };
}

// Restore tables from backup data
export async function restoreFromBackup(backupData: Record<string, any[]>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Delete in reverse dependency order
  await db.delete(inventoryTransactions);
  await db.delete(attachments);
  await db.delete(ticketStatusHistory);
  await db.delete(notifications);
  await db.delete(auditLogs);
  await db.delete(purchaseOrderItems);
  await db.delete(purchaseOrders);
  await db.delete(inventory);
  await db.delete(tickets);
  await db.delete(sites);
  // Don't delete users to preserve login sessions

  // Insert in dependency order
  if (backupData.sites?.length) await db.insert(sites).values(backupData.sites);
  if (backupData.tickets?.length) await db.insert(tickets).values(backupData.tickets);
  if (backupData.ticket_status_history?.length) await db.insert(ticketStatusHistory).values(backupData.ticket_status_history);
  if (backupData.purchase_orders?.length) await db.insert(purchaseOrders).values(backupData.purchase_orders);
  if (backupData.purchase_order_items?.length) await db.insert(purchaseOrderItems).values(backupData.purchase_order_items);
  if (backupData.inventory?.length) await db.insert(inventory).values(backupData.inventory);
  if (backupData.inventory_transactions?.length) await db.insert(inventoryTransactions).values(backupData.inventory_transactions);
  if (backupData.notifications?.length) await db.insert(notifications).values(backupData.notifications);
  if (backupData.audit_logs?.length) await db.insert(auditLogs).values(backupData.audit_logs);
  if (backupData.attachments?.length) await db.insert(attachments).values(backupData.attachments);

  return { success: true };
}

// ============================================================
// ASSETS - إدارة الأصول
// ============================================================
export async function listAssets(filters?: { siteId?: number; sectionId?: number; status?: string; search?: string }) {
  const db = await getDb();
  if (!db) return [];
  let query = db.select().from(assets);
  const conditions = [];
  if (filters?.siteId) conditions.push(eq(assets.siteId, filters.siteId));
  if (filters?.sectionId) conditions.push(eq(assets.sectionId, filters.sectionId));
  if (filters?.status) conditions.push(eq(assets.status, filters.status as any));
  if (filters?.search) conditions.push(or(
    like(assets.name, `%${filters.search}%`),
    like(assets.assetNumber, `%${filters.search}%`),
    like(assets.serialNumber, `%${filters.search}%`)
  ));
  if (conditions.length > 0) return await (query as any).where(and(...conditions)).orderBy(desc(assets.createdAt));
  return await query.orderBy(desc(assets.createdAt));
}

export async function getAssetById(id: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(assets).where(eq(assets.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function createAsset(data: InsertAsset) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const result = await db.insert(assets).values(data);
  const id = (result as any)[0]?.insertId ?? null;
  if (!id) return { id };
  const rows = await db.select().from(assets).where(eq(assets.id, id)).limit(1);
  return rows[0] ?? { id };
}

export async function updateAsset(id: number, data: Partial<InsertAsset>) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.update(assets).set(data).where(eq(assets.id, id));
  const rows = await db.select().from(assets).where(eq(assets.id, id)).limit(1);
  return rows[0] ?? { success: true };
}

export async function deleteAsset(id: number) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.delete(assets).where(eq(assets.id, id));
  return { success: true };
}

export async function generateAssetNumber() {
  const db = await getDb();
  if (!db) return `AST-${Date.now()}`;
  const rows = await db.select({ cnt: count() }).from(assets);
  const n = (rows[0]?.cnt ?? 0) + 1;
  return `AST-${String(n).padStart(5, "0")}`;
}

// ============================================================
// PREVENTIVE PLANS - خطط الصيانة الوقائية
// ============================================================
export async function listPreventivePlans(filters?: { assetId?: number; siteId?: number; isActive?: boolean }) {
  const db = await getDb();
  if (!db) return [];
  const conditions = [];
  if (filters?.assetId) conditions.push(eq(preventivePlans.assetId, filters.assetId));
  if (filters?.siteId) conditions.push(eq(preventivePlans.siteId, filters.siteId));
  if (filters?.isActive !== undefined) conditions.push(eq(preventivePlans.isActive, filters.isActive));
  let query = db.select().from(preventivePlans);
  if (conditions.length > 0) return await (query as any).where(and(...conditions)).orderBy(desc(preventivePlans.createdAt));
  return await query.orderBy(desc(preventivePlans.createdAt));
}

export async function getPreventivePlanById(id: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(preventivePlans).where(eq(preventivePlans.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function createPreventivePlan(data: InsertPreventivePlan) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const result = await db.insert(preventivePlans).values(data);
  const id = (result as any)[0]?.insertId ?? null;
  return { id };
}

export async function updatePreventivePlan(id: number, data: Partial<InsertPreventivePlan>) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.update(preventivePlans).set(data).where(eq(preventivePlans.id, id));
  return { success: true };
}

export async function deletePreventivePlan(id: number) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.delete(preventivePlans).where(eq(preventivePlans.id, id));
  return { success: true };
}

export async function generatePlanNumber() {
  const db = await getDb();
  if (!db) return `PM-${Date.now()}`;
  const rows = await db.select({ cnt: count() }).from(preventivePlans);
  const n = (rows[0]?.cnt ?? 0) + 1;
  return `PM-${String(n).padStart(5, "0")}`;
}

// ============================================================
// PM WORK ORDERS - أوامر العمل الوقائية
// ============================================================
export async function listPMWorkOrders(filters?: { planId?: number; assetId?: number; status?: string; assignedToId?: number }) {
  const db = await getDb();
  if (!db) return [];
  const conditions = [];
  if (filters?.planId) conditions.push(eq(pmWorkOrders.planId, filters.planId));
  if (filters?.assetId) conditions.push(eq(pmWorkOrders.assetId, filters.assetId));
  if (filters?.status) conditions.push(eq(pmWorkOrders.status, filters.status as any));
  if (filters?.assignedToId) conditions.push(eq(pmWorkOrders.assignedToId, filters.assignedToId));
  let query = db.select().from(pmWorkOrders);
  const rows = conditions.length > 0
    ? await (query as any).where(and(...conditions)).orderBy(desc(pmWorkOrders.scheduledDate))
    : await query.orderBy(desc(pmWorkOrders.scheduledDate));
  // Normalize: ensure checklistResults is always an array (never null)
  return rows.map((r: any) => ({ ...r, checklistResults: Array.isArray(r.checklistResults) ? r.checklistResults : [] }));
}

export async function getPMWorkOrderById(id: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(pmWorkOrders).where(eq(pmWorkOrders.id, id)).limit(1);
  const r = rows[0] ?? null;
  if (!r) return null;
  // Normalize: ensure checklistResults is always an array (never null)
  return { ...r, checklistResults: Array.isArray(r.checklistResults) ? r.checklistResults : [] };
}

export async function createPMWorkOrder(data: InsertPMWorkOrder) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const result = await db.insert(pmWorkOrders).values(data);
  const id = (result as any)[0]?.insertId ?? null;
  return { id };
}

export async function updatePMWorkOrder(id: number, data: Partial<InsertPMWorkOrder>) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.update(pmWorkOrders).set(data).where(eq(pmWorkOrders.id, id));
  return { success: true };
}

export async function generateWorkOrderNumber() {
  const db = await getDb();
  if (!db) return `WO-${Date.now()}`;
  const rows = await db.select({ cnt: count() }).from(pmWorkOrders);
  const n = (rows[0]?.cnt ?? 0) + 1;
  return `WO-${String(n).padStart(5, "0")}`;
}

// Calculate next due date based on frequency
export function calcNextDueDate(from: Date, frequency: string, frequencyValue: number = 1): Date {
  const d = new Date(from);
  switch (frequency) {
    case "daily": d.setDate(d.getDate() + frequencyValue); break;
    case "weekly": d.setDate(d.getDate() + 7 * frequencyValue); break;
    case "monthly": d.setMonth(d.getMonth() + frequencyValue); break;
    case "quarterly": d.setMonth(d.getMonth() + 3 * frequencyValue); break;
    case "biannual": d.setMonth(d.getMonth() + 6 * frequencyValue); break;
    case "annual": d.setFullYear(d.getFullYear() + frequencyValue); break;
  }
  return d;
}


// ============================================================
// RFID OPERATIONS
// ============================================================
export async function getAssetByRfidTag(rfidTag: string) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(assets).where(eq(assets.rfidTag, rfidTag)).limit(1);
  return rows[0] ?? null;
}

export async function updateAssetRfidTag(assetId: number, rfidTag: string | null) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  if (rfidTag && rfidTag.trim()) {
    // Check if RFID tag already exists
    const existing = await db.select().from(assets).where(eq(assets.rfidTag, rfidTag)).limit(1);
    if (existing.length > 0 && existing[0].id !== assetId) {
      throw new Error("RFID tag already assigned to another asset");
    }
  }
  await db.update(assets).set({ rfidTag: rfidTag || null }).where(eq(assets.id, assetId));
  return { success: true };
}

export async function listAssetsWithRfid() {
  const db = await getDb();
  if (!db) return [];
  return await db.select({
    id: assets.id,
    assetNumber: assets.assetNumber,
    name: assets.name,
    rfidTag: assets.rfidTag,
    status: assets.status,
    siteId: assets.siteId,
  }).from(assets).where(isNotNull(assets.rfidTag));
}

// ============================================================
// ASSET MAINTENANCE HISTORY - سجل الصيانة الكامل للأصل
// ============================================================
export async function getAssetMaintenanceHistory(assetId: number) {
  const db = await getDb();
  if (!db) return { tickets: [], pmPlans: [], workOrders: [] };

  // Fetch all tickets linked to this asset
  const assetTickets = await db
    .select()
    .from(tickets)
    .where(eq(tickets.assetId, assetId))
    .orderBy(desc(tickets.createdAt));

  // Fetch all preventive plans for this asset
  const assetPlans = await db
    .select()
    .from(preventivePlans)
    .where(eq(preventivePlans.assetId, assetId))
    .orderBy(desc(preventivePlans.createdAt));

  // Fetch all PM work orders for this asset
  const assetWorkOrders = await db
    .select()
    .from(pmWorkOrders)
    .where(eq(pmWorkOrders.assetId, assetId))
    .orderBy(desc(pmWorkOrders.scheduledDate));

  return {
    tickets: assetTickets,
    pmPlans: assetPlans,
    workOrders: assetWorkOrders,
  };
}

export async function getAssetMaintenanceStats(assetId: number) {
  const db = await getDb();
  if (!db) return null;

  const [ticketRows, planRows, woRows] = await Promise.all([
    db.select({ cnt: count() }).from(tickets).where(eq(tickets.assetId, assetId)),
    db.select({ cnt: count() }).from(preventivePlans).where(eq(preventivePlans.assetId, assetId)),
    db.select({ cnt: count() }).from(pmWorkOrders).where(eq(pmWorkOrders.assetId, assetId)),
  ]);

  const openTickets = await db
    .select({ cnt: count() })
    .from(tickets)
    .where(and(eq(tickets.assetId, assetId), notInArray(tickets.status, ["closed", "rejected"] as any)));

  const completedWOs = await db
    .select({ cnt: count() })
    .from(pmWorkOrders)
    .where(and(eq(pmWorkOrders.assetId, assetId), eq(pmWorkOrders.status, "completed")));

  return {
    totalTickets: ticketRows[0]?.cnt ?? 0,
    openTickets: openTickets[0]?.cnt ?? 0,
    totalPMPlans: planRows[0]?.cnt ?? 0,
    totalWorkOrders: woRows[0]?.cnt ?? 0,
    completedWorkOrders: completedWOs[0]?.cnt ?? 0,
  };
}

// ============================================================
// ASSET SPARE PARTS - ربط الأصول بالأجزاء
// ============================================================
export async function addAssetSparePart(data: any) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const result = await db.insert(assetSpareParts).values(data);
  const id = (result as any)[0]?.insertId ?? null;
  return { id };
}

export async function getAssetSpareParts(assetId: number) {
  const db = await getDb();
  if (!db) return [];
  return await db
    .select({
      id: assetSpareParts.id,
      assetId: assetSpareParts.assetId,
      inventoryItemId: assetSpareParts.inventoryItemId,
      minStockLevel: assetSpareParts.minStockLevel,
      preferredQuantity: assetSpareParts.preferredQuantity,
      notes: assetSpareParts.notes,
      item: {
        id: inventory.id,
        itemName: inventory.itemName,
        quantity: inventory.quantity,
        minQuantity: inventory.minQuantity,
      },
    })
    .from(assetSpareParts)
    .innerJoin(inventory, eq(assetSpareParts.inventoryItemId, inventory.id))
    .where(eq(assetSpareParts.assetId, assetId));
}

export async function removeAssetSparePart(id: number) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.delete(assetSpareParts).where(eq(assetSpareParts.id, id));
  return { success: true };
}

// ============================================================
// PM JOBS - وظائف الصيانة الوقائية التلقائية
// ============================================================
export async function createPMJob(data: any) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const result = await db.insert(pmJobs).values(data);
  const id = (result as any)[0]?.insertId ?? null;
  return { id };
}

export async function getPendingPMJobs() {
  const db = await getDb();
  if (!db) return [];
  const now = new Date();
  return await db
    .select()
    .from(pmJobs)
    .where(and(eq(pmJobs.status, "pending"), lte(pmJobs.dueDate, now)))
    .orderBy(asc(pmJobs.dueDate));
}

export async function updatePMJob(id: number, data: Partial<any>) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.update(pmJobs).set(data).where(eq(pmJobs.id, id));
  return { success: true };
}

// ============================================================
// ASSET METRICS - مؤشرات أداء الأصول
// ============================================================
export async function getOrCreateAssetMetrics(assetId: number) {
  const db = await getDb();
  if (!db) return null;
  
  let metrics = await db
    .select()
    .from(assetMetrics)
    .where(eq(assetMetrics.assetId, assetId))
    .limit(1);
  
  if (metrics.length === 0) {
    await db.insert(assetMetrics).values({ assetId });
    metrics = await db
      .select()
      .from(assetMetrics)
      .where(eq(assetMetrics.assetId, assetId))
      .limit(1);
  }
  
  return metrics[0] ?? null;
}

export async function calculateAssetMetrics(assetId: number) {
  const db = await getDb();
  if (!db) return null;

  // Get all tickets for this asset
  const assetTickets = await db
    .select()
    .from(tickets)
    .where(eq(tickets.assetId, assetId));

  const totalTickets = assetTickets.length;
  const closedTickets = assetTickets.filter((t: any) => t.status === "closed").length;

  // Calculate MTTR (Mean Time To Repair)
  let totalRepairTime = 0;
  let repairCount = 0;
  
  for (const ticket of assetTickets) {
    if (ticket.closedAt && ticket.createdAt) {
      const repairTime = (new Date(ticket.closedAt).getTime() - new Date(ticket.createdAt).getTime()) / (1000 * 60 * 60); // in hours
      totalRepairTime += repairTime;
      repairCount++;
    }
  }

  const mttr = repairCount > 0 ? totalRepairTime / repairCount : 0;

  // Calculate MTBF (Mean Time Between Failures)
  let mtbf = 0;
  if (closedTickets > 1) {
    const sortedTickets = assetTickets
      .filter((t: any) => t.status === "closed")
      .sort((a: any, b: any) => new Date(a.closedAt).getTime() - new Date(b.closedAt).getTime());
    
    let totalTimeBetweenFailures = 0;
    for (let i = 1; i < sortedTickets.length; i++) {
      const prevClosedAt = sortedTickets[i - 1].closedAt as Date | null;
      const closedTime = prevClosedAt ? new Date(prevClosedAt).getTime() : new Date(sortedTickets[i - 1].createdAt).getTime();
      const timeBetween = (new Date(sortedTickets[i].createdAt).getTime() - closedTime) / (1000 * 60 * 60); // in hours
      totalTimeBetweenFailures += timeBetween;
    }
    mtbf = totalTimeBetweenFailures / (sortedTickets.length - 1);
  }

  // Calculate availability
  const totalDowntime = assetTickets.reduce((sum: number, t: any) => {
    if (t.closedAt && t.createdAt) {
      return sum + (new Date(t.closedAt).getTime() - new Date(t.createdAt).getTime());
    }
    return sum;
  }, 0);

  const availability = 100 - (totalDowntime / (90 * 24 * 60 * 60 * 1000)) * 100; // Assuming 90 days reference period

  // Update metrics
  const lastFailure = assetTickets
    .filter((t: any) => t.status === "closed")
    .sort((a: any, b: any) => new Date(b.closedAt).getTime() - new Date(a.closedAt).getTime())[0];

  const metrics = await getOrCreateAssetMetrics(assetId);
  if (metrics) {
    await db.update(assetMetrics).set({
      totalTickets,
      closedTickets,
      totalDowntime: Math.floor(totalDowntime / (1000 * 60)),
      mttr: String(Math.round(mttr * 100) / 100),
      mtbf: String(Math.round(mtbf * 100) / 100),
      availability: String(Math.max(0, Math.min(100, Math.round(availability * 100) / 100))),
      lastFailureDate: lastFailure?.closedAt,
      lastRepairDate: lastFailure?.closedAt,
    }).where(eq(assetMetrics.assetId, assetId));
  }

  return metrics;
}

export async function getAssetMetricsById(assetId: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select()
    .from(assetMetrics)
    .where(eq(assetMetrics.assetId, assetId))
    .limit(1);
  return rows[0] ?? null;
}

export async function getAllAssetMetrics() {
  const db = await getDb();
  if (!db) return [];
  return await db.select().from(assetMetrics).orderBy(desc(assetMetrics.mttr));
}


/**
 * Get low stock inventory items
 */
export async function getLowStockItems() {
  const db = await getDb();
  if (!db) return [];

  return db
    .select({
      id: inventory.id,
      itemName: inventory.itemName,
      quantity: inventory.quantity,
      minQuantity: inventory.minQuantity,
      unit: inventory.unit,
      location: inventory.location,
      siteId: inventory.siteId,
    })
    .from(inventory)
    .where(lte(inventory.quantity, inventory.minQuantity));
}

/**
 * Get spare parts for asset with low stock
 */
export async function getAssetSparePartsWithLowStock(assetId: number) {
  const db = await getDb();
  if (!db) return [];

  return db
    .select({
      assetId: assetSpareParts.assetId,
      minStockLevel: assetSpareParts.minStockLevel,
      preferredQuantity: assetSpareParts.preferredQuantity,
      item: {
        id: inventory.id,
        itemName: inventory.itemName,
        quantity: inventory.quantity,
        minQuantity: inventory.minQuantity,
      },
    })
    .from(assetSpareParts)
    .innerJoin(inventory, eq(assetSpareParts.inventoryItemId, inventory.id))
    .where(and(
      eq(assetSpareParts.assetId, assetId),
      lte(inventory.quantity, assetSpareParts.minStockLevel)
    ));
}

/**
 * Get inventory alerts
 */
export async function getInventoryAlerts() {
  const db = await getDb();
  if (!db) return [];

  const lowStockItems = await getLowStockItems();
  
  return lowStockItems.map((item: any) => ({
    id: item.id,
    type: "low_stock" as const,
    itemName: item.itemName,
    currentQuantity: item.quantity,
    minimumQuantity: item.minQuantity,
    unit: item.unit,
    location: item.location,
    siteId: item.siteId,
    severity: item.quantity === 0 ? "critical" : item.quantity <= item.minQuantity / 2 ? "high" : "medium",
    message: item.quantity === 0 
      ? `${item.itemName} is out of stock` 
      : `${item.itemName} is below minimum level (${item.quantity}/${item.minQuantity} ${item.unit})`,
  }));
}


// ============================================================
// TWO-FACTOR AUTHENTICATION HELPERS
// ============================================================

/**
 * Create or update 2FA secret for a user
 */
export async function createTwoFactorSecret(data: {
  userId: number;
  secret: string;
  backupCodes: string;
  isEnabled: boolean;
  enabledAt?: Date;
}) {
  try {
    const database = await getDb();
    if (!database) return null;
    const result = await database
      .insert(twoFactorSecrets)
      .values({
        userId: data.userId,
        secret: data.secret,
        backupCodes: data.backupCodes,
        isEnabled: data.isEnabled,
        enabledAt: data.enabledAt || new Date(),
      })
      .onDuplicateKeyUpdate({
        set: {
          secret: data.secret,
          backupCodes: data.backupCodes,
          isEnabled: data.isEnabled,
          enabledAt: data.enabledAt || new Date(),
          updatedAt: new Date(),
        },
      });
    return result;
  } catch (error) {
    console.error('Error creating 2FA secret:', error);
    throw error;
  }
}

/**
 * Get 2FA secret for a user
 */
export async function getTwoFactorSecret(userId: number) {
  try {
    const database = await getDb();
    if (!database) return null;
    const result = await database
      .select()
      .from(twoFactorSecrets)
      .where(eq(twoFactorSecrets.userId, userId))
      .limit(1);
    return result[0] || null;
  } catch (error) {
    console.error('Error getting 2FA secret:', error);
    throw error;
  }
}

/**
 * Disable 2FA for a user
 */
export async function disableTwoFactor(userId: number) {
  try {
    const database = await getDb();
    if (!database) return null;
    const result = await database
      .update(twoFactorSecrets)
      .set({
        isEnabled: false,
        updatedAt: new Date(),
      })
      .where(eq(twoFactorSecrets.userId, userId));
    return result;
  } catch (error) {
    console.error('Error disabling 2FA:', error);
    throw error;
  }
}

/**
 * Create 2FA audit log entry
 */
export async function createTwoFactorAuditLog(data: {
  userId: number;
  action: string;
  ipAddress?: string;
  userAgent?: string;
  success: boolean;
  details?: string;
}) {
  try {
    const database = await getDb();
    if (!database) return null;
    const result = await database
      .insert(twoFactorAuditLogs)
      .values({
        userId: data.userId,
        action: data.action,
        ipAddress: data.ipAddress,
        userAgent: data.userAgent,
        success: data.success,
        details: data.details,
      });
    return result;
  } catch (error) {
    console.error('Error creating 2FA audit log:', error);
    throw error;
  }
}

/**
 * Get 2FA audit logs for a user
 */
export async function getTwoFactorAuditLogs(userId: number, limit: number = 50) {
  try {
    const database = await getDb();
    if (!database) return [];
    const result = await database
      .select()
      .from(twoFactorAuditLogs)
      .where(eq(twoFactorAuditLogs.userId, userId))
      .orderBy(desc(twoFactorAuditLogs.createdAt))
      .limit(limit);
    return result;
  } catch (error) {
    console.error('Error getting 2FA audit logs:', error);
    throw error;
  }
}

/**
 * Check if user has 2FA enabled
 */
export async function isTwoFactorEnabled(userId: number): Promise<boolean> {
  try {
    const secret = await getTwoFactorSecret(userId);
    return secret?.isEnabled || false;
  } catch (error) {
    console.error('Error checking 2FA status:', error);
    return false;
  }
}

// ============================================================
// PUSH SUBSCRIPTIONS
// ============================================================
export async function savePushSubscription(data: {
  userId: number;
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent?: string;
}) {
  const db = await getDb();
  if (!db) return null;
  // Upsert by endpoint
  const existing = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.endpoint, data.endpoint)).limit(1);
  if (existing.length > 0) {
    await db.update(pushSubscriptions).set({ userId: data.userId, p256dh: data.p256dh, auth: data.auth }).where(eq(pushSubscriptions.endpoint, data.endpoint));
    return existing[0].id;
  }
  const result = await db.insert(pushSubscriptions).values(data);
  return result[0].insertId;
}

export async function deletePushSubscription(endpoint: string) {
  const db = await getDb();
  if (!db) return;
  await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint));
}

export async function getPushSubscriptionsByUser(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId));
}

export async function getAllPushSubscriptions() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(pushSubscriptions);
}

export async function getAllPOItems() {
  const db = await getDb();
  if (!db) return [];
  const items = await db.select().from(purchaseOrderItems).orderBy(desc(purchaseOrderItems.createdAt));
  return items.map(i => ({
    ...i,
    estimatedById: i.estimatedById ? Number(i.estimatedById) : null,
    delegateId: i.delegateId ? Number(i.delegateId) : null,
    purchasedById: i.purchasedById ? Number(i.purchasedById) : null,
    receivedById: i.receivedById ? Number(i.receivedById) : null,
    deliveredById: i.deliveredById ? Number(i.deliveredById) : null,
    deliveredToId: i.deliveredToId ? Number(i.deliveredToId) : null,
  }));
}

// ============================================================
// INSPECTION RESULTS
// ============================================================
export async function createInspectionResult(data: InsertInspectionResult) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.insert(inspectionResults).values(data);
  return { id: result[0].insertId };
}

export async function getInspectionResultsByTicket(ticketId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(inspectionResults).where(eq(inspectionResults.ticketId, ticketId));
}

export async function getInspectionResultsByAsset(assetId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(inspectionResults).where(eq(inspectionResults.assetId, assetId));
}
export async function getInspectionDashboardStats() {
  const db = await getDb();
  if (!db) return { totalInspections: 0, mostFrequentRootCause: "-", highestSeverity: "low", mostInspectedAsset: null };
  // 1. Total inspections
  const [totalRow] = await db.select({ total: count() }).from(inspectionResults);
  const totalInspections = Number(totalRow?.total ?? 0);
  // 2. Most frequent rootCause
  const rootCauseRows = await db
    .select({ rootCause: inspectionResults.rootCause, cnt: count() })
    .from(inspectionResults)
    .groupBy(inspectionResults.rootCause)
    .orderBy(desc(count()))
    .limit(1);
  const mostFrequentRootCause = rootCauseRows[0]?.rootCause ?? "-";
  // 3. Highest severity
  const severityRows = await db
    .select({ severity: inspectionResults.severity })
    .from(inspectionResults)
    .orderBy(sql`FIELD(${inspectionResults.severity}, 'low', 'medium', 'high', 'critical') DESC`)
    .limit(1);
  const highestSeverity = severityRows[0]?.severity ?? "low";
  // 4. Most inspected asset
  const assetRows = await db
    .select({ assetId: inspectionResults.assetId, cnt: count() })
    .from(inspectionResults)
    .groupBy(inspectionResults.assetId)
    .orderBy(desc(count()))
    .limit(1);
  const mostInspectedAsset = assetRows[0]
    ? { assetId: assetRows[0].assetId as number, count: Number(assetRows[0].cnt) }
    : null;
  return { totalInspections, mostFrequentRootCause, highestSeverity, mostInspectedAsset };
}

// ============================================================
// ASSET CATEGORIES
// ============================================================
export async function listAssetCategories() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(assetCategories).orderBy(asc(assetCategories.name));
}
export async function createAssetCategory(name: string) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.insert(assetCategories).values({ name });
  return { id: result[0].insertId, name };
}
export async function updateAssetCategory(id: number, name: string) {
  const db = await getDb();
  if (!db) return null;
  await db.update(assetCategories).set({ name }).where(eq(assetCategories.id, id));
  return { id, name };
}
export async function deleteAssetCategory(id: number) {
  const db = await getDb();
  if (!db) return null;
  await db.delete(assetCategories).where(eq(assetCategories.id, id));
  return { id };
}

// ============================================================
// WAREHOUSE RECEIPTS
// ============================================================

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

export async function getInventoryByBarcode(code: string) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(inventory)
    .where(or(
      eq(inventory.internalCode, code),
      eq(inventory.manufacturerBarcode, code)
    ))
    .limit(1);
  return rows[0] || null;
}

export async function getInventoryBySearch(search: string) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(inventory)
    .where(or(
      like(inventory.internalCode, `%${search}%`),
      like(inventory.manufacturerBarcode, `%${search}%`),
      like(inventory.itemName, `%${search}%`)
    ))
    .orderBy(desc(inventory.updatedAt));
}

// ============================================================
// WAREHOUSE RETURNS
// ============================================================

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

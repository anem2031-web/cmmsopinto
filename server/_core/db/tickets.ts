// ============================================================
// db/tickets.ts — البلاغات وسجل حالاتها وتأكيداتها
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


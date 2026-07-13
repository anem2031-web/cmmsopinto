// ============================================================
// db/org.ts — الهيكل التنظيمي: المواقع والأقسام والفنيون
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


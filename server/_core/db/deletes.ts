// ============================================================
// db/deletes.ts — عمليات الحذف المتقاطعة
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


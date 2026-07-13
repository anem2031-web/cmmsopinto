// ============================================================
// db/backups.ts — النسخ الاحتياطي
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


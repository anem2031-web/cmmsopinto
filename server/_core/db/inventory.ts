// ============================================================
// db/inventory.ts — المخزون والبحث بالباركود
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


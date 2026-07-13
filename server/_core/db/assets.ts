// ============================================================
// db/assets.ts — الأصول: السجل، RFID، الفحوص، الفئات، المؤشرات
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


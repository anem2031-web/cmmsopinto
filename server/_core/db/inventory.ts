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
  catalogItems,
  catalogNodes,
} from "../../../drizzle/schema";
import { ENV } from '../env';


import { getDb } from "./client";
import { calculateInventoryValue, calculateMovementTotal, normalizeInventoryQuantity } from "../inventory-costing";
import { operationalIssuesEnabled } from "../../services/operational-issues/feature";
import { activeBookStockUnit } from "../inventory-book-policy";

// ============================================================
// INVENTORY
// ============================================================

/**
 * Future-facing Inventory identity guard for receipt flows.
 * Catalog Item is the master identity; Inventory is the stock state inside a warehouse.
 * We intentionally return at most two rows: one means safe automatic reuse, two means
 * legacy ambiguity that must not be resolved by creating a third Inventory row.
 */
export async function getInventoryMatchesByCatalogItemAndWarehouse(
  catalogItemId: number,
  warehouseId: number,
  tx?: any,
  issueUnit?: string,
) {
  const db = tx || await getDb();
  if (!db) return [];

  if (issueUnit != null) {
    if (!tx) throw new Error("اختيار سجل دفتر الاستلام يتطلب معاملة قائمة");
    const [masters] = await tx.execute(sql`SELECT id FROM catalog_items WHERE id=${catalogItemId} FOR UPDATE`);
    if(!masters.length) throw new Error("صنف الكتالوج غير موجود");
    return tx.select({ id: inventory.id, warehouseId: inventory.warehouseId, linkedItemId: inventory.linkedItemId })
      .from(inventory).where(and(eq(inventory.linkedItemId, catalogItemId), eq(inventory.warehouseId, warehouseId), activeBookStockUnit(issueUnit)))
      .orderBy(asc(inventory.id)).limit(1);
  }

  return db.select({
    id: inventory.id,
    warehouseId: inventory.warehouseId,
    linkedItemId: inventory.linkedItemId,
  })
    .from(inventory)
    .where(and(
      eq(inventory.linkedItemId, catalogItemId),
      eq(inventory.warehouseId, warehouseId),
    ))
    .limit(2);
}

export async function getInventoryItems() {
  const db = await getDb();
  if (!db) return [];

  // أصناف مجمَّدة يدوياً (isFrozen = 1) لا تظهر في قائمة المخزون الرئيسية.
  // راجع: docs/CMMS_INVENTORY_FROZEN_ITEMS_2026-08-29.md
  const items = await db.select().from(inventory)
    .where(eq(inventory.isFrozen, 0))
    .orderBy(desc(inventory.updatedAt));
  if (items.length === 0) return [];
  const itemIds = items.map(i => i.id);

  // آخر معاملة "شراء" لكل صنف — المصدر الصحيح لتاريخ آخر توريد وآخر سعر شراء فعلي
  // (وليس receiptId الثابت في inventory، ولا averageCost المتوسط التراكمي)
  const lastPurchases = await db
    .select({
      inventoryId:         inventoryTransactions.inventoryId,
      receiptId:           inventoryTransactions.receiptId,
      purchaseOrderItemId: inventoryTransactions.purchaseOrderItemId,
      invoiceDate:         warehouseReceipts.invoiceDate,
      unitCost:            inventoryTransactions.unitCost,
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

  // unitCost في inventory_transactions أصبح تكلفة "وحدة المخزون/الصرف"
  // حتى تتسق كمية الحركة مع تكلفتها. أما بطاقة الصنف بعنوان "آخر سعر شراء"
  // فيجب أن تعرض سعر وحدة الشراء الأصلي من سطر سند الاستلام.
  const receiptIds = Array.from(new Set(
    lastPurchases.map(tx => tx.receiptId).filter((id): id is number => !!id),
  ));
  const purchaseReceiptCostByExactKey = new Map<string, string>();
  const purchaseReceiptCostByFallbackKey = new Map<string, string>();
  if (receiptIds.length > 0) {
    const receiptCostRows = await db
      .select({
        receiptId:           warehouseReceiptItems.receiptId,
        inventoryId:         warehouseReceiptItems.inventoryId,
        purchaseOrderItemId: warehouseReceiptItems.purchaseOrderItemId,
        unitCost:            warehouseReceiptItems.unitCost,
      })
      .from(warehouseReceiptItems)
      .where(and(
        inArray(warehouseReceiptItems.receiptId, receiptIds),
        inArray(warehouseReceiptItems.inventoryId, itemIds),
      ));

    for (const row of receiptCostRows) {
      if (!row.inventoryId) continue;
      const fallbackKey = `${row.receiptId}:${row.inventoryId}`;
      if (!purchaseReceiptCostByFallbackKey.has(fallbackKey)) {
        purchaseReceiptCostByFallbackKey.set(fallbackKey, row.unitCost);
      }
      const exactKey = `${row.receiptId}:${row.inventoryId}:${row.purchaseOrderItemId ?? 0}`;
      purchaseReceiptCostByExactKey.set(exactKey, row.unitCost);
    }
  }

  // نأخذ أول ظهور لكل inventoryId (الأحدث، بسبب الترتيب التنازلي أعلاه)
  const latestInvoiceDateByItem = new Map<number, Date | null>();
  const latestPurchasePriceByItem = new Map<number, string | null>();
  for (const tx of lastPurchases) {
    if (!latestInvoiceDateByItem.has(tx.inventoryId)) {
      latestInvoiceDateByItem.set(tx.inventoryId, tx.invoiceDate);
      const exactKey = tx.receiptId
        ? `${tx.receiptId}:${tx.inventoryId}:${tx.purchaseOrderItemId ?? 0}`
        : "";
      const fallbackKey = tx.receiptId ? `${tx.receiptId}:${tx.inventoryId}` : "";
      latestPurchasePriceByItem.set(
        tx.inventoryId,
        (exactKey && purchaseReceiptCostByExactKey.get(exactKey))
          || (fallbackKey && purchaseReceiptCostByFallbackKey.get(fallbackKey))
          || tx.unitCost,
      );
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

// 2B-9 — طبقة قراءة إضافية لتصنيف Inventory من Master Catalog فقط.
// لا تغيّر عقد getInventoryItems() التاريخية ولا تضيف أي تصنيف مخزَّن على inventory.
// الواجهة تدمج هذه النتيجة مع القائمة حسب inventoryId.
export async function getInventoryCatalogTaxonomy() {
  const db = await getDb();
  if (!db) return [];

  const links = await db
    .select({
      inventoryId: inventory.id,
      catalogItemId: inventory.linkedItemId,
    })
    .from(inventory)
    .where(isNotNull(inventory.linkedItemId));

  if (links.length === 0) return [];

  const catalogItemIds = Array.from(new Set(
    links
      .map((row: any) => Number(row.catalogItemId || 0))
      .filter((id: number) => id > 0),
  ));
  if (catalogItemIds.length === 0) return [];

  const linkedCatalogItems = await db.select({
    id: catalogItems.id,
    code: catalogItems.code,
    nameAr: catalogItems.nameAr,
    nameEn: catalogItems.nameEn,
    nodeId: catalogItems.nodeId,
  }).from(catalogItems).where(inArray(catalogItems.id, catalogItemIds));

  const catalogItemById = new Map<number, any>(
    (linkedCatalogItems as any[]).map((item: any) => [Number(item.id), item]),
  );

  // نحتاج سلسلة الآباء كاملة لدعم فلترة أي Subtree؛ قراءة الشجرة مرة واحدة
  // تمنع N+1 ولا تنشئ أي mapping أو Taxonomy موازية.
  const taxonomyNodes = await db.select({
    id: catalogNodes.id,
    parentId: catalogNodes.parentId,
    level: catalogNodes.level,
    code: catalogNodes.code,
    nameAr: catalogNodes.nameAr,
    nameEn: catalogNodes.nameEn,
    isActive: catalogNodes.isActive,
  }).from(catalogNodes);

  const catalogNodeById = new Map<number, any>(
    (taxonomyNodes as any[]).map((node: any) => [Number(node.id), node]),
  );
  const pathCache = new Map<number, any[]>();

  const buildPath = (nodeId: number | null | undefined): any[] => {
    const numericNodeId = Number(nodeId || 0);
    if (!numericNodeId) return [];
    const cached = pathCache.get(numericNodeId);
    if (cached) return cached;

    const path: any[] = [];
    const visited = new Set<number>();
    let currentId: number | null = numericNodeId;
    for (let depth = 0; currentId && depth < 50; depth += 1) {
      if (visited.has(currentId)) break;
      visited.add(currentId);
      const node = catalogNodeById.get(currentId);
      if (!node) break;
      path.unshift(node);
      currentId = node.parentId == null ? null : Number(node.parentId);
    }
    pathCache.set(numericNodeId, path);
    return path;
  };

  return links.map((row: any) => {
    const catalogItem = catalogItemById.get(Number(row.catalogItemId));
    const categoryPath = catalogItem?.nodeId ? buildPath(Number(catalogItem.nodeId)) : [];
    const categoryNode = categoryPath.length > 0 ? categoryPath[categoryPath.length - 1] : null;
    return {
      inventoryId: Number(row.inventoryId),
      catalogItemId: Number(row.catalogItemId),
      catalogItemCode: catalogItem?.code ?? null,
      catalogItemNameAr: catalogItem?.nameAr ?? null,
      catalogItemNameEn: catalogItem?.nameEn ?? null,
      catalogNodeId: categoryNode?.id ?? null,
      catalogNodeCode: categoryNode?.code ?? null,
      catalogNodeNameAr: categoryNode?.nameAr ?? null,
      catalogNodeNameEn: categoryNode?.nameEn ?? null,
      catalogCategoryPath: categoryPath,
      catalogCategoryPathAr: categoryPath.map((node: any) => node.nameAr).filter(Boolean).join(" › ") || null,
      catalogCategoryPathEn: categoryPath.map((node: any) => node.nameEn).filter(Boolean).join(" > ") || null,
    };
  });
}

export async function createInventoryItem(data: any) {
  const db = await getDb();
  if (!db) return null;
  const normalizedData = {
    ...data,
    ...(data.quantity != null ? { quantity: normalizeInventoryQuantity(Number(data.quantity)) } : {}),
    ...(data.minQuantity != null ? { minQuantity: normalizeInventoryQuantity(Number(data.minQuantity)) } : {}),
  };
  const result = await db.insert(inventory).values(normalizedData);
  return result[0].insertId;
}

export async function updateInventoryItem(id: number, data: any) {
  const db = await getDb();
  if (!db) return;
  const normalizedData = {
    ...data,
    ...(data.quantity != null ? { quantity: normalizeInventoryQuantity(Number(data.quantity)) } : {}),
    ...(data.minQuantity != null ? { minQuantity: normalizeInventoryQuantity(Number(data.minQuantity)) } : {}),
  };
  await db.update(inventory).set(normalizedData).where(eq(inventory.id, id));
}

export async function addInventoryTransaction(data: any) {
  if (data.type === "out" && operationalIssuesEnabled()) throw new Error("الصرف يتطلب سندًا مرتبطًا ببلاغ أو مهمة أو أمر صرف تشغيلي معتمد");
  const db = await getDb();
  if (!db) return;

  const item = await db.select().from(inventory).where(eq(inventory.id, data.inventoryId)).limit(1);
  if (!item[0]) return;

  const currentQty = normalizeInventoryQuantity(Number(item[0].quantity || 0));
  const averageCost = parseFloat((item[0] as any).averageCost || "0");
  const movementQuantity = normalizeInventoryQuantity(Number(data.quantity));
  const rawNewQty = data.type === "in"
    ? currentQty + movementQuantity
    : currentQty - movementQuantity;
  // نحافظ على السلوك القديم في هذه المرحلة (عدم النزول تحت صفر)،
  // ونوحد فقط القيمة المحاسبية للحركة والرصيد.
  const newQty = normalizeInventoryQuantity(Math.max(0, rawNewQty));
  const movementUnitCost = data.unitCost != null
    ? parseFloat(String(data.unitCost))
    : averageCost;
  const movementTotalCost = data.totalCost != null
    ? parseFloat(String(data.totalCost))
    : calculateMovementTotal(movementQuantity, movementUnitCost);

  await db.insert(inventoryTransactions).values({
    ...data,
    quantity: movementQuantity,
    unitCost: movementUnitCost.toFixed(4),
    totalCost: movementTotalCost.toFixed(2),
  });

  await db.update(inventory).set({
    quantity: newQty,
    totalCostValue: calculateInventoryValue(newQty, averageCost).toFixed(2),
  } as any).where(eq(inventory.id, data.inventoryId));
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


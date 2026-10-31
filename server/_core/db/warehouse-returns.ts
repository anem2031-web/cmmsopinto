// ============================================================
// db/warehouse-returns.ts — إرجاعات المستودع
// (مُقسَّم من db.ts الأصلي حسب المجال الوظيفي)
// ============================================================
import { eq, desc, asc, and, sql, count, sum, inArray, notInArray, like, or, gte, lte, lt, isNull, isNotNull, ne } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { alias } from "drizzle-orm/mysql-core";
import mysql from "mysql2/promise";
import {
  InsertUser, users, tickets, purchaseOrders, purchaseOrderItems,
  inventory, inventoryTransactions, inventoryIssueCostAllocations, inventoryLots, inventoryLotBalances, notifications, auditLogs,
  materialExecutionCostContexts,
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
  warehouses,
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
import { getInventoryItemById, getUserById } from "./deletes";
import { getPOItemById, getPurchaseOrderById, getPOItems, updatePurchaseOrder } from "./purchase";
import { getNextDeliveryNumber, getNextReturnNumber } from "./warehouse-receipts";
import { calculateInventoryValue, calculateMovementTotal, normalizeInventoryQuantity, roundTo } from "../inventory-costing";
import { consumeInventoryLotForIssue, isInventoryLotsEnabled, resolveInventoryLotForSupplierReturn } from "../inventory-lots";
import { materialExecutionCostsEnabled } from "../../services/material-costs/feature";
import { resolveExecutionCostContext } from "../../services/material-costs/context";
import { getActiveCatalogUnitCanonicalName } from "../catalog-unit-governance";
import { assertOperationalIssueReference, recordOperationalDelivery } from "../../services/operational-issues/issue-reference";
import { captureDocumentSignature } from "../../../shared/documentSignatureSnapshot";

export async function createWarehouseReturn(data: InsertWarehouseReturn, tx?: any) {
  const db = tx || await getDb();
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
export async function getReturnSources(inventoryId: number, tx?: any) {
  const db = tx || await getDb();
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
      purchaseOrderId:     sql<number | null>`COALESCE(${purchaseOrderItems.purchaseOrderId}, ${warehouseReceipts.purchaseOrderId})`,
      poNumber:            purchaseOrders.poNumber,
    })
    .from(inventoryTransactions)
    .leftJoin(warehouseReceipts, eq(inventoryTransactions.receiptId, warehouseReceipts.id))
    .leftJoin(purchaseOrderItems, eq(inventoryTransactions.purchaseOrderItemId, purchaseOrderItems.id))
    .leftJoin(purchaseOrders, eq(sql`COALESCE(${purchaseOrderItems.purchaseOrderId}, ${warehouseReceipts.purchaseOrderId})`, purchaseOrders.id))
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



/**
 * 2B-8 — مرتجع مورد Lot-aware.
 *
 * هوية الدفعة هي مصدر الحقيقة: نقبل QR أو رقم اللوت ولا نثق بـ inventoryId/receiptId/PO ids من العميل.
 * كل تخفيضات الكمية (Lot balance + lot remaining + aggregate Inventory) وإنشاء
 * warehouse_return وحركة المخزون ووثيقة المرتجع تتم في Transaction واحدة.
 */
export async function createLotAwareSupplierReturn(params: {
  trackingToken: string;
  warehouseId: number;
  returnedQuantity: number;
  reason: string;
  recipientName?: string;
  returnedById: number;
}, existingTx?: any) {
  const database = existingTx || await getDb();
  if (!database) throw new Error("تعذر الاتصال بقاعدة البيانات");

  const returnedQuantity = normalizeInventoryQuantity(params.returnedQuantity);
  if (!(returnedQuantity > 0)) throw new Error("كمية المرتجع يجب أن تكون أكبر من صفر");
  // warehouse_returns.returnedQuantity ما زال INT في الـLive model الحالي؛ لا نوسّع
  // مستندات المرتجع إلى الكسور ضمن 5.2 بدون Schema/Workflow approval منفصل.
  if (!Number.isInteger(returnedQuantity)) {
    throw new Error("مسار مرتجع المورد الحالي يدعم الكميات الصحيحة فقط");
  }

  const performer = await getUserById(params.returnedById);

  const executeReturn = async (tx: any) => {
    const warehouseRows = await tx
      .select()
      .from(warehouses)
      .where(eq(warehouses.id, params.warehouseId))
      .limit(1);
    const warehouse: any = warehouseRows[0];
    if (!warehouse || !warehouse.isActive) {
      throw new Error("المستودع المحدد غير موجود أو غير مفعّل");
    }

    const resolvedLot = await resolveInventoryLotForSupplierReturn({
      tx,
      trackingToken: params.trackingToken,
      warehouseId: params.warehouseId,
    });

    const initialInventoryItem = await getInventoryItemById(resolvedLot.inventoryId, tx);
    if (!initialInventoryItem) throw new Error("سجل المخزون المرتبط بالدفعة غير موجود");

    const inventoryCatalogItemId = (initialInventoryItem as any).linkedItemId == null
      ? null
      : Number((initialInventoryItem as any).linkedItemId);
    if (
      resolvedLot.catalogItemId != null &&
      inventoryCatalogItemId != null &&
      resolvedLot.catalogItemId !== inventoryCatalogItemId
    ) {
      throw new Error("هوية الكتالوج للدفعة لا تطابق هوية الصنف في المخزون");
    }

    if (returnedQuantity > resolvedLot.balanceQuantity) {
      throw new Error(`الكمية المُرجَعة (${returnedQuantity}) أكبر من رصيد الدفعة في المستودع (${resolvedLot.balanceQuantity})`);
    }

    const receiptRows = await tx
      .select()
      .from(warehouseReceipts)
      .where(eq(warehouseReceipts.id, resolvedLot.receiptId!))
      .limit(1);
    const receipt: any = receiptRows[0];
    if (!receipt) throw new Error("سند الاستلام الأصلي للدفعة غير موجود");

    const purchaseOrderId = resolvedLot.purchaseOrderId ?? receipt.purchaseOrderId ?? null;
    const purchaseOrderItemId = resolvedLot.purchaseOrderItemId ?? null;

    // إن كان الـLot مرتبطاً ببند PO، نتحقق من أن البند يعود لنفس أمر الشراء.
    let poItem: any = null;
    if (purchaseOrderItemId) {
      poItem = await getPOItemById(purchaseOrderItemId, tx);
      if (!poItem) throw new Error("بند أمر الشراء الأصلي للدفعة غير موجود");
      if (purchaseOrderId && Number(poItem.purchaseOrderId) !== Number(purchaseOrderId)) {
        throw new Error("بند أمر الشراء في الدفعة لا يطابق أمر الشراء الأصلي");
      }
    }

    const consumedLot = await consumeInventoryLotForIssue({
      tx,
      trackingToken: resolvedLot.trackingToken,
      inventoryId: resolvedLot.inventoryId,
      inventoryCatalogItemId,
      quantity: returnedQuantity,
      actionLabel: "المرتجع",
    });

    // Phase 5.2: بعد حجز رصيد الـLot نقفل Aggregate Inventory ونقرأ الرصيد
    // ومتوسط التكلفة الحاليين. أي فشل بعد ذلك يعيد تعديلات الـLot بالـRollback.
    await tx.execute(sql`SELECT id FROM inventory WHERE id = ${resolvedLot.inventoryId} FOR UPDATE`);
    const lockedInventoryRows = await tx
      .select()
      .from(inventory)
      .where(eq(inventory.id, resolvedLot.inventoryId))
      .limit(1);
    const inventoryItem: any = lockedInventoryRows[0];
    if (!inventoryItem) throw new Error("سجل المخزون المرتبط بالدفعة لم يعد موجودًا");
    if (returnedQuantity > Number(inventoryItem.quantity || 0)) {
      throw new Error(`الكمية المتاحة في المخزون ${inventoryItem.quantity} أقل من الكمية المُرجَعة`);
    }

    const movementUnitCost = parseFloat(inventoryItem.averageCost || "0");
    const movementTotalCost = calculateMovementTotal(returnedQuantity, movementUnitCost);

    // تخفيض Aggregate Inventory شرطياً داخل نفس Transaction. القيمة تُخفض
    // باستخدام Current Average Cost المقروء من الخادم، لا أي تكلفة من العميل.
    const stockUpdateResult: any = await tx
      .update(inventory)
      .set({
        quantity: sql`${inventory.quantity} - ${returnedQuantity}`,
        totalCostValue: sql`ROUND((${inventory.quantity} - ${returnedQuantity}) * ${inventory.averageCost}, 2)`,
        updatedAt: new Date(),
      } as any)
      .where(and(
        eq(inventory.id, resolvedLot.inventoryId),
        gte(inventory.quantity, returnedQuantity),
      ));
    if (Number(stockUpdateResult?.[0]?.affectedRows ?? 0) !== 1) {
      throw new Error("رصيد المخزون تغيّر أثناء تنفيذ المرتجع؛ أعد مسح QR وحاول مرة أخرى");
    }

    // رقم المرتجع يُولَّد عبر نفس transaction writer. سياسة منع التكرار
    // الشاملة لأرقام المستندات تبقى ضمن 5.3 ولا نضيف UNIQUE/Counter جديد هنا.
    const returnNumber = await getNextReturnNumber(tx);

    const [returnInsert] = await tx.insert(warehouseReturns).values({
      returnNumber,
      receiptId: resolvedLot.receiptId,
      purchaseOrderId,
      purchaseOrderItemId,
      inventoryId: resolvedLot.inventoryId,
      lotId: resolvedLot.lotId,
      returnedQuantity,
      reason: params.reason,
      returnedById: params.returnedById,
    } as any);
    const returnId = Number((returnInsert as any)?.insertId || 0);
    if (!returnId) throw new Error("تعذر إنشاء سجل مرتجع المورد");

    await tx.insert(inventoryTransactions).values({
      inventoryId: resolvedLot.inventoryId,
      lotId: resolvedLot.lotId,
      type: "out",
      quantity: returnedQuantity,
      unitCost: movementUnitCost.toFixed(4),
      totalCost: movementTotalCost.toFixed(2),
      reason: `إرجاع للمورد - ${params.reason} - مرتجع ${returnNumber}`,
      purchaseOrderItemId,
      performedById: params.returnedById,
      transactionType: "return",
      receiptId: resolvedLot.receiptId,
      returnId,
      invoiceNumber: receipt.invoiceNumber ?? null,
    } as any);

    if (purchaseOrderItemId) {
      await tx.update(purchaseOrderItems).set({
        returnedQuantity: sql`COALESCE(${purchaseOrderItems.returnedQuantity}, 0) + ${returnedQuantity}`,
        returnReason: params.reason,
        returnedAt: new Date(),
      } as any).where(eq(purchaseOrderItems.id, purchaseOrderItemId));
    }

    // نحافظ على السلوك الحالي: إذا كان PO مكتمل الاستلام ثم حصل مرتجع، يعود
    // إلى partial_purchase. لا نغيّر حالات أخرى ضمن هذه الدفعة.
    if (purchaseOrderId) {
      await tx.update(purchaseOrders).set({ status: "partial_purchase" } as any)
        .where(and(
          eq(purchaseOrders.id, purchaseOrderId),
          eq(purchaseOrders.status, "received" as any),
        ));
    }

    const poRows = purchaseOrderId
      ? await tx.select({ poNumber: purchaseOrders.poNumber })
          .from(purchaseOrders)
          .where(eq(purchaseOrders.id, purchaseOrderId))
          .limit(1)
      : [];
    const poNumber = poRows[0]?.poNumber ?? null;

    await createReturnDocument({
      returnNumber,
      returnId,
      itemName: inventoryItem.itemName,
      internalCode: inventoryItem.internalCode,
      manufacturerBarcode: inventoryItem.manufacturerBarcode,
      returnedQuantity,
      unit: inventoryItem.unit || undefined,
      reason: params.reason,
      returnedByName: (performer as any)?.name || (performer as any)?.username || "—",
      recipientName: params.recipientName,
      receiptNumber: receipt.receiptNumber ?? undefined,
      invoiceNumber: receipt.invoiceNumber ?? undefined,
      vendorName: receipt.vendorName ?? undefined,
      poNumber: poNumber ?? undefined,
    }, tx);

    return {
      returnId,
      returnNumber,
      lotId: consumedLot.lotId,
      lotCode: consumedLot.lotCode,
      trackingToken: consumedLot.trackingToken,
      inventoryId: resolvedLot.inventoryId,
      warehouseId: resolvedLot.warehouseId,
      warehouseName: warehouse.nameAr ?? warehouse.nameEn ?? `#${resolvedLot.warehouseId}`,
      itemName: inventoryItem.itemName,
      unit: inventoryItem.unit || null,
      returnedQuantity,
      unitCostUsed: movementUnitCost,
      returnValue: movementTotalCost,
      receiptId: resolvedLot.receiptId,
      receiptNumber: receipt.receiptNumber ?? null,
      invoiceNumber: receipt.invoiceNumber ?? null,
      vendorName: receipt.vendorName ?? null,
      purchaseOrderId,
      purchaseOrderItemId,
      poNumber,
      lotRemainingInWarehouse: consumedLot.balanceQuantity,
      lotRemainingTotal: consumedLot.remainingQuantity,
    };
  };
  return existingTx ? executeReturn(existingTx) : database.transaction(executeReturn);
}

/**
 * Phase 5.2 — المسار Legacy لمرتجع المورد بدون Lots.
 *
 * لا نغيّر Workflow القديم، لكن نجمع رأس المرتجع + حركة المخزون + تخفيض
 * الكمية/القيمة + تحديث PO عند وجوده + وثيقة المرتجع داخل Transaction واحدة.
 * هذا يمنع ترك مستند أو حركة جزئية إذا فشل أي جزء لاحقًا.
 */
export async function createLegacySupplierReturn(params: {
  receiptId?: number;
  purchaseOrderId?: number;
  purchaseOrderItemId?: number;
  inventoryId: number;
  returnedQuantity: number;
  reason: string;
  recipientName?: string;
  returnedById: number;
}) {
  const database = await getDb();
  if (!database) throw new Error("تعذر الاتصال بقاعدة البيانات");

  const returnedQuantity = normalizeInventoryQuantity(params.returnedQuantity);
  if (!(returnedQuantity > 0)) throw new Error("كمية المرتجع يجب أن تكون أكبر من صفر");
  // لا نغيّر هنا سياسة الكسور للمسار Legacy اعتمادًا على code schema فقط؛
  // Live DB هو مصدر الحقيقة ويُفحص منفصلًا إذا أصبح هذا المسار ضمن UAT الفعلي.

  return database.transaction(async (tx: any) => {
    await tx.execute(sql`SELECT id FROM inventory WHERE id = ${params.inventoryId} FOR UPDATE`);
    const inventoryItem = await getInventoryItemById(params.inventoryId, tx) as any;
    if (!inventoryItem) throw new Error("الصنف غير موجود في المخزون");
    if (returnedQuantity > Number(inventoryItem.quantity || 0)) {
      throw new Error(`الكمية المتاحة في المخزون ${inventoryItem.quantity} أقل من الكمية المُرجَعة`);
    }

    let receipt: any = null;
    let matchedSource: any = null;
    if (params.receiptId) {
      const receiptRows = await tx.select().from(warehouseReceipts)
        .where(eq(warehouseReceipts.id, params.receiptId)).limit(1);
      receipt = receiptRows[0] || null;
      if (!receipt) throw new Error("سند الاستلام غير موجود");

      if (params.purchaseOrderId && Number(receipt.purchaseOrderId) !== Number(params.purchaseOrderId)) {
        throw new Error("طلب الشراء المُرسَل لا يطابق سند الاستلام المُختار");
      }

      const sources = await getReturnSources(params.inventoryId, tx);
      matchedSource = sources.find((source: any) => Number(source.receiptId) === Number(params.receiptId));
      if (!matchedSource) {
        throw new Error("سند الاستلام المُختار لا يطابق سجل استلام هذا الصنف");
      }
    }

    const purchaseOrderId = params.purchaseOrderId ?? receipt?.purchaseOrderId ?? null;
    const purchaseOrderItemId = params.purchaseOrderItemId ?? matchedSource?.purchaseOrderItemId ?? null;

    let poItem: any = null;
    if (purchaseOrderItemId) {
      poItem = await getPOItemById(purchaseOrderItemId, tx);
      if (!poItem) throw new Error("بند طلب الشراء غير موجود");
      if (purchaseOrderId && Number(poItem.purchaseOrderId) !== Number(purchaseOrderId)) {
        throw new Error("بند طلب الشراء المُرسَل لا يطابق طلب الشراء المرتبط بالمصدر");
      }
    }

    const returnNumber = await getNextReturnNumber(tx);
    const [returnInsert] = await tx.insert(warehouseReturns).values({
      returnNumber,
      receiptId: params.receiptId ?? null,
      purchaseOrderId,
      purchaseOrderItemId,
      inventoryId: params.inventoryId,
      returnedQuantity,
      reason: params.reason,
      returnedById: params.returnedById,
    } as any);
    const returnId = Number((returnInsert as any)?.insertId || 0);
    if (!returnId) throw new Error("تعذر إنشاء سجل مرتجع المورد");

    const movementUnitCost = parseFloat(inventoryItem.averageCost || "0");
    const movementTotalCost = calculateMovementTotal(returnedQuantity, movementUnitCost);

    const stockUpdateResult: any = await tx.update(inventory).set({
      quantity: sql`${inventory.quantity} - ${returnedQuantity}`,
      totalCostValue: sql`ROUND((${inventory.quantity} - ${returnedQuantity}) * ${inventory.averageCost}, 2)`,
      updatedAt: new Date(),
    } as any).where(and(
      eq(inventory.id, params.inventoryId),
      gte(inventory.quantity, returnedQuantity),
    ));
    if (Number(stockUpdateResult?.[0]?.affectedRows ?? 0) !== 1) {
      throw new Error("رصيد المخزون تغيّر أثناء تنفيذ المرتجع؛ أعد المحاولة");
    }

    await tx.insert(inventoryTransactions).values({
      inventoryId: params.inventoryId,
      type: "out",
      quantity: returnedQuantity,
      unitCost: movementUnitCost.toFixed(4),
      totalCost: movementTotalCost.toFixed(2),
      reason: params.receiptId
        ? `إرجاع للمورد - ${params.reason} - مرتجع ${returnNumber}`
        : `إرجاع عام (بلا سند استلام معروف) - ${params.reason} - مرتجع ${returnNumber}`,
      purchaseOrderItemId: purchaseOrderItemId ?? undefined,
      performedById: params.returnedById,
      transactionType: "return",
      receiptId: params.receiptId ?? undefined,
      returnId,
      invoiceNumber: receipt?.invoiceNumber ?? null,
    } as any);

    if (purchaseOrderItemId) {
      await tx.update(purchaseOrderItems).set({
        returnedQuantity: sql`COALESCE(${purchaseOrderItems.returnedQuantity}, 0) + ${returnedQuantity}`,
        returnReason: params.reason,
        returnedAt: new Date(),
      } as any).where(eq(purchaseOrderItems.id, purchaseOrderItemId));
    }

    if (purchaseOrderId) {
      await tx.update(purchaseOrders).set({ status: "partial_purchase" } as any)
        .where(and(
          eq(purchaseOrders.id, purchaseOrderId),
          eq(purchaseOrders.status, "received" as any),
        ));
    }

    const poRows = purchaseOrderId
      ? await tx.select({ poNumber: purchaseOrders.poNumber }).from(purchaseOrders)
          .where(eq(purchaseOrders.id, purchaseOrderId)).limit(1)
      : [];
    const poNumber = poRows[0]?.poNumber ?? null;

    const performerRows = await tx.select({ name: users.name, username: users.username })
      .from(users).where(eq(users.id, params.returnedById)).limit(1);
    const performer: any = performerRows[0];

    await createReturnDocument({
      returnNumber,
      returnId,
      itemName: inventoryItem.itemName,
      internalCode: inventoryItem.internalCode,
      manufacturerBarcode: inventoryItem.manufacturerBarcode,
      returnedQuantity,
      unit: inventoryItem.unit || undefined,
      reason: params.reason,
      returnedByName: performer?.name || performer?.username || "—",
      recipientName: params.recipientName,
      receiptNumber: receipt?.receiptNumber ?? undefined,
      invoiceNumber: receipt?.invoiceNumber ?? undefined,
      vendorName: receipt?.vendorName ?? undefined,
      poNumber: poNumber ?? undefined,
    }, tx);

    return {
      returnId,
      returnNumber,
      inventoryId: params.inventoryId,
      itemName: inventoryItem.itemName,
      unit: inventoryItem.unit || null,
      returnedQuantity,
      unitCostUsed: movementUnitCost,
      returnValue: movementTotalCost,
      receiptId: params.receiptId ?? null,
      invoiceNumber: receipt?.invoiceNumber ?? null,
      purchaseOrderId,
      purchaseOrderItemId,
      poNumber,
    };
  });
}


// ── Phase 5.2: Recipient → Warehouse Return ────────────────────────────────
// Approved policy (2026-08-22):
//   Same Original Lot + Original Issue Cost + Original Issue Link
//   + Partial/Over-return Guards + Atomic Posting.
// Historical supplier returns stay sourceDeliveryDocumentId = NULL.

async function readRecipientReturnSourceById(sourceDeliveryDocumentId: number, tx: any) {
  const rows = await tx
    .select({
      deliveryId: deliveryDocuments.id,
      deliveryNumber: deliveryDocuments.deliveryNumber,
      inventoryId: deliveryDocuments.inventoryId,
      lotId: deliveryDocuments.lotId,
      inventoryTransactionId: deliveryDocuments.inventoryTransactionId,
      itemName: deliveryDocuments.itemName,
      quantity: deliveryDocuments.quantity,
      unit: deliveryDocuments.unit,
      deliveredToId: deliveryDocuments.deliveredToId,
      deliveredToName: deliveryDocuments.deliveredToName,
      deliveredByName: deliveryDocuments.deliveredByName,
      ticketId: deliveryDocuments.ticketId,
      ticketNumber: deliveryDocuments.ticketNumber,
      poNumber: deliveryDocuments.poNumber,
      createdAt: deliveryDocuments.createdAt,
      warehouseId: inventory.warehouseId,
      inventoryQuantity: inventory.quantity,
      inventoryAverageCost: inventory.averageCost,
      inventoryTotalCostValue: inventory.totalCostValue,
      internalCode: inventory.internalCode,
      manufacturerBarcode: inventory.manufacturerBarcode,
      lotCode: inventoryLots.lotCode,
      lotTrackingToken: inventoryLots.trackingToken,
      lotRemainingQuantity: inventoryLots.remainingQuantity,
      movementId: inventoryTransactions.id,
      movementInventoryId: inventoryTransactions.inventoryId,
      movementLotId: inventoryTransactions.lotId,
      movementType: inventoryTransactions.type,
      movementTransactionType: inventoryTransactions.transactionType,
      movementQuantity: inventoryTransactions.quantity,
      movementUnitCost: inventoryTransactions.unitCost,
      movementTotalCost: inventoryTransactions.totalCost,
      movementTicketId: inventoryTransactions.ticketId,
      movementPurchaseOrderItemId: inventoryTransactions.purchaseOrderItemId,
      warehouseNameAr: warehouses.nameAr,
      warehouseNameEn: warehouses.nameEn,
    })
    .from(deliveryDocuments)
    .leftJoin(inventory, eq(inventory.id, deliveryDocuments.inventoryId))
    .leftJoin(inventoryLots, eq(inventoryLots.id, deliveryDocuments.lotId))
    .leftJoin(inventoryTransactions, eq(inventoryTransactions.id, deliveryDocuments.inventoryTransactionId))
    .leftJoin(warehouses, eq(warehouses.id, inventory.warehouseId))
    .where(eq(deliveryDocuments.id, sourceDeliveryDocumentId))
    .limit(2);

  if (rows.length === 0) throw new Error("سند الصرف الأصلي غير موجود");
  if (rows.length > 1) throw new Error("بيانات سند الصرف غير متسقة");

  const row: any = rows[0];
  if (!row.inventoryId || !row.lotId || !row.inventoryTransactionId) {
    throw new Error("سند الصرف قديم أو غير مكتمل الربط بالـInventory/Lot/Movement؛ لا يمكن إنشاء مرتجع آمن منه بدون Backfill");
  }
  if (!row.movementId) throw new Error("حركة الصرف الأصلية المرتبطة بالسند غير موجودة");
  if (row.movementType !== "out" || row.movementTransactionType !== "delivery") {
    throw new Error("الحركة المرتبطة بسند الصرف ليست حركة Delivery صادرة");
  }
  if (Number(row.movementInventoryId) !== Number(row.inventoryId) || Number(row.movementLotId) !== Number(row.lotId)) {
    throw new Error("ربط سند الصرف لا يطابق Inventory/Lot في حركة الصرف الأصلية");
  }

  const deliveryQuantity = normalizeInventoryQuantity(Number(row.quantity || 0));
  const movementQuantity = normalizeInventoryQuantity(Number(row.movementQuantity || 0));
  if (!(deliveryQuantity > 0) || deliveryQuantity !== movementQuantity) {
    throw new Error("كمية سند الصرف لا تطابق كمية حركة الصرف الأصلية؛ أوقف المرتجع وراجع السجل");
  }

  const originalIssueUnitCost = Number(row.movementUnitCost);
  if (!Number.isFinite(originalIssueUnitCost) || originalIssueUnitCost < 0) {
    throw new Error("تكلفة حركة الصرف الأصلية غير متاحة؛ لا يمكن تقييم المرتجع بأمان");
  }

  const previousRows = await tx
    .select({ total: sql<string>`COALESCE(SUM(${warehouseReturns.returnedQuantity}), 0)` })
    .from(warehouseReturns)
    .where(eq(warehouseReturns.sourceDeliveryDocumentId, sourceDeliveryDocumentId));
  const previouslyReturnedQuantity = normalizeInventoryQuantity(Number(previousRows[0]?.total || 0));
  if (previouslyReturnedQuantity < 0 || previouslyReturnedQuantity > deliveryQuantity) {
    throw new Error("إجمالي المرتجعات السابقة لهذا السند غير متسق مع الكمية المصروفة");
  }

  const returnableQuantity = normalizeInventoryQuantity(deliveryQuantity - previouslyReturnedQuantity);
  const warehouseName = row.warehouseNameAr || row.warehouseNameEn || (row.warehouseId ? `#${row.warehouseId}` : "المخزن الأصلي");

  return {
    sourceDeliveryDocumentId: Number(row.deliveryId),
    deliveryNumber: String(row.deliveryNumber),
    inventoryId: Number(row.inventoryId),
    lotId: Number(row.lotId),
    inventoryTransactionId: Number(row.inventoryTransactionId),
    itemName: String(row.itemName),
    internalCode: row.internalCode ?? null,
    manufacturerBarcode: row.manufacturerBarcode ?? null,
    unit: row.unit ?? null,
    deliveredToId: row.deliveredToId == null ? null : Number(row.deliveredToId),
    deliveredToName: row.deliveredToName ?? null,
    deliveredByName: row.deliveredByName ?? null,
    ticketId: row.ticketId == null ? null : Number(row.ticketId),
    ticketNumber: row.ticketNumber ?? null,
    poNumber: row.poNumber ?? null,
    deliveredAt: row.createdAt ?? null,
    warehouseId: row.warehouseId == null ? null : Number(row.warehouseId),
    warehouseName,
    lotCode: row.lotCode ?? null,
    lotTrackingToken: row.lotTrackingToken ?? null,
    lotRemainingQuantity: normalizeInventoryQuantity(Number(row.lotRemainingQuantity || 0)),
    deliveryQuantity,
    previouslyReturnedQuantity,
    returnableQuantity,
    originalIssueUnitCost: roundTo(originalIssueUnitCost, 4),
    originalIssueTotalCost: row.movementTotalCost == null ? null : roundTo(Number(row.movementTotalCost || 0), 2),
    currentInventoryQuantity: normalizeInventoryQuantity(Number(row.inventoryQuantity || 0)),
    currentInventoryAverageCost: roundTo(Number(row.inventoryAverageCost || 0), 4),
    currentInventoryTotalCostValue: roundTo(Number(row.inventoryTotalCostValue || 0), 2),
    movementTicketId: row.movementTicketId == null ? null : Number(row.movementTicketId),
    movementPurchaseOrderItemId: row.movementPurchaseOrderItemId == null ? null : Number(row.movementPurchaseOrderItemId),
  };
}

export async function resolveRecipientReturnSource(deliveryNumber: string) {
  const db = await getDb();
  if (!db) throw new Error("تعذر الاتصال بقاعدة البيانات");
  const normalizedNumber = String(deliveryNumber || "").trim();
  if (!normalizedNumber) throw new Error("رقم سند الصرف الأصلي مطلوب");

  const ids = await db
    .select({ id: deliveryDocuments.id })
    .from(deliveryDocuments)
    .where(eq(deliveryDocuments.deliveryNumber, normalizedNumber))
    .limit(2);
  if (ids.length === 0) throw new Error("لم يتم العثور على سند الصرف بهذا الرقم");
  if (ids.length > 1) throw new Error("رقم سند الصرف مكرر؛ أوقف العملية وراجع حوكمة أرقام المستندات");

  const source = await readRecipientReturnSourceById(Number(ids[0].id), db);
  if (!(source.returnableQuantity > 0)) {
    throw new Error("تم إرجاع كامل الكمية المصروفة في هذا السند مسبقًا");
  }
  return source;
}

export async function createRecipientWarehouseReturn(params: {
  sourceDeliveryDocumentId: number;
  returnedQuantity: number;
  reason: string;
  returnedById: number;
}, existingTx?: any) {
  const database = existingTx || await getDb();
  if (!database) throw new Error("تعذر الاتصال بقاعدة البيانات");

  const returnedQuantity = normalizeInventoryQuantity(params.returnedQuantity);
  if (!(returnedQuantity > 0)) throw new Error("كمية المرتجع يجب أن تكون أكبر من صفر");
  // Live DB: warehouse_returns.returnedQuantity + return_documents.returnedQuantity are INT.
  // Keep 5.2 future-safe without silently widening historical document quantity semantics.
  if (!Number.isInteger(returnedQuantity)) {
    throw new Error("مرتجع الجهة الحالي يدعم الكميات الصحيحة فقط");
  }
  if (!String(params.reason || "").trim()) throw new Error("سبب الإرجاع مطلوب");

  const executeReturn = async (tx: any) => {
    // Serialize every return against the same original delivery so two concurrent
    // partial returns cannot both pass the over-return check.
    await tx.execute(sql`SELECT id FROM delivery_documents WHERE id = ${params.sourceDeliveryDocumentId} FOR UPDATE`);
    const source = await readRecipientReturnSourceById(params.sourceDeliveryDocumentId, tx);
    if (!(source.returnableQuantity > 0)) {
      throw new Error("تم إرجاع كامل الكمية المصروفة في هذا السند مسبقًا");
    }
    if (returnedQuantity > source.returnableQuantity) {
      throw new Error(`الكمية المُرجَعة (${returnedQuantity}) أكبر من المتبقي القابل للإرجاع من سند الصرف (${source.returnableQuantity})`);
    }

    // Approved policy requires the exact original Lot and Inventory row. We do
    // not invent a new return Lot and we do not backfill old delivery documents.
    await tx.execute(sql`SELECT id FROM inventory_lot_balances WHERE lotId = ${source.lotId} AND inventoryId = ${source.inventoryId} FOR UPDATE`);
    await tx.execute(sql`SELECT id FROM inventory_lots WHERE id = ${source.lotId} FOR UPDATE`);
    await tx.execute(sql`SELECT id FROM inventory WHERE id = ${source.inventoryId} FOR UPDATE`);

    const balanceRows = await tx
      .select({ id: inventoryLotBalances.id, quantity: inventoryLotBalances.quantity })
      .from(inventoryLotBalances)
      .where(and(
        eq(inventoryLotBalances.lotId, source.lotId),
        eq(inventoryLotBalances.inventoryId, source.inventoryId),
      ));
    if (balanceRows.length !== 1) {
      throw new Error("رصيد الـLot الأصلي في المخزن غير موجود أو غير متسق؛ لا يمكن إنشاء رصيد جديد بصمت");
    }

    const lotRows = await tx
      .select({ id: inventoryLots.id, remainingQuantity: inventoryLots.remainingQuantity })
      .from(inventoryLots)
      .where(eq(inventoryLots.id, source.lotId))
      .limit(1);
    if (lotRows.length !== 1) throw new Error("الـLot الأصلي لم يعد موجودًا");

    const inventoryRows = await tx
      .select({
        id: inventory.id,
        quantity: inventory.quantity,
        averageCost: inventory.averageCost,
        totalCostValue: inventory.totalCostValue,
        itemName: inventory.itemName,
        internalCode: inventory.internalCode,
        manufacturerBarcode: inventory.manufacturerBarcode,
        unit: inventory.unit,
      })
      .from(inventory)
      .where(eq(inventory.id, source.inventoryId))
      .limit(1);
    const currentInventory: any = inventoryRows[0];
    if (!currentInventory) throw new Error("سجل المخزون الأصلي لم يعد موجودًا");

    const currentBalance = normalizeInventoryQuantity(Number(balanceRows[0].quantity || 0));
    const currentLotRemaining = normalizeInventoryQuantity(Number(lotRows[0].remainingQuantity || 0));
    const currentQuantity = normalizeInventoryQuantity(Number(currentInventory.quantity || 0));
    const currentValue = roundTo(Number(currentInventory.totalCostValue || 0), 2);
    const originalIssueUnitCost = roundTo(Number(source.originalIssueUnitCost || 0), 4);
    const returnValue = calculateMovementTotal(returnedQuantity, originalIssueUnitCost);

    const newBalance = normalizeInventoryQuantity(currentBalance + returnedQuantity);
    const newLotRemaining = normalizeInventoryQuantity(currentLotRemaining + returnedQuantity);
    const newQuantity = normalizeInventoryQuantity(currentQuantity + returnedQuantity);
    const newValue = roundTo(currentValue + returnValue, 2);
    const newAverageCost = newQuantity > 0 ? roundTo(newValue / newQuantity, 4) : 0;

    await tx.update(inventoryLotBalances)
      .set({ quantity: newBalance.toFixed(3) } as any)
      .where(eq(inventoryLotBalances.id, Number(balanceRows[0].id)));

    await tx.update(inventoryLots)
      .set({ remainingQuantity: newLotRemaining.toFixed(3) } as any)
      .where(eq(inventoryLots.id, source.lotId));

    await tx.update(inventory)
      .set({
        quantity: newQuantity.toFixed(3),
        totalCostValue: newValue.toFixed(2),
        averageCost: newAverageCost.toFixed(4),
        updatedAt: new Date(),
      } as any)
      .where(eq(inventory.id, source.inventoryId));

    const returnNumber = await getNextReturnNumber(tx);
    const [returnInsert] = await tx.insert(warehouseReturns).values({
      returnNumber,
      receiptId: null,
      purchaseOrderId: null,
      purchaseOrderItemId: null,
      inventoryId: source.inventoryId,
      lotId: source.lotId,
      sourceDeliveryDocumentId: source.sourceDeliveryDocumentId,
      returnedQuantity,
      reason: String(params.reason).trim(),
      returnedById: params.returnedById,
    } as any);
    const returnId = Number((returnInsert as any)?.insertId || 0);
    if (!returnId) throw new Error("تعذر إنشاء سجل مرتجع الجهة");

    await tx.insert(inventoryTransactions).values({
      inventoryId: source.inventoryId,
      lotId: source.lotId,
      type: "in",
      quantity: returnedQuantity,
      unitCost: originalIssueUnitCost.toFixed(4),
      totalCost: returnValue.toFixed(2),
      reason: `إرجاع من الجهة إلى المخزن - ${String(params.reason).trim()} - عكس سند ${source.deliveryNumber} - مرتجع ${returnNumber}`,
      ticketId: source.movementTicketId ?? undefined,
      purchaseOrderItemId: source.movementPurchaseOrderItemId ?? undefined,
      performedById: params.returnedById,
      transactionType: "return",
      returnId,
      documentUrl: returnNumber,
    } as any);

    const performerRows = await tx
      .select({ name: users.name, username: users.username })
      .from(users)
      .where(eq(users.id, params.returnedById))
      .limit(1);
    const performer: any = performerRows[0];

    await createReturnDocument({
      returnNumber,
      returnId,
      itemName: currentInventory.itemName || source.itemName,
      internalCode: currentInventory.internalCode || undefined,
      manufacturerBarcode: currentInventory.manufacturerBarcode || undefined,
      returnedQuantity,
      unit: currentInventory.unit || source.unit || undefined,
      reason: String(params.reason).trim(),
      returnedByName: performer?.name || performer?.username || "مستخدم المستودع",
      // For recipient returns this is the original recipient who is returning the item.
      recipientName: source.deliveredToName || undefined,
      poNumber: source.poNumber || undefined,
    }, tx);

    return {
      returnId,
      returnNumber,
      returnType: "recipient_to_warehouse" as const,
      sourceDeliveryDocumentId: source.sourceDeliveryDocumentId,
      sourceDeliveryNumber: source.deliveryNumber,
      inventoryId: source.inventoryId,
      lotId: source.lotId,
      lotCode: source.lotCode,
      itemName: currentInventory.itemName || source.itemName,
      unit: currentInventory.unit || source.unit || null,
      returnedQuantity,
      previouslyReturnedQuantity: source.previouslyReturnedQuantity,
      remainingReturnableQuantity: normalizeInventoryQuantity(source.returnableQuantity - returnedQuantity),
      originalIssueUnitCost,
      returnValue,
      inventoryQuantityBefore: currentQuantity,
      inventoryQuantityAfter: newQuantity,
      inventoryValueBefore: currentValue,
      inventoryValueAfter: newValue,
      inventoryAverageCostAfter: newAverageCost,
      lotBalanceBefore: currentBalance,
      lotBalanceAfter: newBalance,
      lotRemainingBefore: currentLotRemaining,
      lotRemainingAfter: newLotRemaining,
      deliveredToName: source.deliveredToName,
      warehouseId: source.warehouseId,
      warehouseName: source.warehouseName,
    };
  };
  return existingTx ? executeReturn(existingTx) : database.transaction(executeReturn);
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

  const rows = await db
    .select({
      transactionId:      inventoryTransactions.id,
      quantity:           inventoryTransactions.quantity,
      transactionUnitCost: inventoryTransactions.unitCost,
      purchaseOrderItemId: inventoryTransactions.purchaseOrderItemId,
      createdAt:          inventoryTransactions.createdAt,
      receiptId:          inventoryTransactions.receiptId,
      receiptNumber:      warehouseReceipts.receiptNumber,
      invoiceNumber:      warehouseReceipts.invoiceNumber,
      invoiceDate:        warehouseReceipts.invoiceDate,
      vendorName:         warehouseReceipts.vendorName,
      purchaseOrderId:    sql<number | null>`COALESCE(${purchaseOrderItems.purchaseOrderId}, ${warehouseReceipts.purchaseOrderId})`,
      poNumber:           purchaseOrders.poNumber,
    })
    .from(inventoryTransactions)
    .leftJoin(warehouseReceipts, eq(inventoryTransactions.receiptId, warehouseReceipts.id))
    .leftJoin(purchaseOrderItems, eq(inventoryTransactions.purchaseOrderItemId, purchaseOrderItems.id))
    .leftJoin(purchaseOrders, eq(sql`COALESCE(${purchaseOrderItems.purchaseOrderId}, ${warehouseReceipts.purchaseOrderId})`, purchaseOrders.id))
    .where(and(
      eq(inventoryTransactions.inventoryId, inventoryId),
      eq(inventoryTransactions.type, "in"),
      eq(inventoryTransactions.transactionType, "purchase"),
    ))
    .orderBy(desc(inventoryTransactions.createdAt));

  const receiptIds = Array.from(new Set(
    rows.map(row => row.receiptId).filter((id): id is number => !!id),
  ));
  const exactCost = new Map<string, string>();
  const fallbackCost = new Map<string, string>();
  if (receiptIds.length > 0) {
    const receiptItems = await db
      .select({
        receiptId:           warehouseReceiptItems.receiptId,
        inventoryId:         warehouseReceiptItems.inventoryId,
        purchaseOrderItemId: warehouseReceiptItems.purchaseOrderItemId,
        unitCost:            warehouseReceiptItems.unitCost,
      })
      .from(warehouseReceiptItems)
      .where(and(
        inArray(warehouseReceiptItems.receiptId, receiptIds),
        eq(warehouseReceiptItems.inventoryId, inventoryId),
      ));

    for (const item of receiptItems) {
      const fallbackKey = `${item.receiptId}:${inventoryId}`;
      if (!fallbackCost.has(fallbackKey)) fallbackCost.set(fallbackKey, item.unitCost);
      exactCost.set(`${item.receiptId}:${inventoryId}:${item.purchaseOrderItemId ?? 0}`, item.unitCost);
    }
  }

  return rows.map(row => {
    const exactKey = row.receiptId
      ? `${row.receiptId}:${inventoryId}:${row.purchaseOrderItemId ?? 0}`
      : "";
    const fallbackKey = row.receiptId ? `${row.receiptId}:${inventoryId}` : "";
    return {
      transactionId: row.transactionId,
      quantity: row.quantity,
      unitCost: (exactKey && exactCost.get(exactKey))
        || (fallbackKey && fallbackCost.get(fallbackKey))
        || row.transactionUnitCost,
      createdAt: row.createdAt,
      receiptId: row.receiptId,
      receiptNumber: row.receiptNumber,
      invoiceNumber: row.invoiceNumber,
      invoiceDate: row.invoiceDate,
      vendorName: row.vendorName,
      purchaseOrderId: row.purchaseOrderId,
      poNumber: row.poNumber,
    };
  });
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
    } else if (tx.transactionType === "return") {
      // 5.2: Recipient→Warehouse returns persist RTN directly on the movement.
      // Older supplier-return rows may still have no direct documentUrl.
      reference = tx.documentUrl ?? null;
    }
    // transactionType === "adjustment" (تحويل/جرد مستقبلاً): لا مرجع بعد

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
  inventoryId?: number;
  lotId?: number;
  inventoryTransactionId?: number;
  ticketId?: number;
  ticketNumber?: string;
  assignedTechnicianId?: number;
  assignedTechnicianName?: string;
  deliveredToId?: number;
  itemName: string;
  deliveredByName: string;
  deliveredBySignatureSnapshot?: string | null;
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
}, tx?: any) {
  const db = tx || await getDb();
  if (!db) return null;
  const [result] = await db.insert(deliveryDocuments).values(data as any);
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
  const rows = await db
    .select({
      document: returnDocuments,
      lotId: warehouseReturns.lotId,
      lotCode: inventoryLots.lotCode,
      lotTrackingToken: inventoryLots.trackingToken,
      sourceDeliveryDocumentId: warehouseReturns.sourceDeliveryDocumentId,
      sourceDeliveryNumber: deliveryDocuments.deliveryNumber,
      sourceDeliveredToName: deliveryDocuments.deliveredToName,
    })
    .from(returnDocuments)
    .leftJoin(warehouseReturns, eq(returnDocuments.returnId, warehouseReturns.id))
    .leftJoin(inventoryLots, eq(warehouseReturns.lotId, inventoryLots.id))
    .leftJoin(deliveryDocuments, eq(warehouseReturns.sourceDeliveryDocumentId, deliveryDocuments.id))
    .orderBy(desc(returnDocuments.createdAt));

  return rows.map((row: any) => ({
    ...row.document,
    lotId: row.lotId ?? null,
    lotCode: row.lotCode ?? null,
    lotTrackingToken: row.lotTrackingToken ?? null,
    returnType: row.sourceDeliveryDocumentId ? "recipient_to_warehouse" : "supplier_return",
    sourceDeliveryDocumentId: row.sourceDeliveryDocumentId ?? null,
    sourceDeliveryNumber: row.sourceDeliveryNumber ?? null,
    sourceDeliveredToName: row.sourceDeliveredToName ?? null,
  }));
}

export async function incrementReturnDocPrintCount(id: number) {
  const db = await getDb();
  if (!db) return 0;
  const row = await db.select({ printCount: returnDocuments.printCount }).from(returnDocuments).where(eq(returnDocuments.id, id)).limit(1);
  const newCount = (row[0]?.printCount || 0) + 1;
  await db.update(returnDocuments).set({ printCount: newCount }).where(eq(returnDocuments.id, id));
  return newCount;
}

export type IssueCostAllocationInput = {
  ticketItemId?: number;
  beneficiarySiteId: number;
  beneficiarySectionId: number;
  beneficiaryAssetId?: number | null;
  quantity: number;
};

type NormalizedIssueCostAllocation = {
  beneficiarySiteId: number;
  beneficiarySectionId: number;
  beneficiaryAssetId: number | null;
  quantity: number;
};

async function normalizeIssueCostAllocations(params: {
  tx: any;
  allocations?: IssueCostAllocationInput[];
  deliveryQuantity: number;
}): Promise<NormalizedIssueCostAllocation[]> {
  const allocations = Array.isArray(params.allocations) ? params.allocations : [];
  if (allocations.length !== 1) {
    throw new Error("كل عملية صرف يجب أن تُحمّل على جهة مستفيدة واحدة فقط");
  }

  const input = allocations[0];
  const siteId = Number(input.beneficiarySiteId);
  const sectionId = Number(input.beneficiarySectionId);
  const assetId = input.beneficiaryAssetId == null ? null : Number(input.beneficiaryAssetId);
  const quantity = normalizeInventoryQuantity(Number(input.quantity));
  const deliveryQuantity = normalizeInventoryQuantity(params.deliveryQuantity);

  if (!Number.isInteger(siteId) || siteId <= 0) {
    throw new Error("الموقع المستفيد مطلوب");
  }
  if (!Number.isInteger(sectionId) || sectionId <= 0) {
    throw new Error("القسم المستفيد مطلوب");
  }
  if (assetId != null && (!Number.isInteger(assetId) || assetId <= 0)) {
    throw new Error("الأصل المستفيد غير صالح");
  }
  if (!(quantity >= 0.001)) {
    throw new Error("كمية تحميل التكلفة يجب أن تكون 0.001 أو أكثر");
  }
  if (quantity !== deliveryQuantity) {
    throw new Error(`كمية تحميل التكلفة يجب أن تساوي كامل كمية الصرف (${deliveryQuantity})`);
  }

  const [siteRows, sectionRows, assetRows] = await Promise.all([
    params.tx.select({ id: sites.id, isActive: sites.isActive }).from(sites).where(eq(sites.id, siteId)).limit(1),
    params.tx.select({ id: sections.id, siteId: sections.siteId, isActive: sections.isActive }).from(sections).where(eq(sections.id, sectionId)).limit(1),
    assetId == null
      ? Promise.resolve([])
      : params.tx.select({ id: assets.id, siteId: assets.siteId, sectionId: assets.sectionId, status: assets.status }).from(assets).where(eq(assets.id, assetId)).limit(1),
  ]);

  const site = (siteRows as any[])[0];
  if (!site) throw new Error("الموقع المستفيد غير موجود");
  if (Number(site.isActive ?? 1) === 0) throw new Error("الموقع المستفيد غير نشط");

  const section = (sectionRows as any[])[0];
  if (!section) throw new Error("القسم المستفيد غير موجود");
  if (Number(section.isActive ?? 1) === 0) throw new Error("القسم المستفيد غير نشط");
  if (Number(section.siteId) !== siteId) throw new Error("القسم المستفيد لا يتبع الموقع المحدد");

  if (assetId != null) {
    const asset = (assetRows as any[])[0];
    if (!asset) throw new Error("الأصل المستفيد غير موجود");
    if (asset.status === "disposed") throw new Error("لا يمكن تحميل تكلفة الصرف على أصل مستبعد");
    if (Number(asset.siteId) !== siteId) throw new Error("الأصل المستفيد لا يتبع الموقع المحدد");
    if (Number(asset.sectionId) !== sectionId) throw new Error("الأصل المستفيد لا يتبع القسم المحدد");
  }

  return [{
    beneficiarySiteId: siteId,
    beneficiarySectionId: sectionId,
    beneficiaryAssetId: assetId,
    quantity,
  }];
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
  quantity:             number;
  unit?:                string;
  performedById:        number;
  deliveredToId?:       number;
  purchaseOrderItemId?: number;
  ticketId?:            number;
  ticketItemId?:        number;
  pmv2TaskItemId?:      number;
  operationalIssueItemId?: number;
  operationalOperationKey?: string;
  operationalBatchKey?: string;
  operationalReplacementAware?: boolean;
  operationalRequestFingerprint?: string;
  ticketNumber?:        string;
  assignedTechnicianId?: number;
  assignedTechnicianName?: string;
  notes?:               string;
  warehousePhotoUrl?:   string;
  markPurchaseOrderItemDelivered?: boolean;
  // 2B-8: عند تفعيل Lots تصبح هوية الدفعة (QR أو رقم اللوت) إلزامية، ولا نقبل lotId من العميل.
  // الخادم يحل trackingToken إلى lotId ويتحقق من رصيد نفس Inventory/المستودع.
  lotTrackingToken?:    string;
  // طبقة تحميل تكلفة الصرف: كل حركة صرف تُحمّل على جهة مستفيدة واحدة
  // (موقع + قسم إلزاميان، أصل اختياري). التكلفة لا تغيّر averageCost؛
  // تؤخذ Snapshot من issueUnitCost للـLot المصروف.
  costAllocations?:      IssueCostAllocationInput[];
}, existingTx?: any) {
  const db = await getDb();
  if (!db) throw new Error("تعذر الاتصال بقاعدة البيانات");

  if (params.quantity < 0.001) throw new Error("الكمية المسلّمة يجب أن تكون 0.001 أو أكثر");
  const deliveryQuantity = normalizeInventoryQuantity(params.quantity);
  const lotsEnabled = isInventoryLotsEnabled();
  const lotTrackingToken = String(params.lotTrackingToken || "").trim();
  if (lotsEnabled && !lotTrackingToken) {
    throw new Error("يجب مسح QR الدفعة أو إدخال رقم اللوت قبل تأكيد الصرف");
  }
  if (!lotsEnabled && (params.costAllocations?.length || 0) > 0) {
    throw new Error("توزيع تكلفة الصرف حسب اللوت يتطلب تفعيل تتبع الدفعات");
  }

  const performer = await getUserById(params.performedById);
  const receiver = params.deliveredToId ? await getUserById(params.deliveredToId) : null;

  let poNumber: string | undefined;
  let supplierName: string | undefined;
  let actualUnitCost: string | undefined;
  let purchaseOrderId: number | undefined;
  if (params.purchaseOrderItemId) {
    const poItem = await getPOItemById(params.purchaseOrderItemId);
    if (poItem) {
      supplierName = (poItem as any).supplierName;
      actualUnitCost = (poItem as any).actualUnitCost;
      purchaseOrderId = (poItem as any).purchaseOrderId;
      const po = await getPurchaseOrderById(purchaseOrderId);
      poNumber = (po as any)?.poNumber;
    }
  }

  const executeIssue = async (tx: any) => {
    // Phase 5.3: lock Aggregate Inventory before reading quantity/cost so the
    // delivery quantity and valuation are based on the same current state.
    await tx.execute(sql`SELECT id FROM inventory WHERE id = ${params.inventoryId} FOR UPDATE`);
    const item = await getInventoryItemById(params.inventoryId, tx);
    if (!item) throw new Error("الصنف غير موجود في المخزون");
    const operational = await assertOperationalIssueReference(tx, {
      ...params, selectedTicketItemId: params.costAllocations?.[0]?.ticketItemId,
      operationKey: params.operationalOperationKey, catalogItemId: (item as any).linkedItemId ?? null,
    });
    if (operational && !lotsEnabled) throw new Error("الصرف التشغيلي يتطلب تتبع الدفعات");
    const effectiveUnit = operational ? String((item as any).issueUnit || item.unit || "") : params.unit || item.unit || "";
    if (materialExecutionCostsEnabled() && params.unit) {
      const stockUnit = String((item as any).issueUnit || item.unit || "").trim();
      if (params.unit.trim() !== stockUnit) {
        const actual = (await getActiveCatalogUnitCanonicalName(params.unit, tx)) || params.unit.trim();
        const expected = (await getActiveCatalogUnitCanonicalName(stockUnit, tx)) || stockUnit;
        if (actual !== expected) throw new Error(`وحدة الصرف يجب أن تطابق وحدة المخزون «${stockUnit}». التحويل يتم عند الاستلام فقط.`);
      }
    }
    if (deliveryQuantity <= 0) throw new Error("الكمية المسلّمة يجب أن تكون أكبر من صفر");
    if (deliveryQuantity > Number(item.quantity || 0)) {
      throw new Error(`الكمية المطلوبة (${deliveryQuantity}) أكبر من الرصيد المتاح (${item.quantity})`);
    }

    // 2B-8: QR هو الحقيقة الفيزيائية للصرف. لا نثق بأي lotId مرسل من الواجهة؛
    // نحل Token داخل نفس transaction ونخصم من Lot Balance + Lot Remaining
    // قبل خصم Aggregate Inventory. أي فشل لاحق يعيد الثلاثة معاً بالـrollback.
    const consumedLot = lotsEnabled
      ? await consumeInventoryLotForIssue({
          tx,
          trackingToken: lotTrackingToken,
          inventoryId: params.inventoryId,
          inventoryCatalogItemId: (item as any).linkedItemId ?? null,
          quantity: deliveryQuantity,
        })
      : null;

    const normalizedCostAllocations = lotsEnabled
      ? await normalizeIssueCostAllocations({
          tx,
          allocations: params.costAllocations,
          deliveryQuantity,
        })
      : [];
    if (operational && (normalizedCostAllocations.length !== 1 || normalizedCostAllocations[0].beneficiarySiteId !== operational.siteId || normalizedCostAllocations[0].beneficiarySectionId !== operational.sectionId || normalizedCostAllocations[0].beneficiaryAssetId != null)) {
      throw new Error("جهة تحميل التكلفة يجب أن تطابق أمر الصرف التشغيلي");
    }

    const lotIssueUnitCostSnapshot = lotsEnabled
      ? Number(consumedLot?.issueUnitCost ?? 0)
      : 0;

    const costContext = materialExecutionCostsEnabled()
      ? operational ? { executionSource: "operational" as const, executionId: operational.orderId, executionItemId: operational.itemId, executionNumber: operational.orderNumber, ticketId: undefined }
      : await resolveExecutionCostContext(tx, {
          ticketId: params.ticketId, ticketItemId: params.ticketItemId, pmv2TaskItemId: params.pmv2TaskItemId,
          selectedTicketItemId: params.costAllocations?.[0]?.ticketItemId,
          beneficiarySiteId: normalizedCostAllocations[0]?.beneficiarySiteId,
          beneficiarySectionId: normalizedCostAllocations[0]?.beneficiarySectionId ?? null,
          beneficiaryAssetId: normalizedCostAllocations[0]?.beneficiaryAssetId ?? null,
        }) : null;
    if (materialExecutionCostsEnabled() && !lotsEnabled) throw new Error("تحميل تكلفة التنفيذ يتطلب تفعيل نظام اللوتات");
    if (!materialExecutionCostsEnabled() && params.costAllocations?.[0]?.ticketItemId) throw new Error("ربط تكلفة التنفيذ غير مفعّل بعد");
    const effectiveTicketId = costContext?.ticketId ?? params.ticketId;

    const deliveryNumber = await getNextDeliveryNumber(tx);

    if (params.markPurchaseOrderItemDelivered && params.purchaseOrderItemId && purchaseOrderId) {
      // تحديث شرطي يمنع طلبين متزامنين من احتساب نفس احتياج البلاغ مرتين.
      // إذا سبق طلب آخر وغيّر الحالة إلى delivered_to_requester يفشل هذا الطلب
      // وتُرجع المعاملة كاملةً قبل خصم أي كمية إضافية من المخزون.
      const updateResult: any = await tx
        .update(purchaseOrderItems)
        .set({
          status: "delivered_to_requester",
          deliveryNumber,
          deliveredAt: new Date(),
          deliveredById: params.performedById,
          deliveredToId: params.deliveredToId || null,
        })
        .where(and(
          eq(purchaseOrderItems.id, params.purchaseOrderItemId),
          notInArray(purchaseOrderItems.status, ["delivered_to_requester", "rejected", "cancelled"] as any),
        ));
      if (Number(updateResult?.[0]?.affectedRows ?? 0) !== 1) {
        throw new Error("تم استكمال تسليم احتياج هذا الصنف للبلاغ مسبقًا");
      }
    }

    // خصم شرطي على مستوى قاعدة البيانات يمنع صرف رصيد أكبر من المتاح حتى
    // عند وصول عمليتي تسليم متزامنتين إلى نفس صنف المخزون.
    const stockUpdateResult: any = await tx
      .update(inventory)
      .set({
        quantity: sql`${inventory.quantity} - ${deliveryQuantity}`,
        totalCostValue: sql`ROUND((${inventory.quantity} - ${deliveryQuantity}) * ${inventory.averageCost}, 2)`,
      } as any)
      .where(and(
        eq(inventory.id, params.inventoryId),
        gte(inventory.quantity, deliveryQuantity),
      ));
    if (Number(stockUpdateResult?.[0]?.affectedRows ?? 0) !== 1) {
      throw new Error("الرصيد المتاح تغيّر أثناء عملية التسليم؛ حدّث الصفحة وحاول مرة أخرى");
    }

    const deliveryUnitCost = parseFloat((item as any).averageCost || "0");
    const [transactionResult] = await tx.insert(inventoryTransactions).values({
      inventoryId: params.inventoryId,
      lotId: consumedLot?.lotId ?? null,
      type: "out",
      quantity: deliveryQuantity,
      unitCost: deliveryUnitCost.toFixed(4),
      totalCost: calculateMovementTotal(deliveryQuantity, deliveryUnitCost).toFixed(2),
      reason: params.notes || "تسليم من المخزون",
      ticketId: effectiveTicketId,
      purchaseOrderItemId: params.purchaseOrderItemId,
      performedById: params.performedById,
      transactionType: "delivery",
      documentUrl: deliveryNumber,
    } as any);
    const inventoryTransactionId = Number((transactionResult as any)?.insertId || 0);
    if (!inventoryTransactionId) {
      throw new Error("تعذر تسجيل حركة الصرف في سجل المخزون");
    }

    if (normalizedCostAllocations.length > 0) {
      const targetAllocatedCost = calculateMovementTotal(deliveryQuantity, lotIssueUnitCostSnapshot);
      const rowCosts = normalizedCostAllocations.map(allocation =>
        calculateMovementTotal(allocation.quantity, lotIssueUnitCostSnapshot),
      );
      const rowCostSum = roundTo(rowCosts.reduce((sum, value) => sum + value, 0), 2);
      const roundingRemainder = roundTo(targetAllocatedCost - rowCostSum, 2);
      if (roundingRemainder !== 0) {
        rowCosts[rowCosts.length - 1] = roundTo(rowCosts[rowCosts.length - 1] + roundingRemainder, 2);
      }

      await tx.insert(inventoryIssueCostAllocations).values(
        normalizedCostAllocations.map((allocation, index) => ({
          inventoryTransactionId,
          inventoryId: params.inventoryId,
          lotId: consumedLot!.lotId,
          deliveryNumber,
          beneficiarySiteId: allocation.beneficiarySiteId,
          beneficiarySectionId: allocation.beneficiarySectionId,
          beneficiaryAssetId: allocation.beneficiaryAssetId,
          quantity: allocation.quantity.toFixed(3),
          lotIssueUnitCostSnapshot: lotIssueUnitCostSnapshot.toFixed(4),
          allocatedCostTotal: rowCosts[index].toFixed(2),
          createdById: params.performedById,
        } as any)),
      );
    }

    if (costContext) {
      await tx.insert(materialExecutionCostContexts).values({
        inventoryTransactionId, executionSource: costContext.executionSource, executionId: costContext.executionId,
        executionItemId: costContext.executionItemId, executionNumber: costContext.executionNumber,
      });
    }

    if (params.markPurchaseOrderItemDelivered && params.purchaseOrderItemId && purchaseOrderId) {
      const allItems = await getPOItems(purchaseOrderId, tx);
      const activeItems = allItems.filter((poItem: any) =>
        !["rejected", "cancelled"].includes(poItem.status)
      );
      if (activeItems.length > 0 && activeItems.every((poItem: any) => poItem.status === "delivered_to_requester")) {
        await updatePurchaseOrder(purchaseOrderId, { status: "received" }, tx);
      }
    }

    const deliveryDocumentInsert = await createDeliveryDocument({
      deliveryNumber,
      poItemId: params.purchaseOrderItemId ?? 0,
      inventoryId: params.inventoryId,
      lotId: consumedLot?.lotId,
      inventoryTransactionId,
      ticketId: effectiveTicketId,
      ticketNumber: costContext?.ticketId ? costContext.executionNumber ?? undefined : params.ticketNumber,
      assignedTechnicianId: params.assignedTechnicianId,
      assignedTechnicianName: params.assignedTechnicianName,
      deliveredToId: params.deliveredToId,
      itemName: consumedLot?.supplierItemName || item.itemName,
      deliveredByName: (performer as any)?.name || "مستخدم المستودع",
      deliveredBySignatureSnapshot: captureDocumentSignature({ id: params.performedById, name: performer?.name, signatureUrl: performer?.signatureUrl }),
      deliveredToName: (receiver as any)?.name || "غير محدد",
      quantity: deliveryQuantity,
      unit: effectiveUnit || undefined,
      supplierName,
      actualUnitCost,
      poNumber,
      warehousePhotoUrl: params.warehousePhotoUrl,
      notes: params.notes,
    }, tx);
    const deliveryDocumentId = Number((deliveryDocumentInsert as any)?.insertId || 0) || null;
    if (operational) {
      if (!deliveryDocumentId || !params.operationalOperationKey || !params.operationalRequestFingerprint) throw new Error("تعذر توثيق سند الصرف التشغيلي");
      await recordOperationalDelivery(tx, operational, {
        deliveryDocumentId, inventoryTransactionId, quantity: deliveryQuantity,
        lotUnitCost: lotIssueUnitCostSnapshot, cost: calculateMovementTotal(deliveryQuantity, lotIssueUnitCostSnapshot),
        operationKey: params.operationalOperationKey, requestFingerprint: params.operationalRequestFingerprint, actorId: params.performedById,
      });
    }

    return {
      deliveryNumber,
      deliveryDocumentId,
      executionSource: costContext?.executionSource ?? null,
      executionId: costContext?.executionId ?? null,
      executionNumber: costContext?.executionNumber ?? null,
      itemName: consumedLot?.supplierItemName || item.itemName,
      quantity: deliveryQuantity,
      unit: effectiveUnit,
      inventoryTransactionId,
      lotId: consumedLot?.lotId ?? null,
      lotCode: consumedLot?.lotCode ?? null,
      lotTrackingToken: consumedLot?.trackingToken ?? null,
      lotRemainingInWarehouse: consumedLot?.balanceQuantity ?? null,
      lotRemainingTotal: consumedLot?.remainingQuantity ?? null,
      lotIssueUnitCostSnapshot: lotsEnabled ? lotIssueUnitCostSnapshot : null,
      allocatedCostTotal: normalizedCostAllocations.length > 0
        ? calculateMovementTotal(deliveryQuantity, lotIssueUnitCostSnapshot)
        : null,
      costAllocationCount: normalizedCostAllocations.length,
    };
  };

  // المسار التاريخي يبقى كما هو: كل استدعاء منفرد ينشئ Transaction خاصة به.
  // شاشة الصرف المخزني الجديدة فقط تمرر Transaction خارجية حتى تصبح جميع
  // بنود سند WIS ذرية كوحدة واحدة، دون تغيير سلوك أي مستدعٍ حالي.
  const result = existingTx
    ? await executeIssue(existingTx)
    : await db.transaction(executeIssue);

  return {
    ...result,
    deliveredByName: (performer as any)?.name || "مستخدم المستودع",
    deliveredToName: (receiver as any)?.name || "غير محدد",
    assignedTechnicianName: params.assignedTechnicianName,
    ticketNumber: result.executionSource?.startsWith("ticket_") ? result.executionNumber ?? params.ticketNumber : params.ticketNumber,
    supplierName,
    actualUnitCost,
    poNumber,
    deliveredAt: new Date().toLocaleDateString("ar-SA", { year: "numeric", month: "long", day: "numeric" }),
  };
}


export async function getIssueCostAllocations(filters?: {
  siteId?: number;
  sectionId?: number;
  assetId?: number;
  dateFrom?: Date;
  dateTo?: Date;
  limit?: number;
}) {
  const db = await getDb();
  if (!db) return [];

  const conditions: any[] = [];
  if (filters?.siteId) conditions.push(eq(inventoryIssueCostAllocations.beneficiarySiteId, filters.siteId));
  if (filters?.sectionId) conditions.push(eq(inventoryIssueCostAllocations.beneficiarySectionId, filters.sectionId));
  if (filters?.assetId) conditions.push(eq(inventoryIssueCostAllocations.beneficiaryAssetId, filters.assetId));
  if (filters?.dateFrom) conditions.push(gte(inventoryIssueCostAllocations.createdAt, filters.dateFrom));
  if (filters?.dateTo) conditions.push(lte(inventoryIssueCostAllocations.createdAt, filters.dateTo));

  const base = db.select({
    id: inventoryIssueCostAllocations.id,
    inventoryTransactionId: inventoryIssueCostAllocations.inventoryTransactionId,
    inventoryId: inventoryIssueCostAllocations.inventoryId,
    lotId: inventoryIssueCostAllocations.lotId,
    deliveryNumber: inventoryIssueCostAllocations.deliveryNumber,
    beneficiarySiteId: inventoryIssueCostAllocations.beneficiarySiteId,
    beneficiarySiteName: sites.name,
    beneficiarySectionId: inventoryIssueCostAllocations.beneficiarySectionId,
    beneficiarySectionName: sections.name,
    beneficiaryAssetId: inventoryIssueCostAllocations.beneficiaryAssetId,
    beneficiaryAssetName: assets.name,
    beneficiaryAssetNumber: assets.assetNumber,
    quantity: inventoryIssueCostAllocations.quantity,
    lotIssueUnitCostSnapshot: inventoryIssueCostAllocations.lotIssueUnitCostSnapshot,
    allocatedCostTotal: inventoryIssueCostAllocations.allocatedCostTotal,
    createdById: inventoryIssueCostAllocations.createdById,
    createdAt: inventoryIssueCostAllocations.createdAt,
  })
    .from(inventoryIssueCostAllocations)
    .leftJoin(sites, eq(sites.id, inventoryIssueCostAllocations.beneficiarySiteId))
    .leftJoin(sections, eq(sections.id, inventoryIssueCostAllocations.beneficiarySectionId))
    .leftJoin(assets, eq(assets.id, inventoryIssueCostAllocations.beneficiaryAssetId));

  const query = conditions.length > 0 ? base.where(and(...conditions)) : base;
  return query.orderBy(desc(inventoryIssueCostAllocations.createdAt), desc(inventoryIssueCostAllocations.id))
    .limit(Math.min(Math.max(filters?.limit ?? 500, 1), 2000));
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

export async function getDeliveryDocumentById(id: number) {
  const db = await getDb();
  if (!db) throw new Error("تعذر الاتصال بقاعدة البيانات");
  const [row] = await db.select().from(deliveryDocuments).where(eq(deliveryDocuments.id, id)).limit(1);
  return row ?? null;
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
  itemNameAr?:       string;
  itemNameEn?:       string;
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
  const normalizedData = {
    ...data,
    quantity: normalizeInventoryQuantity(data.quantity),
    ...(data.minQuantity != null ? { minQuantity: normalizeInventoryQuantity(data.minQuantity) } : {}),
  };
  const result = await db.insert(inventory).values(normalizedData as any);
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
  // 2B-8: الدفعة التي أثرت عليها الحركة، عندما يكون مسار الـLot مفعلاً.
  lotId?:               number;
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

  // نقرأ متوسط تكلفة الصنف أولاً حتى تُسجل كل حركة بقيمتها المحاسبية
  // حتى لو لم يرسل المستدعي unitCost/totalCost صراحة.
  const item = await db.select().from(inventory).where(eq(inventory.id, data.inventoryId)).limit(1);
  if (!item[0]) return;

  const currentQty = normalizeInventoryQuantity(Number(item[0].quantity || 0));
  const movementQuantity = normalizeInventoryQuantity(data.quantity);
  const averageCost = parseFloat((item[0] as any).averageCost || "0");
  const movementUnitCost = data.unitCost != null
    ? parseFloat(String(data.unitCost))
    : averageCost;
  const movementTotalCost = data.totalCost != null
    ? parseFloat(String(data.totalCost))
    : calculateMovementTotal(movementQuantity, movementUnitCost);

  const [transactionResult] = await db.insert(inventoryTransactions).values({
    ...data,
    quantity: movementQuantity,
    unitCost: movementUnitCost.toFixed(4),
    totalCost: movementTotalCost.toFixed(2),
  } as any);
  const transactionId = Number((transactionResult as any)?.insertId || 0) || undefined;

  const newQty = data.type === "in"
    ? currentQty + movementQuantity
    : Math.max(0, currentQty - movementQuantity);

  await db.update(inventory).set({
    quantity:       normalizeInventoryQuantity(newQty),
    totalCostValue: calculateInventoryValue(newQty, averageCost).toFixed(2),
  } as any).where(eq(inventory.id, data.inventoryId));

  return transactionId;
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
  catalogSupplierId?: number;
  supplierCandidateId?: number;
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
  // 2B-7: Catalog identity snapshot for the receipt/invoice line.
  catalogItemId?:        number;
  itemName:             string;
  itemNameAr?:           string;
  itemNameEn?:           string;
  // 2B-4: علم Master Data فقط؛ إنشاء Candidate يتم في 2B-5.
  isNewCatalogItem?:     boolean;
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
    query = query.where(or(
      eq(warehouseReceipts.purchaseOrderId, input.purchaseOrderId),
      sql`EXISTS (SELECT 1 FROM ${warehouseReceiptItems}
        INNER JOIN ${purchaseOrderItems} ON ${purchaseOrderItems.id} = ${warehouseReceiptItems.purchaseOrderItemId}
        WHERE ${warehouseReceiptItems.receiptId} = ${warehouseReceipts.id}
          AND ${purchaseOrderItems.purchaseOrderId} = ${input.purchaseOrderId})`,
    )) as any;
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


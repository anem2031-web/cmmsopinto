// ============================================================
// db/warehouse-receipts.ts — استلامات المستودع
// (مُقسَّم من db.ts الأصلي حسب المجال الوظيفي)
// ============================================================
import { eq, desc, asc, and, sql, count, sum, inArray, notInArray, like, or, gte, lte, lt, isNull, isNotNull, ne } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { alias } from "drizzle-orm/mysql-core";
import mysql from "mysql2/promise";
import {
  InsertUser, users, tickets, purchaseOrders, purchaseOrderItems,
  inventory, inventoryTransactions, inventoryLots, notifications, auditLogs,
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
import { getInventoryItemById, getUserById } from "./deletes";
import { calculateMovementTotal, normalizeInventoryQuantity } from "../inventory-costing";
import { consumeInventoryLotForIssue, isInventoryLotsEnabled, resolveInventoryLotForDisposal } from "../inventory-lots";
import { assertNoSpecificationAggregateBypass } from "../../services/purchase-specification-guards";

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

export async function getNextDeliveryNumber(tx?: any): Promise<string> {
  const db = tx || await getDb();
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

// 1) توليد رقم عملية الاستبعاد التسلسلي عبر نفس writer الخاص بالعملية.
// AUTO_INCREMENT قد يترك gap عند rollback، لكنه لا يعيد استخدام رقم محجوز.
async function generateDisposalNumberWith(writer: any): Promise<string> {
  const year = new Date().getFullYear();
  const [result] = await writer.insert(disposalNumberCounter).values({ year });
  const seq = Number((result as any).insertId);
  if (!seq) throw new Error("تعذر توليد رقم عملية الاستبعاد");
  return `DO-${year}-${String(seq).padStart(6, "0")}`;
}

export async function generateDisposalNumber(): Promise<string> {
  const db = await getDb();
  const year = new Date().getFullYear();
  if (!db) return `DO-${year}-000001`;
  return generateDisposalNumberWith(db);
}

// 2) تنفيذ حركات المخزون الفعلية لعملية استبعاد موجودة بالقاعدة.
// هذه الدالة الداخلية تتلقى writer موجودًا حتى يمكن ضم رأس العملية والبنود
// وخصم الرصيد والقيمة وحركة المخزون كلها داخل Transaction واحدة.
async function issueDisposalWith(writer: any, disposalOperationId: number): Promise<void> {
  const items = await writer
    .select()
    .from(disposalItems)
    .where(eq(disposalItems.operationId, disposalOperationId));

  if (items.length === 0) throw new Error("لا توجد أصناف مرتبطة بهذه العملية");

  const op = await writer
    .select()
    .from(disposalOperations)
    .where(eq(disposalOperations.id, disposalOperationId))
    .limit(1);

  if (!op[0]) throw new Error("عملية الاستبعاد غير موجودة");

  for (const item of items) {
    const qty = normalizeInventoryQuantity(parseFloat(item.quantity));
    if (!(qty > 0)) throw new Error("كمية الاستبعاد يجب أن تكون أكبر من صفر");

    // نقفل Aggregate Inventory قبل إعادة قراءة الرصيد/التكلفة حتى لا تعتمد
    // العملية على قراءة قديمة عند وجود حركة متزامنة على نفس الصنف.
    await writer.execute(sql`SELECT id FROM inventory WHERE id = ${item.inventoryId} FOR UPDATE`);
    const invRows = await writer
      .select()
      .from(inventory)
      .where(eq(inventory.id, item.inventoryId))
      .limit(1);

    const inv: any = invRows[0];
    if (!inv) throw new Error(`الصنف رقم ${item.inventoryId} غير موجود في المخزون`);
    await assertNoSpecificationAggregateBypass(writer, item.inventoryId);
    if (qty > Number(inv.quantity || 0)) {
      throw new Error(`الكمية المطلوب استبعادها (${qty}) أكبر من الرصيد المتاح (${inv.quantity}) للصنف "${inv.itemName}"`);
    }

    const averageCost = parseFloat(inv.averageCost || "0");
    const movementTotalCost = calculateMovementTotal(qty, averageCost);

    // مصدر التكلفة المحاسبية هو متوسط تكلفة المخزون الحالي على الخادم، وليس
    // unitCost/totalCost المرسلة من الواجهة. يتم تثبيت القيمة الفعلية على السطر.
    await writer.update(disposalItems).set({
      unitCost: averageCost.toFixed(4),
      totalCost: movementTotalCost.toFixed(2),
    } as any).where(eq(disposalItems.id, item.id));

    // خصم شرطي يمنع الرصيد السالب حتى لو تغيّر الرصيد قبل الحصول على القفل.
    const stockUpdateResult: any = await writer
      .update(inventory)
      .set({
        quantity: sql`${inventory.quantity} - ${qty}`,
        totalCostValue: sql`ROUND((${inventory.quantity} - ${qty}) * ${inventory.averageCost}, 2)`,
        updatedAt: new Date(),
      } as any)
      .where(and(
        eq(inventory.id, item.inventoryId),
        gte(inventory.quantity, qty),
      ));
    if (Number(stockUpdateResult?.[0]?.affectedRows ?? 0) !== 1) {
      throw new Error("الرصيد المتاح تغيّر أثناء عملية الاستبعاد؛ أعد المحاولة");
    }

    await writer.insert(inventoryTransactions).values({
      inventoryId:     item.inventoryId,
      type:            "out",
      quantity:        qty,
      reason:          item.notes || `استبعاد — ${item.reason}`,
      performedById:   op[0].createdBy,
      transactionType: "disposal",
      documentUrl:     op[0].operationNumber,
      unitCost:        averageCost.toFixed(4),
      totalCost:       movementTotalCost.toFixed(2),
    });
  }
}

// واجهة توافقية لأي استدعاء مباشر قديم: حتى هذا المسار يظل ذريًا بذاته.
export async function issueDisposal(disposalOperationId: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("تعذر الاتصال بقاعدة البيانات");
  await db.transaction(async (tx: any) => issueDisposalWith(tx, disposalOperationId));
}

// 3) إنشاء عملية استبعاد كاملة داخل Transaction واحدة.
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
    lotTrackingToken?: string;
    attachments?: any;
    notes?:       string;
  }>;
}) {
  const db = await getDb();
  if (!db) throw new Error("تعذر الاتصال بقاعدة البيانات");

  const lotsEnabled = isInventoryLotsEnabled();
  if (lotsEnabled) {
    if (!params.warehouseId) {
      throw new Error("يجب اختيار المستودع قبل حفظ عملية الاستبعاد");
    }
    if (params.items.some(item => !String(item.lotTrackingToken || "").trim())) {
      throw new Error("يجب مسح QR دفعة لكل بند استبعاد قبل حفظ العملية");
    }
  }

  // عند تعطيل Lots نحافظ على Workflow القديم نفسه، لكن نجعل كل آثاره ذرية:
  // number + header + items + Inventory quantity/value + transaction history.
  if (!lotsEnabled) {
    return db.transaction(async (tx: any) => {
      const operationNumber = await generateDisposalNumberWith(tx);
      const [opResult] = await tx.insert(disposalOperations).values({
        operationNumber,
        operationDate: new Date(params.operationDate),
        warehouseId:   params.warehouseId,
        status:        "COMPLETED",
        notes:         params.notes,
        createdBy:     params.createdBy,
      });

      const disposalOperationId = Number((opResult as any).insertId);
      if (!disposalOperationId) throw new Error("تعذر إنشاء عملية الاستبعاد");

      for (const item of params.items) {
        const qty = normalizeInventoryQuantity(item.quantity);
        if (!(qty > 0)) throw new Error("كمية الاستبعاد يجب أن تكون أكبر من صفر");
        await tx.insert(disposalItems).values({
          operationId:  disposalOperationId,
          inventoryId:  item.inventoryId,
          quantity:     qty.toFixed(3),
          reason:       item.reason,
          // قيم الواجهة أولية فقط؛ issueDisposalWith يعيد تثبيتها من Average Cost الحالي بالخادم.
          unitCost:     "0.0000",
          totalCost:    "0.00",
          attachments:  item.attachments ?? null,
          notes:        item.notes,
        });
      }

      await issueDisposalWith(tx, disposalOperationId);
      return { disposalOperationId, operationNumber };
    });
  }

  // عند تفعيل Lots: Lot Balance + Lot Remaining + Aggregate Inventory
  // + disposal_items + inventory_transactions + رقم العملية في Transaction واحدة.
  return db.transaction(async (tx: any) => {
    const operationNumber = await generateDisposalNumberWith(tx);
    const [opResult] = await tx.insert(disposalOperations).values({
      operationNumber,
      operationDate: new Date(params.operationDate),
      warehouseId:   params.warehouseId,
      status:        "COMPLETED",
      notes:         params.notes,
      createdBy:     params.createdBy,
    });

    const disposalOperationId = Number((opResult as any).insertId);
    if (!disposalOperationId) throw new Error("تعذر إنشاء عملية الاستبعاد");

    for (const item of params.items) {
      const qty = normalizeInventoryQuantity(item.quantity);
      if (!(qty > 0)) throw new Error("كمية الاستبعاد يجب أن تكون أكبر من صفر");
      const trackingToken = String(item.lotTrackingToken || "").trim();
      if (!trackingToken) throw new Error("يجب مسح QR الدفعة أو إدخال رقم اللوت قبل الاستبعاد");

      // Warehouse Context + QR هما مصدر الحقيقة. نعيد حل الدفعة داخل نفس
      // Transaction، ثم نرفض أي inventoryId قديم/متلاعب به من العميل.
      const resolvedLot = await resolveInventoryLotForDisposal({
        tx,
        trackingToken,
        warehouseId: params.warehouseId!,
      });
      if (Number(item.inventoryId) !== Number(resolvedLot.inventoryId)) {
        throw new Error("بيانات بند الاستبعاد تغيّرت بعد مسح QR؛ أعد مسح الدفعة في المستودع المحدد");
      }

      const initialInvRows = await tx
        .select()
        .from(inventory)
        .where(eq(inventory.id, resolvedLot.inventoryId))
        .limit(1);
      const initialInv: any = initialInvRows[0];
      if (!initialInv) throw new Error(`الصنف رقم ${resolvedLot.inventoryId} غير موجود في المخزون`);
      if (Number(initialInv.warehouseId) !== Number(params.warehouseId)) {
        throw new Error("الصنف المرتبط بالدفعة لا ينتمي للمستودع المحدد للاستبعاد");
      }

      const consumedLot = await consumeInventoryLotForIssue({
        tx,
        trackingToken,
        inventoryId: resolvedLot.inventoryId,
        inventoryCatalogItemId: initialInv.linkedItemId ?? null,
        quantity: qty,
        actionLabel: "الاستبعاد",
        specificationMovementKind: "disposal",
      });

      // بعد حجز رصيد الـLot نقفل Aggregate Inventory ونقرأ الرصيد/التكلفة
      // الحالية. أي فشل هنا يعيد استهلاك الـLot بالـrollback.
      await tx.execute(sql`SELECT id FROM inventory WHERE id = ${resolvedLot.inventoryId} FOR UPDATE`);
      const lockedInvRows = await tx
        .select()
        .from(inventory)
        .where(eq(inventory.id, resolvedLot.inventoryId))
        .limit(1);
      const inv: any = lockedInvRows[0];
      if (!inv) throw new Error(`الصنف رقم ${resolvedLot.inventoryId} لم يعد موجودًا في المخزون`);
      if (qty > Number(inv.quantity || 0)) {
        throw new Error(`الكمية المطلوب استبعادها (${qty}) أكبر من الرصيد المتاح (${inv.quantity}) للصنف "${inv.itemName}"`);
      }

      const averageCost = parseFloat(inv.averageCost || "0");
      const movementTotalCost = calculateMovementTotal(qty, averageCost);

      // خصم Aggregate Inventory شرطياً؛ أي فشل يعيد Lot updates تلقائيًا بالRollback.
      const stockUpdateResult: any = await tx
        .update(inventory)
        .set({
          quantity: sql`${inventory.quantity} - ${qty}`,
          totalCostValue: sql`ROUND((${inventory.quantity} - ${qty}) * ${inventory.averageCost}, 2)`,
          updatedAt: new Date(),
        } as any)
        .where(and(
          eq(inventory.id, resolvedLot.inventoryId),
          gte(inventory.quantity, qty),
        ));
      if (Number(stockUpdateResult?.[0]?.affectedRows ?? 0) !== 1) {
        throw new Error("الرصيد المتاح تغيّر أثناء عملية الاستبعاد؛ أعد مسح QR وحاول مرة أخرى");
      }

      await tx.insert(disposalItems).values({
        operationId:  disposalOperationId,
        inventoryId:  resolvedLot.inventoryId,
        lotId:         consumedLot.lotId,
        quantity:      qty.toFixed(3),
        reason:        item.reason,
        // تكلفة المستند مصدرها Average Cost على الخادم، لا قيم العميل.
        unitCost:      averageCost.toFixed(4),
        totalCost:     movementTotalCost.toFixed(2),
        attachments:   item.attachments ?? null,
        notes:         item.notes,
      } as any);

      await tx.insert(inventoryTransactions).values({
        inventoryId:     resolvedLot.inventoryId,
        lotId:            consumedLot.lotId,
        type:             "out",
        quantity:         qty,
        reason:           item.notes || `استبعاد — ${item.reason}`,
        performedById:    params.createdBy,
        transactionType:  "disposal",
        documentUrl:      operationNumber,
        unitCost:         averageCost.toFixed(4),
        totalCost:        movementTotalCost.toFixed(2),
      } as any);
    }

    return { disposalOperationId, operationNumber };
  });
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
    const lotRows = item.lotId
      ? await db.select({ lotCode: inventoryLots.lotCode })
          .from(inventoryLots)
          .where(eq(inventoryLots.id, item.lotId))
          .limit(1)
      : [];
    return {
      ...item,
      itemName: (inv as any)?.itemName || "—",
      unit:     (inv as any)?.unit || "",
      lotCode:  lotRows[0]?.lotCode ?? null,
    };
  }));

  const creator = await getUserById(opRows[0].createdBy);

  return {
    ...opRows[0],
    creatorName: (creator as any)?.name || "—",
    items: itemsWithNames,
  };
}

export async function getNextReturnNumber(tx?: any): Promise<string> {
  const db = tx || await getDb();
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
    .where(or(
      eq(warehouseReceipts.purchaseOrderId, purchaseOrderId),
      sql`EXISTS (SELECT 1 FROM ${warehouseReceiptItems}
        INNER JOIN ${purchaseOrderItems} ON ${purchaseOrderItems.id} = ${warehouseReceiptItems.purchaseOrderItemId}
        WHERE ${warehouseReceiptItems.receiptId} = ${warehouseReceipts.id}
          AND ${purchaseOrderItems.purchaseOrderId} = ${purchaseOrderId})`,
    ))
    .orderBy(desc(warehouseReceipts.createdAt));
  return rows;
}

/**
 * جلب مبسَّط (id, purchaseOrderItemId, createdAt فقط) لكل صفوف warehouse_receipt_items
 * — يُستخدَم في تقرير دورة الشراء لمعرفة "لحظة حفظ الفاتورة" لكل صنف (مرحلتا استلام
 * المستودع/التسليم للفني)، دون تحميل كامل بيانات سطر الفاتورة (أداء أفضل).
 * عند وجود أكثر من سطر لنفس الصنف، يُختار الأقدم زمنيًا (أول سجل استلام فعلي).
 */
export async function getAllWarehouseReceiptItemsMinimal() {
  const db = await getDb();
  if (!db) return [];
  return db.select({
    purchaseOrderItemId: warehouseReceiptItems.purchaseOrderItemId,
    createdAt: warehouseReceiptItems.createdAt,
  })
    .from(warehouseReceiptItems)
    .where(isNotNull(warehouseReceiptItems.purchaseOrderItemId))
    .orderBy(asc(warehouseReceiptItems.createdAt));
}

export async function listWarehouseReceipts() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(warehouseReceipts).orderBy(desc(warehouseReceipts.createdAt));
}

// ─────────────────────────────────────────────────────────────
// «سند استلام المشتريات» — المستند الرسمي القابل للطباعة (0046)
// يجمع كل تفاصيل العملية من رفع الفاتورة وتحليل OCR حتى الحفظ:
// بيانات السند + المورد والفاتورة + المستلم + طلب الشراء المرتبط +
// بنود السند مع الكود الداخلي وباركود المصنع لكل صنف (سواء وُلّد
// آلياً أو أُدخل يدوياً — كلاهما محفوظ في inventory.manufacturerBarcode)
// ─────────────────────────────────────────────────────────────
export async function getWarehouseReceiptForPrint(id: number) {
  const db = await getDb();
  if (!db) return null;

  const receiptRows = await db
    .select({
      receipt:        warehouseReceipts,
      receivedByName: users.name,
      poNumber:       purchaseOrders.poNumber,
    })
    .from(warehouseReceipts)
    .leftJoin(users, eq(warehouseReceipts.receivedById, users.id))
    .leftJoin(purchaseOrders, eq(warehouseReceipts.purchaseOrderId, purchaseOrders.id))
    .where(eq(warehouseReceipts.id, id))
    .limit(1);

  if (!receiptRows.length) return null;
  const { receipt, receivedByName, poNumber } = receiptRows[0];

  // البنود مع بيانات الصنف الحية (الكود الداخلي وباركود المصنع)
  const itemRows = await db
    .select({
      item:                warehouseReceiptItems,
      internalCode:        inventory.internalCode,
      manufacturerBarcode: inventory.manufacturerBarcode,
      currentUnit:         inventory.unit,
    })
    .from(warehouseReceiptItems)
    .leftJoin(inventory, eq(warehouseReceiptItems.inventoryId, inventory.id))
    .where(eq(warehouseReceiptItems.receiptId, id))
    .orderBy(asc(warehouseReceiptItems.id));

  return {
    ...receipt,
    receivedByName: receivedByName ?? null,
    poNumber:       poNumber ?? null,
    items: itemRows.map(r => ({
      ...r.item,
      internalCode:        r.internalCode ?? null,
      manufacturerBarcode: r.manufacturerBarcode ?? null,
      unit:                r.item.purchaseUnit || r.currentUnit || "",
    })),
  };
}

// زيادة عدّاد طباعة سند الاستلام — بنفس نمط عدّادات وثائق التسليم والمرتجع
export async function incrementReceiptPrintCount(id: number) {
  const db = await getDb();
  if (!db) return { printCount: 0 };
  await db.update(warehouseReceipts)
    .set({ printCount: sql`${warehouseReceipts.printCount} + 1` })
    .where(eq(warehouseReceipts.id, id));
  const rows = await db.select({ printCount: warehouseReceipts.printCount })
    .from(warehouseReceipts).where(eq(warehouseReceipts.id, id)).limit(1);
  return { printCount: rows[0]?.printCount ?? 0 };
}

// ============================================================
// INVENTORY BARCODE SEARCH
// ============================================================


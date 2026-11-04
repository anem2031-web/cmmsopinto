import { activeBookStockUnit } from "../inventory-book-policy";
// ============================================================
// db/warehouses.ts — إدارة المخازن (رئيسي/فرعي) + التحويل الفعلي بينها
// البند 7 من العصف الذهني (2026-08-05). راجع docs/CHANGELOG_TECHNICAL.md
// و CLAUDE.md قبل أي تعديل على هذا الملف — يمس مباشرة أرصدة المخزون.
// ============================================================
import { and, desc, eq, gte, inArray, isNull, or, sql } from "drizzle-orm";
import {
  warehouses,
  warehouseTransfers,
  warehouseTransferNumberCounter,
  warehouseTransferBatches,
  warehouseTransferBatchNumberCounter,
  catalogNodes,
  catalogItems,
  inventory,
  inventoryTransactions,
  inventoryLots,
} from "../../../drizzle/schema";
import { getDb, withTransaction } from "./client";
import { addInventoryTransactionV2, createInventoryItemV2, updateInventoryItemV2 } from "./warehouse-returns";
import { calculateMovementTotal, calculateMovingWeightedAverage, normalizeInventoryQuantity } from "../inventory-costing";
import { isInventoryLotsEnabled, moveInventoryLotBalanceForTransfer } from "../inventory-lots";
import { assertNoSpecificationAggregateBypass } from "../../services/purchase-specification-guards";

// ─────────────────────────────────────────────────────────────
// المخازن — قراءة
// ─────────────────────────────────────────────────────────────

export async function getAllWarehouses() {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select({
      id: warehouses.id,
      code: warehouses.code,
      nameAr: warehouses.nameAr,
      nameEn: warehouses.nameEn,
      description: warehouses.description,
      type: warehouses.type,
      parentId: warehouses.parentId,
      siteId: warehouses.siteId,
      projectId: warehouses.projectId,
      isActive: warehouses.isActive,
      catalogNodeId: warehouses.catalogNodeId,
      catalogNodeNameAr: catalogNodes.nameAr,
      catalogNodeNameEn: catalogNodes.nameEn,
      catalogNodeCode: catalogNodes.code,
      createdAt: warehouses.createdAt,
      updatedAt: warehouses.updatedAt,
    })
    .from(warehouses)
    .leftJoin(catalogNodes, eq(warehouses.catalogNodeId, catalogNodes.id))
    .orderBy(warehouses.type, warehouses.nameAr);
  return rows;
}

export async function getWarehouseById(id: number, tx?: any) {
  const db = tx || (await getDb());
  if (!db) return null;
  const rows = await db.select().from(warehouses).where(eq(warehouses.id, id)).limit(1);
  return rows[0] || null;
}

// تصنيفات المستوى الأول (level = 1) بالكتالوج التي لا يوجد أي مخزن فرعي
// مرتبط بها بعد — هذه فقط ما يجب أن تظهر بالقائمة المنسدلة عند إنشاء مخزن جديد.
export async function getAvailableLevel1CatalogNodes() {
  const db = await getDb();
  if (!db) return [];

  const usedIds = (
    await db.select({ catalogNodeId: warehouses.catalogNodeId }).from(warehouses)
  )
    .map((r: any) => r.catalogNodeId)
    .filter((v: any) => v !== null && v !== undefined) as number[];

  const conditions = [eq(catalogNodes.level, 1), eq(catalogNodes.isActive, 1)];
  const level1Nodes = await db
    .select()
    .from(catalogNodes)
    .where(and(...conditions))
    .orderBy(catalogNodes.sortOrder, catalogNodes.nameAr);

  return level1Nodes.filter((n: any) => !usedIds.includes(n.id));
}

// ─────────────────────────────────────────────────────────────
// المخازن — إنشاء/تعديل
// ─────────────────────────────────────────────────────────────

export async function createSubWarehouse(data: {
  nameAr: string;
  nameEn?: string;
  description?: string;
  catalogNodeId: number;
}) {
  const db = await getDb();
  if (!db) throw new Error("تعذر الاتصال بقاعدة البيانات");

  const nodeRows = await db
    .select()
    .from(catalogNodes)
    .where(eq(catalogNodes.id, data.catalogNodeId))
    .limit(1);
  const node = nodeRows[0];
  if (!node) throw new Error("التصنيف المحدد غير موجود");
  if (node.level !== 1) throw new Error("يجب اختيار تصنيف من المستوى الأول فقط");
  if (!node.isActive) throw new Error("هذا التصنيف غير مُفعَّل بالكتالوج");

  const existing = await db
    .select({ id: warehouses.id })
    .from(warehouses)
    .where(eq(warehouses.catalogNodeId, data.catalogNodeId))
    .limit(1);
  if (existing.length > 0) {
    throw new Error("يوجد مخزن فرعي مرتبط بهذا التصنيف مسبقاً — كل تصنيف يُربط بمخزن واحد فقط");
  }

  const code = `SUB-${node.code || data.catalogNodeId}`;
  const result = await db.insert(warehouses).values({
    code,
    nameAr: data.nameAr,
    nameEn: data.nameEn,
    description: data.description,
    type: "branch",
    catalogNodeId: data.catalogNodeId,
    isActive: 1,
  } as any);
  return (result[0] as any).insertId as number;
}

export async function updateWarehouse(
  id: number,
  data: { nameAr?: string; nameEn?: string; description?: string; isActive?: boolean }
) {
  const db = await getDb();
  if (!db) return;
  await db.update(warehouses).set(data as any).where(eq(warehouses.id, id));
}

// ─────────────────────────────────────────────────────────────
// مطابقة تصنيف الصنف بشجرة الكتالوج — الصعود حتى المستوى الأول
// ─────────────────────────────────────────────────────────────

async function getLevel1AncestorNodeId(nodeId: number, tx?: any): Promise<number | null> {
  const db = tx || (await getDb());
  if (!db) return null;
  let currentId: number | null = nodeId;
  for (let i = 0; i < 10 && currentId !== null; i++) {
    const rows = await db.select().from(catalogNodes).where(eq(catalogNodes.id, currentId)).limit(1);
    const node = rows[0];
    if (!node) return null;
    if (node.level === 1) return node.id;
    currentId = node.parentId ?? null;
  }
  return null;
}

async function generateTransferNumber(tx: any): Promise<string> {
  const year = new Date().getFullYear();
  const [result] = await tx.insert(warehouseTransferNumberCounter).values({ year });
  const seq = (result as any).insertId as number;
  return `TRF-${year}-${String(seq).padStart(6, "0")}`;
}

// ─────────────────────────────────────────────────────────────
// التحويل الفعلي بين مخزنين (رئيسي↔فرعي أو فرعي↔فرعي)
// ─────────────────────────────────────────────────────────────

export async function createWarehouseTransfer(params: {
  fromWarehouseId: number;
  toWarehouseId: number;
  fromInventoryId: number;
  quantity: number;
  notes?: string;
  createdById: number;
  batchId?: number;
  lotTrackingToken?: string;
}, existingTx?: any) {
  const lotsEnabled = isInventoryLotsEnabled();
  const lotTrackingToken = String(params.lotTrackingToken || "").trim();
  if (lotsEnabled && !lotTrackingToken) {
    throw new Error("يجب مسح QR الدفعة أو إدخال رقم اللوت قبل التحويل");
  }

  if (params.fromWarehouseId === params.toWarehouseId) {
    throw new Error("لا يمكن التحويل لنفس المخزن");
  }
  if (params.quantity <= 0) {
    throw new Error("الكمية يجب أن تكون أكبر من صفر");
  }
  const movementQuantity = lotsEnabled
    ? normalizeInventoryQuantity(params.quantity)
    : params.quantity;

  const executeTransfer = async (tx: any) => {
    const fromWh = (
      await tx.select().from(warehouses).where(eq(warehouses.id, params.fromWarehouseId)).limit(1)
    )[0];
    const toWh = (
      await tx.select().from(warehouses).where(eq(warehouses.id, params.toWarehouseId)).limit(1)
    )[0];
    if (!fromWh) throw new Error("المخزن المصدر غير موجود");
    if (!toWh) throw new Error("المخزن الهدف غير موجود");
    if (!fromWh.isActive) throw new Error("المخزن المصدر غير مُفعَّل");
    if (!toWh.isActive) throw new Error("المخزن الهدف غير مُفعَّل");

    // Phase 5.3: lock source Aggregate Inventory for both Lot and legacy paths
    // before reading quantity/cost so transfer posting cannot use stale state.
    await tx.execute(sql`SELECT id FROM inventory WHERE id = ${params.fromInventoryId} FOR UPDATE`);

    // ── تحقق ملكية الصنف للمخزن المصدر (نفس مبدأ الحماية من ثغرة IDOR
    //     الموثقة في CLAUDE.md — لا نثق بأي id قادم من الواجهة دون تحقق) ──
    const source = (
      await tx.select().from(inventory).where(eq(inventory.id, params.fromInventoryId)).limit(1)
    )[0];
    if (!source) throw new Error("الصنف غير موجود");
    if (!lotsEnabled) await assertNoSpecificationAggregateBypass(tx, params.fromInventoryId);
    if (source.warehouseId !== params.fromWarehouseId) {
      throw new Error("هذا الصنف لا ينتمي للمخزن المصدر المحدد");
    }
    if (Number(source.quantity || 0) < movementQuantity) {
      throw new Error("الكمية المطلوب تحويلها أكبر من الرصيد المتاح بالمخزن المصدر");
    }

    // ── تحديد تصنيف الصنف (عبر الكتالوج) ومقارنته بتصنيف المخزن الهدف ──
    let categoryMismatch = false;
    if (source.linkedItemId && toWh.catalogNodeId) {
      const catItemRows = await tx
        .select()
        .from(catalogItems)
        .where(eq(catalogItems.id, source.linkedItemId))
        .limit(1);
      const catItem = catItemRows[0];
      if (catItem) {
        const itemLevel1 = await getLevel1AncestorNodeId(catItem.nodeId, tx);
        if (itemLevel1 && itemLevel1 !== toWh.catalogNodeId) categoryMismatch = true;
      }
    }

    // ── إيجاد أو إنشاء صف المخزون المطابق بالمخزن الهدف ──────────────
    let destRows: any[] = [];
    if (source.linkedItemId) {
      destRows = await tx
        .select()
        .from(inventory)
         .where(and(eq(inventory.warehouseId, params.toWarehouseId), eq(inventory.linkedItemId, source.linkedItemId),
          lotsEnabled ? activeBookStockUnit(String(source.issueUnit || source.unit || "")) : undefined))
        .orderBy(inventory.id)
        .limit(1);
    }
    if (destRows.length === 0 && (!lotsEnabled || !source.linkedItemId) && source.internalCode) {
      destRows = await tx
        .select()
        .from(inventory)
        .where(and(eq(inventory.warehouseId, params.toWarehouseId), eq(inventory.internalCode, source.internalCode)))
        .limit(1);
    }
    if (destRows.length === 0 && (!lotsEnabled || !source.linkedItemId)) {
      destRows = await tx
        .select()
        .from(inventory)
        .where(and(eq(inventory.warehouseId, params.toWarehouseId), eq(inventory.itemName, source.itemName)))
        .limit(1);
    }

    let toInventoryId: number;
    if (destRows.length > 0) {
      let dest = destRows[0];
      // Lock destination Aggregate Inventory for both paths before weighted-average
      // valuation or quantity increment.
      await tx.execute(sql`SELECT id FROM inventory WHERE id = ${dest.id} FOR UPDATE`);
      const lockedRows = await tx.select().from(inventory).where(eq(inventory.id, dest.id)).limit(1);
      if (!lockedRows[0]) throw new Error("سجل المخزون في المخزن الهدف لم يعد موجودًا");
      dest = lockedRows[0];
      destRows = [dest];
      toInventoryId = dest.id;
      // دمج التكلفة بالمتوسط المرجَّح — نفس الصيغة المستخدمة عند الاستلام
      // (server/routers/inventory/receipts.v2.router.ts::processReceiptItem)
      const oldQty = dest.quantity || 0;
      const oldAvgCost = parseFloat(dest.averageCost || "0");
      const sourceAvgCost = parseFloat(source.averageCost || "0");
      const newAvgCost = calculateMovingWeightedAverage({
        currentQuantity: oldQty,
        currentAverageCost: oldAvgCost,
        incomingQuantity: movementQuantity,
        incomingUnitCost: sourceAvgCost,
      });
      await updateInventoryItemV2(
        toInventoryId,
        { averageCost: newAvgCost.toFixed(4) },
        tx
      );
    } else {
      toInventoryId = await createInventoryItemV2(
        {
          itemName: source.itemName,
          itemNameAr: source.itemNameAr || undefined,
          itemNameEn: source.itemNameEn || undefined,
          itemType: source.itemType || undefined,
          quantity: 0,
          unit: source.unit || undefined,
          purchaseUnit: source.purchaseUnit || undefined,
          issueUnit: source.issueUnit || undefined,
          conversionFactor: source.conversionFactor || undefined,
          minQuantity: source.minQuantity || undefined,
          averageCost: source.averageCost || "0",
          totalCostValue: "0",
          internalCode: source.internalCode || undefined,
          manufacturerBarcode: source.manufacturerBarcode || undefined,
          linkedItemId: source.linkedItemId || undefined,
          warehouseId: params.toWarehouseId,
          siteId: toWh.siteId || undefined,
        },
        tx
      ) as number;
    }

    // Reserve the transfer number inside the same transaction and use it on both
    // inventory movements for traceability. AUTO_INCREMENT gaps on rollback are accepted.
    const transferNumber = await generateTransferNumber(tx);

    // ── 2B-8: عند تفعيل Lots، التحويل ينقل نفس Lot بين المخازن سواء تم تعريفه بالـQR أو برقم اللوت.
    // لا ننقص inventory_lots.remainingQuantity لأن الكمية ما زالت داخل الشركة.
    // نحدّث Lot Balance + Aggregate Inventory داخل نفس Transaction، ثم نسجل
    // حركتي OUT/IN بنفس lotId. عند إغلاق الـGate يبقى المسار التاريخي كما هو.
    const movedLot = lotsEnabled
      ? await moveInventoryLotBalanceForTransfer({
          tx,
          trackingToken: lotTrackingToken,
          fromWarehouseId: params.fromWarehouseId,
          fromInventoryId: params.fromInventoryId,
          toInventoryId,
          toInventoryCatalogItemId: destRows[0]?.linkedItemId ?? source.linkedItemId ?? null,
          quantity: movementQuantity,
        })
      : null;

    if (lotsEnabled) {
      const sourceStockResult: any = await tx
        .update(inventory)
        .set({
          quantity: sql`${inventory.quantity} - ${movementQuantity}`,
          totalCostValue: sql`ROUND((${inventory.quantity} - ${movementQuantity}) * ${inventory.averageCost}, 2)`,
        } as any)
        .where(and(
          eq(inventory.id, params.fromInventoryId),
          gte(inventory.quantity, movementQuantity),
        ));
      if (Number(sourceStockResult?.[0]?.affectedRows ?? 0) !== 1) {
        throw new Error("رصيد المخزون المصدر تغيّر أثناء التحويل؛ حدّث الصفحة وأعد المحاولة");
      }

      const destinationStockResult: any = await tx
        .update(inventory)
        .set({
          quantity: sql`${inventory.quantity} + ${movementQuantity}`,
          totalCostValue: sql`ROUND((${inventory.quantity} + ${movementQuantity}) * ${inventory.averageCost}, 2)`,
        } as any)
        .where(eq(inventory.id, toInventoryId));
      if (Number(destinationStockResult?.[0]?.affectedRows ?? 0) !== 1) {
        throw new Error("تعذر تحديث رصيد المخزن الهدف أثناء التحويل");
      }

      const transferUnitCost = Number(source.averageCost || 0);
      await tx.insert(inventoryTransactions).values([
        {
          inventoryId: params.fromInventoryId,
          lotId: movedLot!.lotId,
          type: "out",
          quantity: movementQuantity,
          unitCost: transferUnitCost.toFixed(4),
          totalCost: calculateMovementTotal(movementQuantity, transferUnitCost).toFixed(2),
          reason: params.notes || `تحويل إلى مخزن ${toWh.nameAr}`,
          performedById: params.createdById,
          transactionType: "transfer",
          documentUrl: transferNumber,
        },
        {
          inventoryId: toInventoryId,
          lotId: movedLot!.lotId,
          type: "in",
          quantity: movementQuantity,
          unitCost: transferUnitCost.toFixed(4),
          totalCost: calculateMovementTotal(movementQuantity, transferUnitCost).toFixed(2),
          reason: params.notes || `تحويل من مخزن ${fromWh.nameAr}`,
          performedById: params.createdById,
          transactionType: "transfer",
          documentUrl: transferNumber,
        },
      ] as any);
    } else {
      await addInventoryTransactionV2(
        {
          inventoryId: params.fromInventoryId,
          type: "out",
          quantity: params.quantity,
          unitCost: source.averageCost || "0",
          reason: params.notes || `تحويل إلى مخزن ${toWh.nameAr}`,
          performedById: params.createdById,
          transactionType: "transfer",
          documentUrl: transferNumber,
        },
        tx
      );
      await addInventoryTransactionV2(
        {
          inventoryId: toInventoryId,
          type: "in",
          quantity: params.quantity,
          unitCost: source.averageCost || "0",
          reason: params.notes || `تحويل من مخزن ${fromWh.nameAr}`,
          performedById: params.createdById,
          transactionType: "transfer",
          documentUrl: transferNumber,
        },
        tx
      );
    }

    await tx.insert(warehouseTransfers).values({
      transferNumber,
      batchId: params.batchId,
      fromWarehouseId: params.fromWarehouseId,
      toWarehouseId: params.toWarehouseId,
      fromInventoryId: params.fromInventoryId,
      toInventoryId,
      lotId: movedLot?.lotId ?? null,
      quantity: String(lotsEnabled ? movementQuantity : params.quantity),
      categoryMismatch: categoryMismatch ? 1 : 0,
      notes: params.notes,
      createdById: params.createdById,
    } as any);

    return {
      transferNumber,
      categoryMismatch,
      toInventoryId,
      lotId: movedLot?.lotId ?? null,
      lotCode: movedLot?.lotCode ?? null,
    };
  };
  return existingTx ? executeTransfer(existingTx) : withTransaction(executeTransfer);
}

export async function getWarehouseTransfers(filters?: { warehouseId?: number }) {
  const db = await getDb();
  if (!db) return [];

  let query = db
    .select({
      id: warehouseTransfers.id,
      transferNumber: warehouseTransfers.transferNumber,
      fromWarehouseId: warehouseTransfers.fromWarehouseId,
      toWarehouseId: warehouseTransfers.toWarehouseId,
      fromInventoryId: warehouseTransfers.fromInventoryId,
      toInventoryId: warehouseTransfers.toInventoryId,
      lotId: warehouseTransfers.lotId,
      quantity: warehouseTransfers.quantity,
      categoryMismatch: warehouseTransfers.categoryMismatch,
      notes: warehouseTransfers.notes,
      createdById: warehouseTransfers.createdById,
      createdAt: warehouseTransfers.createdAt,
    })
    .from(warehouseTransfers)
    .orderBy(desc(warehouseTransfers.createdAt));

  if (filters?.warehouseId) {
    const wid = filters.warehouseId;
    query = query.where(
      or(eq(warehouseTransfers.fromWarehouseId, wid), eq(warehouseTransfers.toWarehouseId, wid))
    ) as any;
  }

  return query.limit(200);
}

// ─────────────────────────────────────────────────────────────
// عملية تحويل مجمَّعة (رقم واحد لعملية كاملة، حتى 20 صنفاً)
// كل صنف يُنفَّذ عبر createWarehouseTransfer كمعاملة ذرية مستقلة بذاتها —
// نجاح/فشل صنف لا يوقف بقية الأصناف، ونُرجع تقريراً بنتيجة كل صنف على حدة.
// ─────────────────────────────────────────────────────────────

async function generateBatchNumber(tx?: any): Promise<string> {
  const db = tx ?? await getDb();
  if (!db) throw new Error("تعذر الاتصال بقاعدة البيانات");
  const year = new Date().getFullYear();
  const [result] = await db.insert(warehouseTransferBatchNumberCounter).values({ year });
  const seq = (result as any).insertId as number;
  return `TRB-${year}-${String(seq).padStart(6, "0")}`;
}

export async function createWarehouseTransferBatch(params: {
  fromWarehouseId: number;
  toWarehouseId: number;
  notes?: string;
  createdById: number;
  items: Array<{ fromInventoryId: number; quantity: number; notes?: string; lotTrackingToken?: string }>;
}, tx?: any) {
  if (params.items.length === 0) throw new Error("أضف صنفاً واحداً على الأقل");
  if (params.items.length > 20) throw new Error("الحد الأقصى 20 صنفاً بالعملية الواحدة");
  // The supplied transaction is only for lots of one material need. Ordinary
  // batches containing different materials keep their independent transactions.
  if (tx && new Set(params.items.map(item => item.fromInventoryId)).size !== 1) {
    throw new Error("المعاملة الخارجية مخصصة لدفعات صنف واحد فقط");
  }

  const batchNumber = await generateBatchNumber(tx);

  // Existing callers retain independent item transactions. Ticket-team forms
  // supply one outer transaction so stock and their links commit together.
  const db = tx ?? await getDb();
  if (!db) throw new Error("تعذر الاتصال بقاعدة البيانات");
  const [headerResult] = await db.insert(warehouseTransferBatches).values({
    batchNumber,
    fromWarehouseId: params.fromWarehouseId,
    toWarehouseId: params.toWarehouseId,
    notes: params.notes,
    itemsCount: params.items.length,
    createdById: params.createdById,
  } as any);
  const batchId = (headerResult as any).insertId as number;

  const results: Array<{
    fromInventoryId: number;
    success: boolean;
    transferNumber?: string;
    categoryMismatch?: boolean;
    lotId?: number | null;
    lotCode?: string | null;
    message: string;
  }> = [];

  for (const item of params.items) {
    try {
      const r = await createWarehouseTransfer({
        fromWarehouseId: params.fromWarehouseId,
        toWarehouseId: params.toWarehouseId,
        fromInventoryId: item.fromInventoryId,
        quantity: item.quantity,
        notes: item.notes || params.notes,
        createdById: params.createdById,
        batchId,
        lotTrackingToken: item.lotTrackingToken,
      }, tx);
      results.push({
        fromInventoryId: item.fromInventoryId,
        success: true,
        transferNumber: r.transferNumber,
        categoryMismatch: r.categoryMismatch,
        lotId: r.lotId,
        lotCode: r.lotCode,
        message: r.categoryMismatch ? "تم — تنبيه: تصنيف غير مطابق" : "تم بنجاح",
      });
    } catch (err: any) {
      if (tx) throw err;
      results.push({
        fromInventoryId: item.fromInventoryId,
        success: false,
        message: err.message || "فشل التحويل",
      });
    }
  }

  return { batchNumber, batchId, results };
}

// ─────────────────────────────────────────────────────────────
// عرض العمليات كبطاقات (بطاقة واحدة لكل عملية، مهما كان عدد أصنافها)
// السجلات القديمة (batchId فارغ، قبل 2026-08-05) تُعامَل كعملية أحادية
// الصنف بذاتها — key بصيغة legacy:<transferId> بدل batch:<batchId>.
// ─────────────────────────────────────────────────────────────

export async function getWarehouseTransferBatchCards(filters?: { warehouseId?: number }) {
  const db = await getDb();
  if (!db) return [];

  // 1) العمليات المجمَّعة الحديثة (لها رأس بجدول warehouse_transfer_batches)
  let headerRows = await db
    .select()
    .from(warehouseTransferBatches)
    .orderBy(desc(warehouseTransferBatches.createdAt));

  if (filters?.warehouseId) {
    const wid = filters.warehouseId;
    headerRows = headerRows.filter(
      (b: any) => b.fromWarehouseId === wid || b.toWarehouseId === wid
    );
  }

  const batchIds = headerRows.map((b: any) => b.id);
  const itemsForBatches = batchIds.length
    ? await db.select().from(warehouseTransfers).where(inArray(warehouseTransfers.batchId, batchIds))
    : [];

  // 2) السجلات القديمة (سابقة لهذا التعديل) بلا batchId — كل واحدة عملية مستقلة
  let legacyRows = await db
    .select()
    .from(warehouseTransfers)
    .where(isNull(warehouseTransfers.batchId))
    .orderBy(desc(warehouseTransfers.createdAt));

  if (filters?.warehouseId) {
    const wid = filters.warehouseId;
    legacyRows = legacyRows.filter(
      (t: any) => t.fromWarehouseId === wid || t.toWarehouseId === wid
    );
  }

  // ── جلب اسم/كود كل صنف مرة واحدة لكل الأصناف المرجَعة أعلاه (للبحث بالاسم/بالرقم) ──
  const allInventoryIds = Array.from(new Set([
    ...itemsForBatches.map((t: any) => t.fromInventoryId),
    ...legacyRows.map((t: any) => t.fromInventoryId),
  ]));
  const inventoryRows = allInventoryIds.length
    ? await db.select().from(inventory).where(inArray(inventory.id, allInventoryIds))
    : [];
  const inventoryById = new Map(inventoryRows.map((i: any) => [i.id, i]));
  const allLotIds = Array.from(new Set([
    ...itemsForBatches.map((t: any) => t.lotId),
    ...legacyRows.map((t: any) => t.lotId),
  ].filter((id: any) => id !== null && id !== undefined))) as number[];
  const lotRows = allLotIds.length
    ? await db.select({ id: inventoryLots.id, lotCode: inventoryLots.lotCode, trackingToken: inventoryLots.trackingToken }).from(inventoryLots).where(inArray(inventoryLots.id, allLotIds))
    : [];
  const lotById = new Map(lotRows.map((lot: any) => [lot.id, lot]));

  const batchCards = headerRows.map((b: any) => {
    const items = itemsForBatches.filter((t: any) => t.batchId === b.id);
    return {
      key: `batch:${b.id}`,
      displayNumber: b.batchNumber,
      fromWarehouseId: b.fromWarehouseId,
      toWarehouseId: b.toWarehouseId,
      notes: b.notes,
      itemsCount: b.itemsCount,
      totalQuantity: items.reduce((s: number, t: any) => s + parseFloat(t.quantity || "0"), 0),
      mismatchCount: items.filter((t: any) => !!t.categoryMismatch).length,
      createdById: b.createdById,
      createdAt: b.createdAt,
      itemsSummary: items.map((t: any) => {
        const inv = inventoryById.get(t.fromInventoryId) as any;
        return {
          itemName: inv?.itemName || `صنف #${t.fromInventoryId}`,
          internalCode: inv?.internalCode || null,
          manufacturerBarcode: inv?.manufacturerBarcode || null,
          lotCode: t.lotId ? (lotById.get(t.lotId) as any)?.lotCode || null : null,
          lotTrackingToken: t.lotId ? (lotById.get(t.lotId) as any)?.trackingToken || null : null,
        };
      }),
    };
  });

  const legacyCards = legacyRows.map((t: any) => {
    const inv = inventoryById.get(t.fromInventoryId) as any;
    return {
      key: `legacy:${t.id}`,
      displayNumber: t.transferNumber,
      fromWarehouseId: t.fromWarehouseId,
      toWarehouseId: t.toWarehouseId,
      notes: t.notes,
      itemsCount: 1,
      totalQuantity: parseFloat(t.quantity || "0"),
      mismatchCount: t.categoryMismatch ? 1 : 0,
      createdById: t.createdById,
      createdAt: t.createdAt,
      itemsSummary: [{
        itemName: inv?.itemName || `صنف #${t.fromInventoryId}`,
        internalCode: inv?.internalCode || null,
        manufacturerBarcode: inv?.manufacturerBarcode || null,
        lotCode: t.lotId ? (lotById.get(t.lotId) as any)?.lotCode || null : null,
        lotTrackingToken: t.lotId ? (lotById.get(t.lotId) as any)?.trackingToken || null : null,
      }],
    };
  });

  return [...batchCards, ...legacyCards].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

export async function getWarehouseTransferBatchDetail(key: string) {
  const db = await getDb();
  if (!db) return null;

  const [kind, idStr] = key.split(":");
  const id = Number(idStr);
  if (!id) throw new Error("مفتاح عملية غير صالح");

  if (kind === "legacy") {
    const rows = await db.select().from(warehouseTransfers).where(eq(warehouseTransfers.id, id)).limit(1);
    const t = rows[0];
    if (!t) return null;
    const item = await attachItemName(db, t);
    return {
      displayNumber: t.transferNumber,
      fromWarehouseId: t.fromWarehouseId,
      toWarehouseId: t.toWarehouseId,
      notes: t.notes,
      createdById: t.createdById,
      createdAt: t.createdAt,
      items: [item],
    };
  }

  if (kind === "batch") {
    const headerRows = await db.select().from(warehouseTransferBatches).where(eq(warehouseTransferBatches.id, id)).limit(1);
    const header = headerRows[0];
    if (!header) return null;
    const itemRows = await db.select().from(warehouseTransfers).where(eq(warehouseTransfers.batchId, id));
    const items = await Promise.all(itemRows.map((t: any) => attachItemName(db, t)));
    return {
      displayNumber: header.batchNumber,
      fromWarehouseId: header.fromWarehouseId,
      toWarehouseId: header.toWarehouseId,
      notes: header.notes,
      createdById: header.createdById,
      createdAt: header.createdAt,
      items,
    };
  }

  throw new Error("مفتاح عملية غير صالح");
}

async function attachItemName(db: any, t: any) {
  const invRows = await db.select().from(inventory).where(eq(inventory.id, t.fromInventoryId)).limit(1);
  const inv = invRows[0];
  const lotRows = t.lotId
    ? await db.select({ lotCode: inventoryLots.lotCode }).from(inventoryLots).where(eq(inventoryLots.id, t.lotId)).limit(1)
    : [];
  return {
    transferNumber: t.transferNumber,
    itemName: inv?.itemName || `صنف #${t.fromInventoryId}`,
    internalCode: inv?.internalCode || null,
    unit: inv?.unit || "",
    lotId: t.lotId ?? null,
    lotCode: lotRows[0]?.lotCode || null,
    quantity: t.quantity,
    categoryMismatch: !!t.categoryMismatch,
    notes: t.notes,
  };
}

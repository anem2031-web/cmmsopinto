import { randomUUID } from "node:crypto";
import { and, eq, gte, or, sql } from "drizzle-orm";
import {
  inventory,
  inventoryCountItems,
  inventoryCountOperations,
  inventoryCountSnapshots,
  inventoryLotBalances,
  inventoryLots,
  inventorySettlementItems,
  inventorySettlements,
} from "../../drizzle/schema";
import { normalizeInventoryQuantity } from "./inventory-costing";
import { assertSpecificationLotMovement, type SpecificationMovementKind } from "../services/purchase-specification-guards";
import { receiptSpecificationFields } from "../services/purchase-specifications";

export type InventoryLotSourceType = "receipt" | "opening_balance";

export interface InventoryLotIdentity {
  lotId: number;
  lotCode: string;
  trackingToken: string;
}

export interface InventoryLotIssueResolution extends InventoryLotIdentity {
  sourceType: InventoryLotSourceType;
  catalogItemId: number | null;
  receiptId: number | null;
  purchaseOrderId: number | null;
  purchaseOrderItemId: number | null;
  supplierItemName?: string | null;
  issueUnitCost?: number;
  balanceId: number;
  balanceQuantity: number;
  remainingQuantity: number;
}

export interface InventoryLotSupplierReturnResolution extends InventoryLotIssueResolution {
  inventoryId: number;
  warehouseId: number;
  purchaseOrderId: number | null;
  purchaseOrderItemId: number | null;
  receiptItemId: number | null;
}

export interface InventoryLotWarehouseTransferResolution extends InventoryLotIssueResolution {
  inventoryId: number;
  warehouseId: number;
  inventoryCatalogItemId: number | null;
}

export interface InventoryLotDisposalResolution extends InventoryLotIssueResolution {
  inventoryId: number;
  warehouseId: number;
  inventoryCatalogItemId: number | null;
}

export interface InventoryLotCountResolution extends InventoryLotIssueResolution {
  inventoryId: number;
  warehouseId: number;
  inventoryCatalogItemId: number | null;
}

export interface InventoryLotCountAdjustmentResult {
  lotId: number;
  inventoryId: number;
  beforeLotQuantity: number;
  afterLotQuantity: number;
  diffQuantity: number;
  beforeInventoryQuantity: number;
  afterInventoryQuantity: number;
  beforeRemainingQuantity: number;
  afterRemainingQuantity: number;
}

/**
 * 2B-8 rollout gate.
 *
 * The schema is intentionally installed before the whole movement workflow is
 * switched to lot-aware accounting. Keeping this false by default prevents a
 * partially deployed system where receipts create lot balances while an old
 * issue/transfer/disposal path can still mutate aggregate Inventory only.
 */
export function isInventoryLotsEnabled(): boolean {
  const raw = String(process.env.INVENTORY_LOTS_ENABLED || "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

async function generateLotIdentity(tx: any): Promise<{ lotCode: string; trackingToken: string }> {
  const year = new Date().getFullYear();

  // LOT numbering is intentionally independent from document numbering.
  // The per-year counter row is incremented inside the caller's DB transaction,
  // so concurrent LOT creation cannot receive the same sequence number.
  await tx.execute(sql`
    INSERT INTO inventory_lot_number_counter (year, lastNumber)
    VALUES (${year}, 1)
    ON DUPLICATE KEY UPDATE lastNumber = lastNumber + 1
  `);

  const [rows] = await tx.execute(sql`
    SELECT lastNumber
    FROM inventory_lot_number_counter
    WHERE year = ${year}
  `);
  const sequence = Number((rows as any[])?.[0]?.lastNumber ?? 0);
  if (!Number.isInteger(sequence) || sequence < 1) {
    throw new Error("تعذر توليد الرقم التسلسلي لدفعة المخزون");
  }
  if (sequence > 99999) {
    throw new Error(`تم استنفاد نطاق أرقام LOT للسنة ${year}`);
  }

  const uuid = randomUUID();
  return {
    lotCode: `LOT-${year}-${String(sequence).padStart(5, "0")}`,
    trackingToken: `CMMS-LOT-${uuid}`,
  };
}

async function insertLotWithInitialBalance(params: {
  tx: any;
  sourceType: InventoryLotSourceType;
  catalogItemId?: number | null;
  inventoryId: number;
  originalQuantity: number;
  purchaseUnit?: string | null;
  issueUnit?: string | null;
  conversionFactor?: number;
  purchaseUnitCost?: number | null;
  issueUnitCost?: number;
  receiptId?: number | null;
  receiptItemId?: number | null;
  purchaseOrderId?: number | null;
  purchaseOrderItemId?: number | null;
  catalogSupplierId?: number | null;
  supplierCandidateId?: number | null;
  sourceCountOperationId?: number | null;
  sourceSettlementId?: number | null;
  sourceSettlementItemId?: number | null;
  supplierItemName?: string | null;
  supplierItemCode?: string | null;
  batchNumber?: string | null;
  expiryDate?: string | Date | null;
  createdById: number;
  specificationStatus?: "pending" | null;
}): Promise<InventoryLotIdentity> {
  const quantity = normalizeInventoryQuantity(params.originalQuantity);
  if (!(quantity > 0)) throw new Error("كمية الدفعة يجب أن تكون أكبر من صفر");

  const { lotCode, trackingToken } = await generateLotIdentity(params.tx);
  const [result] = await params.tx.insert(inventoryLots).values({
    lotCode,
    trackingToken,
    sourceType: params.sourceType,
    catalogItemId: params.catalogItemId ?? null,
    receiptId: params.receiptId ?? null,
    receiptItemId: params.receiptItemId ?? null,
    purchaseOrderId: params.purchaseOrderId ?? null,
    purchaseOrderItemId: params.purchaseOrderItemId ?? null,
    catalogSupplierId: params.catalogSupplierId ?? null,
    supplierCandidateId: params.supplierCandidateId ?? null,
    sourceCountOperationId: params.sourceCountOperationId ?? null,
    sourceSettlementId: params.sourceSettlementId ?? null,
    sourceSettlementItemId: params.sourceSettlementItemId ?? null,
    originalQuantity: quantity.toFixed(3),
    remainingQuantity: quantity.toFixed(3),
    purchaseUnit: params.purchaseUnit ?? null,
    issueUnit: params.issueUnit ?? null,
    conversionFactor: Number(params.conversionFactor ?? 1).toFixed(4),
    purchaseUnitCost: params.purchaseUnitCost == null ? null : Number(params.purchaseUnitCost).toFixed(4),
    issueUnitCost: Number(params.issueUnitCost ?? 0).toFixed(4),
    supplierItemName: params.supplierItemName?.trim() || null,
    supplierItemCode: params.supplierItemCode?.trim() || null,
    batchNumber: params.batchNumber?.trim() || null,
    expiryDate: params.expiryDate ? new Date(params.expiryDate) : null,
    createdById: params.createdById,
    specificationStatus: params.specificationStatus ?? null,
  } as any);

  const lotId = Number((result as any).insertId);
  if (!lotId) throw new Error("تعذر إنشاء هوية دفعة المخزون");

  await params.tx.insert(inventoryLotBalances).values({
    lotId,
    inventoryId: params.inventoryId,
    quantity: quantity.toFixed(3),
  } as any);

  return { lotId, lotCode, trackingToken };
}

export async function createReceiptInventoryLot(params: {
  tx: any;
  catalogItemId?: number | null;
  inventoryId: number;
  receiptId: number;
  receiptItemId: number;
  purchaseOrderId?: number | null;
  purchaseOrderItemId?: number | null;
  catalogSupplierId?: number | null;
  supplierCandidateId?: number | null;
  issueQuantity: number;
  purchaseUnit?: string | null;
  issueUnit?: string | null;
  conversionFactor?: number;
  purchaseUnitCost?: number | null;
  issueUnitCost?: number;
  supplierItemName?: string | null;
  supplierItemCode?: string | null;
  batchNumber?: string | null;
  expiryDate?: string | Date | null;
  createdById: number;
}): Promise<InventoryLotIdentity> {
  const specification = await receiptSpecificationFields(params.tx, {
    purchaseOrderItemId: params.purchaseOrderItemId,
    purchaseOrderId: params.purchaseOrderId,
    receiptId: params.receiptId,
    receiptItemId: params.receiptItemId,
    inventoryId: params.inventoryId,
    createdById: params.createdById,
    issueQuantity: params.issueQuantity,
  });
  return insertLotWithInitialBalance({
    ...params,
    ...specification,
    sourceType: "receipt",
    originalQuantity: params.issueQuantity,
  });
}

export async function createOpeningBalanceInventoryLot(params: {
  tx: any;
  catalogItemId: number;
  inventoryId: number;
  sourceCountOperationId: number;
  sourceSettlementId: number;
  sourceSettlementItemId: number;
  quantity: number;
  unit?: string | null;
  unitCost?: number;
  expiryDate?: string | Date | null;
  createdById: number;
}): Promise<InventoryLotIdentity> {
  return insertLotWithInitialBalance({
    tx: params.tx,
    sourceType: "opening_balance",
    catalogItemId: params.catalogItemId,
    inventoryId: params.inventoryId,
    originalQuantity: params.quantity,
    sourceCountOperationId: params.sourceCountOperationId,
    sourceSettlementId: params.sourceSettlementId,
    sourceSettlementItemId: params.sourceSettlementItemId,
    purchaseUnit: params.unit,
    issueUnit: params.unit,
    conversionFactor: 1,
    purchaseUnitCost: params.unitCost ?? 0,
    issueUnitCost: params.unitCost ?? 0,
    expiryDate: params.expiryDate,
    createdById: params.createdById,
  });
}

export async function getInventoryLotByTrackingToken(tx: any, trackingToken: string) {
  const token = String(trackingToken || "").trim();
  if (!token) return null;
  const rows = await tx.select().from(inventoryLots)
    .where(eq(inventoryLots.trackingToken, token))
    .limit(1);
  return rows[0] || null;
}

/**
 * Resolve user-facing Lot input consistently across inventory movements.
 * A scanned QR carries trackingToken, while manual entry usually carries the
 * human-readable lotCode. Both columns are unique, so either identifier can
 * safely resolve the same physical Inventory Lot. Callers should continue with
 * the canonical trackingToken returned by the resolved Lot.
 */
function matchInventoryLotIdentifier(identifier: string) {
  return or(
    eq(inventoryLots.trackingToken, identifier),
    eq(inventoryLots.lotCode, identifier),
  );
}

/**
 * Resolve a scanned lot inside a specific Inventory row/warehouse balance.
 * The QR token alone is never trusted to imply the current warehouse: the lot
 * must have a balance row for the Inventory record being issued from.
 */
export async function resolveInventoryLotForIssue(params: {
  tx: any;
  trackingToken: string;
  inventoryId: number;
  inventoryCatalogItemId?: number | null;
}): Promise<InventoryLotIssueResolution> {
  const token = String(params.trackingToken || "").trim();
  if (!token) throw new Error("يجب مسح QR الدفعة أو إدخال رقم اللوت قبل الصرف");

  const rows = await params.tx
    .select({
      lotId: inventoryLots.id,
      lotCode: inventoryLots.lotCode,
      trackingToken: inventoryLots.trackingToken,
      sourceType: inventoryLots.sourceType,
      catalogItemId: inventoryLots.catalogItemId,
      receiptId: inventoryLots.receiptId,
      purchaseOrderId: inventoryLots.purchaseOrderId,
      purchaseOrderItemId: inventoryLots.purchaseOrderItemId,
      supplierItemName: inventoryLots.supplierItemName,
      issueUnitCost: inventoryLots.issueUnitCost,
      remainingQuantity: inventoryLots.remainingQuantity,
      balanceId: inventoryLotBalances.id,
      balanceQuantity: inventoryLotBalances.quantity,
    })
    .from(inventoryLots)
    .innerJoin(
      inventoryLotBalances,
      and(
        eq(inventoryLotBalances.lotId, inventoryLots.id),
        eq(inventoryLotBalances.inventoryId, params.inventoryId),
      ),
    )
    // يقبل إما مسح QR (trackingToken) أو كتابة رقم اللوت البشري (lotCode) يدوياً.
    .where(matchInventoryLotIdentifier(token))
    .limit(1);

  const row = rows[0] as any;
  if (!row) {
    throw new Error("رقم اللوت أو الـQR الممسوح لا يخص هذا الصنف في المستودع الحالي");
  }

  const lotCatalogItemId = row.catalogItemId == null ? null : Number(row.catalogItemId);
  const inventoryCatalogItemId = params.inventoryCatalogItemId == null
    ? null
    : Number(params.inventoryCatalogItemId);
  if (
    lotCatalogItemId != null &&
    inventoryCatalogItemId != null &&
    lotCatalogItemId !== inventoryCatalogItemId
  ) {
    throw new Error("هوية الكتالوج للدفعة لا تطابق هوية الصنف في المخزون");
  }

  const balanceQuantity = normalizeInventoryQuantity(Number(row.balanceQuantity || 0));
  const remainingQuantity = normalizeInventoryQuantity(Number(row.remainingQuantity || 0));
  if (!(balanceQuantity > 0) || !(remainingQuantity > 0)) {
    throw new Error("هذه الدفعة لا تحتوي رصيدًا متاحًا للصرف في المستودع الحالي");
  }

  return {
    lotId: Number(row.lotId),
    lotCode: String(row.lotCode),
    trackingToken: String(row.trackingToken),
    sourceType: row.sourceType as InventoryLotSourceType,
    catalogItemId: lotCatalogItemId,
    receiptId: row.receiptId == null ? null : Number(row.receiptId),
    purchaseOrderId: row.purchaseOrderId == null ? null : Number(row.purchaseOrderId),
    purchaseOrderItemId: row.purchaseOrderItemId == null ? null : Number(row.purchaseOrderItemId),
    supplierItemName: row.supplierItemName == null ? null : String(row.supplierItemName),
    issueUnitCost: Number(row.issueUnitCost || 0),
    balanceId: Number(row.balanceId),
    balanceQuantity,
    remainingQuantity,
  };
}


/**
 * Main Phase 3 — count/settlement movement guard.
 *
 * A Lot that is already a target of an in-progress periodic count is temporarily
 * frozen for movements that decrease or transfer its balance. This gives the count
 * a stable physical reference while allowing post-open receipt Lots (which are not
 * count targets) to continue through the normal workflow.
 *
 * After final count save, zero-difference Lots are released immediately. A Lot with
 * a non-zero discrepancy remains frozen until an applied settlement item exists for
 * that exact operation + Inventory + Lot. The guard is application-level only and
 * does not rewrite historical stock or add broad DB constraints.
 */
export async function assertInventoryLotMovementAllowedDuringCount(params: {
  tx: any;
  inventoryId: number;
  lotId: number;
  actionLabel?: string;
}) {
  const actionLabel = String(params.actionLabel || "الصرف").trim() || "الصرف";

  const countRows = await params.tx
    .select({
      operationId: inventoryCountOperations.id,
      operationNumber: inventoryCountOperations.operationNumber,
      status: inventoryCountOperations.status,
      countType: inventoryCountOperations.countType,
      diffQuantity: inventoryCountItems.diffQuantity,
    })
    .from(inventoryCountItems)
    .innerJoin(
      inventoryCountOperations,
      eq(inventoryCountOperations.id, inventoryCountItems.operationId),
    )
    // Future-facing guard only: a matching Main Phase 3 opening snapshot proves
    // this count uses the new cutoff model. Historical pre-Snapshot counts are
    // intentionally not retroactively frozen.
    .innerJoin(
      inventoryCountSnapshots,
      and(
        eq(inventoryCountSnapshots.operationId, inventoryCountItems.operationId),
        eq(inventoryCountSnapshots.inventoryId, inventoryCountItems.inventoryId),
        eq(inventoryCountSnapshots.lotId, inventoryCountItems.lotId),
      ),
    )
    .where(and(
      eq(inventoryCountItems.inventoryId, params.inventoryId),
      eq(inventoryCountItems.lotId, params.lotId),
      eq(inventoryCountOperations.countType, "periodic"),
    ));

  for (const row of countRows as any[]) {
    if (row.status === "in_progress") {
      throw new Error(
        `لا يمكن ${actionLabel} من هذه الدفعة حالياً لأنها ضمن الجرد ${row.operationNumber} الجاري. ` +
        "أكمل الجرد واحفظه نهائياً أولاً؛ الدفعات الجديدة الناتجة عن الاستلام بعد فتح الجرد تبقى متاحة بشكل مستقل.",
      );
    }

    const diffQuantity = normalizeInventoryQuantity(Number(row.diffQuantity || 0));
    if (row.status !== "completed" || diffQuantity === 0) continue;

    const settledRows = await params.tx
      .select({ id: inventorySettlementItems.id })
      .from(inventorySettlementItems)
      .innerJoin(
        inventorySettlements,
        eq(inventorySettlements.id, inventorySettlementItems.settlementId),
      )
      .where(and(
        eq(inventorySettlements.sourceCountOperationId, Number(row.operationId)),
        eq(inventorySettlements.status, "applied"),
        eq(inventorySettlementItems.inventoryId, params.inventoryId),
        eq(inventorySettlementItems.lotId, params.lotId),
      ))
      .limit(1);

    if (settledRows.length === 0) {
      throw new Error(
        `لا يمكن ${actionLabel} من هذه الدفعة حالياً لأنها ضمن الجرد ${row.operationNumber} ` +
        "وبها فرق لم تتم تسويته بعد. طبّق تسوية الجرد أولاً ثم أعد المحاولة.",
      );
    }
  }
}


/**
 * Resolve a Lot identifier inside a specific source warehouse for transfer.
 * QR trackingToken and manual lotCode both resolve to the same Lot; warehouse context is still
 * required so a split Lot cannot silently resolve to a balance in another
 * warehouse. An optional Inventory id can be supplied when the operator first
 * selected an item manually; it is verified, never trusted.
 */
export async function resolveInventoryLotForWarehouseTransfer(params: {
  tx: any;
  trackingToken: string;
  fromWarehouseId: number;
  fromInventoryId?: number;
}): Promise<InventoryLotWarehouseTransferResolution> {
  const token = String(params.trackingToken || "").trim();
  if (!token) throw new Error("يجب مسح QR الدفعة أو إدخال رقم اللوت قبل التحويل");

  const rows = await params.tx
    .select({
      lotId: inventoryLots.id,
      lotCode: inventoryLots.lotCode,
      trackingToken: inventoryLots.trackingToken,
      sourceType: inventoryLots.sourceType,
      catalogItemId: inventoryLots.catalogItemId,
      receiptId: inventoryLots.receiptId,
      remainingQuantity: inventoryLots.remainingQuantity,
      balanceId: inventoryLotBalances.id,
      balanceQuantity: inventoryLotBalances.quantity,
      inventoryId: inventory.id,
      warehouseId: inventory.warehouseId,
      inventoryCatalogItemId: inventory.linkedItemId,
    })
    .from(inventoryLots)
    .innerJoin(inventoryLotBalances, eq(inventoryLotBalances.lotId, inventoryLots.id))
    .innerJoin(inventory, eq(inventory.id, inventoryLotBalances.inventoryId))
    .where(and(
      matchInventoryLotIdentifier(token),
      eq(inventory.warehouseId, params.fromWarehouseId),
      ...(params.fromInventoryId ? [eq(inventory.id, params.fromInventoryId)] : []),
    ));

  const positiveRows = rows.filter((row: any) =>
    normalizeInventoryQuantity(Number(row.balanceQuantity || 0)) > 0
  );
  if (positiveRows.length === 0) {
    throw new Error("رقم اللوت أو الـQR لا يملك رصيدًا في المخزن المصدر المحدد");
  }
  if (positiveRows.length > 1) {
    throw new Error("معرّف الدفعة مرتبط بأكثر من سجل مخزون داخل المخزن المصدر؛ أوقف التحويل وراجع بيانات المخزون");
  }

  const row: any = positiveRows[0];
  const lotCatalogItemId = row.catalogItemId == null ? null : Number(row.catalogItemId);
  const inventoryCatalogItemId = row.inventoryCatalogItemId == null ? null : Number(row.inventoryCatalogItemId);
  if (lotCatalogItemId != null && inventoryCatalogItemId != null && lotCatalogItemId !== inventoryCatalogItemId) {
    throw new Error("هوية الكتالوج للدفعة لا تطابق هوية الصنف في المخزون المصدر");
  }

  const balanceQuantity = normalizeInventoryQuantity(Number(row.balanceQuantity || 0));
  const remainingQuantity = normalizeInventoryQuantity(Number(row.remainingQuantity || 0));
  if (!(remainingQuantity > 0)) {
    throw new Error("الرصيد الكلي لهذه الدفعة أصبح صفرًا ولا يمكن تحويل كمية منها");
  }

  return {
    lotId: Number(row.lotId),
    lotCode: String(row.lotCode),
    trackingToken: String(row.trackingToken),
    sourceType: row.sourceType as InventoryLotSourceType,
    catalogItemId: lotCatalogItemId,
    receiptId: row.receiptId == null ? null : Number(row.receiptId),
    balanceId: Number(row.balanceId),
    balanceQuantity,
    remainingQuantity,
    inventoryId: Number(row.inventoryId),
    warehouseId: Number(row.warehouseId),
    inventoryCatalogItemId,
  };
}

/**
 * Move a quantity of the SAME Lot between Inventory rows/warehouses.
 * This changes only the spatial Lot balances; inventory_lots.remainingQuantity
 * is intentionally unchanged because the stock remains inside the company.
 * Aggregate Inventory quantities are updated by the caller in the same DB
 * transaction.
 */
export async function moveInventoryLotBalanceForTransfer(params: {
  tx: any;
  trackingToken: string;
  fromWarehouseId: number;
  fromInventoryId: number;
  toInventoryId: number;
  toInventoryCatalogItemId?: number | null;
  quantity: number;
}): Promise<InventoryLotWarehouseTransferResolution> {
  const quantity = normalizeInventoryQuantity(params.quantity);
  if (!(quantity > 0)) throw new Error("كمية التحويل يجب أن تكون أكبر من صفر");
  if (params.fromInventoryId === params.toInventoryId) {
    throw new Error("لا يمكن نقل رصيد الدفعة إلى نفس سجل المخزون");
  }

  const lot = await resolveInventoryLotForWarehouseTransfer({
    tx: params.tx,
    trackingToken: params.trackingToken,
    fromWarehouseId: params.fromWarehouseId,
    fromInventoryId: params.fromInventoryId,
  });

  await assertSpecificationLotMovement(params.tx, { lotId: lot.lotId, kind: "transfer" });

  await assertInventoryLotMovementAllowedDuringCount({
    tx: params.tx,
    inventoryId: params.fromInventoryId,
    lotId: lot.lotId,
    actionLabel: "التحويل",
  });
  await assertInventoryLotMovementAllowedDuringCount({
    tx: params.tx,
    inventoryId: params.toInventoryId,
    lotId: lot.lotId,
    actionLabel: "التحويل إلى المخزن الهدف",
  });

  const toCatalogItemId = params.toInventoryCatalogItemId == null
    ? null
    : Number(params.toInventoryCatalogItemId);
  if (lot.catalogItemId != null && toCatalogItemId != null && lot.catalogItemId !== toCatalogItemId) {
    throw new Error("هوية الكتالوج للدفعة لا تطابق هوية الصنف في المخزن الهدف");
  }
  if (quantity > lot.balanceQuantity) {
    throw new Error(`الكمية المطلوبة (${quantity}) أكبر من رصيد الدفعة في المخزن المصدر (${lot.balanceQuantity})`);
  }
  if (quantity > lot.remainingQuantity) {
    throw new Error(`الكمية المطلوبة (${quantity}) أكبر من المتبقي الكلي للدفعة (${lot.remainingQuantity})`);
  }

  const sourceResult: any = await params.tx
    .update(inventoryLotBalances)
    .set({ quantity: sql`${inventoryLotBalances.quantity} - ${quantity}` } as any)
    .where(and(
      eq(inventoryLotBalances.id, lot.balanceId),
      eq(inventoryLotBalances.lotId, lot.lotId),
      eq(inventoryLotBalances.inventoryId, params.fromInventoryId),
      gte(inventoryLotBalances.quantity, quantity),
    ));
  if (Number(sourceResult?.[0]?.affectedRows ?? 0) !== 1) {
    throw new Error("رصيد الدفعة تغيّر أثناء التحويل؛ أعد مسح QR أو إدخال رقم اللوت وحاول مرة أخرى");
  }

  await params.tx
    .insert(inventoryLotBalances)
    .values({
      lotId: lot.lotId,
      inventoryId: params.toInventoryId,
      quantity: quantity.toFixed(3),
    } as any)
    .onDuplicateKeyUpdate({
      set: {
        quantity: sql`${inventoryLotBalances.quantity} + ${quantity}`,
      } as any,
    });

  return {
    ...lot,
    balanceQuantity: normalizeInventoryQuantity(lot.balanceQuantity - quantity),
  };
}


/**
 * Resolve a Lot identifier for disposal/damage inside an explicitly selected
 * warehouse. A Lot may be split across warehouses after transfers; warehouseId
 * is therefore mandatory and no balance is chosen silently from another warehouse.
 */
export async function resolveInventoryLotForDisposal(params: {
  tx: any;
  trackingToken: string;
  warehouseId: number;
}): Promise<InventoryLotDisposalResolution> {
  const token = String(params.trackingToken || "").trim();
  if (!token) throw new Error("يجب مسح QR الدفعة أو إدخال رقم اللوت قبل الاستبعاد");

  const rows = await params.tx
    .select({
      lotId: inventoryLots.id,
      lotCode: inventoryLots.lotCode,
      trackingToken: inventoryLots.trackingToken,
      sourceType: inventoryLots.sourceType,
      catalogItemId: inventoryLots.catalogItemId,
      receiptId: inventoryLots.receiptId,
      remainingQuantity: inventoryLots.remainingQuantity,
      balanceId: inventoryLotBalances.id,
      balanceQuantity: inventoryLotBalances.quantity,
      inventoryId: inventory.id,
      warehouseId: inventory.warehouseId,
      inventoryCatalogItemId: inventory.linkedItemId,
    })
    .from(inventoryLots)
    .innerJoin(inventoryLotBalances, eq(inventoryLotBalances.lotId, inventoryLots.id))
    .innerJoin(inventory, eq(inventory.id, inventoryLotBalances.inventoryId))
    .where(and(
      matchInventoryLotIdentifier(token),
      eq(inventory.warehouseId, params.warehouseId),
    ));

  if (rows.length === 0) {
    const knownLot = await params.tx
      .select({ id: inventoryLots.id })
      .from(inventoryLots)
      .where(matchInventoryLotIdentifier(token))
      .limit(1);
    if (knownLot.length > 0) {
      throw new Error("هذه الدفعة لا تملك رصيدًا في المستودع المحدد للاستبعاد");
    }
    throw new Error("رقم اللوت أو QR الدفعة غير معروف في نظام المخزون");
  }

  const positiveRows = rows.filter((row: any) =>
    normalizeInventoryQuantity(Number(row.balanceQuantity || 0)) > 0
  );
  if (positiveRows.length === 0) {
    throw new Error("هذه الدفعة لا تحتوي رصيدًا متاحًا للاستبعاد في المستودع المحدد");
  }
  if (positiveRows.length > 1) {
    throw new Error("بيانات الدفعة غير متسقة: يوجد أكثر من رصيد موجب لها داخل المستودع المحدد");
  }

  const row: any = positiveRows[0];
  const lotCatalogItemId = row.catalogItemId == null ? null : Number(row.catalogItemId);
  const inventoryCatalogItemId = row.inventoryCatalogItemId == null
    ? null
    : Number(row.inventoryCatalogItemId);
  if (lotCatalogItemId != null && inventoryCatalogItemId != null && lotCatalogItemId !== inventoryCatalogItemId) {
    throw new Error("هوية الكتالوج للدفعة لا تطابق هوية الصنف في المخزون");
  }

  const balanceQuantity = normalizeInventoryQuantity(Number(row.balanceQuantity || 0));
  const remainingQuantity = normalizeInventoryQuantity(Number(row.remainingQuantity || 0));
  if (!(remainingQuantity > 0)) {
    throw new Error("الرصيد الكلي لهذه الدفعة أصبح صفرًا ولا يمكن استبعاد كمية منها");
  }

  return {
    lotId: Number(row.lotId),
    lotCode: String(row.lotCode),
    trackingToken: String(row.trackingToken),
    sourceType: row.sourceType as InventoryLotSourceType,
    catalogItemId: lotCatalogItemId,
    receiptId: row.receiptId == null ? null : Number(row.receiptId),
    balanceId: Number(row.balanceId),
    balanceQuantity,
    remainingQuantity,
    inventoryId: Number(row.inventoryId),
    warehouseId: Number(row.warehouseId),
    inventoryCatalogItemId,
  };
}


/**
 * Resolve a Lot identifier inside the warehouse of a periodic count.
 * Unlike issue/disposal resolution, a zero balance is allowed: physically finding
 * a known QR whose system balance is zero is a valid positive count discrepancy.
 * The Lot must already have a balance row in the count warehouse; we do not invent
 * a cross-warehouse adjustment during count.
 */
export async function resolveInventoryLotForCount(params: {
  tx: any;
  trackingToken: string;
  warehouseId: number;
}): Promise<InventoryLotCountResolution> {
  const token = String(params.trackingToken || "").trim();
  if (!token) throw new Error("يجب مسح QR الدفعة أو إدخال رقم اللوت قبل عدّها");

  const rows = await params.tx
    .select({
      lotId: inventoryLots.id,
      lotCode: inventoryLots.lotCode,
      trackingToken: inventoryLots.trackingToken,
      sourceType: inventoryLots.sourceType,
      catalogItemId: inventoryLots.catalogItemId,
      receiptId: inventoryLots.receiptId,
      remainingQuantity: inventoryLots.remainingQuantity,
      balanceId: inventoryLotBalances.id,
      balanceQuantity: inventoryLotBalances.quantity,
      inventoryId: inventory.id,
      warehouseId: inventory.warehouseId,
      inventoryCatalogItemId: inventory.linkedItemId,
    })
    .from(inventoryLots)
    .innerJoin(inventoryLotBalances, eq(inventoryLotBalances.lotId, inventoryLots.id))
    .innerJoin(inventory, eq(inventory.id, inventoryLotBalances.inventoryId))
    .where(and(
      matchInventoryLotIdentifier(token),
      eq(inventory.warehouseId, params.warehouseId),
    ));

  if (rows.length === 0) {
    throw new Error("رقم اللوت أو QR الدفعة لا يخص رصيداً مسجلاً في مستودع عملية الجرد");
  }
  if (rows.length > 1) {
    throw new Error("معرّف الدفعة مرتبط بأكثر من سجل مخزون داخل نفس المستودع؛ أوقف الجرد وراجع بيانات المخزون");
  }

  const row: any = rows[0];
  const lotCatalogItemId = row.catalogItemId == null ? null : Number(row.catalogItemId);
  const inventoryCatalogItemId = row.inventoryCatalogItemId == null
    ? null
    : Number(row.inventoryCatalogItemId);
  if (lotCatalogItemId != null && inventoryCatalogItemId != null && lotCatalogItemId !== inventoryCatalogItemId) {
    throw new Error("هوية الكتالوج للدفعة لا تطابق هوية الصنف في المخزون");
  }

  return {
    lotId: Number(row.lotId),
    lotCode: String(row.lotCode),
    trackingToken: String(row.trackingToken),
    sourceType: row.sourceType as InventoryLotSourceType,
    catalogItemId: lotCatalogItemId,
    receiptId: row.receiptId == null ? null : Number(row.receiptId),
    balanceId: Number(row.balanceId),
    balanceQuantity: normalizeInventoryQuantity(Number(row.balanceQuantity || 0)),
    remainingQuantity: normalizeInventoryQuantity(Number(row.remainingQuantity || 0)),
    inventoryId: Number(row.inventoryId),
    warehouseId: Number(row.warehouseId),
    inventoryCatalogItemId,
  };
}

/**
 * Apply one periodic-count adjustment to a known Lot and its Aggregate Inventory.
 * Main Phase 3 settlement rule: the frozen count variance is applied ON TOP OF the
 * current Lot/Inventory balance; Settlement never resets stock to an old counted value.
 * This preserves independent post-count receipt Lots and their later movements.
 *
 * Integrity preconditions remain strict:
 *   1) Inventory aggregate must equal SUM(Lot balances) before adjustment;
 *   2) Lot remaining must equal SUM(its balances across warehouses) before adjustment;
 *   3) applying the frozen variance may not create a negative Lot/Inventory balance.
 */
export async function applyInventoryLotCountAdjustment(params: {
  tx: any;
  lotId: number;
  inventoryId: number;
  expectedBalanceQuantity: number;
  countedQuantity: number;
}): Promise<InventoryLotCountAdjustmentResult> {
  const expected = normalizeInventoryQuantity(params.expectedBalanceQuantity);
  const counted = normalizeInventoryQuantity(params.countedQuantity);
  if (counted < 0) throw new Error("الكمية المعدودة لا يمكن أن تكون سالبة");

  const balanceRows = await params.tx.select({
    id: inventoryLotBalances.id,
    quantity: inventoryLotBalances.quantity,
  }).from(inventoryLotBalances).where(and(
    eq(inventoryLotBalances.lotId, params.lotId),
    eq(inventoryLotBalances.inventoryId, params.inventoryId),
  )).limit(2);
  if (balanceRows.length !== 1) {
    throw new Error("تعذر تحديد رصيد الدفعة في سجل المخزون بشكل فريد");
  }

  const currentBalance = normalizeInventoryQuantity(Number(balanceRows[0].quantity || 0));

  const invRows = await params.tx.select({
    quantity: inventory.quantity,
  }).from(inventory).where(eq(inventory.id, params.inventoryId)).limit(1);
  if (!invRows[0]) throw new Error("سجل المخزون المرتبط بالدفعة غير موجود");
  const currentInventoryQuantity = normalizeInventoryQuantity(Number(invRows[0].quantity || 0));

  const invBalanceSumRows = await params.tx.select({
    total: sql<string>`COALESCE(SUM(${inventoryLotBalances.quantity}), 0)`,
  }).from(inventoryLotBalances).where(eq(inventoryLotBalances.inventoryId, params.inventoryId));
  const inventoryLotSum = normalizeInventoryQuantity(Number(invBalanceSumRows[0]?.total || 0));
  if (currentInventoryQuantity !== inventoryLotSum) {
    throw new Error(`عدم تطابق قبل التسوية: رصيد Inventory (${currentInventoryQuantity}) لا يساوي مجموع أرصدة الدفعات (${inventoryLotSum})`);
  }

  const lotRows = await params.tx.select({
    remainingQuantity: inventoryLots.remainingQuantity,
  }).from(inventoryLots).where(eq(inventoryLots.id, params.lotId)).limit(1);
  if (!lotRows[0]) throw new Error("دفعة المخزون غير موجودة");
  const currentRemaining = normalizeInventoryQuantity(Number(lotRows[0].remainingQuantity || 0));

  const lotBalanceSumRows = await params.tx.select({
    total: sql<string>`COALESCE(SUM(${inventoryLotBalances.quantity}), 0)`,
  }).from(inventoryLotBalances).where(eq(inventoryLotBalances.lotId, params.lotId));
  const lotBalanceSum = normalizeInventoryQuantity(Number(lotBalanceSumRows[0]?.total || 0));
  if (currentRemaining !== lotBalanceSum) {
    throw new Error(`عدم تطابق قبل التسوية: المتبقي الكلي للدفعة (${currentRemaining}) لا يساوي مجموع توزيعها على المخازن (${lotBalanceSum})`);
  }

  // The discrepancy belongs to the finalized count reference, not to the current
  // balance at settlement time. Apply only that frozen variance to current stock.
  const diff = normalizeInventoryQuantity(counted - expected);
  if (diff === 0) {
    return {
      lotId: params.lotId,
      inventoryId: params.inventoryId,
      beforeLotQuantity: currentBalance,
      afterLotQuantity: currentBalance,
      diffQuantity: 0,
      beforeInventoryQuantity: currentInventoryQuantity,
      afterInventoryQuantity: currentInventoryQuantity,
      beforeRemainingQuantity: currentRemaining,
      afterRemainingQuantity: currentRemaining,
    };
  }

  const afterLotQuantity = normalizeInventoryQuantity(currentBalance + diff);
  if (afterLotQuantity < 0) {
    throw new Error("التسوية ستجعل رصيد الدفعة سالباً؛ راجع فرق الجرد والحركات اللاحقة");
  }

  const balanceResult: any = await params.tx.update(inventoryLotBalances)
    .set({ quantity: afterLotQuantity.toFixed(3) } as any)
    .where(and(
      eq(inventoryLotBalances.id, balanceRows[0].id),
      eq(inventoryLotBalances.quantity, currentBalance.toFixed(3)),
    ));
  if (Number(balanceResult?.[0]?.affectedRows ?? 0) !== 1) {
    throw new Error("رصيد الدفعة تغيّر أثناء تطبيق التسوية؛ أعد المحاولة");
  }

  const newRemaining = normalizeInventoryQuantity(currentRemaining + diff);
  if (newRemaining < 0) throw new Error("التسوية ستجعل المتبقي الكلي للدفعة سالباً");
  const lotResult: any = await params.tx.update(inventoryLots)
    .set({ remainingQuantity: newRemaining.toFixed(3) } as any)
    .where(and(
      eq(inventoryLots.id, params.lotId),
      eq(inventoryLots.remainingQuantity, currentRemaining.toFixed(3)),
    ));
  if (Number(lotResult?.[0]?.affectedRows ?? 0) !== 1) {
    throw new Error("المتبقي الكلي للدفعة تغيّر أثناء التسوية؛ تم إلغاء العملية");
  }

  const newInventoryQuantity = normalizeInventoryQuantity(currentInventoryQuantity + diff);
  if (newInventoryQuantity < 0) throw new Error("التسوية ستجعل رصيد المخزون سالباً");
  const invResult: any = await params.tx.update(inventory)
    .set({ quantity: newInventoryQuantity, updatedAt: new Date() } as any)
    .where(and(
      eq(inventory.id, params.inventoryId),
      eq(inventory.quantity, currentInventoryQuantity),
    ));
  if (Number(invResult?.[0]?.affectedRows ?? 0) !== 1) {
    throw new Error("رصيد المخزون تغيّر أثناء التسوية؛ تم إلغاء العملية");
  }

  return {
    lotId: params.lotId,
    inventoryId: params.inventoryId,
    beforeLotQuantity: currentBalance,
    afterLotQuantity,
    diffQuantity: diff,
    beforeInventoryQuantity: currentInventoryQuantity,
    afterInventoryQuantity: newInventoryQuantity,
    beforeRemainingQuantity: currentRemaining,
    afterRemainingQuantity: newRemaining,
  };
}

/**
 * Resolve a Lot identifier for a supplier return without trusting an Inventory id
 * from the client. A receipt lot is the source of truth for receipt/PO identity.
 * Opening-balance lots are intentionally rejected because they have no proven
 * supplier/invoice source.
 *
 * A lot may be split across warehouses. The return workflow therefore requires
 * an explicit warehouseId before scanning, and resolution is limited to that
 * warehouse so no balance can be selected silently from another warehouse.
 */
export async function resolveInventoryLotForSupplierReturn(params: {
  tx: any;
  trackingToken: string;
  warehouseId: number;
}): Promise<InventoryLotSupplierReturnResolution> {
  const token = String(params.trackingToken || "").trim();
  if (!token) throw new Error("يجب مسح QR الدفعة أو إدخال رقم اللوت قبل إنشاء مرتجع المورد");

  const rows = await params.tx
    .select({
      lotId: inventoryLots.id,
      lotCode: inventoryLots.lotCode,
      trackingToken: inventoryLots.trackingToken,
      sourceType: inventoryLots.sourceType,
      catalogItemId: inventoryLots.catalogItemId,
      receiptId: inventoryLots.receiptId,
      receiptItemId: inventoryLots.receiptItemId,
      purchaseOrderId: inventoryLots.purchaseOrderId,
      purchaseOrderItemId: inventoryLots.purchaseOrderItemId,
      remainingQuantity: inventoryLots.remainingQuantity,
      balanceId: inventoryLotBalances.id,
      inventoryId: inventoryLotBalances.inventoryId,
      balanceQuantity: inventoryLotBalances.quantity,
      warehouseId: inventory.warehouseId,
    })
    .from(inventoryLots)
    .innerJoin(inventoryLotBalances, eq(inventoryLotBalances.lotId, inventoryLots.id))
    .innerJoin(inventory, eq(inventory.id, inventoryLotBalances.inventoryId))
    .where(and(
      matchInventoryLotIdentifier(token),
      eq(inventory.warehouseId, params.warehouseId),
    ));

  if (rows.length === 0) {
    const knownLot = await params.tx
      .select({ id: inventoryLots.id, sourceType: inventoryLots.sourceType })
      .from(inventoryLots)
      .where(matchInventoryLotIdentifier(token))
      .limit(1);
    if (knownLot.length > 0) {
      if (knownLot[0].sourceType !== "receipt") {
        throw new Error("هذه الكمية رصيد افتتاحي ولا يوجد لها مورد/فاتورة مثبتة؛ لا يمكن إرجاعها من مسار مرتجع المورد");
      }
      throw new Error("هذه الدفعة لا تملك رصيدًا في المستودع المحدد للإرجاع");
    }
    throw new Error("رقم اللوت أو QR الدفعة غير معروف في نظام المخزون");
  }

  const sourceType = rows[0].sourceType as InventoryLotSourceType;
  if (sourceType !== "receipt") {
    throw new Error("هذه الكمية رصيد افتتاحي ولا يوجد لها مورد/فاتورة مثبتة؛ لا يمكن إرجاعها من مسار مرتجع المورد");
  }
  if (!rows[0].receiptId) {
    throw new Error("دفعة الاستلام لا تحتوي مرجع سند استلام صالح؛ أوقف المرتجع وراجع بيانات الدفعة");
  }

  const positiveRows = rows.filter((row: any) =>
    normalizeInventoryQuantity(Number(row.balanceQuantity || 0)) > 0
  );
  if (positiveRows.length === 0) {
    throw new Error("هذه الدفعة لا تحتوي رصيدًا متاحًا للإرجاع في المستودع المحدد");
  }
  if (positiveRows.length > 1) {
    throw new Error("بيانات الدفعة غير متسقة: يوجد أكثر من رصيد موجب لها داخل المستودع المحدد");
  }

  const row: any = positiveRows[0];
  const balanceQuantity = normalizeInventoryQuantity(Number(row.balanceQuantity || 0));
  const remainingQuantity = normalizeInventoryQuantity(Number(row.remainingQuantity || 0));
  if (!(remainingQuantity > 0)) {
    throw new Error("الرصيد الكلي لهذه الدفعة أصبح صفرًا ولا يمكن إرجاع كمية منها");
  }

  return {
    lotId: Number(row.lotId),
    lotCode: String(row.lotCode),
    trackingToken: String(row.trackingToken),
    sourceType,
    catalogItemId: row.catalogItemId == null ? null : Number(row.catalogItemId),
    receiptId: Number(row.receiptId),
    receiptItemId: row.receiptItemId == null ? null : Number(row.receiptItemId),
    purchaseOrderId: row.purchaseOrderId == null ? null : Number(row.purchaseOrderId),
    purchaseOrderItemId: row.purchaseOrderItemId == null ? null : Number(row.purchaseOrderItemId),
    balanceId: Number(row.balanceId),
    inventoryId: Number(row.inventoryId),
    warehouseId: Number(row.warehouseId),
    balanceQuantity,
    remainingQuantity,
  };
}

/**
 * Atomically consume quantity from the scanned lot's warehouse balance and
 * from the global lot remaining quantity. The caller must perform the matching
 * aggregate Inventory decrement inside the SAME database transaction.
 */
export async function consumeInventoryLotForIssue(params: {
  tx: any;
  trackingToken: string;
  inventoryId: number;
  inventoryCatalogItemId?: number | null;
  quantity: number;
  actionLabel?: string;
  specificationMovementKind?: SpecificationMovementKind;
}): Promise<InventoryLotIssueResolution> {
  const quantity = normalizeInventoryQuantity(params.quantity);
  const actionLabel = String(params.actionLabel || "الصرف").trim() || "الصرف";
  if (!(quantity > 0)) throw new Error(`كمية ${actionLabel} يجب أن تكون أكبر من صفر`);

  const lot = await resolveInventoryLotForIssue(params);

  await assertSpecificationLotMovement(params.tx, { lotId: lot.lotId, kind: params.specificationMovementKind ?? "issue" });

  await assertInventoryLotMovementAllowedDuringCount({
    tx: params.tx,
    inventoryId: params.inventoryId,
    lotId: lot.lotId,
    actionLabel,
  });

  if (quantity > lot.balanceQuantity) {
    throw new Error(`الكمية المطلوبة (${quantity}) أكبر من رصيد الدفعة الممسوحة (${lot.balanceQuantity})`);
  }
  if (quantity > lot.remainingQuantity) {
    throw new Error(`الكمية المطلوبة (${quantity}) أكبر من المتبقي الكلي للدفعة (${lot.remainingQuantity})`);
  }

  const balanceResult: any = await params.tx
    .update(inventoryLotBalances)
    .set({
      quantity: sql`${inventoryLotBalances.quantity} - ${quantity}`,
    } as any)
    .where(and(
      eq(inventoryLotBalances.id, lot.balanceId),
      eq(inventoryLotBalances.lotId, lot.lotId),
      eq(inventoryLotBalances.inventoryId, params.inventoryId),
      gte(inventoryLotBalances.quantity, quantity),
    ));
  if (Number(balanceResult?.[0]?.affectedRows ?? 0) !== 1) {
    throw new Error(`رصيد الدفعة تغيّر أثناء عملية ${actionLabel}؛ أعد مسح QR وحاول مرة أخرى`);
  }

  const lotResult: any = await params.tx
    .update(inventoryLots)
    .set({
      remainingQuantity: sql`${inventoryLots.remainingQuantity} - ${quantity}`,
    } as any)
    .where(and(
      eq(inventoryLots.id, lot.lotId),
      gte(inventoryLots.remainingQuantity, quantity),
    ));
  if (Number(lotResult?.[0]?.affectedRows ?? 0) !== 1) {
    throw new Error(`الرصيد الكلي للدفعة تغيّر أثناء عملية ${actionLabel}؛ أعد المحاولة`);
  }

  return {
    ...lot,
    balanceQuantity: normalizeInventoryQuantity(lot.balanceQuantity - quantity),
    remainingQuantity: normalizeInventoryQuantity(lot.remainingQuantity - quantity),
  };
}

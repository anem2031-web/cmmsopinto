import { sql, type SQL } from "drizzle-orm";
import { receiptInOrderUnits } from "../../../shared/receipt-conversion";
import { APP_ROLE } from "../../../shared/roles";
import { getDb } from "../../_core/db/client";
import { getPurchaseOrdersByIds } from "../../_core/db/purchase-read-lists";
import { createPurchaseOrderReadScope } from "../../_core/authz/guard";
import { groupReadRows, readScopeChunks } from "../../_core/authz/read-batch";
import { isInventoryLotsEnabled } from "../../_core/inventory-lots";
import { pscmAvailableIssueQuantity, pscmLotUnitsPerOrderUnit } from "./fulfillment-issue";
import { loadEmergencyHolds } from "../purchase-specification-guards";

type Actor = Parameters<typeof createPurchaseOrderReadScope>[0];
type Database = Pick<NonNullable<Awaited<ReturnType<typeof getDb>>>, "execute">;
type Line = {
  purchaseOrderItemId: number;
  purchaseOrderId: number;
  purchaseOrderNumber: string;
  requisitionId: number;
  requisitionNumber: string;
  sequence: number;
  projectName: string;
  taskName: string;
  itemName: string;
  orderUnit: string;
  requestedQuantity: number;
  itemStatus: string;
  reviewRole: string | null;
  orderStatus: string;
};
type Receipt = {
  purchaseOrderItemId: number;
  receivedQuantity: string | number;
  receivedUnit: string | null;
  lotId: number | null;
  lotCode: string | null;
  issueUnit: string | null;
  factor: string | number | null;
  specificationStatus: string | null;
  available: string | number;
};
type Issue = {
  purchaseOrderItemId: number;
  lotId: number;
  quantity: number;
  orderQuantity: string | number;
  deliveryNumber: string;
  recipientName: string | null;
};

const queuePageSize = 50;
const rounded = (value: number) => Math.round(value * 1_000_000) / 1_000_000;
const parameters = (ids: number[]) => sql.join(ids.map(id => sql`${id}`), sql`, `);
const sources = sql`FROM pscm_purchase_items m
  JOIN purchase_order_items i ON i.id = m.purchaseOrderItemId AND i.purchaseOrderId = m.purchaseOrderId
  JOIN purchase_orders p ON p.id = m.purchaseOrderId AND p.sourceSystem = 'PSCM'`;
const columns = sql`m.purchaseOrderItemId, m.purchaseOrderId, p.poNumber AS purchaseOrderNumber,
  p.sourceRequestId AS requisitionId, p.sourceReference AS requisitionNumber, m.sequence,
  m.projectName, m.taskName, i.itemName, m.orderUnit, m.requestedQuantity,
  i.status AS itemStatus, i.reviewRole, p.status AS orderStatus`;
const eligibleLines = sql`i.status = 'delivered_to_warehouse'
  AND p.status NOT IN ('closed','rejected','draft','revision_needed')`;

async function fetchRows<T>(db: Database, query: SQL): Promise<T[]> {
  const result = await db.execute(query);
  if (!Array.isArray(result[0])) throw new Error("Invalid PSCM fulfillment response");
  return result[0] as T[];
}

async function canonicalUnits(db: Database, units: (string | null)[]) {
  const labels = Array.from(new Set(units.map(unit => unit?.trim()).filter((unit): unit is string => Boolean(unit))));
  const key = (unit: string) => unit.trim().toLocaleLowerCase();
  const aliases = new Map<string, string>();
  for (let start = 0; start < labels.length; start += 500) {
    const literals = sql.join(labels.slice(start, start + 500).map(unit => sql`${unit}`), sql`, `);
    const rows = await fetchRows<{ nameAr: string; nameEn: string }>(db, sql`
      SELECT nameAr, nameEn FROM catalog_units WHERE isActive = 1
        AND (nameAr IN (${literals}) OR nameEn IN (${literals}))`);
    for (const row of rows) {
      aliases.set(key(row.nameAr), row.nameAr);
      aliases.set(key(row.nameEn), row.nameAr);
    }
  }
  return (unit: string) => aliases.get(key(unit)) ?? unit.trim();
}

async function loadFulfillment(db: Database, lines: Line[], lotsEnabled: boolean) {
  const ids = lines.map(line => line.purchaseOrderItemId);
  const [receipts, issues, emergencyHolds] = await Promise.all([
    readScopeChunks(ids, chunk => fetchRows<Receipt>(db, sql`
      SELECT ri.purchaseOrderItemId, ri.receivedQuantity, ri.purchaseUnit AS receivedUnit,
        l.id AS lotId, l.lotCode, l.issueUnit, l.conversionFactor AS factor, l.specificationStatus,
        CASE WHEN inv.id IS NOT NULL AND inv.isFrozen = 0
          THEN GREATEST(0, LEAST(COALESCE(b.quantity, 0), l.remainingQuantity, inv.quantity))
          ELSE 0 END AS available
      FROM warehouse_receipt_items ri
      JOIN warehouse_receipts h ON h.id = ri.receiptId AND h.status = 'confirmed'
      JOIN purchase_order_items i ON i.id = ri.purchaseOrderItemId
      LEFT JOIN inventory_lots l ON l.receiptItemId = ri.id AND l.receiptId = ri.receiptId
        AND l.purchaseOrderItemId = i.id AND l.purchaseOrderId = i.purchaseOrderId AND l.sourceType = 'receipt'
      LEFT JOIN inventory inv ON inv.id = ri.inventoryId
      LEFT JOIN inventory_lot_balances b ON b.lotId = l.id AND b.inventoryId = inv.id
      WHERE ri.purchaseOrderItemId IN (${parameters(chunk)})
      ORDER BY ri.id, l.id`)),
    readScopeChunks(ids, chunk => fetchRows<Issue>(db, sql`
      SELECT f.purchaseOrderItemId, f.lotId, f.quantity, f.orderQuantity, f.deliveryNumber, d.deliveredToName AS recipientName
      FROM pscm_fulfillment_issues f
      LEFT JOIN delivery_documents d ON d.id = f.deliveryDocumentId AND d.poItemId = f.purchaseOrderItemId
      WHERE f.purchaseOrderItemId IN (${parameters(chunk)})
      ORDER BY f.deliveryDocumentId, f.deliveryNumber`)),
    loadEmergencyHolds(db, ids),
  ]);
  const receiptsByLine = groupReadRows(receipts, row => row.purchaseOrderItemId);
  const issuesByLine = groupReadRows(issues, row => row.purchaseOrderItemId);
  const canonical = await canonicalUnits(db, [
    ...lines.map(line => line.orderUnit),
    ...receipts.flatMap(receipt => [receipt.receivedUnit, receipt.issueUnit]),
  ]);
  return lines.map(line => {
    const lineIssues = issuesByLine.get(line.purchaseOrderItemId) ?? [];
    const issuedByLot = new Map<number, number>();
    for (const row of lineIssues) {
      issuedByLot.set(row.lotId, (issuedByLot.get(row.lotId) ?? 0) + row.quantity);
    }
    const deliveries = lineIssues.map(row => ({
      number: row.deliveryNumber,
      quantity: Number(row.orderQuantity),
      ...(row.recipientName ? { recipientName: row.recipientName } : {}),
    }));
    const issuedQuantity = rounded(deliveries.reduce((total, issue) => total + issue.quantity, 0));
    const remaining = Math.max(0, rounded(line.requestedQuantity - issuedQuantity));
    let receivedQuantity = 0;
    let completeReceiptData = true;
    let readyQuantity = 0;
    const orderUnit = canonical(line.orderUnit);
    const lots: { id: number; code: string; quantity: number; unit: string }[] = [];
    for (const receipt of receiptsByLine.get(line.purchaseOrderItemId) ?? []) {
      const stockUnit = canonical(receipt.issueUnit ?? "");
      const receivedUnit = canonical(receipt.receivedUnit ?? "");
      const factor = Number(receipt.factor);
      const received = receiptInOrderUnits({
        orderUnit, receivedUnit, issueUnit: stockUnit,
        quantity: Number(receipt.receivedQuantity), unitCost: 0, factor,
      });
      if (received) receivedQuantity += received.quantity;
      else completeReceiptData = false;
      if (emergencyHolds.has(line.purchaseOrderItemId) || !lotsEnabled || line.itemStatus !== "delivered_to_warehouse" ||
        ["closed", "rejected", "draft", "revision_needed"].includes(line.orderStatus) ||
        !receipt.lotId || !receipt.lotCode ||
        (receipt.specificationStatus !== "approved" &&
          (line.reviewRole === APP_ROLE.CONSTRUCTION_PROCUREMENT_MANAGER || receipt.specificationStatus !== null))) continue;
      const stockPerOrder = pscmLotUnitsPerOrderUnit({
        orderUnit, purchaseUnit: receivedUnit, issueUnit: stockUnit, conversionFactor: factor,
      });
      if (stockPerOrder === null) continue;
      const quantity = pscmAvailableIssueQuantity(Number(receipt.available), remaining, stockPerOrder, issuedByLot.get(receipt.lotId) ?? 0);
      if (quantity <= 0) continue;
      lots.push({ id: receipt.lotId, code: receipt.lotCode, quantity, unit: receipt.issueUnit! });
      readyQuantity += quantity / stockPerOrder;
    }
    return {
      line, lots, deliveries, issuedQuantity, completeReceiptData,
      receivedQuantity: rounded(receivedQuantity),
      readyQuantity: rounded(Math.min(remaining, readyQuantity)),
    };
  });
}

export async function getPscmFulfillment(instanceId: string, requisitionIds: number[]) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  return db.transaction(async tx => {
    const lines = await readScopeChunks(requisitionIds, ids => fetchRows<Line>(tx, sql`
      SELECT ${columns} ${sources}
      WHERE p.sourceInstanceId = ${instanceId} AND p.sourceRequestId IN (${parameters(ids)})
      ORDER BY p.sourceRequestId, m.sequence`));
    return { items: (await loadFulfillment(tx, lines, isInventoryLotsEnabled())).filter(record => record.completeReceiptData).map(record => ({
      requisitionId: record.line.requisitionId,
      sequence: record.line.sequence,
      unit: record.line.orderUnit,
      receivedQuantity: record.receivedQuantity,
      readyQuantity: record.readyQuantity,
      issuedQuantity: record.issuedQuantity,
      deliveries: record.deliveries,
    })) };
  });
}

export async function listPscmReady(actor: Actor, after = 0, search = "") {
  if (!isInventoryLotsEnabled()) return { items: [], nextCursor: null };
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const term = "%" + search.trim().replace(/[!%_]/g, character => "!" + character) + "%";
  const candidates = await fetchRows<Line>(db, sql`
    SELECT ${columns} ${sources}
    WHERE m.purchaseOrderItemId > ${after} AND ${eligibleLines}
      ${search.trim() ? sql`AND (p.poNumber LIKE ${term} ESCAPE '!' OR p.sourceReference LIKE ${term} ESCAPE '!' OR m.projectName LIKE ${term} ESCAPE '!' OR m.taskName LIKE ${term} ESCAPE '!' OR i.itemName LIKE ${term} ESCAPE '!' OR EXISTS (SELECT 1 FROM inventory_lots findLot WHERE findLot.purchaseOrderItemId=m.purchaseOrderItemId AND findLot.lotCode LIKE ${term} ESCAPE '!'))` : sql``}
      AND EXISTS (
        SELECT 1 FROM inventory_lots l
        JOIN inventory_lot_balances b ON b.lotId = l.id AND b.quantity >= 1
        WHERE l.purchaseOrderItemId = m.purchaseOrderItemId AND l.sourceType = 'receipt'
          AND (l.specificationStatus IS NULL OR l.specificationStatus = 'approved')
      )
    ORDER BY m.purchaseOrderItemId LIMIT ${queuePageSize + 1}`);
  const page = candidates.slice(0, queuePageSize);
  const orders = await getPurchaseOrdersByIds(Array.from(new Set(page.map(line => line.purchaseOrderId))));
  const scope = await createPurchaseOrderReadScope(actor, orders);
  const visible = new Set(scope.filter(orders).map(order => order.id));
  const records = await loadFulfillment(db, page.filter(line => visible.has(line.purchaseOrderId)), true);
  return {
    items: records.filter(record => record.lots.length > 0).map(({ line, lots }) => ({
      purchaseOrderItemId: line.purchaseOrderItemId,
      purchaseOrderNumber: line.purchaseOrderNumber,
      requisitionNumber: line.requisitionNumber,
      projectName: line.projectName,
      taskName: line.taskName,
      itemName: line.itemName,
      lots,
    })),
    nextCursor: candidates.length > queuePageSize ? page[page.length - 1].purchaseOrderItemId : null,
  };
}

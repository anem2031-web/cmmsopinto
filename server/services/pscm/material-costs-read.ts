import { sql, type SQL } from "drizzle-orm";
import { materialAllocationCents } from "../../../shared/material-execution-costs";
import { groupReadRows, readScopeChunks } from "../../_core/authz/read-batch";
import { getDb } from "../../_core/db/client";
import { pscmPurchasePayload } from "./purchase-request-contract";

type Database = Pick<NonNullable<Awaited<ReturnType<typeof getDb>>>, "execute">;
type Decimal = number | string;
type Order = { id: number; requisitionId: number; requisitionNumber: string };
type Delivery = {
  number: string;
  sequence: number | null;
  issuedCents: number;
  returnedCents: number;
};
type RequisitionCosts = {
  requisitionId: number;
  complete: boolean;
  deliveries: Delivery[];
};
type Movement = {
  purchaseId: number;
  transactionId: number | null;
  documentId: number | null;
  number: string | null;
  taskOrder: number;
  sequence: number | null;
  originLotId: number | null;
  quantity: Decimal | null;
  allocationId: number | null;
  allocatedQuantity: Decimal | null;
  allocatedValue: Decimal | null;
  lotUnitCost: Decimal | null;
  requiresMovement: number;
};

const idsSql = (ids: number[]) =>
  sql.join(
    ids.map(id => sql`${id}`),
    sql`, `
  );

async function readRows<T>(db: Database, query: SQL): Promise<T[]> {
  const result = await db.execute(query);
  if (!Array.isArray(result[0]))
    throw new Error("Invalid PSCM materials cost data");
  return result[0] as T[];
}

async function directProjectOrders(
  db: Database,
  orders: Order[],
  instanceId: string
) {
  const byId = new Map(orders.map(order => [order.id, order]));
  const audits = await readScopeChunks(
    orders.map(order => order.id),
    ids =>
      readRows<{ id: number; newValues: unknown }>(
        db,
        sql`
      SELECT entityId AS id, newValues FROM audit_logs
      WHERE entityType = 'purchase_order' AND action = 'create_po' AND entityId IN (${idsSql(ids)})`
      )
  );
  const direct = new Set<number>();
  const task = new Set<number>();
  for (const audit of audits) {
    const order = byId.get(audit.id);
    if (!order) continue;
    let value = audit.newValues;
    if (typeof value === "string") {
      try {
        value = JSON.parse(value);
      } catch {
        continue;
      }
    }
    if (!value || typeof value !== "object" || !("source" in value)) continue;
    const parsed = pscmPurchasePayload.shape.source.safeParse(value.source);
    if (!parsed.success) continue;
    const source = parsed.data;
    if (
      source.instanceId !== instanceId ||
      source.requisitionId !== order.requisitionId ||
      source.requisitionNumber !== order.requisitionNumber
    )
      continue;
    if (source.task === null) direct.add(order.id);
    else task.add(order.id);
  }
  task.forEach(id => direct.delete(id));
  return direct;
}

/** Only committed stock movements linked to this PSCM instance's purchase order count. */
export async function getPscmMaterialCosts(
  instanceId: string,
  requisitionIds: number[]
) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  return db.transaction(async tx => {
    const orders = await readScopeChunks(requisitionIds, ids =>
      readRows<Order>(
        tx,
        sql`
      SELECT p.id, p.sourceRequestId AS requisitionId, p.sourceReference AS requisitionNumber
      FROM purchase_orders p
      WHERE p.sourceSystem = 'PSCM' AND p.sourceInstanceId = ${instanceId}
        AND p.sourceRequestId IN (${idsSql(ids)})
      ORDER BY p.sourceRequestId`
      )
    );
    const requisitions = new Map<number, RequisitionCosts>(
      orders.map(order => [
        order.id,
        { requisitionId: order.requisitionId, complete: true, deliveries: [] },
      ])
    );
    const movements = await readScopeChunks(
      orders.map(order => order.id),
      ids =>
        readRows<Movement>(
          tx,
          sql`
      SELECT i.purchaseOrderId AS purchaseId, t.id AS transactionId, d.id AS documentId, d.deliveryNumber AS number,
        EXISTS (SELECT 1 FROM pscm_purchase_items sibling WHERE sibling.purchaseOrderId = i.purchaseOrderId) AS taskOrder,
        CASE WHEN EXISTS (
          SELECT 1 FROM pscm_fulfillment_issues f
          WHERE f.purchaseOrderItemId = i.id AND f.deliveryDocumentId = d.id AND f.deliveryNumber = d.deliveryNumber
            AND f.lotId = t.lotId AND f.quantity = t.quantity
        ) THEN m.sequence ELSE NULL END AS sequence,
        l.id AS originLotId, t.quantity, a.id AS allocationId,
        a.quantity AS allocatedQuantity, a.allocatedCostTotal AS allocatedValue,
        a.lotIssueUnitCostSnapshot AS lotUnitCost,
        (i.status = 'delivered_to_requester' OR i.deliveredAt IS NOT NULL OR i.deliveryNumber IS NOT NULL
          OR EXISTS (SELECT 1 FROM pscm_fulfillment_issues f WHERE f.purchaseOrderItemId = i.id)) AS requiresMovement
      FROM purchase_order_items i
      LEFT JOIN pscm_purchase_items m ON m.purchaseOrderItemId = i.id AND m.purchaseOrderId = i.purchaseOrderId AND m.taskId > 0
      LEFT JOIN inventory_transactions t ON t.purchaseOrderItemId = i.id AND t.type = 'out' AND t.transactionType = 'delivery'
      LEFT JOIN delivery_documents d ON d.inventoryTransactionId = t.id AND d.poItemId = i.id
        AND d.inventoryId = t.inventoryId AND d.lotId = t.lotId AND d.quantity = t.quantity
      LEFT JOIN inventory_lots l ON l.id = t.lotId AND l.sourceType = 'receipt'
        AND l.purchaseOrderItemId = i.id AND l.purchaseOrderId = i.purchaseOrderId
      LEFT JOIN inventory_issue_cost_allocations a ON a.inventoryTransactionId = t.id AND a.inventoryId = t.inventoryId
        AND a.lotId = t.lotId AND a.deliveryNumber = d.deliveryNumber
      WHERE i.purchaseOrderId IN (${idsSql(ids)})
      ORDER BY i.purchaseOrderId, t.id`
        )
    );
    const directCandidates = new Set(
      movements
        .filter(row => row.documentId && !Number(row.taskOrder))
        .map(row => row.purchaseId)
    );
    const direct = await directProjectOrders(
      tx,
      orders.filter(order => directCandidates.has(order.id)),
      instanceId
    );
    const returns = await readScopeChunks(
      movements.flatMap(row =>
        row.documentId == null ? [] : [row.documentId]
      ),
      ids =>
        readRows<{ documentId: number; quantity: Decimal; unposted: Decimal }>(
          tx,
          sql`
        SELECT d.id AS documentId, SUM(r.returnedQuantity) AS quantity,
          SUM(CASE WHEN r.inventoryId = d.inventoryId AND r.lotId = d.lotId AND EXISTS (
            SELECT 1 FROM inventory_transactions t
            WHERE t.purchaseOrderItemId = d.poItemId AND t.inventoryId = r.inventoryId AND t.lotId = r.lotId
              AND t.returnId = r.id AND t.type = 'in' AND t.transactionType = 'return'
          ) THEN 0 ELSE 1 END) AS unposted
        FROM warehouse_returns r
        INNER JOIN delivery_documents d ON d.id = r.sourceDeliveryDocumentId
        WHERE r.sourceDeliveryDocumentId IN (${idsSql(ids)})
        GROUP BY d.id`
        )
    );
    const returnByDelivery = new Map(returns.map(row => [row.documentId, row]));
    const posted = movements.filter(row => row.transactionId != null);
    const byTransaction = groupReadRows(posted, row => row.transactionId!);
    const deliveryCounts = new Map<string, number>();
    const transactions = Array.from(byTransaction.values());
    for (const transaction of transactions) {
      const numbers = new Set(
        transaction.flatMap(row => (row.number ? [row.number] : []))
      );
      numbers.forEach(number =>
        deliveryCounts.set(number, (deliveryCounts.get(number) ?? 0) + 1)
      );
    }
    for (const row of movements) {
      if (row.transactionId == null && Number(row.requiresMovement))
        requisitions.get(row.purchaseId)!.complete = false;
    }
    for (const transaction of transactions) {
      const [row] = transaction;
      const requisition = requisitions.get(row.purchaseId)!;
      const returned =
        row.documentId == null
          ? undefined
          : returnByDelivery.get(row.documentId);
      const allocationIds = new Set(
        transaction.map(entry => entry.allocationId)
      );
      if (
        row.documentId == null ||
        !row.number ||
        deliveryCounts.get(row.number) !== 1 ||
        row.originLotId == null ||
        (row.sequence == null && !direct.has(row.purchaseId)) ||
        row.quantity == null ||
        allocationIds.has(null) ||
        allocationIds.size !== transaction.length ||
        transaction.some(
          entry =>
            entry.documentId !== row.documentId ||
            entry.allocatedQuantity == null
        ) ||
        (returned && Number(returned.unposted) !== 0)
      ) {
        requisition.complete = false;
        continue;
      }
      const amounts = materialAllocationCents({
        quantity: row.quantity,
        allocations: transaction.map(entry => ({
          quantity: entry.allocatedQuantity!,
          allocatedValue: entry.allocatedValue,
          lotUnitCost: entry.lotUnitCost,
        })),
        returnedQuantity: returned?.quantity ?? 0,
      });
      if (!amounts) {
        requisition.complete = false;
        continue;
      }
      requisition.deliveries.push({
        number: row.number,
        sequence: row.sequence,
        ...amounts,
      });
    }
    return { requisitions: Array.from(requisitions.values()) };
  });
}

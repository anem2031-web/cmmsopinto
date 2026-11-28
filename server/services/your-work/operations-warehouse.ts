import { sql } from "drizzle-orm";
import { canWarehouseHandOverExternalAsset, canWarehouseReceiveExternalAsset, canWarehouseReprepareExternalAsset } from "../../../shared/externalMaintenanceWorkflow";
import { canProcessOperationalIssue, type OperationalLine } from "../../../shared/operational-issues";
import { allocateOperationalFifo, dispatchContext } from "../../../shared/operational-dispatch";
import { operationalIssuesEnabled } from "../operational-issues/feature";
import { loadOperationalStock, operationalPurchaseReady } from "../operational-issues/stock-procurement";
import { applyOperationalReplacementStock, loadOperationalReplacements, replacementStockLines } from "../operational-issues/replacement";
import { readScopeChunks } from "../../_core/authz/read-batch";
import type { YourWorkItem } from "../../../shared/your-work";
import { operationCapability, operationIds, operationItem, operationRows, type OperationsActor, type OperationsDatabase } from "./operations-port";

export function classifyExternalOperations(actor: OperationsActor, rows: any[]): YourWorkItem[] {
  if (!["warehouse", "owner", "admin"].includes(actor.role)) return [];
  return rows.flatMap(row => {
    let action: YourWorkItem["action"] | null = null, arrivedAt: any = null;
    if (!row.jobId && row.itemPath === "C" && row.itemStatus === "work_approved") { action = "external_prepare"; arrivedAt = row.itemApprovedAt; }
    else if (row.itemPath === "C" && row.itemStatus === "work_approved" && canWarehouseReprepareExternalAsset({ ...row, status: row.jobStatus }) && row.jobStatus !== "waiting_delegate_receipt") {
      action = "external_prepare"; arrivedAt = row.delegateReceiptStatus === "rejected" ? row.delegateReceiptAtMs : null;
    } else if (canWarehouseReceiveExternalAsset(row.jobStatus)) { action = "external_receive"; arrivedAt = row.gateEntryAt; }
    else if (canWarehouseHandOverExternalAsset(row.jobStatus) && row.assignedToId) { action = "external_handover"; arrivedAt = row.receivedAt; }
    const path = action === "external_prepare" ? "externalMaintenance.prepareByWarehouse" : action === "external_receive" ? "externalMaintenance.receiveByWarehouse" : "externalMaintenance.handoverByWarehouse";
    if (!action || !operationCapability(actor, path)) return [];
    return [operationItem({ key: `external:${row.jobId || `item-${row.itemId}`}:${action}`, kind: "external", reference: row.ticketNumber,
      title: row.purchaseTitle || row.assetName || row.title, action,
      href: `/external-maintenance?${row.jobId ? `workJob=${row.jobId}` : `workItem=${row.itemId}`}`, arrivedAt })];
  });
}

export async function readOperationalIssueOperations(db: OperationsDatabase, actor: OperationsActor): Promise<YourWorkItem[]> {
  if (!canProcessOperationalIssue(actor.role) || !operationalIssuesEnabled()) return [];
  const orders = await operationRows(db, sql`/* your-work:operational-orders */ SELECT o.id,o.orderNumber,o.reason,o.status,
    UNIX_TIMESTAMP(o.createdAt)*1000 AS createdAtMs,
    (SELECT UNIX_TIMESTAMP(a.createdAt)*1000 FROM audit_logs a WHERE a.entityType='operational_issue' AND a.entityId=o.id AND a.action='operational_issue_approved' ORDER BY a.id DESC LIMIT 1) AS approvedAt
    FROM operational_issue_orders o WHERE o.status IN ('pending','approved') ORDER BY o.id`);
  const result = orders.filter(row => row.status === "pending" && operationCapability(actor, "operationalIssues.approve")).map(row => operationItem({
    key: `operational:${row.id}:approve`, kind: "operational", reference: row.orderNumber, title: row.reason, action: "operational_approve",
    href: `/scheduled-maintenance/warehouse-requests?source=operational&orderId=${row.id}`, arrivedAt: row.createdAtMs,
  }));
  const approved = orders.filter(row => row.status === "approved");
  if (!approved.length) return result;
  const lines = await readScopeChunks(approved.map(row => Number(row.id)), ids => operationRows(db, sql`/* your-work:operational-lines */ SELECT i.*,
    COALESCE((SELECT SUM(d.quantity) FROM operational_issue_deliveries d WHERE d.orderItemId=i.id),0) AS issuedQuantity,
    c.id AS activeCatalogItemId,
    EXISTS (SELECT 1 FROM sections s INNER JOIN sites t ON t.id=s.siteId
      WHERE s.id=COALESCE(JSON_UNQUOTE(JSON_EXTRACT(i.dispatchContext,'$.sectionId')),o.sectionId)
      AND t.id=COALESCE(JSON_UNQUOTE(JSON_EXTRACT(i.dispatchContext,'$.siteId')),o.siteId)) AS validDestination,
    EXISTS (SELECT 1 FROM catalog_units u WHERE u.isActive<>1 AND (LOWER(TRIM(u.nameAr))=LOWER(TRIM(i.unit)) OR LOWER(TRIM(u.nameEn))=LOWER(TRIM(i.unit)))) AS inactiveUnit
    FROM operational_issue_items i INNER JOIN operational_issue_orders o ON o.id=i.orderId AND o.status='approved'
    LEFT JOIN catalog_items c ON c.id=i.catalogItemId AND c.isActive=1 WHERE i.orderId IN (${operationIds(ids)})`)) as Array<OperationalLine & { activeCatalogItemId?: number; validDestination?: number; inactiveUnit?: number }>;
  const replacements = await loadOperationalReplacements(db, lines);
  // Match the original detail reader: replacement deliveries are expressed in the original requirement's unit.
  for (const line of lines) if (replacements.has(Number(line.id))) line.issuedQuantity = replacements.get(Number(line.id))!.issued;
  const procurementReady = await operationalPurchaseReady(db);
  const linked = procurementReady && lines.length ? await readScopeChunks(lines.map(line => Number(line.id)), ids => operationRows(db, sql`/* your-work:operational-purchase-links */ SELECT k.orderItemId
    FROM operational_issue_purchase_links k INNER JOIN purchase_orders p ON p.id=k.purchaseOrderId
    INNER JOIN purchase_order_items j ON j.id=k.purchaseOrderItemId AND j.purchaseOrderId=p.id
    WHERE k.orderItemId IN (${operationIds(ids)}) AND p.status<>'rejected' AND j.status NOT IN ('cancelled','rejected','purchase_cancelled')`)) : [];
  const linkedIds = new Set(linked.map(row => Number(row.orderItemId)));
  const current: any[] = [];
  const groups = new Map<number, OperationalLine[]>();
  for (const line of lines) { const warehouseId = dispatchContext(line.dispatchContext)?.warehouseId || 0; const group = groups.get(warehouseId) || []; group.push(line); groups.set(warehouseId, group); }
  for (const [warehouseId, group] of Array.from(groups.entries())) {
    const stock = await readScopeChunks(group.map(line => Number(line.id)), ids => loadOperationalStock(db, group.filter(line => ids.includes(Number(line.id))), false, warehouseId || undefined));
    const groupIds = new Set(group.map(line => Number(line.id)));
    const groupReplacements = new Map(Array.from(replacements.entries()).filter(([lineId]) => groupIds.has(lineId)));
    const substitutes = replacementStockLines(groupReplacements), substituteStock: any[] = [];
    for (let offset = 0; offset < substitutes.length; offset += 500)
      substituteStock.push(...await loadOperationalStock(db, substitutes.slice(offset, offset + 500), false, warehouseId || undefined));
    current.push(...applyOperationalReplacementStock(stock, substituteStock, groupReplacements));
  }
  for (const order of approved) {
    const orderLines = lines.filter(line => Number(line.orderId) === Number(order.id));
    const left = orderLines.filter(line => Number(line.quantity) > Number(line.issuedQuantity));
    if (!left.length) continue;
    const prepared = orderLines.some(line => line.dispatchContext != null);
    const ready = left.filter(line => {
      const available = current.find(item => Number(item.itemId) === Number(line.id));
      if (!available || available.needsReview) return false;
      try { return allocateOperationalFifo(available, Number(line.quantity) - Number(line.issuedQuantity)).length > 0; }
      catch { return false; }
    });
    if ((prepared ? ready.length === left.length : ready.length > 0) && operationCapability(actor, prepared ? "operationalIssues.issuePrepared" : "operationalIssues.issue"))
      result.push(operationItem({ key: `operational:${order.id}:issue`, kind: "operational", reference: order.orderNumber, title: order.reason,
        action: "operational_issue", href: `/scheduled-maintenance/warehouse-requests?source=operational&orderId=${order.id}`, arrivedAt: null }));
    if (procurementReady && operationCapability(actor, "operationalIssues.addToPurchaseDraft")) for (const line of left) {
      const stock = current.find(item => Number(item.itemId) === Number(line.id));
      const remaining = Number(line.quantity) - Number(line.issuedQuantity);
      if (!stock || stock.needsReview || !Number.isInteger(remaining) || remaining < 1 || stock.totalQuantity >= remaining
        || linkedIds.has(Number(line.id)) || Number(line.activeCatalogItemId) !== Number(line.catalogItemId) || !Number(line.validDestination) || Number(line.inactiveUnit)) continue;
      result.push(operationItem({ key: `operational:${order.id}:purchase:${line.id}`, kind: "operational", reference: order.orderNumber, title: line.itemName,
        action: "operational_purchase", href: `/scheduled-maintenance/warehouse-requests?source=operational&orderId=${order.id}&workLine=${line.id}`, arrivedAt: null }));
    }
  }
  return result;
}

export async function readWarehouseOperations(db: OperationsDatabase, actor: OperationsActor): Promise<YourWorkItem[]> {
  if (!["warehouse", "owner", "admin"].includes(actor.role)) return [];
  const [external, operational] = await Promise.all([
    operationRows(db, sql`/* your-work:external */ SELECT t.id AS ticketId,t.ticketNumber,t.title,t.assignedToId,i.id AS itemId,i.status AS itemStatus,i.maintenancePath AS itemPath,UNIX_TIMESTAMP(i.approvedAt)*1000 AS itemApprovedAt,
      j.id AS jobId,j.status AS jobStatus,j.assetName,j.purchaseTitle,j.purchaseOrderId,j.gateExitApprovedAt,j.delegateReceiptStatus,j.preparationRevision,j.delegateId,j.delegateReceiptById,j.delegateReceiptAt,j.warehousePreparedAt,
      UNIX_TIMESTAMP(j.delegateReceiptAt)*1000 AS delegateReceiptAtMs,UNIX_TIMESTAMP(j.gateEntryApprovedAt)*1000 AS gateEntryAt,UNIX_TIMESTAMP(j.warehouseReceivedAt)*1000 AS receivedAt
      FROM ticket_items i INNER JOIN tickets t ON t.id=i.ticketId LEFT JOIN external_maintenance_jobs j ON j.ticketId=t.id AND (j.ticketItemId=i.id OR (j.ticketItemId IS NULL AND i.itemNumber=1))
      WHERE (j.id IS NULL AND i.maintenancePath='C' AND i.status='work_approved') OR (j.status IN ('waiting_warehouse_preparation','waiting_gate_exit','waiting_warehouse_receipt','waiting_technician_handover'))`),
    readOperationalIssueOperations(db, actor),
  ]);
  return [...classifyExternalOperations(actor, external), ...operational];
}

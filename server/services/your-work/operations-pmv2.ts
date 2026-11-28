import { sql } from "drizzle-orm";
import { canRoleAccessPmv2Warehouse, PMV2_ALL_TEAM_EXECUTION_ROLES, PMV2_TECHNICIAN_EXECUTION_ROLES } from "../../../shared/roles";
import type { YourWorkItem } from "../../../shared/your-work";
import { assertPmv2UnitApprovalUntouched } from "../../pmv2/materials/catalog-unit-policy";
import { pendingPurchaseCoverageQuantity } from "../../pmv2/materials/specification-purchase-coverage";
import { filterSpecificationLots, loadEmergencyHolds } from "../purchase-specification-guards";
import { readScopeChunks, groupReadRows } from "../../_core/authz/read-batch";
import { listPmv2Members } from "../../pmv2/security/team-membership-list";
import { isPmv2SimplifiedEnabled } from "../../pmv2/simplified/feature";
import { operationRows, operationItem, operationIds, operationCapability, type OperationsActor, type OperationsDatabase } from "./operations-port";

type Support = {
  filterLots: (db: any, rows: any[]) => Promise<any[]>;
  heldItems: (db: any, ids: number[]) => Promise<Set<number>>;
  replacements: (db: any, ids: number[]) => Promise<Map<number, any[]>>;
  replacementStock: (db: any, replacements: any[], warehouseIds: number[]) => Promise<Map<string, any>>;
  plan: (input: any) => any;
};
const defaults = async (): Promise<Support> => {
  const coverage = await import("../../pmv2/materials/replacement-coverage");
  return { filterLots: (db, rows) => filterSpecificationLots(db, rows, row => Number(row.lotId)), heldItems: loadEmergencyHolds,
    replacements: (db, ids) => ids.length ? coverage.loadPmv2Replacements(db, ids) : Promise.resolve(new Map()),
    replacementStock: coverage.loadPmv2ReplacementStock, plan: coverage.planPmv2Fulfillment };
};
const parse = (value: unknown): any | null => { try { const note = typeof value === "string" ? JSON.parse(value) : value; return note && typeof note === "object" && note.version != null ? note : null; } catch { return null; } };
const unit = (value: any) => String(value || "").trim().toLocaleLowerCase();
const amount = (value: any) => Number(Math.max(0, Number(value || 0)).toFixed(3));
const stockKey = (warehouseId: any, catalogItemId: any) => `${Number(warehouseId)}:${Number(catalogItemId)}`;
const originalAmount = (note: any) => Number(note.originalQuantity ?? note.quantity ?? 0);
function localized(row: any, actor: OperationsActor) {
  return actor.preferredLanguage === "en" ? row.nameEn || row.itemNameSnapshot || row.taskItemTitle
    : actor.preferredLanguage === "ur" ? row.nameUr || row.itemNameSnapshot || row.taskItemTitle : row.nameAr || row.itemNameSnapshot || row.taskItemTitle;
}
export function pendingPmv2ReturnAmount(declaration: any, issues: any[], linked: any[]): number {
  if (!declaration || declaration.version !== 1 || !(Number(declaration.routeDecisionActionId) > 0) || !(Number(declaration.catalogItemId) > 0)) return 0;
  const parts = issues.filter(row => row.version === 2 && Number(row.routeDecisionActionId) === Number(declaration.routeDecisionActionId));
  const used = new Map<number, number>((declaration.physicalUsages || []).map((part: any) => [Number(part.deliveryDocumentId), Number(part.usedQuantity)]));
  const required = declaration.physicalMode ? parts.reduce((sum, part) => sum + Number(part.quantity || 0) - (used.get(Number(part.deliveryDocumentId)) || 0), 0) : Number(declaration.toReturnQuantity || 0);
  const returned = linked.reduce((sum, part) => sum + Number(declaration.physicalMode ? part.quantity : part.originalQuantity ?? part.quantity ?? 0), 0);
  return amount(required - returned);
}

/** Scoped PMV2 warehouse projections. No call to the historical per-row queue readers. */
export async function readPmv2Operations(db: OperationsDatabase, actor: OperationsActor, support?: Support): Promise<YourWorkItem[]> {
  if (!canRoleAccessPmv2Warehouse(actor.role)) return [];
  const tables = await operationRows(db, sql`/* your-work:pmv2-schema */ SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()
    AND TABLE_NAME IN ('pmv2_material_requests','pmv2_material_request_items','pmv2_task_items','pmv2_tasks','pmv2_teams','pmv2_item_actions')`);
  if (!tables.length) return []; // PMV2 has not been installed in this environment.
  if (tables.length !== 6) throw Error("جداول الصيانة المجدولة غير مكتملة");
  const [waiting, routes, declarations] = await Promise.all([
    operationRows(db, sql`/* your-work:pmv2-waiting */ SELECT n.id AS requestItemId,n.requestId,n.catalogItemId,n.itemNameSnapshot,n.unitSnapshot,n.requestedQuantity,n.receivedWarehouseQuantity,n.issuedToTeamQuantity,
      EXISTS (SELECT 1 FROM pmv2_material_usages mu WHERE mu.materialRequestItemId=n.id) AS hasUsage,
      UNIX_TIMESTAMP(r.createdAt)*1000 AS arrivedAt,r.taskItemId,r.teamWarehouseId,t.taskNumber,t.id AS taskId,c.isActive AS catalogActive,c.nameAr,c.nameEn,c.nameUr,c.unit AS catalogUnit
      FROM pmv2_material_request_items n INNER JOIN pmv2_material_requests r ON r.id=n.requestId
      INNER JOIN pmv2_task_items ti ON ti.id=r.taskItemId INNER JOIN pmv2_tasks t ON t.id=ti.taskId
      INNER JOIN pmv2_teams team ON team.id=r.teamId AND team.id=t.teamId
      INNER JOIN warehouses w ON w.id=r.teamWarehouseId AND w.isActive=1
      LEFT JOIN catalog_items c ON c.id=n.catalogItemId
      WHERE n.status='waiting_warehouse' AND ti.status='waiting_material' AND ti.result='needs_material' AND t.status NOT IN ('cancelled','completed')`),
    operationRows(db, sql`/* your-work:pmv2-routes */ SELECT a.id,a.note,a.performedById,a.taskItemId,UNIX_TIMESTAMP(a.createdAt)*1000 AS arrivedAt,
      t.id AS taskId,t.taskNumber,t.programTargetId,t.teamId,ti.titleSnapshot AS taskItemTitle,team.warehouseId,
      requester.role AS requesterRole,requester.isActive AS requesterActive,
      target.siteId,target.sectionId,target.assetId,section.id AS validSectionId,asset.siteId AS assetSiteId,asset.sectionId AS assetSectionId
      FROM pmv2_item_actions a INNER JOIN pmv2_task_items ti ON ti.id=a.taskItemId INNER JOIN pmv2_tasks t ON t.id=ti.taskId
      INNER JOIN pmv2_teams team ON team.id=t.teamId INNER JOIN warehouses w ON w.id=team.warehouseId AND w.isActive=1
      INNER JOIN pmv2_program_targets target ON target.id=t.programTargetId
      LEFT JOIN sections section ON section.id=target.sectionId LEFT JOIN assets asset ON asset.id=target.assetId
      LEFT JOIN users requester ON requester.id=a.performedById
      WHERE a.action='material_route_decision' AND ti.status='waiting_material' AND ti.result='needs_material' AND t.status NOT IN ('cancelled','completed') ORDER BY a.id DESC`),
    operationRows(db, sql`/* your-work:pmv2-declarations */ SELECT a.id,a.note,a.taskItemId,UNIX_TIMESTAMP(a.createdAt)*1000 AS arrivedAt,t.taskNumber,ti.titleSnapshot AS taskItemTitle
      FROM pmv2_item_actions a INNER JOIN pmv2_task_items ti ON ti.id=a.taskItemId INNER JOIN pmv2_tasks t ON t.id=ti.taskId
      INNER JOIN pmv2_visits v ON v.id=a.visitId AND v.taskId=t.id
      WHERE a.action='material_consumption_declared' AND NOT EXISTS (SELECT 1 FROM pmv2_item_actions done WHERE done.taskItemId=a.taskItemId AND done.action='material_return_completed'
        AND JSON_VALID(done.note) AND JSON_EXTRACT(done.note,'$.declarationActionId')=a.id)`),
  ]);
  if (!waiting.length && !routes.length && !declarations.length) return [];
  const taskIds = Array.from(new Set([...waiting, ...routes, ...declarations].map(row => Number(row.taskItemId))));
  const actions = await readScopeChunks(taskIds, ids => operationRows(db, sql`/* your-work:pmv2-actions */ SELECT id,taskItemId,action,note,UNIX_TIMESTAMP(createdAt)*1000 AS createdAtMs
    FROM pmv2_item_actions WHERE taskItemId IN (${operationIds(ids)}) AND action IN ('material_issue_linked','material_return_part_linked','material_transfer_linked','material_issue_link_pending','material_consumption_declared','material_consumption_finalized','material_return_completed') ORDER BY id DESC`));
  const actionsByTask = groupReadRows(actions, row => Number(row.taskItemId));
  const output: YourWorkItem[] = [];
  if (operationCapability(actor, "pmv2.warehouse.confirmPendingReturn")) for (const row of declarations) {
    const note = parse(row.note), entries = actionsByTask.get(Number(row.taskItemId)) || [];
    const issues = entries.filter(entry => entry.action === "material_issue_linked").map(entry => parse(entry.note)).filter(Boolean);
    const links = entries.filter(entry => entry.action === "material_return_part_linked").map(entry => parse(entry.note)).filter(part => part?.version === 1 && Number(part.declarationActionId) === Number(row.id) && part.returnId && part.sourceDeliveryDocumentId);
    if (pendingPmv2ReturnAmount(note, issues, links) > 0) output.push(operationItem({ key: `pmv2-return:${row.id}`, kind: "pmv2", reference: row.taskNumber,
      title: row.taskItemTitle, action: "material_return", href: `/scheduled-maintenance/warehouse-requests?source=pmv2&workReturn=${row.id}`, arrivedAt: row.arrivedAt }));
  }
  const latest = new Map<string, any>();
  for (const row of routes) {
    const note = parse(row.note);
    if (note?.version !== 1 || !["team_inventory", "material_request"].includes(note.route) || !(Number(note.catalogItemId) > 0) || !(Number(note.requestedQuantity) > 0)
      || Number(note.teamWarehouseId) !== Number(row.warehouseId)) continue;
    const key = stockKey(row.taskItemId, note.catalogItemId);
    if (!latest.has(key)) latest.set(key, { ...row, snapshot: note });
  }
  if (!waiting.length && !latest.size) return output;
  const requestIds = Array.from(new Set([...waiting.map(row => Number(row.requestItemId)), ...Array.from(latest.values()).map(row => Number(row.snapshot.materialRequestItemId)).filter(Boolean)]));
  const requests = await readScopeChunks(requestIds, ids => operationRows(db, sql`/* your-work:pmv2-request-state */ SELECT n.id,n.status,n.requestedQuantity,n.receivedWarehouseQuantity,n.issuedToTeamQuantity,
      EXISTS (SELECT 1 FROM pmv2_material_usages mu WHERE mu.materialRequestItemId=n.id) AS hasUsage,n.catalogItemId,n.unitSnapshot FROM pmv2_material_request_items n WHERE n.id IN (${operationIds(ids)})`));
  const requestMap = new Map(requests.map(row => [Number(row.id), row]));
  const lib = support || await defaults();
  const mainRows = waiting.length ? await operationRows(db, sql`/* your-work:pmv2-main */ SELECT id FROM warehouses WHERE type='main' AND isActive=1`) : [];
  if (waiting.length && mainRows.length !== 1) throw Error("يجب وجود مستودع رئيسي نشط واحد");
  const pairs = [...waiting.filter(row => row.catalogItemId != null).map(row => ({ warehouseId: Number(mainRows[0].id), catalogItemId: Number(row.catalogItemId) })),
    ...Array.from(latest.values()).map(row => ({ warehouseId: Number(row.warehouseId), catalogItemId: Number(row.snapshot.catalogItemId) }))];
  const distinctPairs = Array.from(new Map(pairs.map(pair => [stockKey(pair.warehouseId, pair.catalogItemId), pair])).values());
  const stocks: any[] = [];
  for (let start = 0; start < distinctPairs.length; start += 500) {
    const chunk = distinctPairs.slice(start, start + 500);
    stocks.push(...await operationRows(db, sql`/* your-work:pmv2-stock */ SELECT v.id AS inventoryId,v.warehouseId,v.linkedItemId AS catalogItemId,v.quantity AS aggregateQuantity,COALESCE(v.issueUnit,v.unit) AS unit,
      l.id AS lotId,l.lotCode,l.trackingToken,l.purchaseOrderItemId,UNIX_TIMESTAMP(l.createdAt)*1000 AS lotCreatedAt,b.quantity,c.isActive AS catalogActive,c.nameAr,c.nameEn,c.nameUr
      FROM inventory v INNER JOIN warehouses w ON w.id=v.warehouseId AND w.isActive=1 INNER JOIN catalog_items c ON c.id=v.linkedItemId
      LEFT JOIN inventory_lot_balances b ON b.inventoryId=v.id AND b.quantity>0 LEFT JOIN inventory_lots l ON l.id=b.lotId AND l.catalogItemId=v.linkedItemId
      WHERE v.isFrozen=0 AND (${sql.join(chunk.map(pair => sql`(v.warehouseId=${pair.warehouseId} AND v.linkedItemId=${pair.catalogItemId})`), sql` OR `)})`));
  }
  const actualLots = stocks.filter(row => Number(row.lotId) > 0);
  const eligibleLots = actualLots.length ? await lib.filterLots(db, actualLots) : [];
  const heads = new Map<string, Set<number>>(), firstStock = new Map<string, any>();
  for (const stock of stocks) { const key = stockKey(stock.warehouseId, stock.catalogItemId); const set = heads.get(key) || new Set<number>(); set.add(Number(stock.inventoryId)); heads.set(key, set); if (!firstStock.has(key)) firstStock.set(key, stock); }
  const lotsByStock = new Map<string, any[]>();
  for (const stock of eligibleLots) { const key = stockKey(stock.warehouseId, stock.catalogItemId), list = lotsByStock.get(key) || []; list.push(stock); lotsByStock.set(key, list); }
  const linkRows = await readScopeChunks(waiting.map(row => Number(row.requestItemId)), ids => operationRows(db, sql`/* your-work:pmv2-purchase-coverage */ SELECT k.materialRequestItemId,k.linkedQuantity,k.purchaseOrderItemId,p.status AS orderStatus,i.status AS itemStatus,
    COALESCE((SELECT SUM(ri.receivedQuantity) FROM warehouse_receipt_items ri INNER JOIN warehouse_receipts receipt ON receipt.id=ri.receiptId AND receipt.status='confirmed' WHERE ri.purchaseOrderItemId=i.id),0) AS received,
    COALESCE((SELECT SUM(ri.receivedQuantity) FROM warehouse_receipt_items ri INNER JOIN warehouse_receipts receipt ON receipt.id=ri.receiptId AND receipt.status='confirmed' WHERE ri.purchaseOrderItemId=i.id
      AND EXISTS (SELECT 1 FROM inventory_lots lot WHERE lot.receiptItemId=ri.id AND lot.specificationStatus IN ('pending','rejected'))),0) AS held,
    UNIX_TIMESTAMP(i.purchaseCancelledAt)*1000 AS cancelledAt
    FROM pmv2_material_purchase_links k INNER JOIN purchase_order_items i ON i.id=k.purchaseOrderItemId AND i.purchaseOrderId=k.purchaseOrderId
    INNER JOIN purchase_orders p ON p.id=i.purchaseOrderId WHERE k.materialRequestItemId IN (${operationIds(ids)})`));
  const holds = linkRows.length ? await lib.heldItems(db, Array.from(new Set(linkRows.map(row => Number(row.purchaseOrderItemId))))) : new Set<number>();
  const linksByRequest = groupReadRows(linkRows, row => Number(row.materialRequestItemId));
  for (const row of waiting) {
    if (!operationCapability(actor, "pmv2.warehouse.preparePurchaseHandoff")) continue;
    const remaining = amount(Number(row.requestedQuantity) - Number(row.issuedToTeamQuantity));
    if (!remaining) continue;
    const links = linksByRequest.get(Number(row.requestItemId)) || [];
    const pending = links.reduce((sum, link) => sum + pendingPurchaseCoverageQuantity(Number(link.linkedQuantity), link.orderStatus, link.itemStatus, Number(link.received), holds.has(Number(link.purchaseOrderItemId)) ? Number(link.received) : Number(link.held)), 0);
    const key = stockKey(mainRows[0].id, row.catalogItemId), matching = firstStock.get(key);
    const available = process.env.INVENTORY_LOTS_ENABLED === "true" ? (lotsByStock.get(key) || []).reduce((sum, lot) => sum + Number(lot.quantity), 0) : Number(matching?.aggregateQuantity || 0);
    const identityNeeded = row.catalogItemId == null || row.catalogUnit && unit(row.unitSnapshot) !== unit(row.catalogUnit);
    const validIdentity = Number(row.catalogActive) === 1 && (heads.get(key)?.size || 0) <= 1 && (!matching || unit(matching.unit) === unit(row.unitSnapshot));
    if (identityNeeded) {
      const route = routes.find(entry => Number(entry.taskItemId) === Number(row.taskItemId) && Number(parse(entry.note)?.materialRequestItemId) === Number(row.requestItemId));
      const snapshot = route && parse(route.note);
      if (!route || !snapshot || Number(snapshot.teamWarehouseId) !== Number(row.teamWarehouseId)
        || (row.catalogItemId == null ? snapshot.catalogItemId != null : Number(snapshot.catalogItemId) !== Number(row.catalogItemId))) continue;
      try { assertPmv2UnitApprovalUntouched({ received: Number(row.receivedWarehouseQuantity || 0), issued: Number(row.issuedToTeamQuantity || 0),
        hasProcurementOrUsage: links.length > 0 || Number(row.hasUsage) > 0, actions: actionsByTask.get(Number(row.taskItemId)) || [],
        requestItemId: Number(row.requestItemId), routeActionId: Number(route.id) }); } catch { continue; }
    }
    if (!identityNeeded && (!validIdentity || available + 0.0005 < remaining && remaining - available - pending <= 0.0005)) continue;
    const released = links.filter(link => ["rejected", "cancelled", "purchase_cancelled"].includes(link.itemStatus));
    const arrivedAt = released.length ? released.every(link => link.cancelledAt != null) ? Math.max(Number(row.arrivedAt), ...released.map(link => Number(link.cancelledAt))) : null : row.arrivedAt;
    output.push(operationItem({ key: `pmv2-material:${row.requestItemId}`, kind: "pmv2", reference: row.taskNumber, title: localized(row, actor), action: identityNeeded ? "material_resolve" : "material_provide",
      href: `/scheduled-maintenance/warehouse-requests?source=pmv2&workRequest=${row.requestId}&workRequestItem=${row.requestItemId}`, arrivedAt }));
  }
  if (!latest.size || !operationCapability(actor, "pmv2.warehouse.issueReadyRequirement")) return output;
  const replacements = await lib.replacements(db, requestIds);
  const replacementStock = await lib.replacementStock(db, Array.from(replacements.values()).flat(), Array.from(new Set(Array.from(latest.values()).map(row => Number(row.warehouseId)))));
  const teamIds = Array.from(new Set(Array.from(latest.values()).map(row => Number(row.teamId))));
  const members = isPmv2SimplifiedEnabled() ? await listPmv2Members(db, { teamIds, roles: PMV2_TECHNICIAN_EXECUTION_ROLES }) : await readScopeChunks(teamIds, ids => operationRows(db, sql`/* your-work:pmv2-members */ SELECT m.teamId,u.id AS userId FROM pmv2_team_members m INNER JOIN users u ON u.id=m.userId AND u.isActive=1 AND u.role IN ('technician','it_manager','it_member') WHERE m.isActive=1 AND m.teamId IN (${operationIds(ids)})`));
  const memberTeams = new Set(members.map(row => Number(row.teamId)));
  for (const row of Array.from(latest.values())) {
    const need = row.snapshot, request = requestMap.get(Number(need.materialRequestItemId));
    if (need.materialRequestItemId && (!request || request.status !== "issued_to_team" || Number(request.issuedToTeamQuantity) + 0.0005 < Number(request.requestedQuantity))) continue;
    const validTarget = row.assetId ? Number(row.assetSiteId) > 0 && Number(row.assetSectionId) > 0 : Number(row.validSectionId) > 0;
    const validRecipient = memberTeams.has(Number(row.teamId)) || Number(row.requesterActive) === 1 && (PMV2_ALL_TEAM_EXECUTION_ROLES as readonly string[]).includes(row.requesterRole);
    const entries = actionsByTask.get(Number(row.taskItemId)) || [];
    const issued = entries.filter(entry => entry.action === "material_issue_linked").map(entry => parse(entry.note)).filter(note => note?.version === 2 && Number(note.routeDecisionActionId) === Number(row.id) && note.deliveryDocumentId && note.catalogItemId);
    const remaining = amount(Number(need.requestedQuantity) - issued.reduce((sum, note) => sum + originalAmount(note), 0));
    if (!remaining) continue;
    const linkedNumbers = new Set(issued.map(note => note.deliveryNumber));
    const pendingRelink = entries.find(entry => { const note = parse(entry.note); return entry.action === "material_issue_link_pending" && note?.version === 1 && Number(note.routeDecisionActionId) === Number(row.id) && note.deliveryNumber && !linkedNumbers.has(note.deliveryNumber); });
    const key = stockKey(row.warehouseId, need.catalogItemId), replacementRows = replacements.get(Number(need.materialRequestItemId)) || [];
    const replacementIds = new Set(replacementRows.flatMap(({ plan }: any) => plan.lots.map((lot: any) => Number(lot.lotId))));
    const originalStock = (heads.get(key)?.size || 0) <= 1 ? (lotsByStock.get(key) || []).filter(lot => Number(lot.catalogActive) === 1 && !replacementIds.has(Number(lot.lotId)) && unit(lot.unit) === unit(need.unit)).map(lot => ({ ...lot, lotId: Number(lot.lotId), quantity: Number(lot.quantity) })) : [];
    const plan = lib.plan({ requiredOriginal: remaining, originalUnit: need.unit, originalStock,
      replacements: replacementRows.map((replacement: any) => ({ replacement, stock: replacement.plan.lots.map((lot: any) => replacementStock.get(`${row.warehouseId}:${lot.lotId}`)).filter(Boolean), alreadyAllocated: issued.filter(note => Number(note.replacementPlanId) === Number(replacement.plan.planId)).reduce((sum, note) => sum + originalAmount(note), 0) })) });
    if (!pendingRelink && (!validTarget || !validRecipient || !plan.complete)) continue;
    const transferTimes = entries.filter(entry => { const note = parse(entry.note); return entry.action === "material_transfer_linked" && Number(note?.materialRequestItemId) === Number(need.materialRequestItemId); }).map(entry => Number(entry.createdAtMs)).filter(Number.isFinite);
    const arrivedAt = pendingRelink?.createdAtMs ?? (need.materialRequestItemId ? transferTimes.length ? Math.max(...transferTimes) : null : row.arrivedAt);
    output.push(operationItem({ key: `pmv2-issue:${row.id}`, kind: "pmv2", reference: row.taskNumber, title: need.itemNameSnapshot || row.taskItemTitle, action: pendingRelink ? "material_link" : "material_issue",
      href: `/scheduled-maintenance/warehouse-requests?source=pmv2&workRequirement=${row.id}`, arrivedAt }));
  }
  return output;
}

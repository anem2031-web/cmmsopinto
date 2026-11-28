import { sql } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { YourWorkItem } from "../../../shared/your-work";
import { issued, remainingReturn, type DeliveryLink, type MaterialNeed, type Snapshot, type SupplyLink } from "../../../shared/maintenance-team-tickets/model";
import { materialStockUnitApproval, materialSupplyRemaining, materialUnitMismatch } from "../../../shared/maintenance-team-tickets/material-routing";
import { TICKET_TEAM_EXECUTION_OVERRIDE_ROLES } from "../../../shared/maintenance-team-tickets/execution-permissions";
import { TicketTeamAssignmentService } from "../../maintenance-team-tickets/assignment/service";
import { SqlTicketTeamAssignmentRepository, type TicketPromotionPort } from "../../routers/maintenance-teams/assignment.repository";
import { ticketTeamQueueScope } from "../../routers/maintenance-teams/assignment-read-scope";
import type { TeamDatabase } from "../../routers/maintenance-teams/repository";
import { readScopeChunks, groupReadRows } from "../../_core/authz/read-batch";
import { filterSpecificationLots } from "../purchase-specification-guards";
import { loadEmergencyItemStates } from "../emergency-purchases/service";
import { exactOriginalAllocation, limitReplacementSourceCoverage, loadReplacementFulfillments, replacementAllocationQuantum,
  replacementPhysicalToOriginal, representableReplacementAllocation, type ReplacementFulfillment } from "../../supplier-return-followup/fulfillment";
import { operationRows, operationIds, operationItem, operationCapability, type OperationsDatabase, type OperationsActor } from "./operations-port";

type Support = {
  filterLots(db: any, rows: any[]): Promise<any[]>;
  replacements(db: any, ids: number[]): Promise<Map<number, ReplacementFulfillment[]>>;
  emergencies(db: any, ids: number[]): Promise<Map<number, { approved: boolean }>>;
};
const defaults: Support = {
  filterLots: (db, rows) => filterSpecificationLots(db, rows, row => Number(row.lotId)),
  replacements: loadReplacementFulfillments,
  emergencies: loadEmergencyItemStates,
};
const num = (value: any) => Number(value || 0);
const amount = (value: number) => Math.round(value * 1000) / 1000;
const key = (warehouseId: number, catalogItemId: number) => `${warehouseId}:${catalogItemId}`;
const closed = (row: any) => ["closed", "verified", "requester_confirmed", "cancelled", "rejected"].includes(row.itemStatus)
  || ["closed", "cancelled", "rejected"].includes(row.sourceStatus);

/** Reuse the warehouse queue's authorized hydration on an already scoped header
 * chunk. Its LIMIT 200 is a screen limit, not a limit on personal work counts.
 * Only that first header read is supplied locally; all subsequent reads remain
 * the production repository's unchanged, bounded material queries. */
async function warehouseQueueChunk(db: OperationsDatabase, actor: OperationsActor, headers: any[]) {
  let headerRead = true;
  const snapshotDb = { execute: async (statement: any) => {
    if (headerRead) {
      const query = new MySqlDialect().sqlToQuery(statement).sql;
      if (!/^SELECT a\.id AS assignmentId,a\.ticketId,a\.ticketNumber,/.test(query)) throw Error("تغير مصدر قائمة مواد التذاكر؛ يلزم مراجعة ربط الأعمال");
      headerRead = false; return [headers, []];
    }
    return db.execute(statement);
  } } as unknown as TeamDatabase;
  const repository = new SqlTicketTeamAssignmentRepository(async () => ({ db: snapshotDb, tickets: {} as TicketPromotionPort }));
  return new TicketTeamAssignmentService(repository).warehouseRequests({ id: actor.id, role: actor.role, active: true });
}

/** A read-only projection of the three ticket-material queues. It does not call
 * details/loadExecution (per-record queries) or any supply/receipt writer. */
export async function readTicketMaterialOperations(db: OperationsDatabase, actor: OperationsActor, support: Support = defaults): Promise<YourWorkItem[]> {
  if (!actor.isActive || !["warehouse", "owner", "admin"].includes(actor.role)) return [];
  const canProvide = operationCapability(actor, "ticketTeamExecution.provide");
  const canResolve = operationCapability(actor, "ticketTeamExecution.resolve");
  const canIssue = operationCapability(actor, "ticketTeamExecution.issue");
  const canReturn = operationCapability(actor, "ticketTeamExecution.returnMaterial");
  if (!canProvide && !canResolve && !canIssue && !canReturn) return [];
  const managementActor = { id: actor.id, role: actor.role, active: true };
  const headers = await operationRows(db, sql`/* your-work:ticket-material-heads */
    SELECT a.id AS assignmentId,a.ticketId,a.ticketItemId,a.ticketNumber,a.titleSnapshot AS title,a.teamId,a.warehouseId,a.materialRound,
      t.name AS teamName,t.isActive AS teamActive,w.nameAr AS warehouseName,w.isActive AS warehouseActive,a.stage,k.status AS sourceStatus,i.status AS itemStatus,
      s.name AS siteName,c.name AS sectionName,k.description,
      EXISTS (SELECT 1 FROM users recipient WHERE recipient.isActive=1 AND (recipient.role IN (${sql.join(TICKET_TEAM_EXECUTION_OVERRIDE_ROLES.map(role => sql`${role}`), sql`,`)})
        OR (EXISTS (SELECT 1 FROM maintenance_team_members member WHERE member.teamId=a.teamId AND member.userId=recipient.id AND member.isActive=1)
          AND (recipient.role='technician' OR (recipient.role IN ('it_manager','it_member') AND k.assignedToId=recipient.id AND k.maintenanceResponsibleDepartment='maintenance_report_department_it'))))) AS hasRecipient
    FROM ticket_team_assignments a INNER JOIN maintenance_teams t ON t.id=a.teamId
    INNER JOIN tickets k ON k.id=a.ticketId AND k.workflowModel='sub_ticket'
    INNER JOIN ticket_items i ON i.id=a.ticketItemId AND i.ticketId=a.ticketId
    LEFT JOIN warehouses w ON w.id=a.warehouseId LEFT JOIN sites s ON s.id=a.siteId LEFT JOIN sections c ON c.id=a.sectionId
    WHERE ${ticketTeamQueueScope(managementActor)} AND EXISTS (SELECT 1 FROM ticket_team_material_needs n WHERE n.assignmentId=a.id
      AND ((a.stage='waiting_material' AND n.materialRound=a.materialRound) OR n.usedQuantity IS NOT NULL
        OR EXISTS (SELECT 1 FROM ticket_team_delivery_links d WHERE d.needId=n.id AND d.usedQuantity IS NOT NULL AND d.issuedQuantity>d.usedQuantity+d.returnedQuantity)))
    ORDER BY a.id`);
  if (!headers.length) return [];
  const headerMap = new Map(headers.map(row => [num(row.assignmentId), row]));
  const ids = Array.from(headerMap.keys());
  const [queue, rawNeeds, actionRows, deliveryRows, sourceRows] = await Promise.all([
    readScopeChunks(ids, chunk => warehouseQueueChunk(db, actor, chunk.map(id => headerMap.get(id)!))),
    readScopeChunks(ids, chunk => operationRows(db, sql`/* your-work:ticket-material-needs */ SELECT n.*,
      UNIX_TIMESTAMP(n.createdAt)*1000 AS requestAt,c.unit AS catalogUnit,c.isActive AS catalogActive,c.nameAr,c.nameEn,c.nameUr,
      EXISTS (SELECT 1 FROM catalog_units u WHERE u.isActive=0 AND (u.nameAr=c.unit OR u.nameEn=c.unit)) AS inactiveUnit
      FROM ticket_team_material_needs n LEFT JOIN catalog_items c ON c.id=n.catalogItemId WHERE n.assignmentId IN (${operationIds(chunk)})`)),
    readScopeChunks(ids, chunk => operationRows(db, sql`/* your-work:ticket-material-actions */ SELECT id,assignmentId,kind,note,revision,
      UNIX_TIMESTAMP(createdAt)*1000 AS arrivedAt FROM ticket_team_actions WHERE assignmentId IN (${operationIds(chunk)})
      AND kind IN ('needs_material','material_resolved','fixed') ORDER BY assignmentId,revision DESC`)),
    readScopeChunks(ids, chunk => operationRows(db, sql`/* your-work:ticket-material-deliveries */ SELECT d.* FROM ticket_team_delivery_links d
      INNER JOIN ticket_team_material_needs n ON n.id=d.needId WHERE n.assignmentId IN (${operationIds(chunk)})`)),
    readScopeChunks(ids, chunk => operationRows(db, sql`/* your-work:ticket-material-sources */ SELECT l.*,UNIX_TIMESTAMP(l.createdAt)*1000 AS sourceAt,
      p.status AS purchaseStatus,p.catalogItemId AS purchaseCatalogItemId,p.unit AS purchaseUnit,p.receivedQuantity,UNIX_TIMESTAMP(p.receivedAt)*1000 AS receivedAt,
      UNIX_TIMESTAMP(p.purchaseCancelledAt)*1000 AS cancelledAt,o.status AS orderStatus,o.ticketId AS purchaseTicketId,o.ticketItemId AS purchaseTicketItemId,t.lotId AS transferLotId,
      UNIX_TIMESTAMP(t.createdAt)*1000 AS transferAt FROM ticket_team_supply_links l INNER JOIN ticket_team_material_needs n ON n.id=l.needId
      LEFT JOIN purchase_order_items p ON l.sourceKind='purchase' AND p.id=l.sourceId LEFT JOIN purchase_orders o ON o.id=p.purchaseOrderId
      LEFT JOIN warehouse_transfers t ON l.sourceKind='transfer' AND t.id=l.sourceId WHERE n.assignmentId IN (${operationIds(chunk)})`)),
  ]);
  const queueMap = new Map(queue.map(row => [num(row.assignmentId), row]));
  const actions = actionRows.map(row => ({ ...row, assignmentId: num(row.assignmentId), revision: num(row.revision) })) as Snapshot["actions"] & any[];
  const actionsByAssignment = groupReadRows(actions, row => num(row.assignmentId));
  const needMap = new Map<number, MaterialNeed>(rawNeeds.map(row => [num(row.id), {
    id: num(row.id), assignmentId: num(row.assignmentId), catalogItemId: row.catalogItemId == null ? null : num(row.catalogItemId), name: row.itemNameSnapshot,
    originalName: row.originalItemName, unit: row.unitSnapshot, requested: num(row.requestedQuantity), requestedById: num(row.requestedById), warehouseId: num(row.warehouseId),
    round: num(row.materialRound), used: row.usedQuantity == null ? null : num(row.usedQuantity),
  }]));
  const sourceIds = Array.from(new Set(sourceRows.filter(row => row.sourceKind === "purchase").map(row => num(row.sourceId))));
  const [replacements, emergencies, mainWarehouses] = await Promise.all([
    support.replacements(db as any, sourceIds), support.emergencies(db, sourceIds),
    operationRows(db, sql`/* your-work:ticket-material-main */ SELECT id,isActive FROM warehouses WHERE type='main' AND isActive=1`),
  ]);
  const plansByNeed = new Map<number, ReplacementFulfillment[]>();
  for (const source of sourceRows.filter(row => row.sourceKind === "purchase")) {
    const need = needMap.get(num(source.needId))!, header = headerMap.get(need.assignmentId)!;
    if (num(source.purchaseTicketId) !== num(header.ticketId) || num(source.purchaseTicketItemId) !== num(header.ticketItemId))
      throw Error("مرجع شراء مواد الفريق غير مطابق للبلاغ");
    const plans = limitReplacementSourceCoverage(replacements.get(num(source.sourceId)) || [], String(source.linkedQuantity));
    for (const plan of plans) if (plan.sourceCatalogItemId !== need.catalogItemId || plan.originalUnit !== need.unit
      || plan.sourceTicketId !== num(header.ticketId) || plan.sourceTicketItemId !== num(header.ticketItemId)) throw Error("تعويض المورد لا يطابق احتياج الفريق");
    plansByNeed.set(need.id, [...(plansByNeed.get(need.id) || []), ...plans]);
  }
  const pairMap = new Map<string, { warehouseId: number; catalogItemId: number }>();
  for (const need of Array.from(needMap.values())) for (const warehouseId of [need.warehouseId, ...mainWarehouses.map(row => num(row.id))])
    for (const catalogItemId of [need.catalogItemId, ...(plansByNeed.get(need.id) || []).map(plan => plan.catalogItemId)]) if (catalogItemId != null)
      pairMap.set(key(warehouseId, catalogItemId), { warehouseId, catalogItemId });
  const pairs = Array.from(pairMap.values()), stocks: any[] = [];
  for (let start = 0; start < pairs.length; start += 500) stocks.push(...await operationRows(db, sql`/* your-work:ticket-material-stock */
    SELECT v.id AS inventoryId,v.warehouseId,v.linkedItemId AS catalogItemId,v.quantity AS aggregateQuantity,v.isFrozen,
      COALESCE(NULLIF(v.issueUnit,''),v.unit) AS unit,l.id AS lotId,l.purchaseOrderItemId,l.specificationStatus,b.quantity,
      COALESCE(NULLIF(l.issueUnit,''),NULLIF(v.issueUnit,''),v.unit) AS lotUnit,c.isActive AS catalogActive,
      EXISTS (SELECT 1 FROM catalog_units u WHERE u.isActive=0 AND (u.nameAr=c.unit OR u.nameEn=c.unit)) AS inactiveUnit
    FROM inventory v INNER JOIN warehouses w ON w.id=v.warehouseId AND w.isActive=1 INNER JOIN catalog_items c ON c.id=v.linkedItemId
    LEFT JOIN inventory_lot_balances b ON b.inventoryId=v.id AND b.quantity>0 LEFT JOIN inventory_lots l ON l.id=b.lotId AND l.catalogItemId=v.linkedItemId
    WHERE (${sql.join(pairs.slice(start, start + 500).map(pair => sql`(v.warehouseId=${pair.warehouseId} AND v.linkedItemId=${pair.catalogItemId})`), sql` OR `)})`));
  const lots = stocks.filter(row => num(row.lotId) > 0), eligible = lots.length ? await support.filterLots(db, lots) : [];
  const groupStock = (rows: any[]) => {
    const result = new Map<string, any[]>();
    for (const row of rows) { const id = key(num(row.warehouseId), num(row.catalogItemId)), list = result.get(id) || []; list.push(row); result.set(id, list); }
    return result;
  };
  const stockHeads = groupStock(stocks), stockLots = groupStock(eligible);
  function stock(warehouseId: number, catalogItemId: number, unit: string) {
    const k = key(warehouseId, catalogItemId), headers = stockHeads.get(k) || [], first = headers[0];
    if (!first || new Set(headers.map(row => num(row.inventoryId))).size !== 1 || num(first.isFrozen) || num(first.catalogActive) !== 1 || num(first.inactiveUnit) || first.unit !== unit)
      return { available: 0, lots: [] as any[] };
    const rows = (stockLots.get(k) || []).filter(row => row.lotUnit === unit);
    return { available: Math.max(0, Math.min(Math.floor(num(first.aggregateQuantity)), rows.reduce((sum, lot) => sum + Math.floor(num(lot.quantity)), 0))), lots: rows };
  }
  const deliveries: DeliveryLink[] = deliveryRows.map(row => {
    const need = needMap.get(num(row.needId))!, approval = materialStockUnitApproval(actions, need);
    const converted = approval?.deliveryIds.includes(num(row.id)) ? approval : undefined;
    const plan = (plansByNeed.get(need.id) || []).find(plan => plan.lots.some(lot => lot.lotId === num(row.lotId)));
    return { id: num(row.id), needId: need.id, deliveryId: num(row.deliveryDocumentId), deliveryNumber: row.deliveryNumber, lotId: num(row.lotId),
      inventoryTransactionId: num(row.inventoryTransactionId), quantity: num(row.issuedQuantity), receivedById: num(row.receivedById),
      used: row.usedQuantity == null ? null : num(row.usedQuantity), returned: num(row.returnedQuantity),
      ...(converted ? { originalEquivalent: num(row.issuedQuantity) * converted.factor, physicalUnit: converted.fromUnit }
        : plan ? { originalEquivalent: num(replacementPhysicalToOriginal(plan, String(row.issuedQuantity))), physicalUnit: plan.lots.find(lot => lot.lotId === num(row.lotId))!.unit,
          replacementPlanId: plan.planId, physicalCatalogItemId: plan.catalogItemId } : {}) };
  });
  const mainId = mainWarehouses.length === 1 ? num(mainWarehouses[0].id) : null;
  const supplies: SupplyLink[] = sourceRows.map(row => {
    const need = needMap.get(num(row.needId))!, approval = materialStockUnitApproval(actions, need), emergency = emergencies.get(num(row.sourceId));
    const plan = (plansByNeed.get(need.id) || []).find(plan => plan.lots.some(lot => lot.lotId === num(row.transferLotId)));
    let status = row.status;
    if (row.sourceKind === "purchase") {
      const cancelled = ["rejected", "cancelled", "purchase_cancelled"].includes(row.purchaseStatus) || row.orderStatus === "rejected";
      const sourceLots = lots.filter(lot => num(lot.purchaseOrderItemId) === num(row.sourceId));
      const held = emergency && !emergency.approved || sourceLots.some(lot => ["pending", "rejected"].includes(lot.specificationStatus));
      if (cancelled) status = "cancelled";
      else if (held) status = "pending";
      else if (status !== "received") {
        const sourceQuantity = mainId == null ? 0 : sourceLots.filter(lot => num(lot.warehouseId) === mainId).reduce((sum, lot) => sum + num(lot.quantity), 0);
        const factor = approval && approval.fromUnit === row.purchaseUnit ? approval.factor : 1;
        status = row.receivedAt != null && num(row.receivedQuantity) * factor >= num(row.linkedQuantity) && sourceQuantity >= num(row.linkedQuantity)
          && num(row.purchaseCatalogItemId) === need.catalogItemId && (row.purchaseUnit === need.unit || approval?.fromUnit === row.purchaseUnit)
          && (emergency ? emergency.approved && !["draft", "revision_needed", "rejected"].includes(row.orderStatus)
            : ["approved", "partial_purchase", "purchased", "received", "closed"].includes(row.orderStatus)) ? "received" : "pending";
      }
    }
    return { id: num(row.id), needId: need.id, kind: row.sourceKind, sourceId: num(row.sourceId), sourceNumber: row.sourceNumber,
      quantity: num(row.linkedQuantity), status, ...(plan ? { originalEquivalent: num(replacementPhysicalToOriginal(plan, String(row.linkedQuantity))) } : {}) };
  });
  for (const [needId, plans] of Array.from(plansByNeed.entries())) for (const plan of plans) {
    const delivered = deliveries.filter(link => link.needId === needId && plan.lots.some(lot => lot.lotId === link.lotId)).reduce((sum, link) => sum + (link.originalEquivalent ?? link.quantity), 0);
    const transferred = supplies.filter(link => link.needId === needId && link.kind === "transfer" && sourceRows.some(source => num(source.id) === link.id && plan.lots.some(lot => lot.lotId === num(source.transferLotId))))
      .reduce((sum, link) => sum + (link.originalEquivalent ?? link.quantity), 0);
    if (amount(delivered) > num(plan.maximumOriginalQuantity) || amount(transferred) > num(plan.maximumOriginalQuantity)) throw Error("تغطية البديل تتجاوز كمية مصدر الشراء المرتبطة بالاحتياج");
  }
  const needs = Array.from(needMap.values()), state = { needs, deliveries, supplies, actions,
    catalog: rawNeeds.filter(row => row.catalogItemId != null).map(row => ({ id: num(row.catalogItemId), unit: row.catalogUnit, name: row.nameAr, active: num(row.catalogActive) === 1 && !num(row.inactiveUnit) })) } as Snapshot;
  function coverage(need: MaterialNeed, warehouseId: number, required: number) {
    const plans = plansByNeed.get(need.id) || [], reserved = new Set(plans.flatMap(plan => plan.lots.map(lot => lot.lotId)));
    const original = stock(warehouseId, need.catalogItemId!, need.unit);
    const originalAvailable = Math.min(original.available, original.lots.filter(lot => !reserved.has(num(lot.lotId))).reduce((sum, lot) => sum + Math.floor(num(lot.quantity)), 0));
    const candidates: Array<{ maximum: string; quantum: string }> = [];
    for (const plan of plans) {
      const physical = stock(warehouseId, plan.catalogItemId, plan.lots[0]?.unit || plan.replacementUnit);
      const prior = deliveries.filter(row => row.needId === need.id && plan.lots.some(lot => lot.lotId === row.lotId)).reduce((sum, row) => sum + (row.originalEquivalent ?? row.quantity), 0);
      const allowance = Math.min(required, Math.max(0, num(plan.maximumOriginalQuantity) - prior));
      if (allowance <= 0) continue;
      const available = Math.min(physical.available, physical.lots.filter(lot => plan.lots.some(source => source.lotId === num(lot.lotId))).reduce((sum, lot) => sum + Math.floor(num(lot.quantity)), 0));
      const selected = representableReplacementAllocation(plan, { availablePhysical: String(available), maxOriginal: String(allowance), originalStep: "1", physicalStep: "1" });
      if (num(selected.physicalQuantity) > 0) candidates.push({ maximum: selected.originalQuantity, quantum: replacementAllocationQuantum(plan, { originalStep: "1", physicalStep: "1" }).originalQuantity });
    }
    if (originalAvailable > 0) candidates.push({ maximum: String(Math.min(required, originalAvailable)), quantum: "1" });
    const chosen = exactOriginalAllocation(String(required), candidates);
    if (chosen) return { complete: true, available: required };
    let left = required;
    for (const candidate of candidates) left -= Math.floor(Math.min(left, num(candidate.maximum)) / num(candidate.quantum)) * num(candidate.quantum);
    return { complete: false, available: amount(required - left) };
  }
  const output: YourWorkItem[] = [];
  for (const row of rawNeeds) {
    const need = needMap.get(num(row.id))!, header = headerMap.get(need.assignmentId)!, queueHeader = queueMap.get(need.assignmentId);
    if (!queueHeader || closed(header) && header.stage !== "closed") continue;
    const history = actionsByAssignment.get(need.assignmentId) || [], sources = sourceRows.filter(source => num(source.needId) === need.id);
    let action: "material_provide" | "material_issue" | "material_resolve" | "material_return" | null = null;
    let arrivedAt: number | null = row.requestAt == null ? null : num(row.requestAt);
    if (canReturn && remainingReturn(state, need.id) > 0) {
      action = "material_return";
      const nextRoundAt = rawNeeds.filter(other => num(other.assignmentId) === need.assignmentId && num(other.materialRound) > need.round && other.requestAt != null).map(other => num(other.requestAt));
      const declaration = history.find(entry => entry.kind === "fixed" && entry.arrivedAt != null && row.requestAt != null && num(entry.arrivedAt) >= num(row.requestAt)
        && (!nextRoundAt.length || num(entry.arrivedAt) < Math.min(...nextRoundAt)));
      arrivedAt = declaration?.arrivedAt == null ? null : num(declaration.arrivedAt);
    } else {
      const left = amount(need.requested - issued(state, need.id));
      if (header.stage !== "waiting_material" || need.round !== num(header.materialRound) || left <= 0 || num(header.warehouseActive) !== 1 || closed(header)) continue;
      const historyExists = need.used != null || deliveries.some(link => link.needId === need.id) || supplies.some(source => source.needId === need.id);
      if (need.catalogItemId == null || materialUnitMismatch(state, need)) {
        if (canResolve && !historyExists && (need.catalogItemId == null || num(row.catalogActive) === 1 && !num(row.inactiveUnit))) action = "material_resolve";
      } else if (num(row.catalogActive) === 1 && !num(row.inactiveUnit) && process.env.INVENTORY_LOTS_ENABLED === "true") {
        // The live gateway refuses ambiguous inventory identities before allowing
        // either procurement or movement; zero stock must not conceal that error.
        const relevantCatalogs = [need.catalogItemId!, ...(plansByNeed.get(need.id) || []).map(plan => plan.catalogItemId)];
        const ambiguous = [need.warehouseId, ...(mainId == null ? [] : [mainId])].some(warehouseId => relevantCatalogs.some(catalogItemId =>
          new Set((stockHeads.get(key(warehouseId, catalogItemId)) || []).map(stock => num(stock.inventoryId))).size > 1));
        if (ambiguous) continue;
        const branch = coverage(need, need.warehouseId, left), supplyLeft = materialSupplyRemaining(state, need) ?? 0;
        if (canIssue && branch.complete && supplyLeft === 0 && num(header.teamActive) === 1 && num(header.hasRecipient) === 1) action = "material_issue";
        else if (canProvide && mainId != null) {
          const shortage = Math.max(0, left - branch.available, supplyLeft), main = coverage(need, mainId, shortage);
          const pending = supplies.filter(source => source.needId === need.id && source.status === "pending").reduce((sum, source) => sum + source.quantity, 0);
          if (shortage > 0 && ((main.complete && (plansByNeed.get(need.id)?.length || pending === 0)) || shortage - main.available - pending > 0)) action = "material_provide";
        }
      }
      // Re-entry after procurement uses its recorded physical arrival/cancellation,
      // never the ticket creation or a generic last-edited timestamp.
      const reentries = sources.filter(source => source.sourceKind === "transfer" && source.status === "received" || source.sourceKind === "purchase");
      if (reentries.length) {
        const times = reentries.map(source => source.sourceKind === "transfer" ? source.transferAt
          : supplies.find(link => link.id === num(source.id))?.status === "cancelled" ? source.cancelledAt : source.receivedAt);
        arrivedAt = arrivedAt != null && times.every(time => time != null) ? Math.max(arrivedAt, ...times.map(num)) : null;
      }
    }
    if (!action) continue;
    const title = actor.preferredLanguage === "en" ? row.nameEn || need.name : actor.preferredLanguage === "ur" ? row.nameUr || need.name : row.nameAr || need.name;
    output.push(operationItem({ key: `ticket-material:${need.id}:${action}`, kind: "team_task", reference: header.ticketNumber,
      title, action, href: `/scheduled-maintenance/warehouse-requests?source=tickets&ticketId=${num(header.ticketId)}&workReference=${encodeURIComponent(header.ticketNumber)}&workAssignment=${need.assignmentId}&workNeed=${need.id}`, arrivedAt }));
  }
  return output;
}

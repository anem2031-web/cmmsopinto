import { sql, type SQL } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { buildDashboard, type DashboardData, type DashboardFilters } from "../../../shared/dashboard-overview";

export interface DashboardReader {
  execute(statement: SQL): Promise<unknown>;
  transaction?<T>(work: (reader: DashboardReader) => Promise<T>): Promise<T>;
}
const number = (value: unknown) => Number(value);
const nullable = (value: unknown): number | null => value == null || !Number.isFinite(Number(value)) ? null : Number(value);
function rows(result: unknown): any[] {
  if (!Array.isArray(result) || !Array.isArray(result[0])) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "تعذر قراءة بيانات لوحة المتابعة" });
  return result[0];
}
function json(value: unknown): any {
  if (typeof value !== "string") return value ?? {};
  try { return JSON.parse(value); } catch { return {}; }
}

/** Minimal SELECT-only datasets; no per-ticket queries or translation writes. */
export async function readDashboardData(database: DashboardReader): Promise<DashboardData> {
  const select = async (statement: SQL) => rows(await database.execute(statement));
  const [ticketRows, itemScopes, departmentScopes, orderRows, itemRows, users, sites, entries, teamRows, links, audit, externalJobs, workTasks, teamActions, itemStageRows, triageRows] = await Promise.all([
    select(sql`SELECT id,ticketNumber,title,title_ar AS titleAr,title_en AS titleEn,title_ur AS titleUr,status,priority,workflowModel,parentTicketId,siteId,locationDetail,reportedById,maintenanceResponsibleDepartment AS department,maintenanceResponsibleManagerId AS managerId,assignedToId,supervisorId,maintenancePath,UNIX_TIMESTAMP(createdAt)*1000 AS createdAt,UNIX_TIMESTAMP(closedAt)*1000 AS closedAt,UNIX_TIMESTAMP(assignedAt)*1000 AS assignedAt FROM tickets`),
    select(sql`SELECT ticketId,responsibleDepartment AS department,responsibleManagerId AS managerId FROM ticket_items`),
    select(sql`SELECT ticketId,department,responsibleManagerId AS managerId FROM ticket_departments`),
    select(sql`SELECT id,poNumber,status,ticketId,siteId,requestedById,UNIX_TIMESTAMP(submittedAt)*1000 AS submittedAt FROM purchase_orders`),
    select(sql`SELECT i.id,i.purchaseOrderId AS orderId,i.itemName,i.status,i.quantity,i.receivedQuantity,i.unit,i.actualTotalCost,i.siteId AS itemSiteId,DATE_FORMAT(i.requiredDate,'%Y-%m-%d') AS requiredDate,i.reviewRole,i.itemRevisionNote,i.purchaseCancelReason,i.managementRejectionReason,UNIX_TIMESTAMP(i.receivedAt)*1000 AS receivedAt,UNIX_TIMESTAMP(i.purchasedAt)*1000 AS purchasedAt,i.delegateId,b.status AS batchStatus,UNIX_TIMESTAMP(b.submittedAt)*1000 AS pricingSubmittedAt,UNIX_TIMESTAMP(b.accountingApprovedAt)*1000 AS accountingApprovedAt,UNIX_TIMESTAMP(b.managementApprovedAt)*1000 AS managementApprovedAt FROM purchase_order_items i LEFT JOIN po_pricing_batches b ON b.id=i.batchId`),
    select(sql`SELECT id,name,role FROM users`),
    select(sql`SELECT id,name FROM sites ORDER BY name`),
    select(sql`SELECT h.ticketId,UNIX_TIMESTAMP(h.createdAt)*1000 AS enteredAt,h.notes AS note FROM ticket_status_history h INNER JOIN (SELECT h2.ticketId,MAX(h2.id) AS currentId FROM ticket_status_history h2 INNER JOIN tickets t ON t.id=h2.ticketId AND t.status=h2.toStatus GROUP BY h2.ticketId) latest ON latest.currentId=h.id`),
    select(sql`SELECT a.id,a.ticketId,a.responsibleManagerId AS managerId,a.assignedById,a.stage,a.revision,UNIX_TIMESTAMP(a.createdAt)*1000 AS createdAt,t.name AS teamName FROM ticket_team_assignments a INNER JOIN maintenance_teams t ON t.id=a.teamId`),
    select(sql`SELECT DISTINCT a.ticketId,s.sourceId AS purchaseItemId FROM ticket_team_supply_links s INNER JOIN ticket_team_material_needs n ON n.id=s.needId INNER JOIN ticket_team_assignments a ON a.id=n.assignmentId AND a.materialRound=n.materialRound WHERE s.sourceKind='purchase' AND s.status<>'cancelled'`),
    select(sql`SELECT entityId,oldValues,newValues,UNIX_TIMESTAMP(createdAt)*1000 AS createdAt FROM audit_logs WHERE entityType='ticket_team_assignment' ORDER BY id DESC`),
    select(sql`SELECT ticketId,status,delegateId,purchaseOrderId,actualRecipientId,UNIX_TIMESTAMP(createdAt)*1000 AS createdAt,UNIX_TIMESTAMP(warehousePreparedAt)*1000 AS warehousePreparedAt,UNIX_TIMESTAMP(gateExitApprovedAt)*1000 AS gateExitApprovedAt,UNIX_TIMESTAMP(delegateReadyForReturnAt)*1000 AS delegateReadyForReturnAt,UNIX_TIMESTAMP(gateEntryApprovedAt)*1000 AS gateEntryApprovedAt,UNIX_TIMESTAMP(warehouseReceivedAt)*1000 AS warehouseReceivedAt,UNIX_TIMESTAMP(handoverAt)*1000 AS handoverAt FROM external_maintenance_jobs WHERE status<>'closed'`),
    select(sql`SELECT x.id,x.ticketId,x.title,x.status,d.responsibleManagerId AS managerId,d.department,UNIX_TIMESTAMP(d.routedAt)*1000 AS routedAt,'task' AS sourceKind FROM ticket_tasks x INNER JOIN ticket_departments d ON d.id=x.ticketDepartmentId AND d.ticketId=x.ticketId WHERE x.status='pending_assignment' AND NOT EXISTS (SELECT 1 FROM ticket_task_assignees ta WHERE ta.taskId=x.id) UNION ALL SELECT d.id,d.ticketId,d.organizationalTitle AS title,d.status,d.responsibleManagerId AS managerId,d.department,UNIX_TIMESTAMP(d.routedAt)*1000 AS routedAt,'department' AS sourceKind FROM ticket_departments d WHERE d.status='planning' AND NOT EXISTS (SELECT 1 FROM ticket_tasks x WHERE x.ticketDepartmentId=d.id AND x.status<>'cancelled')`),
    select(sql`SELECT assignmentId,kind,actorId,note,UNIX_TIMESTAMP(createdAt)*1000 AS createdAt FROM ticket_team_actions WHERE kind IN ('execution_protocol','execution_started','execution_resumed','ok','fixed','materials_started','needs_material','blocked','external','return_to_team','external_handover','approve_result','purchase_requested','purchase_received','transfer_confirmed','warehouse_issue','material_received','approve_external','return_received') ORDER BY assignmentId,revision,id`),
    select(sql`SELECT purchaseOrderItemId,UNIX_TIMESTAMP(MAX(CASE WHEN newStatus='pending_review' THEN createdAt END))*1000 AS reviewStartedAt,UNIX_TIMESTAMP(MAX(CASE WHEN newStatus='pending' AND eventType IN ('delegate_changed','review_decision','status_changed') THEN createdAt END))*1000 AS delegateWaitStartedAt FROM purchase_order_item_history GROUP BY purchaseOrderItemId`),
    select(sql`SELECT ticketId,changedById,UNIX_TIMESTAMP(createdAt)*1000 AS createdAt FROM ticket_status_history WHERE fromStatus IN ('new','pending_triage') AND toStatus NOT IN ('new','pending_triage') ORDER BY ticketId,id`),
  ]);
  const transitions = audit.map(a => ({ id: number(a.entityId), old: json(a.oldValues), next: json(a.newValues), at: nullable(a.createdAt) }));
  const stageStarts = new Map<string, (typeof transitions)[number]>();
  for (const transition of transitions) {
    const key = `${transition.id}:${transition.next.stage}`;
    if (transition.old.stage !== transition.next.stage && !stageStarts.has(key)) stageStarts.set(key, transition);
  }
  const scopes = (source: any[]) => source.map(s => ({ ticketId: number(s.ticketId), department: s.department ?? null, managerId: nullable(s.managerId) }));
  const actionsByTeam = new Map<number, any[]>();
  const itemStages = new Map(itemStageRows.map(row => [number(row.purchaseOrderItemId), row]));
  const triageByTicket = new Map<number, any>();
  for (const row of triageRows) if (!triageByTicket.has(number(row.ticketId))) triageByTicket.set(number(row.ticketId), row);
  for (const action of teamActions) {
    const id = number(action.assignmentId), current = actionsByTeam.get(id) ?? [];
    current.push(action); actionsByTeam.set(id, current);
  }
  return {
    tickets: ticketRows.map(t => { const triage = triageByTicket.get(number(t.id)); return { ...t, id: number(t.id), parentTicketId: nullable(t.parentTicketId), siteId: nullable(t.siteId), managerId: nullable(t.managerId), reportedById: nullable(t.reportedById), assignedToId: nullable(t.assignedToId), supervisorId: nullable(t.supervisorId), createdAt: nullable(t.createdAt), closedAt: nullable(t.closedAt), assignedAt: nullable(t.assignedAt), routedAt: nullable(triage?.createdAt), routedById: nullable(triage?.changedById) }; }),
    itemScopes: scopes(itemScopes), departmentScopes: scopes(departmentScopes),
    orders: orderRows.map(o => ({ ...o, id: number(o.id), ticketId: nullable(o.ticketId), siteId: nullable(o.siteId), requestedById: number(o.requestedById), submittedAt: nullable(o.submittedAt) })),
    purchases: itemRows.map(i => { const stage = itemStages.get(number(i.id)); return { ...i, id: number(i.id), orderId: number(i.orderId), quantity: number(i.quantity), receivedQuantity: nullable(i.receivedQuantity), itemSiteId: nullable(i.itemSiteId), receivedAt: nullable(i.receivedAt), purchasedAt: nullable(i.purchasedAt), delegateId: nullable(i.delegateId), pricingSubmittedAt: nullable(i.pricingSubmittedAt), accountingApprovedAt: nullable(i.accountingApprovedAt), managementApprovedAt: nullable(i.managementApprovedAt), reviewStartedAt: nullable(stage?.reviewStartedAt), delegateWaitStartedAt: nullable(stage?.delegateWaitStartedAt) }; }),
    users: users.map(u => ({ ...u, id: number(u.id) })), sites: sites.map(s => ({ ...s, id: number(s.id) })),
    statusEntries: entries.map(e => ({ ticketId: number(e.ticketId), enteredAt: nullable(e.enteredAt), note: e.note ?? null })),
    teams: teamRows.map(t => {
      const transition = stageStarts.get(`${number(t.id)}:${t.stage}`);
      const actions = actionsByTeam.get(number(t.id)) ?? [];
      const protocol = actions.find(a => a.kind === "execution_protocol");
      const start = actions.find(a => a.kind === "execution_started");
      const outcome = actions.find(a => ["ok", "fixed", "needs_material", "blocked", "external"].includes(a.kind));
      const outcomeIndex = actions.indexOf(outcome);
      const followupEvents = outcomeIndex < 0 ? [] : actions.slice(outcomeIndex + 1).map(action => ({ kind: String(action.kind), at: nullable(action.createdAt), actorId: nullable(action.actorId), note: typeof action.note === "string" && !action.note.trim().startsWith("{") ? action.note : null }));
      let currentWork: any = null;
      for (const action of actions) {
        if (["execution_started", "execution_resumed"].includes(action.kind)) currentWork = action;
        else if (["ok", "fixed", "materials_started", "needs_material", "blocked", "external", "return_to_team", "external_handover", "approve_result"].includes(action.kind)) currentWork = null;
      }
      const minutes = number(json(protocol?.note).inspectionMinutes);
      return { id: number(t.id), ticketId: number(t.ticketId), managerId: number(t.managerId), assignedById: nullable(t.assignedById), stage: t.stage, teamName: t.teamName, createdAt: nullable(t.createdAt), enteredAt: transition?.at ?? (number(t.revision) === 0 ? nullable(t.createdAt) : null), note: typeof transition?.next.note === "string" ? transition.next.note : null, inspectionMinutes: Number.isSafeInteger(minutes) && minutes > 0 && minutes <= 525600 ? minutes : null, startedAt: nullable(start?.createdAt), startedById: nullable(start?.actorId), outcomeAt: nullable(outcome?.createdAt), outcomeById: nullable(outcome?.actorId), outcomeKind: outcome?.kind ?? null, outcomeNote: typeof outcome?.note === "string" ? outcome.note : null, currentWorkAt: nullable(currentWork?.createdAt), currentWorkById: nullable(currentWork?.actorId), followupEvents };
    }),
    workTasks: workTasks.map(t => ({ id: number(t.id), ticketId: number(t.ticketId), title: t.title ?? "", status: t.status, managerId: nullable(t.managerId), department: t.department ?? null, routedAt: nullable(t.routedAt), sourceKind: t.sourceKind === "department" ? "department" as const : "task" as const })),
    teamPurchaseLinks: links.map(l => ({ ticketId: number(l.ticketId), purchaseItemId: number(l.purchaseItemId) })),
    externalJobs: externalJobs.map(j => ({ ...j, ticketId: number(j.ticketId), delegateId: nullable(j.delegateId), purchaseOrderId: nullable(j.purchaseOrderId), actualRecipientId: nullable(j.actualRecipientId), createdAt: nullable(j.createdAt), warehousePreparedAt: nullable(j.warehousePreparedAt), gateExitApprovedAt: nullable(j.gateExitApprovedAt), delegateReadyForReturnAt: nullable(j.delegateReadyForReturnAt), gateEntryApprovedAt: nullable(j.gateEntryApprovedAt), warehouseReceivedAt: nullable(j.warehouseReceivedAt), handoverAt: nullable(j.handoverAt) })),
  };
}
export async function loadDashboard(filters: DashboardFilters, reader?: DashboardReader, now = Date.now()) {
  let database = reader;
  if (!database) {
    // The database module is loaded only for an authorized application read.
    const { getDb } = await import("../../_core/db/client");
    database = await getDb() as DashboardReader | undefined;
  }
  if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "بيانات لوحة المتابعة غير متاحة؛ لا يمكن عرض أصفار بديلة" });
  const data = database.transaction
    ? await database.transaction(transaction => readDashboardData(transaction))
    : await readDashboardData(database);
  return buildDashboard(data, filters, now);
}

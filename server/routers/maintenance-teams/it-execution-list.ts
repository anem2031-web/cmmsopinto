import { sql, type SQL } from "drizzle-orm";
import { groupReadRows, readScopeChunks } from "../../_core/authz/read-batch";
import { canReadTicketTeamExecution } from "../../../shared/maintenance-team-tickets/execution-permissions";
import { ticketExecutionSession } from "../../../shared/maintenance-team-tickets/execution-session";
import { TeamTicketError, type Action, type Stage } from "../../../shared/maintenance-team-tickets/model";
import type { ItExecutionListRow, ItExecutionListState, TicketTeamListInput, TicketTeamListResult } from "../../../shared/maintenance-team-tickets/list";
import type { TeamManagementActor } from "../../../shared/maintenance-team-tickets/team-management";

type Database = { execute(statement: SQL): Promise<unknown> };
const IT = "maintenance_report_department_it";
const ids = (values: number[]) => sql.join(values.map(value => sql`${value}`), sql`,`);
async function rows(db: Database, statement: SQL): Promise<any[]> {
  const result = await db.execute(statement);
  if (!Array.isArray(result) || !Array.isArray(result[0])) throw Error("تعذر قراءة تذاكر تقنية المعلومات");
  return result[0];
}
const base = sql`FROM tickets k
  INNER JOIN ticket_tasks task ON task.id=k.sourceTaskId AND task.convertedTicketId=k.id AND task.ticketId=k.parentTicketId
  INNER JOIN tickets parent ON parent.id=task.ticketId
  INNER JOIN ticket_departments department ON department.id=task.ticketDepartmentId AND department.ticketId=parent.id
  LEFT JOIN users executor ON executor.id=k.assignedToId
  LEFT JOIN sites site ON site.id=k.siteId
  LEFT JOIN sections section ON section.id=k.sectionId`;

function stateOf(row: any, working: boolean): ItExecutionListState {
  if (["closed", "requester_confirmed"].includes(row.status)) return "closed";
  if (["ready_for_closure", "verified"].includes(row.status)) return "awaiting_review";
  if (row.materialId != null) {
    if (working) return "in_progress";
    if (row.materialStage === "action_required") return "not_started";
    if (row.materialStage === "closed") return "awaiting_review";
    if (["waiting_material", "ready_to_repair", "awaiting_review", "blocked", "external_requested", "external_in_progress", "reinstall_required"].includes(row.materialStage)) return row.materialStage;
  }
  if (row.status === "in_progress") return String(row.lastHistoryNote || "").startsWith("يوجد عائق:") ? "blocked" : "in_progress";
  if (["assigned", "under_inspection"].includes(row.status)) return "not_started";
  if (row.maintenancePath === "B") return row.status === "received_warehouse" ? "ready_to_repair" : "waiting_material";
  if (row.maintenancePath === "C") {
    if (["ready_for_closure", "closed"].includes(row.externalStatus)) return "awaiting_review";
    if (["delivered_for_reinstall", "reinstall_in_progress"].includes(row.externalStatus)) return "reinstall_required";
    if (["out_for_repair", "repaired"].includes(row.status) || ["purchase_cycle", "waiting_gate_entry", "waiting_warehouse_receipt", "waiting_technician_handover"].includes(row.externalStatus)) return "external_in_progress";
    return "external_requested";
  }
  return "other";
}
const empty = (input: TicketTeamListInput): TicketTeamListResult => ({
  items: [], itTickets: [], total: 0, page: 1, pageSize: input.pageSize,
  options: { teams: [], executors: [], sites: [], sections: [] }, departmentCounts: { general: 0, construction: 0, it: 0 },
});

/** Existing named IT sub-tickets; no synthetic team assignment, task or workflow write. */
export async function loadItExecutionList(db: Database, actor: TeamManagementActor, input: TicketTeamListInput): Promise<TicketTeamListResult> {
  if (!actor.active || !canReadTicketTeamExecution(actor.role)) throw new TeamTicketError("FORBIDDEN", "ليس لديك صلاحية لعرض تذاكر تقنية المعلومات");
  // Only this branch loads the existing ticket guard; ordinary team queues retain their imports.
  const { assertTicketReadable, isRoleDeniedFromTickets, isTicketVisible } = await import("../tickets/tickets.access");
  if (isRoleDeniedFromTickets(actor.role)) return empty(input);
  const generallyVisible = isTicketVisible(actor, { reportedById: null, assignedToId: null, maintenanceResponsibleDepartment: IT });
  const named = sql`(k.assignedToId=${actor.id} OR k.assignedTechnicianId=${actor.id}
    OR EXISTS (SELECT 1 FROM ticket_items ownItem WHERE ownItem.ticketId=k.id AND (ownItem.assignedToId=${actor.id} OR ownItem.assignedTechnicianId=${actor.id}))
    OR EXISTS (SELECT 1 FROM ticket_task_assignees ownTask WHERE ownTask.taskId=task.id AND ownTask.userId=${actor.id}))`;
  const visibility = generallyVisible ? sql`TRUE` : actor.role === "technician" ? named : sql`FALSE`;
  const departmentScope = sql`k.workflowModel='sub_ticket' AND k.sourceTaskId IS NOT NULL AND department.department=${IT}
    AND EXISTS (SELECT 1 FROM ticket_items childItem WHERE childItem.ticketId=k.id AND childItem.responsibleDepartment=${IT})
    AND (${visibility})`;
  const terms: SQL[] = [departmentScope];
  if (input.executorId) terms.push(sql`k.assignedToId=${input.executorId}`);
  if (input.teamId) terms.push(sql`FALSE`);
  if (input.siteId) terms.push(sql`k.siteId=${input.siteId}`);
  if (input.sectionId) terms.push(sql`k.sectionId=${input.sectionId}`);
  const search = input.search?.trim();
  if (search) {
    const term = "%" + search.replace(/[!%_]/g, value => "!" + value) + "%";
    terms.push(sql`(k.ticketNumber LIKE ${term} ESCAPE '!' OR parent.ticketNumber LIKE ${term} ESCAPE '!'
      OR k.title LIKE ${term} ESCAPE '!' OR k.description LIKE ${term} ESCAPE '!'
      OR site.name LIKE ${term} ESCAPE '!' OR section.name LIKE ${term} ESCAPE '!' OR executor.name LIKE ${term} ESCAPE '!'
      OR EXISTS (SELECT 1 FROM entity_translations tr WHERE tr.entityType='TICKET' AND tr.entityId=k.id
        AND tr.fieldName IN ('title','description') AND tr.languageCode=${input.language}
        AND tr.translationStatus IN ('completed','approved') AND tr.translatedText LIKE ${term} ESCAPE '!'))`);
  }
  const where = sql.join(terms.map(term => sql`(${term})`), sql` AND `);
  const direction = input.sort === "newest" ? sql`DESC` : sql`ASC`;
  const order = sql`ORDER BY COALESCE(k.assignedAt,k.createdAt) ${direction},k.id ${direction}`;
  const [executors, sites, sections, candidates] = await Promise.all([
    rows(db, sql`SELECT DISTINCT executor.id,executor.name ${base} WHERE ${departmentScope} AND executor.id IS NOT NULL ORDER BY executor.name,executor.id`),
    rows(db, sql`SELECT DISTINCT site.id,site.name ${base} WHERE ${departmentScope} AND site.id IS NOT NULL ORDER BY site.name,site.id`),
    rows(db, sql`SELECT DISTINCT section.id,section.name,k.siteId ${base} WHERE ${departmentScope} AND section.id IS NOT NULL ORDER BY section.name,section.id`),
    rows(db, sql`SELECT k.id,k.status,k.maintenancePath ${base} WHERE ${where} ${order}`),
  ]);
  // TiDB rejects correlated subqueries in JOIN ON. Read the authorized structural
  // candidates first, then batch state evidence before status filtering/pagination.
  const candidateIds = candidates.map(row => Number(row.id));
  const [statusHistory, materials, externalJobs] = await Promise.all([
    readScopeChunks(candidateIds, chunk => rows(db, sql`SELECT ticketId,notes FROM ticket_status_history
      WHERE ticketId IN (${ids(chunk)}) ORDER BY ticketId,createdAt DESC,id DESC`)),
    readScopeChunks(candidateIds, chunk => rows(db, sql`SELECT a.ticketId,a.id,a.stage FROM ticket_team_assignments a
      INNER JOIN ticket_items mi ON mi.id=a.ticketItemId AND mi.ticketId=a.ticketId
      WHERE a.ticketId IN (${ids(chunk)}) AND mi.responsibleDepartment='maintenance_report_department_it'
      ORDER BY a.ticketId,a.id`)),
    readScopeChunks(candidateIds, chunk => rows(db, sql`SELECT ticketId,id,status FROM external_maintenance_jobs
      WHERE ticketId IN (${ids(chunk)}) ORDER BY ticketId,id DESC`)),
  ]);
  // Each ticket belongs to exactly one batch; SQL ordering determines the first
  // record, including chronological history when TiDB IDs are not time ordered.
  const firstByTicket = (source: any[]) => {
    const first = new Map<number, any>();
    for (const row of source) if (!first.has(Number(row.ticketId))) first.set(Number(row.ticketId), row);
    return first;
  };
  const lastHistory = firstByTicket(statusHistory), materialByTicket = firstByTicket(materials), jobByTicket = firstByTicket(externalJobs);
  for (const row of candidates) {
    const ticketId = Number(row.id), material = materialByTicket.get(ticketId);
    row.lastHistoryNote = lastHistory.get(ticketId)?.notes;
    row.materialId = material?.id;
    row.materialStage = material?.stage;
    row.externalStatus = jobByTicket.get(ticketId)?.status;
  }
  const materialIds = candidates.flatMap(row => row.materialId == null ? [] : [Number(row.materialId)]);
  const actions = await readScopeChunks(materialIds, chunk => rows(db, sql`SELECT id,assignmentId,actorId,kind,note,revision,operationKey,createdAt FROM ticket_team_actions
    WHERE assignmentId IN (${ids(chunk)}) AND kind IN ('execution_protocol','execution_started','execution_resumed','execution_joined','visit_ended','ok','fixed','blocked','external','materials_started','needs_material','return_to_team','external_handover','approve_result') ORDER BY assignmentId,revision`));
  const byAssignment = groupReadRows(actions, action => Number(action.assignmentId));
  const states = new Map<number, ItExecutionListState>(candidates.map(row => {
    const history: Action[] = (byAssignment.get(Number(row.materialId)) || []).map(action => ({ ...action, id: Number(action.id), assignmentId: Number(action.assignmentId), actorId: Number(action.actorId), revision: Number(action.revision), at: String(action.createdAt) }));
    const working = row.materialId != null && ticketExecutionSession({ actions: history }, { id: Number(row.materialId), stage: row.materialStage as Stage }).working;
    return [Number(row.id), stateOf(row, working)];
  }));
  const matching = candidates.filter(row => input.status === "all" || input.status === "open" && states.get(Number(row.id)) !== "closed"
    || states.get(Number(row.id)) === (input.status === "action_required" ? "not_started" : input.status));
  const total = matching.length;
  const page = Math.min(input.page, Math.max(1, Math.ceil(total / input.pageSize)));
  const pageIds = matching.slice((page - 1) * input.pageSize, page * input.pageSize).map(row => Number(row.id));
  const selected = pageIds.length ? await rows(db, sql`SELECT k.id,k.ticketNumber,k.title,k.description,k.status,k.siteId,k.sectionId,
    k.assignedToId,k.assignedTechnicianId,k.reportedById,k.maintenanceResponsibleDepartment,k.maintenanceResponsibleManagerId,k.sourceTaskId,
    executor.name AS assignedToName,site.name AS siteName,section.name AS sectionName,parent.ticketNumber AS parentTicketNumber,k.assignedAt,
    EXISTS (SELECT 1 FROM ticket_task_assignees ownTask WHERE ownTask.taskId=task.id AND ownTask.userId=${actor.id}) AS ownTaskAssigned
    ${base} WHERE ${where} AND k.id IN (${ids(pageIds)}) ${order}`) : [];
  const [itemRows, translations] = await Promise.all([
    readScopeChunks(pageIds, chunk => rows(db, sql`SELECT ticketId,responsibleDepartment,responsibleManagerId,assignedToId,assignedTechnicianId FROM ticket_items WHERE ticketId IN (${ids(chunk)})`)),
    readScopeChunks(pageIds, chunk => rows(db, sql`SELECT entityId,fieldName,translatedText FROM entity_translations WHERE entityType='TICKET'
      AND entityId IN (${ids(chunk)}) AND languageCode=${input.language} AND fieldName IN ('title','description')
      AND translationStatus IN ('completed','approved') ORDER BY id`)),
  ]);
  const byTicket = groupReadRows(itemRows, row => Number(row.ticketId));
  const translated = new Map<string, string>();
  for (const row of translations) if (row.translatedText) translated.set(String(row.entityId) + ":" + row.fieldName, String(row.translatedText));
  const itTickets: ItExecutionListRow[] = [];
  for (const row of selected) {
    const source = {
      getTicketItems: async (id: number) => byTicket.get(id) || [],
      hasTicketDepartmentAssignment: async () => false,
      hasPurchaseOrderForTicket: async () => false,
      isUserAssignedToTicketTasks: async (id: number, taskId: number | null | undefined, userId: number) => id === Number(row.id) && taskId === row.sourceTaskId && userId === actor.id && Number(row.ownTaskAssigned) === 1,
    };
    await assertTicketReadable(actor, { ...row, id: Number(row.id) }, undefined, source);
    itTickets.push({
      id: Number(row.id), ticketNumber: String(row.ticketNumber), title: translated.get(String(row.id) + ":title") || String(row.title || ""),
      description: translated.get(String(row.id) + ":description") || String(row.description || ""), status: String(row.status), state: states.get(Number(row.id)) || "other",
      assignedToId: row.assignedToId == null ? null : Number(row.assignedToId), assignedToName: row.assignedToName == null ? null : String(row.assignedToName),
      siteId: row.siteId == null ? null : Number(row.siteId), sectionId: row.sectionId == null ? null : Number(row.sectionId),
      siteName: String(row.siteName || ""), sectionName: String(row.sectionName || ""), parentTicketNumber: row.parentTicketNumber == null ? null : String(row.parentTicketNumber),
      assignedAt: row.assignedAt == null ? null : row.assignedAt instanceof Date ? row.assignedAt.toISOString() : String(row.assignedAt),
    });
  }
  return { items: [], itTickets, total, page, pageSize: input.pageSize,
    options: { teams: [], executors: executors.map(row => ({ id: Number(row.id), name: String(row.name || "") })),
      sites: sites.map(row => ({ id: Number(row.id), name: String(row.name || "") })),
      sections: sections.map(row => ({ id: Number(row.id), name: String(row.name || ""), siteId: Number(row.siteId) })) },
    departmentCounts: { general: 0, construction: 0 },
  };
}

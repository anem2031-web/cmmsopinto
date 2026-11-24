import { sql, type SQL } from "drizzle-orm";
import { groupReadRows, readScopeChunks } from "../../_core/authz/read-batch";
import { loadTeamReportMedia } from "../../maintenance-team-tickets/report-media";
import { ticketExecutionSession } from "../../../shared/maintenance-team-tickets/execution-session";
import type { AssignedTeamTicket } from "../../../shared/maintenance-team-tickets/assignment";
import type { TicketTeamListInput, TicketTeamListResult } from "../../../shared/maintenance-team-tickets/list";
import type { Action } from "../../../shared/maintenance-team-tickets/model";
import type { TeamManagementActor } from "../../../shared/maintenance-team-tickets/team-management";
import { ticketTeamQueueScope } from "./assignment-read-scope";

type Database = { execute(statement: SQL): Promise<unknown> };
async function read(db: Database, statement: SQL): Promise<any[]> {
  const result = await db.execute(statement);
  if (!Array.isArray(result) || !Array.isArray(result[0])) throw Error("تعذر قراءة قائمة تذاكر الصيانة");
  return result[0];
}
const ids = (values: number[]) => sql.join(values.map(id => sql`${id}`), sql`,`);
const base = sql`FROM ticket_team_assignments a
  INNER JOIN maintenance_teams t ON t.id=a.teamId
  INNER JOIN tickets k ON k.id=a.ticketId
  INNER JOIN ticket_items i ON i.id=a.ticketItemId AND i.ticketId=a.ticketId
  LEFT JOIN warehouses w ON w.id=a.warehouseId
  LEFT JOIN sites s ON s.id=a.siteId
  LEFT JOIN sections c ON c.id=a.sectionId
  LEFT JOIN tickets original ON original.id=k.parentTicketId
  LEFT JOIN ticket_tasks originTask ON originTask.id=k.sourceTaskId AND originTask.ticketId=original.id AND originTask.convertedTicketId=k.id`;
const sessionKinds = sql`('execution_protocol','execution_started','execution_resumed','execution_joined','visit_ended','ok','fixed','blocked','external','materials_started','needs_material','return_to_team','external_handover','approve_result')`;
async function sessions(db: Database, assignments: Array<{ assignmentId: number; stage: any }>) {
  const history = await readScopeChunks(assignments.map(row => Number(row.assignmentId)), chunk => read(db, sql`
    SELECT id,assignmentId,actorId,kind,note,revision,operationKey,createdAt FROM ticket_team_actions
    WHERE assignmentId IN (${ids(chunk)}) AND kind IN ${sessionKinds} ORDER BY assignmentId,revision`));
  const grouped = groupReadRows(history, row => Number(row.assignmentId));
  return new Map(assignments.map(row => {
    const actions: Action[] = (grouped.get(Number(row.assignmentId)) || []).map(action => ({
      ...action, id: Number(action.id), assignmentId: Number(action.assignmentId), actorId: Number(action.actorId),
      revision: Number(action.revision), at: String(action.createdAt),
    }));
    return [Number(row.assignmentId), ticketExecutionSession({ actions }, { id: Number(row.assignmentId), stage: row.stage })];
  }));
}

/** Filters precede page enrichment. The array queue used by existing workflows remains unchanged. */
export async function loadTicketTeamList(db: Database, actor: TeamManagementActor, input: TicketTeamListInput): Promise<TicketTeamListResult> {
  if (input.department === "maintenance_report_department_it") {
    const { loadItExecutionList } = await import("./it-execution-list");
    return loadItExecutionList(db, actor, input);
  }
  const scope = ticketTeamQueueScope(actor);
  const departmentScope = sql`(${scope}) AND i.responsibleDepartment=${input.department}`;
  const terms: SQL[] = [departmentScope];
  const search = input.search?.trim();
  if (search) {
    const term = "%" + search.replace(/[!%_]/g, character => "!" + character) + "%";
    terms.push(sql`(a.ticketNumber LIKE ${term} ESCAPE '!' OR a.titleSnapshot LIKE ${term} ESCAPE '!'
      OR k.description LIKE ${term} ESCAPE '!' OR t.name LIKE ${term} ESCAPE '!'
      OR s.name LIKE ${term} ESCAPE '!' OR c.name LIKE ${term} ESCAPE '!'
      OR (originTask.id IS NOT NULL AND original.ticketNumber LIKE ${term} ESCAPE '!')
      OR EXISTS (SELECT 1 FROM entity_translations translation WHERE translation.entityType='TICKET'
        AND translation.entityId=k.id AND translation.fieldName IN ('title','description')
        AND translation.languageCode=${input.language} AND translation.translationStatus IN ('completed','approved')
        AND translation.translatedText LIKE ${term} ESCAPE '!'))`);
  }
  if (input.teamId) terms.push(sql`a.teamId=${input.teamId}`);
  if (input.siteId) terms.push(sql`a.siteId=${input.siteId}`);
  if (input.sectionId) terms.push(sql`a.sectionId=${input.sectionId}`);
  const derived = input.status === "in_progress" || input.status === "not_started";
  if (input.status === "open") terms.push(sql`a.stage<>'closed'`);
  else if (input.status === "in_progress") terms.push(sql`a.stage IN ('action_required','ready_to_repair','reinstall_required')`);
  else if (input.status === "not_started") terms.push(sql`a.stage='action_required'`);
  else if (input.status !== "all") terms.push(sql`a.stage=${input.status}`);
  const where = sql.join(terms.map(term => sql`(${term})`), sql` AND `);
  const direction = input.sort === "newest" ? sql`DESC` : sql`ASC`;
  const order = sql`ORDER BY a.createdAt ${direction},a.id ${direction}`;

  // Metadata is scoped independently of search/page, so older matching teams remain selectable.
  const [teamRows, siteRows, sectionRows, counts] = await Promise.all([
    read(db, sql`SELECT DISTINCT t.id,t.name ${base} WHERE ${departmentScope} ORDER BY t.name,t.id`),
    read(db, sql`SELECT DISTINCT s.id,s.name ${base} WHERE ${departmentScope} AND s.id IS NOT NULL ORDER BY s.name,s.id`),
    read(db, sql`SELECT DISTINCT c.id,c.name,a.siteId ${base} WHERE ${departmentScope} AND c.id IS NOT NULL ORDER BY c.name,c.id`),
    read(db, sql`SELECT i.responsibleDepartment AS department,COUNT(*) AS total ${base}
      WHERE (${scope}) AND a.stage<>'closed' AND i.responsibleDepartment IN ('maintenance_report_department_general','maintenance_report_department_construction') GROUP BY i.responsibleDepartment`),
  ]);
  let total: number;
  let selectedIds: number[] | undefined;
  let stateById: Awaited<ReturnType<typeof sessions>> | undefined;
  let page: number;
  if (derived) {
    // Only the small identity/stage projection and canonical session ledger are needed
    // to filter derived state; report media, translations and card rows load after paging.
    const candidates = await read(db, sql`SELECT a.id AS assignmentId,a.stage ${base} WHERE ${where} ${order}`);
    stateById = await sessions(db, candidates);
    const matching = candidates.filter(row => input.status === "in_progress"
      ? stateById!.get(Number(row.assignmentId))!.working : !stateById!.get(Number(row.assignmentId))!.working);
    total = matching.length;
    page = Math.min(input.page, Math.max(1, Math.ceil(total / input.pageSize)));
    selectedIds = matching.slice((page - 1) * input.pageSize, page * input.pageSize).map(row => Number(row.assignmentId));
  } else {
    const [summary] = await read(db, sql`SELECT COUNT(*) AS total ${base} WHERE ${where}`);
    total = Number(summary?.total || 0);
    page = Math.min(input.page, Math.max(1, Math.ceil(total / input.pageSize)));
  }
  const pageRows = selectedIds?.length === 0 ? [] : await read(db, sql`SELECT a.id AS assignmentId,a.ticketId,a.ticketNumber,
    a.titleSnapshot AS title,a.teamId,t.name AS teamName,w.nameAr AS warehouseName,a.stage,k.status AS sourceStatus,
    s.name AS siteName,c.name AS sectionName,k.description,a.siteId,a.sectionId,i.responsibleDepartment,
    a.createdAt AS assignedAt,CASE WHEN originTask.id IS NOT NULL THEN original.ticketNumber ELSE NULL END AS parentTicketNumber
    ${base} WHERE ${where} ${selectedIds ? sql`AND a.id IN (${ids(selectedIds)})` : sql``} ${order}
    LIMIT ${input.pageSize} OFFSET ${selectedIds ? 0 : (page - 1) * input.pageSize}`);
  const items: AssignedTeamTicket[] = pageRows.map(row => ({ ...row, assignmentId: Number(row.assignmentId), ticketId: Number(row.ticketId), teamId: Number(row.teamId) }));
  if (items.length) {
    const [pageSessions, media] = await Promise.all([
      stateById || sessions(db, items), loadTeamReportMedia(db, actor, items),
    ]);
    for (const item of items) {
      const session = pageSessions.get(item.assignmentId)!;
      item.executionInProgress = session.working;
      item.hasOpenVisit = !!session.openVisit;
      item.reportMedia = media.get(item.assignmentId) || [];
    }
  }
  const count = (department: string) => Number(counts.find(row => row.department === department)?.total || 0);
  return { items, total, page, pageSize: input.pageSize,
    options: {
      teams: teamRows.map(row => ({ id: Number(row.id), name: String(row.name || "") })),
      sites: siteRows.map(row => ({ id: Number(row.id), name: String(row.name || "") })),
      sections: sectionRows.map(row => ({ id: Number(row.id), name: String(row.name || ""), siteId: Number(row.siteId) })),
    }, departmentCounts: { general: count('maintenance_report_department_general'), construction: count('maintenance_report_department_construction') },
  };
}

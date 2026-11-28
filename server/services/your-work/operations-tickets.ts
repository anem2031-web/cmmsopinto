import { sql } from "drizzle-orm";
import { APP_ROLE, MAINTENANCE_RESPONSIBLE_DEPARTMENT as DEPT, isItTeamRole } from "../../../shared/roles";
import { canClaimItDepartment } from "../../../shared/itTeamWorkflow";
import { canRecordItExecutionOutcome, canStartItSubTicket } from "../../../shared/it-execution-workflow";
import { canApproveTicketTeamResult, canReviewTicketTeamExecution } from "../../../shared/maintenance-team-tickets/execution-permissions";
import { canManageTicketWorkflow, canReviewTicketInspection, canSelectTicketItemMaintenancePath, isRoleDeniedFromTickets } from "../../routers/tickets/tickets.access";
import { ownsExternalRouteReview } from "../../../shared/external-route-review";
import type { YourWorkItem } from "../../../shared/your-work";
import { operationCapability, operationItem, operationRows, privilegedOperationActor, type OperationsActor, type OperationsDatabase } from "./operations-port";

const managers = ["owner", "admin", "maintenance_manager", "general_maintenance_manager", "construction_procurement_manager", "supervisor", "it_manager", "it_member"];
const workflowManagers = ["owner", "admin", "maintenance_manager", "general_maintenance_manager", "construction_procurement_manager", "it_manager", "it_member"];
const closureRoles = [...workflowManagers, "supervisor"];
const personallyResponsible = (actor: OperationsActor, managerId: any) => privilegedOperationActor(actor) || !managerId || Number(managerId) === actor.id;
/** Read-side mirror of tickets.workflow.canManageDepartmentPlan; it does not grant a new workflow permission. */
export function canManageOperationDepartment(actor: OperationsActor, row: any): boolean {
  if (privilegedOperationActor(actor)) return true;
  if (row.department === DEPT.IT) return isItTeamRole(actor.role) && (Number(row.claimedById) === actor.id || actor.role === "it_manager" && Number(row.responsibleManagerId) === actor.id);
  if (row.department === DEPT.CONSTRUCTION) return actor.role === "construction_procurement_manager" && Number(row.responsibleManagerId) === actor.id;
  return actor.role === "maintenance_manager" || actor.role === "general_maintenance_manager" && Number(row.responsibleManagerId) === actor.id;
}
function ticketScope(actor: OperationsActor) {
  if (privilegedOperationActor(actor)) return sql`TRUE`;
  if (actor.role === "construction_procurement_manager") return sql`((t.status='pending_triage' AND t.reportedById=${actor.id}) OR t.maintenanceResponsibleManagerId=${actor.id} OR i.responsibleManagerId=${actor.id})`;
  if (actor.role === "general_maintenance_manager" || actor.role === "maintenance_manager") return sql`(t.status='pending_triage' OR ((t.maintenanceResponsibleManagerId IS NULL OR t.maintenanceResponsibleManagerId=${actor.id}) AND (i.responsibleManagerId IS NULL OR i.responsibleManagerId=${actor.id})))`;
  if (actor.role === "supervisor") return sql`(t.supervisorId=${actor.id} OR t.maintenanceResponsibleManagerId=${actor.id})`;
  if (isItTeamRole(actor.role)) return sql`(t.assignedToId=${actor.id} OR t.reportedById=${actor.id})`;
  return sql`t.reportedById=${actor.id} AND t.status='closed'`;
}

/** Every candidate has a real ticket/item parent join; writer guards are reused below. */
export function classifyLegacyTicketOperations(actor: OperationsActor, candidates: any[]): YourWorkItem[] {
  const result: YourWorkItem[] = [];
  for (const row of candidates) {
    const ticket = { ...row, id: Number(row.id), reportedById: Number(row.reportedById) || null,
      assignedToId: Number(row.assignedToId) || null, maintenanceResponsibleManagerId: Number(row.maintenanceResponsibleManagerId) || null };
    const href = `/tickets/${ticket.id}${row.itemId ? `?workItem=${Number(row.itemId)}` : ""}`;
    const add = (action: YourWorkItem["action"], arrivedAt: any, suffix = "") => result.push(operationItem({
      key: `ticket:${ticket.id}:${action}${suffix}`, kind: "ticket", reference: row.ticketNumber, title: row.itemTitle || row.title,
      action, href: action === "it_ticket_execute" ? `/maintenance-team-tickets?itExecution=${ticket.id}`
        : action === "ticket_external_review" ? `${href}${href.includes("?") ? "&" : "?"}workAction=ticket_external_review`
          : action === "ticket_close" ? `/tickets/${ticket.id}?workAction=ticket_close` : href, arrivedAt,
    }));
    if (row.status === "closed" && Number(row.reportedById) === actor.id && actor.role !== APP_ROLE.CONSTRUCTION_PROCUREMENT_MANAGER
      && operationCapability(actor, "tickets.confirmCompletion")) { add("ticket_confirm", row.closedAtMs); continue; }
    if (row.status === "pending_triage" && ["owner", "admin", "maintenance_manager", "general_maintenance_manager", "construction_procurement_manager"].includes(actor.role)
      && (actor.role !== "construction_procurement_manager" || Number(row.reportedById) === actor.id)
      && operationCapability(actor, "tickets.triageMulti")) { add("ticket_triage", row.enteredAt ?? row.createdAtMs); continue; }
    if (row.workflowModel === "department_tasks") {
      if (closureRoles.includes(actor.role) && operationCapability(actor, "tickets.closeParentTicket") && canManageTicketWorkflow(actor, ticket)
        && personallyResponsible(actor, row.maintenanceResponsibleManagerId) && Number(row.childCount) > 0 && Number(row.childOpenCount) === 0 && Number(row.pendingTaskCount) === 0)
        add("ticket_close", Number(row.cancelledPendingTasks) ? null : row.lastChildClosedAt);
      continue;
    }
    if (!managers.includes(actor.role) || !personallyResponsible(actor, row.maintenanceResponsibleManagerId)) continue;
    if (isItTeamRole(actor.role) && (canStartItSubTicket(actor as any, ticket) || canRecordItExecutionOutcome(actor as any, ticket))) {
      add("it_ticket_execute", row.enteredAt ?? row.assignedAtMs); continue;
    }
    if (row.routeReturnId) {
      if (row.itemStatus === "under_inspection" && row.itemPath === "C" && Number(row.routeTicketId) === ticket.id
        && ownsExternalRouteReview(actor.role, actor.id, Number(row.routeReviewerId)) && (!row.itemApprovedById || Number(row.itemApprovedById) === Number(row.routeReviewerId))
        && operationCapability(actor, "externalMaintenance.decideRouteReview")) add("ticket_external_review", row.routeReturnedAt, `:${row.itemId}`);
      continue;
    }
    if (row.teamId && row.teamStage !== "closed") continue;
    if (workflowManagers.includes(actor.role) && operationCapability(actor, "tickets.reviewInspection") && canReviewTicketInspection(actor, ticket)) {
      add("ticket_inspection_review", row.inspectionSubmittedAtMs); continue;
    }
    const item = { status: row.itemStatus, responsibleDepartment: row.itemDepartment, responsibleManagerId: Number(row.itemManagerId) || null, assignedToId: Number(row.itemAssignedToId) || null };
    if (workflowManagers.includes(actor.role) && operationCapability(actor, "tickets.approveWorkForItem") && !row.teamId
      && personallyResponsible(actor, row.itemManagerId) && canSelectTicketItemMaintenancePath(actor, ticket, item)) {
      add("ticket_path_select", row.inspectionApprovedAtMs, `:${row.itemId}`); continue;
    }
    const allItemsComplete = Number(row.itemCount) <= 1 || Number(row.incompleteItems) === 0;
    const canClose = canManageTicketWorkflow(actor, ticket) && closureRoles.includes(actor.role) && allItemsComplete && Boolean(String(row.repairNotes || "").trim());
    if (canClose && (row.status === "ready_for_closure" && ["A", "B", "C"].includes(row.maintenancePath)
      || row.status === "repaired" && !row.maintenancePath || row.status === "verified" && !row.maintenancePath)) {
      const path = row.maintenancePath === "A" ? "tickets.closeBySupervisor" : row.status === "verified" ? "tickets.finalClose" : "tickets.close";
      if (operationCapability(actor, path)) add("ticket_close", row.enteredAt);
    }
  }
  return result;
}

export async function readTicketOperations(db: OperationsDatabase, actor: OperationsActor): Promise<YourWorkItem[]> {
  if (isRoleDeniedFromTickets(actor.role)) return [];
  const [legacy, planning, teamRows] = await Promise.all([
    operationRows(db, sql`/* your-work:ticket-candidates */ SELECT t.id,t.ticketNumber,t.title,t.status,t.workflowModel,t.reportedById,t.assignedToId,t.supervisorId,
      t.maintenanceResponsibleDepartment,t.maintenanceResponsibleManagerId,t.maintenancePath,t.inspectionWorkflowStatus,t.sourceTaskId,t.repairNotes,
      UNIX_TIMESTAMP(t.createdAt)*1000 AS createdAtMs,UNIX_TIMESTAMP(t.closedAt)*1000 AS closedAtMs,UNIX_TIMESTAMP(t.assignedAt)*1000 AS assignedAtMs,
      UNIX_TIMESTAMP(t.inspectionSubmittedAt)*1000 AS inspectionSubmittedAtMs,UNIX_TIMESTAMP(t.inspectionApprovedAt)*1000 AS inspectionApprovedAtMs,
      i.id AS itemId,i.title AS itemTitle,i.status AS itemStatus,i.maintenancePath AS itemPath,i.responsibleDepartment AS itemDepartment,i.responsibleManagerId AS itemManagerId,i.assignedToId AS itemAssignedToId,i.approvedById AS itemApprovedById,
      a.id AS teamId,a.stage AS teamStage,
      (SELECT UNIX_TIMESTAMP(h.createdAt)*1000 FROM ticket_status_history h WHERE h.ticketId=t.id AND h.toStatus=t.status AND (h.fromStatus IS NULL OR h.fromStatus<>h.toStatus) ORDER BY h.id DESC LIMIT 1) AS enteredAt,
      (SELECT COUNT(*) FROM ticket_items allItems WHERE allItems.ticketId=t.id) AS itemCount,
      (SELECT COUNT(*) FROM ticket_items allItems WHERE allItems.ticketId=t.id AND allItems.status NOT IN ('closed','verified','requester_confirmed')) AS incompleteItems,
      (SELECT COUNT(*) FROM tickets child WHERE child.parentTicketId=t.id AND child.workflowModel='sub_ticket') AS childCount,
      (SELECT COUNT(*) FROM tickets child WHERE child.parentTicketId=t.id AND child.workflowModel='sub_ticket' AND child.status NOT IN ('closed','requester_confirmed')) AS childOpenCount,
      (SELECT UNIX_TIMESTAMP(MAX(child.closedAt))*1000 FROM tickets child WHERE child.parentTicketId=t.id AND child.workflowModel='sub_ticket') AS lastChildClosedAt,
      (SELECT COUNT(*) FROM ticket_tasks task WHERE task.ticketId=t.id AND task.status<>'cancelled' AND task.convertedTicketId IS NULL) AS pendingTaskCount,
      (SELECT COUNT(*) FROM ticket_tasks task WHERE task.ticketId=t.id AND task.status='cancelled' AND task.convertedTicketId IS NULL) AS cancelledPendingTasks,
      review.id AS routeReturnId,JSON_UNQUOTE(JSON_EXTRACT(review.newValues,'$.reviewerId')) AS routeReviewerId,JSON_UNQUOTE(JSON_EXTRACT(review.newValues,'$.ticketId')) AS routeTicketId,UNIX_TIMESTAMP(review.createdAt)*1000 AS routeReturnedAt
      FROM tickets t INNER JOIN ticket_items i ON i.ticketId=t.id LEFT JOIN ticket_team_assignments a ON a.ticketId=t.id AND a.ticketItemId=i.id
      LEFT JOIN audit_logs review ON review.entityType='ticket_item' AND review.entityId=i.id AND review.action='external_route_returned'
        AND NOT EXISTS (SELECT 1 FROM audit_logs later WHERE later.entityType='ticket_item' AND later.entityId=i.id AND later.action IN ('external_route_returned','external_route_decided') AND later.id>review.id)
      WHERE (t.status IN ('pending_triage','under_inspection','ready_for_closure','repaired','verified','closed','department_planning','in_progress','assigned')
        OR (review.id IS NOT NULL AND i.status='under_inspection' AND i.maintenancePath='C')) AND (${ticketScope(actor)})`),
    managers.includes(actor.role) ? operationRows(db, sql`/* your-work:department-planning */ SELECT d.id AS departmentId,d.ticketId,d.department,d.responsibleManagerId,d.claimedById,d.status AS departmentStatus,
      UNIX_TIMESTAMP(d.routedAt)*1000 AS routedAt,UNIX_TIMESTAMP(d.claimedAt)*1000 AS claimedAt,t.status,t.workflowModel,t.ticketNumber,t.title,t.maintenanceResponsibleDepartment,t.assignedToId,
      task.id AS taskId,task.title AS taskTitle,task.status AS taskStatus,UNIX_TIMESTAMP(task.createdAt)*1000 AS taskCreatedAt,
      (SELECT UNIX_TIMESTAMP(MAX(assignee.assignedAt))*1000 FROM ticket_task_assignees assignee WHERE assignee.taskId=task.id) AS namedAssignedAt,
      (SELECT COUNT(*) FROM ticket_task_assignees assignee WHERE assignee.taskId=task.id) AS namedAssignees,
      EXISTS (SELECT 1 FROM ticket_task_assignees assignee WHERE assignee.taskId=task.id AND assignee.userId=${actor.id}) AS actorNamedAssignee
      FROM ticket_departments d INNER JOIN tickets t ON t.id=d.ticketId LEFT JOIN ticket_tasks task ON task.ticketDepartmentId=d.id AND task.ticketId=t.id AND task.status<>'cancelled' AND task.convertedTicketId IS NULL
      WHERE t.workflowModel='department_tasks' AND t.status NOT IN ('closed','requester_confirmed')
      AND (${privilegedOperationActor(actor) ? sql`TRUE` : isItTeamRole(actor.role) ? sql`d.department=${DEPT.IT} AND (d.claimedById=${actor.id} OR d.claimedById IS NULL OR (d.responsibleManagerId=${actor.id} AND ${actor.role}='it_manager') OR EXISTS (SELECT 1 FROM ticket_task_assignees mine WHERE mine.taskId=task.id AND mine.userId=${actor.id}))` : sql`d.responsibleManagerId=${actor.id}`})
      AND (task.id IS NOT NULL OR (d.status='planning' AND NOT EXISTS (SELECT 1 FROM ticket_tasks existing WHERE existing.ticketDepartmentId=d.id AND existing.status<>'cancelled')))`): Promise.resolve([]),
    managers.includes(actor.role) ? operationRows(db, sql`/* your-work:team-review */ SELECT a.id,a.ticketId,a.ticketItemId,a.ticketNumber,a.titleSnapshot AS title,a.stage,a.responsibleManagerId,
      t.maintenanceResponsibleDepartment AS responsibleDepartment,t.maintenanceResponsibleManagerId AS ticketManagerId,
      i.responsibleDepartment AS itemResponsibleDepartment,i.responsibleManagerId AS itemResponsibleManagerId,
      (SELECT UNIX_TIMESTAMP(action.createdAt)*1000 FROM ticket_team_actions action WHERE action.assignmentId=a.id AND
        ((a.stage='awaiting_review' AND action.kind IN ('ok','fixed')) OR (a.stage='blocked' AND action.kind='blocked') OR (a.stage='external_requested' AND action.kind='external')) ORDER BY action.revision DESC,action.id DESC LIMIT 1) AS arrivedAt
      FROM ticket_team_assignments a INNER JOIN tickets t ON t.id=a.ticketId INNER JOIN ticket_items i ON i.id=a.ticketItemId AND i.ticketId=t.id
      WHERE a.stage IN ('awaiting_review','blocked','external_requested') AND t.status NOT IN ('closed','requester_confirmed')
      AND (${privilegedOperationActor(actor) ? sql`TRUE` : sql`a.responsibleManagerId=${actor.id}`})
      AND NOT EXISTS (SELECT 1 FROM ticket_team_actions pending WHERE pending.assignmentId=a.id AND pending.kind='external_route_returned'
        AND NOT EXISTS (SELECT 1 FROM ticket_team_actions decided WHERE decided.assignmentId=a.id AND decided.kind IN ('external_route_returned','external_route_decided') AND decided.revision>pending.revision))`) : Promise.resolve([]),
  ]);
  const result = classifyLegacyTicketOperations(actor, legacy);
  for (const row of planning) {
    if (canClaimItDepartment(actor, row, row) && operationCapability(actor, "tickets.claimItTicket")) {
      result.push(operationItem({ key: `it-claim:${row.departmentId}`, kind: "ticket", reference: row.ticketNumber, title: row.title,
        action: "it_ticket_claim", href: `/tickets/${row.ticketId}?workDepartment=${row.departmentId}`, arrivedAt: row.routedAt }));
      continue;
    }
    if (row.department === DEPT.IT && !row.claimedById) continue;
    if (row.department === DEPT.IT && row.taskId && Number(row.namedAssignees) > 0) {
      if (isItTeamRole(actor.role) && Number(row.actorNamedAssignee) && operationCapability(actor, "tickets.promoteDepartmentTask"))
        result.push(operationItem({ key: `department:${row.departmentId}:${row.taskId}`, kind: "team_task", reference: row.ticketNumber,
          title: row.taskTitle || row.title, action: "ticket_promote", href: `/tickets/${row.ticketId}?workDepartment=${row.departmentId}&workTask=${row.taskId}`, arrivedAt: row.namedAssignedAt }));
      continue;
    }
    if (!canManageOperationDepartment(actor, row) || !personallyResponsible(actor, row.responsibleManagerId) && !(isItTeamRole(actor.role) && Number(row.claimedById) === actor.id)) continue;
    if (row.department === DEPT.CONSTRUCTION && !["owner", "admin", "construction_procurement_manager"].includes(actor.role)) continue;
    const action = !row.taskId ? "ticket_plan" : Number(row.namedAssignees) > 0 ? "ticket_promote" : "ticket_assign";
    const capability = action === "ticket_plan" ? "tickets.createDepartmentTask" : action === "ticket_promote" ? "tickets.promoteDepartmentTask" : row.department === DEPT.IT ? "tickets.assignDepartmentTask" : "ticketTeamAssignments.assign";
    if (!operationCapability(actor, capability)) continue;
    result.push(operationItem({ key: `department:${row.departmentId}:${row.taskId || "plan"}`, kind: "team_task", reference: row.ticketNumber,
      title: row.taskTitle || row.title, action, href: `/tickets/${row.ticketId}?workDepartment=${row.departmentId}${row.taskId ? `&workTask=${row.taskId}` : ""}`,
      arrivedAt: row.taskId ? action === "ticket_promote" ? row.namedAssignedAt : row.taskCreatedAt : row.department === DEPT.IT ? row.claimedAt : row.routedAt }));
  }
  for (const row of teamRows) {
    const isResult = row.stage === "awaiting_review";
    const allowed = isResult ? canApproveTicketTeamResult(actor.role, actor.id, Number(row.responsibleManagerId), row)
      : canReviewTicketTeamExecution(actor.role, actor.id, Number(row.responsibleManagerId));
    if (!allowed || !operationCapability(actor, "ticketTeamExecution.review")) continue;
    result.push(operationItem({ key: `team:${row.id}:${row.stage}`, kind: "team_task", reference: row.ticketNumber, title: row.title,
      action: isResult ? "ticket_work_review" : row.stage === "blocked" ? "ticket_blocker" : "ticket_external_review",
      href: `/maintenance-team-tickets?teamExecution=${row.id}`, arrivedAt: row.arrivedAt }));
  }
  return result;
}

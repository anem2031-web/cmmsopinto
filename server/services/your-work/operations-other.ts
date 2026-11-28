import { sql } from "drizzle-orm";
import type { YourWorkItem } from "../../../shared/your-work";
import { canManageItPurchases } from "../../../shared/itTeamWorkflow";
import { MAINTENANCE_RESPONSIBLE_DEPARTMENT as DEPT, isItTeamRole } from "../../../shared/roles";
import { hasCompleteCostStudy } from "../../../shared/improvement-execution";
import { operationCapability, operationItem, operationRows, type OperationsActor, type OperationsDatabase } from "./operations-port";

export async function readOtherOperations(db: OperationsDatabase, actor: OperationsActor): Promise<YourWorkItem[]> {
  const result: YourWorkItem[] = [];
  const triageIdea = ["owner", "admin", "maintenance_manager", "general_maintenance_manager", "construction_procurement_manager"].includes(actor.role)
    && operationCapability(actor, "improvementIdeas.classify");
  const decideIdea = ["owner", "admin", "senior_management", "executive_director"].includes(actor.role)
    && operationCapability(actor, "improvementIdeas.decide");
  if (triageIdea || decideIdea) {
    const rows = await operationRows(db, sql`/* your-work:ideas */ SELECT i.id,i.requestNumber,i.title,i.status,i.costStudiedAt,i.costStudyRequired,i.executionTrackingVersion,
      i.costStudyById,i.costStudyNotes,i.estimatedMaterialsCost,i.estimatedLaborCost,i.estimatedServicesCost,
      UNIX_TIMESTAMP(i.createdAt)*1000 AS createdAtMs,UNIX_TIMESTAMP(i.costStudiedAt)*1000 AS costStudiedAtMs,
      (SELECT UNIX_TIMESTAMP(a.createdAt)*1000 FROM audit_logs a WHERE a.entityType='improvement_idea' AND a.entityId=i.id AND a.action='classify_improvement_idea' ORDER BY a.id DESC LIMIT 1) AS classifiedAt
      FROM improvement_ideas i WHERE i.status IN ('new','classified')`);
    for (const row of rows) {
      const studyRequired = Number(row.costStudyRequired) === 1 && !(Number(row.executionTrackingVersion) === 1 ? hasCompleteCostStudy(row) : row.costStudiedAt);
      if (!(row.status === "new" && triageIdea || row.status === "classified" && (decideIdea && !studyRequired || triageIdea && studyRequired))) continue;
      const action = row.status === "new" ? "idea_classify" : triageIdea && studyRequired ? "idea_study" : "idea_decide";
      result.push(operationItem({ key: `idea:${row.id}:review`, kind: "idea", reference: row.requestNumber || `#${row.id}`, title: row.title,
        action, href: `/improvement-ideas?workIdea=${row.id}&workAction=${action}`,
        arrivedAt: row.status === "new" ? row.createdAtMs : action === "idea_decide" && Number(row.costStudyRequired) === 1 ? row.costStudiedAtMs : row.classifiedAt }));
    }
  }
  if (actor.role === "it_manager" && operationCapability(actor, "tickets.returnItPurchaseNeed")) {
    const needs = await operationRows(db, sql`/* your-work:it-purchase-needs */ SELECT n.id,n.ticketId,n.managerId,n.reason,t.ticketNumber,t.maintenanceResponsibleDepartment,t.maintenanceResponsibleManagerId,
      UNIX_TIMESTAMP(n.createdAt)*1000 AS arrivedAt FROM it_purchase_needs n INNER JOIN tickets t ON t.id=n.ticketId
      INNER JOIN ticket_items item ON item.id=n.ticketItemId AND item.ticketId=t.id
      WHERE n.status='pending' AND n.managerId=${actor.id} AND t.status NOT IN ('closed','requester_confirmed')`);
    for (const row of needs) if (canManageItPurchases(actor, row)) result.push(operationItem({
      key: `it-need:${row.id}:review`, kind: "it_purchase_need", reference: row.ticketNumber, title: row.reason,
      action: "it_purchase_review", href: `/tickets/${row.ticketId}?workNeed=${row.id}`, arrivedAt: row.arrivedAt,
    }));
  }
  if (isItTeamRole(actor.role)) {
    const waiting = await operationRows(db, sql`/* your-work:it-purchase-create */ SELECT t.id,t.ticketNumber,t.title,t.assignedToId,t.maintenanceResponsibleDepartment,t.maintenanceResponsibleManagerId,
      (SELECT UNIX_TIMESTAMP(h.createdAt)*1000 FROM ticket_status_history h WHERE h.ticketId=t.id AND h.toStatus='work_approved' AND (h.fromStatus IS NULL OR h.fromStatus<>'work_approved') ORDER BY h.id DESC LIMIT 1) AS arrivedAt
      FROM tickets t INNER JOIN ticket_items item ON item.ticketId=t.id
      WHERE t.maintenanceResponsibleDepartment=${DEPT.IT} AND t.status='work_approved' AND t.maintenancePath='B'
      AND (${actor.role === "it_manager" ? sql`t.maintenanceResponsibleManagerId=${actor.id}` : sql`t.assignedToId=${actor.id}`})
      AND NOT EXISTS (SELECT 1 FROM purchase_orders p WHERE p.ticketId=t.id AND p.status IN ('draft','pending_review','pending_estimate','pending_accounting','pending_management','approved','partial_purchase','purchased','received','revision_needed'))
      AND NOT EXISTS (SELECT 1 FROM it_purchase_needs n WHERE n.ticketId=t.id AND n.status='pending')
      AND NOT EXISTS (SELECT 1 FROM ticket_team_assignments a WHERE a.ticketId=t.id)
      AND (SELECT COUNT(*) FROM ticket_items onlyItem WHERE onlyItem.ticketId=t.id)=1`);
    for (const row of waiting) if (operationCapability(actor, actor.role === "it_manager" ? "purchaseOrders.create" : "tickets.submitItPurchaseNeed")) result.push(operationItem({ key: `it-create:${row.id}`, kind: "it_purchase_need", reference: row.ticketNumber, title: row.title,
      action: actor.role === "it_manager" ? "it_purchase_create" : "it_purchase_submit", href: `/tickets/${row.id}?workAction=${actor.role === "it_manager" ? "it_purchase_create" : "it_purchase_submit"}`, arrivedAt: row.arrivedAt }));
  }
  return result;
}

import { sql } from "drizzle-orm";
import type { TeamManagementActor } from "../../../shared/maintenance-team-tickets/team-management";

/** Existing queue membership scope; aliases a/k/t refer to assignment/ticket/team. */
export function ticketTeamQueueScope(actor: TeamManagementActor) {
  return actor.role === "technician"
    ? sql`EXISTS (SELECT 1 FROM maintenance_team_members m INNER JOIN users u ON u.id=m.userId WHERE m.teamId=a.teamId AND m.userId=${actor.id} AND m.isActive=1 AND u.isActive=1 AND u.role='technician') AND t.isActive=1`
    : ["it_manager", "it_member"].includes(actor.role)
      ? sql`k.maintenanceResponsibleDepartment='maintenance_report_department_it' AND k.assignedToId=${actor.id} AND EXISTS (SELECT 1 FROM maintenance_team_members m INNER JOIN users u ON u.id=m.userId WHERE m.teamId=a.teamId AND m.userId=${actor.id} AND m.isActive=1 AND u.isActive=1 AND u.role IN ('it_manager','it_member')) AND t.isActive=1`
      : sql`TRUE`;
}

/** Applies only to execution in the maintenance-team ticket window. */
export const TICKET_TEAM_EXECUTION_OVERRIDE_ROLES = [
  "owner",
  "admin",
  "maintenance_manager",
  "general_maintenance_manager",
  "construction_procurement_manager",
] as const;

export function canExecuteAllTicketTeams(role?: string | null): boolean {
  return (
    !!role &&
    (TICKET_TEAM_EXECUTION_OVERRIDE_ROLES as readonly string[]).includes(role)
  );
}

export function canReadTicketTeamExecution(role?: string | null): boolean {
  return (
    role === "technician" ||
    role === "it_manager" ||
    role === "it_member" ||
    role === "warehouse" ||
    canExecuteAllTicketTeams(role)
  );
}

export function canReviewTicketTeamExecution(
  role: string,
  actorId: number,
  responsibleManagerId: number | undefined
): boolean {
  return (
    role === "owner" ||
    role === "admin" ||
    ((role === "maintenance_manager" ||
      role === "general_maintenance_manager" ||
      role === "it_manager") &&
      actorId === responsibleManagerId)
  );
}

/** Result approval only; construction ownership must agree across ticket, item and assignment. */
export function canApproveTicketTeamResult(
  role: string, actorId: number, responsibleManagerId: number | undefined,
  ticket?: { responsibleDepartment?: string | null; ticketManagerId?: number | null; itemResponsibleDepartment?: string | null; itemResponsibleManagerId?: number | null },
): boolean {
  if (role !== "construction_procurement_manager") return canReviewTicketTeamExecution(role, actorId, responsibleManagerId);
  return Number.isSafeInteger(actorId) && actorId > 0 && actorId === responsibleManagerId &&
    ticket?.responsibleDepartment === "maintenance_report_department_construction" && ticket.ticketManagerId === actorId &&
    ticket.itemResponsibleDepartment === "maintenance_report_department_construction" && ticket.itemResponsibleManagerId === actorId;
}

/** Exact workspace capabilities. Unknown APIs stay denied for technicians. */
export const TECHNICIAN_WORKSPACE_PATH = "/scheduled-maintenance/my-tasks";
export const technicianPageAllowed = (path: string) => path.split(/[?#]/, 1)[0] === TECHNICIAN_WORKSPACE_PATH;
export const TECHNICIAN_QUERY_PATHS = [
  "auth.me", "notifications.summary", "notifications.list", "notifications.unreadCount", "push.getStatus", "push.getVapidPublicKey",
  "tickets.list", "tickets.listPaginated", "tickets.getById", "tickets.items", "tickets.departmentPlan",
  "tickets.history", "tickets.getConfirmation", "tickets.executionReferences", "inspectionResults.listByTicket",
  "improvementIdeas.executionReference",
  "ticketTeamAssignments.queue", "ticketTeamAssignments.list", "ticketTeamExecution.details", "ticketTeamExecution.balances",
  "ticketTeamExecution.catalog", "ticketTeamExecution.preview", "ticketTeamExecution.units",
  "pmv2.technician.workspace", "pmv2.technician.today", "pmv2.technician.materialAttention",
  "pmv2.technician.items", "pmv2.technician.ticketHandoffContext", "pmv2.technician.evidence",
  "pmv2.technician.materialCatalog", "pmv2.technician.completionMaterials", "pmv2.technician.materialState",
  "pmv2.technician.readyMaterialReceipts", "pmv2.technician.visitState", "pmv2.technician.timeline",
  "attachments.list", "translation.getEntityTranslations", "translation.getBatchTranslations",
] as const;
export const TECHNICIAN_MUTATION_PATHS = [
  "auth.login", "auth.logout", "auth.changePassword", "translation.setLanguage",
  "notifications.markRead", "notifications.markAllRead", "audit.recordPwaUpdateDecision", "push.subscribe", "push.unsubscribe",
  "tickets.inspectTicket", "tickets.startRepair", "tickets.completeRepair", "tickets.startRepairForItem",
  "tickets.completeRepairForItem", "tickets.markReadyForClosure", "tickets.completeWithParts",
  "tickets.update", "tickets.confirmCompletion", "tickets.create",
  "ticketTeamExecution.startItem", "ticketTeamExecution.resumeItem", "ticketTeamExecution.endVisit",
  "ticketTeamExecution.beginMaterialNeed", "ticketTeamExecution.registerMaterialNeed",
  "ticketTeamExecution.receive", "ticketTeamExecution.outcome",
  "pmv2.technician.startItem", "pmv2.technician.resumeItem", "pmv2.technician.endVisit",
  "pmv2.technician.submitBasicResult", "pmv2.technician.submitDependencyResult",
  "pmv2.technician.submitMaterialNeed", "pmv2.technician.submitAndReceiveMaterialNeed", "pmv2.technician.receiveReadyMaterial",
  "attachments.add",
] as const;
export type TechnicianIdentity = { id?: number; role: string; isActive?: number };
export function technicianRpcAllowed(user: TechnicianIdentity | null | undefined, type: string, path: string): boolean {
  if (user?.role !== "technician") return true;
  if (type === "mutation" && path === "auth.logout") return true;
  if (user.isActive !== 1) return false;
  return type === "query" ? (TECHNICIAN_QUERY_PATHS as readonly string[]).includes(path)
    : type === "mutation" && (TECHNICIAN_MUTATION_PATHS as readonly string[]).includes(path);
}
export function technicianHttpAllowed(user: TechnicianIdentity | null | undefined, method: string, path: string): boolean {
  if (user?.role !== "technician") return true;
  if (user.isActive !== 1) return false;
  return (method === "POST" && path === "/api/upload")
    || (method === "GET" && /^\/api\/tickets\/[1-9]\d*\/pdf$/.test(path));
}

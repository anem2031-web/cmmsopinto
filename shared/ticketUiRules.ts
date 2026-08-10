import { APP_ROLE } from "./roles";

/** Roles allowed to retain ticket documents after closure and download the archive record. */
export const TICKET_DOCUMENT_MANAGER_ROLES = new Set<string>([
  APP_ROLE.MAINTENANCE_MANAGER,
  APP_ROLE.CONSTRUCTION_PROCUREMENT_MANAGER,
  APP_ROLE.GENERAL_MAINTENANCE_MANAGER,
  APP_ROLE.ADMIN,
  APP_ROLE.OWNER,
]);

export const TICKET_CLOSED_STATUSES = new Set<string>([
  "closed",
  "requester_confirmed",
]);

export function isTicketClosedForDocuments(status?: string | null): boolean {
  return !!status && TICKET_CLOSED_STATUSES.has(status);
}

/** Ticket details can only be edited while still waiting for classification. */
export function isTicketEditableBeforeTriage(status?: string | null): boolean {
  return status === "pending_triage";
}


export const TICKET_REPAIR_START_STATUSES = new Set<string>([
  "work_approved",
  "assigned",
]);

/**
 * Starting repair is path-aware:
 * - Path A starts after work approval/direct assignment.
 * - Path B starts only after every active purchased item is delivered to the technician.
 * - Path C starts only after gate entry, warehouse receipt, and handover for reinstall.
 * - Legacy tickets without a path keep the old direct-repair behavior.
 */
export function canStartTicketRepair(
  isExecutor: boolean,
  status?: string | null,
  maintenancePath?: string | null,
): boolean {
  if (!isExecutor || !status) return false;
  if (maintenancePath === "B") return status === "received_warehouse";
  if (maintenancePath === "C") return status === "received_warehouse";
  return TICKET_REPAIR_START_STATUSES.has(status);
}

/** Path A completion controls become available only after Start Repair moves the ticket to in_progress. */
export function isPathARepairCompletionStage(
  status?: string | null,
  maintenancePath?: string | null,
): boolean {
  return status === "in_progress" && maintenancePath === "A";
}

export function canSubmitPathARepair(
  isExecutor: boolean,
  status?: string | null,
  maintenancePath?: string | null,
): boolean {
  return isExecutor && isPathARepairCompletionStage(status, maintenancePath);
}

/** Repair completion requires written notes; the after-repair photo is optional. */
export function isRepairEvidenceComplete(
  repairNotes?: string | null,
  _afterPhotoUrl?: string | null,
): boolean {
  return Boolean(repairNotes?.trim());
}

export const isPathARepairEvidenceComplete = isRepairEvidenceComplete;
export const isPathBRepairEvidenceComplete = isRepairEvidenceComplete;

/** The legacy/general completion form must not compete with Path A, B, or C. */
export function canSubmitStandardRepair(
  isExecutor: boolean,
  status?: string | null,
  maintenancePath?: string | null,
): boolean {
  return Boolean(
    isExecutor &&
    status === "in_progress" &&
    maintenancePath !== "A" &&
    maintenancePath !== "B" &&
    maintenancePath !== "C"
  );
}

/** Path B is completed only after Start Repair and with evidence. */
export function canSubmitPathBRepair(
  isExecutor: boolean,
  status?: string | null,
  maintenancePath?: string | null,
): boolean {
  return Boolean(isExecutor && status === "in_progress" && maintenancePath === "B");
}

export const TICKET_PURCHASE_ORDER_CREATION_STATUSES = new Set<string>([
  "work_approved",
]);

/** Ticket-linked purchase orders belong exclusively to Path B. */
export function isPurchaseOrderAllowedForMaintenancePath(maintenancePath?: string | null): boolean {
  return maintenancePath === "B";
}

export function canCreateTicketPurchaseOrder(
  isManager: boolean,
  status?: string | null,
  maintenancePath?: string | null,
  hasActiveLinkedPurchaseOrder = false,
): boolean {
  return Boolean(
    isManager &&
    status &&
    !hasActiveLinkedPurchaseOrder &&
    isPurchaseOrderAllowedForMaintenancePath(maintenancePath) &&
    TICKET_PURCHASE_ORDER_CREATION_STATUSES.has(status),
  );
}

/**
 * The field task sheet appears immediately after classification.
 * After closure it is retained only for the archival/manager roles.
 */
export function canPrintTicketTask(role?: string | null, status?: string | null): boolean {
  if (!role || !status || status === "new" || status === "pending_triage") return false;
  if (isTicketClosedForDocuments(status)) {
    return !!role && TICKET_DOCUMENT_MANAGER_ROLES.has(role);
  }
  return true;
}

/** The full archive report is available only after closure to the approved roles. */
export function canDownloadTicketArchive(role?: string | null, status?: string | null): boolean {
  return !!role && isTicketClosedForDocuments(status) && TICKET_DOCUMENT_MANAGER_ROLES.has(role);
}

/** Technician assignment/reassignment management is restricted to these roles. */
export function hasTicketTechnicianAssignmentRole(role?: string | null): boolean {
  return !!role && TICKET_DOCUMENT_MANAGER_ROLES.has(role);
}

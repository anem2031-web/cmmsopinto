import { describe, expect, it } from "vitest";
import { APP_ROLE } from "../../shared/roles";
import {
  canCreateTicketPurchaseOrder,
  canDownloadTicketArchive,
  canPrintTicketTask,
  canStartTicketRepair,
  canSubmitPathARepair,
  canSubmitPathBRepair,
  canSubmitStandardRepair,
  isPathARepairCompletionStage,
  isPathARepairEvidenceComplete,
  isPathBRepairEvidenceComplete,
  hasTicketTechnicianAssignmentRole,
  isPurchaseOrderAllowedForMaintenancePath,
  isTicketEditableBeforeTriage,
} from "../../shared/ticketUiRules";

const documentRoles = [
  APP_ROLE.MAINTENANCE_MANAGER,
  APP_ROLE.CONSTRUCTION_PROCUREMENT_MANAGER,
  APP_ROLE.GENERAL_MAINTENANCE_MANAGER,
  APP_ROLE.ADMIN,
  APP_ROLE.OWNER,
];

describe("ticket document visibility", () => {
  it("hides both ticket documents before classification", () => {
    expect(canPrintTicketTask(APP_ROLE.TECHNICIAN, "pending_triage")).toBe(false);
    expect(canDownloadTicketArchive(APP_ROLE.OWNER, "pending_triage")).toBe(false);
  });

  it("shows the task sheet after classification while the ticket is active", () => {
    expect(canPrintTicketTask(APP_ROLE.TECHNICIAN, "under_inspection")).toBe(true);
    expect(canPrintTicketTask(APP_ROLE.OPERATOR, "in_progress")).toBe(true);
  });

  it("retains task printing after closure only for document manager roles", () => {
    for (const role of documentRoles) {
      expect(canPrintTicketTask(role, "closed")).toBe(true);
      expect(canPrintTicketTask(role, "requester_confirmed")).toBe(true);
    }
    expect(canPrintTicketTask(APP_ROLE.TECHNICIAN, "closed")).toBe(false);
    expect(canPrintTicketTask(APP_ROLE.OPERATOR, "requester_confirmed")).toBe(false);
  });

  it("shows the archival report only after closure to the approved roles", () => {
    for (const role of documentRoles) {
      expect(canDownloadTicketArchive(role, "closed")).toBe(true);
      expect(canDownloadTicketArchive(role, "requester_confirmed")).toBe(true);
      expect(canDownloadTicketArchive(role, "ready_for_closure")).toBe(false);
    }
    expect(canDownloadTicketArchive(APP_ROLE.SUPERVISOR, "closed")).toBe(false);
  });
});

describe("ticket edit and technician reassignment rules", () => {
  it("allows ticket detail editing only before classification", () => {
    expect(isTicketEditableBeforeTriage("pending_triage")).toBe(true);
    for (const status of ["under_inspection", "work_approved", "closed"]) {
      expect(isTicketEditableBeforeTriage(status)).toBe(false);
    }
  });

  it("limits assignment management to the requested manager roles", () => {
    for (const role of documentRoles) expect(hasTicketTechnicianAssignmentRole(role)).toBe(true);
    expect(hasTicketTechnicianAssignmentRole(APP_ROLE.PURCHASE_MANAGER)).toBe(false);
    expect(hasTicketTechnicianAssignmentRole(APP_ROLE.SUPERVISOR)).toBe(false);
    expect(hasTicketTechnicianAssignmentRole(APP_ROLE.TECHNICIAN)).toBe(false);
  });
});


describe("ticket purchase-order visibility", () => {
  it("hides the new purchase-order action for direct-repair path A", () => {
    expect(isPurchaseOrderAllowedForMaintenancePath("A")).toBe(false);
    expect(canCreateTicketPurchaseOrder(true, "work_approved", "A")).toBe(false);
    expect(canCreateTicketPurchaseOrder(true, "in_progress", "A")).toBe(false);
  });

  it("exposes the action only for path B before an active linked order exists", () => {
    expect(canCreateTicketPurchaseOrder(true, "work_approved", "B")).toBe(true);
    expect(canCreateTicketPurchaseOrder(true, "work_approved", "B", true)).toBe(false);
    expect(canCreateTicketPurchaseOrder(true, "work_approved", "C")).toBe(false);
  });

  it("does not expose the action to non-managers or unsupported statuses", () => {
    expect(canCreateTicketPurchaseOrder(false, "work_approved", "B")).toBe(false);
    expect(canCreateTicketPurchaseOrder(true, "closed", "B")).toBe(false);
  });
});


describe("path A repair start gate", () => {
  it("shows only the start action immediately after path A approval", () => {
    expect(canStartTicketRepair(true, "work_approved", "A")).toBe(true);
    expect(canSubmitPathARepair(true, "work_approved", "A")).toBe(false);
    expect(isPathARepairCompletionStage("work_approved", "A")).toBe(false);
  });

  it("reveals path A repair completion only after start moves the ticket to in_progress", () => {
    expect(canStartTicketRepair(true, "in_progress", "A")).toBe(false);
    expect(canSubmitPathARepair(true, "in_progress", "A")).toBe(true);
    expect(isPathARepairCompletionStage("in_progress", "A")).toBe(true);
  });

  it("keeps the general completion form hidden for path A", () => {
    expect(canSubmitStandardRepair(true, "in_progress", "A")).toBe(false);
    expect(canSubmitStandardRepair(true, "in_progress", "B")).toBe(false);
    expect(canSubmitStandardRepair(true, "in_progress", "C")).toBe(false);
    expect(canSubmitStandardRepair(true, "in_progress", null)).toBe(true);
  });

  it("does not expose either action to a non-executor", () => {
    expect(canStartTicketRepair(false, "work_approved", "A")).toBe(false);
    expect(canSubmitPathARepair(false, "in_progress", "A")).toBe(false);
  });
});


describe("path A repair evidence requirements", () => {
  it("requires written repair notes while the after-repair photo is optional", () => {
    expect(isPathARepairEvidenceComplete("تم استبدال القطعة التالفة", "/uploads/after.jpg")).toBe(true);
    expect(isPathARepairEvidenceComplete("   ", "/uploads/after.jpg")).toBe(false);
    expect(isPathARepairEvidenceComplete("تم الإصلاح", "   ")).toBe(true);
    expect(isPathARepairEvidenceComplete("تم الإصلاح", undefined)).toBe(true);
    expect(isPathARepairEvidenceComplete(undefined, undefined)).toBe(false);
  });
});


describe("path B purchase and repair gates", () => {
  it("does not start repair before materials are delivered to the technician", () => {
    expect(canStartTicketRepair(true, "work_approved", "B")).toBe(false);
    expect(canStartTicketRepair(true, "purchased", "B")).toBe(false);
    expect(canStartTicketRepair(true, "received_warehouse", "B")).toBe(true);
  });

  it("shows path B completion only after Start Repair", () => {
    expect(canSubmitPathBRepair(true, "received_warehouse", "B")).toBe(false);
    expect(canSubmitPathBRepair(true, "in_progress", "B")).toBe(true);
    expect(canSubmitPathBRepair(true, "in_progress", "A")).toBe(false);
  });

  it("requires notes while the after-repair photo is optional for path B", () => {
    expect(isPathBRepairEvidenceComplete("تم تركيب القطعة واختبارها", "/uploads/path-b-after.jpg")).toBe(true);
    expect(isPathBRepairEvidenceComplete("", "/uploads/path-b-after.jpg")).toBe(false);
    expect(isPathBRepairEvidenceComplete("تم الإصلاح", "")).toBe(true);
    expect(isPathBRepairEvidenceComplete("تم الإصلاح", undefined)).toBe(true);
  });
});


describe("path C external maintenance gates", () => {
  it("starts reinstall only after the warehouse has handed the returned asset over", () => {
    expect(canStartTicketRepair(true, "work_approved", "C")).toBe(false);
    expect(canStartTicketRepair(true, "out_for_repair", "C")).toBe(false);
    expect(canStartTicketRepair(true, "received_warehouse", "C")).toBe(true);
  });
});

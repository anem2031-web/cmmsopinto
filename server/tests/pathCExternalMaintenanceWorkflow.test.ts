import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  EXTERNAL_MAINTENANCE_STATUS,
  canGateApproveExternalEntry,
  canGateApproveExternalExit,
  canStartExternalReinstall,
  canWarehouseHandOverExternalAsset,
  canWarehouseReceiveExternalAsset,
} from "../../shared/externalMaintenanceWorkflow";
import { canStartTicketRepair, canSubmitStandardRepair } from "../../shared/ticketUiRules";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("Path C external maintenance state gates", () => {
  it("requires warehouse preparation before gate exit", () => {
    expect(canGateApproveExternalExit(EXTERNAL_MAINTENANCE_STATUS.WAITING_WAREHOUSE_PREPARATION)).toBe(false);
    expect(canGateApproveExternalExit(EXTERNAL_MAINTENANCE_STATUS.WAITING_DELEGATE_RECEIPT)).toBe(false);
    expect(canGateApproveExternalExit(EXTERNAL_MAINTENANCE_STATUS.WAITING_GATE_EXIT)).toBe(true);
  });

  it("requires delegate completion before gate entry", () => {
    expect(canGateApproveExternalEntry(EXTERNAL_MAINTENANCE_STATUS.PURCHASE_CYCLE)).toBe(false);
    expect(canGateApproveExternalEntry(EXTERNAL_MAINTENANCE_STATUS.WAITING_GATE_ENTRY)).toBe(true);
  });

  it("requires gate entry, warehouse receipt and handover in order", () => {
    expect(canWarehouseReceiveExternalAsset(EXTERNAL_MAINTENANCE_STATUS.WAITING_GATE_ENTRY)).toBe(false);
    expect(canWarehouseReceiveExternalAsset(EXTERNAL_MAINTENANCE_STATUS.WAITING_WAREHOUSE_RECEIPT)).toBe(true);
    expect(canWarehouseHandOverExternalAsset(EXTERNAL_MAINTENANCE_STATUS.WAITING_WAREHOUSE_RECEIPT)).toBe(false);
    expect(canWarehouseHandOverExternalAsset(EXTERNAL_MAINTENANCE_STATUS.WAITING_TECHNICIAN_HANDOVER)).toBe(true);
    expect(canStartExternalReinstall(EXTERNAL_MAINTENANCE_STATUS.DELIVERED_FOR_REINSTALL)).toBe(true);
  });

  it("unlocks the ticket start action only after warehouse handover", () => {
    expect(canStartTicketRepair(true, "work_approved", "C")).toBe(false);
    expect(canStartTicketRepair(true, "out_for_repair", "C")).toBe(false);
    expect(canStartTicketRepair(true, "received_warehouse", "C")).toBe(true);
    expect(canSubmitStandardRepair(true, "in_progress", "C")).toBe(false);
  });
});

describe("Path C implementation contract", () => {
  it("uses warehouse preparation, system gate approvals, linked PO flow and warehouse return handover", () => {
    const router = read("server/routers/external-maintenance/external-maintenance.router.ts");
    const db = read("server/_core/db/external-maintenance.ts");
    const purchase = read("server/routers/purchase/purchase-orders.router.ts");

    expect(router).toContain("prepareByWarehouse");
    expect(router).toContain("approveGateExit");
    expect(router).toContain("approveGateEntry");
    expect(router).toContain("receiveByWarehouse");
    expect(router).toContain("handoverByWarehouse");
    expect(db).toContain('status: "waiting_delegate_receipt"');
    expect(db).toContain("decideExternalMaintenanceDelegateReceipt");
    expect(db).toContain("hasCurrentExternalDelegateReceipt(job)");
    expect(db).toContain('status: "purchase_cycle"');
    expect(db).toContain('status: "waiting_warehouse_receipt"');
    expect(db).toContain('status: "delivered_for_reinstall"');
    expect(purchase).toContain('status: "waiting_gate_entry"');
  });

  it("blocks legacy ticket-level gate and external-repair shortcuts", () => {
    const legacy = read("server/routers/tickets/tickets.external.ts");
    expect(legacy).toContain("لا يمكن اعتماد الخروج مباشرة من البلاغ");
    expect(legacy).toContain("لا يمكن اعتماد الدخول مباشرة من البلاغ");
    expect(legacy).toContain("اكتمال الصيانة الخارجية يُسجل من دورة التسعير والاعتمادات");
  });

  it("keeps the assigned technician fixed and requires an actual recipient at handover", () => {
    const warehouse = read("client/src/pages/purchase/ExternalMaintenanceWarehouseTab.tsx");
    const router = read("server/routers/external-maintenance/external-maintenance.router.ts");
    expect(warehouse).toContain("t.workflow.purchase.assignedResponsibleReadOnly");
    expect(warehouse).toContain("t.workflow.purchase.actualRecipientRequired");
    expect(router).toContain("actualRecipientId: z.number()");
  });

  it("archives both gate approvals and all external-maintenance custody documents", () => {
    const pdf = read("server/services/pdf/ticketPdfService.ts");
    expect(pdf).toContain("دورة الصيانة الخارجية وحركة الأصل");
    expect(pdf).toContain("حامل الأصل عند الخروج");
    expect(pdf).toContain("معيد الأصل");
    expect(pdf).toContain("وثيقة التسليم للتركيب");
  });
});

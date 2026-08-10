import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("ticket UI integration contract", () => {
  it("removes edit actions after classification in both detail and list views", () => {
    const list = read("client/src/pages/tickets/GeneralTicketsList.tsx");
    const detail = read("client/src/pages/tickets/TicketDetail.tsx");
    expect(list).toContain("isTicketEditableBeforeTriage(ticket.status)");
    expect(detail).toContain("isTicketEditableBeforeTriage(ticket.status)");
  });

  it("uses separate secured task and archive ticket documents", () => {
    const detail = read("client/src/pages/tickets/TicketDetail.tsx");
    const endpoint = read("server/_core/index.ts");
    expect(detail).toContain("?document=archive");
    expect(detail).toContain("?document=task");
    expect(detail).toContain("تحميل التقرير الأرشيفي");
    expect(endpoint).toContain("canDownloadTicketArchive");
    expect(endpoint).toContain("canPrintTicketTask");
  });

  it("keeps the current assignee fixed until the dedicated change action is opened", () => {
    const detail = read("client/src/pages/tickets/TicketDetail.tsx");
    const approvals = read("server/routers/tickets/tickets.approvals.ts");
    expect(detail).toContain("الفني المسند حاليًا");
    expect(detail).toContain("تغيير إعادة إسناد الفني");
    expect(detail).toContain("Number(selectedTech) === ticket.assignedToId");
    expect(approvals).toContain("الفني المحدد هو الفني المسند حاليًا");
  });

  it("adds the construction tab and department filter to the inbox", () => {
    const inbox = read("client/src/pages/tickets/TicketsInbox.tsx");
    expect(inbox).toContain("ticketInboxUrl");
    expect(inbox).toContain("TICKET_LIST_TAB.CONSTRUCTION");
    expect(inbox).toContain("MAINTENANCE_RESPONSIBLE_DEPARTMENT.CONSTRUCTION");
  });

  it("clarifies inspection revision, draft, performer and recorder labels", () => {
    const detail = read("client/src/pages/tickets/TicketDetail.tsx");
    expect(detail).toContain("نسخة نتيجة الفحص رقم");
    expect(detail).toContain("مسودة محفوظة — لم تُرسل للمراجعة");
    expect(detail).toContain("من قام بالفحص ميدانيًا");
    expect(detail).toContain("من أدخل النتيجة في النظام");
  });

  it("hides and rejects new purchase orders for direct-repair path A", () => {
    const detail = read("client/src/pages/tickets/TicketDetail.tsx");
    const purchaseRouter = read("server/routers/purchase/purchase-orders.router.ts");
    expect(detail).toContain("canCreateTicketPurchaseOrder");
    expect(purchaseRouter).toContain("assertTicketAllowsNewPurchaseOrder(input.ticketId)");
    expect(purchaseRouter).toContain("assertTicketAllowsNewPurchaseOrder(po.ticketId ?? undefined)");
  });

  it("gates path A repair evidence behind the start-repair transition in UI and server", () => {
    const detail = read("client/src/pages/tickets/TicketDetail.tsx");
    const closure = read("server/routers/tickets/tickets.closure.ts");
    const approvals = read("server/routers/tickets/tickets.approvals.ts");
    expect(detail).toContain("canSubmitPathARepair");
    expect(detail).toContain("canSubmitStandardRepair");
    expect(detail).toContain("canStartTicketRepair");
    expect(closure).toContain("isPathARepairCompletionStage(ticket.status, ticket.maintenancePath)");
    expect(closure).toContain("يجب الضغط على بدء الإصلاح");
    expect(approvals).toContain("canStartTicketRepair(true, ticket.status, ticket.maintenancePath)");
    expect(approvals).toContain("canSubmitStandardRepair(true, ticket.status, ticket.maintenancePath)");
  });

  it("keeps path A completion disabled until repair notes are present while the photo is optional", () => {
    const detail = read("client/src/pages/tickets/TicketDetail.tsx");
    const closure = read("server/routers/tickets/tickets.closure.ts");
    expect(detail).toContain("isPathARepairEvidenceComplete(repairNotes, afterPhotoUrl)");
    expect(detail).toContain("disabled={markReadyMut.isPending || !isPathARepairEvidenceReady}");
    expect(detail).toContain("afterRepairPhotoOptional");
    expect(closure).toContain('afterPhotoUrl: z.string().optional()');
    expect(closure).toContain('repairNotes: z.string().trim().min(1, "ملاحظات الإصلاح مطلوبة")');
    expect(closure).toContain("isPathARepairEvidenceComplete(input.repairNotes, input.afterPhotoUrl)");
    expect(closure).toContain("يجب كتابة ملاحظات الإصلاح قبل إرسال البلاغ للإغلاق");
  });

  it("enforces the Path B purchase and repair cycle in UI and server", () => {
    const detail = read("client/src/pages/tickets/TicketDetail.tsx");
    const approvals = read("server/routers/tickets/tickets.approvals.ts");
    const closure = read("server/routers/tickets/tickets.closure.ts");
    const purchaseRouter = read("server/routers/purchase/purchase-orders.router.ts");
    const purchaseWorkflow = read("server/routers/purchase/ticket-purchase-workflow.ts");
    const legacyWorkflow = read("server/routers/tickets/tickets.workflow.ts");

    expect(detail).toContain("canSubmitPathBRepair");
    expect(detail).toContain("isPathBRepairEvidenceComplete(repairNotes, afterPhotoUrl)");
    expect(detail).toContain("ACTIVE_PATH_B_PURCHASE_ORDER_STATUSES");
    expect(approvals).toContain("assertPathBMaterialsDeliveredToTechnician(ticket.id)");
    expect(closure).toContain('const expectedStatus = "in_progress"');
    expect(closure).toContain("isPathBRepairEvidenceComplete(input.repairNotes, input.afterPhotoUrl)");
    expect(purchaseRouter).toContain("syncPathBTicketFromPurchaseOrder");
    expect(purchaseWorkflow).toContain("ACTIVE_PATH_B_PURCHASE_ORDER_STATUSES");
    expect(legacyWorkflow).toContain("legacyTicketPurchaseWorkflowDisabled");
  });

  it("restores the actual create-purchase-order screen and validates linked Path B tickets", () => {
    const createPage = read("client/src/pages/purchase/CreatePurchaseOrder.tsx");
    expect(createPage).toContain("export default function CreatePurchaseOrder");
    expect(createPage).toContain("isLinkedTicketActionBlocked");
    expect(createPage).toContain('ticket.maintenancePath !== "B"');
    expect(createPage).toContain("purchaseOrders.create.useMutation");
  });

  it("closes Path B only from ready_for_closure with stored evidence and blocks legacy closure routes", () => {
    const closure = read("server/routers/tickets/tickets.closure.ts");
    const workflow = read("server/routers/tickets/tickets.workflow.ts");
    expect(closure).toContain('ticket.status === "ready_for_closure"');
    expect(closure).toContain('ticket.maintenancePath === "B" || ticket.maintenancePath === "C"');
    expect(closure).toContain("لا يمكن إغلاق البلاغ دون ملاحظات الإصلاح");
    expect(closure).toContain("الإغلاق النهائي القديم غير متاح لمسارات الصيانة A/B/C");
    expect(workflow).toContain("هذا الإجراء القديم غير متاح لمسارات الصيانة A/B/C");
  });

});

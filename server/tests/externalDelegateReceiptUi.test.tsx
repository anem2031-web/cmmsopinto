import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import ar from "../../client/src/i18n/ar";
import en from "../../client/src/i18n/en";
import ur from "../../client/src/i18n/ur";
import { APP_ROLE, isDelegateRole } from "../../shared/roles";

const fixture = vi.hoisted(() => ({
  actual: { id: 7, role: "delegate", isActive: 1 } as any, user: { id: 7, role: "delegate", isActive: 1 } as any,
  loading: false, language: "ar", translations: {} as any, rows: [] as any[], warehouse: { waitingPreparation: [], jobs: [] } as any,
  cells: [] as any[], cursor: 0, buttons: [] as any[], inputs: [] as any[], areas: [] as any[], calls: [] as any[], queries: [] as string[],
  pending: false, callbacks: {} as Record<string, any>, invalidations: [] as string[],
}));
vi.mock("react", async original => ({ ...await original<typeof import("react")>(), useState: (initial: any) => {
  const index = fixture.cursor++;
  if (!(index in fixture.cells)) fixture.cells[index] = typeof initial === "function" ? initial() : initial;
  return [fixture.cells[index], (value: any) => { fixture.cells[index] = typeof value === "function" ? value(fixture.cells[index]) : value; }];
} }));
vi.mock("../../client/src/_core/hooks/useAuth", () => ({ useAuth: () => ({ authenticatedUser: fixture.actual, user: fixture.user, loading: fixture.loading }) }));
vi.mock("../../client/src/contexts/LanguageContext", () => ({
  useTranslation: () => ({ t: fixture.translations, language: fixture.language, dir: fixture.language === "en" ? "ltr" : "rtl" }),
  useLanguage: () => ({ language: fixture.language, dir: fixture.language === "en" ? "ltr" : "rtl" }),
}));
vi.mock("../../client/src/hooks/useContentTranslation", () => ({ useBatchTranslation: () => ({ translationsMap: {} }) }));
vi.mock("../../client/src/hooks/useOfflineUpload", () => ({ compressImage: vi.fn() }));
vi.mock("../../client/src/i18n/apiError", () => ({ localizeApiError: (message: string) => message }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("../../client/src/components/ui/button", () => ({ Button: (props: any) => { fixture.buttons.push(props); return <button {...props} />; } }));
vi.mock("../../client/src/components/ui/input", () => ({ Input: (props: any) => { fixture.inputs.push(props); return <input {...props} />; } }));
vi.mock("../../client/src/components/ui/textarea", () => ({ Textarea: (props: any) => { fixture.areas.push(props); return <textarea {...props} />; } }));
vi.mock("../../client/src/components/ui/dialog", () => ({
  Dialog: ({ open, children }: any) => open ? <section role="dialog">{children}</section> : null,
  DialogContent: ({ children }: any) => <div>{children}</div>, DialogFooter: ({ children }: any) => <footer>{children}</footer>,
  DialogHeader: ({ children }: any) => <header>{children}</header>, DialogTitle: ({ children }: any) => <h2>{children}</h2>,
}));
vi.mock("../../client/src/components/ui/tabs", () => ({
  Tabs: ({ children }: any) => <div>{children}</div>, TabsContent: ({ children }: any) => <div>{children}</div>,
  TabsList: ({ children }: any) => <div>{children}</div>, TabsTrigger: ({ children }: any) => <span>{children}</span>,
}));
vi.mock("../../client/src/lib/trpc", () => {
  const mutation = (name: string) => ({ useMutation: (callbacks: any) => {
    fixture.callbacks[name] = callbacks;
    return { isPending: fixture.pending, reset: vi.fn(), mutate: (input: any) => fixture.calls.push({ name, input }) };
  } });
  const invalidate = (name: string) => ({ invalidate: () => fixture.invalidations.push(name) });
  return { trpc: {
    useUtils: () => ({ externalMaintenance: { listForDelegate: invalidate("delegate"), listForWarehouse: invalidate("warehouse") } }),
    users: { list: { useQuery: () => ({ data: [{ id: 7, role: "delegate", name: "Delegate", isActive: 1 }] }) } },
    externalMaintenance: {
      listForDelegate: { useQuery: () => { fixture.queries.push("delegate"); return { data: fixture.rows, isLoading: false }; } },
      listForWarehouse: { useQuery: () => ({ data: fixture.warehouse, isLoading: false }) },
      decideDelegateReceipt: mutation("decision"), prepareByWarehouse: mutation("prepare"), returnForRouteReview: mutation("route"),
      receiveByWarehouse: mutation("receive"), handoverByWarehouse: mutation("handover"),
    },
  } };
});
vi.mock("../../client/src/lib/printExternalMaintenanceDocument", () => ({ printExternalMaintenanceDocument: vi.fn() }));

import { DelegateExternalMaintenanceCards } from "../../client/src/components/purchase/DelegateExternalMaintenanceCards";
import ExternalMaintenanceWarehouseTab, { externalPreparationDraft, externalPreparationRows } from "../../client/src/pages/purchase/ExternalMaintenanceWarehouseTab";
import { printExternalMaintenanceDocument } from "../../client/src/lib/printExternalMaintenanceDocument";

const prepared = (): any => ({ ticketId: 9, ticketItemId: 10, ticketNumber: "MT-2026-010", ticketTitle: "Original ticket title", ticketDescription: "Original fault details",
  job: { id: 20, ticketId: 9, ticketItemId: 10, delegateId: 7, purchaseTitle: "صيانة موتور  Original title", assetName: "Asset A", assetBeforeCondition: "Stopped", warehouseNotes: "Keep upright", assetBeforePhotoUrl: "uploads/asset.webp", exitDocumentNumber: "EXT-20", status: "waiting_delegate_receipt", delegateReceiptStatus: "pending", preparationRevision: 4, purchaseOrderId: null, gateExitApprovedAt: null } });
const text = (value: any): string => Array.isArray(value) ? value.map(text).join("") : React.isValidElement(value) ? text((value.props as any).children) : typeof value === "string" || typeof value === "number" ? String(value) : "";
const button = (label: string) => {
  const found = fixture.buttons.find(props => text(props.children).trim() === label);
  expect(found, `button ${label}`).toBeTruthy(); return found!;
};
function render(element = <DelegateExternalMaintenanceCards />) {
  fixture.cursor = 0; fixture.buttons = []; fixture.inputs = []; fixture.areas = [];
  return renderToStaticMarkup(element);
}
beforeEach(() => {
  fixture.actual = { id: 7, role: "delegate", isActive: 1 }; fixture.user = fixture.actual; fixture.loading = false;
  fixture.language = "ar"; fixture.translations = ar; fixture.rows = [prepared()]; fixture.warehouse = { waitingPreparation: [], jobs: [] };
  fixture.cells = []; fixture.cursor = 0; fixture.calls = []; fixture.queries = []; fixture.callbacks = {}; fixture.invalidations = []; fixture.pending = false;
  vi.clearAllMocks();
});
afterEach(() => vi.unstubAllGlobals());

describe("Assigned delegate external-maintenance receipt cards", () => {
  it.each([...Object.values(APP_ROLE), "unknown", null])("mounts only the actual active delegate: %s", role => {
    fixture.actual = { id: 7, role, isActive: 1 }; fixture.user = { id: 7, role: "delegate", isActive: 1 };
    const html = render();
    expect(fixture.queries).toEqual(isDelegateRole(role) ? ["delegate"] : []);
    expect(html.includes("EXT-20")).toBe(isDelegateRole(role));
  });
  it("does not load cards for a pending, inactive or missing authenticated identity", () => {
    fixture.loading = true; render(); expect(fixture.queries).toHaveLength(0);
    fixture.loading = false; fixture.actual.isActive = 0; render(); expect(fixture.queries).toHaveLength(0);
    fixture.actual = null; render(); expect(fixture.queries).toHaveLength(0);
  });
  it.each([["ar", ar], ["en", en], ["ur", ur]] as const)("shows raw title and asset details in %s without translating the title", (language, translations) => {
    fixture.language = language; fixture.translations = translations;
    const html = render();
    for (const value of [prepared().job.purchaseTitle, "Asset A", "Original fault details", "Stopped", "Keep upright", "MT-2026-010", "EXT-20"]) expect(html).toContain(value);
    expect(html).toContain(translations.workflow.purchase.delegateConfirmAssetReceipt);
  });
  it("hides foreign, exited and PO-linked rows to avoid duplicate purchase cards", () => {
    const foreign = prepared(), purchased = prepared(), exited = prepared();
    foreign.job.id = 21; foreign.job.delegateId = 8;
    purchased.job.id = 22; purchased.job.purchaseOrderId = 55 as any;
    exited.job.id = 23; exited.job.gateExitApprovedAt = "2026-11-04" as any;
    fixture.rows.push(foreign, purchased, exited);
    const html = render();
    expect(html.match(/data-external-job-id=/g)).toHaveLength(1);
  });
  it("confirms receipt once with the current revision and does not create a purchase order", () => {
    render(); button(ar.workflow.purchase.delegateConfirmAssetReceipt).onClick();
    expect(fixture.calls).toEqual([{ name: "decision", input: { jobId: 20, expectedRevision: 4, decision: "accept" } }]);
    fixture.callbacks.decision.onSuccess();
    expect(fixture.invalidations).toEqual(["delegate"]);
  });
  it("requires a nonblank rejection reason and sends it with the current revision", () => {
    render(); button(ar.workflow.purchase.delegateRejectAssetReceipt).onClick(); render();
    const confirm = ar.workflow.purchase.delegateConfirmRejection;
    expect(button(confirm).disabled).toBe(true);
    button(confirm).onClick(); expect(fixture.calls).toHaveLength(0);
    fixture.areas.find(props => props.id === "external-delegate-rejection").onChange({ target: { value: "  Wrong asset delivered  " } }); render();
    expect(button(confirm).disabled).toBe(false); button(confirm).onClick();
    expect(fixture.calls).toEqual([{ name: "decision", input: { jobId: 20, expectedRevision: 4, decision: "reject", reason: "Wrong asset delivered" } }]);
  });
  it("disables both receipt decisions while a command is pending", () => {
    fixture.pending = true; render();
    expect(button(ar.workflow.purchase.delegateConfirmAssetReceipt).disabled).toBe(true);
    expect(button(ar.workflow.purchase.delegateRejectAssetReceipt).disabled).toBe(true);
  });
  it.each([0, -1, null, "invalid"])("does not offer a writable decision for invalid preparation revision %s", revision => {
    fixture.rows[0].job.preparationRevision = revision; render();
    expect(button(ar.workflow.purchase.delegateConfirmAssetReceipt).disabled).toBe(true);
    expect(button(ar.workflow.purchase.delegateRejectAssetReceipt).disabled).toBe(true);
  });
  it.each(["accepted", "rejected"])("keeps %s pre-exit cards read-only and shows the next step", status => {
    fixture.rows[0].job.delegateReceiptStatus = status;
    fixture.rows[0].job.status = status === "accepted" ? "waiting_gate_exit" : "waiting_warehouse_preparation";
    fixture.rows[0].job.delegateReceiptReason = "Broken item";
    const html = render();
    expect(fixture.buttons.some(props => text(props.children) === ar.workflow.purchase.delegateConfirmAssetReceipt)).toBe(false);
    expect(html).toContain(status === "accepted" ? ar.workflow.purchase.delegateAcceptedAwaitingGate : "Broken item");
  });
  it("enlarges the authorized asset image and closes the preview", () => {
    render();
    // Image buttons are native controls; retrieve the actual onClick from the
    // rendered component JSX rather than replacing mediaUrl or its source.
    const source = ts.createSourceFile("cards.tsx", readFileSync("client/src/components/purchase/DelegateExternalMaintenanceCards.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let click = "";
    const walk = (node: ts.Node) => { if (ts.isJsxAttribute(node) && node.name.getText(source) === "onClick" && node.initializer?.getText(source).includes("setPreview({")) click = (node.initializer as ts.JsxExpression).expression!.getText(source); ts.forEachChild(node, walk); };
    walk(source);
    vm.runInNewContext(ts.transpileModule(`(${click})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, { photo: { src: "uploads/asset.webp", label: "Asset photo" }, setPreview: (value: any) => { fixture.cells[2] = value; } })();
    let html = render(); expect(html).toContain('role="dialog"'); expect(html).toContain("max-h-[75vh]");
    expect(html).toContain("/api/media?key=uploads%2Fasset.webp");
    button(ar.common.close).onClick(); html = render(); expect(html).not.toContain('role="dialog"');
  });
});

describe("Warehouse title and re-preparation", () => {
  it("deduplicates rejected jobs, preserves one job/document and excludes waiting acceptance from preparation", () => {
    const rejected = prepared(); rejected.job.status = "waiting_warehouse_preparation"; rejected.job.delegateReceiptStatus = "rejected";
    const queue = externalPreparationRows([{ ticketId: 9, ticketItemId: 10 }], [rejected, prepared()]);
    expect(queue).toHaveLength(1); expect(queue[0].job.id).toBe(20);
    expect(externalPreparationDraft(queue[0])).toEqual({ purchaseTitle: rejected.job.purchaseTitle, assetName: "Asset A", assetBeforePhotoUrl: "uploads/asset.webp", assetBeforeCondition: "Stopped", delegateId: "7", warehouseNotes: "Keep upright" });
  });
  it.each(["unaccepted", "missingTitle", "legacyRevision"])("returns a %s legacy pre-exit job to editable preparation", kind => {
    const row = prepared(); row.job.status = "waiting_gate_exit"; row.job.delegateReceiptStatus = "accepted";
    Object.assign(row.job, { warehousePreparedAt: "2026-11-04T10:00:00Z", delegateReceiptAt: "2026-11-04T11:00:00Z", delegateReceiptById: 7 });
    if (kind === "unaccepted") row.job.delegateReceiptStatus = "pending";
    if (kind === "missingTitle") row.job.purchaseTitle = " ";
    if (kind === "legacyRevision") row.job.preparationRevision = 0;
    expect(externalPreparationRows([], [row])).toHaveLength(1);
  });
  it.each(["invalidReceiptAt", "mismatchedDelegate", "receiptBeforePreparation"])("shows a legacy job with %s for re-preparation", kind => {
    const row = prepared(); row.job.status = "waiting_gate_exit"; row.job.delegateReceiptStatus = "accepted";
    Object.assign(row.job, { warehousePreparedAt: "2026-11-04T10:00:00Z", delegateReceiptAt: "2026-11-04T11:00:00Z", delegateReceiptById: 7 });
    expect(externalPreparationRows([], [row])).toHaveLength(0);
    if (kind === "invalidReceiptAt") row.job.delegateReceiptAt = "not a date";
    if (kind === "mismatchedDelegate") row.job.delegateReceiptById = 99;
    if (kind === "receiptBeforePreparation") row.job.delegateReceiptAt = "2026-11-04T09:00:00Z";
    expect(externalPreparationRows([], [row])).toHaveLength(1);
  });
  it("keeps the route-review return action for unprepared rows and hides it once a job exists", () => {
    const label = "إعادة للمسؤول لمراجعة المسار";
    fixture.warehouse.waitingPreparation = [{ ticketId: 9, ticketItemId: 10, ticketNumber: "MT-9" }];
    render(<ExternalMaintenanceWarehouseTab />);
    expect(fixture.buttons.some(props => text(props.children) === label)).toBe(true);
    const row = prepared(); row.job.status = "waiting_warehouse_preparation"; row.job.delegateReceiptStatus = "rejected";
    fixture.warehouse = { waitingPreparation: [], jobs: [row] };
    render(<ExternalMaintenanceWarehouseTab />);
    expect(fixture.buttons.some(props => text(props.children) === label)).toBe(false);
  });
  it("omits a nullable legacy ticket item so the existing primary-item resolver remains usable", () => {
    const row = prepared(); row.job.status = "waiting_gate_exit"; row.ticketItemId = null; row.job.ticketItemId = null;
    expect(externalPreparationRows([], [row])[0].ticketItemId).toBeUndefined();
  });
  it("uses the exact required title placeholder and blocks submitting a missing title", () => {
    fixture.warehouse.waitingPreparation = [{ ticketId: 9, ticketItemId: 10, ticketNumber: "MT-9", assetName: "Asset A" }];
    render(<ExternalMaintenanceWarehouseTab />); button(ar.workflow.purchase.prepareAsset).onClick(); render(<ExternalMaintenanceWarehouseTab />);
    const title = fixture.inputs.find(props => props.id === "external-purchase-title");
    expect(title.required).toBe(true); expect(title.maxLength).toBe(300);
    expect(title.placeholder).toBe("اكتب عنوان الصيانة المطلوبة؛ سيظهر في طلب الشراء ووثيقة العهدة المالية");
    expect(button(ar.workflow.purchase.saveIssueDocument).disabled).toBe(true);
  });
  it("prefills a rejected preparation, shows its reason and sends the same job id, revision and edited title", () => {
    const row = prepared(); row.job.status = "waiting_warehouse_preparation"; row.job.delegateReceiptStatus = "rejected"; row.job.delegateReceiptReason = "Cannot accept this asset";
    fixture.warehouse.jobs = [row];
    let html = render(<ExternalMaintenanceWarehouseTab />); expect(html).toContain("Cannot accept this asset");
    button(ar.workflow.purchase.prepareAsset).onClick(); render(<ExternalMaintenanceWarehouseTab />);
    const title = fixture.inputs.find(props => props.id === "external-purchase-title"); expect(title.value).toBe(row.job.purchaseTitle);
    title.onChange({ target: { value: "  Motor replacement maintenance  " } }); render(<ExternalMaintenanceWarehouseTab />);
    expect(button(ar.workflow.purchase.saveIssueDocument).disabled).toBe(false); button(ar.workflow.purchase.saveIssueDocument).onClick();
    expect(fixture.calls).toEqual([{ name: "prepare", input: { ticketId: 9, ticketItemId: 10, jobId: 20, expectedRevision: 4, purchaseTitle: "Motor replacement maintenance", assetName: "Asset A", assetBeforePhotoUrl: "uploads/asset.webp", assetBeforeCondition: "Stopped", delegateId: 7, warehouseNotes: "Keep upright" } }]);
    fixture.callbacks.prepare.onSuccess({ exitDocumentNumber: "EXT-20" });
    expect(printExternalMaintenanceDocument).toHaveBeenCalledWith("exit", expect.objectContaining({ job: expect.objectContaining({ purchaseTitle: "  Motor replacement maintenance  ", exitDocumentNumber: "EXT-20", delegateReceiptStatus: "pending" }) }));
  });
});

describe("Exit print and delegate-tab integration", () => {
  it.each(["pending", "accepted"])("prints the separate raw title and appropriate %s wait notice", async receiptStatus => {
    const printed: string[] = [];
    const win = { document: { write: (html: string) => printed.push(html), close: vi.fn(), getElementById: () => ({ addEventListener: vi.fn() }) }, close: vi.fn() };
    vi.stubGlobal("window", { open: () => win });
    const actual = await vi.importActual<typeof import("../../client/src/lib/printExternalMaintenanceDocument")>("../../client/src/lib/printExternalMaintenanceDocument");
    const row = prepared(); row.job.delegateReceiptStatus = receiptStatus;
    actual.printExternalMaintenanceDocument("exit", row);
    expect(printed[0]).toContain(row.job.purchaseTitle); expect(printed[0]).toContain("Asset A"); expect(printed[0]).toContain("عنوان طلب الشراء");
    expect(printed[0]).toContain(receiptStatus === "accepted" ? "بانتظار اعتماد الحراسة" : "بانتظار تأكيد استلام المندوب");
  });
  it("gates the new tab by actual active delegate and mounts its cards only once", () => {
    const source = ts.createSourceFile("PurchaseOrders.tsx", readFileSync("client/src/pages/purchase/PurchaseOrders.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let condition = "", cards = 0;
    const walk = (node: ts.Node) => {
      if (ts.isVariableDeclaration(node) && node.name.getText(source) === "canViewDelegateExternal") condition = node.initializer!.getText(source);
      if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(source) === "DelegateExternalMaintenanceCards") cards++;
      ts.forEachChild(node, walk);
    };
    walk(source); expect(cards).toBe(1);
    for (const role of Object.values(APP_ROLE)) expect(vm.runInNewContext(condition, { authenticatedUser: { role, isActive: 1 }, Number, isDelegateRole })).toBe(isDelegateRole(role));
    expect(vm.runInNewContext(condition, { authenticatedUser: { role: "delegate", isActive: 0 }, Number, isDelegateRole })).toBe(false);
  });
});

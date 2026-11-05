import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { APP_ROLE } from "../../shared/roles";
import { isDelegateRole } from "../../shared/delegate-role";
import { externalMaintenanceLabels } from "../../client/src/i18n/externalMaintenanceFollowup";

const state = vi.hoisted(() => ({ actor: { id: 7, role: "delegate", isActive: 1 } as any, cells: [] as any[], cursor: 0,
  queries: [] as any[], buttons: [] as any[], fetched: true, error: null as any, data: [] as any[], detail: null as any,
}));
vi.mock("react", async original => ({ ...await original<typeof import("react")>(), useState: (initial: any) => {
  const index = state.cursor++; if (!(index in state.cells)) state.cells[index] = typeof initial === "function" ? initial() : initial;
  return [state.cells[index], (next: any) => { state.cells[index] = typeof next === "function" ? next(state.cells[index]) : next; }];
} }));
vi.mock("../../client/src/_core/hooks/useAuth", () => ({ useAuth: () => ({ authenticatedUser: state.actor, user: { ...state.actor, role: "owner" }, loading: false }) }));
vi.mock("../../client/src/contexts/LanguageContext", () => ({ useTranslation: () => ({ language: "ar" }) }));
vi.mock("../../client/src/lib/mediaUrl", () => ({ mediaUrl: (value: string) => `protected:${value}` }));
vi.mock("../../client/src/i18n/apiError", () => ({ localizeApiError: (message: string) => message }));
vi.mock("../../client/src/components/ui/button", () => ({ Button: (props: any) => { state.buttons.push(props); return <button {...props} />; } }));
vi.mock("../../client/src/components/ui/dialog", () => ({ Dialog: ({ open, children }: any) => open ? <section role="dialog">{children}</section> : null,
  useDialogComposition: () => ({ justEndedComposing: () => false, setComposing: () => {}, markCompositionEnd: () => {} }),
  DialogContent: ({ children, ...props }: any) => <div {...props}>{children}</div>, DialogHeader: ({ children }: any) => <header>{children}</header>, DialogTitle: ({ children }: any) => <h2>{children}</h2>, DialogFooter: ({ children }: any) => <footer>{children}</footer>,
}));
vi.mock("../../client/src/lib/trpc", () => ({ trpc: { externalMaintenance: {
  listFollowup: { useQuery: (input: any) => { state.queries.push(input); return { data: { rows: state.data, total: state.data.length, page: input.page, pageSize: 24 }, isFetchedAfterMount: state.fetched, isLoading: false, isSuccess: !state.error, error: state.error }; } },
  followupDetail: { useQuery: (input: any) => { state.queries.push({ detail: input }); return { data: state.detail, isFetchedAfterMount: state.fetched, isLoading: false, error: state.error }; } },
} } }));
import { canViewExternalFollowup, ExternalMaintenanceFollowup, ExternalFollowupCard, ExternalFollowupDetailsContent, externalWorkshopLocation } from "../../client/src/components/purchase/ExternalMaintenanceFollowup";
import { ExternalWorkshopPricingFields, externalWorkshopForm, externalWorkshopIssue, externalWorkshopPayload, needsExternalWorkshop, type ExternalWorkshopForm } from "../../client/src/components/purchase/ExternalWorkshopPricingFields";

const row = () => ({ jobId: 9, purchaseTitle: "إصلاح مضخة المصدر", assetBeforePhotoUrl: "before-key", delegateId: 7, delegateName: "المندوب المكلف",
  expectedReturnDate: "2026-11-07", status: "purchase_cycle", gateEntryApprovedAt: null, warehouseReceivedAt: null,
  assetName: "الأصل التفصيلي", ticketNumber: "MT-TEST", poNumber: "PR-TEST", workshopName: "ورشة خاصة", workshopPhone: "0500000000",
  workshopLocationUrl: "https://example.test/workshop", workshopNotes: "ملاحظات الورشة التفصيلية", warehouseNotes: "ملاحظات المستودع", assetBeforeCondition: "لا تعمل",
  gateExitApprovedAt: "2026-11-04 09:00:00", assetAfterReturnPhotoUrl: "after-key",
});
const valid: ExternalWorkshopForm = { workshopName: "ورشة محددة", workshopPhone: "0500000000", expectedReturnDate: "2026-11-07", workshopLocationUrl: "", workshopNotes: "" };
const externalItem = () => ({ id: 1, purchaseOrderId: 8, quantity: 2, externalWorkshopRequired: true, externalWorkshop: externalWorkshopForm(null) });
const render = (view: "active" | "received" = "active") => { state.cursor = 0; state.buttons = []; return renderToStaticMarkup(<ExternalMaintenanceFollowup view={view} />); };
beforeEach(() => { state.actor = { id: 7, role: "delegate", isActive: 1 }; state.cells = []; state.cursor = 0; state.queries = []; state.buttons = []; state.fetched = true; state.error = null; state.data = [row()]; state.detail = row(); });

describe("External followup card and authorized read UI", () => {
  it.each(Object.values(APP_ROLE))("uses actual active role instead of owner projection: %s", role => {
    const allowed = ["delegate", "delegate_manager", "warehouse", "maintenance_manager", "general_maintenance_manager", "construction_procurement_manager", "senior_management", "admin", "owner"].includes(role);
    state.actor.role = role;
    expect(canViewExternalFollowup(state.actor)).toBe(allowed);
    const html = render();
    expect(state.queries.length).toBe(allowed ? 1 : 0);
    expect(html.includes("إصلاح مضخة المصدر")).toBe(allowed);
  });
  it("does not fetch for an inactive account", () => { state.actor.isActive = 0; expect(render()).not.toContain("before-key"); expect(state.queries).toHaveLength(0); });
  it("shows one minimal card without workshop, PO, ticket or asset detail fields", () => {
    const html = renderToStaticMarkup(<ExternalFollowupCard row={row()} now={new Date("2026-11-04T09:00:00Z")} language="ar" onOpen={() => {}} />);
    for (const expected of ["إصلاح مضخة المصدر", "المندوب المكلف", "2026-11-07", "متبقي 3 أيام", "protected:before-key"]) expect(html).toContain(expected);
    for (const hidden of ["الأصل التفصيلي", "MT-TEST", "PR-TEST", "ورشة خاصة", "0500000000", "ملاحظات الورشة التفصيلية"]) expect(html).not.toContain(hidden);
    expect((html.match(/data-external-followup-id/g) || [])).toHaveLength(1);
  });
  it("opens detail on card click and freezes the overdue color/count at gate entry", () => {
    const onOpen = vi.fn(), value = { ...row(), expectedReturnDate: "2026-11-04", gateEntryApprovedAt: "2026-11-07 09:00:00" };
    const element = ExternalFollowupCard({ row: value, now: new Date("2026-12-25T09:00:00Z"), language: "ar", onOpen });
    element.props.onClick(); expect(onOpen).toHaveBeenCalledOnce();
    const html = renderToStaticMarkup(element);
    expect(html).toContain("متأخرة 3 أيام"); expect(html).toContain("border-red-400"); expect(html).toContain("بانتظار استلام المستودع");
  });
  it("removes received rows from active cards and loads them through the independent received archive", () => {
    state.data = [row(), { ...row(), jobId: 10, warehouseReceivedAt: "2026-11-08 09:00:00" }];
    expect((render().match(/data-external-followup-id/g) || [])).toHaveLength(1);
    expect(state.queries[0]).toEqual({ view: "active", page: 1, pageSize: 24 });
    expect((render("received").match(/data-external-followup-id/g) || [])).toHaveLength(1);
    expect(state.queries.at(-1)).toEqual({ view: "received", page: 1, pageSize: 24 });
  });
  it("does not keep a live counter on a legacy received card without a recorded gate entry", () => {
    const html = renderToStaticMarkup(<ExternalFollowupCard row={{ ...row(), expectedReturnDate: "2026-11-04", warehouseReceivedAt: "2026-11-08 09:00:00" }} now={new Date("2026-12-25T09:00:00Z")} language="ar" onOpen={() => {}} />);
    expect(html).toContain("تم استلام المستودع"); expect(html).not.toContain("متأخرة"); expect(html).not.toContain("data-return-timing");
  });
  it("does not expose a previous actor's cached rows before the fresh read or after denial", () => {
    state.fetched = false; expect(render()).not.toContain("before-key");
    state.fetched = true; state.error = { message: "Access revoked" }; expect(render()).toContain("Access revoked"); expect(render()).not.toContain("before-key");
  });
  it("opens a protected details query and provides a close control", () => {
    state.cells[1] = 9;
    const html = render(); expect(state.queries).toContainEqual({ detail: { jobId: 9 } });
    expect(html).toContain("ورشة خاصة"); expect(html).toContain("MT-TEST"); expect(html).toContain("PR-TEST");
    state.buttons.find(button => button.children === "إغلاق").onClick(); expect(state.cells[1]).toBeNull();
  });
  it("details show stored source timestamps in Riyadh and preserve receipt information", () => {
    const html = renderToStaticMarkup(<ExternalFollowupDetailsContent row={{ ...row(), status: "waiting_technician_handover", gateEntryApprovedAt: "2026-11-07T09:00:00Z", warehouseReceivedAt: "2026-11-08T09:00:00Z" }} language="en" onPhoto={() => {}} />);
    for (const label of ["Gate exit approval", "Gate entry approval", "Actual warehouse receipt", "PR-TEST", "MT-TEST", "0500000000", "https://example.test/workshop"]) expect(html).toContain(label);
    expect(html).toContain("12:00:00"); expect(html).toContain("Waiting for technician handover"); expect(html).toContain("protected:after-key");
    expect(html).not.toContain("Confirm receipt");
  });
  it("preserves the current reinstall/closed stage in the received archive", () => {
    for (const status of ["reinstall_in_progress", "closed"]) {
      const html = renderToStaticMarkup(<ExternalFollowupDetailsContent row={{ ...row(), status, warehouseReceivedAt: "2026-11-08T09:00:00Z" }} language="en" onPhoto={() => {}} />);
      expect(html).toContain(status === "closed" ? "Closed" : "Reinstallation in progress");
    }
  });
  it("photo buttons provide the exact protected photo and dialog close is available", () => {
    const onPhoto = vi.fn();
    const content = ExternalFollowupDetailsContent({ row: row(), language: "en", onPhoto });
    const walk = (node: any): any[] => !node || typeof node !== "object" ? [] : [node, ...React.Children.toArray(node.props?.children).flatMap(walk)];
    const photos = walk(content).filter(node => node.type === "button");
    photos[0].props.onClick(); expect(onPhoto).toHaveBeenCalledWith({ src: "before-key", label: "Asset before exit" });
    state.cells[1] = 9; state.cells[3] = { src: "before-key", label: "Asset before exit" };
    expect(render()).toContain("max-h-[75vh]");
    state.buttons.at(-1).onClick(); expect(state.cells[3]).toBeNull();
  });
  it.each(["javascript:alert(1)", "data:text/html,hello", "bad-url"])("does not turn unsafe location %s into a link", url => { expect(externalWorkshopLocation(url)).toBeNull(); });
});

describe("External workshop fields preserve ordinary pricing", () => {
  it("adds fields only for an external source and retains existing values", () => {
    expect(renderToStaticMarkup(<ExternalWorkshopPricingFields item={{ id: 1 }} value={valid} onChange={() => {}} idPrefix="ordinary" />)).toBe("");
    const html = renderToStaticMarkup(<ExternalWorkshopPricingFields item={externalItem()} value={valid} onChange={() => {}} idPrefix="external" />);
    expect((html.match(/required=""/g) || [])).toHaveLength(3); expect(html).toContain('type="date"'); expect(html).toContain('type="tel"'); expect(html).toContain("ورشة محددة");
    expect(needsExternalWorkshop({ externalWorkshop: {} })).toBe(true);
    expect(externalWorkshopForm({ externalWorkshop: valid })).toEqual(valid);
    expect(externalWorkshopPayload({ id: 2 }, valid)).toEqual({});
  });
  it.each(["workshopName", "workshopPhone", "expectedReturnDate"] as const)("requires %s", field => { expect(externalWorkshopIssue(externalItem(), { ...valid, [field]: "" })).toBe("requiredWorkshop"); });
  it("validates actual dates and optional safe links without making notes/location mandatory", () => {
    expect(externalWorkshopIssue(externalItem(), valid)).toBeNull();
    expect(externalWorkshopIssue(externalItem(), { ...valid, expectedReturnDate: "2026-02-29" })).toBe("requiredWorkshop");
    expect(externalWorkshopIssue(externalItem(), { ...valid, workshopLocationUrl: "javascript:alert(1)" })).toBe("invalidWorkshopUrl");
    expect(externalWorkshopIssue(externalItem(), { ...valid, workshopLocationUrl: "https://example.test" })).toBeNull();
    expect(externalWorkshopIssue(externalItem(), { ...valid, workshopLocationUrl: "https://example.test/" + "a".repeat(2048) })).toBe("invalidWorkshopUrl");
  });
});

function clickHandler(file: string, marker: string) {
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let expression = "";
  function walk(node: ts.Node) {
    if (ts.isJsxAttribute(node) && node.name.getText(source) === "onClick" && node.initializer && ts.isJsxExpression(node.initializer) && node.initializer.expression?.getText(source).includes(marker)) expression = node.initializer.expression.getText(source);
    ts.forEachChild(node, walk);
  }
  walk(source); if (!expression) throw Error(`Missing production pricing handler ${file}`);
  return (context: object) => vm.runInNewContext(ts.transpileModule(`(${expression})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
}
const quoteFiles = [
  ["client/src/pages/purchase/PurchaseOrderDetail.tsx", "estimateMut.mutate"],
  ["client/src/pages/purchase/PurchaseBatchDetail.tsx", "estimateMut.mutate"],
  ["client/src/pages/purchase/PurchaseCycle.tsx", "estimateCostMut.mutate"],
  ["client/src/pages/inventory/MyItems.tsx", "estimateMut.mutate"],
] as const;
describe.each(quoteFiles)("Actual quote handler %s", (file, marker) => {
  it("blocks missing workshop data, submits completed external data and keeps ordinary payload unchanged", () => {
    const run = clickHandler(file, marker), mutate = vi.fn(), error = vi.fn();
    const invoke = (item: any, draft: ExternalWorkshopForm) => run({ item, estimateDialog: item, po: { id: 8 }, estimates: { 1: "10" }, estimateValues: { 1: "10" }, estimateCost: "10", workshopDrafts: { 1: draft },
      estimateMut: { mutate }, estimateCostMut: { mutate }, toast: { error }, t: { purchaseOrders: { estimatedUnitCost: "price", enterPrice: "price" }, workflow: { purchase: { enterValidPrice: "price" } } },
      language: "ar", externalWorkshopIssue, externalWorkshopPayload, externalMaintenanceLabels })();
    invoke(externalItem(), { ...valid, workshopPhone: "" }); expect(mutate).not.toHaveBeenCalled(); expect(error).toHaveBeenCalledOnce();
    invoke(externalItem(), valid); expect(mutate).toHaveBeenLastCalledWith({ purchaseOrderId: 8, items: [{ id: 1, estimatedUnitCost: "10", externalWorkshop: valid }] });
    invoke({ id: 1, quantity: 2, purchaseOrderId: 8 }, valid); expect(mutate).toHaveBeenLastCalledWith({ purchaseOrderId: 8, items: [{ id: 1, estimatedUnitCost: "10" }] });
  });
});
describe.each(["editItemMut.mutate", "editAndResubmitReturnedItemMut.mutate"])("Actual external reprice handler %s", marker => {
  it("requires workshop data when saving a revised external price", () => {
    const run = clickHandler("client/src/pages/purchase/PurchaseOrderDetail.tsx", marker), mutate = vi.fn();
    const invoke = (draft: ExternalWorkshopForm) => run({ editingItem: externalItem(), showExternalEditWorkshop: true, editForm: { itemName: "source", description: "fault", quantity: 2, estimatedUnitCost: "10", unit: "service", photoUrl: "", notes: "" },
      workshopDrafts: { 1: draft }, po: { id: 8, status: "pending_estimate" }, language: "ar", getLastKnownUpdatedAt: () => "2026-11-04", editItemMut: { mutate }, editAndResubmitReturnedItemMut: { mutate },
      toast: { error: vi.fn() }, externalWorkshopIssue, externalWorkshopPayload, externalMaintenanceLabels })();
    invoke({ ...valid, workshopName: "" }); expect(mutate).not.toHaveBeenCalled();
    invoke(valid); expect(mutate).toHaveBeenCalledWith(expect.objectContaining({ id: 1, purchaseOrderId: 8, estimatedUnitCost: "10", externalWorkshop: valid }));
  });
});

describe("Followup and archive integration in the existing purchase page", () => {
  const path = "client/src/pages/purchase/PurchaseOrders.tsx";
  const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let activeGuard = "", receivedGuard = "", ordinaryAllGuard = "", viewExpression = "";
  function walk(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === "view") viewExpression = node.initializer!.getText(source);
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(source) === "ExternalMaintenanceFollowup") {
      const parent = node.parent as ts.BinaryExpression;
      if (!ts.isBinaryExpression(parent)) throw Error("Followup must be conditionally mounted");
      if (node.getText(source).includes('view="active"')) activeGuard = parent.left.getText(source);
      if (node.getText(source).includes('view="received"')) receivedGuard = parent.left.getText(source);
    }
    if (ts.isBinaryExpression(node) && node.left.getText(source) === 'view === "all" && !isDelegateRole(authenticatedUser?.role)') ordinaryAllGuard = node.left.getText(source);
    ts.forEachChild(node, walk);
  }
  walk(source);
  const evaluate = (code: string, context: any) => {
    if (!code) throw Error("Missing actual purchase page guard");
    return vm.runInNewContext(ts.transpileModule(`(${code})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  };
  it("mounts only active data on the followup tab and received data on All", () => {
    expect(evaluate(activeGuard, { view: "external_followup", canViewFollowup: true })).toBe(true);
    expect(evaluate(receivedGuard, { view: "external_followup", canViewFollowup: true })).toBe(false);
    expect(evaluate(receivedGuard, { view: "all", canViewFollowup: true })).toBe(true);
    expect(evaluate(receivedGuard, { view: "items", canViewFollowup: true })).toBe(false);
    expect(evaluate(activeGuard, { view: "external_followup", canViewFollowup: false })).toBe(false);
  });
  it.each(["delegate", "delegate_manager"])("keeps received archive reachable for %s without exposing ordinary PR All", role => {
    const context = { selectedView: "all", canViewDelegateExternal: true, canViewFollowup: true, user: { role }, isDelegateRole };
    expect(evaluate(viewExpression, context)).toBe("all");
    expect(evaluate(ordinaryAllGuard, { view: "all", authenticatedUser: { role }, isDelegateRole })).toBe(false);
    expect(evaluate(viewExpression, { ...context, selectedView: "external_followup" })).toBe("external_followup");
    expect(evaluate(viewExpression, { ...context, canViewFollowup: false })).toBe("items");
  });
  it("keeps the previous ordinary All layout for other existing roles", () => {
    expect(evaluate(ordinaryAllGuard, { view: "all", authenticatedUser: { role: "warehouse" }, isDelegateRole })).toBe(true);
  });
});

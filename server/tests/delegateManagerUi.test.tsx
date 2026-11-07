import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import ar from "../../client/src/i18n/ar";
import en from "../../client/src/i18n/en";
import ur from "../../client/src/i18n/ur";
import { APP_ROLE, isDelegateRole } from "../../shared/roles";
import { canCreateUserRole } from "../../shared/business-role-policy";
import { defaultDelegateManagerId, reviewDelegateId, reviewBulkDelegateValue } from "../../client/src/lib/delegateReviewDefaults";
import { defaultDocumentKind, documentCenterSections } from "../../client/src/lib/documentCenterNavigation";

const state = vi.hoisted(() => ({ actor: { id: 20, role: "delegate_manager", isActive: 1 } as any, displayRole: "delegate_manager",
  cells: [] as any[], cursor: 0, buttons: [] as any[], options: [{ id: 31, name: "Delegate 31", username: "D31" }],
  queryCalls: [] as string[], commands: [] as any[], callbacks: {} as any, pending: false,
}));
vi.mock("react", async original => ({ ...await original<typeof import("react")>(), useState: (initial: any) => {
  const index = state.cursor++; if (!(index in state.cells)) state.cells[index] = typeof initial === "function" ? initial() : initial;
  return [state.cells[index], (next: any) => { state.cells[index] = typeof next === "function" ? next(state.cells[index]) : next; }];
} }));
vi.mock("../../client/src/_core/hooks/useAuth", () => ({ useAuth: () => ({ authenticatedUser: state.actor, user: { ...state.actor, role: state.displayRole } }) }));
vi.mock("../../client/src/contexts/LanguageContext", () => ({ useTranslation: () => ({ t: ar, language: "ar", dir: "rtl" }) }));
vi.mock("../../client/src/components/ui/button", () => ({ Button: (props: any) => { state.buttons.push(props); return <button {...props} />; } }));
vi.mock("../../client/src/components/ui/dialog", () => ({ Dialog: ({ open, children }: any) => open ? <section role="dialog">{children}</section> : null,
  DialogContent: ({ children }: any) => <div>{children}</div>, DialogHeader: ({ children }: any) => <header>{children}</header>, DialogTitle: ({ children }: any) => <h2>{children}</h2>, DialogFooter: ({ children }: any) => <footer>{children}</footer>,
}));
vi.mock("../../client/src/i18n/apiError", () => ({ localizeApiError: (message: string) => message }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("../../client/src/lib/trpc", () => ({ trpc: { purchaseOrders: {
  delegateAssignmentOptions: { useQuery: () => { state.queryCalls.push("assignment-options"); return { data: state.options, isLoading: false }; } },
  assignOwnDelegateItem: { useMutation: (callbacks: any) => { state.callbacks = callbacks; return { isPending: state.pending, mutate: (input: any) => state.commands.push(input) }; } },
} } }));
import { canManagerAssignOwnItem, DelegateManagerAssignmentDialog } from "../../client/src/components/purchase/DelegateManagerAssignment";

const item = () => ({ id: 5, purchaseOrderId: 50, itemName: "Selected item", delegateId: 20, status: "pending", managerAssignable: true });
const onClose = vi.fn(), onAssigned = vi.fn();
function render(current: any = item()) { state.cursor = 0; state.buttons = []; return renderToStaticMarkup(<DelegateManagerAssignmentDialog item={current} onClose={onClose} onAssigned={onAssigned} />); }
const confirm = () => state.buttons.find(props => props.children === ar.purchaseOrders.managerConfirmAssignment);
beforeEach(() => { state.actor = { id: 20, role: "delegate_manager", isActive: 1 }; state.displayRole = "delegate_manager"; state.cells = []; state.cursor = 0; state.commands = []; state.queryCalls = []; state.pending = false; state.options = [{ id: 31, name: "Delegate 31", username: "D31" }]; vi.clearAllMocks(); });

describe("Manager single ordinary item assignment", () => {
  it.each(Object.values(APP_ROLE))("allows the new assignment only to an actual assigned active manager, not %s", role => {
    state.actor.role = role; state.displayRole = "delegate_manager";
    const html = render();
    expect(html.includes('role="dialog"')).toBe(role === APP_ROLE.DELEGATE_MANAGER);
    expect(state.queryCalls.length).toBe(role === APP_ROLE.DELEGATE_MANAGER ? 1 : 0);
  });
  it.each([
    { delegateId: 99 }, { managerAssignable: false }, { status: "estimated" }, { batchId: 1 }, { estimatedUnitCost: "0" },
    { estimatedTotalCost: "1" }, { estimatedById: 7 }, { delegateChangeRequestedAt: "2026-11-04" },
    { ticketPath: "C" }, { isExternalMaintenance: true },
  ])("does not initialize assignment for a foreign/external/already priced item: %j", change => {
    expect(canManagerAssignOwnItem(state.actor, { ...item(), ...change })).toBe(false);
    expect(render({ ...item(), ...change })).toBe(""); expect(state.queryCalls).toHaveLength(0);
  });
  it("requires a target, submits exactly one selected item, then refreshes through the parent callback", () => {
    const html = render(); expect(html).toContain("Delegate 31"); expect(html).toContain('required=""'); expect(confirm().disabled).toBe(true);
    confirm().onClick(); expect(state.commands).toHaveLength(0);
    state.cells[0] = "31"; render(); expect(confirm().disabled).toBe(false); confirm().onClick();
    expect(state.commands).toEqual([{ purchaseOrderId: 50, itemId: 5, delegateId: 31 }]);
    state.callbacks.onSuccess(); expect(onAssigned).toHaveBeenCalledTimes(1); expect(onClose).toHaveBeenCalledTimes(1);
  });
  it("rejects a target absent from the scoped options and blocks duplicate clicks while pending", () => {
    state.cells[0] = "999"; render(); expect(confirm().disabled).toBe(true); confirm().onClick(); expect(state.commands).toHaveLength(0);
    state.cells[0] = "31"; state.pending = true; render(); expect(confirm().disabled).toBe(true); confirm().onClick(); expect(state.commands).toHaveLength(0);
  });
  it("does not trust projected manager or inactive identity", () => {
    state.actor.role = "observer"; expect(render()).toBe("");
    state.actor.role = "delegate_manager"; state.actor.isActive = 0; expect(render()).toBe(""); expect(state.queryCalls).toHaveLength(0);
  });
});

describe("Reviewer delegate defaults preserve explicit and current choices", () => {
  const users = [{ id: 25, role: "delegate_manager", isActive: 1 }, { id: 20, role: "delegate_manager", isActive: 1 }, { id: 10, role: "delegate_manager", isActive: 0 }, { id: 1, role: "delegate", isActive: 1 }];
  it("suggests the lowest active manager independently of directory order and leaves a missing manager blank", () => {
    expect(defaultDelegateManagerId(users)).toBe(20); expect(defaultDelegateManagerId([...users].reverse())).toBe(20);
    expect(defaultDelegateManagerId(users.filter(user => user.role === "delegate" || user.isActive === 0))).toBeUndefined();
  });
  it("preserves manual/current item assignment and does not overwrite it when managers arrive asynchronously", () => {
    const selected = { delegateId: 31 };
    expect(reviewDelegateId({ id: 1 }, selected, undefined)).toBe(31);
    expect(reviewDelegateId({ id: 1 }, selected, defaultDelegateManagerId(users))).toBe(31);
    expect(reviewDelegateId({ id: 1, delegateId: 32 }, undefined, 20)).toBe(32);
    expect(reviewDelegateId({ id: 1 }, undefined, 20)).toBe(20);
    expect(reviewDelegateId({ id: 1 }, undefined, undefined)).toBeUndefined();
  });
  it("does not display one delegate for a mixed batch, and preserves an explicit bulk selection", () => {
    const rows = [{ id: 1, delegateId: 31 }, { id: 2, delegateId: 32 }];
    expect(reviewBulkDelegateValue(rows, {}, 20)).toBeUndefined();
    expect(reviewBulkDelegateValue(rows, {}, 20, "41")).toBe("41");
    expect(reviewBulkDelegateValue([{ id: 1 }, { id: 2 }], {}, 20)).toBe("20");
  });
  it("actual bulk-approve handler preserves mixed choices and defaults only unassigned items", () => {
    const fn = detailHandler("handleBulkApprove"); let result: any;
    vm.runInNewContext(fn, { reviewDecisions: { 1: { action: "approve", delegateId: 31 } }, selectedReviewItems: [{ id: 1 }, { id: 2, delegateId: 32 }, { id: 3 }], reviewFallbackDelegateId: 20, reviewDelegateId,
      setReviewDecisions: (value: any) => { result = value; } })();
    expect(result).toEqual({ 1: { action: "approve", delegateId: 31 }, 2: { action: "approve", delegateId: 32 }, 3: { action: "approve", delegateId: 20 } });
  });
  it("actual explicit bulk assignment changes only selected approved items", () => {
    const fn = detailHandler("handleBulkAssignDelegate"); let result: any;
    vm.runInNewContext(fn, { reviewDecisions: { 1: { action: "approve", delegateId: 31 }, 2: { action: "reject", rejectionReason: "reason" }, 3: { action: "approve", delegateId: 33 } }, selectedReviewItems: [{ id: 1 }, { id: 2 }],
      setReviewDecisions: (value: any) => { result = value; } })(41);
    expect(result).toEqual({ 1: { action: "approve", delegateId: 41 }, 2: { action: "reject", rejectionReason: "reason" }, 3: { action: "approve", delegateId: 33 } });
  });
  it("the actual review-submit handler sends the displayed explicit/current/default selections", () => {
    const source = ts.createSourceFile("detail.tsx", readFileSync("client/src/pages/purchase/PurchaseOrderDetail.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let handler = "";
    const walk = (node: ts.Node) => {
      if (ts.isJsxAttribute(node) && node.name.getText(source) === "onClick" && node.initializer && ts.isJsxExpression(node.initializer)
        && node.initializer.expression?.getText(source).includes("const items = selectedReviewItems.map")) handler = node.initializer.expression.getText(source);
      ts.forEachChild(node, walk);
    }; walk(source); expect(handler).not.toBe("");
    const mutate = vi.fn();
    vm.runInNewContext(ts.transpileModule(`(${handler})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, {
      selectedReviewItems: [{ id: 1 }, { id: 2, delegateId: 32 }, { id: 3 }, { id: 4 }],
      reviewDecisions: { 1: { action: "approve", delegateId: 31 }, 2: { action: "approve" }, 3: { action: "approve" }, 4: { action: "reject", rejectionReason: "wrong item" } },
      reviewDelegateId, reviewFallbackDelegateId: 20, po: { id: 50 }, reviewItemsMut: { mutate },
    })();
    expect(mutate).toHaveBeenCalledWith({ poId: 50, items: [
      { id: 1, action: "approve", delegateId: 31, rejectionReason: undefined }, { id: 2, action: "approve", delegateId: 32, rejectionReason: undefined },
      { id: 3, action: "approve", delegateId: 20, rejectionReason: undefined }, { id: 4, action: "reject", delegateId: undefined, rejectionReason: "wrong item" },
    ] });
  });
});

function detailHandler(name: string) {
  const source = ts.createSourceFile("detail.tsx", readFileSync("client/src/pages/purchase/PurchaseOrderDetail.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let fn = ""; const walk = (node: ts.Node) => { if (ts.isVariableDeclaration(node) && node.name.getText(source) === name) fn = node.initializer!.getText(source); ts.forEachChild(node, walk); }; walk(source);
  expect(fn).not.toBe(""); return ts.transpileModule(`(${fn})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
}

describe("Manager delegate UI parity without global permissions", () => {
  it("adds the translated role to admin user creation/edit options while warehouse cannot create it", () => {
    for (const translation of [ar, en, ur]) expect(translation.roles.delegate_manager).toBeTruthy();
    expect(ar.roles.delegate_manager).toBe("مسئول المناديب");
    expect(canCreateUserRole("admin", "delegate_manager")).toBe(true); expect(canCreateUserRole("warehouse", "delegate_manager")).toBe(false);
  });
  it("matches delegate document sections/defaults without exposing stock or approved accounting documents", () => {
    const delegate = { id: 20, role: "delegate", isActive: 1 }, manager = { ...delegate, role: "delegate_manager" };
    expect(documentCenterSections(manager)).toEqual(documentCenterSections(delegate));
    expect(defaultDocumentKind(manager)).toBe(defaultDocumentKind(delegate));
    expect(documentCenterSections(manager).flatMap(section => section.types).map(type => type.key)).toEqual(["delegate_pricing_documents"]);
    expect(isDelegateRole("delegate_manager")).toBe(true); expect(isDelegateRole("senior_management")).toBe(false);
  });
  it("gives manager exactly the same sidebar role entries as delegate", () => {
    const source = ts.createSourceFile("layout.tsx", readFileSync("client/src/components/layout/DashboardLayout.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let count = 0;
    const walk = (node: ts.Node) => { if (ts.isPropertyAssignment(node) && node.name.getText(source) === "roles" && ts.isArrayLiteralExpression(node.initializer)) {
      const roles = node.initializer.elements.filter(ts.isStringLiteral).map(role => role.text);
      if (roles.includes("delegate")) { expect(roles).toContain("delegate_manager"); count++; }
      if (roles.includes("delegate_manager")) expect(roles).toContain("delegate");
    } ts.forEachChild(node, walk); }; walk(source); expect(count).toBeGreaterThan(3);
  });
  it("places the assignment action in the primary own-item queue and stops opening the order when clicked", () => {
    const source = ts.createSourceFile("orders.tsx", readFileSync("client/src/pages/purchase/PurchaseOrders.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let handler = "", ownQueue = false;
    const walk = (node: ts.Node) => {
      if (ts.isJsxAttribute(node) && node.name.getText(source) === "onClick" && node.initializer && ts.isJsxExpression(node.initializer)
        && node.initializer.expression?.getText(source).includes("setManagerAssignmentItem(item)")) {
        handler = node.initializer.expression.getText(source);
        for (let parent: ts.Node | undefined = node; parent; parent = parent.parent) if (ts.isCallExpression(parent) && parent.expression.getText(source) === "filteredDelegateActionableItems.map") ownQueue = true;
      }
      ts.forEachChild(node, walk);
    }; walk(source); expect(ownQueue).toBe(true);
    const selected = item(), stopPropagation = vi.fn(), setManagerAssignmentItem = vi.fn();
    vm.runInNewContext(ts.transpileModule(`(${handler})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, { setManagerAssignmentItem, item: selected })({ stopPropagation });
    expect(stopPropagation).toHaveBeenCalledTimes(1); expect(setManagerAssignmentItem).toHaveBeenCalledWith(selected);
  });
});

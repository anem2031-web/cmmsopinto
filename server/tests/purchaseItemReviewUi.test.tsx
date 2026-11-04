import React from "react";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import ar from "../../client/src/i18n/ar";
import { renderToStaticMarkup } from "react-dom/server";
import * as review from "../../shared/purchase-item-review";

function read(file: string) {
  const source = readFileSync(file, "utf8"), ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const values = new Map<string, string>(); let panel = "";
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && node.initializer) values.set(node.name.getText(ast), node.initializer.getText(ast));
    if (ts.isJsxExpression(node) && node.expression?.getText(ast).startsWith("(hasRoutedReview ? reviewableItems.length")) panel = node.expression.getText(ast);
    ts.forEachChild(node, visit);
  }
  visit(ast); return { source, values, panel };
}
const detail = read("client/src/pages/purchase/PurchaseOrderDetail.tsx"), listing = read("client/src/pages/purchase/PurchaseOrders.tsx");
function evaluate(code: string, scope: any) {
  return vm.runInNewContext(ts.transpileModule(`(${code})`, { compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 } }).outputText, { React, ...review, ...scope });
}
const actor = { id: 8, role: "general_maintenance_manager", isActive: 1 };
const item = (id: number, extra = {}) => ({ id, status: "pending_review", reviewRole: actor.role, itemName: `صنف ${id}`, quantity: 1, unit: "قطعة", ...extra });
function scope(items = [item(1), item(2), item(3, { reviewRole: "senior_management" })], overrides: any = {}) {
  const h: any = { user: actor, po: { id: 10, status: "pending_accounting", items }, selectedReviewItemIds: [], reviewDecisions: {}, bulkDelegateId: undefined,
    useMemo: (callback: any) => callback(), setReviewDecisions: (value: any) => { h.reviewDecisions = typeof value === "function" ? value(h.reviewDecisions) : value; },
    setSelectedReviewItemIds: (value: any) => { h.selectedReviewItemIds = typeof value === "function" ? value(h.selectedReviewItemIds) : value; },
    setBulkDelegateId: (value: any) => { h.bulkDelegateId = value; }, ...overrides };
  h.refresh = () => {
    h.hasRoutedReview = evaluate(detail.values.get("hasRoutedReview")!, h);
    h.routedReviewParentOpen = evaluate(detail.values.get("routedReviewParentOpen")!, h);
    h.reviewableItems = evaluate(detail.values.get("reviewableItems")!, h);
    h.selectedReviewItems = evaluate(detail.values.get("selectedReviewItems")!, h);
  };
  for (const name of ["handleBulkApprove", "handleBulkAssignDelegate"]) h[name] = (...args: any[]) => { h.refresh(); return evaluate(detail.values.get(name)!, h)(...args); };
  h.refresh(); return h;
}
const frame = ({ children }: any) => <div>{children}</div>;
function panel(h: any) {
  h.refresh();
  return evaluate(detail.panel, { ...h, isManager: ["admin", "owner", "maintenance_manager", "general_maintenance_manager", "construction_procurement_manager"].includes(h.user.role),
    users: [{ id: 20, role: "delegate", name: "المندوب" }], t: ar, displayUnit: (v: string) => v, getField: (i: any, key: string) => i[key],
    Card: frame, CardHeader: frame, CardTitle: frame, CardContent: frame, Button: frame, Select: frame, SelectTrigger: frame, SelectValue: frame, SelectContent: frame, SelectItem: frame, Label: frame, Input: frame, Loader2: frame, CheckCircle2: frame });
}
function elements(tree: any, match: (node: any) => boolean): any[] {
  if (!tree || typeof tree !== "object") return [];
  if (Array.isArray(tree)) return tree.flatMap(child => elements(child, match));
  return [...(match(tree) ? [tree] : []), ...elements(tree.props?.children, match)];
}

describe("Routed purchase review UI, actual view expressions without API or environment", () => {
  it("keeps own pending items actionable even while another item reached accounting", () => {
    const h = scope([item(1), item(2, { status: "pending", reviewedById: 8, reviewedAt: "2026-11-03" }), item(3, { reviewRole: "senior_management" })]);
    expect(h.reviewableItems.map((i: any) => i.id)).toEqual([1]);
    expect(panel({ ...h, reviewItemsMut: { isPending: false } })).toBeTruthy();
  });
  it.each(["senior_management", "construction_procurement_manager", "general_maintenance_manager"])("shows initial review for assigned role %s only", role => {
    const h = scope([item(1, { reviewRole: role }), item(2, { reviewRole: "foreign" })], { user: { ...actor, role } });
    expect(h.reviewableItems.map((i: any) => i.id)).toEqual([1]);
    expect(panel({ ...h, reviewItemsMut: { isPending: false } })).toBeTruthy();
  });
  it("has no review panel for inactive actors or foreign items", () => {
    for (const user of [{ ...actor, isActive: 0 }, { ...actor, role: "technician" }]) {
      const h = scope(undefined, { user }); expect(h.reviewableItems).toHaveLength(0);
      expect(panel({ ...h, reviewItemsMut: { isPending: false } })).toBe(false);
    }
  });
  it.each(["draft", "revision_needed", "closed", "rejected"])("blocks routed review and initial item actions in parent %s, including owner/admin", status => {
    for (const role of ["general_maintenance_manager", "owner", "admin"]) {
      const items = [item(1)], h = scope(items, { user: { ...actor, role }, po: { id: 10, status, items }, reviewItemsMut: { isPending: false } });
      expect(h.reviewableItems).toHaveLength(0); expect(h.selectedReviewItems).toHaveLength(0); expect(panel(h)).toBe(false);
      const local = { ...h, item: items[0], routedReviewItem: true };
      expect(evaluate(detail.values.get("canReviewThisItem")!, local)).toBe(false);
      expect(evaluate(detail.values.get("routedInitialReviewBlocked")!, local)).toBe(true);
    }
    expect(detail.source).toContain("po && !isCancelledRaw && !routedInitialReviewBlocked");
    expect(detail.source).toContain("{!routedInitialReviewBlocked && (routedReviewItem ?");
  });
  it("assigns only selected items and leaves other decisions and departments untouched", () => {
    const h = scope(undefined, { selectedReviewItemIds: [2], reviewDecisions: { 1: { action: "reject", rejectionReason: "سبب" } } });
    h.handleBulkApprove(); h.handleBulkAssignDelegate(20);
    expect(h.reviewDecisions).toEqual({ 1: { action: "reject", rejectionReason: "سبب" }, 2: { action: "approve", delegateId: 20 } });
    h.refresh(); expect(h.selectedReviewItems.map((i: any) => i.id)).toEqual([2]);
  });
  it("submits one valid selected item without requiring or sending other items", () => {
    const mutate = vi.fn(), h = scope(undefined, { selectedReviewItemIds: [2], reviewDecisions: { 2: { action: "approve", delegateId: 20 } }, reviewItemsMut: { isPending: false, mutate } });
    const send = elements(panel(h), node => node.props?.className === "w-full gap-1.5")[0];
    expect(send.props.disabled).toBe(false); send.props.onClick();
    expect(mutate).toHaveBeenCalledWith({ poId: 10, items: [{ id: 2, action: "approve", delegateId: 20, rejectionReason: undefined }] });
  });
  it("blocks empty selection and a selected rejection without a reason", () => {
    for (const extra of [{ selectedReviewItemIds: [] }, { selectedReviewItemIds: [1], reviewDecisions: { 1: { action: "reject", rejectionReason: " " } } }]) {
      const h = scope(undefined, { ...extra, reviewItemsMut: { isPending: false } });
      expect(elements(panel(h), n => n.props?.className === "w-full gap-1.5")[0].props.disabled).toBe(true);
    }
  });
  it("preserves all-item review for legacy orders without granting it to senior management", () => {
    const legacy = [{ id: 1, status: "pending", itemName: "قديم", quantity: 1 }, { id: 2, status: "cancelled" }];
    const h = scope(legacy as any, { po: { id: 10, status: "pending_review", items: legacy }, reviewItemsMut: { isPending: false } });
    expect(h.hasRoutedReview).toBe(false); expect(h.selectedReviewItems.map((i: any) => i.id)).toEqual([1]);
    expect(panel(h)).toBeTruthy();
    expect(panel({ ...h, user: { ...actor, role: "senior_management" } })).toBe(false);
  });
  it("groups only own pending routed package lines regardless of header status, preserving legacy grouping scope", () => {
    const old = { id: 12, status: "pending_review", items: [{ id: 100, status: "pending" }] };
    const h: any = { user: actor, useMemo: (f: any) => f(), isReviewerGroupingActionRole: true, isLegacyReviewerGroupingActionRole: true,
      reviewerActionableOrderIds: new Set([10, 11, 12]), actionablePackageCards: [{ id: 1, cardType: "package", orders: [
        { id: 10, status: "approved", items: [item(1), item(2, { reviewRole: "senior_management" }), item(3, { status: "approved" })] },
        { id: 11, status: "pending_review", items: [item(4, { reviewRole: "senior_management" })] }, old,
      ] }] };
    const result = evaluate(listing.values.get("reviewerActionablePackages")!, h);
    expect(result[0].actionableOrders.map((o: any) => o.id)).toEqual([10, 12]);
    expect(result[0].actionableOrders[0].items.map((i: any) => i.id)).toEqual([1]);
    const senior = evaluate(listing.values.get("reviewerActionablePackages")!, { ...h, user: { ...actor, role: "senior_management" }, isLegacyReviewerGroupingActionRole: false });
    expect(senior[0].actionableOrders.map((o: any) => o.id)).toEqual([10, 11]);
    expect(listing.source).toContain('const canGroup = user && ["owner", "admin", "maintenance_manager", "general_maintenance_manager", "construction_procurement_manager", "purchase_manager", "food_warehouse_manager"].includes(user.role)');
  });
  it("separates senior review, accounting and management queues with independent counts and explicit stages", () => {
    const h: any = { isSeniorReviewRole: true, seniorActionTab: "review", isPackageSubmissionActionRole: true, isReviewerGroupingActionRole: true, isDelegatePricingActionRole: false,
      actionableItems: [{ id: 10, status: "pending_management", reviewAction: "review" }, { id: 11, status: "pending_management" }, { id: 12, status: "approved", reviewAction: "delegate_change" }, { id: 13, status: "pending_management" }],
      unifiedApprovalQ: { data: { items: [{ id: 1, status: "pending_management", coveredOrderIds: [10, 11], submissionIds: [100] }, { id: 99, status: "approved" }] }, isLoading: false },
      seniorAccountingQ: { data: { items: [{ id: 2, status: "pending_accounting", coveredOrderIds: [20], submissionIds: [200] }, { id: 98, status: "pending_management" }] }, isLoading: false },
      actionableSubmissionItems: [{ submissionId: 101, orderIds: [30] }], actionableSubmissionOrderIds: new Set([30]),
      reviewerActionablePackages: [{ id: 9 }], reviewerPackagedOrderIds: new Set([10]), delegatePricingPackagedOrderIds: new Set(),
      useMemo: (f: any) => f(), actionableLoading: false, actionablePackageCardsLoading: false, actionableSubmissionsLoading: false };
    const refresh = () => {
      for (const name of ["seniorAccountingItems", "seniorManagementItems", "currentUnifiedApprovalQ", "unifiedApprovalItems", "allUnifiedApprovalItems", "unifiedSubmissionIds", "unifiedOrderIds", "standaloneActionableItems", "seniorReviewActionItems", "seniorManagementActionItems", "seniorActionCounts", "displayedStandaloneActionableItems", "showReviewActionCards", "showFinancialActionCards", "showLegacySubmissionCards", "actionableDisplayCount", "currentActionableDisplayCount", "actionableViewLoading"]) h[name] = evaluate(listing.values.get(name)!, h);
    };
    refresh();
    expect(h.seniorActionCounts).toEqual({ review: 2, accounting: 1, management: 3 });
    expect(h.displayedStandaloneActionableItems.map((row: any) => row.id)).toEqual([12]);
    expect(h.unifiedApprovalItems).toEqual([]);
    expect(h.showReviewActionCards).toBe(true); expect(h.showFinancialActionCards).toBe(false);
    expect(h.actionableDisplayCount).toBe(6);
    h.seniorActionTab = "accounting"; h.unifiedApprovalQ.isLoading = true; refresh();
    expect(h.unifiedApprovalItems.map((row: any) => row.id)).toEqual([2]);
    expect(h.currentActionableDisplayCount).toBe(1); expect(h.displayedStandaloneActionableItems).toEqual([]);
    expect(h.showReviewActionCards).toBe(false); expect(h.showLegacySubmissionCards).toBe(false);
    expect(h.actionableViewLoading).toBe(false);
    h.seniorActionTab = "management"; refresh();
    expect(h.unifiedApprovalItems.map((row: any) => row.id)).toEqual([1]);
    expect(h.displayedStandaloneActionableItems.map((row: any) => row.id)).toEqual([13]);
    expect(h.currentActionableDisplayCount).toBe(3); expect(h.showLegacySubmissionCards).toBe(true);
  });
  it("renders three senior stage controls with counts and switches the selected tab without changing other roles", () => {
    const ast = ts.createSourceFile("List.tsx", listing.source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX); let nav = "";
    function find(node: ts.Node) {
      if (ts.isJsxElement(node) && node.openingElement.getText(ast).includes('aria-label={t.purchaseOrders.reviewStages}')) nav = node.getText(ast);
      ts.forEachChild(node, find);
    } find(ast);
    const h: any = { t: ar, Button: (p: any) => <button aria-pressed={p["aria-pressed"]}>{p.children}</button>, seniorActionTab: "review", seniorActionCounts: { review: 2, accounting: 3, management: 4 } };
    h.setSeniorActionTab = (stage: string) => { h.seniorActionTab = stage; };
    const tree = evaluate(nav, h), html = renderToStaticMarkup(tree);
    expect(html).toContain("مراجعة الأصناف الموجّهة (2)"); expect(html).toContain("اعتماد الحسابات (3)"); expect(html).toContain("اعتماد الإدارة العليا (4)");
    const accounting = elements(tree, node => node.props?.["data-review-stage"] === "accounting")[0]; accounting.props.onClick();
    expect(h.seniorActionTab).toBe("accounting");
    const controls = elements(evaluate(nav, h), node => node.props?.["data-review-stage"]);
    expect(controls.filter(n => n.props["aria-pressed"]).map(n => n.props["data-review-stage"])).toEqual(["accounting"]);
    expect(listing.source).toContain("{isSeniorReviewRole && <div");
  });
});

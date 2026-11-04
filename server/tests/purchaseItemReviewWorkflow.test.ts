import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { TRPCError } from "@trpc/server";
import { describe, expect, it, vi } from "vitest";
import { deriveRoutedPurchaseOrderStage, hasCommittedPurchaseItemReview, pendingPurchaseReviewCount } from "../../shared/purchaseItemReviewWorkflow";
import { assertBundleItemEligible } from "../../shared/delegate-pricing-bundles";
import { getDelegateItemActionMode } from "../routers/purchase/actionable";
import { assertCanPerformAction } from "../_core/authz/engine";

const pendingReview = { status: "pending_review", reviewRole: "general_maintenance_manager", reviewedById: null, reviewedAt: null, batchId: null };
const reviewed = { ...pendingReview, status: "pending", reviewedById: 22, reviewedAt: "2026-11-03", delegateId: 11 };
describe("Mixed review stages are a summary, not authority over another item", () => {
  it.each([
    ["pending", "pending_estimate"], ["estimated", "pending_estimate"], ["approved", "approved"], ["funded", "approved"],
    ["purchased", "partial_purchase"], ["delivered_to_warehouse", "partial_purchase"], ["delivered_to_requester", "partial_purchase"],
    ["rejected", "pending_review"], ["cancelled", "pending_review"],
  ])("summarizes B %s while A remains reviewable as %s", (status, expected) => {
    expect(deriveRoutedPurchaseOrderStage("pending_accounting", [pendingReview, { ...reviewed, status }], [])).toBe(expected);
    expect(pendingPurchaseReviewCount([pendingReview, { ...reviewed, status }])).toBe(1);
  });
  it("keeps an outstanding real batch visible, ignoring another batch with no active member", () => {
    const rows = [pendingReview, { ...reviewed, status: "estimated", batchId: 5 }];
    expect(deriveRoutedPurchaseOrderStage("pending_estimate", rows, [{ id: 5, status: "pending_accounting" }])).toBe("pending_accounting");
    expect(deriveRoutedPurchaseOrderStage("pending_accounting", rows, [{ id: 5, status: "pending_management" }, { id: 99, status: "pending_accounting" }])).toBe("pending_management");
    expect(deriveRoutedPurchaseOrderStage("pending_management", rows)).toBe("pending_management");
  });
  it.each(["draft", "closed", "rejected", "revision_needed"])("never reopens unavailable parent %s", status => {
    expect(deriveRoutedPurchaseOrderStage(status, [reviewed], [])).toBe(status);
    expect(getDelegateItemActionMode(status, reviewed)).toBeNull();
  });
  it("does not change historical aggregate status or grant historical pending-review delegate actions", () => {
    const legacy = { status: "approved", batchId: null, purchaseOrderId: 1 };
    expect(deriveRoutedPurchaseOrderStage("received", [legacy], [])).toBe("received");
    expect(getDelegateItemActionMode("pending_review", legacy)).toBeNull();
    expect(getDelegateItemActionMode("pending_estimate", legacy)).toBeNull();
    expect(hasCommittedPurchaseItemReview(legacy)).toBe(false);
  });
  it("needs every active item before reporting purchase/receipt complete, and nonempty active sets", () => {
    expect(deriveRoutedPurchaseOrderStage("approved", [{ ...reviewed, status: "purchased" }, { ...reviewed, status: "delivered_to_warehouse" }], [])).toBe("purchased");
    expect(deriveRoutedPurchaseOrderStage("purchased", [{ ...reviewed, status: "delivered_to_requester" }, { ...reviewed, status: "delivered_to_warehouse" }], [])).toBe("received");
    expect(deriveRoutedPurchaseOrderStage("approved", [{ ...reviewed, status: "rejected" }], [])).toBe("rejected");
    expect(deriveRoutedPurchaseOrderStage("pending_review", [], [])).toBe("pending_review");
  });
});

describe("Only reviewed routed items enter the existing delegate/DPB workflow", () => {
  it.each(["pending_review", "pending_estimate", "pending_accounting", "pending_management", "approved", "partial_purchase", "purchased", "received"])("keeps item authority independent of mixed parent %s", parent => {
    expect(getDelegateItemActionMode(parent, pendingReview)).toBeNull();
    expect(getDelegateItemActionMode(parent, reviewed)).toBe("estimate");
    expect(getDelegateItemActionMode(parent, { ...reviewed, status: "approved", batchId: 5 })).toBe("purchase");
    expect(getDelegateItemActionMode(parent, { ...reviewed, status: "pending", delegateChangeRequestedAt: "2026-11-03" })).toBeNull();
  });
  it("lets an already-reviewed estimate join a DPB without requiring the other reviewers to finish", () => {
    const quote = { ...reviewed, status: "estimated", purchaseOrderStatus: "pending_review", quantity: 2, estimatedUnitCost: "10", estimatedTotalCost: "20" };
    expect(() => assertBundleItemEligible(quote, 11)).not.toThrow();
    for (const changes of [{ reviewedById: null }, { reviewedAt: null }, { delegateId: 12 }, { status: "pending_review" }, { batchId: 7 }, { delegateChangeRequestedAt: "2026-11-03" }, { estimatedTotalCost: "99" }]) {
      expect(() => assertBundleItemEligible({ ...quote, ...changes }, 11)).toThrow();
    }
    expect(() => assertBundleItemEligible({ ...quote, reviewRole: null }, 11)).toThrow();
  });
});

describe("Actual whole-order financial handlers cannot bypass a routed item's review", () => {
  const source = ts.createSourceFile("approvals.router.ts", readFileSync("server/routers/purchase/approvals.router.ts", "utf8"), ts.ScriptTarget.Latest, true);
  function handler(name: string) {
    let text = "";
    function find(node: ts.Node) { if (ts.isPropertyAssignment(node) && node.name.getText(source) === name && ts.isCallExpression(node.initializer)) text = node.initializer.arguments[0].getText(source); ts.forEachChild(node, find); }
    find(source); if (!text) throw Error("Missing financial handler");
    return ts.transpileModule(`(${text})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  }
  it.each(["approveAccounting", "approveManagement", "reject"] as const)("%s rejects routed requests before any price/status/approval writer, while legacy follows its original writer", async name => {
    const stage = name === "approveManagement" ? "pending_management" : "pending_accounting";
    const role = name === "approveManagement" ? "senior_management" : "accountant";
    let rows: any[] = [{ ...pendingReview, id: 1, purchaseOrderId: 1 }, { ...reviewed, id: 2, purchaseOrderId: 1, status: "estimated" }];
    const updateItem = vi.fn(); const updateHeader = vi.fn(() => { throw Error("legacy writer reached"); });
    const db = { getDb: vi.fn(async () => ({})), getPurchaseOrderById: vi.fn(async () => ({ id: 1, status: stage })),
      getPOItems: vi.fn(async () => rows), withTransaction: (fn: any) => fn({}), updatePOItemIfNotTerminal: updateItem, updatePurchaseOrder: updateHeader };
    const run = vm.runInNewContext(handler(name), { db, TRPCError, assertLegacyApprovalOutsideUnifiedBundle: async () => {}, assertNoReplacementOrder: async () => {},
      captureAccountingSignature: () => "existing-signature", assertCanPerformPOAction: (action: any, user: any, po: any) => assertCanPerformAction(action, { role: user.role, userId: user.id }, po) });
    const request = { input: { id: 1, custodyAmount: "100", rejectedItemIds: [] }, ctx: { user: { id: 7, role, isActive: 1 } } };
    await expect(run(request)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" }); expect(updateItem).not.toHaveBeenCalled(); expect(updateHeader).not.toHaveBeenCalled();
    rows = rows.map(row => ({ ...row, reviewRole: null }));
    await expect(run(request)).rejects.toThrow("legacy writer reached"); expect(updateHeader).toHaveBeenCalledOnce();
  });
});

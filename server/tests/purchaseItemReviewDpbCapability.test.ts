import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { TRPCError } from "@trpc/server";
import { APP_ROLE } from "../../shared/roles";
import { canApprovePricingBundleStage, businessRpcAllowed } from "../../shared/business-role-policy";
import { assertCanPerformAction, canPerformAction } from "../_core/authz/engine";
import { authorizePurchaseDocument } from "../_core/authz/purchase-document";

function productionAuthorizer() {
  const file = "server/routers/delegate-pricing-bundles/unified-ports.ts";
  const ast = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  let code = "";
  function visit(node: ts.Node) {
    if (ts.isPropertyAssignment(node) && node.name.getText(ast) === "authorizeStage") code = node.initializer.getText(ast);
    ts.forEachChild(node, visit);
  }
  visit(ast);
  if (!code) throw Error("Production DPB authorizer missing");
  const calls: any[] = [];
  const authorize = vm.runInNewContext(ts.transpileModule(`(${code})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, {
    canApprovePricingBundleStage, TRPCError,
    assertCanPerformPOAction: (action: any, actor: any, order: any) => {
      calls.push({ actor, action, order });
      assertCanPerformAction(action, { role: actor.role, userId: actor.id }, order);
    },
  });
  return { authorize, calls };
}

describe("Independent DPB-only accounting capability matrix", () => {
  it.each(Object.values(APP_ROLE))("keeps stage permissions exact for %s, with no role substitution", role => {
    const actor = { id: 8, role, isActive: 1 };
    const { authorize, calls } = productionAuthorizer();
    for (const stage of ["accounting", "management"] as const) {
      const allowed = stage === "accounting" ? ["owner", "admin", "accountant", "senior_management"].includes(role) : ["owner", "admin", "senior_management"].includes(role);
      expect(canApprovePricingBundleStage(actor, stage)).toBe(allowed);
      if (allowed) expect(() => authorize(actor, stage, [{ id: 1, status: "pending_review" }])).not.toThrow();
      else expect(() => authorize(actor, stage, [{ id: 1, status: "pending_review" }])).toThrow();
      expect(canApprovePricingBundleStage({ ...actor, isActive: 0 }, stage)).toBe(false);
      expect(() => authorize({ ...actor, isActive: 0 }, stage, [{ id: 1, status: "pending_accounting" }])).toThrow();
    }
    for (const call of calls) expect(call.actor).toBe(actor);
  });
  it("keeps legacy PO/PB accounting and the global policy denied to senior", () => {
    const actor = { id: 8, role: "senior_management", isActive: 1 };
    expect(businessRpcAllowed(actor, "mutation", "delegatePricingBundles.approveAccounting")).toBe(true);
    for (const name of ["purchaseOrders.approveAccounting", "purchaseOrders.approveAccountingBatch", "purchaseOrders.rejectAccountingBatchItem", "purchasePackages.approveAccountingSubmission"]) {
      expect(businessRpcAllowed(actor, "mutation", name)).toBe(false);
    }
    expect(canPerformAction("approveAccounting", { role: actor.role, userId: actor.id }, { status: "pending_accounting" })).toBe(false);
    for (const actor of [null, { id: 0, role: "senior_management", isActive: 1 }, { id: 8, role: "senior_management" }]) {
      expect(canApprovePricingBundleStage(actor as any, "accounting")).toBe(false);
    }
  });
  it("does not treat initial review or DPB accounting as the senior's financial PDF approval", async () => {
    const actor = { id: 8, role: "senior_management", isActive: 1 };
    const batch: any = { id: 12, purchaseOrderId: 1, reviewedById: 8, reviewedAt: "2026-11-03", accountingApprovedById: 8, accountingApprovedAt: "2026-11-03", managementApprovedById: null, managementApprovedAt: null };
    const source: any = { order: vi.fn(async () => ({ ...batch, id: 1 })), batch: vi.fn(async () => batch), authorize: vi.fn(), batches: vi.fn(async () => []), submission: vi.fn() };
    await expect(authorizePurchaseDocument(actor, 1, 12, undefined, source)).rejects.toMatchObject({ code: "FORBIDDEN" });
    batch.managementApprovedById = 8; batch.managementApprovedAt = "2026-11-04";
    await expect(authorizePurchaseDocument(actor, 1, 12, undefined, source)).resolves.toBeTruthy();
    await expect(authorizePurchaseDocument({ ...actor, id: 9 }, 1, 12, undefined, source)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

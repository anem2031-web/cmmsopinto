import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../_core/trpc";
import { isDelegateRole } from "../../shared/roles";
import { isDelegateOwnPurchaseDraft } from "../../shared/purchaseDraftVisibility";
import { isPurchasePdfApprover } from "../_core/authz/purchase-document";

const document = { id: 1, requestedById: 7, poNumber: "PR-FIXTURE" };
const items = [{ id: 11, delegateId: 3 }, { id: 12, delegateId: 4 }];
const comments = [{ purchaseOrderItemId: 11 }, { purchaseOrderItemId: 12 }];
const scope = vi.fn((_user: any, po: any) => { if (po.id !== 1) throw new TRPCError({ code: "FORBIDDEN" }); });
const names = vi.fn(async (value: any) => value);
const packageOrders = vi.fn(async () => [{ ...document, items }]);
function procedure(file: string, rootName: string) {
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  let expression = "";
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (declaration.name.getText(source) !== rootName || !declaration.initializer || !ts.isCallExpression(declaration.initializer)) continue;
      const object = declaration.initializer.arguments[0] as ts.ObjectLiteralExpression;
      const property = object.properties.find(node => ts.isPropertyAssignment(node) && node.name.getText(source) === "getById") as ts.PropertyAssignment;
      expression = property.initializer.getText(source);
    }
  }
  if (!expression) throw new Error("Missing production document handler");
  return vm.runInNewContext(ts.transpileModule(`(${expression})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, {
    z, TRPCError, protectedProcedure, isDelegateRole, isDelegateOwnPurchaseDraft, isPurchasePdfApprover,
    db: { getPurchaseOrderById: async (id: number) => ({ ...document, id }), getPOItems: async () => items, getProcurementComments: async () => comments, getPurchasePackageById: async () => ({ id: 20, createdById: 8 }) },
    assertCanViewPurchaseOrder: scope, assertCanPerformPOAction: () => {},
    createPurchaseOrderReadScope: async (user: any) => ({
      assert: (po: any) => scope(user, po),
      filterItems: (_po: any, rows: any[]) => rows,
      isRoutedReviewOnly: () => false,
    }),
    localizePurchaseUserNames: async (rows: any) => rows,
    localizeMasterDataReferences: names, getVisiblePackageOrdersWithItems: packageOrders,
    withPurchaseSubmissionTime: (value: any) => value,
  });
}
const api = router({
  purchaseOrders: router({ getById: procedure("server/routers/purchase/purchase-orders.router.ts", "purchaseOrdersRouter") }),
  purchasePackages: router({ getById: procedure("server/routers/purchase/purchase-packages.router.ts", "purchasePackagesRouter") }),
});
const caller = (role = "delegate") => api.createCaller({ user: { id: 3, role, isActive: 1, preferredLanguage: "en" } } as any);
beforeEach(() => { vi.clearAllMocks(); packageOrders.mockResolvedValue([{ ...document, items }]); });

describe("Document participant names without a global delegate directory", () => {
  it("reads names only after PO authorization and after filtering foreign items/comments", async () => {
    const result = await caller().purchaseOrders.getById({ id: 1 });
    expect(scope).toHaveBeenCalledOnce();
    expect(names).toHaveBeenCalledOnce();
    expect(result.requestedById).toBe(7);
    expect(result.items.map((item: any) => item.id)).toEqual([11]);
    expect(result.comments).toEqual([{ purchaseOrderItemId: 11 }]);
    expect(names.mock.calls[0][0]).toMatchObject({ requestedById: 7, requestedByName: null, items: [{ id: 11, delegateId: 3, delegateName: null }] });
    expect(JSON.stringify(names.mock.calls[0][0])).not.toContain('"delegateId":4');
  });
  it("does not resolve names for a guessed inaccessible purchase order", async () => {
    await expect(caller().purchaseOrders.getById({ id: 99 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(names).not.toHaveBeenCalled();
  });
  it("retains package creator and visible-order participant names after filtering foreign items", async () => {
    const result = await caller().purchasePackages.getById({ id: 20 });
    expect(names).toHaveBeenCalledOnce();
    expect(result.createdById).toBe(8);
    expect(result.orders[0].items.map((item: any) => item.id)).toEqual([11]);
    expect(names.mock.calls[0][0]).toMatchObject({ createdByName: null, orders: [{ requestedById: 7, requestedByName: null }] });
  });
  it("does not resolve names or expose a package with no visible orders", async () => {
    packageOrders.mockResolvedValue([]);
    await expect(caller().purchasePackages.getById({ id: 20 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(names).not.toHaveBeenCalled();
  });
  it("retains the prior administrator response without the delegate display-name query", async () => {
    const result = await caller("admin").purchaseOrders.getById({ id: 1 });
    expect(result.items).toHaveLength(2);
    expect(result.comments).toHaveLength(2);
    expect(names).not.toHaveBeenCalled();
  });
});

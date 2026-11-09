import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../_core/trpc";
import { canRoleAccessPurchaseSupplyTracking, canRoleViewAllPurchaseSupplyTracking, isDelegateRole } from "../../shared/roles";
import { businessRpcAllowed } from "../../shared/business-role-policy";
import { isDelegateSupplyItemOpen } from "../../shared/delegateSupplyStage";
import { getOverdueCalendarDays, formatDateOnly, formatOverdueDuration } from "../../client/src/lib/purchaseItemTiming";
import ar from "../../client/src/i18n/ar";
import en from "../../client/src/i18n/en";
import ur from "../../client/src/i18n/ur";
vi.mock("../_core/db", () => ({}));
const ast = (file: string) => ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function extract(file: string, predicate: (node: ts.Node, source: ts.SourceFile) => string | undefined) {
  const source = ast(file); let found = "";
  const walk = (node: ts.Node) => { const value = predicate(node, source); if (value) found = value; ts.forEachChild(node, walk); };
  walk(source); if (!found) throw Error(`Missing production expression: ${file}`); return found;
}
const evaluate = (code: string, context: object) => vm.runInNewContext(ts.transpileModule(`(${code})`, { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText, { React, ...context });
const page = "client/src/pages/purchase/PurchaseOrders.tsx";
const handler = extract("server/routers/purchase/purchase-orders.router.ts", (n, s) => ts.isPropertyAssignment(n) && n.name.getText(s) === "supplyTracking" ? n.initializer.getText(s) : undefined);
const filterCode = extract(page, (n, s) => ts.isVariableDeclaration(n) && n.name.getText(s) === "filteredSupplyTrackingItems" ? n.initializer!.getText(s) : undefined);
const datesAllowed = extract(page, (n, s) => ts.isVariableDeclaration(n) && n.name.getText(s) === "canFilterSupplyRequiredDate" ? n.initializer!.getText(s) : undefined);
const dateControls = extract(page, (n, s) => ts.isJsxExpression(n) && n.expression?.getText(s).startsWith("canFilterSupplyRequiredDate &&") ? n.expression.getText(s) : undefined);
const delegateControls = extract(page, (n, s) => ts.isJsxExpression(n) && n.expression?.getText(s).startsWith("canViewAllSupplyTracking &&") && n.expression.getText(s).includes("supplyAllDelegates") ? n.expression.getText(s) : undefined);
const fixture = [
  { id: 1, purchaseOrderId: 10, delegateId: 11, requestedById: 99, status: "approved", requiredDate: "2026-11-06" },
  { id: 2, purchaseOrderId: 10, delegateId: 22, requestedById: 88, status: "purchased", requiredDate: "2026-11-08" },
  { id: 3, purchaseOrderId: 20, delegateId: 11, requestedById: 77, status: "approved", requiredDate: "2026-11-09" },
  { id: 4, purchaseOrderId: 20, delegateId: 22, requestedById: 66, status: "approved", requiredDate: null },
];
const db = { getPurchaseSupplyTrackingItems: vi.fn(async (_delegate?: number) => fixture) };
const api = router({ purchaseOrders: router({ supplyTracking: evaluate(handler, {
  protectedProcedure, TRPCError, db, isDelegateRole, canRoleViewAllPurchaseSupplyTracking,
  enrichPurchaseCycleItemsBatch: async (rows: any[]) => rows,
  isDelegateSupplyItemOpen, localizePurchaseUserNames: async (rows: any[]) => rows,
}) }) });
const identity = (role: string, isActive = 1) => ({ id: 11, role, isActive, preferredLanguage: "ar" });
const caller = (role: string, isActive = 1, projected = false): any => {
  const user = identity(role, isActive);
  return api.createCaller({ user: projected ? { ...user, role: "admin" } : user, authenticatedUser: user, req: {}, res: {} } as any);
};
beforeEach(() => vi.clearAllMocks());

describe("supply follow-up permissions", () => {
  it.each(["senior_management", "admin", "owner", "warehouse"])("%s reads all delegate/creator items with one batch read", async role => {
    expect(canRoleAccessPurchaseSupplyTracking(role)).toBe(true);
    expect(canRoleViewAllPurchaseSupplyTracking(role)).toBe(true);
    const result = await caller(role).purchaseOrders.supplyTracking();
    expect(result).toEqual({ items: fixture, total: 4, scope: "all" });
    expect(db.getPurchaseSupplyTrackingItems.mock.calls).toEqual([[]]);
  });
  it.each(["delegate", "delegate_manager"])("%s retains its own assignment scope even with foreign rows", async role => {
    const result = await caller(role).purchaseOrders.supplyTracking();
    expect(result.items.map((i: any) => i.id)).toEqual([1, 3]);
    expect(result.scope).toBe("delegate");
    expect(db.getPurchaseSupplyTrackingItems.mock.calls).toEqual([[11]]);
  });
  it.each(["accountant", "executive_director", "purchase_requester", "operator", "food_warehouse_assistant", "food_warehouse_manager"])("denies direct %s access", async role => {
    await expect(caller(role).purchaseOrders.supplyTracking()).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(db.getPurchaseSupplyTrackingItems).not.toHaveBeenCalled();
  });
  it.each([false, true])("denies inactive senior (projected=%s) before data access", async projected => {
    await expect(caller("senior_management", 0, projected).purchaseOrders.supplyTracking()).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(db.getPurchaseSupplyTrackingItems).not.toHaveBeenCalled();
  });
  it.each([false, true])("denies inactive warehouse (projected=%s) before data access", async projected => {
    await expect(caller("warehouse", 0, projected).purchaseOrders.supplyTracking()).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(db.getPurchaseSupplyTrackingItems).not.toHaveBeenCalled();
  });
  it("grants this query alone, without a corresponding mutation", () => {
    expect(businessRpcAllowed(identity("senior_management"), "query", "purchaseOrders.supplyTracking")).toBe(true);
    expect(businessRpcAllowed(identity("senior_management"), "mutation", "purchaseOrders.supplyTracking")).toBe(false);
    expect(businessRpcAllowed(identity("warehouse"), "query", "purchaseOrders.supplyTracking")).toBe(true);
    expect(businessRpcAllowed(identity("warehouse"), "mutation", "purchaseOrders.supplyTracking")).toBe(false);
    expect(businessRpcAllowed(identity("accountant"), "query", "purchaseOrders.supplyTracking")).toBe(false);
  });
  it("keeps requests independent and query count constant for repeated parents", async () => {
    db.getPurchaseSupplyTrackingItems.mockResolvedValueOnce(Array.from({ length: 600 }, (_, id) => ({ ...fixture[0], id })));
    expect((await caller("senior_management").purchaseOrders.supplyTracking()).total).toBe(600);
    await expect(caller("accountant").purchaseOrders.supplyTracking()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await caller("delegate").purchaseOrders.supplyTracking();
    expect(db.getPurchaseSupplyTrackingItems.mock.calls).toEqual([[], [11]]);
  });
});

function filter(overrides: any = {}) {
  const user = identity(overrides.role || "senior_management");
  return evaluate(filterCode, {
    useMemo: (fn: () => any) => fn(), supplyTrackingItems: fixture, supplySearch: "", supplyOwnershipFilter: "all",
    supplyDelayFilter: "all", supplyCustomDays: "5", supplyDelegateFilter: "all", supplyRequiredFrom: "", supplyRequiredTo: "",
    canViewAllSupplyTracking: canRoleViewAllPurchaseSupplyTracking(user.role),
    canFilterSupplyRequiredDate: evaluate(datesAllowed, { user }), user, language: "ar", locale: "ar-SA", isDelegateRole,
    getLocalizedItemField: (item: any) => item.itemName, formatDateOnly,
    getOverdueCalendarDays: (date: string) => getOverdueCalendarDays(date, new Date(2026, 10, 9, 12)), ...overrides,
  }).map((i: any) => i.id);
}
describe("actual follow-up filters", () => {
  it.each(["senior_management", "admin", "owner", "warehouse"])("%s combines inclusive required dates and delegate", role => {
    expect(filter({ role, supplyRequiredFrom: "2026-11-06", supplyRequiredTo: "2026-11-08" })).toEqual([1, 2]);
    expect(filter({ role, supplyRequiredFrom: "2026-11-06", supplyRequiredTo: "2026-11-08", supplyDelegateFilter: "22" })).toEqual([2]);
    expect(filter({ role, supplyDelegateFilter: "11", supplyDelayFilter: "1" })).toEqual([1]);
  });
  it("filters all overdue, 3 days, custom days, and today correctly", () => {
    expect(filter({ supplyDelayFilter: "1" })).toEqual([1, 2]);
    expect(filter({ supplyDelayFilter: "3" })).toEqual([1]);
    expect(filter({ supplyDelayFilter: "custom", supplyCustomDays: "4" })).toEqual([]);
    expect(filter({ supplyDelayFilter: "7" })).toEqual([]);
    expect(formatOverdueDuration(3, "ar")).toBe("متأخر 3 أيام");
  });
  it("includes unknown dates only without date filters, and uses either range bound", () => {
    expect(filter()).toEqual([1, 2, 3, 4]);
    expect(filter({ supplyRequiredFrom: "2026-11-09" })).toEqual([3]);
    expect(filter({ supplyRequiredTo: "2026-11-08" })).toEqual([1, 2]);
    expect(filter({ supplyRequiredFrom: "2026-11-09", supplyRequiredTo: "2026-11-06" })).toEqual([]);
  });
  it("does not apply new date controls to other roles", () => {
    expect(evaluate(datesAllowed, { user: identity("maintenance_manager") })).toBe(false);
    expect(filter({ role: "delegate", supplyRequiredFrom: "2099-01-01" })).toEqual([1, 2, 3, 4]);
  });
  it.each([ar, en, ur])("renders the date/delegate controls in each existing language", t => {
    const Input = (props: any) => <input {...props} />;
    const Select = ({ children }: any) => <div>{children}</div>;
    const SelectItem = ({ children }: any) => <span>{children}</span>;
    const common = { t, Input, Select, SelectItem, SelectTrigger: Select, SelectContent: Select, SelectValue: () => null,
      supplyRequiredFrom: "", supplyRequiredTo: "", setSupplyRequiredFrom: () => {}, setSupplyRequiredTo: () => {},
      supplyDelegateFilter: "all", setSupplyDelegateFilter: () => {}, supplyDelegates: [{ id: 11, name: "Delegate fixture" }],
    };
    for (const role of ["senior_management", "admin", "owner", "warehouse"]) {
      const html = renderToStaticMarkup(<>{evaluate(dateControls, { ...common, canFilterSupplyRequiredDate: evaluate(datesAllowed, { user: identity(role) }) })}{evaluate(delegateControls, { ...common, canViewAllSupplyTracking: canRoleViewAllPurchaseSupplyTracking(role) })}</>);
      expect((html.match(/type="date"/g) || []).length).toBe(2);
      expect(html).toContain(t.purchaseOrders.requiredDate);
      expect(html).toContain("Delegate fixture");
    }
  });
});

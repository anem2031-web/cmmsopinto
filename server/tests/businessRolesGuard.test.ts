import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { router, publicProcedure, protectedProcedure } from "../_core/trpc";
import { inventoryReadProcedure, accountantProcedure, managementProcedure, warehouseProcedure } from "../routers/_shared/procedures";
import { BUSINESS_GUARDED_ROLES, businessHttpAllowed, canCreateUserRole, businessHomePath, isBusinessGuardedRole } from "../../shared/business-role-policy";
import { assertBusinessRpc } from "../_core/authz/business-guard";
import { assertBusinessTranslationAccess } from "../_core/authz/business-resources";
import { assertCanViewPurchaseOrder } from "../_core/authz/guard";
import { canRoleAccessPath, APP_ROLE } from "../../shared/roles";
import { observerHttpAllowed } from "../../shared/observer-policy";
import { technicianHttpAllowed } from "../../shared/technician-policy";

const spies = vi.hoisted(() => ({ audit: vi.fn(async () => [1]), write: vi.fn(async () => 1), po: vi.fn(), repair: vi.fn(), batches: vi.fn(async () => [{ id: 10 }]) }));
vi.mock("../_core/db", () => ({ getAuditLogsEnhanced: spies.audit, getPurchaseOrderById: spies.po, addInventoryTransaction: spies.write, getPurchaseItemReviewScopeRows: async () => [] }));
const ast = (file: string) => ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
function expression(file: string, property: string, variable?: string) {
  const source = ast(file); let found = "";
  function walk(node: ts.Node) {
    if (variable && ts.isVariableDeclaration(node) && node.name.getText(source) === variable && node.initializer && ts.isCallExpression(node.initializer)) {
      const object = node.initializer.arguments[0];
      if (ts.isObjectLiteralExpression(object)) {
        const field = object.properties.find(p => ts.isPropertyAssignment(p) && p.name.getText(source) === property) as ts.PropertyAssignment | undefined;
        if (field) found = field.initializer.getText(source);
      }
    } else if (!variable && ts.isPropertyAssignment(node) && node.name.getText(source) === property) found = node.initializer.getText(source);
    ts.forEachChild(node, walk);
  }
  walk(source); if (!found) throw Error(`Missing actual handler ${file}:${property}`); return found;
}
const evaluate = (code: string, scope: object) => vm.runInNewContext(ts.transpileModule(`(${code})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, scope);
const common = { z, TRPCError, protectedProcedure, inventoryReadProcedure, accountantProcedure, managementProcedure, warehouseProcedure };
const fixtureUser = { id: 1, name: "Fixture", role: "admin", passwordHash: "fixture-only-secret", signatureUrl: null };
const api = router({
  audit: router({ list: evaluate(expression("server/routers/system/audit.router.ts", "list"), { ...common, db: { getAuditLogsEnhanced: spies.audit } }) }),
  inventory: router({ addTransaction: evaluate(expression("server/routers/inventory/inventory.router.ts", "addTransaction"), { ...common, db: { addInventoryTransaction: spies.write }, materialExecutionCostsEnabled: () => false }) }),
  users: router({
    list: evaluate(expression("server/routers/users/users.router.ts", "list", "usersRouter"), { ...common, db: { getAllUsers: async () => [fixtureUser] }, cacheManager: { getOrCompute: async (_k: unknown, fn: () => unknown) => fn() }, cacheKeys: { users: () => "fixture" }, localizeNamedRecords: (_e: unknown, rows: unknown) => rows }),
    create: evaluate(expression("server/routers/users/users.router.ts", "create"), { ...common, canCreateUserRole, db: { getUserByUsername: async () => null, createLocalUser: spies.write, createAuditLog: async () => {} }, bcrypt: { hash: async () => "hash" }, detectLanguage: async () => "ar", queueTranslation: async () => {}, invalidateCache: { users: () => {} } }),
  }),
  purchaseOrders: router({
    list: protectedProcedure.query(() => [{ id: 1 }]),
    listPricingBatches: evaluate(expression("server/routers/purchase/purchase-orders.router.ts", "listPricingBatches"), { ...common, loadDocumentListPort: async () => ({}), db: { getPurchaseOrderById: spies.po, getPOPricingBatches: spies.batches }, rejectEmptyPendingPricingBatches: spies.repair, assertCanViewPurchaseOrder,
      purchaseDocumentPermission: async (user: { role: string }) => ({ pdfAllowed: !["accountant", "senior_management"].includes(user.role), pdfBlockedReason: ["accountant", "senior_management"].includes(user.role) ? "Awaiting fixture approval" : null }),
      isPurchasePdfApprover: (user: { role: string }) => ["accountant", "senior_management"].includes(user.role),
    }),
  }),
  auth: router({ me: publicProcedure.query(({ ctx }) => ctx.user), logout: publicProcedure.mutation(() => true) }),
  unreviewed: router({ read: publicProcedure.query(() => spies.write()), write: protectedProcedure.mutation(() => spies.write()) }),
});
const identity = (role: string, isActive = 1) => ({ id: 3, role, isActive, passwordHash: "fixture-only-secret", preferredLanguage: "ar" });
function context(role: string, isActive = 1, projected = false): any { const user = identity(role, isActive); return { user: projected ? { ...user, role: "admin" } : user, authenticatedUser: user, req: {}, res: {} }; }
const caller = (role: string, isActive = 1, projected = false) => api.createCaller(context(role, isActive, projected));
beforeEach(() => { vi.clearAllMocks(); spies.po.mockResolvedValue({ id: 1, status: "draft", requestedById: 90 }); });

describe.each(BUSINESS_GUARDED_ROLES)("Central enforcement for %s", role => {
  it("rejects actual audit API and unknown APIs before their resolvers", async () => {
    await expect(caller(role).audit.list()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller(role).unreviewed.read()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller(role).unreviewed.write()).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(spies.audit).not.toHaveBeenCalled(); expect(spies.write).not.toHaveBeenCalled();
  });
  it("keeps purchase listing and safe display references without authentication secrets", async () => {
    await expect(caller(role).purchaseOrders.list()).resolves.toEqual([{ id: 1 }]);
    const rows = await caller(role).users.list();
    expect(rows[0]).toMatchObject({ id: 1, name: "Fixture", role: "admin" });
    expect(rows[0]).not.toHaveProperty("passwordHash");
    expect(await caller(role).auth.me()).not.toHaveProperty("passwordHash");
  });
  it("cannot impersonate admin through an identity projection", async () => {
    await expect(caller(role, 1, true).audit.list()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller(role, 1, true).auth.me()).resolves.toMatchObject({ role });
  });
  it("blocks a disabled existing identity and retains logout", async () => {
    await expect(caller(role, 0).purchaseOrders.list()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller(role, 0).auth.me()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller(role, 0).auth.logout()).resolves.toBe(true);
  });
  it("checks batch parent access before repairs/reads, retaining own-order visibility", async () => {
    await expect(caller(role).purchaseOrders.listPricingBatches({ purchaseOrderId: 1 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(spies.repair).not.toHaveBeenCalled(); expect(spies.batches).not.toHaveBeenCalled();
    spies.po.mockResolvedValue({ id: 1, status: "draft", requestedById: 3 });
    await expect(caller(role).purchaseOrders.listPricingBatches({ purchaseOrderId: 1 })).resolves.toEqual([{ id: 10, pdfAllowed: !["accountant", "senior_management"].includes(role), pdfBlockedReason: ["accountant", "senior_management"].includes(role) ? "Awaiting fixture approval" : null }]);
    expect(spies.repair).toHaveBeenCalledOnce();
  });
  it("preserves current pages and prevents direct URLs to administration", () => {
    for (const page of [businessHomePath(role), "/purchase-orders", "/purchase-orders/new", "/purchase-orders/edit-draft/11", "/purchase-orders/11", "/purchase-packages/11", "/documents", "/improvement-ideas", "/inventory/reconciliation", "/inventory/reports/stock-balance", "/inventory/reports/valuation", "/inventory/reports/movements", "/inventory/reports/analytics"]) expect(canRoleAccessPath(role, page), page).toBe(true);
    for (const page of ["/audit-log", "/backup", "/translation-monitor", "/unknown-new-page", "/users/../audit-log", "/%61udit-log"]) expect(canRoleAccessPath(role, page), page).toBe(false);
  });
  it.each(["query", "mutation", "subscription"])("rejects lookalike/unreviewed %s names", type => {
    for (const path of ["audit.list", "Audit.list", "purchaseOrders.list.extra", "purchaseOrders/list", "purchaseOrders.list%00", "future.read"]) expect(() => assertBusinessRpc(identity(role), type, path)).toThrow();
  });
  it("does not permit a blocked query within an otherwise permitted HTTP batch", async () => {
    const request = new Request("http://fixture/trpc/purchaseOrders.list,audit.list?batch=1");
    const response = await fetchRequestHandler({ endpoint: "/trpc", req: request, router: api, createContext: () => context(role) });
    const body = await response.json();
    expect(body[0]).toHaveProperty("result"); expect(body[1].error.json.data.code).toBe("FORBIDDEN");
    expect(spies.audit).not.toHaveBeenCalled();
  });
});

describe("Preserved action boundaries", () => {
  it("grants senior management warehouse oversight without warehouse execution", () => {
    const oversightPages = [
      "/inventory", "/inventory-operations", "/inventory-settlement-review",
      "/inventory/reconciliation", "/inventory/reports", "/warehouse/returns",
      "/warehouse/transfer", "/warehouse/issue", "/warehouses", "/item-tracker",
    ];
    for (const path of oversightPages) expect(canRoleAccessPath("senior_management", path), path).toBe(true);
    for (const path of ["/inventory/receive", "/warehouse/receive-v2", "/warehouse/return", "/purchase-cycle"])
      expect(canRoleAccessPath("senior_management", path), path).toBe(false);

    for (const path of [
      "inventory.list", "inventory.listLots", "inventory.getLedger",
      "inventoryCount.listOperations", "inventoryCount.operationDetails",
      "inventoryCount.listSettlements", "transfers.listCards", "transfers.getBatchDetail",
      "warehouseIssueBatches.list", "warehouseIssueBatches.getById",
      "purchaseOrders.searchItemNames", "purchaseOrders.trackItem",
    ]) expect(() => assertBusinessRpc(identity("senior_management"), "query", path), path).not.toThrow();

    for (const path of [
      "inventory.create", "inventory.update", "inventory.addTransaction",
      "inventoryCount.createOperation", "inventoryCount.recordItem", "inventoryCount.completeOperation",
      "transfers.createBatch", "warehouseIssueBatches.create", "warehouseReturns.create",
      "warehouseReceiptsV2.receiveFromPurchaseV2", "warehouse.create",
    ]) expect(() => assertBusinessRpc(identity("senior_management"), "mutation", path), path).toThrow();
  });

  it("does not broaden warehouse oversight pages to other reviewed roles", () => {
    for (const role of ["accountant", "executive_director", "food_warehouse_assistant"])
      for (const path of ["/inventory", "/inventory-operations", "/warehouse/transfer", "/warehouse/issue", "/warehouses", "/item-tracker"])
        expect(canRoleAccessPath(role, path), `${role}:${path}`).toBe(false);
  });

  it.each(BUSINESS_GUARDED_ROLES.filter(r => r !== "warehouse"))("%s cannot write stock through a generic read procedure", async role => {
    await expect(caller(role).inventory.addTransaction({ inventoryId: 1, type: "in", quantity: 3 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(spies.write).not.toHaveBeenCalled();
  });
  it("warehouse retains its stock action and can create only technicians", async () => {
    await caller("warehouse").inventory.addTransaction({ inventoryId: 1, type: "in", quantity: 3 });
    expect(spies.write).toHaveBeenCalledWith(expect.objectContaining({ inventoryId: 1, quantity: 3, performedById: 3 }));
    spies.write.mockClear();
    for (const role of Object.values(APP_ROLE).filter(r => r !== "technician")) await expect(caller("warehouse").users.create({ username: "fixture", name: "Fixture", password: "Fixture1234", role })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(spies.write).not.toHaveBeenCalled();
    await expect(caller("warehouse").users.create({ username: "fixture", name: "Fixture", password: "Fixture1234", role: "technician" })).resolves.toMatchObject({ success: true });
  });
  it("retains each approval role without granting executive-director approvals", () => {
    expect(() => assertBusinessRpc(identity("accountant"), "mutation", "purchaseOrders.approveAccounting")).not.toThrow();
    expect(() => assertBusinessRpc(identity("senior_management"), "mutation", "purchaseOrders.approveManagement")).not.toThrow();
    for (const path of ["purchaseOrders.approveManagement", "purchaseOrders.approveManagementBatch", "purchasePackages.approveManagementSubmission", "purchaseOrders.reject"]) expect(() => assertBusinessRpc(identity("executive_director"), "mutation", path)).toThrow();
  });
  it.each(Object.values(APP_ROLE).filter(role => !BUSINESS_GUARDED_ROLES.includes(role as any)))("leaves the new policy neutral for %s", role => {
    expect(() => assertBusinessRpc(identity(role), "mutation", "future.action")).not.toThrow();
    expect(businessHttpAllowed(identity(role), "GET", "/api/export/audit-log")).toBe(true);
  });
  it("preserves every currently visible sidebar destination for these roles", () => {
    const source = ast("client/src/components/layout/DashboardLayout.tsx"); let sections: ts.ArrayLiteralExpression | undefined;
    function find(n: ts.Node) { if (ts.isVariableDeclaration(n) && n.name.getText(source) === "NAV_SECTIONS") sections = n.initializer as ts.ArrayLiteralExpression; ts.forEachChild(n, find); } find(source);
    const property = (object: ts.ObjectLiteralExpression, name: string) => (object.properties.find(p => ts.isPropertyAssignment(p) && p.name.getText(source) === name) as ts.PropertyAssignment)?.initializer;
    const roleList = (n?: ts.Expression) => n && ts.isArrayLiteralExpression(n) ? n.elements.map(e => (e as ts.StringLiteral).text) : undefined;
    for (const section of sections!.elements as unknown as ts.ObjectLiteralExpression[]) for (const role of BUSINESS_GUARDED_ROLES) {
      const sectionRoles = roleList(property(section, "roles")); if (sectionRoles && !sectionRoles.includes(role)) continue;
      const items = property(section, "items") as ts.ArrayLiteralExpression;
      for (const item of items.elements as unknown as ts.ObjectLiteralExpression[]) {
        const itemRoles = roleList(property(item, "roles")); if (itemRoles && !itemRoles.includes(role)) continue;
        const path = (property(item, "path") as ts.StringLiteral).text;
        expect(canRoleAccessPath(role, path), `${role}:${path}`).toBe(true);
      }
    }
  });
});

describe("Parent-scoped translation helpers", () => {
  it.each(BUSINESS_GUARDED_ROLES)("authorizes every PO child before returning translated fields for %s", async role => {
    const port = { parents: vi.fn(async () => [{ id: 10, parentId: 1 }, { id: 11, parentId: 2 }]), authorize: vi.fn(async (_u: unknown, _k: unknown, id: number) => { if (id === 2) throw new TRPCError({ code: "FORBIDDEN" }); }) };
    await expect(assertBusinessTranslationAccess(identity(role), { entityType: "PO_ITEM", entityIds: [10, 11] }, "batch", port)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(port.authorize).toHaveBeenCalledWith(identity(role), "po", 1);
    expect(port.authorize).toHaveBeenCalledWith(identity(role), "po", 2);
  });
  it("uses the selected parser, rejecting aliases, missing parents and malicious IDs", async () => {
    const port = { parents: vi.fn(async () => []), authorize: vi.fn() };
    for (const entityType of ["__proto__", "PO_ITEM.extra", "unknown"]) await expect(assertBusinessTranslationAccess(identity("accountant"), { entityType, entityId: 1 }, "single", port)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(assertBusinessTranslationAccess(identity("accountant"), { entityType: "PO_ITEM", entityId: 12, entityIds: [11] }, "single", port)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(port.parents).toHaveBeenCalledWith("PO_ITEM", [12]); expect(port.authorize).not.toHaveBeenCalled();
    for (const entityIds of [[0], [-1], ["11"], [1.5], Array(201).fill(1)]) await expect(assertBusinessTranslationAccess(identity("warehouse"), { entityType: "PO", entityIds }, "batch", port)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("Authenticated HTTP and current-session boundary", () => {
  it.each(BUSINESS_GUARDED_ROLES)("the actual SDK rechecks persisted active status for %s", async role => {
    const source = ast("server/_core/sdk.ts"); let method = "";
    function find(node: ts.Node) { if (ts.isMethodDeclaration(node) && node.name.getText(source) === "authenticateRequest") method = node.getText(source); ts.forEachChild(node, find); } find(source);
    class SessionAuthenticationError extends Error {}
    let stored = identity(role, 1);
    const lookup = vi.fn(async () => stored);
    const authenticate = evaluate(`async function ${method.replace(/^async\s+/, "")}`, { db: { getUserByOpenId: lookup }, COOKIE_NAME: "fixture-cookie", SessionAuthenticationError, isBusinessGuardedRole, Date, console });
    const sdk = { parseCookies: () => new Map([["fixture-cookie", "signed-cookie"]]), verifySession: async () => ({ openId: "persisted-user" }) };
    await expect(authenticate.call(sdk, { headers: {} })).resolves.toMatchObject({ role, isActive: 1 });
    stored = identity(role, 0);
    await expect(authenticate.call(sdk, { headers: {} })).rejects.toBeInstanceOf(SessionAuthenticationError);
    expect(lookup).toHaveBeenCalledTimes(2);
  });
  for (const name of ["requireAuthMiddleware", "makeRequireExportRole"]) {
    it.each(BUSINESS_GUARDED_ROLES)(`${name} closes audit export for %s and keeps allowed document/upload paths`, async role => {
      const source = ast("server/_core/index.ts");
      const declaration = source.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name)!;
      const scope = { sdk: { authenticateRequest: async () => identity(role) }, observerHttpAllowed, technicianHttpAllowed, businessHttpAllowed, isSessionAuthenticationError: () => false, console };
      const middleware = name === "makeRequireExportRole" ? evaluate(declaration.getText(source), scope)(new Set([role])) : evaluate(declaration.getText(source), scope);
      const next = vi.fn(), json = vi.fn(), status = vi.fn(() => ({ json }));
      await middleware({ method: "GET", path: "/api/export/audit-log" }, { status }, next);
      expect(status).toHaveBeenCalledWith(403); expect(next).not.toHaveBeenCalled();
      await middleware({ method: "POST", path: "/api/upload" }, { status }, next);
      expect(next).toHaveBeenCalledOnce();
    });
  }
});

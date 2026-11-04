import { readFileSync } from "node:fs";
import ts from "typescript";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  adminOwnerProcedure,
  catalogAdminProcedure,
  catalogImportExportProcedure,
  catalogItemDeactivateProcedure,
  catalogItemLifecycleProcedure,
  catalogItemManagerProcedure,
  catalogItemReadProcedure,
  catalogItemUpdateProcedure,
  catalogProcedure,
  catalogReadProcedure,
  catalogReferenceReadProcedure,
  catalogViewProcedure,
  router,
} from "../routers/_shared/procedures";
import {
  canCreateCatalogItem,
  canDeactivateCatalogItem,
  canImportExportCatalog,
  canManageCatalogItemLifecycle,
  canRoleAccessCatalogModule,
  canRoleAccessPath,
  canUpdateCatalogItem,
  isCatalogAdminRole,
} from "../../shared/roles";
import { businessRpcAllowed } from "../../shared/business-role-policy";

// The real central capability gate and role middleware run for exact production
// RPC paths. Resolvers are inert fixtures; no database or .env is loaded.
const read = vi.fn((kind: string) => [{ id: 7, kind }]);
const write = vi.fn((kind: string, user: { id: number; role: string }) => ({ kind, actorId: user.id, actorRole: user.role }));
const writeWith = (kind: string) => ({ ctx }: any) => write(kind, ctx.user);
const api = router({
  catalog: router({
    nodes: router({
      list: catalogReferenceReadProcedure.query(() => read("nodes")),
      getById: catalogViewProcedure.query(() => read("node")),
      getChildren: catalogViewProcedure.query(() => read("children")),
      create: catalogProcedure.mutation(writeWith("node-create")),
      update: catalogProcedure.mutation(writeWith("node-update")),
      delete: catalogAdminProcedure.mutation(writeWith("node-delete")),
    }),
    items: router({
      list: catalogReferenceReadProcedure.query(() => read("items")),
      getById: catalogItemReadProcedure.query(() => read("item")),
      count: catalogItemReadProcedure.query(() => read("count")),
      previewNextCode: catalogItemManagerProcedure.query(() => read("code")),
      create: catalogItemManagerProcedure.mutation(writeWith("item-create")),
      update: catalogItemUpdateProcedure.mutation(writeWith("item-update")),
      delete: catalogItemDeactivateProcedure.mutation(writeWith("item-deactivate")),
      reactivate: catalogItemLifecycleProcedure.mutation(writeWith("item-reactivate")),
    }),
    units: router({
      list: catalogReferenceReadProcedure.query(() => read("units")),
      create: catalogProcedure.mutation(writeWith("unit-create")),
      update: catalogProcedure.mutation(writeWith("unit-update")),
      delete: catalogAdminProcedure.mutation(writeWith("unit-delete")),
    }),
    suppliers: router({
      list: catalogViewProcedure.query(() => read("suppliers")),
      getById: catalogViewProcedure.query(() => read("supplier")),
      create: catalogProcedure.mutation(writeWith("supplier-create")),
      update: catalogProcedure.mutation(writeWith("supplier-update")),
      delete: catalogProcedure.mutation(writeWith("supplier-delete")),
    }),
    itemSuppliers: router({ listByItem: catalogViewProcedure.query(() => read("item-suppliers")) }),
    itemCandidates: router({ approveNew: catalogProcedure.mutation(writeWith("candidate-approve")) }),
    settings: router({
      list: adminOwnerProcedure.query(() => read("settings")),
      get: adminOwnerProcedure.query(() => read("setting")),
    }),
    importExport: router({
      exportExcel: catalogImportExportProcedure.mutation(writeWith("export-all")),
      exportItemsExcel: catalogImportExportProcedure.mutation(writeWith("export-items")),
      exportTaxonomyTreeExcel: catalogImportExportProcedure.mutation(writeWith("export-tree")),
      importPreview: catalogImportExportProcedure.mutation(writeWith("import-preview")),
      importCommit: catalogImportExportProcedure.mutation(writeWith("import-commit")),
    }),
  }),
});

function context(role: string | null, isActive: number | undefined = 1, id = 101): any {
  const user = role ? { id, role, isActive } : null;
  return { user, authenticatedUser: user, req: {}, res: {} };
}
const caller = (role: string | null, isActive: number | undefined = 1) => api.createCaller(context(role, isActive)).catalog;
const transferNames = ["exportExcel", "exportItemsExcel", "exportTaxonomyTreeExcel", "importPreview", "importCommit"] as const;
const fullCatalogActions = (catalog: ReturnType<typeof caller>) => [
  () => catalog.items.create(), () => catalog.items.previewNextCode(), () => catalog.items.reactivate(),
  () => catalog.nodes.create(), () => catalog.nodes.update(), () => catalog.nodes.delete(),
  () => catalog.units.create(), () => catalog.units.update(), () => catalog.units.delete(),
  () => catalog.suppliers.create(), () => catalog.suppliers.update(), () => catalog.suppliers.delete(),
  () => catalog.itemCandidates.approveNew(),
];
beforeEach(() => vi.clearAllMocks());

describe("Senior management Catalog permissions at the direct API boundary", () => {
  it("opens the module and permits viewing, editing, deactivation and Excel transfer with the actual actor", async () => {
    const catalog = caller("senior_management");
    expect(canRoleAccessCatalogModule("senior_management")).toBe(true);
    expect(canRoleAccessPath("senior_management", "/catalog")).toBe(true);
    expect(canRoleAccessPath("senior_management", "/catalog?tab=items")).toBe(true);
    for (const action of [
      () => catalog.nodes.list(), () => catalog.nodes.getById(), () => catalog.nodes.getChildren(),
      () => catalog.items.list(), () => catalog.items.count(), () => catalog.items.getById(),
      () => catalog.units.list(), () => catalog.suppliers.list(), () => catalog.suppliers.getById(),
      () => catalog.itemSuppliers.listByItem(),
    ]) await expect(action()).resolves.toHaveLength(1);
    for (const action of [() => catalog.items.update(), () => catalog.items.delete(), ...transferNames.map(name => () => catalog.importExport[name]())]) {
      await expect(action()).resolves.toMatchObject({ actorId: 101, actorRole: "senior_management" });
    }
    expect(write).toHaveBeenCalledTimes(7);
  });

  it("grants the explicitly requested full Catalog administration without changing the actor's system role", async () => {
    expect(canCreateCatalogItem("senior_management")).toBe(true);
    expect(canUpdateCatalogItem("senior_management")).toBe(true);
    expect(canDeactivateCatalogItem("senior_management")).toBe(true);
    expect(canImportExportCatalog("senior_management")).toBe(true);
    expect(canManageCatalogItemLifecycle("senior_management")).toBe(true);
    expect(isCatalogAdminRole("senior_management")).toBe(true);
    for (const action of fullCatalogActions(caller("senior_management"))) await expect(action()).resolves.toBeDefined();
    expect(read).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledTimes(12);
  });

  it("denies both settings reads on direct calls without affecting the other Catalog grants", async () => {
    const catalog = caller("senior_management");
    for (const path of ["catalog.settings.list", "catalog.settings.get"]) {
      expect(businessRpcAllowed(context("senior_management").user, "query", path)).toBe(false);
    }
    await expect(catalog.settings.list()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(catalog.settings.get()).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(read).not.toHaveBeenCalled();
    await expect(catalog.nodes.create()).resolves.toMatchObject({ actorRole: "senior_management" });
  });

  it("does not retain an owner/admin settings grant after the actor changes to senior management", async () => {
    const ctx = context("admin");
    const catalog = api.createCaller(ctx).catalog;
    await catalog.settings.list();
    ctx.user.role = "senior_management";
    await expect(catalog.settings.list()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(catalog.settings.get()).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("does not reuse a prior permission when activity or role changes on consecutive requests", async () => {
    const ctx = context("senior_management");
    const catalog = api.createCaller(ctx).catalog;
    await catalog.items.update();
    await catalog.importExport.exportItemsExcel();
    ctx.user.isActive = 0;
    await expect(catalog.items.update()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(catalog.importExport.exportItemsExcel()).rejects.toMatchObject({ code: "FORBIDDEN" });
    ctx.user.isActive = 1;
    ctx.user.role = "accountant";
    await expect(catalog.items.update()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(catalog.importExport.importCommit()).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(write).toHaveBeenCalledTimes(2);
    await caller("senior_management").items.update();
    expect(write).toHaveBeenCalledTimes(3);
  });

  it("requires explicit exact-path/type grants and rejects unreviewed lookalikes", () => {
    const senior = context("senior_management").user;
    for (const name of transferNames) expect(businessRpcAllowed(senior, "mutation", `catalog.importExport.${name}`)).toBe(true);
    for (const path of ["catalog.items.create", "catalog.items.reactivate", "catalog.nodes.update"]) {
      expect(businessRpcAllowed(senior, "mutation", path), path).toBe(true);
    }
    for (const path of ["catalog.settings.update", "catalog.importExport.importCommit.extra", "catalog.importExport/future", "catalog.importExport.future", "catalog.future.create", "audit.list", "users.create", "warehouse.create"]) {
      expect(businessRpcAllowed(senior, "mutation", path), path).toBe(false);
    }
    expect(businessRpcAllowed(senior, "query", "catalog.importExport.importCommit")).toBe(false);
    expect(businessRpcAllowed(senior, "mutation", "catalog.items.count")).toBe(false);
  });
});

describe("Construction deactivation is additive and limited", () => {
  it("retains the existing creation/editing grant and adds item deactivation without import or reactivation", async () => {
    const catalog = caller("construction_procurement_manager");
    for (const action of [() => catalog.items.create(), () => catalog.items.update(), () => catalog.items.delete()]) await expect(action()).resolves.toMatchObject({ actorRole: "construction_procurement_manager" });
    for (const action of [() => catalog.items.reactivate(), () => catalog.settings.list(), ...transferNames.map(name => () => catalog.importExport[name]())]) await expect(action()).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(canDeactivateCatalogItem("construction_procurement_manager")).toBe(true);
    expect(canImportExportCatalog("construction_procurement_manager")).toBe(false);
    expect(canManageCatalogItemLifecycle("construction_procurement_manager")).toBe(false);
    expect(write).toHaveBeenCalledTimes(3);
  });

  it("rechecks current construction activity for the new deactivation grant", async () => {
    const ctx = context("construction_procurement_manager");
    const catalog = api.createCaller(ctx).catalog;
    await catalog.items.delete();
    ctx.user.isActive = 0;
    await expect(catalog.items.delete()).rejects.toMatchObject({ code: "FORBIDDEN" });
    ctx.user.isActive = undefined;
    await expect(catalog.items.delete()).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(write).toHaveBeenCalledOnce();
  });
});

describe("Unchanged roles and authentication", () => {
  it.each(["senior_management", "construction_procurement_manager", "maintenance_manager", "general_maintenance_manager", "warehouse", "it_manager", "accountant", "executive_director", "delegate", "technician"])("keeps settings reads owner/admin-only for %s", async role => {
    const catalog = caller(role);
    await expect(catalog.settings.list()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(catalog.settings.get()).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(read).not.toHaveBeenCalled();
  });
  it.each(["owner", "admin"])("retains %s item lifecycle and all transfer actions", async role => {
    const catalog = caller(role);
    for (const action of [() => catalog.items.create(), () => catalog.items.update(), () => catalog.items.delete(), () => catalog.items.reactivate(), ...transferNames.map(name => () => catalog.importExport[name]())]) await expect(action()).resolves.toMatchObject({ actorRole: role });
    expect(isCatalogAdminRole(role)).toBe(true);
  });
  it.each(["maintenance_manager", "warehouse"])("retains %s lifecycle without granting Excel transfer", async role => {
    const catalog = caller(role);
    for (const action of [() => catalog.items.create(), () => catalog.items.update(), () => catalog.items.delete(), () => catalog.items.reactivate()]) await expect(action()).resolves.toMatchObject({ actorRole: role });
    for (const name of transferNames) await expect(catalog.importExport[name]()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("preserves IT manager item-only management", async () => {
    const catalog = caller("it_manager");
    await catalog.items.create(); await catalog.items.update(); await catalog.items.delete();
    await expect(catalog.items.reactivate()).rejects.toMatchObject({ code: "FORBIDDEN" });
    for (const name of transferNames) await expect(catalog.importExport[name]()).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(write).toHaveBeenCalledTimes(3);
  });
  it.each(["accountant", "executive_director", "delegate", "technician", "operator", "it_member", "general_maintenance_manager"])("does not add transfer or deactivation rights to %s", async role => {
    const catalog = caller(role);
    await expect(catalog.items.delete()).rejects.toMatchObject({ code: "FORBIDDEN" });
    for (const name of transferNames) await expect(catalog.importExport[name]()).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(write).not.toHaveBeenCalled();
  });
  it("does not permit an unauthenticated caller to access the new procedures", async () => {
    const catalog = caller(null);
    for (const action of [() => catalog.items.count(), () => catalog.items.update(), () => catalog.items.delete(), () => catalog.importExport.exportItemsExcel(), () => catalog.importExport.importCommit()]) await expect(action()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(read).not.toHaveBeenCalled(); expect(write).not.toHaveBeenCalled();
  });
  it("blocks every newly granted senior operation when disabled", async () => {
    const catalog = caller("senior_management", 0);
    for (const action of [() => catalog.items.list(), () => catalog.items.count(), () => catalog.items.getById(), () => catalog.items.update(), () => catalog.items.delete(), ...transferNames.map(name => () => catalog.importExport[name]())]) await expect(action()).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(read).not.toHaveBeenCalled(); expect(write).not.toHaveBeenCalled();
  });
});

describe("Production import/export routes use the separate capability", () => {
  const file = "server/routers/catalog/catalogImportExport.router.ts";
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  function procedure(name: string) {
    let found: string | undefined;
    const visit = (node: ts.Node) => {
      if (ts.isPropertyAssignment(node) && node.name.getText(source) === name) found = node.initializer.getText(source);
      ts.forEachChild(node, visit);
    };
    visit(source);
    if (!found) throw new Error(`Missing production Catalog transfer route ${name}`);
    return found;
  }
  it.each(transferNames)("binds %s to its reviewed transfer procedure", name => {
    expect(procedure(name)).toMatch(/^catalogImportExportProcedure\s*\./);
  });
});

type CatalogRoute = { path: string; kind: "query" | "mutation"; procedure: string };

/** Enumerate production RPC bindings without importing a router's database/services. */
function productionCatalogRoutes(): CatalogRoute[] {
  const result: CatalogRoute[] = [];
  function walkFile(file: string, variable: string, prefix: string) {
    const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
    let object: ts.ObjectLiteralExpression | undefined;
    for (const statement of source.statements) {
      if (!ts.isVariableStatement(statement)) continue;
      for (const declaration of statement.declarationList.declarations) {
        if (declaration.name.getText(source) !== variable || !declaration.initializer || !ts.isCallExpression(declaration.initializer)) continue;
        const first = declaration.initializer.arguments[0];
        if (first && ts.isObjectLiteralExpression(first)) object = first;
      }
    }
    if (!object) throw Error(`Missing production router ${variable}`);
    function walkObject(value: ts.ObjectLiteralExpression, parent: string) {
      for (const property of value.properties) {
        if (!ts.isPropertyAssignment(property)) throw Error(`Unreviewed Catalog router property in ${parent}`);
        const name = ts.isStringLiteral(property.name) ? property.name.text : property.name.getText(source);
        const path = `${parent}.${name}`;
        let expression = property.initializer;
        if (ts.isIdentifier(expression) && expression.text === "catalogImportExportRouter") {
          walkFile("server/routers/catalog/catalogImportExport.router.ts", "catalogImportExportRouter", path);
          continue;
        }
        if (ts.isCallExpression(expression) && expression.expression.getText(source) === "router") {
          const first = expression.arguments[0];
          if (!first || !ts.isObjectLiteralExpression(first)) throw Error(`Unreviewed nested router ${path}`);
          walkObject(first, path);
          continue;
        }
        let kind: CatalogRoute["kind"] | undefined;
        while (ts.isCallExpression(expression) && ts.isPropertyAccessExpression(expression.expression)) {
          const member = expression.expression.name.text;
          if (member === "query" || member === "mutation") kind = member;
          expression = expression.expression.expression;
        }
        if (!kind || !ts.isIdentifier(expression)) throw Error(`Unreviewed procedure binding ${path}`);
        result.push({ path, kind, procedure: expression.text });
      }
    }
    walkObject(object, prefix);
  }
  walkFile("server/routers/catalog/catalog.router.ts", "catalogRouter", "catalog");
  return result;
}

const productionRoutes = productionCatalogRoutes();
const catalogProcedures: Record<string, any> = {
  adminOwnerProcedure,
  catalogAdminProcedure, catalogImportExportProcedure, catalogItemDeactivateProcedure,
  catalogItemLifecycleProcedure, catalogItemManagerProcedure, catalogItemReadProcedure,
  catalogItemUpdateProcedure, catalogProcedure, catalogReadProcedure,
  catalogReferenceReadProcedure, catalogViewProcedure,
};
const allCatalogApi = (() => {
  const tree: Record<string, any> = {};
  for (const route of productionRoutes) {
    const keys = route.path.split(".");
    let parent = tree;
    for (const key of keys.slice(0, -1)) parent = parent[key] ??= {};
    const binding = catalogProcedures[route.procedure];
    if (!binding) throw Error(`Unreviewed Catalog guard ${route.procedure}`);
    parent[keys.at(-1)!] = route.kind === "query"
      ? binding.query(({ ctx }: any) => read(`${route.path}:${ctx.user.role}`))
      : binding.mutation(writeWith(route.path));
  }
  const nested = (value: Record<string, any>): any => router(Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, typeof child === "function" ? child : nested(child)])
  ));
  return nested(tree);
})();
const invokeProductionGuard = (ctx: any, path: string) => path.split(".").reduce((value: any, key) => value[key], allCatalogApi.createCaller(ctx))();

describe("Complete Catalog-only capability parity with the actual production RPC surface", () => {
  it.each(productionRoutes)("checks the reviewed senior grant on $kind $path through its actual guard", async route => {
    const senior = context("senior_management");
    const allowed = !["catalog.settings.list", "catalog.settings.get"].includes(route.path);
    expect(businessRpcAllowed(senior.user, route.kind, route.path)).toBe(allowed);
    expect(businessRpcAllowed(senior.user, route.kind === "query" ? "mutation" : "query", route.path)).toBe(false);
    if (allowed) await expect(invokeProductionGuard(senior, route.path)).resolves.toBeDefined();
    else await expect(invokeProductionGuard(senior, route.path)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("retains owner/admin parity and checks all newly granted operations again when the actor becomes inactive", async () => {
    for (const role of ["owner", "admin"]) {
      for (const route of productionRoutes) await expect(invokeProductionGuard(context(role), route.path)).resolves.toBeDefined();
    }
    const senior = context("senior_management");
    await invokeProductionGuard(senior, "catalog.items.create");
    const beforeReads = read.mock.calls.length, beforeWrites = write.mock.calls.length;
    senior.user.isActive = 0;
    for (const route of productionRoutes) await expect(invokeProductionGuard(senior, route.path)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(read).toHaveBeenCalledTimes(beforeReads); expect(write).toHaveBeenCalledTimes(beforeWrites);
    senior.user.isActive = 1;
    await expect(invokeProductionGuard(senior, "catalog.items.create")).resolves.toMatchObject({ actorRole: "senior_management" });
  });
  it("keeps the complete grant in Catalog and fails closed for unknown future APIs", () => {
    const senior = context("senior_management").user;
    for (const type of ["query", "mutation"]) {
      for (const path of ["catalog.future", "catalog.future.create", "catalog.settings.update", "catalog.items.future", "catalog.nodes.moveSubtree.extra", "catalog/items/create", "audit.list", "users.create", "warehouse.create"]) {
        expect(businessRpcAllowed(senior, type, path), `${type}:${path}`).toBe(false);
      }
    }
    expect(productionRoutes.some(route => route.path === "catalog.nodes.moveSubtree")).toBe(true);
    expect(productionRoutes.some(route => route.path === "catalog.audit.list")).toBe(true);
    expect(productionRoutes.some(route => route.path === "catalog.settings.get")).toBe(true);
  });
});

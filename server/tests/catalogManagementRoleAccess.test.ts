import { readFileSync } from "node:fs";
import ts from "typescript";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  catalogAdminProcedure,
  catalogImportExportProcedure,
  catalogItemDeactivateProcedure,
  catalogItemLifecycleProcedure,
  catalogItemManagerProcedure,
  catalogItemReadProcedure,
  catalogItemUpdateProcedure,
  catalogProcedure,
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
    settings: router({ update: catalogAdminProcedure.mutation(writeWith("settings-update")) }),
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
const forbiddenSenior = (catalog: ReturnType<typeof caller>) => [
  () => catalog.items.create(), () => catalog.items.previewNextCode(), () => catalog.items.reactivate(),
  () => catalog.nodes.create(), () => catalog.nodes.update(), () => catalog.nodes.delete(),
  () => catalog.units.create(), () => catalog.units.update(), () => catalog.units.delete(),
  () => catalog.suppliers.create(), () => catalog.suppliers.update(), () => catalog.suppliers.delete(),
  () => catalog.itemCandidates.approveNew(), () => catalog.settings.update(),
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

  it("keeps manual creation, reactivation and wider master-data administration closed", async () => {
    expect(canCreateCatalogItem("senior_management")).toBe(false);
    expect(canUpdateCatalogItem("senior_management")).toBe(true);
    expect(canDeactivateCatalogItem("senior_management")).toBe(true);
    expect(canImportExportCatalog("senior_management")).toBe(true);
    expect(canManageCatalogItemLifecycle("senior_management")).toBe(false);
    expect(isCatalogAdminRole("senior_management")).toBe(false);
    for (const action of forbiddenSenior(caller("senior_management"))) await expect(action()).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(read).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
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
    for (const path of ["catalog.items.create", "catalog.items.reactivate", "catalog.nodes.update", "catalog.settings.update", "catalog.importExport.importCommit.extra", "catalog.importExport/future", "catalog.importExport.future"]) {
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
    for (const action of [() => catalog.items.reactivate(), () => catalog.settings.update(), ...transferNames.map(name => () => catalog.importExport[name]())]) await expect(action()).rejects.toMatchObject({ code: "FORBIDDEN" });
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

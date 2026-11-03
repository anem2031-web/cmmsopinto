import { readFileSync } from "node:fs";
import ts from "typescript";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  catalogItemLifecycleProcedure,
  catalogItemManagerProcedure,
  catalogItemDeactivateProcedure,
  catalogAdminProcedure,
  catalogProcedure,
  catalogReadProcedure,
  catalogReferenceReadProcedure,
  router,
} from "../routers/_shared/procedures";
import { canRoleAccessCatalogModule } from "../../shared/roles";

// These fixtures use the real procedures and exact RPC paths, so the central
// capability gates and module-role middleware both run. No database is imported.
const reads = vi.fn((kind: string) => [{ id: 7, nameAr: `fixture-${kind}` }]);
const writes = vi.fn(() => ({ id: 8 }));
const api = router({
  catalog: router({
    nodes: router({
      list: catalogReferenceReadProcedure.query(() => reads("nodes")),
      create: catalogProcedure.mutation(() => writes()),
    }),
    items: router({
      list: catalogReferenceReadProcedure.query(() => reads("items")),
      create: catalogItemManagerProcedure.mutation(() => writes()),
      update: catalogItemManagerProcedure.mutation(() => writes()),
      delete: catalogItemDeactivateProcedure.mutation(() => writes()),
      reactivate: catalogItemLifecycleProcedure.mutation(() => writes()),
      count: catalogItemManagerProcedure.query(() => reads("count")),
      getById: catalogItemManagerProcedure.query(() => reads("details")),
      previewNextCode: catalogItemManagerProcedure.query(() => reads("code")),
    }),
    units: router({
      list: catalogReferenceReadProcedure.query(() => reads("units")),
      create: catalogProcedure.mutation(() => writes()),
    }),
    suppliers: router({
      match: catalogReadProcedure.query(() => reads("suppliers")),
      create: catalogProcedure.mutation(() => writes()),
      delete: catalogProcedure.mutation(() => writes()),
    }),
    settings: router({ update: catalogAdminProcedure.mutation(() => writes()) }),
    itemSuppliers: router({
      matchInvoiceItems: catalogReadProcedure.mutation(() => writes()),
    }),
  }),
});

const newReferenceRoles = ["delegate", "accountant", "senior_management", "executive_director"];
const existingReferenceRoles = [
  "owner", "admin", "maintenance_manager", "general_maintenance_manager",
  "construction_procurement_manager", "purchase_manager", "purchase_requester",
  "it_manager", "warehouse", "food_warehouse_manager", "food_warehouse_assistant",
];
function caller(role: string | null, isActive = 1) {
  return api.createCaller({ user: role ? { id: 101, role, isActive } : null } as any).catalog;
}
async function expectReferenceReads(role: string) {
  const catalog = caller(role);
  await expect(catalog.nodes.list()).resolves.toEqual([{ id: 7, nameAr: "fixture-nodes" }]);
  await expect(catalog.items.list()).resolves.toEqual([{ id: 7, nameAr: "fixture-items" }]);
  await expect(catalog.units.list()).resolves.toEqual([{ id: 7, nameAr: "fixture-units" }]);
  expect(reads).toHaveBeenCalledTimes(3);
}

beforeEach(() => vi.clearAllMocks());

describe("Purchase picker references through the actual central and role guards", () => {
  it.each(newReferenceRoles)("allows %s to read the three purchase picker references", expectReferenceReads);
  it.each(existingReferenceRoles)("retains the previous reference reader %s", expectReferenceReads);

  it.each(["technician", "operator", "user", "gate_security", "it_member", "supervisor"])(
    "keeps %s excluded before any reference resolver runs", async role => {
      const catalog = caller(role);
      for (const read of [() => catalog.nodes.list(), () => catalog.items.list(), () => catalog.units.list()]) {
        await expect(read()).rejects.toMatchObject({ code: "FORBIDDEN" });
      }
      expect(reads).not.toHaveBeenCalled();
    },
  );

  it("requires authentication before reading references", async () => {
    const catalog = caller(null);
    for (const read of [() => catalog.nodes.list(), () => catalog.items.list(), () => catalog.units.list()]) {
      await expect(read()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    }
    expect(reads).not.toHaveBeenCalled();
  });

  it.each(["accountant", "senior_management", "executive_director"])(
    "keeps a disabled %s blocked by the central business guard", async role => {
      await expect(caller(role, 0).items.list()).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(reads).not.toHaveBeenCalled();
    },
  );

  it("retains observer reference reads without granting a catalog mutation", async () => {
    await expectReferenceReads("observer");
    await expect(caller("observer").items.create()).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(writes).not.toHaveBeenCalled();
  });
});

describe("Picker access does not widen catalog management or invoice matching", () => {
  it("admits IT manager only to item management and keeps the member and wider catalog actions denied", async () => {
    const manager = caller("it_manager");
    expect(canRoleAccessCatalogModule("it_manager")).toBe(true);
    await manager.items.create(); await manager.items.update(); await manager.items.delete();
    await manager.items.count(); await manager.items.getById(); await manager.items.previewNextCode();
    for (const action of [() => manager.nodes.create(), () => manager.units.create(), () => manager.suppliers.create(), () => manager.suppliers.delete(), () => manager.settings.update(), () => manager.items.reactivate()]) {
      await expect(action()).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    expect(writes).toHaveBeenCalledTimes(3);
    expect(canRoleAccessCatalogModule("it_member")).toBe(false);
    for (const action of [() => caller("it_member").items.create(), () => caller("it_member").items.update(), () => caller("it_member").items.delete()]) await expect(action()).rejects.toMatchObject({ code: "FORBIDDEN" });
    for (const action of [() => caller("it_manager", 0).items.create(), () => caller("it_manager", 0).items.getById()]) await expect(action()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await caller("it_manager").items.update();
    expect(writes).toHaveBeenCalledTimes(4);
  });
  it.each(newReferenceRoles)("does not grant %s standalone catalog management or supplier operations", async role => {
    const catalog = caller(role);
    expect(canRoleAccessCatalogModule(role)).toBe(false);
    for (const action of [
      () => catalog.nodes.create(), () => catalog.items.create(), () => catalog.items.update(),
      () => catalog.items.delete(), () => catalog.units.create(), () => catalog.suppliers.match(),
      () => catalog.itemSuppliers.matchInvoiceItems(),
    ]) {
      await expect(action()).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    expect(reads).not.toHaveBeenCalled();
    expect(writes).not.toHaveBeenCalled();
  });

  it.each(["owner", "admin", "maintenance_manager", "general_maintenance_manager", "construction_procurement_manager", "warehouse"])(
    "retains %s's existing catalog item mutation permission", async role => {
      await expect(caller(role).items.create()).resolves.toEqual({ id: 8 });
      expect(writes).toHaveBeenCalledOnce();
    },
  );

  it.each(existingReferenceRoles.filter(role => role !== "food_warehouse_assistant"))(
    "retains %s's existing supplier matching read", async role => {
    await expect(caller(role).suppliers.match()).resolves.toEqual([{ id: 7, nameAr: "fixture-suppliers" }]);
    },
  );
});

describe("The production catalog router binds the narrow reference procedure", () => {
  const file = "server/routers/catalog/catalog.router.ts";
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  function routeObject(expression: ts.Expression): ts.ObjectLiteralExpression {
    if (!ts.isCallExpression(expression) || expression.expression.getText(source) !== "router"
      || !expression.arguments[0] || !ts.isObjectLiteralExpression(expression.arguments[0])) {
      throw new Error("Expected the production router object");
    }
    return expression.arguments[0];
  }
  let root: ts.ObjectLiteralExpression | undefined;
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (declaration.name.getText(source) === "catalogRouter" && declaration.initializer) root = routeObject(declaration.initializer);
    }
  }
  function procedure(path: string): string {
    let object = root;
    const parts = path.split(".");
    for (let i = 0; i < parts.length; i += 1) {
      const property = object?.properties.find(property => ts.isPropertyAssignment(property)
        && property.name.getText(source) === parts[i]) as ts.PropertyAssignment | undefined;
      if (!property) throw new Error(`Missing production route: ${path}`);
      if (i === parts.length - 1) return property.initializer.getText(source);
      object = routeObject(property.initializer);
    }
    throw new Error(`Missing production procedure: ${path}`);
  }

  it.each(["nodes.list", "items.list", "units.list"])("uses the narrow procedure for %s", path => {
    expect(procedure(path)).toMatch(/^catalogReferenceReadProcedure\s*\./);
  });
  it.each(["suppliers.match", "itemSuppliers.matchInvoiceItems"])("retains the previous procedure for %s", path => {
    expect(procedure(path)).toMatch(/^catalogReadProcedure\s*\./);
  });
  it.each(["nodes.create", "units.create"])("keeps %s behind catalog management", path => {
    expect(procedure(path)).toMatch(/^catalogProcedure\s*\./);
  });
  it.each(["items.count", "items.getById", "items.previewNextCode", "items.create", "items.update"])("binds the approved item-only grant to %s", path => {
    expect(procedure(path)).toMatch(/^catalogItemManagerProcedure\s*\./);
  });
  it("binds deactivation separately from reactivation", () => {
    expect(procedure("items.delete")).toMatch(/^catalogItemDeactivateProcedure\s*\./);
    expect(procedure("items.reactivate")).toMatch(/^catalogItemLifecycleProcedure\s*\./);
  });
});

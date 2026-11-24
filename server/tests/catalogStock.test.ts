import { describe, expect, it, vi } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { router, inventoryReadProcedure, warehouseProcedure } from "../routers/_shared/procedures";
import { canRoleAccessPath, canRoleReadPurchaseCatalogStock } from "../../shared/roles";
import { createCatalogStockProcedure } from "../routers/inventory/catalog-stock.procedure";
import { summarizeCatalogStock, type CatalogStockRow } from "../../shared/catalog-stock";
import { observerRpcAllowed } from "../../shared/observer-policy";

const units = [{ nameAr: "حبة", nameEn: "Piece" }, { nameAr: "كرتون", nameEn: "Carton" }];
const row = (patch: Partial<CatalogStockRow> = {}): CatalogStockRow => ({
  catalogItemId: 1, catalogUnit: "حبة", inventoryId: 10, warehouseId: 1,
  nameAr: "الرئيسي", nameEn: "Main", quantity: "2.000", unit: "حبة", ...patch,
});

describe("Catalog stock quantity accuracy", () => {
  it("sums warehouses and duplicate stock rows for the exact catalog identity", () => {
    const result = summarizeCatalogStock([row(), row({ inventoryId: 11, quantity: 3 }), row({ inventoryId: 12, warehouseId: 2, nameAr: "الفريق", quantity: 5 })], units);
    expect(result[0].totals).toEqual([{ unit: "حبة", quantity: 10 }]);
    expect(result[0].warehouses.map(w => w.quantity)).toEqual([5, 5]);
  });
  it("keeps different catalog items separate even when their units/warehouses match", () => {
    expect(summarizeCatalogStock([row(), row({ catalogItemId: 2, quantity: 7 })], units).map(s => s.totals[0].quantity)).toEqual([2, 7]);
  });
  it("canonicalizes registered unit aliases but never adds cartons to pieces", () => {
    const result = summarizeCatalogStock([row(), row({ unit: " Piece ", quantity: 3 }), row({ unit: "كرتون", quantity: 4 })], units)[0];
    expect(result.totals).toEqual([{ unit: "حبة", quantity: 5 }, { unit: "كرتون", quantity: 4 }]);
    expect(result.warehouses).toHaveLength(2);
  });
  it("retains fractional quantities accurately and shows real zero only for known catalog items", () => {
    expect(summarizeCatalogStock([row({ quantity: 0.1 }), row({ quantity: 0.2 })], units)[0].totals[0].quantity).toBe(0.3);
    expect(summarizeCatalogStock([row({ inventoryId: null, quantity: null, warehouseId: null })], units)[0]).toMatchObject({ totals: [{ quantity: 0, unit: "حبة" }], warehouses: [] });
    expect(summarizeCatalogStock([], units)).toEqual([]);
  });
  it("does not silently hide negative legacy balances or assign unlocated stock to the main warehouse", () => {
    expect(summarizeCatalogStock([row({ warehouseId: null, nameAr: null, nameEn: null, quantity: -1 })], units)[0].warehouses[0]).toMatchObject({ warehouseId: null, quantity: -1 });
  });
  it("rejects corrupt quantities instead of manufacturing an available quantity", () => {
    expect(() => summarizeCatalogStock([row({ quantity: "invalid" })], units)).toThrow();
  });
});

function fakeDatabase() {
  const calls: any[] = [];
  const database = { select(fields: any) {
    const isStock = "catalogItemId" in fields;
    const record: any = { fields: Object.keys(fields), condition: null }; calls.push(record);
    const query: any = { from: () => query, leftJoin: () => query, where: (condition: any) => { record.condition = condition; return query; },
      then: (resolve: any, reject: any) => Promise.resolve(isStock ? [row()] : units).then(resolve, reject) };
    return query;
  } };
  return { database, calls };
}
function caller(role: string | null, getDatabase: () => Promise<any>, isActive = 1) {
  const api = router({ inventory: router({ catalogStock: createCatalogStockProcedure(getDatabase) }) });
  return api.createCaller({ user: role ? { id: 101, role, isActive } : null } as any).inventory;
}

describe("Stock read authorization and limited payload", () => {
  it.each(["owner", "admin", "warehouse", "maintenance_manager", "purchase_requester", "construction_procurement_manager"])("permits the existing inventory reader %s", async role => {
    const fake = fakeDatabase();
    const result = await caller(role, async () => fake.database).catalogStock({ catalogItemIds: [1, 1, 2] });
    expect(result[0].totals[0].quantity).toBe(2);
    expect(fake.calls).toHaveLength(2);
    expect(new MySqlDialect().sqlToQuery(fake.calls[0].condition).params).toEqual([1, 2]);
    expect(fake.calls[0].fields).toEqual(["catalogItemId", "catalogUnit", "inventoryId", "warehouseId", "nameAr", "nameEn", "quantity", "unit"]);
    expect(result[0]).not.toHaveProperty("inventoryId");
    expect(JSON.stringify(result)).not.toMatch(/unitCost|supplier|trackingToken/);
  });
  it.each(["general_maintenance_manager", "it_manager", "it_member", "technician"])("keeps %s excluded before any database access", async role => {
    const getDatabase = vi.fn();
    await expect(caller(role, getDatabase).catalogStock({ catalogItemIds: [1] })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(getDatabase).not.toHaveBeenCalled();
  });
  it("permits only the construction purchase-form reference and retains inventory read/write denials", async () => {
    expect(canRoleReadPurchaseCatalogStock("construction_procurement_manager")).toBe(true);
    expect(canRoleReadPurchaseCatalogStock("general_maintenance_manager")).toBe(false);
    expect(canRoleAccessPath("construction_procurement_manager", "/inventory")).toBe(false);
    const read = vi.fn(), write = vi.fn();
    const api = router({ inventory: router({
      list: inventoryReadProcedure.query(read),
      update: warehouseProcedure.mutation(write),
    }) });
    const client = api.createCaller({ user: { id: 101, role: "construction_procurement_manager", isActive: 1 } } as any).inventory;
    await expect(client.list()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(client.update()).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(read).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });
  it("denies inactive construction accounts before loading any inventory data", async () => {
    const getDatabase = vi.fn();
    await expect(caller("construction_procurement_manager", getDatabase, 0).catalogStock({ catalogItemIds: [1] })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(getDatabase).not.toHaveBeenCalled();
  });
  it("permits the observer's reviewed read without permitting mutations", async () => {
    const fake = fakeDatabase();
    await expect(caller("observer", async () => fake.database).catalogStock({ catalogItemIds: [1] })).resolves.toHaveLength(1);
    expect(observerRpcAllowed("observer", "query", "inventory.catalogStock")).toBe(true);
    expect(observerRpcAllowed("observer", "mutation", "inventory.catalogStock")).toBe(false);
  });
  it("rejects unauthenticated requests and invalid identifiers without database access", async () => {
    const getDatabase = vi.fn();
    await expect(caller(null, getDatabase).catalogStock({ catalogItemIds: [1] })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    for (const catalogItemIds of [[], [0], [-1], [1.5], Array(501).fill(1)]) {
      await expect(caller("warehouse", getDatabase).catalogStock({ catalogItemIds })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
    expect(getDatabase).not.toHaveBeenCalled();
  });
  it("keeps an inactive observer denied before database access", async () => {
    const getDatabase = vi.fn();
    await expect(caller("observer", getDatabase, 0).catalogStock({ catalogItemIds: [1] })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(getDatabase).not.toHaveBeenCalled();
  });
  it("returns a failure instead of a zero balance when the database is unavailable", async () => {
    await expect(caller("warehouse", async () => null).catalogStock({ catalogItemIds: [1] })).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
  });
});

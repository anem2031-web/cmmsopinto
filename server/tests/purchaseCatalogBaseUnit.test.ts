import { expect, it } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { assertPurchaseCatalogBaseUnits } from "../services/purchase-catalog-units";

const dialect = new MySqlDialect();
function port(entries = [{ id: 1, unit: "قطعة", nameAr: "قطعة", nameEn: "Piece", unitActive: 1 }]) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  return { entries, calls, execute: async (statement: any) => {
    const query = dialect.sqlToQuery(statement); calls.push(query);
    return [entries.filter(row => query.params.includes(row.id))];
  } };
}

it("accepts catalog base units and their registered alias, not a different package unit", async () => {
  const tx = port();
  await expect(assertPurchaseCatalogBaseUnits(tx, [{ catalogItemId: 1, unit: "قطعة" }, { catalogItemId: 1, unit: "Piece" }])).resolves.toBeUndefined();
  await expect(assertPurchaseCatalogBaseUnits(tx, [{ catalogItemId: 1, unit: "كرتون" }])).rejects.toMatchObject({ code: "BAD_REQUEST" });
  await expect(assertPurchaseCatalogBaseUnits(tx, [{ catalogItemId: 1 }])).rejects.toThrow("وحدة الطلب");
});

it("preserves unchanged historical draft units but validates explicit unit or identity changes", async () => {
  const tx = port();
  const previous = [{ id: 10, catalogItemId: 1, unit: "كرتون" }];
  await assertPurchaseCatalogBaseUnits(tx, [{ id: 10, catalogItemId: 1, unit: "كرتون" }], previous);
  expect(tx.calls).toHaveLength(0);
  await assertPurchaseCatalogBaseUnits(tx, [{ id: 10, catalogItemId: 1, unit: "قطعة" }], previous);
  await expect(assertPurchaseCatalogBaseUnits(tx, [{ id: 10, catalogItemId: 1, unit: "علبة" }], previous)).rejects.toThrow("وحدة الطلب");
  await expect(assertPurchaseCatalogBaseUnits(tx, [{ id: 10, catalogItemId: 2, unit: "كرتون" }], previous)).rejects.toThrow("غير موجود");
});

it("leaves non-catalog manual lines to their existing unit workflow", async () => {
  const tx = port();
  await assertPurchaseCatalogBaseUnits(tx, [{ unit: "كرتون" }, { catalogItemId: null, unit: "علبة" }]);
  expect(tx.calls).toHaveLength(0);
});
it("uses the stored catalog identity when update omits it, while preserving unchanged snapshots and explicit unlink", async () => {
  const tx = port(), previous = [{ id: 10, catalogItemId: 1, unit: "كرتون" }];
  await assertPurchaseCatalogBaseUnits(tx, [{ id: 10, unit: "كرتون" }], previous);
  expect(tx.calls).toHaveLength(0);
  await assertPurchaseCatalogBaseUnits(tx, [{ id: 10, unit: "قطعة" }], previous);
  expect(tx.calls.at(-1)?.params).toEqual([1]);
  await expect(assertPurchaseCatalogBaseUnits(tx, [{ id: 10, unit: "علبة" }], previous)).rejects.toThrow("وحدة الطلب");
  const reads = tx.calls.length;
  await assertPurchaseCatalogBaseUnits(tx, [{ id: 10, catalogItemId: null, unit: "علبة" }], previous);
  expect(tx.calls).toHaveLength(reads);
});

it("denies missing, inactive, empty and ambiguous master units", async () => {
  await expect(assertPurchaseCatalogBaseUnits(port([]), [{ catalogItemId: 1, unit: "قطعة" }])).rejects.toThrow("غير موجود");
  for (const row of [
    { id: 1, unit: "قطعة", nameAr: "قطعة", nameEn: "Piece", unitActive: 0 },
    { id: 1, unit: "", nameAr: "قطعة", nameEn: "Piece", unitActive: 1 },
  ]) await expect(assertPurchaseCatalogBaseUnits(port([row]), [{ catalogItemId: 1, unit: "قطعة" }])).rejects.toThrow("وحدة صنف الكتالوج");
  const row = { id: 1, unit: "قطعة", nameAr: "قطعة", nameEn: "Piece", unitActive: 1 };
  await expect(assertPurchaseCatalogBaseUnits(port([row, row]), [{ catalogItemId: 1, unit: "قطعة" }])).rejects.toThrow("وحدة صنف الكتالوج");
});

it("batch-loads distinct IDs in bounded chunks and rechecks on the next operation", async () => {
  const tx = port(Array.from({ length: 1001 }, (_, index) => ({ id: index + 1, unit: "قطعة", nameAr: "قطعة", nameEn: "Piece", unitActive: 1 })));
  const items = tx.entries.flatMap(row => Array.from({ length: 2 }, () => ({ catalogItemId: row.id, unit: "قطعة" })));
  await assertPurchaseCatalogBaseUnits(tx, items);
  expect(tx.calls).toHaveLength(3);
  expect(tx.calls.map(query => query.params.length)).toEqual([500, 500, 1]);
  expect(tx.calls.every(query => query.sql.endsWith("FOR UPDATE"))).toBe(true);
  tx.entries[0].unit = "حبة"; tx.entries[0].nameAr = "حبة"; tx.entries[0].nameEn = "Each";
  await expect(assertPurchaseCatalogBaseUnits(tx, [{ catalogItemId: 1, unit: "قطعة" }])).rejects.toThrow("حبة");
});

it("propagates infrastructure failures instead of converting them to ordinary unit mismatches", async () => {
  const failure = Error("database unavailable");
  await expect(assertPurchaseCatalogBaseUnits({ execute: async () => { throw failure; } }, [{ catalogItemId: 1, unit: "قطعة" }])).rejects.toBe(failure);
});

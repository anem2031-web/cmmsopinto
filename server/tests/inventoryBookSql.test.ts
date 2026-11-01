import { createRequire } from "node:module";
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite");
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { and, eq, sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { inventory } from "../../drizzle/schema";
import { activeBookStockUnit } from "../_core/inventory-book-policy";
import { inventoryBookTotalsQuery } from "../services/inventory-book-summary";
import { readInventoryBooks } from "../routers/inventory/books.procedure";

// Disposable, process-local SQL fixtures. No project database or environment.
function fixture() {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE inventory(id INTEGER,linkedItemId INTEGER,warehouseId INTEGER,unit TEXT,issueUnit TEXT,isFrozen INTEGER,quantity REAL,itemName TEXT,internalCode TEXT,manufacturerBarcode TEXT,updatedAt TEXT);
    CREATE TABLE catalog_units(nameAr TEXT,nameEn TEXT,isActive INTEGER);
    CREATE TABLE catalog_items(id INTEGER,nameAr TEXT,nameEn TEXT,code TEXT,unit TEXT,nodeId INTEGER);
    CREATE TABLE catalog_item_candidates(resolvedCatalogItemId INTEGER,itemName TEXT);
    CREATE TABLE inventory_lots(id INTEGER,catalogItemId INTEGER,issueUnit TEXT,supplierItemName TEXT,lotCode TEXT,trackingToken TEXT);
    CREATE TABLE inventory_transactions(inventoryId INTEGER,lotId INTEGER,type TEXT,quantity REAL);
    INSERT INTO catalog_units VALUES('حبة','Each',1),('قطعة','Piece',1),('كجم','Kg',1);
    INSERT INTO catalog_items VALUES(9,'دجاج 1100 جم','Chicken','CAT-9','قطعة',1),(99,'سمك','Fish','FISH-99','حبة',2);
    INSERT INTO inventory VALUES
      (1,9,1,'كجم','كجم',1,0,'OLD CHICKEN','INV-1',NULL,'2026-01-01'),
      (2,9,1,'حبة','حبة',0,3,'Fresh chicken','INV-2',NULL,'2026-02-01'),
      (3,9,1,'قطعة','قطعة',0,7,'Chicken piece','INV-3',NULL,'2026-03-01'),
      (4,9,2,'حبة','حبة',0,100,'Warehouse two','INV-4',NULL,'2026-04-01'),
      (5,99,1,'حبة','حبة',0,5,'Fish','INV-5',NULL,'2026-05-01'),
      (6,9,1,'Piece','Piece',0,2,'English unit','INV-6',NULL,'2026-06-01');
    INSERT INTO inventory_lots VALUES(1,9,'كجم','Supplier old chicken','LOT-1','tok-1'),(7,9,'كجم','Old delivery','LOT-7','tok-7'),(8,9,'حبة','New supplier name','LOT-8','tok-8'),(9,9,'قطعة','Pieces','LOT-9','tok-9');
    INSERT INTO catalog_item_candidates VALUES(9,'Candidate alias chicken');
    INSERT INTO inventory_transactions VALUES(1,1,'in',50),(1,1,'out',50),(2,7,'in',50),(2,7,'out',50),(2,8,'in',3),(3,9,'in',7);`);
  const dialect = new MySqlDialect();
  const execute = async (query: any) => {
    const compiled = dialect.sqlToQuery(query);
    return [db.prepare(compiled.sql).all(...(compiled.params as any[]))];
  };
  return { db, execute };
}
it("selects compatible nonfrozen pages by actual unit family without treating kilograms as pieces", async () => {
  const f = fixture();
  try {
    const matches = async (unit: string) =>
      (
        await f.execute(
          sql`SELECT id FROM inventory WHERE ${and(eq(inventory.linkedItemId, 9), eq(inventory.warehouseId, 1), activeBookStockUnit(unit))} ORDER BY id LIMIT 1`
        )
      )[0];
    expect((await matches("حبة")).map((row: any) => row.id)).toEqual([2]);
    expect((await matches("Piece")).map((row: any) => row.id)).toEqual([3]);
    expect(await matches("كجم")).toEqual([]);
    expect(await matches("كرتون")).toEqual([]);
  } finally {
    f.db.close();
  }
});
it("summarizes movement quantities in their original lot units without duplicating stock quantities", async () => {
  const f = fixture();
  try {
    const [rows] = await f.execute(inventoryBookTotalsQuery([9], 1));
    const value = (unit: string, frozen: number) =>
      rows.find(
        (row: any) => row.unit === unit && row.isFrozen === frozen
      ) as any;
    expect(value("حبة", 0)).toMatchObject({
      quantity: 3,
      incoming: 3,
      outgoing: 0,
    });
    expect(value("كجم", 0)).toMatchObject({
      quantity: 0,
      incoming: 50,
      outgoing: 50,
    });
    expect(value("كجم", 1)).toMatchObject({
      quantity: 0,
      incoming: 50,
      outgoing: 50,
    });
    expect(value("قطعة", 0)).toMatchObject({
      quantity: 7,
      incoming: 7,
      outgoing: 0,
    });
    expect(rows.every((row: any) => row.catalogItemId === 9)).toBe(true);
  } finally {
    f.db.close();
  }
});
it.each([
  "OLD CHICKEN",
  "New supplier name",
  "Candidate alias chicken",
  "CAT-9",
  "LOT-8",
])(
  "finds one master by linked name/code %s while keeping the warehouse scope",
  async search => {
    const f = fixture();
    try {
      const result = await readInventoryBooks(f, { warehouseId: 1, search });
      expect(result.books.map(book => book.id)).toEqual([9]);
      expect(Number(result.books[0].pageCount)).toBe(4);
      expect(
        result.books[0].totals.some(row => Number(row.quantity) === 100)
      ).toBe(false);
    } finally {
      f.db.close();
    }
  }
);

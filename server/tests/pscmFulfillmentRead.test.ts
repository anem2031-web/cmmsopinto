import { createRequire } from "node:module";
import type { SQL, SQLWrapper } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getPscmFulfillment, listPscmReady } from "../services/pscm/fulfillment-read";

const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
const ports = vi.hoisted(() => ({ db: vi.fn(), parents: vi.fn(), scope: vi.fn() }));
vi.mock("../_core/db/client", () => ({ getDb: ports.db }));
vi.mock("../_core/db/purchase-read-lists", () => ({ getPurchaseOrdersByIds: ports.parents }));
vi.mock("../_core/authz/guard", () => ({ createPurchaseOrderReadScope: ports.scope }));
vi.mock("../_core/inventory-lots", () => ({ isInventoryLotsEnabled: () => true }));
vi.mock("../_core/catalog-unit-governance", () => ({}));
vi.mock("../_core/db/warehouse-returns", () => ({}));

const actor = { id: 12, role: "warehouse", isActive: 1 };
let sqlite: InstanceType<typeof DatabaseSync>;

beforeEach(() => {
  sqlite = new DatabaseSync(":memory:");
  sqlite.function("GREATEST", { varargs: true }, (...values) => Math.max(...values.map(Number)));
  sqlite.function("LEAST", { varargs: true }, (...values) => Math.min(...values.map(Number)));
  sqlite.exec(`
    CREATE TABLE pscm_purchase_items(purchaseOrderItemId INT, purchaseOrderId INT, sequence INT,
      projectName TEXT, taskName TEXT, orderUnit TEXT, requestedQuantity INT);
    CREATE TABLE purchase_orders(id INT, poNumber TEXT, sourceSystem TEXT, sourceInstanceId TEXT,
      sourceRequestId INT, sourceReference TEXT, status TEXT);
    CREATE TABLE purchase_order_items(id INT, purchaseOrderId INT, itemName TEXT, status TEXT, reviewRole TEXT);
    CREATE TABLE warehouse_receipts(id INT, status TEXT);
    CREATE TABLE warehouse_receipt_items(id INT, receiptId INT, purchaseOrderItemId INT,
      inventoryId INT, receivedQuantity NUMERIC, purchaseUnit TEXT);
    CREATE TABLE inventory_lots(id INT, lotCode TEXT, receiptItemId INT, receiptId INT,
      purchaseOrderItemId INT, purchaseOrderId INT, remainingQuantity NUMERIC, issueUnit TEXT,
      conversionFactor NUMERIC, specificationStatus TEXT, sourceType TEXT);
    CREATE TABLE inventory(id INT, quantity NUMERIC, isFrozen INT);
    CREATE TABLE inventory_lot_balances(lotId INT, inventoryId INT, quantity NUMERIC);
    CREATE TABLE pscm_fulfillment_issues(purchaseOrderItemId INT, lotId INT, quantity INT,
      orderQuantity NUMERIC, deliveryNumber TEXT, deliveryDocumentId INT);
    CREATE TABLE delivery_documents(id INT, poItemId INT, deliveredToName TEXT);
    CREATE TABLE catalog_units(nameAr TEXT, nameEn TEXT, isActive INT);
    INSERT INTO catalog_units VALUES ('كرتون', 'Carton', 1), ('قطعة', 'Piece', 1);
    INSERT INTO pscm_purchase_items VALUES
      (31,1,1,'المشروع','المهمة','كرتون',1),
      (32,2,1,'جهة أخرى','مهمة أخرى','قطعة',12),
      (33,3,1,'مشروع يدوي','مهمة','قطعة',12);
    INSERT INTO purchase_orders VALUES
      (1,'PR-2026-0001','PSCM','pscm',14,'MR-26-11-0014','received'),
      (2,'PR-2026-0002','PSCM','other',14,'MR-26-11-0014','received'),
      (3,'PR-2026-0003',NULL,NULL,14,NULL,'received');
    INSERT INTO purchase_order_items VALUES
      (31,1,'وصلة','delivered_to_warehouse','construction_procurement_manager'),
      (32,2,'آخر','delivered_to_warehouse','general_maintenance_manager'),
      (33,3,'يدوي','delivered_to_warehouse','general_maintenance_manager');
    INSERT INTO warehouse_receipts VALUES (71,'confirmed'),(72,'confirmed'),(73,'draft');
    INSERT INTO warehouse_receipt_items VALUES (81,71,31,51,1,'Carton'),(82,72,32,52,12,'Piece'),(83,73,31,51,20,'Carton');
    INSERT INTO inventory_lots VALUES
      (111,'LOT-111',81,71,31,1,12,'Piece',12,'pending','receipt'),
      (112,'LOT-112',82,72,32,2,12,'Piece',1,NULL,'receipt');
    INSERT INTO inventory VALUES (51,12,0),(52,12,0);
    INSERT INTO inventory_lot_balances VALUES (111,51,12),(112,52,12);
  `);
  const dialect = new MySqlDialect();
  const db = {
    execute: async (statement: SQL | SQLWrapper) => {
      const compiled = dialect.sqlToQuery(statement.getSQL());
      if (compiled.sql.includes("FROM information_schema.TABLES")) return [[]];
      return [sqlite.prepare(compiled.sql).all(...compiled.params as number[])];
    },
    transaction: async (work: (tx: typeof db) => unknown) => work(db),
  };
  ports.db.mockResolvedValue(db);
  ports.parents.mockImplementation(async (ids: number[]) => ids.map(id => ({ id })));
  ports.scope.mockResolvedValue({ filter: (orders: { id: number }[]) => orders.filter(order => order.id === 1) });
});

afterEach(() => {
  sqlite.close();
  vi.clearAllMocks();
});

describe("PSCM warehouse progress from committed documents", () => {
  it("scopes progress to the exact instance, ignores draft receipts, and separates matching from issue", async () => {
    expect(await getPscmFulfillment("pscm", [14, 14])).toEqual({
      items: [{ requisitionId: 14, sequence: 1, unit: "كرتون", receivedQuantity: 1,
        readyQuantity: 0, issuedQuantity: 0, deliveries: [] }],
    });
    sqlite.exec("UPDATE inventory_lots SET specificationStatus='approved' WHERE id=111");
    expect(await getPscmFulfillment("pscm", [14])).toMatchObject({
      items: [{ receivedQuantity: 1, readyQuantity: 1, issuedQuantity: 0 }],
    });
    expect(await getPscmFulfillment("absent", [14])).toEqual({ items: [] });
  });

  it("filters item, task, document and lot text before paging and still applies purchase scope", async () => {
    sqlite.exec("UPDATE inventory_lots SET specificationStatus='approved' WHERE id=111");
    for (const search of ['وصل', '2026-0001', 'المهم', 'LOT-111', '11-0014']) {
      expect((await listPscmReady(actor, 0, search)).items.map(item => item.purchaseOrderItemId)).toEqual([31]);
    }
    expect((await listPscmReady(actor, 0, '0002')).items).toEqual([]);
    expect((await listPscmReady(actor, 31, 'LOT-111')).items).toEqual([]);
  });

  it("treats SQL wildcard characters as literal search text", async () => {
    sqlite.exec("UPDATE inventory_lots SET specificationStatus='approved' WHERE id=111; UPDATE purchase_order_items SET itemName='وصلة 75%_!' WHERE id=31");
    expect((await listPscmReady(actor,0,'%_!')).items.map(item => item.purchaseOrderItemId)).toEqual([31]);
    expect((await listPscmReady(actor,0,'%_X')).items).toEqual([]);
  });

  it("searches all eligible PSCM rows before applying the 50-row page", async () => {
    for (let n=100; n<155; n++) {
      sqlite.prepare("INSERT INTO pscm_purchase_items VALUES(?,1,?,'Project','Task','Piece',1)").run(n,n);
      sqlite.prepare("INSERT INTO purchase_order_items VALUES(?,1,?,'delivered_to_warehouse','general_maintenance_manager')").run(n,n===154 ? 'Very distinctive item' : 'Other material');
      sqlite.prepare("INSERT INTO warehouse_receipts VALUES(?,'confirmed')").run(n+1000);
      sqlite.prepare("INSERT INTO warehouse_receipt_items VALUES(?,?,?,?,1,'Piece')").run(n+2000,n+1000,n,n+3000);
      sqlite.prepare("INSERT INTO inventory_lots VALUES(?,?,?,?,?,1,1,'Piece',1,NULL,'receipt')").run(n+4000,'LOT-'+n,n+2000,n+1000,n);
      sqlite.prepare("INSERT INTO inventory VALUES(?,1,0)").run(n+3000);
      sqlite.prepare("INSERT INTO inventory_lot_balances VALUES(?,?,1)").run(n+4000,n+3000);
    }
    expect((await listPscmReady(actor)).nextCursor).not.toBeNull();
    expect((await listPscmReady(actor,0,'distinctive')).items.map(item => item.purchaseOrderItemId)).toEqual([154]);
  });

  it("shows the remaining physical piece after a fractional-carton issue and filters inaccessible purchases", async () => {
    sqlite.exec(`
      UPDATE inventory_lots SET specificationStatus='approved',remainingQuantity=1 WHERE id=111;
      UPDATE inventory_lot_balances SET quantity=1 WHERE lotId=111;
      UPDATE inventory SET quantity=1 WHERE id=51;
      INSERT INTO pscm_fulfillment_issues VALUES (31,111,11,0.916667,'DLV-2026-1234',91);
      INSERT INTO delivery_documents VALUES (91,31,'المستلم');
    `);
    expect(await listPscmReady(actor)).toMatchObject({ items: [
      { purchaseOrderItemId: 31, lots: [{ id: 111, quantity: 1, unit: "Piece" }] },
    ], nextCursor: null });
    expect(ports.parents).toHaveBeenCalledWith([1, 2]);
    expect(await getPscmFulfillment("pscm", [14])).toMatchObject({
      items: [{ readyQuantity: 0.083333, issuedQuantity: 0.916667,
        deliveries: [{ number: "DLV-2026-1234", quantity: 0.916667, recipientName: "المستلم" }] }],
    });
  });
});

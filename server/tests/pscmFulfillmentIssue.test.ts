import { createRequire } from "node:module";
import type { SQLInputValue } from "node:sqlite";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { SQL } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { issuePscmFulfillment, pscmAvailableIssueQuantity } from "../services/pscm/fulfillment-issue";
import { assertOperationalIssueReference } from "../services/operational-issues/issue-reference";

const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
const ports = vi.hoisted(() => ({ transaction: vi.fn(), issue: vi.fn() }));
vi.mock("../_core/db/client", () => ({ withTransaction: ports.transaction }));
vi.mock("../_core/db/warehouse-returns", () => ({ issueDelivery: ports.issue }));
vi.mock("../_core/inventory-lots", () => ({ isInventoryLotsEnabled: () => true }));
vi.mock("../_core/catalog-unit-governance", () => ({
  getActiveCatalogUnitCanonicalName: async (value: string) =>
    ({ Carton: "كرتون", Piece: "قطعة" } as Record<string, string>)[value] ?? null,
}));

function fixture() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE users (id INTEGER,role TEXT,isActive INTEGER);
    CREATE TABLE purchase_orders (id INTEGER,sourceSystem TEXT,sourceReference TEXT,siteId INTEGER,sectionId INTEGER,assetId INTEGER,status TEXT);
    CREATE TABLE purchase_order_items (id INTEGER,purchaseOrderId INTEGER,status TEXT,reviewRole TEXT,siteId INTEGER,sectionId INTEGER,assetId INTEGER);
    CREATE TABLE pscm_purchase_items (purchaseOrderItemId INTEGER,purchaseOrderId INTEGER,taskId INTEGER,requestedQuantity INTEGER,orderUnit TEXT);
    CREATE TABLE pscm_fulfillment_issues (operationKey TEXT PRIMARY KEY,purchaseOrderItemId INTEGER,lotId INTEGER,quantity INTEGER,deliveredToId INTEGER,deliveryNumber TEXT,deliveryDocumentId INTEGER,orderQuantity NUMERIC);
    CREATE TABLE inventory (id INTEGER,quantity NUMERIC,isFrozen INTEGER);
    CREATE TABLE inventory_lots (id INTEGER,purchaseOrderItemId INTEGER,purchaseOrderId INTEGER,sourceType TEXT,receiptId INTEGER,receiptItemId INTEGER,trackingToken TEXT,specificationStatus TEXT,purchaseUnit TEXT,issueUnit TEXT,conversionFactor NUMERIC,remainingQuantity NUMERIC);
    CREATE TABLE inventory_lot_balances (lotId INTEGER,inventoryId INTEGER,quantity NUMERIC);
    CREATE TABLE warehouse_receipts (id INTEGER,status TEXT);
    CREATE TABLE warehouse_receipt_items (id INTEGER,receiptId INTEGER,purchaseOrderItemId INTEGER,inventoryId INTEGER);
    CREATE TABLE delivery_documents (id INTEGER PRIMARY KEY,quantity NUMERIC);
    INSERT INTO users VALUES (1,'warehouse',1),(2,'technician',1),(3,'technician',0),(4,'operator',1),(5,'warehouse',0);
    INSERT INTO purchase_orders VALUES (10,'PSCM','MR-12',60,61,64,'received');
    INSERT INTO purchase_order_items VALUES (11,10,'delivered_to_warehouse','construction_procurement_manager',61,62,NULL);
    INSERT INTO pscm_purchase_items VALUES (11,10,15,2,'كرتون');
    INSERT INTO inventory VALUES (22,6,0),(23,6,0);
    INSERT INTO inventory_lots VALUES (13,11,10,'receipt',24,25,'trusted-token','approved','Carton','Piece',3,6);
    INSERT INTO inventory_lot_balances VALUES (13,22,6),(13,23,6);
    INSERT INTO warehouse_receipts VALUES (24,'confirmed');
    INSERT INTO warehouse_receipt_items VALUES (25,24,11,22);
  `);
  const dialect = new MySqlDialect();
  const tx = {
    async execute(query: SQL) {
      const { sql, params } = dialect.sqlToQuery(query);
      const statement = db.prepare(sql.trim().replace(/\s+FOR UPDATE$/i, ""));
      const args = params as SQLInputValue[];
      return sql.trimStart().startsWith("SELECT") ? [statement.all(...args)] : [statement.run(...args)];
    },
  };
  let queue: Promise<unknown> = Promise.resolve();
  ports.transaction.mockImplementation(work => {
    const operation = queue.then(async () => {
      db.exec("BEGIN");
      try {
        const result = await work(tx);
        db.exec("COMMIT");
        return result;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    });
    queue = operation.catch(() => {});
    return operation;
  });
  ports.issue.mockImplementation(async (input, existingTx) => {
    expect(existingTx).toBe(tx);
    db.prepare("UPDATE inventory SET quantity=quantity-? WHERE id=?").run(input.quantity, input.inventoryId);
    db.prepare("UPDATE inventory_lot_balances SET quantity=quantity-? WHERE lotId=13 AND inventoryId=?")
      .run(input.quantity, input.inventoryId);
    db.prepare("UPDATE inventory_lots SET remainingQuantity=remainingQuantity-? WHERE id=13").run(input.quantity);
    if (input.markPurchaseOrderItemDelivered) db.exec("UPDATE purchase_order_items SET status='delivered_to_requester' WHERE id=11");
    const id = Number(db.prepare("INSERT INTO delivery_documents(quantity) VALUES(?)").run(input.quantity).lastInsertRowid);
    return { deliveryNumber: `DLV-${id}`, deliveryDocumentId: id };
  });
  return { db, tx };
}

const input = (sequence = 1, quantity = 1) => ({
  purchaseOrderItemId: 11, lotId: 13, quantity, deliveredToId: 2,
  operationKey: `00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`,
});
let f: ReturnType<typeof fixture>;
beforeEach(() => { vi.clearAllMocks(); f = fixture(); });
afterEach(() => f.db.close());

describe("PSCM warehouse fulfillment write", () => {
  it("offers the final physical issue unit even when the rounded remaining order quantity is below a whole physical unit", () => {
    expect(pscmAvailableIssueQuantity(4, 0.083333, 12, 11)).toBe(1);
    expect(pscmAvailableIssueQuantity(4, 0.083333, 12, 0)).toBe(1);
    expect(pscmAvailableIssueQuantity(4, 0.083332, 12, 11)).toBe(0);
  });
  it("links actual partial delivery documents and replays without issuing twice", async () => {
    const first = await issuePscmFulfillment(input(), 1);
    expect(first).toEqual({ deliveryNumber: "DLV-1" });
    expect(ports.issue).toHaveBeenLastCalledWith(expect.objectContaining({
      inventoryId: 22, lotTrackingToken: "trusted-token", purchaseOrderItemId: 11,
      deliveredToId: 2, pscmFulfillment: true, markPurchaseOrderItemDelivered: false,
      costAllocations: [{ beneficiarySiteId: 61, beneficiarySectionId: 62, beneficiaryAssetId: null, quantity: 1 }],
    }), f.tx);
    await expect(issuePscmFulfillment(input(), 1)).resolves.toEqual(first);
    await expect(issuePscmFulfillment(input(1, 2), 1)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(ports.issue).toHaveBeenCalledTimes(1);
    await issuePscmFulfillment(input(2, 1), 1);
    await issuePscmFulfillment(input(3, 4), 1);
    expect(ports.issue).toHaveBeenLastCalledWith(expect.objectContaining({ markPurchaseOrderItemDelivered: true }), f.tx);
    expect(f.db.prepare("SELECT deliveryDocumentId,orderQuantity FROM pscm_fulfillment_issues ORDER BY deliveryDocumentId").all())
      .toEqual([{ deliveryDocumentId: 1, orderQuantity: .333333 }, { deliveryDocumentId: 2, orderQuantity: .333334 }, { deliveryDocumentId: 3, orderQuantity: 1.333333 }]);
    expect(f.db.prepare("SELECT quantity FROM inventory WHERE id=23").get()).toEqual({ quantity: 6 });
    await expect(issuePscmFulfillment(input(), 1)).resolves.toEqual(first);
  });

  it("caps concurrent submissions at the original requested quantity in converted order units", async () => {
    f.db.exec("UPDATE pscm_purchase_items SET requestedQuantity=1");
    const results = await Promise.allSettled([
      issuePscmFulfillment(input(1, 2), 1), issuePscmFulfillment(input(2, 2), 1),
    ]);
    expect(results.map(value => value.status)).toEqual(["fulfilled", "rejected"]);
    const failed = results[1] as PromiseRejectedResult;
    expect(failed.reason).toMatchObject({ code: "CONFLICT" });
    await expect(issuePscmFulfillment(input(3, 1), 1)).resolves.toEqual({ deliveryNumber: "DLV-2" });
    expect(f.db.prepare("SELECT SUM(orderQuantity) AS total FROM pscm_fulfillment_issues").get()).toEqual({ total: 1 });
  });

  it.each([
    "UPDATE purchase_orders SET sourceSystem=NULL",
    "UPDATE pscm_purchase_items SET taskId=0",
    "UPDATE purchase_orders SET status='closed'",
    "UPDATE purchase_order_items SET status='delivered_to_requester'",
    "UPDATE inventory_lots SET purchaseOrderItemId=12",
    "UPDATE inventory_lots SET specificationStatus='pending'",
    "UPDATE inventory_lots SET specificationStatus='rejected'",
    "UPDATE warehouse_receipts SET status='draft'",
    "UPDATE inventory SET isFrozen=1 WHERE id=22",
  ])("rejects a stale or unrelated source before stock mutation (%s)", async (sql) => {
    f.db.exec(sql);
    await expect(issuePscmFulfillment(input(), 1)).rejects.toBeTruthy();
    expect(ports.issue).not.toHaveBeenCalled();
  });

  it("rechecks the active warehouse actor and technician receiving the issue", async () => {
    await expect(issuePscmFulfillment(input(), 4)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(issuePscmFulfillment(input(), 5)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(issuePscmFulfillment({ ...input(), deliveredToId: 3 }, 1)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(ports.issue).not.toHaveBeenCalled();
  });

  it("rolls back stock and the delivery document when the PSCM linkage cannot be recorded", async () => {
    f.db.exec("CREATE TRIGGER fail_pscm_link BEFORE INSERT ON pscm_fulfillment_issues BEGIN SELECT RAISE(ABORT,'link insert failed'); END");
    await expect(issuePscmFulfillment(input(), 1)).rejects.toThrow("link insert failed");
    expect(f.db.prepare("SELECT quantity FROM inventory WHERE id=22").get()).toEqual({ quantity: 6 });
    expect(f.db.prepare("SELECT COUNT(*) AS total FROM delivery_documents").get()).toEqual({ total: 0 });
  });

  it("accepts a stored PSCM task as the only execution reference", async () => {
    const context = { pscmPurchaseOrderItemId: 11, performedById: 1, catalogItemId: 1, quantity: 1 };
    await expect(assertOperationalIssueReference(f.tx, context)).resolves.toBeNull();
    await expect(assertOperationalIssueReference(f.tx, { ...context, ticketId: 5 })).rejects.toThrow("مرجع تنفيذ واحد");
    await expect(assertOperationalIssueReference(f.tx, { ...context, pscmPurchaseOrderItemId: 12 })).rejects.toThrow("غير صالح للصرف");
  });
});

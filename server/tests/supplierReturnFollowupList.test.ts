import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { listInput, listSupplierReturns } from "../supplier-return-followup/runtime";

const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite");
const dialect = new MySqlDialect();
let memory: any;
let calls: Array<{ sql: string; params: any[] }>;
let port: any;
beforeEach(() => {
  memory = new DatabaseSync(":memory:"); calls = [];
  memory.function("DATABASE", () => "copycmms2");
  memory.function("CONCAT", { varargs: true }, (...values: unknown[]) => values.join(""));
  memory.function("GREATEST", { varargs: true }, (...values: number[]) => Math.max(...values));
  memory.exec(`
    CREATE TABLE users(id INT PRIMARY KEY,role TEXT,isActive INT);
    INSERT INTO users VALUES(10,'delegate',1),(20,'warehouse',1),(30,'accountant',1),(40,'owner',1);
    CREATE TABLE supplier_return_cases(id INT PRIMARY KEY,returnId INT,delegateId INT,createdById INT,creatorId INT,purchaseOrderId INT,purchaseOrderItemId INT,receiptId INT,receiptItemId INT,lotId INT,inventoryId INT,returnedQuantity NUMERIC,returnedUnit TEXT,returnReason TEXT,handoverStatus TEXT,rejectionReason TEXT,resolution TEXT,creatorDecision TEXT,revision INT DEFAULT 0,closedAt TEXT,originalPurchaseValue NUMERIC,currency TEXT,valuationBasis TEXT,createdAt TEXT DEFAULT CURRENT_TIMESTAMP,parentReplacementPlanId INT);
    CREATE TABLE warehouse_returns(id INT PRIMARY KEY,inventoryId INT,purchaseOrderId INT,purchaseOrderItemId INT,sourceDeliveryDocumentId INT,receiptId INT,lotId INT,returnNumber TEXT,returnedQuantity NUMERIC DEFAULT 2);
    CREATE TABLE inventory(id INT PRIMARY KEY,itemName TEXT,linkedItemId INT);
    CREATE TABLE warehouse_receipts(id INT PRIMARY KEY,status TEXT,receiptNumber TEXT,purchaseOrderId INT);
    CREATE TABLE warehouse_receipt_items(id INT PRIMARY KEY,receiptId INT,inventoryId INT,purchaseOrderItemId INT,catalogItemId INT);
    CREATE TABLE inventory_lots(id INT PRIMARY KEY,receiptId INT,receiptItemId INT,sourceType TEXT,purchaseOrderId INT,purchaseOrderItemId INT,catalogItemId INT,issueUnit TEXT);
    CREATE TABLE inventory_lot_balances(id INT PRIMARY KEY,inventoryId INT,lotId INT);
    CREATE TABLE purchase_orders(id INT PRIMARY KEY,poNumber TEXT,siteId INT,sectionId INT,categoryId INT,assetId INT,ticketId INT,ticketItemId INT);
    CREATE TABLE purchase_order_items(id INT PRIMARY KEY,purchaseOrderId INT,itemName TEXT,siteId INT,sectionId INT,categoryId INT,assetId INT,photoUrl TEXT);
    CREATE TABLE supplier_return_replacement_plans(id INT PRIMARY KEY,caseId INT,planNumber INT,status TEXT,purchaseOrderId INT,purchaseOrderItemId INT,quotedTotal NUMERIC,creditAllocated NUMERIC,additionalFunding NUMERIC,catalogItemId INT,itemName TEXT,replacementQuantity NUMERIC,replacementUnit TEXT);
    CREATE TABLE supplier_return_settlements(id INT PRIMARY KEY,caseId INT,type TEXT,status TEXT,operationKey TEXT,amount NUMERIC,referenceNumber TEXT);
    CREATE TABLE catalog_item_images(id INT PRIMARY KEY,itemId INT,imageType TEXT,sortOrder INT,imageUrl TEXT);
    INSERT INTO inventory(id,itemName) VALUES(1,'Material');
    INSERT INTO purchase_orders(id,poNumber) VALUES(1,'PR-ORIGINAL');
    INSERT INTO purchase_order_items(id,purchaseOrderId,itemName) VALUES(1,1,'Material');
  `);
  port = { execute: async (statement: any) => {
    const query = dialect.sqlToQuery(statement); calls.push(query);
    return [memory.prepare(query.sql.replaceAll("<=>", "IS")).all(...query.params)];
  } };
});
afterEach(() => memory.close());

function seed(id: number, overrides: { delegate?: number; creator?: number | null; closed?: boolean; standalone?: boolean } = {}) {
  memory.prepare(`INSERT INTO warehouse_returns(id,inventoryId,purchaseOrderId,purchaseOrderItemId,returnNumber,receiptId,lotId) VALUES(?,1,?,?,?,50,70)`).run(id, overrides.standalone ? null : 1, overrides.standalone ? null : 1, `RTN-${id}`);
  memory.prepare(`INSERT INTO supplier_return_cases(id,returnId,delegateId,createdById,creatorId,purchaseOrderId,purchaseOrderItemId,receiptId,receiptItemId,lotId,inventoryId,returnedQuantity,returnedUnit,returnReason,handoverStatus,closedAt,originalPurchaseValue,currency,valuationBasis,createdAt) VALUES(?,?,?,20,?,?,?,50,60,70,1,2,'piece','reason','accepted',?,100,'SAR','tax_inclusive',?)`)
    .run(id, id, overrides.delegate ?? 10, overrides.creator === undefined ? 30 : overrides.creator, overrides.standalone ? null : 1, overrides.standalone ? null : 1, overrides.closed ? "2026-11-04 12:00:00" : null, `2026-11-04 12:${String(id % 60).padStart(2, "0")}:00`);
}
const actor = { id: 10, role: "delegate" };
describe("Supplier return active/completed SQL list", () => {
  it("filters completed status before counting and pagination, retaining assigned-case scope", async () => {
    seed(1); seed(2, { closed: true }); seed(3, { delegate: 11 }); seed(4, { closed: true, delegate: 11 });
    const active = await listSupplierReturns(actor, { pageSize: 1 }, port);
    expect(active).toMatchObject({ total: 1, page: 1, pageSize: 1 });
    expect(active.items.map(row => row.id)).toEqual([1]);
    const completed = await listSupplierReturns(actor, { status: "completed", pageSize: 1 }, port);
    expect(completed.total).toBe(1); expect(completed.items.map(row => row.id)).toEqual([2]);
    expect((await listSupplierReturns(actor, { status: "all" }, port)).total).toBe(2);
    expect(listInput.parse({}).status).toBe("active");
    expect(() => listInput.parse({ status: "foreign" })).toThrow();
  });
  it("keeps creator ownership and warehouse/owner oversight unchanged for both tabs", async () => {
    seed(1); seed(2, { creator: 31 }); seed(3, { closed: true }); seed(4, { closed: true, creator: 31 });
    for (const status of ["active", "completed"] as const) {
      const own = await listSupplierReturns({ id: 30, role: "accountant" }, { status }, port);
      expect(own.total).toBe(1); expect(own.items[0].creatorId).toBe(30);
      expect((await listSupplierReturns({ id: 20, role: "warehouse" }, { status }, port)).total).toBe(2);
      expect((await listSupplierReturns({ id: 40, role: "owner" }, { status }, port)).total).toBe(2);
    }
    memory.exec("UPDATE users SET isActive=0 WHERE id=10");
    await expect(listSupplierReturns(actor, {}, port)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("reports cheaper replacement remainder without posting or duplicating money", async () => {
    seed(1, { closed: true });
    memory.exec(`INSERT INTO supplier_return_replacement_plans(id,caseId,planNumber,status,quotedTotal,creditAllocated,additionalFunding) VALUES(1,1,1,'received',80,80,0);
      INSERT INTO supplier_return_settlements(id,caseId,type,status,operationKey,amount) VALUES(1,1,'supplier_credit','completed','handover-credit:1',100);`);
    const before = memory.prepare("SELECT * FROM supplier_return_settlements").all();
    expect((await listSupplierReturns(actor, { status: "completed" }, port)).items[0].residualCustodyAmount).toBe(20);
    expect(memory.prepare("SELECT * FROM supplier_return_settlements").all()).toEqual(before);
    memory.exec("UPDATE supplier_return_replacement_plans SET status='pending_accounting'");
    expect((await listSupplierReturns(actor, { status: "completed" }, port)).items[0].residualCustodyAmount).toBeNull();
  });
  it("only uses standalone creator fallback with the exact confirmed receipt, line and lot", async () => {
    seed(1, { standalone: true, creator: null });
    memory.exec(`INSERT INTO warehouse_receipts(id,status,receiptNumber) VALUES(50,'confirmed','RCV-50'); INSERT INTO warehouse_receipt_items(id,receiptId,inventoryId) VALUES(60,50,1); INSERT INTO inventory_lots(id,receiptId,receiptItemId,sourceType,issueUnit) VALUES(70,50,60,'receipt','piece'); INSERT INTO inventory_lot_balances VALUES(1,1,70);
      INSERT INTO users VALUES(21,'operator',1); UPDATE supplier_return_cases SET createdById=21;`);
    const ownActor = { id: 21, role: "operator" };
    expect((await listSupplierReturns(ownActor, {}, port)).items[0]).toMatchObject({ creatorId: 21, originalReceiptNumber: "RCV-50" });
    memory.exec("UPDATE warehouse_receipts SET status='draft'");
    expect((await listSupplierReturns(ownActor, {}, port)).total).toBe(0);
    memory.exec("UPDATE warehouse_receipts SET status='confirmed'; UPDATE inventory_lots SET receiptItemId=99");
    expect((await listSupplierReturns(ownActor, {}, port)).total).toBe(0);
  });
  it.each([
    "UPDATE warehouse_receipts SET purchaseOrderId=1",
    "UPDATE warehouse_receipt_items SET purchaseOrderItemId=1",
    "UPDATE inventory_lots SET issueUnit='carton'",
    "UPDATE warehouse_returns SET returnedQuantity=1",
    "UPDATE inventory_lots SET catalogItemId=1; UPDATE inventory SET linkedItemId=2",
    "DELETE FROM inventory_lot_balances",
  ])("denies standalone creator fallback after a conflicting source change: %s", async mutation => {
    seed(1, { standalone: true, creator: null });
    memory.exec(`INSERT INTO warehouse_receipts(id,status,receiptNumber) VALUES(50,'confirmed','RCV-50'); INSERT INTO warehouse_receipt_items(id,receiptId,inventoryId) VALUES(60,50,1); INSERT INTO inventory_lots(id,receiptId,receiptItemId,sourceType,issueUnit) VALUES(70,50,60,'receipt','piece'); INSERT INTO inventory_lot_balances VALUES(1,1,70); INSERT INTO users VALUES(21,'operator',1); UPDATE supplier_return_cases SET createdById=21;`);
    expect((await listSupplierReturns({ id: 21, role: "operator" }, {}, port)).total).toBe(1);
    memory.exec(mutation);
    expect((await listSupplierReturns({ id: 21, role: "operator" }, {}, port)).items).toEqual([]);
  });
  it("keeps a bounded four-query page independent of repeated original parents", async () => {
    for (let id = 1; id <= 1101; id++) seed(id);
    for (const pageSize of [1, 50]) {
      calls.length = 0;
      const result = await listSupplierReturns(actor, { page: 2, pageSize }, port);
      expect(result.items).toHaveLength(pageSize); expect(result.total).toBe(1101);
      expect(calls).toHaveLength(4);
      expect(calls[2].sql).toContain("c.closedAt IS NULL");
      expect(calls[3].sql).toContain("LIMIT ? OFFSET ?");
    }
    memory.exec("UPDATE purchase_order_items SET purchaseOrderId=999");
    expect((await listSupplierReturns(actor, {}, port)).items).toEqual([]);
  });
});

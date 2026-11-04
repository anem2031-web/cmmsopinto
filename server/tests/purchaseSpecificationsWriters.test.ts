import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { sql, and, eq, gte, notInArray } from "drizzle-orm";
import * as schema from "../../drizzle/schema";
import { captureDocumentSignature } from "../../shared/documentSignatureSnapshot";
import { calculateMovementTotal, normalizeInventoryQuantity, roundTo } from "../_core/inventory-costing";
import { createReceiptInventoryLot, consumeInventoryLotForIssue, moveInventoryLotBalanceForTransfer } from "../_core/inventory-lots";
import { assertSpecificationReceiptTracking } from "../services/purchase-specifications";
import { assertSpecificationPurchaseItemCompletion } from "../services/purchase-specification-guards";
import { specificationFixture, seedSpecificationReceipt, specificationPeople as people } from "./fixtures/purchaseSpecificationsSeed";

let f: ReturnType<typeof specificationFixture>;
beforeEach(() => { f = specificationFixture(); });
afterEach(() => f.close());

describe("Actual receipt lot writer registers the construction hold atomically", () => {
  async function create(source: ReturnType<typeof seedSpecificationReceipt>, issueQuantity = 6) {
    return f.db.transaction((tx: any) => createReceiptInventoryLot({ tx, inventoryId: source.inventoryId,
      receiptId: source.receiptId, receiptItemId: source.receiptItemId, purchaseOrderId: source.orderId,
      purchaseOrderItemId: source.itemId, catalogItemId: 9000, issueQuantity, purchaseUnit: "كرتون",
      issueUnit: "قطعة", conversionFactor: 6, purchaseUnitCost: 75, issueUnitCost: 12.5, createdById: 32 }));
  }
  it("persists the pending status in the same lot/balance/source transaction and leaves an older lot untouched", async () => {
    const source = seedSpecificationReceipt(f, { status: null });
    const old = f.get("inventory_lots", 1);
    const saved = await create(source);
    expect(saved.lotId).toBe(2);
    expect(f.get("inventory_lots", 2)).toMatchObject({ specificationStatus: "pending", specificationRevision: 0, receiptId: source.receiptId, receiptItemId: source.receiptItemId, purchaseOrderId: source.orderId, purchaseOrderItemId: source.itemId, originalQuantity: 6, remainingQuantity: 6, issueUnitCost: 12.5, conversionFactor: 6 });
    expect(f.memory.prepare("SELECT * FROM inventory_lot_balances WHERE lotId=2").get()).toMatchObject({ lotId: 2, inventoryId: source.inventoryId, quantity: 6 });
    expect(f.get("inventory_lots", 1)).toEqual(old);
    const registrationQuery = f.queries.findIndex(row => /SELECT id,purchaseOrderId,reviewRole/.test(row.sql));
    const lotInsert = f.queries.findIndex(row => /INSERT INTO `inventory_lots`/.test(row.sql));
    expect(registrationQuery).toBeGreaterThanOrEqual(0);
    expect(registrationQuery).toBeLessThan(lotInsert);
  });
  it("keeps ordinary-route new receipts without a specification hold", async () => {
    const source = seedSpecificationReceipt(f, { status: null, reviewRole: "general_maintenance_manager" });
    const saved = await create(source);
    expect(f.get("inventory_lots", saved.lotId)).toMatchObject({ specificationStatus: null, remainingQuantity: 6 });
  });
  it("rolls back the new lot and lot counter when its balance insert fails", async () => {
    const source = seedSpecificationReceipt(f, { status: null });
    const before = f.memory.prepare("SELECT * FROM inventory_lots").all();
    f.memory.exec("CREATE TRIGGER fail_balance BEFORE INSERT ON inventory_lot_balances BEGIN SELECT RAISE(ABORT,'balance failure'); END");
    await expect(create(source)).rejects.toThrow("balance failure");
    expect(f.memory.prepare("SELECT * FROM inventory_lots").all()).toEqual(before);
    expect(f.memory.prepare("SELECT * FROM inventory_lot_number_counter").all()).toEqual([]);
  });
  it("rejects an unconfirmed source before allocating any lot identity", async () => {
    const source = seedSpecificationReceipt(f, { status: null, receiptStatus: "draft" });
    await expect(create(source)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(f.memory.prepare("SELECT * FROM inventory_lots").all()).toHaveLength(1);
    expect(f.memory.prepare("SELECT * FROM inventory_lot_number_counter").all()).toEqual([]);
  });
  it("blocks the construction receipt if physical lot tracking is disabled but leaves ordinary receipts unchanged", async () => {
    seedSpecificationReceipt(f, { id: 1, reviewRole: "general_maintenance_manager" });
    seedSpecificationReceipt(f, { id: 2 });
    await expect(assertSpecificationReceiptTracking(f.db, [1001], false)).resolves.toBeUndefined();
    await expect(assertSpecificationReceiptTracking(f.db, [1001, 1002], false)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    f.queries.length = 0;
    await expect(assertSpecificationReceiptTracking(f.db, [1001, 1002], true)).resolves.toBeUndefined();
    await expect(assertSpecificationReceiptTracking(f.db, [], false)).resolves.toBeUndefined();
    expect(f.queries).toEqual([]);
  });
});

describe("Actual physical movement writer enforces the current specification decision", () => {
  const issue = (id = 1, kind: "issue" | "supplier_return" | "disposal" = "issue", quantity = 2) => f.db.transaction((tx: any) => consumeInventoryLotForIssue({ tx, trackingToken: `LOT-${id}`, inventoryId: 2000 + id, inventoryCatalogItemId: 9000, quantity, specificationMovementKind: kind }));
  function transfer(id = 1) {
    return f.db.transaction((tx: any) => moveInventoryLotBalanceForTransfer({ tx, trackingToken: `LOT-${id}`, fromWarehouseId: 1, fromInventoryId: 2000 + id, toInventoryId: 9999, toInventoryCatalogItemId: 9000, quantity: 2 }));
  }
  it("holds the received construction lot while allowing an older lot in the same catalogue book", async () => {
    seedSpecificationReceipt(f); seedSpecificationReceipt(f, { id: 2, status: null });
    await expect(issue()).rejects.toThrow(/مطابقة المواصفات/);
    expect((await issue(2)).balanceQuantity).toBe(4);
    expect(f.get("inventory_lots", 1).remainingQuantity).toBe(6);
    expect(f.get("inventory_lots", 2).remainingQuantity).toBe(4);
  });
  it("allows issue only after the real manager decision and keeps source links unchanged", async () => {
    seedSpecificationReceipt(f);
    await expect(issue()).rejects.toThrow(/مطابقة المواصفات/);
    await f.service.decide(people.construction, { id: 1, revision: 0, decision: "approved" });
    expect(await issue()).toMatchObject({ lotId: 1, balanceQuantity: 4, remainingQuantity: 4, receiptId: 3001, purchaseOrderId: 10, purchaseOrderItemId: 1001 });
  });
  it.each(["pending", "rejected"])("prevents transfer of the %s lot before either balance changes", async status => {
    seedSpecificationReceipt(f, { status });
    const before = f.snapshot();
    await expect(transfer()).rejects.toThrow(/مطابقة المواصفات/);
    expect(f.snapshot()).toEqual(before);
    expect(f.get("inventory_lots", 1).remainingQuantity).toBe(6);
  });
  it("keeps the approved transfer's physical lot and global remaining quantity intact", async () => {
    seedSpecificationReceipt(f, { status: "approved" });
    f.insert("inventory", { id: 9999, warehouseId: 2, linkedItemId: 9000, quantity: 0, unit: "قطعة" });
    expect(await transfer()).toMatchObject({ lotId: 1, balanceQuantity: 4 });
    expect(f.memory.prepare("SELECT inventoryId,quantity FROM inventory_lot_balances WHERE lotId=1 ORDER BY inventoryId").all()).toEqual([{ inventoryId: 2001, quantity: 4 }, { inventoryId: 9999, quantity: 2 }]);
    expect(f.get("inventory_lots", 1).remainingQuantity).toBe(6);
  });
  it.each(["issue", "disposal"] as const)("prevents rejected stock leaving through %s", async kind => {
    seedSpecificationReceipt(f, { status: "rejected" });
    await expect(issue(1, kind)).rejects.toThrow(/إرجاعها للمورد فقط/);
    expect(f.get("inventory_lots", 1).remainingQuantity).toBe(6);
  });
  it("lets the native supplier-return physical writer consume only the rejected lot, then removes its exhausted queue entry", async () => {
    seedSpecificationReceipt(f); seedSpecificationReceipt(f, { id: 2, status: null });
    await f.service.decide(people.construction, { id: 1, revision: 0, decision: "rejected" });
    expect((await f.service.rejectedReturns(people.warehouse, {})).rows).toHaveLength(1);
    expect(await issue(1, "supplier_return", 6)).toMatchObject({ balanceQuantity: 0, remainingQuantity: 0 });
    expect((await f.service.rejectedReturns(people.warehouse, {})).rows).toEqual([]);
    expect(f.get("inventory_lots", 2).remainingQuantity).toBe(6);
  });
});

describe("Existing PO delivery writer cannot complete a held receipt using an unrelated old lot", () => {
  // Execute the existing production function with disposable persistence. Its
  // outer module owns live DB setup; none of that module is imported here.
  const ast = ts.createSourceFile("delivery.ts", readFileSync("server/_core/db/warehouse-returns.ts", "utf8"), ts.ScriptTarget.Latest, true);
  const node = ast.statements.find(value => ts.isFunctionDeclaration(value) && value.name?.text === "issueDelivery");
  if (!node) throw Error("Canonical delivery writer missing");
  const code = ts.transpileModule(`(${node.getText(ast).replace(/^export /, "")})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const delivery = (poItemId = 1001, markDelivered = true) => {
    const actual = vm.runInNewContext(code, {
      ...schema, sql, and, eq, gte, notInArray, captureDocumentSignature,
      calculateMovementTotal, normalizeInventoryQuantity, roundTo,
      getDb: async () => f.db, isInventoryLotsEnabled: () => true, materialExecutionCostsEnabled: () => false,
      getUserById: async (id: number) => f.get("users", id),
      getPOItemById: async (id: number) => f.get("purchase_order_items", id),
      getPurchaseOrderById: async (id: number) => f.get("purchase_orders", id),
      getInventoryItemById: async (id: number) => f.get("inventory", id),
      assertSpecificationPurchaseItemCompletion,
      assertOperationalIssueReference: async () => null,
      consumeInventoryLotForIssue,
      normalizeIssueCostAllocations: async () => [],
      getNextDeliveryNumber: async () => "DLV-SPEC-1",
      getPOItems: async (id: number) => f.memory.prepare("SELECT * FROM purchase_order_items WHERE purchaseOrderId=?").all(id),
      updatePurchaseOrder: async (id: number, data: any) => f.memory.prepare("UPDATE purchase_orders SET status=? WHERE id=?").run(data.status, id),
      createDeliveryDocument: async () => ({ insertId: 1 }),
    });
    return actual({ inventoryId: 2002, quantity: 2, unit: "قطعة", performedById: 32,
      purchaseOrderItemId: poItemId, markPurchaseOrderItemDelivered: markDelivered, lotTrackingToken: "LOT-2" });
  };
  beforeEach(() => { seedSpecificationReceipt(f); seedSpecificationReceipt(f, { id: 2, status: null }); });
  it.each(["pending", "rejected"])("blocks a %s PO completion before the chosen old lot or any stock is consumed", async status => {
    f.memory.prepare("UPDATE inventory_lots SET specificationStatus=? WHERE id=1").run(status);
    const before = f.snapshot();
    await expect(delivery()).rejects.toThrow(/مطابقة المواصفات/);
    expect(f.snapshot()).toEqual(before);
    expect(f.get("inventory_lots", 2).remainingQuantity).toBe(6);
  });
  it("allows the unrelated old PO item to complete without inheriting another received item's hold", async () => {
    await expect(delivery(1002)).resolves.toMatchObject({ lotId: 2, quantity: 2, deliveryDocumentId: 1 });
    expect(f.get("purchase_order_items", 1002).status).toBe("delivered_to_requester");
    expect(f.get("purchase_order_items", 1001).status).toBe("received");
    expect(f.get("inventory_lots", 1).remainingQuantity).toBe(6);
  });
  it("preserves ordinary old-stock issues that do not mark the linked purchase item complete", async () => {
    await expect(delivery(1001, false)).resolves.toMatchObject({ lotId: 2, quantity: 2 });
    expect(f.get("purchase_order_items", 1001).status).toBe("received");
    expect(f.get("inventory_lots", 1).remainingQuantity).toBe(6);
  });
  it("freshly permits completion after the actual specification approval", async () => {
    await expect(delivery()).rejects.toThrow(/مطابقة المواصفات/);
    await f.service.decide(people.construction, { id: 1, revision: 0, decision: "approved" });
    await expect(delivery()).resolves.toMatchObject({ lotId: 2, quantity: 2 });
    expect(f.get("purchase_order_items", 1001).status).toBe("delivered_to_requester");
  });
});

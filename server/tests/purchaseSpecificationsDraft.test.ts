import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { purchaseSpecificationsDatabase } from "./fixtures/purchaseSpecificationsDatabase";

const fixture = vi.hoisted(() => ({ db: null as any, memory: null as any, lotsEnabled: true }));
vi.mock("../_core/db/client", () => ({ getDb: async () => fixture.db }));
vi.mock("../_core/env", () => ({ ENV: {} }));
vi.mock("../_core/db/deletes", () => ({
  getInventoryItemById: async (id: number) => fixture.memory.prepare("SELECT * FROM inventory WHERE id=?").get(id),
  getUserById: vi.fn(),
}));
vi.mock("../_core/db/warehouse-receipts", () => ({ getNextInventoryCode: vi.fn(() => { throw Error("Unexpected new inventory row"); }), getNextItemBarcode: vi.fn() }));
vi.mock("../_core/db/warehouse-returns", () => ({ createInventoryItemV2: vi.fn() }));
vi.mock("../_core/db/inventory", () => ({ getInventoryMatchesByCatalogItemAndWarehouse: vi.fn() }));
vi.mock("../_core/inventory-lots", async importOriginal => ({
  ...await importOriginal<typeof import("../_core/inventory-lots")>(),
  isInventoryLotsEnabled: () => fixture.lotsEnabled,
}));

import { processApprovedReceiptItems } from "../_core/db/invoice-drafts";

let f: ReturnType<typeof purchaseSpecificationsDatabase>;
const get = (table: string, id = 1) => f.memory.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id) as any;
const all = (table: string) => f.memory.prepare(`SELECT * FROM ${table} ORDER BY id`).all();
function snapshot() { return ["warehouse_receipts", "warehouse_receipt_items", "inventory", "purchase_order_items", "inventory_lots", "inventory_lot_balances", "inventory_transactions"].map(table => [table, all(table)]); }

beforeEach(() => {
  f = purchaseSpecificationsDatabase(); fixture.db = f.db; fixture.memory = f.memory; fixture.lotsEnabled = true;
  // Only disposable in-memory fixture schema is extended for the legacy writer.
  f.memory.exec(`
    ALTER TABLE warehouse_receipts ADD COLUMN isDraft INTEGER;
    ALTER TABLE inventory ADD COLUMN lastRestockedAt TEXT;
    ALTER TABLE purchase_order_items ADD COLUMN receivedAt TEXT;
    ALTER TABLE purchase_order_items ADD COLUMN receivedById INTEGER;
  `);
  f.insert("purchase_orders", { id: 1, poNumber: "PR-DRAFT-1", status: "purchased", requestedById: 9 });
  f.insert("purchase_order_items", { id: 1, purchaseOrderId: 1, itemName: "مواد الإنشاءات", quantity: 3, unit: "قطعة", status: "purchased", reviewRole: "construction_procurement_manager", catalogItemId: 7 });
  f.insert("warehouse_receipts", { id: 1, receiptNumber: "REC-DRAFT-1", purchaseOrderId: 1, status: "approved", isDraft: 0, vendorName: "مورد تجريبي" });
  f.insert("warehouse_receipt_items", { id: 1, receiptId: 1, purchaseOrderItemId: 1, inventoryId: 1, itemName: "مواد الإنشاءات", receivedQuantity: 3, purchaseUnit: "قطعة", unitCost: "7.0000", catalogItemId: 7 });
  f.insert("warehouses", { id: 1, nameAr: "الرئيسي", type: "main", isActive: 1 });
  f.insert("inventory", { id: 1, warehouseId: 1, linkedItemId: 7, itemName: "مواد الإنشاءات", quantity: 10, unit: "قطعة", issueUnit: "قطعة", averageCost: 5, totalCostValue: 50 });
});
afterEach(() => { fixture.db = null; fixture.memory = null; f.close(); });

describe("Real legacy approved invoice receipt registers construction inspection atomically", () => {
  it("confirms the source before the real lot writer and commits a pending construction lot", async () => {
    const saved = await processApprovedReceiptItems(1, 32);
    expect(saved?.inventoryLotsEnabled).toBe(true); expect(saved?.lotLabels).toHaveLength(1);
    expect(get("warehouse_receipts")).toMatchObject({ status: "confirmed", isDraft: 0 });
    expect(get("inventory")).toMatchObject({ quantity: 13, totalCostValue: 71 });
    expect(get("purchase_order_items")).toMatchObject({ status: "delivered_to_warehouse", receivedById: 32 });
    expect(get("inventory_lots")).toMatchObject({ specificationStatus: "pending", specificationRevision: 0, receiptId: 1, receiptItemId: 1, purchaseOrderId: 1, purchaseOrderItemId: 1, originalQuantity: 3, remainingQuantity: 3 });
    expect(get("inventory_lot_balances")).toMatchObject({ inventoryId: 1, lotId: 1, quantity: 3 });
    expect(all("inventory_transactions")).toHaveLength(1);
    const confirmation = f.queries.findIndex(query => /UPDATE `warehouse_receipts`/.test(query.sql) && query.params.includes("confirmed"));
    const sourceCheck = f.queries.findIndex(query => /SELECT ri.id,ri.purchaseOrderItemId/.test(query.sql));
    expect(confirmation).toBeGreaterThanOrEqual(0); expect(confirmation).toBeLessThan(sourceCheck);
  });
  it("rolls back confirmed header, stock, lot and counter if the real lot balance insert fails", async () => {
    const before = snapshot();
    f.memory.exec("CREATE TRIGGER fail_draft_lot_balance BEFORE INSERT ON inventory_lot_balances BEGIN SELECT RAISE(ABORT,'draft balance failure'); END");
    await expect(processApprovedReceiptItems(1, 32)).rejects.toThrow("draft balance failure");
    expect(snapshot()).toEqual(before);
    expect(get("warehouse_receipts").status).toBe("approved");
    expect(f.memory.prepare("SELECT * FROM inventory_lot_number_counter").all()).toEqual([]);
  });
  it("rejects construction with lot tracking disabled before any write", async () => {
    fixture.lotsEnabled = false; const before = snapshot();
    await expect(processApprovedReceiptItems(1, 32)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(snapshot()).toEqual(before);
    expect(f.queries.filter(query => /^\s*(UPDATE|INSERT|DELETE)/i.test(query.sql))).toEqual([]);
  });
  it("preserves ordinary-route processing without creating a construction hold", async () => {
    f.memory.exec("UPDATE purchase_order_items SET reviewRole='general_maintenance_manager' WHERE id=1");
    const saved = await processApprovedReceiptItems(1, 32);
    expect(saved?.lotLabels).toHaveLength(1); expect(get("inventory_lots").specificationStatus).toBeNull();
    expect(get("warehouse_receipts").status).toBe("confirmed"); expect(get("inventory").quantity).toBe(13);
  });
});

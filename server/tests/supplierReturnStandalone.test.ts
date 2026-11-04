import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { purchaseSpecificationsDatabase } from "./fixtures/purchaseSpecificationsDatabase";

vi.mock("../supplier-return-followup/runtime", async importOriginal => {
  const actual = await importOriginal<typeof import("../supplier-return-followup/runtime")>();
  return { ...actual, trialEnabled: async () => true };
});
import { prepareReplacementPurchase, linkReplacementPurchase } from "../supplier-return-followup/purchase-bridge";
import { runTrialCreatorCancellation, runTrialCreatorReplacement } from "../supplier-return-followup/creator-choice";
import { executeFollowupCommand } from "../supplier-return-followup/commands";
import { verifyStandaloneReturnSource } from "../supplier-return-followup/standalone-source";

let f: ReturnType<typeof purchaseSpecificationsDatabase>;
const warehouse = { id: 5, role: "warehouse", isActive: 1 };
const delegate = { id: 6, role: "delegate", isActive: 1 };
const input = () => ({ ticketId: null, ticketItemId: null, context: { siteId: 1, sectionId: 2, categoryId: 3, assetId: null },
  items: [{ catalogItemId: 44, itemName: "Standalone item", quantity: 2, unit: "قطعة", siteId: 1, sectionId: 2, categoryId: 3 }] });
const get = (table: string, id: number) => f.memory.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id) as any;
const port = () => ({ transaction: (work: any) => f.db.transaction(work) });

beforeEach(() => {
  f = purchaseSpecificationsDatabase();
  f.memory.exec(`
    ALTER TABLE purchase_orders ADD COLUMN categoryId INTEGER;
    ALTER TABLE purchase_orders ADD COLUMN assetId INTEGER;
    ALTER TABLE purchase_order_items ADD COLUMN siteId INTEGER;
    ALTER TABLE purchase_order_items ADD COLUMN sectionId INTEGER;
    ALTER TABLE purchase_order_items ADD COLUMN categoryId INTEGER;
    ALTER TABLE purchase_order_items ADD COLUMN assetId INTEGER;
    ALTER TABLE warehouse_returns ADD COLUMN inventoryId INTEGER;
    ALTER TABLE warehouse_returns ADD COLUMN purchaseOrderId INTEGER;
    ALTER TABLE warehouse_returns ADD COLUMN purchaseOrderItemId INTEGER;
    ALTER TABLE warehouse_returns ADD COLUMN sourceDeliveryDocumentId INTEGER;
    CREATE TABLE supplier_return_cases(id INTEGER PRIMARY KEY,returnId INTEGER,delegateId INTEGER,creatorId INTEGER,createdById INTEGER,parentReplacementPlanId INTEGER,
      purchaseOrderId INTEGER,purchaseOrderItemId INTEGER,receiptId INTEGER,receiptItemId INTEGER,lotId INTEGER,inventoryId INTEGER,
      returnedQuantity NUMERIC,returnedUnit TEXT,handoverStatus TEXT,rejectionReason TEXT,resolution TEXT,creatorDecision TEXT,
      revision INTEGER,closedAt TEXT,originalPurchaseValue NUMERIC,currency TEXT,valuationBasis TEXT,
      handoverDecidedById INTEGER,handoverDecidedAt TEXT,resolutionDecidedById INTEGER,resolutionDecidedAt TEXT);
    CREATE TABLE supplier_return_replacement_plans(id INTEGER PRIMARY KEY,caseId INTEGER,planNumber INTEGER,status TEXT,
      purchaseOrderId INTEGER,purchaseOrderItemId INTEGER,supplierCreditId INTEGER,revision INTEGER DEFAULT 0,
      catalogItemId INTEGER,itemName TEXT,replacementQuantity NUMERIC,replacementUnit TEXT,originalQuantityCovered NUMERIC,
      selectedById INTEGER,createdById INTEGER);
    CREATE TABLE supplier_return_settlements(id INTEGER PRIMARY KEY,caseId INTEGER,operationKey TEXT,type TEXT,status TEXT,
      amount NUMERIC,currency TEXT,valuationBasis TEXT,sourceCreditId INTEGER,referenceNumber TEXT,notes TEXT,
      createdById INTEGER,completedById INTEGER,completedAt TEXT);
    CREATE TABLE supplier_return_events(id INTEGER PRIMARY KEY,caseId INTEGER,actorId INTEGER,action TEXT,operationKey TEXT,
      requestHash TEXT,fromRevision INTEGER,toRevision INTEGER,beforeState TEXT,afterState TEXT,reason TEXT,result TEXT);
    CREATE TABLE notifications(id INTEGER PRIMARY KEY,userId INTEGER,title TEXT,message TEXT,type TEXT);
    CREATE TABLE catalog_items(id INTEGER PRIMARY KEY,nameAr TEXT,unit TEXT,isActive INTEGER);
  `);
  for (const actor of [warehouse, delegate, { id: 7, role: "warehouse", isActive: 1 }, { id: 8, role: "owner", isActive: 1 }, { id: 9, role: "admin", isActive: 1 }]) f.insert("users", actor);
  f.insert("warehouses", { id: 1, nameAr: "Main", type: "main", isActive: 1 });
  f.insert("inventory", { id: 20, warehouseId: 1, linkedItemId: 44, itemName: "Standalone item", unit: "قطعة", issueUnit: "قطعة", quantity: 8, averageCost: 50, totalCostValue: 400 });
  f.insert("warehouse_receipts", { id: 10, purchaseOrderId: null, status: "confirmed", receiptNumber: "RCV-STANDALONE" });
  f.insert("warehouse_receipt_items", { id: 11, receiptId: 10, inventoryId: 20, purchaseOrderItemId: null, catalogItemId: 44, receivedQuantity: 10, purchaseUnit: "قطعة" });
  f.insert("inventory_lots", { id: 30, sourceType: "receipt", receiptId: 10, receiptItemId: 11, purchaseOrderId: null, purchaseOrderItemId: null, catalogItemId: 44, issueUnit: "قطعة", originalQuantity: 10, remainingQuantity: 8 });
  f.insert("inventory_lot_balances", { id: 31, inventoryId: 20, lotId: 30, quantity: 8 });
  f.insert("warehouse_returns", { id: 40, lotId: 30, inventoryId: 20, receiptId: 10, purchaseOrderId: null, purchaseOrderItemId: null, returnedQuantity: 2, returnNumber: "RTN-STANDALONE" });
  f.insert("supplier_return_cases", { id: 7, returnId: 40, delegateId: 6, creatorId: 5, createdById: 5, purchaseOrderId: null, purchaseOrderItemId: null,
    receiptId: 10, receiptItemId: 11, lotId: 30, inventoryId: 20, returnedQuantity: 2, returnedUnit: "قطعة", revision: 1,
    handoverStatus: "accepted", resolution: "same_item", creatorDecision: null, originalPurchaseValue: 100, currency: "SAR", valuationBasis: "tax_inclusive" });
  f.insert("supplier_return_replacement_plans", { id: 70, caseId: 7, planNumber: 1, status: "pending_review", catalogItemId: 44, itemName: "Standalone item", replacementQuantity: 2, replacementUnit: "قطعة", originalQuantityCovered: 2, selectedById: 6, createdById: 6 });
  f.insert("supplier_return_settlements", { id: 80, caseId: 7, operationKey: "handover-credit:7", type: "supplier_credit", status: "completed", amount: 100, currency: "SAR", valuationBasis: "tax_inclusive" });
  f.insert("catalog_items", { id: 44, nameAr: "Standalone item", unit: "قطعة", isActive: 1 });
  f.insert("catalog_items", { id: 55, nameAr: "Different replacement", unit: "علبة", isActive: 1 });
});
afterEach(() => f.close());

describe("Standalone return prepares a normal replacement purchase without an invented original PO", () => {
  it.each([5, 8, 9])("allows responsible warehouse/owner/admin actor %s and links only the new item", async id => {
    const actor = get("users", id);
    const before = get("inventory", 20);
    const prepared = await f.db.transaction((tx: any) => prepareReplacementPurchase(tx, actor, 70, input()));
    expect(prepared).toMatchObject({ planId: 70, caseId: 7, originalOrderId: null, sourceReceiptId: 10, sourceReturnId: 40, creditId: 80 });
    await f.db.transaction((tx: any) => linkReplacementPurchase(tx, prepared, 200, 201));
    expect(get("supplier_return_replacement_plans", 70)).toMatchObject({ purchaseOrderId: 200, purchaseOrderItemId: 201, supplierCreditId: 80 });
    expect(get("supplier_return_cases", 7)).toMatchObject({ purchaseOrderId: null, purchaseOrderItemId: null });
    expect(get("inventory", 20)).toEqual(before);
  });
  it("supports a verified historical NULL creator without writing a backfill", async () => {
    f.memory.exec("UPDATE supplier_return_cases SET creatorId=NULL WHERE id=7");
    expect(await prepareReplacementPurchase(f.db, warehouse, 70, input())).toMatchObject({ originalOrderId: null });
    expect(get("supplier_return_cases", 7).creatorId).toBeNull();
  });
  it("denies a different warehouse requester, an inactive actor and a changed role", async () => {
    await expect(prepareReplacementPurchase(f.db, get("users", 7), 70, input())).rejects.toMatchObject({ code: "FORBIDDEN" });
    f.memory.exec("UPDATE users SET isActive=0 WHERE id=5");
    await expect(prepareReplacementPurchase(f.db, warehouse, 70, input())).rejects.toMatchObject({ code: "FORBIDDEN" });
    f.memory.exec("UPDATE users SET isActive=1,role='delegate' WHERE id=5");
    await expect(prepareReplacementPurchase(f.db, warehouse, 70, input())).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("cannot attach a different ticket or change the approved replacement", async () => {
    await expect(prepareReplacementPurchase(f.db, warehouse, 70, { ...input(), ticketId: 999 })).rejects.toThrow("سياق");
    const wrong = input(); wrong.items[0].catalogItemId = 55;
    await expect(prepareReplacementPurchase(f.db, warehouse, 70, wrong)).rejects.toThrow("صنف الطلب");
  });
  it.each(["purchaseOrderId=999", "purchaseOrderItemId=999", "purchaseOrderId=999,purchaseOrderItemId=998"])("does not reinterpret an incomplete original PO source as standalone: %s", async refs => {
    f.memory.exec(`UPDATE supplier_return_cases SET ${refs} WHERE id=7`);
    await expect(prepareReplacementPurchase(f.db, warehouse, 70, input())).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("preserves the original PO path and denies it when the actual source item disappears", async () => {
    f.insert("purchase_orders", { id: 100, poNumber: "PR-ORIGINAL", requestedById: 5, siteId: 1, sectionId: 2, categoryId: 3 });
    f.insert("purchase_order_items", { id: 101, purchaseOrderId: 100, itemName: "Standalone item", quantity: 10, unit: "قطعة", siteId: 1, sectionId: 2, categoryId: 3 });
    f.memory.exec("UPDATE supplier_return_cases SET purchaseOrderId=100,purchaseOrderItemId=101 WHERE id=7; UPDATE warehouse_returns SET purchaseOrderId=100,purchaseOrderItemId=101 WHERE id=40");
    expect(await prepareReplacementPurchase(f.db, warehouse, 70, input())).toMatchObject({ originalOrderId: 100, sourceReceiptId: null });
    f.memory.exec("DELETE FROM purchase_order_items WHERE id=101");
    await expect(prepareReplacementPurchase(f.db, warehouse, 70, input())).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it.each([
    "UPDATE supplier_return_cases SET receiptId=99 WHERE id=7",
    "UPDATE supplier_return_cases SET receiptItemId=99 WHERE id=7",
    "UPDATE supplier_return_cases SET lotId=99 WHERE id=7",
    "UPDATE supplier_return_cases SET creatorId=7 WHERE id=7",
    "UPDATE warehouse_returns SET sourceDeliveryDocumentId=1 WHERE id=40",
    "UPDATE warehouse_receipt_items SET receiptId=99 WHERE id=11",
    "UPDATE warehouse_receipts SET status='draft' WHERE id=10",
    "UPDATE warehouse_receipts SET purchaseOrderId=99 WHERE id=10",
    "UPDATE inventory_lots SET purchaseOrderId=99 WHERE id=30",
    "UPDATE inventory SET linkedItemId=55 WHERE id=20",
    "DELETE FROM warehouse_receipts WHERE id=10",
    "DELETE FROM inventory_lot_balances WHERE lotId=30",
  ])("denies missing or inconsistent source before creating a purchase: %s", async change => {
    f.memory.exec(change);
    await expect(prepareReplacementPurchase(f.db, warehouse, 70, input())).rejects.toMatchObject({ code: "CONFLICT" });
    expect(get("supplier_return_replacement_plans", 70).purchaseOrderId).toBeNull();
  });
});

describe("Standalone creator decisions keep the existing guarded refund/replacement flow", () => {
  it("allows only the assigned active delegate manager to resolve its existing return",async()=>{
    f.memory.exec("UPDATE users SET role='delegate_manager' WHERE id=6; DELETE FROM supplier_return_replacement_plans; UPDATE supplier_return_cases SET resolution=NULL,creatorDecision=NULL WHERE id=7");
    const manager={...delegate,role:"delegate_manager"};
    await expect(executeFollowupCommand(port(),{...manager,id:7},{caseId:7,expectedRevision:1,action:"resolve",resolution:"change_item",operationKey:"manager-return-other-001"})).rejects.toMatchObject({code:"FORBIDDEN"});
    expect(await executeFollowupCommand(port(),manager,{caseId:7,expectedRevision:1,action:"resolve",resolution:"change_item",operationKey:"manager-return-own-001"})).toMatchObject({resolution:"change_item"});
    f.memory.exec("UPDATE users SET isActive=0 WHERE id=6");
    await expect(executeFollowupCommand(port(),manager,{caseId:7,expectedRevision:1,action:"resolve",resolution:"change_item",operationKey:"manager-return-own-001"})).rejects.toMatchObject({code:"FORBIDDEN"});
  });
  const choice = { caseId: 7, expectedRevision: 1, catalogItemId: 55, quantity: 3, operationKey: "standalone-replace-001" };
  function readyForChoice() { f.memory.exec("DELETE FROM supplier_return_replacement_plans; UPDATE supplier_return_cases SET resolution='change_item',creatorDecision='pending',creatorId=NULL WHERE id=7"); }
  it("lets the verified warehouse creator select a different item and replays without another plan", async () => {
    readyForChoice(); const before = get("inventory", 20);
    const result = await runTrialCreatorReplacement(warehouse, choice, port());
    expect(result).toMatchObject({ caseId: 7, revision: 2 });
    expect(get("supplier_return_replacement_plans", result.planId)).toMatchObject({ catalogItemId: 55, replacementQuantity: 3, originalQuantityCovered: 2 });
    expect(await runTrialCreatorReplacement(warehouse, choice, port())).toEqual(result);
    expect(f.memory.prepare("SELECT COUNT(*) AS total FROM supplier_return_replacement_plans").get()).toMatchObject({ total: 1 });
    expect(get("inventory", 20)).toEqual(before);
  });
  it("denies another creator and preserves the active status check on replay", async () => {
    readyForChoice();
    await expect(runTrialCreatorReplacement(get("users", 7), choice, port())).rejects.toMatchObject({ code: "FORBIDDEN" });
    await runTrialCreatorReplacement(warehouse, choice, port()); f.memory.exec("UPDATE users SET isActive=0 WHERE id=5");
    await expect(runTrialCreatorReplacement(warehouse, choice, port())).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("rolls the new plan and decision back when the event fails", async () => {
    readyForChoice(); f.memory.exec("CREATE TRIGGER fail_event BEFORE INSERT ON supplier_return_events BEGIN SELECT RAISE(ABORT,'event failure'); END");
    await expect(runTrialCreatorReplacement(warehouse, choice, port())).rejects.toThrow("event failure");
    expect(get("supplier_return_cases", 7)).toMatchObject({ creatorDecision: "pending", revision: 1 });
    expect(f.memory.prepare("SELECT COUNT(*) AS total FROM supplier_return_replacement_plans").get()).toMatchObject({ total: 0 });
  });
  it("allows cancellation only after a confirmed refund and leaves the historical receipt/stock intact", async () => {
    readyForChoice(); f.memory.exec("UPDATE supplier_return_cases SET resolution='refund' WHERE id=7");
    const cancel = { caseId: 7, expectedRevision: 1, operationKey: "standalone-cancel-001" };
    await expect(runTrialCreatorCancellation(warehouse, cancel, port())).rejects.toThrow("لم يؤكد");
    f.insert("supplier_return_settlements", { id: 81, caseId: 7, operationKey: "cash-refund:7", type: "cash_refund", status: "completed", amount: 100, currency: "SAR", valuationBasis: "tax_inclusive", sourceCreditId: 80 });
    const before = get("inventory", 20);
    expect(await runTrialCreatorCancellation(warehouse, cancel, port())).toMatchObject({ decision: "cancel", revision: 2 });
    expect(get("supplier_return_cases", 7).closedAt).toBeTruthy();
    expect(get("warehouse_receipts", 10).status).toBe("confirmed");
    expect(get("inventory", 20)).toEqual(before);
  });
  it("lets the assigned delegate choose change/refund with a verified historical warehouse creator", async () => {
    readyForChoice(); f.memory.exec("UPDATE supplier_return_cases SET resolution=NULL,creatorDecision=NULL WHERE id=7");
    const result = await executeFollowupCommand(port(), delegate, { caseId: 7, expectedRevision: 1, action: "resolve", resolution: "change_item", operationKey: "standalone-resolve-001" });
    expect(result.resolution).toBe("change_item");
    expect(get("supplier_return_cases", 7).creatorDecision).toBe("pending");
    expect(get("supplier_return_cases", 7).creatorId).toBeNull();
    expect(f.memory.prepare("SELECT userId FROM notifications").all()).toEqual([{ userId: 5 }]);
  });
  it("verifies source integrity again on an already successful decision", async () => {
    readyForChoice(); await runTrialCreatorReplacement(warehouse, choice, port());
    f.memory.exec("DELETE FROM warehouse_receipt_items WHERE id=11");
    await expect(runTrialCreatorReplacement(warehouse, choice, port())).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

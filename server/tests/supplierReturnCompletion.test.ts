import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { linkReplacementReceipt } from "../supplier-return-followup/receipt-bridge";
import { loadReplacementFulfillments } from "../supplier-return-followup/fulfillment";
import { purchaseSpecificationsDatabase } from "./fixtures/purchaseSpecificationsDatabase";

let f: ReturnType<typeof purchaseSpecificationsDatabase>;
const input = { purchaseOrderId: 50, purchaseOrderItemId: 70, receiptId: 60, receiptItemId: 61,
  lotId: 62, quantityInOrderUnits: "2.000", orderUnit: "قطعة" };
const tableRows = (name: string) => f.memory.prepare(`SELECT * FROM ${name} ORDER BY id`).all();
const snapshot = () => Object.fromEntries(["supplier_return_cases", "supplier_return_replacement_plans", "supplier_return_settlements",
  "supplier_return_replacement_links", "supplier_return_events", "audit_logs", "inventory_lots", "inventory", "warehouse_receipts", "warehouse_receipt_items"]
  .map(table => [table, tableRows(table)]));
const save = (data = input) => f.db.transaction((tx: any) => linkReplacementReceipt(tx, 8, data));

beforeEach(() => {
  f = purchaseSpecificationsDatabase();
  f.memory.function("DATABASE", () => "copycmms2");
  f.memory.exec(`
    ALTER TABLE warehouse_returns ADD COLUMN sourceDeliveryDocumentId INTEGER;
    CREATE TABLE supplier_return_cases(id INTEGER PRIMARY KEY,purchaseOrderId INTEGER,purchaseOrderItemId INTEGER,parentReplacementPlanId INTEGER,lotId INTEGER,receiptId INTEGER,receiptItemId INTEGER,returnedUnit TEXT,handoverStatus TEXT,revision INTEGER,closedAt TEXT,creatorDecision TEXT);
    CREATE TABLE supplier_return_replacement_plans(id INTEGER PRIMARY KEY,caseId INTEGER,status TEXT,purchaseOrderId INTEGER,purchaseOrderItemId INTEGER,
      replacementQuantity NUMERIC,replacementUnit TEXT,originalQuantityCovered NUMERIC,creditAllocationSettlementId INTEGER,fundingSettlementId INTEGER,additionalFunding NUMERIC,revision INTEGER,catalogItemId INTEGER,itemName TEXT);
    CREATE TABLE supplier_return_settlements(id INTEGER PRIMARY KEY,caseId INTEGER,type TEXT,status TEXT,completedById INTEGER,completedAt TEXT,revision INTEGER);
    CREATE TABLE supplier_return_replacement_links(id INTEGER PRIMARY KEY,caseId INTEGER,purchaseOrderId INTEGER,purchaseOrderItemId INTEGER,receiptId INTEGER,receiptItemId INTEGER,lotId INTEGER,
      receivedQuantity NUMERIC,receivedUnit TEXT,compensatedOriginalQuantity NUMERIC,originalUnit TEXT,createdById INTEGER);
    CREATE TABLE supplier_return_events(id INTEGER PRIMARY KEY,caseId INTEGER,actorId INTEGER,action TEXT,operationKey TEXT,requestHash TEXT,fromRevision INTEGER,toRevision INTEGER,
      beforeState TEXT,afterState TEXT,result TEXT,UNIQUE(caseId,operationKey));
  `);
  f.insert("supplier_return_cases", { id: 3, purchaseOrderId: 4, purchaseOrderItemId: 5, returnedUnit: "قطعة", handoverStatus: "accepted", revision: 4, closedAt: null, creatorDecision: "replace" });
  f.insert("supplier_return_replacement_plans", { id: 7, caseId: 3, status: "purchased", purchaseOrderId: 50, purchaseOrderItemId: 70,
    replacementQuantity: "2.000", replacementUnit: "قطعة", originalQuantityCovered: "2.000", creditAllocationSettlementId: 15,
    fundingSettlementId: 16, additionalFunding: "20.0000", revision: 2, catalogItemId: 20, itemName: "البديل" });
  f.insert("purchase_orders", { id: 4, poNumber: "PR-ORIGINAL", ticketId: 300, ticketItemId: 301 });
  f.insert("purchase_orders", { id: 50, poNumber: "PR-REPLACEMENT" });
  f.insert("purchase_order_items", { id: 5, purchaseOrderId: 4, itemName: "الأصل", catalogItemId: 10 });
  f.insert("purchase_order_items", { id: 70, purchaseOrderId: 50, itemName: "البديل", catalogItemId: 20 });
  for (const [id, type] of [[15, "credit_allocation"], [16, "additional_funding"]] as const) {
    f.insert("supplier_return_settlements", { id, caseId: 3, type, status: "management_approved", revision: 1 });
  }
  f.insert("warehouse_receipts", { id: 60, purchaseOrderId: 50, status: "confirmed" });
  f.insert("warehouse_receipt_items", { id: 61, receiptId: 60, purchaseOrderItemId: 70, inventoryId: 200 });
  f.insert("inventory", { id: 200, quantity: 2, unit: "قطعة", averageCost: 60, totalCostValue: 120 });
  f.insert("inventory_lots", { id: 62, sourceType: "receipt", receiptId: 60, receiptItemId: 61, purchaseOrderId: 50, purchaseOrderItemId: 70,
    originalQuantity: 2, remainingQuantity: 2, specificationStatus: "pending", catalogItemId: 20, issueUnit: "قطعة", trackingToken: "TOKEN-62" });
});
afterEach(() => f.close());

describe("Completed supplier replacement archives only its own follow-up inside the receipt transaction", () => {
  it("closes the exact case once, with its actual warehouse actor and source evidence, without changing stock/receipt identities", async () => {
    const sources = { inventory: tableRows("inventory"), lot: tableRows("inventory_lots"), receipt: tableRows("warehouse_receipts"), line: tableRows("warehouse_receipt_items") };
    expect(await save()).toBe(true);
    expect(tableRows("supplier_return_cases")[0]).toMatchObject({ id: 3, revision: 5, creatorDecision: "replace" });
    expect((tableRows("supplier_return_cases")[0] as any).closedAt).toBeTruthy();
    expect(tableRows("supplier_return_replacement_plans")[0]).toMatchObject({ status: "received", revision: 3 });
    expect(tableRows("supplier_return_settlements").every((row: any) => row.status === "completed" && row.completedById === 8)).toBe(true);
    expect(tableRows("supplier_return_replacement_links")[0]).toMatchObject({ caseId: 3, lotId: 62, receiptId: 60, receiptItemId: 61, receivedQuantity: 2, compensatedOriginalQuantity: 2 });
    const event = tableRows("supplier_return_events")[0] as any;
    expect(event).toMatchObject({ caseId: 3, actorId: 8, action: "replacement_received", operationKey: "replacement-received:7", fromRevision: 4, toRevision: 5 });
    expect(event.requestHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.parse(event.result)).toMatchObject({ caseId: 3, planId: 7, receiptId: 60, receiptItemId: 61, lotId: 62, status: "completed" });
    expect(tableRows("audit_logs")[0]).toMatchObject({ userId: 8, action: "supplier_return_completed", entityType: "supplier_return_case", entityId: 3 });
    expect({ inventory: tableRows("inventory"), lot: tableRows("inventory_lots"), receipt: tableRows("warehouse_receipts"), line: tableRows("warehouse_receipt_items") }).toEqual(sources);
    const beforeReplay = snapshot();
    await expect(save()).rejects.toThrow();
    expect(snapshot()).toEqual(beforeReplay);
  });

  it.each(["supplier_return_events", "audit_logs"])("rolls back links, settlements, plan and closure when %s persistence fails", async table => {
    f.memory.exec(`CREATE TRIGGER fail_completion BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT,'completion persistence failed'); END`);
    const before = snapshot();
    await expect(save()).rejects.toThrow("completion persistence failed");
    expect(snapshot()).toEqual(before);
    f.memory.exec("DROP TRIGGER fail_completion");
    expect(await save()).toBe(true);
    expect(tableRows("supplier_return_events")).toHaveLength(1);
  });

  it("keeps the received replacement linked to the original maintenance need after its follow-up is archived", async () => {
    await save();
    const plans = await loadReplacementFulfillments(f.db, [5]);
    expect(plans.get(5)).toHaveLength(1);
    expect(plans.get(5)![0]).toMatchObject({ planId: 7, caseId: 3, sourceItemId: 5, sourcePurchaseOrderId: 4,
      sourceTicketId: 300, sourceTicketItemId: 301, replacementItemId: 70, replacementPurchaseOrderId: 50,
      lots: [{ lotId: 62, trackingToken: "TOKEN-62", quantity: "2" }] });
    expect((tableRows("supplier_return_cases")[0] as any).closedAt).toBeTruthy();
  });

  it.each(["credit_allocation", "additional_funding"])("does not close or retain a receipt link when %s lacks management approval", async type => {
    f.memory.prepare("UPDATE supplier_return_settlements SET status='pending' WHERE type=?").run(type);
    const before = snapshot();
    await expect(save()).rejects.toThrow();
    expect(snapshot()).toEqual(before);
  });

  it("closes a cheaper replacement with no new additional funding and leaves the unused delegate balance untouched", async () => {
    f.memory.exec("UPDATE supplier_return_replacement_plans SET additionalFunding=0,fundingSettlementId=NULL; DELETE FROM supplier_return_settlements WHERE type='additional_funding'");
    expect(await save()).toBe(true);
    expect(tableRows("supplier_return_settlements")).toHaveLength(1);
    expect((tableRows("supplier_return_cases")[0] as any).closedAt).toBeTruthy();
  });

  it.each(["receipt", "line", "lot", "order", "item", "draft", "sourceType"])("refuses a mismatched %s source without closing the case", async changed => {
    const next = { ...input };
    if (changed === "receipt") next.receiptId = 99;
    if (changed === "line") next.receiptItemId = 99;
    if (changed === "lot") next.lotId = 99;
    if (changed === "order") next.purchaseOrderId = 99;
    if (changed === "item") f.memory.exec("UPDATE inventory_lots SET purchaseOrderItemId=99");
    if (changed === "draft") f.memory.exec("UPDATE warehouse_receipts SET status='draft'");
    if (changed === "sourceType") f.memory.exec("UPDATE inventory_lots SET sourceType='opening_balance'");
    const before = snapshot();
    await expect(save(next)).rejects.toThrow();
    expect(snapshot()).toEqual(before);
  });

  it("requires the full replacement quantity and a persisted lot before completion", async () => {
    const before = snapshot();
    await expect(save({ ...input, quantityInOrderUnits: "1.000" })).rejects.toThrow("كاملة");
    await expect(save({ ...input, lotId: null as any })).rejects.toThrow("لوت");
    expect(snapshot()).toEqual(before);
  });

  it("leaves an ordinary receipt without a replacement plan on its existing workflow", async () => {
    const before = snapshot();
    expect(await save({ ...input, purchaseOrderItemId: 99 })).toBe(false);
    expect(snapshot()).toEqual(before);
  });

  it("serializes two receipt-completion attempts into one closed case and one event", async () => {
    const outcomes = await Promise.allSettled([save(), save()]);
    expect(outcomes.map(result => result.status)).toEqual(["fulfilled", "rejected"]);
    expect(tableRows("supplier_return_replacement_links")).toHaveLength(1);
    expect(tableRows("supplier_return_events")).toHaveLength(1);
    expect((tableRows("supplier_return_cases")[0] as any).revision).toBe(5);
  });

  it("does not reopen a cancelled or completed follow-up", async () => {
    f.memory.exec("UPDATE supplier_return_cases SET closedAt='2026-11-04 12:00:00'");
    const before = snapshot();
    await expect(save()).rejects.toThrow();
    expect(snapshot()).toEqual(before);
  });
});

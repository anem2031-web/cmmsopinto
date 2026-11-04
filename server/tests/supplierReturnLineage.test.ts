import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { purchaseSpecificationsDatabase } from "./fixtures/purchaseSpecificationsDatabase";
import { resolveReturnLineage } from "../supplier-return-followup/lineage";
import { createTrialReturn } from "../supplier-return-followup/runtime";
import { executeFollowupCommand } from "../supplier-return-followup/commands";

// Only the already-tested physical writer port is substituted: these tests run
// actual source valuation, round linking, creation replay and acceptance credit.
const ports = vi.hoisted(() => ({ physical: null as any }));
vi.mock("../_core/db/warehouse-returns", () => ({ createLotAwareSupplierReturn: (input: any, tx: any) => ports.physical(input, tx) }));

let f: ReturnType<typeof purchaseSpecificationsDatabase>;
const warehouse = { id: 20, role: "warehouse" }, delegate = { id: 40, role: "delegate" };
const rootCreatorId = 100;
const physicalSource = (round: number) => ({ lotId: 600 + round, receiptId: 500 + round, receiptItemId: 700 + round,
  purchaseOrderId: 100 + round, purchaseOrderItemId: 200 + round });
const createRequest = (round: number, returnedQuantity = 2) => ({ trackingToken: `TOKEN-${round}`, warehouseId: 1, delegateId: delegate.id,
  returnedQuantity, reason: "مرتجع البديل", operationKey: `round-creation-key-${round}` });
const one = (table: string, id: number) => f.memory.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id) as any;

function seedRound(round: number, parentReplacementPlanId: number | null = null, invoiceTotal = 120) {
  const source = physicalSource(round);
  const priorSource = parentReplacementPlanId == null ? {} : physicalSource(parentReplacementPlanId - 10);
  f.insert("supplier_return_cases", { id: round, returnId: 900 + round, delegateId: 30, creatorId: rootCreatorId, createdById: warehouse.id,
    parentReplacementPlanId, ...priorSource, inventoryId: 400 + round, returnedQuantity: 2, returnedUnit: "قطعة", returnReason: "قديم",
    handoverStatus: "accepted", revision: 2, closedAt: "2026-11-04 12:00:00", originalPurchaseValue: 100, currency: "SAR", valuationBasis: "tax_inclusive" });
  f.insert("supplier_return_replacement_plans", { id: 10 + round, caseId: round, status: "received", purchaseOrderId: source.purchaseOrderId, purchaseOrderItemId: source.purchaseOrderItemId });
  f.insert("supplier_return_replacement_links", { id: 30 + round, caseId: round, purchaseOrderId: source.purchaseOrderId, purchaseOrderItemId: source.purchaseOrderItemId,
    lotId: source.lotId, receiptId: source.receiptId, receiptItemId: source.receiptItemId });
  f.insert("purchase_orders", { id: source.purchaseOrderId, poNumber: `PR-${round}`, requestedById: rootCreatorId });
  f.insert("purchase_order_items", { id: source.purchaseOrderItemId, purchaseOrderId: source.purchaseOrderId, catalogItemId: 9000, itemName: `بديل ${round}` });
  f.insert("warehouse_receipts", { id: source.receiptId, receiptNumber: `RCV-${round}`, status: "confirmed", invoiceNumber: `INVOICE-${round}`, vendorName: `Vendor ${round}` });
  f.insert("warehouse_receipt_items", { id: source.receiptItemId, receiptId: source.receiptId, purchaseOrderItemId: source.purchaseOrderItemId,
    inventoryId: 400 + round, catalogItemId: 9000, purchaseUnit: "قطعة", receivedQuantity: 2, unitCost: String(invoiceTotal / 2), taxAmount: "0.00", lineTotal: invoiceTotal.toFixed(2) });
  f.insert("inventory", { id: 400 + round, warehouseId: 1, unit: "قطعة", quantity: 2, linkedItemId: 9000 });
  f.insert("inventory_lots", { id: source.lotId, trackingToken: `TOKEN-${round}`, sourceType: "receipt", receiptId: source.receiptId, receiptItemId: source.receiptItemId,
    purchaseOrderId: source.purchaseOrderId, purchaseOrderItemId: source.purchaseOrderItemId, catalogItemId: 9000, originalQuantity: 2, remainingQuantity: 2,
    conversionFactor: "1.0000", purchaseUnit: "قطعة", issueUnit: "قطعة" });
  return source;
}

beforeEach(() => {
  f = purchaseSpecificationsDatabase();
  f.memory.function("DATABASE", () => "copycmms2");
  f.memory.exec(`
    ALTER TABLE users ADD COLUMN username TEXT;
    ALTER TABLE warehouse_receipt_items ADD COLUMN taxAmount TEXT;
    ALTER TABLE warehouse_returns ADD COLUMN inventoryId INTEGER;
    ALTER TABLE warehouse_returns ADD COLUMN purchaseOrderId INTEGER;
    ALTER TABLE warehouse_returns ADD COLUMN purchaseOrderItemId INTEGER;
    ALTER TABLE warehouse_returns ADD COLUMN sourceDeliveryDocumentId INTEGER;
    CREATE TABLE supplier_return_cases(id INTEGER PRIMARY KEY,returnId INTEGER,delegateId INTEGER,creatorId INTEGER,createdById INTEGER,parentReplacementPlanId INTEGER,
      purchaseOrderId INTEGER,purchaseOrderItemId INTEGER,receiptId INTEGER,receiptItemId INTEGER,lotId INTEGER,inventoryId INTEGER,
      returnedQuantity NUMERIC,returnedUnit TEXT,returnReason TEXT,creationKey TEXT,creationRequestHash TEXT,originalPurchaseValue NUMERIC,currency TEXT,valuationBasis TEXT,valuationSource TEXT,
      handoverStatus TEXT DEFAULT 'awaiting_delegate',rejectionReason TEXT,resolution TEXT,creatorDecision TEXT,revision INTEGER DEFAULT 0,closedAt TEXT,
      handoverDecidedById INTEGER,handoverDecidedAt TEXT,resolutionDecidedById INTEGER,resolutionDecidedAt TEXT,UNIQUE(createdById,creationKey));
    CREATE TABLE supplier_return_replacement_plans(id INTEGER PRIMARY KEY,caseId INTEGER,status TEXT,purchaseOrderId INTEGER,purchaseOrderItemId INTEGER);
    CREATE TABLE supplier_return_replacement_links(id INTEGER PRIMARY KEY,caseId INTEGER,purchaseOrderId INTEGER,purchaseOrderItemId INTEGER,lotId INTEGER,receiptId INTEGER,receiptItemId INTEGER);
    CREATE TABLE supplier_return_events(id INTEGER PRIMARY KEY,caseId INTEGER,actorId INTEGER,action TEXT,operationKey TEXT,requestHash TEXT,fromRevision INTEGER,toRevision INTEGER,
      beforeState TEXT,afterState TEXT,reason TEXT,result TEXT,UNIQUE(caseId,operationKey));
    CREATE TABLE supplier_return_settlements(id INTEGER PRIMARY KEY,caseId INTEGER,operationKey TEXT,type TEXT,status TEXT,amount NUMERIC,currency TEXT,valuationBasis TEXT,referenceNumber TEXT,notes TEXT,
      createdById INTEGER,completedById INTEGER,completedAt TEXT);
    CREATE TABLE notifications(id INTEGER PRIMARY KEY,userId INTEGER,title TEXT,message TEXT,type TEXT);
  `);
  for (const [id, role] of [[20, "warehouse"], [30, "delegate"], [40, "delegate"], [100, "operator"]] as const) f.insert("users", { id, role, isActive: 1, name: `User ${id}`, username: `USER${id}` });
  ports.physical = async (request: any, tx: any) => {
    const [[lot]] = await tx.execute(sql`SELECT * FROM inventory_lots WHERE trackingToken=${request.trackingToken}`);
    const [[prior]] = await tx.execute(sql`SELECT COALESCE(SUM(returnedQuantity),0) AS quantity FROM warehouse_returns WHERE lotId=${lot.id}`);
    if (request.returnedQuantity + Number(prior.quantity) > Number(lot.originalQuantity)) throw Error("insufficient source quantity");
    const [[line]] = await tx.execute(sql`SELECT inventoryId FROM warehouse_receipt_items WHERE id=${lot.receiptItemId}`);
    const [saved] = await tx.execute(sql`INSERT INTO warehouse_returns(lotId,receiptId,inventoryId,purchaseOrderId,purchaseOrderItemId,returnedQuantity,returnNumber)
      VALUES (${lot.id},${lot.receiptId},${line.inventoryId},${lot.purchaseOrderId},${lot.purchaseOrderItemId},${request.returnedQuantity},${`RTN-${lot.id}`})`);
    return { returnId: Number(saved.insertId), returnNumber: `RTN-${lot.id}` };
  };
});
afterEach(() => f.close());

describe("Successive supplier return rounds preserve source provenance", () => {
  it("returns no parent for independent or ordinary purchase receipt items", async () => {
    expect(await resolveReturnLineage(f.db, { ...physicalSource(1), purchaseOrderItemId: null })).toEqual({ parentReplacementPlanId: null, creatorId: null });
    expect(f.queries).toHaveLength(0);
    expect(await resolveReturnLineage(f.db, physicalSource(1))).toEqual({ parentReplacementPlanId: null, creatorId: null });
  });
  it("links a received replacement even after its parent follow-up completed, retaining the original creator", async () => {
    const source = seedRound(1);
    expect(await resolveReturnLineage(f.db, source)).toEqual({ parentReplacementPlanId: 11, creatorId: rootCreatorId });
    expect(one("supplier_return_cases", 1).closedAt).toBeTruthy();
  });
  it.each(["purchased", "ready_to_purchase", "cancelled"])("rejects an unreceived %s replacement source", async status => {
    const source = seedRound(1); f.memory.prepare("UPDATE supplier_return_replacement_plans SET status=?").run(status);
    await expect(resolveReturnLineage(f.db, source)).rejects.toThrow("اكتمال استلامه");
  });
  it.each(["lot", "receipt", "line", "order", "handover"])("denies a mismatched %s source", async kind => {
    const source = seedRound(1);
    if (kind === "lot") source.lotId = 999;
    if (kind === "receipt") source.receiptId = 999;
    if (kind === "line") source.receiptItemId = 999;
    if (kind === "order") source.purchaseOrderId = 999;
    if (kind === "handover") f.memory.exec("UPDATE supplier_return_cases SET handoverStatus='rejected'");
    await expect(resolveReturnLineage(f.db, source)).rejects.toThrow();
  });
  it("rejects ambiguous plans, missing ancestors and self/longer cycles", async () => {
    const source = seedRound(1);
    f.insert("supplier_return_replacement_plans", { id: 99, caseId: 1, status: "received", purchaseOrderId: source.purchaseOrderId, purchaseOrderItemId: source.purchaseOrderItemId });
    await expect(resolveReturnLineage(f.db, source)).rejects.toThrow("أكثر من");
    f.memory.exec("DELETE FROM supplier_return_replacement_plans WHERE id=99; UPDATE supplier_return_cases SET parentReplacementPlanId=999");
    await expect(resolveReturnLineage(f.db, source)).rejects.toThrow();
    f.memory.exec("UPDATE supplier_return_cases SET parentReplacementPlanId=11");
    await expect(resolveReturnLineage(f.db, source)).rejects.toThrow();
    const second = seedRound(2, 11);
    f.memory.exec("UPDATE supplier_return_cases SET parentReplacementPlanId=12 WHERE id=1");
    await expect(resolveReturnLineage(f.db, second)).rejects.toThrow();
  });
  it.each([64, 65])("bounds a chain of %s received replacement plans without rounding source values", async count => {
    let source = physicalSource(1);
    for (let id = 1; id <= count; id++) source = seedRound(id, id === 1 ? null : 10 + id - 1);
    if (count === 64) expect(await resolveReturnLineage(f.db, source)).toEqual({ parentReplacementPlanId: 74, creatorId: rootCreatorId });
    else await expect(resolveReturnLineage(f.db, source)).rejects.toThrow("تسلسل");
  });

  it.each(["selected", "ancestor"])("fails closed when the %s round claims a parent whose original return source is different", async corrupted => {
    seedRound(1);
    const second = seedRound(2, 11);
    const third = seedRound(3, 12);
    f.memory.prepare("UPDATE supplier_return_cases SET lotId=999 WHERE id=?").run(corrupted === "selected" ? 3 : 2);
    await expect(resolveReturnLineage(f.db, third)).rejects.toThrow();
    // A separate valid request remains independently usable after the failure.
    if (corrupted === "selected") expect(await resolveReturnLineage(f.db, second)).toEqual({ parentReplacementPlanId: 12, creatorId: rootCreatorId });
  });

  it("values each new round from its own latest invoice and credits only its currently assigned delegate once", async () => {
    seedRound(1, null, 120);
    const oldCredit = { id: 500, caseId: 1, operationKey: "handover-credit:1", type: "supplier_credit", status: "completed", amount: 100,
      currency: "SAR", valuationBasis: "tax_inclusive", createdById: 30, completedById: 30 };
    f.insert("supplier_return_settlements", oldCredit);
    const second = await createTrialReturn(warehouse, createRequest(1), f.db);
    expect(one("supplier_return_cases", second.caseId)).toMatchObject({ parentReplacementPlanId: 11, creatorId: rootCreatorId, delegateId: 40,
      originalPurchaseValue: 120, valuationBasis: "tax_inclusive", handoverStatus: "awaiting_delegate" });
    const accept = { caseId: second.caseId, expectedRevision: 0, action: "accept" as const, operationKey: "second-round-accept" };
    await expect(executeFollowupCommand(f.db, { id: 30, role: "delegate" }, accept)).rejects.toThrow("لمندوب آخر");
    const accepted = await executeFollowupCommand(f.db, delegate, accept);
    expect(await executeFollowupCommand(f.db, delegate, accept)).toEqual(accepted);
    expect(f.memory.prepare("SELECT amount,completedById FROM supplier_return_settlements WHERE caseId=? AND type='supplier_credit'").all(second.caseId)).toEqual([{ amount: 120, completedById: 40 }]);
    expect(one("supplier_return_settlements", 500)).toMatchObject(oldCredit);
    // Fixture the intervening completed purchase/receipt; creation and valuation
    // of the next round still run through the real transaction services below.
    const thirdSource = physicalSource(2);
    f.insert("supplier_return_replacement_plans", { id: 12, caseId: second.caseId, status: "received", purchaseOrderId: thirdSource.purchaseOrderId, purchaseOrderItemId: thirdSource.purchaseOrderItemId });
    f.insert("supplier_return_replacement_links", { id: 32, caseId: second.caseId, ...thirdSource });
    f.insert("purchase_orders", { id: thirdSource.purchaseOrderId, poNumber: "PR-NEXT", requestedById: rootCreatorId });
    f.insert("purchase_order_items", { id: thirdSource.purchaseOrderItemId, purchaseOrderId: thirdSource.purchaseOrderId, catalogItemId: 9000 });
    f.insert("warehouse_receipts", { id: thirdSource.receiptId, receiptNumber: "RCV-NEXT", status: "confirmed", invoiceNumber: "NEXT-INVOICE", vendorName: "Next vendor" });
    f.insert("warehouse_receipt_items", { id: thirdSource.receiptItemId, receiptId: thirdSource.receiptId, purchaseOrderItemId: thirdSource.purchaseOrderItemId,
      inventoryId: 402, catalogItemId: 9000, purchaseUnit: "قطعة", receivedQuantity: 2, unitCost: "45.0000", taxAmount: "0.00", lineTotal: "90.00" });
    f.insert("inventory", { id: 402, unit: "قطعة", quantity: 2 });
    f.insert("inventory_lots", { id: thirdSource.lotId, trackingToken: "TOKEN-2", sourceType: "receipt", receiptId: thirdSource.receiptId, receiptItemId: thirdSource.receiptItemId,
      purchaseOrderId: thirdSource.purchaseOrderId, purchaseOrderItemId: thirdSource.purchaseOrderItemId, catalogItemId: 9000, originalQuantity: 2,
      conversionFactor: "1.0000", purchaseUnit: "قطعة", issueUnit: "قطعة" });
    f.memory.prepare("UPDATE supplier_return_cases SET closedAt=CURRENT_TIMESTAMP WHERE id=?").run(second.caseId);
    const third = await createTrialReturn(warehouse, createRequest(2, 1), f.db);
    expect(one("supplier_return_cases", third.caseId)).toMatchObject({ parentReplacementPlanId: 12, creatorId: rootCreatorId, originalPurchaseValue: 45 });
    await executeFollowupCommand(f.db, delegate, { ...accept, caseId: third.caseId, operationKey: "third-round-accept" });
    expect(f.memory.prepare("SELECT caseId,amount FROM supplier_return_settlements WHERE type='supplier_credit' ORDER BY id").all()).toEqual([
      { caseId: 1, amount: 100 }, { caseId: second.caseId, amount: 120 }, { caseId: third.caseId, amount: 45 },
    ]);
    expect(f.memory.prepare("SELECT COUNT(*) AS count FROM warehouse_returns").get()).toEqual({ count: 2 });
    expect(await createTrialReturn(warehouse, createRequest(2, 1), f.db)).toEqual(third);
    expect(f.memory.prepare("SELECT COUNT(*) AS count FROM warehouse_returns").get()).toEqual({ count: 2 });
  });

  it("rolls the newly created physical return row back if its supposed parent receipt provenance is invalid", async () => {
    seedRound(1); f.memory.exec("DELETE FROM supplier_return_replacement_links");
    await expect(createTrialReturn(warehouse, createRequest(1), f.db)).rejects.toThrow();
    expect(f.memory.prepare("SELECT * FROM warehouse_returns").all()).toEqual([]);
    expect(f.memory.prepare("SELECT * FROM supplier_return_events").all()).toEqual([]);
    expect(f.memory.prepare("SELECT * FROM supplier_return_settlements").all()).toEqual([]);
  });
});

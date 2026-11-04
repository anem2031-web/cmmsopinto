import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { purchaseSpecificationsDatabase } from "./fixtures/purchaseSpecificationsDatabase";

vi.mock("../supplier-return-followup/runtime", async importOriginal => {
  const actual = await importOriginal<typeof import("../supplier-return-followup/runtime")>();
  return { ...actual, trialEnabled: async () => true };
});
import { runTrialCreatorCancellation, runTrialCreatorReplacement } from "../supplier-return-followup/creator-choice";

let f: ReturnType<typeof purchaseSpecificationsDatabase>;
const creator = { id: 12, role: "operator" };
const choice = { caseId: 1, expectedRevision: 3, catalogItemId: 44, quantity: 2, operationKey: "sequential-creator-choice-001" };
const cancel = { caseId: 1, expectedRevision: 3, operationKey: "sequential-creator-cancel-001" };
const port = () => ({ transaction: (work: any) => f.db.transaction(work) });
const row = (table: string, id: number) => f.memory.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id) as any;

beforeEach(() => {
  f = purchaseSpecificationsDatabase();
  f.memory.function("DATABASE", () => "copycmms2");
  f.memory.exec(`
    ALTER TABLE warehouse_returns ADD COLUMN inventoryId INTEGER;
    ALTER TABLE warehouse_returns ADD COLUMN purchaseOrderId INTEGER;
    ALTER TABLE warehouse_returns ADD COLUMN purchaseOrderItemId INTEGER;
    ALTER TABLE warehouse_returns ADD COLUMN sourceDeliveryDocumentId INTEGER;
    CREATE TABLE supplier_return_cases(id INTEGER PRIMARY KEY,returnId INTEGER,delegateId INTEGER,creatorId INTEGER,createdById INTEGER,parentReplacementPlanId INTEGER,
      purchaseOrderId INTEGER,purchaseOrderItemId INTEGER,receiptId INTEGER,receiptItemId INTEGER,lotId INTEGER,inventoryId INTEGER,
      returnedQuantity NUMERIC,returnedUnit TEXT,handoverStatus TEXT,rejectionReason TEXT,resolution TEXT,creatorDecision TEXT,
      revision INTEGER,closedAt TEXT,originalPurchaseValue NUMERIC,currency TEXT,valuationBasis TEXT);
    CREATE TABLE supplier_return_replacement_plans(id INTEGER PRIMARY KEY,caseId INTEGER,planNumber INTEGER,status TEXT,
      purchaseOrderId INTEGER,purchaseOrderItemId INTEGER,catalogItemId INTEGER,itemName TEXT,replacementQuantity NUMERIC,
      replacementUnit TEXT,originalQuantityCovered NUMERIC,selectedById INTEGER,createdById INTEGER);
    CREATE TABLE supplier_return_replacement_links(id INTEGER PRIMARY KEY,caseId INTEGER,purchaseOrderId INTEGER,purchaseOrderItemId INTEGER,lotId INTEGER,receiptId INTEGER,receiptItemId INTEGER);
    CREATE TABLE supplier_return_settlements(id INTEGER PRIMARY KEY,caseId INTEGER,type TEXT,status TEXT,operationKey TEXT);
    CREATE TABLE supplier_return_events(id INTEGER PRIMARY KEY,caseId INTEGER,actorId INTEGER,action TEXT,operationKey TEXT,requestHash TEXT,
      fromRevision INTEGER,toRevision INTEGER,beforeState TEXT,afterState TEXT,reason TEXT,result TEXT);
    CREATE TABLE catalog_items(id INTEGER PRIMARY KEY,nameAr TEXT,unit TEXT,isActive INTEGER);
    CREATE TABLE it_purchase_needs(id INTEGER PRIMARY KEY,purchaseOrderId INTEGER);
    CREATE TABLE pmv2_material_purchase_links(id INTEGER PRIMARY KEY,purchaseOrderItemId INTEGER);
    CREATE TABLE operational_issue_purchase_links(id INTEGER PRIMARY KEY,purchaseOrderItemId INTEGER);
    CREATE TABLE external_maintenance_jobs(id INTEGER PRIMARY KEY,purchaseOrderId INTEGER);
    ATTACH DATABASE ':memory:' AS information_schema;
    CREATE TABLE information_schema.TABLES(TABLE_SCHEMA TEXT,TABLE_NAME TEXT);
    INSERT INTO information_schema.TABLES VALUES
      ('copycmms2','it_purchase_needs'),('copycmms2','pmv2_material_purchase_links'),
      ('copycmms2','operational_issue_purchase_links'),('copycmms2','external_maintenance_jobs');
  `);
  for (const user of [creator, { id: 13, role: "operator" }, { id: 99, role: "admin" }]) f.insert("users", { ...user, isActive: 1 });
  f.insert("purchase_orders", { id: 4, requestedById: 12 });
  f.insert("purchase_order_items", { id: 5, purchaseOrderId: 4, catalogItemId: 22 });
  // An administrator generated the preceding compensation PR. Ownership of the
  // original need remains with its original requester, not that administrator.
  f.insert("purchase_orders", { id: 40, requestedById: 99 });
  f.insert("purchase_order_items", { id: 50, purchaseOrderId: 40, catalogItemId: 33 });
  f.insert("warehouse_receipts", { id: 70, purchaseOrderId: 40, status: "confirmed" });
  f.insert("warehouse_receipt_items", { id: 80, receiptId: 70, purchaseOrderItemId: 50, inventoryId: 3 });
  f.insert("inventory_lots", { id: 60, receiptId: 70, receiptItemId: 80, purchaseOrderId: 40, purchaseOrderItemId: 50 });
  f.insert("warehouse_returns", { id: 2, inventoryId: 3, lotId: 60, receiptId: 70, purchaseOrderId: 40, purchaseOrderItemId: 50, returnedQuantity: 1 });
  f.insert("supplier_return_cases", { id: 100, creatorId: 12, createdById: 20, handoverStatus: "accepted", purchaseOrderId: 4, purchaseOrderItemId: 5,
    closedAt: "2026-11-04 10:00:00" });
  f.insert("supplier_return_replacement_plans", { id: 110, caseId: 100, status: "received", purchaseOrderId: 40, purchaseOrderItemId: 50 });
  f.insert("supplier_return_replacement_links", { id: 120, caseId: 100, purchaseOrderId: 40, purchaseOrderItemId: 50, lotId: 60, receiptId: 70, receiptItemId: 80 });
  f.insert("supplier_return_cases", { id: 1, returnId: 2, creatorId: 12, createdById: 20, delegateId: 10, parentReplacementPlanId: 110,
    purchaseOrderId: 40, purchaseOrderItemId: 50, receiptId: 70, receiptItemId: 80, lotId: 60, inventoryId: 3,
    returnedQuantity: 1, returnedUnit: "قطعة", revision: 3, handoverStatus: "accepted", resolution: "change_item", creatorDecision: "pending",
    originalPurchaseValue: 100, currency: "SAR", valuationBasis: "tax_inclusive" });
  f.insert("supplier_return_settlements", { id: 130, caseId: 1, type: "cash_refund", status: "completed", operationKey: "cash-refund:1" });
  f.insert("catalog_items", { id: 44, nameAr: "بديل جديد", unit: "قطعة", isActive: 1 });
});
afterEach(() => f.close());

function refund() { f.memory.exec("UPDATE supplier_return_cases SET resolution='refund' WHERE id=1"); }
function writes() { return f.queries.filter(query => /^\s*(INSERT|UPDATE|DELETE)/i.test(query.sql)); }

describe("Sequential creator commands retain original ownership and need restrictions", () => {
  it("lets the inherited original creator choose a different item even when the preceding PR requester is admin", async () => {
    const first = await runTrialCreatorReplacement(creator, choice, port());
    expect(first).toMatchObject({ caseId: 1, revision: 4 });
    expect(row("supplier_return_replacement_plans", first.planId)).toMatchObject({ caseId: 1, catalogItemId: 44, selectedById: 12 });
    expect(await runTrialCreatorReplacement(creator, choice, port())).toEqual(first);
    expect(f.memory.prepare("SELECT COUNT(*) AS n FROM supplier_return_events WHERE caseId=1").get()).toEqual({ n: 1 });
    expect(writes().some(query => /inventory|purchase_orders|purchase_order_items/.test(query.sql))).toBe(false);
  });

  it.each([{ id: 13, role: "operator" }, { id: 99, role: "admin" }])("does not give creator choice to $role $id", async actor => {
    await expect(runTrialCreatorReplacement(actor, choice, port())).rejects.toMatchObject({ code: "FORBIDDEN" });
    refund();
    await expect(runTrialCreatorCancellation(actor, cancel, port())).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(writes()).toHaveLength(0);
  });

  it("permits cancellation for an unlinked original need without requiring the administrator's identity", async () => {
    refund();
    expect(await runTrialCreatorCancellation(creator, cancel, port())).toEqual({ caseId: 1, revision: 4, decision: "cancel" });
    expect(row("supplier_return_cases", 1)).toMatchObject({ creatorDecision: "cancel", revision: 4 });
    expect(row("supplier_return_cases", 1).closedAt).toBeTruthy();
    expect(row("purchase_orders", 40).requestedById).toBe(99);
  });

  it.each(["pmv2", "operational", "it", "external", "ticket", "ticketItem"] as const)("denies cancellation when the original root has a %s link", async link => {
    refund();
    if (link === "pmv2") f.insert("pmv2_material_purchase_links", { id: 1, purchaseOrderItemId: 5 });
    if (link === "operational") f.insert("operational_issue_purchase_links", { id: 1, purchaseOrderItemId: 5 });
    if (link === "it") f.insert("it_purchase_needs", { id: 1, purchaseOrderId: 4 });
    if (link === "external") f.insert("external_maintenance_jobs", { id: 1, purchaseOrderId: 4 });
    if (link === "ticket") f.memory.exec("UPDATE purchase_orders SET ticketId=9 WHERE id=4");
    if (link === "ticketItem") f.memory.exec("UPDATE purchase_orders SET ticketItemId=9 WHERE id=4");
    await expect(runTrialCreatorCancellation(creator, cancel, port())).rejects.toThrow("مرتبط");
    expect(row("supplier_return_cases", 1).closedAt).toBeNull();
    expect(writes()).toHaveLength(0);
  });

  it.each(["pmv2", "operational", "ticket"] as const)("also denies cancellation for the immediate source's %s link", async link => {
    refund();
    if (link === "pmv2") f.insert("pmv2_material_purchase_links", { id: 1, purchaseOrderItemId: 50 });
    if (link === "operational") f.insert("operational_issue_purchase_links", { id: 1, purchaseOrderItemId: 50 });
    if (link === "ticket") f.memory.exec("UPDATE purchase_orders SET ticketId=9 WHERE id=40");
    await expect(runTrialCreatorCancellation(creator, cancel, port())).rejects.toThrow("مرتبط");
    expect(writes()).toHaveLength(0);
  });

  it.each([
    "UPDATE supplier_return_cases SET parentReplacementPlanId=999 WHERE id=1",
    "UPDATE supplier_return_cases SET creatorId=13 WHERE id=100",
    "UPDATE supplier_return_replacement_plans SET status='purchased' WHERE id=110",
    "UPDATE warehouse_returns SET lotId=999 WHERE id=2",
    "UPDATE warehouse_returns SET receiptId=999 WHERE id=2",
    "UPDATE warehouse_receipt_items SET inventoryId=999 WHERE id=80",
    "DELETE FROM purchase_orders WHERE id=4",
  ])("fails closed on corrupt lineage/source: %s", async mutate => {
    f.memory.exec(mutate);
    if (mutate.startsWith("DELETE")) {
      refund();
      await expect(runTrialCreatorCancellation(creator, cancel, port())).rejects.toThrow("الأصلي غير موجود");
    } else {
      await expect(runTrialCreatorReplacement(creator, choice, port())).rejects.toThrow();
      refund();
      await expect(runTrialCreatorCancellation(creator, cancel, port())).rejects.toThrow();
    }
    expect(writes()).toHaveLength(0);
  });

  it("rechecks inherited identity and physical provenance before an idempotent retry", async () => {
    await runTrialCreatorReplacement(creator, choice, port());
    f.memory.exec("UPDATE supplier_return_cases SET creatorId=13 WHERE id=100");
    await expect(runTrialCreatorReplacement(creator, choice, port())).rejects.toThrow();
    f.memory.exec("UPDATE supplier_return_cases SET creatorId=12 WHERE id=100; UPDATE users SET isActive=0 WHERE id=12");
    await expect(runTrialCreatorReplacement(creator, choice, port())).rejects.toMatchObject({ code: "FORBIDDEN" });
    f.memory.exec("UPDATE users SET isActive=1 WHERE id=12");
    expect(await runTrialCreatorReplacement(creator, choice, port())).toMatchObject({ caseId: 1, revision: 4 });
    expect(f.memory.prepare("SELECT COUNT(*) AS n FROM supplier_return_events WHERE caseId=1").get()).toEqual({ n: 1 });
  });

  it("allows standalone-origin later-round cancellation without inventing an original purchase", async () => {
    refund();
    f.memory.exec("UPDATE supplier_return_cases SET purchaseOrderId=NULL,purchaseOrderItemId=NULL WHERE id=100");
    expect(await runTrialCreatorCancellation(creator, cancel, port())).toMatchObject({ decision: "cancel" });
    expect(row("supplier_return_cases", 100).purchaseOrderId).toBeNull();
  });
});

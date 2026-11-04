import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { purchaseSpecificationsDatabase } from "./fixtures/purchaseSpecificationsDatabase";
import { loadReplacementFulfillments, replacementCoverageLimit, replacementPhysicalToOriginal, replacementOriginalPerPhysical,
  type ReplacementFulfillment } from "../supplier-return-followup/fulfillment";
import { loadPmv2Replacements, planPmv2Fulfillment, replacementForPhysicalLot } from "../pmv2/materials/replacement-coverage";

let f: ReturnType<typeof purchaseSpecificationsDatabase>;
const rootIds = (root = 1) => ({ order: root * 10000 + 1, item: root * 10000 + 2, catalog: root * 10000 + 3,
  ticket: root * 10000 + 4, ticketItem: root * 10000 + 5, requestItem: root * 10000 + 6 });
const roundIds = (root: number, round: number) => ({ case: root * 10000 + 100 + round, plan: root * 10000 + 200 + round,
  order: root * 10000 + 300 + round, item: root * 10000 + 400 + round, catalog: root * 10000 + 500 + round,
  receipt: root * 10000 + 600 + round, line: root * 10000 + 700 + round, lot: root * 10000 + 800 + round });
function seedRoot(root = 1) {
  const ids = rootIds(root);
  f.insert("purchase_orders", { id: ids.order, poNumber: `ROOT-${root}`, ticketId: ids.ticket, ticketItemId: ids.ticketItem });
  f.insert("purchase_order_items", { id: ids.item, purchaseOrderId: ids.order, catalogItemId: ids.catalog, itemName: "الاحتياج الأصلي", quantity: 4, unit: "قطعة", status: "received" });
  f.insert("pmv2_material_request_items", { id: ids.requestItem, catalogItemId: ids.catalog, unitSnapshot: "قطعة", requestedQuantity: 4, status: "waiting_material" });
  f.insert("pmv2_material_purchase_links", { id: ids.requestItem, materialRequestItemId: ids.requestItem, purchaseOrderId: ids.order, purchaseOrderItemId: ids.item, linkedQuantity: 4 });
  return ids;
}
function seedRound(root: number, round: number, physicalQuantity: number, covered: number, physicalUnit = "حبة") {
  const ids = roundIds(root, round), original = rootIds(root), previous = round === 1 ? null : roundIds(root, round - 1);
  const previousLot = previous ? f.memory.prepare("SELECT issueUnit FROM inventory_lots WHERE id=?").get(previous.lot) as any : null;
  const sourceUnit = previousLot?.issueUnit ?? "قطعة";
  const source = { purchaseOrderId: previous?.order ?? original.order, purchaseOrderItemId: previous?.item ?? original.item,
    lotId: previous?.lot ?? root * 10000 + 900, receiptId: previous?.receipt ?? root * 10000 + 901, receiptItemId: previous?.line ?? root * 10000 + 902 };
  f.insert("supplier_return_cases", { id: ids.case, ...source, parentReplacementPlanId: previous?.plan ?? null,
    returnedQuantity: covered, returnedUnit: sourceUnit, handoverStatus: "accepted", closedAt: "2026-11-04 12:00:00" });
  f.insert("supplier_return_replacement_plans", { id: ids.plan, caseId: ids.case, planNumber: 1, status: "received", purchaseOrderId: ids.order,
    purchaseOrderItemId: ids.item, catalogItemId: ids.catalog, itemName: `البديل ${round}`, replacementQuantity: 2,
    replacementUnit: "علبة", originalQuantityCovered: covered });
  f.insert("purchase_orders", { id: ids.order, poNumber: `REPLACEMENT-${root}-${round}` });
  f.insert("purchase_order_items", { id: ids.item, purchaseOrderId: ids.order, catalogItemId: ids.catalog, itemName: `البديل ${round}`, quantity: 2, unit: "علبة" });
  f.insert("warehouse_receipts", { id: ids.receipt, status: "confirmed", purchaseOrderId: ids.order });
  f.insert("warehouse_receipt_items", { id: ids.line, receiptId: ids.receipt, purchaseOrderItemId: ids.item, catalogItemId: ids.catalog, receivedQuantity: 2, purchaseUnit: "علبة" });
  f.insert("inventory_lots", { id: ids.lot, lotCode: `LOT-${root}-${round}`, trackingToken: `TOKEN-${root}-${round}`, sourceType: "receipt", catalogItemId: ids.catalog,
    receiptId: ids.receipt, receiptItemId: ids.line, purchaseOrderId: ids.order, purchaseOrderItemId: ids.item,
    originalQuantity: physicalQuantity, remainingQuantity: physicalQuantity, purchaseUnit: "علبة", issueUnit: physicalUnit });
  f.insert("supplier_return_replacement_links", { id: ids.plan, caseId: ids.case, purchaseOrderId: ids.order, purchaseOrderItemId: ids.item,
    receiptId: ids.receipt, receiptItemId: ids.line, lotId: ids.lot, receivedQuantity: 2, receivedUnit: "علبة", compensatedOriginalQuantity: covered, originalUnit: sourceUnit });
  // These are native supplier returns, not return-to-warehouse delivery rows.
  f.insert("warehouse_returns", { id: ids.case, lotId: source.lotId, receiptId: source.receiptId, returnedQuantity: covered, sourceDeliveryDocumentId: null });
  return ids;
}
function availableStock(plan: ReplacementFulfillment) {
  const lot = plan.lots[0];
  const returned = f.memory.prepare("SELECT COALESCE(SUM(returnedQuantity),0) AS quantity FROM warehouse_returns WHERE lotId=? AND sourceDeliveryDocumentId IS NULL").get(lot.lotId) as any;
  return [{ lotId: lot.lotId, inventoryId: lot.lotId + 1000, warehouseId: 1, catalogItemId: plan.catalogItemId, unit: lot.unit,
    quantity: Number(lot.quantity) - Number(returned.quantity), lotCode: String(lot.lotId), trackingToken: lot.trackingToken }].filter(row => row.quantity > 0);
}
const projectNeed = (plans: ReplacementFulfillment[], requiredOriginal = 4) => planPmv2Fulfillment({ requiredOriginal, originalUnit: "قطعة", originalStock: [],
  replacements: plans.map(plan => ({ replacement: { requestItemId: rootIds().requestItem, plan, maximumOriginalQuantity: Number(replacementCoverageLimit(plan)) }, stock: availableStock(plan) })) });
const needSnapshot = () => ["purchase_orders", "purchase_order_items", "pmv2_material_request_items", "pmv2_material_purchase_links", "inventory_lots", "warehouse_returns"]
  .map(table => f.memory.prepare(`SELECT * FROM ${table} ORDER BY id`).all());

beforeEach(() => {
  f = purchaseSpecificationsDatabase();
  f.memory.function("DATABASE", () => "copycmms2");
  f.memory.exec(`
    ALTER TABLE warehouse_returns ADD COLUMN sourceDeliveryDocumentId INTEGER;
    CREATE TABLE supplier_return_cases(id INTEGER PRIMARY KEY,parentReplacementPlanId INTEGER,purchaseOrderId INTEGER,purchaseOrderItemId INTEGER,
      lotId INTEGER,receiptId INTEGER,receiptItemId INTEGER,returnedQuantity NUMERIC,returnedUnit TEXT,handoverStatus TEXT,closedAt TEXT);
    CREATE TABLE supplier_return_replacement_plans(id INTEGER PRIMARY KEY,caseId INTEGER,planNumber INTEGER,status TEXT,purchaseOrderId INTEGER,purchaseOrderItemId INTEGER,
      catalogItemId INTEGER,itemName TEXT,replacementQuantity NUMERIC,replacementUnit TEXT,originalQuantityCovered NUMERIC);
    CREATE TABLE supplier_return_replacement_links(id INTEGER PRIMARY KEY,caseId INTEGER,purchaseOrderId INTEGER,purchaseOrderItemId INTEGER,
      receiptId INTEGER,receiptItemId INTEGER,lotId INTEGER,receivedQuantity NUMERIC,receivedUnit TEXT,compensatedOriginalQuantity NUMERIC,originalUnit TEXT);
    CREATE TABLE pmv2_material_request_items(id INTEGER PRIMARY KEY,catalogItemId INTEGER,unitSnapshot TEXT,requestedQuantity NUMERIC,status TEXT);
    CREATE TABLE pmv2_material_purchase_links(id INTEGER PRIMARY KEY,materialRequestItemId INTEGER,purchaseOrderId INTEGER,purchaseOrderItemId INTEGER,linkedQuantity NUMERIC);
  `);
});
afterEach(() => f.close());

describe("Received successive replacements keep exact original-need coverage", () => {
  it.each([2, 3])("uses only the last physical receipt after %s full replacement returns without duplicating the original need", async rounds => {
    const original = seedRoot();
    seedRound(1, 1, 6, 4);
    seedRound(1, 2, 8, 6, "قطعة");
    if (rounds === 3) seedRound(1, 3, 12, 8);
    const before = needSnapshot();
    const plans = (await loadReplacementFulfillments(f.db, [original.item])).get(original.item)!;
    expect(plans).toHaveLength(rounds);
    expect(plans.map(plan => replacementCoverageLimit(plan))).toEqual(rounds === 2 ? ["0.000", "4.000"] : ["0.000", "0.000", "4.000"]);
    for (const plan of plans) expect(plan).toMatchObject({ sourceItemId: original.item, sourcePurchaseOrderId: original.order, sourceCatalogItemId: original.catalog,
      sourceTicketId: original.ticket, sourceTicketItemId: original.ticketItem, originalUnit: "قطعة", sourceUnit: "قطعة" });
    const last = plans.at(-1)!;
    expect(replacementPhysicalToOriginal(last, rounds === 2 ? "8" : "12")).toBe("4.000");
    expect(replacementOriginalPerPhysical(last)).toBeCloseTo(rounds === 2 ? 0.5 : 1 / 3, 10);
    const selected = projectNeed(plans);
    expect(selected).toMatchObject({ complete: true, originalCovered: 4 });
    expect(selected.allocations.map(part => [part.replacementPlanId, part.quantity, part.originalQuantity])).toEqual([[last.planId, rounds === 2 ? 8 : 12, 4]]);
    const pmv2 = (await loadPmv2Replacements(f.db, [original.requestItem])).get(original.requestItem)!;
    expect(pmv2).toHaveLength(1);
    expect(pmv2[0].plan.planId).toBe(last.planId);
    expect(replacementForPhysicalLot(pmv2, { lotId: last.lots[0].lotId, catalogItemId: last.catalogItemId, unit: last.lots[0].unit, quantity: rounds === 2 ? 8 : 12 }).originalQuantity).toBe(4);
    expect(needSnapshot()).toEqual(before);
  });

  it("combines the remaining three of six physical units with the four-unit successor into exactly four original units", async () => {
    const original = seedRoot(); seedRound(1, 1, 6, 4); seedRound(1, 2, 4, 3);
    const before = needSnapshot(), plans = (await loadReplacementFulfillments(f.db, [original.item])).get(original.item)!;
    expect(plans.map(plan => replacementCoverageLimit(plan))).toEqual(["2.000", "2.000"]);
    expect(projectNeed(plans)).toMatchObject({ complete: true, originalCovered: 4 });
    expect(projectNeed(plans).allocations.map(part => [part.quantity, part.originalQuantity])).toEqual([[3, 2], [4, 2]]);
    expect(needSnapshot()).toEqual(before);
  });

  it("denies a successor whose claimed original return lot does not belong to its parent receipt", async () => {
    const original = seedRoot(); seedRound(1, 1, 6, 4); const successor = seedRound(1, 2, 4, 3);
    f.memory.prepare("UPDATE supplier_return_cases SET lotId=999 WHERE id=?").run(successor.case);
    await expect(loadReplacementFulfillments(f.db, [original.item])).rejects.toThrow("مرجع الجولة السابقة");
  });

  it("keeps multiple original requests independent even when duplicate parent IDs are supplied together", async () => {
    const first = seedRoot(1), second = seedRoot(2);
    seedRound(1, 1, 6, 4); seedRound(1, 2, 8, 6); seedRound(2, 1, 10, 4);
    const results = await loadReplacementFulfillments(f.db, [first.item, second.item, first.item, second.item]);
    expect([...results.keys()]).toEqual([first.item, second.item]);
    expect(results.get(first.item)!.map(plan => [plan.sourceItemId, plan.sourceTicketId, replacementCoverageLimit(plan)])).toEqual([
      [first.item, first.ticket, "0.000"], [first.item, first.ticket, "4.000"],
    ]);
    expect(results.get(second.item)![0]).toMatchObject({ sourceItemId: second.item, sourceTicketId: second.ticket, catalogItemId: roundIds(2, 1).catalog });
    expect(projectNeed(results.get(first.item)!)).toMatchObject({ complete: true, originalCovered: 4 });
    expect(projectNeed(results.get(second.item)!)).toMatchObject({ complete: true, originalCovered: 4 });
  });

  it("fails closed for fractional intermediate coverage instead of rounding a two-thirds conversion into a full need", async () => {
    const original = seedRoot(); seedRound(1, 1, 6, 4); seedRound(1, 2, 8, 1);
    const plans = (await loadReplacementFulfillments(f.db, [original.item])).get(original.item)!;
    expect(plans.map(plan => replacementCoverageLimit(plan))).toEqual(["3.333", "0.666"]);
    expect(() => replacementPhysicalToOriginal(plans[0], "1")).toThrow("دقيق");
    expect(() => replacementPhysicalToOriginal(plans[1], "8")).toThrow();
    expect(projectNeed(plans)).toMatchObject({ complete: false, originalCovered: 0, allocations: [] });
    expect(projectNeed(plans).availableOriginal).toBeLessThan(4);
  });

  it("ignores delivery-document returns when subtracting supplier-return coverage", async () => {
    const original = seedRoot(); const first = seedRound(1, 1, 6, 4);
    f.insert("warehouse_returns", { id: 999, lotId: first.lot, receiptId: first.receipt, returnedQuantity: 2, sourceDeliveryDocumentId: 100 });
    const plans = (await loadReplacementFulfillments(f.db, [original.item])).get(original.item)!;
    expect(replacementCoverageLimit(plans[0])).toBe("4.000");
  });

  it("bounds distinct source IDs in chunks at each generation and refreshes the graph in the next request", async () => {
    const original = seedRoot(); seedRound(1, 1, 6, 4); const successor = seedRound(1, 2, 8, 6);
    const sourceIds = [original.item, ...Array.from({ length: 1000 }, (_, i) => 500000 + i)];
    await loadReplacementFulfillments(f.db, [...sourceIds, ...sourceIds, original.item]);
    const reads = f.queries.filter(query => query.sql.includes("AS sourceItemId"));
    expect(reads).toHaveLength(4); // three chunks at root depth, one successor chunk
    expect(reads.map(query => query.params.length)).toEqual([500, 500, 1, 1]);
    f.memory.prepare("UPDATE supplier_return_replacement_plans SET status='purchased' WHERE id=?").run(successor.plan);
    const fresh = (await loadReplacementFulfillments(f.db, [original.item])).get(original.item)!;
    expect(fresh).toHaveLength(1);
    expect(replacementCoverageLimit(fresh[0])).toBe("0.000");
    expect(f.queries.filter(query => query.sql.includes("AS sourceItemId"))).toHaveLength(6);
  });

  it("uses the composed-ratio display helper for PMV2 lot options", () => {
    const source = fs.readFileSync(path.resolve("server/pmv2/materials/team-issue-handoff-service.ts"), "utf8");
    expect(source).toMatch(/originalPerUnit:\s*replacementOriginalPerPhysical\(replacement\.plan\)/);
  });
});

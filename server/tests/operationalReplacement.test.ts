import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { loadOperationalReplacements, applyOperationalReplacementStock, assertOperationalReplacementIdentity, assignableOperationalReplacement } from "../services/operational-issues/replacement";
import { recordOperationalDelivery } from "../services/operational-issues/issue-reference";
import { allocateOperationalFifo, preparedCreateSchema } from "../../shared/operational-dispatch";
import type { ReplacementFulfillment } from "../supplier-return-followup/fulfillment";
import type { OperationalLine, OperationalStock } from "../../shared/operational-issues";

const mock = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock("../supplier-return-followup/fulfillment", async importOriginal => ({
  ...await importOriginal<any>(), loadReplacementFulfillments: mock.load,
}));
const line: OperationalLine = { id: 11, orderId: 1, catalogItemId: 5, itemName: "Original lamp", quantity: 5, unit: "piece", issuedQuantity: 0 };
const makePlan = (): ReplacementFulfillment => ({ planId: 20, caseId: 21, sourceItemId: 501, sourcePurchaseOrderId: 500,
  sourceTicketId: null, sourceTicketItemId: null,
  sourceCatalogItemId: 5, sourceUnit: "piece", originalUnit: "piece", quantityCovered: "3", originalQuantityCovered: "3",
  replacementItemId: 601, replacementPurchaseOrderId: 600, catalogItemId: 9, itemName: "Replacement kit", replacementUnit: "box", orderUnit: "box",
  replacementQuantity: "1", orderQuantity: "1", lots: [{ lotId: 90, trackingToken: "approved-lot", unit: "set", issueUnit: "set", quantity: "6", originalQuantity: "6" }] });
function fixture() {
  const plan = makePlan(); mock.load.mockImplementation(async () => new Map([[501, [plan]]]));
  const state = { ready: true, database: "copycmms2", scopeExists: true, lines: [{ ...line }], deliveries: [] as any[], writes: [] as any[], queries: [] as string[],
    link: { orderItemId: 11, purchaseOrderId: 500, purchaseOrderItemId: 501, quantity: 5, unit: "piece", operationalOrderId: 1,
      operationalOrderExists: 1, operationalSiteId: 1, operationalSectionId: 2, sourceItemExists: 501, sourceOrderExists: 500,
      sourceTicketId: null as number | null, sourceTicketItemId: null as number | null, sourceSiteId: 1, sourceSectionId: 2, hasReplacement: 1 } };
  const tx = { execute: vi.fn(async (query: any) => {
    const { sql: q, params: p } = new MySqlDialect().sqlToQuery(query); state.queries.push(q);
    if (q.includes("information_schema.TABLES")) return [state.ready ? ["supplier_return_cases", "supplier_return_replacement_plans", "supplier_return_replacement_links", "operational_issue_purchase_links"].map(TABLE_NAME => ({ TABLE_NAME })) : []];
    if (q.startsWith("SELECT DATABASE()")) return [[{ databaseName: state.database }]];
    if (q.includes("FROM operational_issue_purchase_links k")) return [[state.link]];
    if (q.includes("FROM sections s")) return [state.scopeExists ? [{ id: 2, siteId: 1 }] : []];
    if (q.includes("FROM operational_issue_deliveries x")) return [structuredClone(state.deliveries.filter(row => p.includes(row.orderItemId)))];
    if (q.startsWith("INSERT INTO operational_issue_deliveries")) {
      state.writes.push({ q, p }); state.deliveries.push({ orderItemId: p[0], quantity: p[3], lotId: 90, unit: "set", catalogItemId: 9 }); return [{ affectedRows: 1 }];
    }
    if (q.includes("FROM operational_issue_items i WHERE")) return [state.lines];
    if (q.startsWith("UPDATE operational_issue_orders")) { state.writes.push({ q, p }); return [{ affectedRows: 1 }]; }
    throw Error(`Unexpected query ${q}`);
  }) };
  return { state, tx, plan };
}
const stock = (itemId: number, catalogId: number, quantity: number, lotId: number, unit: string): OperationalStock => ({ itemId, unit, totalQuantity: quantity, needsReview: false, purchase: null,
  lots: [{ inventoryId: catalogId, warehouseId: 1, warehouseNameAr: "Main", warehouseNameEn: "Main", lotId, lotCode: `LOT-${lotId}`, trackingToken: lotId === 90 ? "approved-lot" : `lot-${lotId}`, unit, quantity, unitCost: 10, receivedAt: "2026-10-30" }] });
beforeEach(() => mock.load.mockReset());
afterEach(() => vi.unstubAllEnvs());

describe("operational need replacement fulfillment", () => {
  it("preserves installations without the optional tables", async () => {
    const f = fixture(); f.state.ready = false;
    expect(await loadOperationalReplacements(f.tx, [line])).toEqual(new Map());
    expect(mock.load).not.toHaveBeenCalled();
  });
  it("leaves production disabled before loading source links", async () => {
    const f = fixture(); f.state.database = "cmms";
    vi.stubEnv("SUPPLIER_RETURN_FOLLOWUP_ENABLED", "false");
    expect(await loadOperationalReplacements(f.tx, [line])).toEqual(new Map());
    expect(f.state.queries.some(q => q.includes("FROM operational_issue_purchase_links k"))).toBe(false);
    vi.unstubAllEnvs();
  });
  it("derives progress in original units while keeping six physical sets in delivery rows", async () => {
    const f = fixture(); f.state.deliveries.push({ orderItemId: 11, quantity: 2, lotId: 70, unit: "piece", catalogItemId: 5 }, { orderItemId: 11, quantity: 6, lotId: 90, unit: "set", catalogItemId: 9 });
    const result = await loadOperationalReplacements(f.tx, [line]);
    expect(result.get(11)?.issued).toBe(5); expect(result.get(11)?.originalIssued).toBe(2);
    expect(f.state.deliveries[1].quantity).toBe(6); expect(line.itemName).toBe("Original lamp");
  });
  it("rejects a plan whose source catalog or unit changed", async () => {
    const f = fixture(); f.plan.sourceUnit = "carton";
    await expect(loadOperationalReplacements(f.tx, [line])).rejects.toThrow("لا يطابق الاحتياج الأصلي");
  });
  it.each(["sourceSiteId", "sourceSectionId", "sourceOrderExists", "sourceItemExists", "operationalOrderExists"] as const)("rejects source scope drift or a missing parent: %s", async field => {
    const f = fixture(); f.state.link[field] = 999;
    await expect(loadOperationalReplacements(f.tx, [line])).rejects.toThrow("سياق طلب الشراء");
  });
  it("rejects a source that was changed to a maintenance ticket", async () => {
    const f = fixture(); f.state.link.sourceTicketId = 100;
    await expect(loadOperationalReplacements(f.tx, [line])).rejects.toThrow("سياق طلب الشراء");
  });
  it("uses the prepared line context instead of the operational header's other site", async () => {
    const f = fixture(); f.state.link.operationalSiteId = 4; f.state.link.operationalSectionId = 5;
    const prepared = { ...line, dispatchContext: { version: 1, warehouseId: 1, warehouseName: "Main", siteId: 1, siteName: "One", sectionId: 2, sectionName: "Two", collectorId: 9, collectorName: "Tech", source: "inventory" } };
    expect((await loadOperationalReplacements(f.tx, [prepared])).has(11)).toBe(true);
  });
  it("rejects a missing site/section and does not treat a hidden plan as an ordinary need", async () => {
    const f = fixture(); f.state.scopeExists = false;
    await expect(loadOperationalReplacements(f.tx, [line])).rejects.toThrow("موقع أو قسم");
    f.state.scopeExists = true; mock.load.mockResolvedValue(new Map());
    await expect(loadOperationalReplacements(f.tx, [line])).rejects.toThrow("روابط استلامها غير متاحة");
  });
  it("rejects actual over-issue rather than merely unused replacement potential", async () => {
    const f = fixture(); f.state.deliveries.push({ orderItemId: 11, quantity: 6, lotId: 70, unit: "piece", catalogItemId: 5 });
    await expect(loadOperationalReplacements(f.tx, [line])).rejects.toThrow("تجاوزت سندات الصرف");
  });
  it("keeps a valid completed need complete when the replacement arrives later", async () => {
    const f = fixture(); f.state.deliveries.push({ orderItemId: 11, quantity: 5, lotId: 70, unit: "piece", catalogItemId: 5 });
    const contexts = await loadOperationalReplacements(f.tx, [line]);
    expect(contexts.get(11)?.issued).toBe(5);
    const [result] = applyOperationalReplacementStock([stock(11, 5, 0, 70, "piece")], [stock(-20, 9, 6, 90, "set")], contexts);
    expect(result.fulfillment?.remainingOriginalQuantity).toBe(0); expect(result.fulfillment?.allocations).toEqual([]);
    expect(result.fulfillment?.ready).toBe(true);
    await expect(assertOperationalReplacementIdentity(f.tx, line, { catalogItemId: 9, lotTrackingToken: "approved-lot", unit: "set", quantity: 1 })).rejects.toThrow();
  });
  it("caps late replacement allocation to unmet need and leaves the rest in stock", async () => {
    const f = fixture(); f.state.deliveries.push({ orderItemId: 11, quantity: 4, lotId: 70, unit: "piece", catalogItemId: 5 });
    const contexts = await loadOperationalReplacements(f.tx, [line]);
    const physicalStock = stock(-20, 9, 6, 90, "set");
    const [result] = applyOperationalReplacementStock([stock(11, 5, 0, 70, "piece")], [physicalStock], contexts);
    expect(allocateOperationalFifo(result, 1).map(lot => lot.quantity)).toEqual([2]);
    expect(physicalStock.lots[0].quantity).toBe(6);
    await expect(assertOperationalReplacementIdentity(f.tx, line, { catalogItemId: 9, lotTrackingToken: "approved-lot", unit: "set", quantity: 3 })).rejects.toThrow();
  });
  it("projects multiple received plans deterministically within the same unmet quantity", async () => {
    const f = fixture();
    f.plan.quantityCovered = f.plan.originalQuantityCovered = "2"; f.plan.lots[0].quantity = f.plan.lots[0].originalQuantity = "4";
    const other = { ...structuredClone(f.plan), planId: 22, caseId: 23, catalogItemId: 10, itemName: "Other approved kit", lots: [{ ...f.plan.lots[0], lotId: 91, trackingToken: "other-approved" }] };
    mock.load.mockResolvedValue(new Map([[501, [other, f.plan]]]));
    f.state.deliveries.push({ orderItemId: 11, quantity: 4, lotId: 70, unit: "piece", catalogItemId: 5 });
    const contexts = await loadOperationalReplacements(f.tx, [line]);
    const otherStock = stock(-22, 10, 4, 91, "set"); otherStock.lots[0].trackingToken = "other-approved";
    const [result] = applyOperationalReplacementStock([stock(11, 5, 0, 70, "piece")], [stock(-20, 9, 4, 90, "set"), otherStock], contexts);
    expect(allocateOperationalFifo(result, 1).map(lot => [lot.lotId, lot.quantity])).toEqual([[90, 2]]);
    expect(result.totalQuantity).toBe(1);
  });
  it("never rounds an indivisible integer physical issue up to a fulfillment", () => {
    const plan = makePlan(); plan.quantityCovered = plan.originalQuantityCovered = "1"; plan.lots[0].quantity = "3";
    expect(assignableOperationalReplacement(plan, 0.7, 3)).toBe(0);
    expect(assignableOperationalReplacement(plan, 1, 3)).toBe(3);
  });
  it("allocates an unchanged original portion and its approved different-unit replacement atomically", async () => {
    const f = fixture(), contexts = await loadOperationalReplacements(f.tx, [line]);
    const [result] = applyOperationalReplacementStock([stock(11, 5, 2, 70, "piece")], [stock(-20, 9, 6, 90, "set")], contexts);
    expect(result.totalQuantity).toBe(5); expect(result.unit).toBe("piece");
    expect(allocateOperationalFifo(result, 5).map(lot => [lot.lotId, lot.quantity, lot.unit])).toEqual([[90, 6, "set"], [70, 2, "piece"]]);
    expect(result.fulfillment?.replacements[0].itemName).toBe("Replacement kit");
    expect(line.catalogItemId).toBe(5);
  });
  it("does not substitute unrelated stock of the same alternative catalog item", async () => {
    const f = fixture(), contexts = await loadOperationalReplacements(f.tx, [line]);
    const [result] = applyOperationalReplacementStock([stock(11, 5, 2, 70, "piece")], [stock(-20, 9, 6, 99, "set")], contexts);
    expect(result.fulfillment?.ready).toBe(false); expect(() => allocateOperationalFifo(result, 5)).toThrow();
  });
  it("does not allocate a same-catalog replacement lot twice", async () => {
    const f = fixture(); f.plan.catalogItemId = 5;
    const contexts = await loadOperationalReplacements(f.tx, [line]);
    const ordinary = stock(11, 5, 8, 70, "piece"); ordinary.lots[0].quantity = 2;
    ordinary.lots.push({ ...stock(-20, 5, 6, 90, "set").lots[0] });
    const [result] = applyOperationalReplacementStock([ordinary], [stock(-20, 5, 6, 90, "set")], contexts);
    expect(allocateOperationalFifo(result, 5).map(lot => lot.lotId)).toEqual([90, 70]);
  });
  it.each([{ covered: "4", physical: "6", available: 5, alternativeIssued: 3 }, { covered: "3", physical: "6", available: 5, alternativeIssued: 4 }])("uses a representable alternative portion plus original stock: %o", async scenario => {
    const f = fixture(), needed = { ...line, quantity: 4 };
    f.plan.quantityCovered = f.plan.originalQuantityCovered = scenario.covered;
    f.plan.lots[0].quantity = f.plan.lots[0].originalQuantity = scenario.physical;
    const context = await loadOperationalReplacements(f.tx, [needed]);
    const [result] = applyOperationalReplacementStock([stock(11, 5, 2, 70, "piece")], [stock(-20, 9, scenario.available, 90, "set")], context);
    expect(result.fulfillment?.ready).toBe(true);
    expect(allocateOperationalFifo(result, 4).map(lot => [lot.lotId, lot.quantity])).toEqual([[90, scenario.alternativeIssued], [70, 2]]);
  });
  it("finds an exact multi-plan fill even when the first greedy plan would leave an impossible residual", async () => {
    const f = fixture(), needed = { ...line, quantity: 7 };
    f.state.link.quantity = 7;
    f.state.deliveries.push({ orderItemId: 11, quantity: 3, lotId: 70, unit: "piece", catalogItemId: 5 });
    f.plan.quantityCovered = f.plan.originalQuantityCovered = "3";
    f.plan.lots[0].quantity = f.plan.lots[0].originalQuantity = "1";
    const other = { ...structuredClone(f.plan), planId: 22, caseId: 23, catalogItemId: 10, quantityCovered: "4", originalQuantityCovered: "4",
      lots: [{ ...f.plan.lots[0], lotId: 91, trackingToken: "other-approved", quantity: "2", originalQuantity: "2" }] };
    mock.load.mockResolvedValue(new Map([[501, [f.plan, other]]]));
    const context = await loadOperationalReplacements(f.tx, [needed]);
    const secondStock = stock(-22, 10, 2, 91, "set"); secondStock.lots[0].trackingToken = "other-approved";
    const [result] = applyOperationalReplacementStock([stock(11, 5, 0, 70, "piece")], [stock(-20, 9, 1, 90, "set"), secondStock], context);
    expect(allocateOperationalFifo(result, 4).map(lot => [lot.lotId, lot.quantity])).toEqual([[91, 2]]);
    expect(f.plan.lots[0].quantity).toBe("1");
  });
  it("still rejects plans whose combined coverage exceeds the original linked source quantity", async () => {
    const f = fixture(); f.state.link.quantity = 4;
    const other = { ...structuredClone(f.plan), planId: 22, caseId: 23, quantityCovered: "4", originalQuantityCovered: "4",
      lots: [{ ...f.plan.lots[0], lotId: 91, trackingToken: "other-approved" }] };
    mock.load.mockResolvedValue(new Map([[501, [f.plan, other]]]));
    await expect(loadOperationalReplacements(f.tx, [{ ...line, quantity: 4 }])).rejects.toThrow("لا يطابق الاحتياج الأصلي");
  });
  it("keeps the existing integer quantity boundary of new operational orders", () => {
    const input = { warehouseId: 1, reason: "UAT integer source boundary", operationKey: "integer-test", items: [
      { catalogItemId: 5, quantity: 0.5, unit: "piece", siteId: 1, sectionId: 2, collectorId: 3, source: "catalog" },
    ] };
    expect(preparedCreateSchema.safeParse(input).success).toBe(false);
    input.items[0].quantity = 1; expect(preparedCreateSchema.safeParse(input).success).toBe(true);
  });
  it("checks current token, catalog, physical unit and remaining plan quantity at the writer boundary", async () => {
    const f = fixture();
    const good = { catalogItemId: 9, lotTrackingToken: "approved-lot", unit: "set", quantity: 6 };
    expect(await assertOperationalReplacementIdentity(f.tx, line, good)).not.toBeNull();
    await expect(assertOperationalReplacementIdentity(f.tx, line, { ...good, lotTrackingToken: "foreign" })).rejects.toThrow();
    await expect(assertOperationalReplacementIdentity(f.tx, line, { ...good, unit: "box" })).rejects.toThrow();
    await expect(assertOperationalReplacementIdentity(f.tx, line, { ...good, quantity: 7 })).rejects.toThrow();
    f.state.deliveries.push({ orderItemId: 11, quantity: 6, lotId: 90, unit: "set", catalogItemId: 9 });
    await expect(assertOperationalReplacementIdentity(f.tx, line, good)).rejects.toThrow();
  });
  it("marks completion only after original-equivalent progress is satisfied without changing physical cost", async () => {
    const f = fixture(); f.state.deliveries.push({ orderItemId: 11, quantity: 2, lotId: 70, unit: "piece", catalogItemId: 5 });
    await recordOperationalDelivery(f.tx, { orderId: 1, itemId: 11, orderNumber: "OPR-TEST", siteId: 1, sectionId: 2, replacementAware: true },
      { deliveryDocumentId: 101, inventoryTransactionId: 102, quantity: 6, lotUnitCost: 10, cost: 60, operationKey: "one", requestFingerprint: "hash", actorId: 20 });
    expect(f.state.writes[0].p.slice(3, 6)).toEqual([6, 10, 60]);
    expect(f.state.writes.at(-1).p[0]).toBe("completed");
  });
  it("does not mark an order complete from raw physical replacement sums when another ordinary line is issued", async () => {
    const f = fixture();
    f.state.lines = [{ ...line, issuedQuantity: 5 }, { ...line, id: 12, catalogItemId: 7, quantity: 1, issuedQuantity: 1 }];
    f.state.deliveries.push({ orderItemId: 11, quantity: 2, lotId: 70, unit: "piece", catalogItemId: 5 }, { orderItemId: 11, quantity: 3, lotId: 90, unit: "set", catalogItemId: 9 });
    await recordOperationalDelivery(f.tx, { orderId: 1, itemId: 12, orderNumber: "OPR-TEST", siteId: 1, sectionId: 2, replacementAware: false },
      { deliveryDocumentId: 201, inventoryTransactionId: 202, quantity: 1, lotUnitCost: 8, cost: 8, operationKey: "ordinary", requestFingerprint: "hash", actorId: 20 });
    expect(f.state.writes.at(-1).p[0]).toBe("approved");
  });
});

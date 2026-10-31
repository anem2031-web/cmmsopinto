import { beforeEach, describe, expect, it, vi } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
const facts = vi.hoisted(() => ({ rows: [] as any[], active: true, alternativeStock: 6, originalStock: 0, extraStock: 0, sameCatalog: false }));
vi.mock("../supplier-return-followup/runtime", () => ({ trialEnabled: async () => true, readRows: async () => facts.rows }));
import { ProductionMaterialGateway } from "../routers/maintenance-teams/execution.materials";
import { issued, remainingReturn, type Snapshot } from "../../shared/maintenance-team-tickets/model";
import { createDemo } from "../maintenance-team-tickets/testing/fixture";
import { MaintenanceTeamTicketService } from "../maintenance-team-tickets/service";
const dialect = new MySqlDialect();
function fixture() {
  const state = { users: [{ id: 2, active: true, role: "warehouse" }, { id: 3, active: true, role: "technician" }],
    teams: [{ id: 21, active: true }], memberships: [{ teamId: 21, userId: 3, active: true }],
    assignments: [{ id: 1, teamId: 21, ticketId: 100, ticketItemId: 101 }], tickets: [{ ticketId: 100 }],
    needs: [{ id: 20, assignmentId: 1, catalogItemId: 9, unit: "حبة", requested: 4, name: "الأصل", originalName: "الأصل", used: null }],
    supplies: [{ id: 30, needId: 20, kind: "purchase", sourceId: 7, quantity: 4, status: "received" }], deliveries: [] } as unknown as Snapshot;
  const writes: any[] = [];
  const tx = { execute: async (q: any) => {
    const { sql: text, params } = dialect.sqlToQuery(q);
    if (text.startsWith("SELECT c.id,c.isActive")) return [params.map(id => ({ id, isActive: facts.active ? 1 : 0, inactiveUnit: 0 }))];
    if (text.startsWith("SELECT id,isActive FROM warehouses")) return [[{ id: params[0], isActive: 1 }]];
    if (text.startsWith("SELECT id,quantity,issueUnit")) return [[params[1] === 12
      ? { id: 55, quantity: facts.alternativeStock, issueUnit: "قطعة", unit: "قطعة", isFrozen: 0 }
      : params[1] === 13 ? { id: 57, quantity: facts.extraStock, issueUnit: "قطعة", unit: "قطعة", isFrozen: 0 }
      : { id: 56, quantity: facts.originalStock, issueUnit: "حبة", unit: "حبة", isFrozen: 0 }]];
    if (text.startsWith("SELECT b.lotId")) return [[params[0] === 55
      ? { lotId: 14, quantity: facts.alternativeStock, trackingToken: "LOT-TEST", issueUnit: "قطعة", catalogItemId: 12 }
      : params[0] === 57 ? { lotId: 15, quantity: facts.extraStock, trackingToken: "LOT-B", issueUnit: "قطعة", catalogItemId: 13 }
      : facts.sameCatalog ? { lotId: 14, quantity: facts.originalStock, trackingToken: "LOT-TEST", issueUnit: "حبة", catalogItemId: 9 }
      : { lotId: 114, quantity: facts.originalStock, trackingToken: "LOT-ORIGINAL", issueUnit: "حبة", catalogItemId: 9 }]];
    throw Error(`Unexpected ${text}`);
  } } as any;
  const writers = async () => ({ lotsEnabled: () => true, issue: async (input: any) => {
    writes.push(input);
    if (input.lotTrackingToken === "LOT-TEST") facts.alternativeStock -= input.quantity;
    else if (input.lotTrackingToken === "LOT-B") facts.extraStock -= input.quantity;
    else facts.originalStock -= input.quantity;
    return { deliveryDocumentId: 90 + writes.length, deliveryNumber: `DLV-TEST-${writes.length}`, lotId: input.lotTrackingToken === "LOT-TEST" ? 14 : input.lotTrackingToken === "LOT-B" ? 15 : 114, inventoryTransactionId: 190 + writes.length };
  } } as any);
  return { state, writes, gateway: new ProductionMaterialGateway(tx, state, { id: 2, role: "warehouse", active: true }, {}, writers) };
}
beforeEach(() => { facts.active = true; facts.alternativeStock = 6; facts.originalStock = 0; facts.extraStock = 0; facts.sameCatalog = false; facts.rows = [{ planId: 5, caseId: 6, sourceItemId: 7, sourcePurchaseOrderId: 8,
  sourceTicketId: 100, sourceTicketItemId: 101, sourceCatalogItemId: 9, sourceUnit: "حبة", originalQuantityCovered: "4",
  replacementItemId: 10, replacementPurchaseOrderId: 11, catalogItemId: 12, itemName: "بديل", replacementUnit: "علبة", replacementQuantity: "2",
  receiptLinkId: 13, receivedQuantity: "2", receivedUnit: "علبة", compensatedOriginalQuantity: "4", originalUnit: "حبة",
  lotId: 14, trackingToken: "LOT-TEST", issueUnit: "قطعة", lotQuantity: "6" }]; });
describe("team replacement physical fulfillment", () => {
  it("issues the approved physical alternative and projects original coverage without rewriting the need", async () => {
    const f = fixture();
    const result = await f.gateway.issueNeed(20, { operationKey: "test", ticketId: 100, ticketNumber: "MT-TEST", warehouseId: 22,
      catalogItemId: 9, quantity: 4, unit: "حبة", receiverId: 3, location: { siteId: 1, sectionId: 2 } });
    expect(result[0]).toMatchObject({ catalogItemId: 12, quantity: 6, unit: "قطعة", originalEquivalent: 4 });
    expect(f.writes[0]).toMatchObject({ quantity: 6, unit: "قطعة", lotTrackingToken: "LOT-TEST" });
    expect(f.state.needs[0]).toMatchObject({ catalogItemId: 9, name: "الأصل", requested: 4, unit: "حبة" });
  });
  it("rejects a replacement from another ticket or original unit before stock issue", async () => {
    const f = fixture(); facts.rows[0].sourceTicketItemId = 999;
    await expect(f.gateway.replacementContext(20)).rejects.toThrow("لا يطابق");
    expect(f.writes).toHaveLength(0);
  });
  it("rechecks current catalog activity before a new physical issue", async () => {
    const f = fixture();
    expect(await f.gateway.availability(22, 9)).toBe(4);
    facts.active = false;
    await expect(f.gateway.issueNeed(20, { operationKey: "test", ticketId: 100, ticketNumber: "MT-TEST", warehouseId: 22,
      catalogItemId: 9, quantity: 4, unit: "حبة", receiverId: 3, location: { siteId: 1, sectionId: 2 } })).rejects.toThrow("غير نشط");
    expect(f.writes).toHaveLength(0);
  });
  it("fills a mixed need with three representable alternative pieces plus two original units", async () => {
    const f = fixture(); facts.alternativeStock = 5; facts.originalStock = 2;
    const rows = await f.gateway.issueNeed(20, { operationKey: "mixed", ticketId: 100, ticketNumber: "MT-TEST", warehouseId: 22,
      catalogItemId: 9, quantity: 4, unit: "حبة", receiverId: 3, location: { siteId: 1, sectionId: 2 } });
    expect(rows).toMatchObject([{ catalogItemId: 12, quantity: 3, originalEquivalent: 2 }, { catalogItemId: 9, quantity: 2, originalEquivalent: 2 }]);
    expect(rows.reduce((sum, row) => sum + (row.originalEquivalent ?? row.quantity), 0)).toBe(4);
    expect(facts.alternativeStock).toBe(2); expect(facts.originalStock).toBe(0);
    expect(f.state.needs[0]).toMatchObject({ catalogItemId: 9, requested: 4, unit: "حبة" });
  });
  it("selects the exact later plan for a four-unit remainder after three original units were delivered", async () => {
    const f = fixture(); f.state.needs[0].requested = 7; f.state.supplies[0].quantity = 7;
    f.state.deliveries = [{ needId: 20, quantity: 3, lotId: 114 } as any];
    facts.alternativeStock = 1; facts.extraStock = 2;
    const first = facts.rows[0]; Object.assign(first, { originalQuantityCovered: "3", compensatedOriginalQuantity: "3", replacementQuantity: "1", receivedQuantity: "1", lotQuantity: "1" });
    facts.rows.push({ ...first, planId: 105, caseId: 106, replacementItemId: 110, replacementPurchaseOrderId: 111, catalogItemId: 13,
      originalQuantityCovered: "4", compensatedOriginalQuantity: "4", replacementQuantity: "2", receivedQuantity: "2", lotQuantity: "2", receiptLinkId: 113, lotId: 15, trackingToken: "LOT-B" });
    const rows = await f.gateway.issueNeed(20, { operationKey: "multi", ticketId: 100, ticketNumber: "MT-TEST", warehouseId: 22,
      catalogItemId: 9, quantity: 4, unit: "حبة", receiverId: 3, location: { siteId: 1, sectionId: 2 } });
    expect(rows).toMatchObject([{ catalogItemId: 13, quantity: 2, originalEquivalent: 4 }]);
    expect(facts.alternativeStock).toBe(1); expect(facts.extraStock).toBe(0);
  });
  it("does not count a same-catalog approved replacement lot again as ordinary one-to-one stock", async () => {
    const f = fixture(); facts.sameCatalog = true; facts.originalStock = 5;
    Object.assign(facts.rows[0], { catalogItemId: 9, issueUnit: "حبة" });
    expect(await f.gateway.availability(22, 9)).toBe(2);
    await expect(f.gateway.issueNeed(20, { operationKey: "same-catalog", ticketId: 100, ticketNumber: "MT-TEST", warehouseId: 22,
      catalogItemId: 9, quantity: 4, unit: "حبة", receiverId: 3, location: { siteId: 1, sectionId: 2 } })).rejects.toThrow("لا يغطي");
    expect(f.writes).toHaveLength(0);
  });
  it("does not credit warehouse extras beyond this need's linked source quantity", async () => {
    const f = fixture(); f.state.supplies[0].quantity = 2; facts.originalStock = 2;
    const rows = await f.gateway.issueNeed(20, { operationKey: "source-cap", ticketId: 100, ticketNumber: "MT-TEST", warehouseId: 22,
      catalogItemId: 9, quantity: 4, unit: "حبة", receiverId: 3, location: { siteId: 1, sectionId: 2 } });
    expect(rows).toMatchObject([{ catalogItemId: 12, quantity: 3, originalEquivalent: 2 }, { catalogItemId: 9, quantity: 2, originalEquivalent: 2 }]);
    expect(facts.alternativeStock).toBe(3);
  });
  it("keeps physical returns separate from original-unit progress", () => {
    const f = fixture();
    f.state.deliveries = [{ id: 1, needId: 20, quantity: 6, originalEquivalent: 4, returned: 3 } as any];
    f.state.needs[0].used = 2;
    expect(issued(f.state, 20)).toBe(4); expect(remainingReturn(f.state, 20)).toBe(0);
  });
  it("records five actual pieces used and one returned for a six-piece replacement of four original units", async () => {
    const demo = createDemo();
    const ticket = (await demo.store.read()).tickets[0];
    const a = await demo.service.assign(1, { ...ticket, teamId: 21 });
    let seq = 0, returned = 0;
    const command = async (operationKey = `replacement-${++seq}`) => ({ assignmentId: a.id,
      expectedRevision: (await demo.store.read()).assignments[0].revision, operationKey });
    const service = new MaintenanceTeamTicketService({ read: () => demo.store.read(), transaction: work => demo.store.transaction((state, effects) => work(state, {
      ...effects,
      issueNeed: async () => [{ deliveryId: 91, deliveryNumber: "DLV-ALTERNATIVE", lotId: 14, inventoryTransactionId: 92,
        catalogItemId: 12, warehouseId: 20, quantity: 6, unit: "متر", receivedById: 3, originalEquivalent: 4, replacementPlanId: 5, replacementName: "بديل معتمد" }],
      returnToWarehouse: async input => { returned++; expect(input.quantity).toBe(1); return { returnId: 901, returnNumber: "RTN-ALTERNATIVE", quantity: input.quantity }; },
    })) });
    await service.requestMaterials(3, await command(), [{ catalogItemId: 101, unit: "قطعة", quantity: 4 }]);
    const need = (await demo.store.read()).needs[0];
    await service.receiveMaterial(3, await command(), need.id);
    await service.submitOutcome(3, await command(), "fixed", { note: "تم الإصلاح", usages: [], physicalUsages: [{ deliveryId: 91, used: 5 }] });
    let state = await demo.store.read();
    expect(state.needs[0].used).toBeNull(); expect(state.deliveries[0].used).toBe(5);
    expect(issued(state, need.id)).toBe(4); expect(remainingReturn(state, need.id)).toBe(1);
    const retry = await command("same-return");
    await service.confirmReturn(2, retry, need.id); await service.confirmReturn(2, retry, need.id);
    state = await demo.store.read(); expect(returned).toBe(1); expect(state.deliveries[0].returned).toBe(1);
    expect(state.deliveries[0].used).toBe(5); expect(remainingReturn(state, need.id)).toBe(0);
    expect(state.needs[0]).toMatchObject({ name: "قاطع كهربائي", catalogItemId: 101, requested: 4 });
  });
});

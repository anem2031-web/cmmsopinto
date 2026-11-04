import { describe, expect, it, vi } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { OperationalIssueService } from "../services/operational-issues/service";
import { createOperationalIssuesRouter } from "../routers/operational-issues/router";
import { router } from "../routers/_shared/procedures";
import type { TrpcContext } from "../_core/context";

const warehouse = { id: 20, role: "warehouse", isActive: 1, name: "Warehouse" };
const inventory = (id: number, quantity: number, unit = "حبة", catalogId = 5) => ({ id, linkedItemId: catalogId, quantity, unit, warehouseId: id,
  warehouseNameAr: `مخزن ${id}`, warehouseNameEn: `Warehouse ${id}`, active: true, frozen: false });
const lot = (inventoryId: number, id: number, quantity: number, cost = 10) => ({ inventoryId, lotId: id, catalogItemId: 5, quantity,
  lotCode: `LOT-${id}`, trackingToken: `token-${id}`, issueUnit: "حبة", issueUnitCost: cost, remainingQuantity: quantity });

function fixture() {
  let state: any = {
    orders: [{ id: 1, createdById: 10, orderNumber: "OPR-TEST-1", siteId: 1, sectionId: 2, collectorId: 101, reason: "تشغيل الموقع", status: "approved", revision: 1 }],
    items: [{ id: 11, orderId: 1, catalogItemId: 5, itemName: "لمبة", quantity: 3, issuedQuantity: 0, unit: "حبة" },
      { id: 12, orderId: 1, catalogItemId: 6, itemName: "سلك", quantity: 2, issuedQuantity: 0, unit: "حبة" }],
    inventories: [], lots: [], links: [], headers: [], poItems: [], audits: [],
  };
  const flags = { ready: true, catalogActive: true, validSection: true, failItems: false, failLink: false, unitActive: true };
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  let queue: Promise<unknown> = Promise.resolve();
  const result = (data: any[]) => [structuredClone(data)];
  const tx: any = { execute: async (query: any) => {
    const { sql: q, params: p } = new MySqlDialect().sqlToQuery(query); queries.push({ sql: q, params: p });
    if (q.includes("information_schema.TABLES")) return result(flags.ready ? [{ TABLE_NAME: "operational_issue_purchase_links" }] : []);
    if (q.includes("FROM operational_issue_orders o")) return result(state.orders.filter((o: any) => o.id === p[0]));
    if (q.startsWith("SELECT * FROM operational_issue_items")) return result(state.items.filter((i: any) => i.orderId === p[0]));
    if (q.startsWith("SELECT i.*,COALESCE")) return result(state.items.filter((i: any) => i.id === p[0] && i.orderId === p[1]));
    if (q.includes("FROM inventory i INNER JOIN warehouses w")) return result(state.inventories.filter((i: any) => p.includes(i.linkedItemId) && i.active && !i.frozen && (!q.includes("AND w.id=?") || i.warehouseId === p.at(-1))));
    if (q.includes("FROM inventory_lot_balances b")) return result(state.lots.filter((l: any) => l.quantity > 0 && state.inventories.some((i: any) => i.id === l.inventoryId && p.includes(i.linkedItemId))));
    if (q.includes("FROM operational_issue_purchase_links k")) {
      return result(state.links.flatMap((k: any) => {
        const i = state.items.find((i: any) => i.id === k.orderItemId && i.orderId === p[0]);
        const o = state.orders.find((o: any) => o.id === i?.orderId);
        const h = state.headers.find((h: any) => h.id === k.purchaseOrderId && h.status !== "rejected");
        const j = state.poItems.find((j: any) => j.id === k.purchaseOrderItemId && j.purchaseOrderId === h?.id && !["cancelled", "rejected", "purchase_cancelled"].includes(j.status));
        return i && o && h && j ? [{ ...k, ...j, orderItemId: k.orderItemId, purchaseOrderItemId: j.id, poNumber: h.poNumber, status: h.status,
          itemStatus: j.status, linkedQuantity: k.quantity, linkedUnit: k.unit, siteId: h.siteId, sectionId: h.sectionId, ticketId: h.ticketId,
          expectedCatalogItemId: i.catalogItemId, expectedSiteId: o.siteId, expectedSectionId: o.sectionId }] : [];
      }));
    }
    if (q.includes("FROM catalog_items WHERE")) return result(flags.catalogActive ? [{ id: p[0], nameAr: "صنف رسمي", unit: "حبة" }] : []);
    if (q.includes("FROM sections s INNER JOIN sites")) return result(flags.validSection && ((p[0] === 2 && p[1] === 1) || (p[0] === 4 && p[1] === 3)) ? [{ id: p[0] }] : []);
    if (q.startsWith("SELECT p.id,p.poNumber")) return result(state.headers.filter((h: any) => h.id === p[0] && h.status === "draft" && h.requestedById === p[1] && h.siteId === p[2] && h.sectionId === p[3] && !h.ticketId));
    if (q.startsWith("SELECT COUNT(*) AS count")) return result([{ count: state.poItems.filter((i: any) => i.purchaseOrderId === p[0]).length }]);
    if (q.startsWith("SELECT id FROM purchase_order_items")) return result(state.poItems.filter((i: any) => i.purchaseOrderId === p[0] && i.catalogItemId === p[1]).slice(-1));
    if (q.startsWith("INSERT INTO operational_issue_purchase_links")) {
      if (flags.failLink) throw Error("link failure");
      const link = { orderItemId: p[0], purchaseOrderId: p[1], purchaseOrderItemId: p[2], quantity: p[3], unit: p[4], createdById: p[5] };
      state.links = state.links.filter((l: any) => l.orderItemId !== p[0]); state.links.push(link); return [{ affectedRows: 1 }];
    }
    if (q.startsWith("INSERT INTO audit_logs")) { state.audits.push(p); return [{ affectedRows: 1 }]; }
    throw Error(`Unhandled fixture query: ${q}`);
  } };
  const database = { execute: tx.execute, transaction: (work: (tx: any) => Promise<any>) => {
    const current = queue.then(async () => { const before = structuredClone(state); try { return await work(tx); } catch (e) { state = before; throw e; } });
    queue = current.catch(() => {}); return current;
  } };
  const ports = { database: vi.fn(async () => database), issue: vi.fn(), returnDelivery: vi.fn(), resolveLot: vi.fn(), purchaseDraft: {
    nextNumber: vi.fn(async () => `DFT-2026-${state.headers.length + 1}`),
    create: vi.fn(async (_tx: any, values: any) => { const id = state.headers.length + 1; state.headers.push({ id, ...values }); return id; }),
    createItems: vi.fn(async (_tx: any, values: any[]) => { if (flags.failItems) throw Error("item failure"); for (const value of values) state.poItems.push({ id: state.poItems.length + 1, ...value }); }),
    validateUnit: vi.fn(async () => { if (!flags.unitActive) throw Error("inactive unit"); }),
  } };
  const service = new OperationalIssueService(ports);
  const caller = (actor = warehouse, enabled = true) => router({ operationalIssues: createOperationalIssuesRouter(ports, () => enabled) }).createCaller({ user: actor, req: {}, res: {} } as TrpcContext);
  return { state: () => state, flags, queries, ports, service, caller, add: (itemId = 11, actor = warehouse) => service.addToPurchaseDraft(actor, 1, itemId) };
}

describe("Operational catalog availability and original physical lots", () => {
  it("reports each warehouse/lot with immutable price without multiplying aggregate stock", async () => {
    const f = fixture(); f.state().inventories.push(inventory(1, 3), inventory(2, 2));
    f.state().lots.push(lot(1, 101, 1, 10), lot(1, 102, 2, 20), lot(2, 103, 2, 30));
    const data = await f.caller().operationalIssues.availability({ id: 1 });
    expect(data.items[0]).toMatchObject({ totalQuantity: 5, needsReview: false, purchase: null });
    expect(data.items[0].lots.map(l => [l.warehouseNameAr, l.lotCode, l.quantity, l.unitCost])).toEqual([["مخزن 1", "LOT-101", 1, 10], ["مخزن 1", "LOT-102", 2, 20], ["مخزن 2", "LOT-103", 2, 30]]);
    expect(f.ports.issue).not.toHaveBeenCalled(); expect(f.state().audits).toHaveLength(0);
    expect(f.queries.some(q => q.sql.includes("i.warehouseId IS NULL"))).toBe(true);
  });
  it("excludes frozen/inactive warehouses and does not treat positive stock without lots as zero", async () => {
    const f = fixture(); f.state().inventories.push(inventory(1, 3), { ...inventory(2, 2), active: false }, { ...inventory(3, 7), frozen: true });
    const data = await f.service.availability(warehouse, 1);
    expect(data.items[0]).toMatchObject({ totalQuantity: 3, needsReview: true, lots: [] });
    await expect(f.add()).rejects.toMatchObject({ code: "CONFLICT" }); expect(f.state().headers).toHaveLength(0);
  });
  it.each(["unit", "identity", "coverage", "ambiguous"])("flags %s disagreement and does not silently offer purchase instead", async scenario => {
    const f = fixture(); f.state().inventories.push(inventory(1, 3, scenario === "unit" ? "كرتون" : "حبة"));
    f.state().lots.push({ ...lot(1, 101, scenario === "coverage" ? 2 : 3), catalogItemId: scenario === "identity" ? 99 : 5 });
    if (scenario === "ambiguous") { f.state().inventories.push(inventory(2, 3)); f.state().inventories[1].warehouseId = 1; f.state().lots.push(lot(2, 101, 3)); }
    const { items } = await f.service.availability(warehouse, 1); expect(items[0].needsReview).toBe(true);
    await expect(f.add()).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("keeps stock visible before manual DDL and blocks procurement until its table exists", async () => {
    const f = fixture(); f.flags.ready = false;
    expect((await f.service.availability(warehouse, 1)).procurementReady).toBe(false);
    await expect(f.add()).rejects.toMatchObject({ code: "PRECONDITION_FAILED" }); expect(f.state().headers).toHaveLength(0);
  });
  it.each([-1, 0])("requires review for a lot balance against aggregate quantity %s", async quantity => {
    const f = fixture(); f.state().inventories.push(inventory(1, quantity)); f.state().lots.push(lot(1, 101, 1));
    expect((await f.service.availability(warehouse, 1)).items[0].needsReview).toBe(true);
    await expect(f.add()).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it.each(["it_manager", "maintenance_manager", "technician", "delegate"])("does not give %s warehouse stock access", async role => {
    const f = fixture(); await expect(f.service.availability({ id: 10, role, isActive: 1 }, 1)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(f.ports.database).not.toHaveBeenCalled();
  });
  it("allows observer read while central RPC denies procurement and inactive users", async () => {
    const f = fixture(); const actor = { ...warehouse, role: "observer" };
    expect((await f.caller(actor).operationalIssues.availability({ id: 1 })).items).toHaveLength(2);
    await expect(f.caller(actor).operationalIssues.addToPurchaseDraft({ orderId: 1, itemId: 11 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(f.service.availability({ ...warehouse, isActive: 0 }, 1)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("Zero-stock requirement → existing purchase draft", () => {
  it.each(["pending", "rejected"])("withholds %s construction lots without reporting a false balance mismatch or hiding ordinary lots", async specificationStatus => {
    const f = fixture();
    f.state().inventories.push(inventory(1, 5));
    f.state().lots.push({ ...lot(1, 10, 2), specificationStatus }, { ...lot(1, 11, 3), specificationStatus: null });
    const stock = (await f.service.availability(warehouse, 1)).items[0];
    expect(stock.totalQuantity).toBe(3);
    expect(stock.needsReview).toBe(false);
    expect(stock.lots.map((entry: any) => entry.lotId)).toEqual([11]);
    expect(f.state().inventories[0].quantity).toBe(5);
  });
  it("retains the prepared line's site/section in its purchase draft and link comparison", async () => {
    const f = fixture();
    f.state().items[1].dispatchContext = JSON.stringify({version:1,warehouseId:1,warehouseName:"Main",siteId:3,siteName:"Site3",sectionId:4,sectionName:"Section4",collectorId:101,collectorName:"Technician",source:"catalog"});
    await f.add(12);
    expect(f.state().headers[0]).toMatchObject({siteId:3,sectionId:4});
    expect((await f.service.availability(warehouse,1)).items[1].purchase).toMatchObject({changed:false});
    expect(await f.add(12)).toMatchObject({existing:true});
    expect(f.state().headers).toHaveLength(1);
  });
  it("checks the prepared source warehouse rather than blocking on another warehouse's stock", async () => {
    const f = fixture();
    f.state().items[0].dispatchContext = JSON.stringify({version:1,warehouseId:1,warehouseName:"Main",siteId:1,siteName:"Site",sectionId:2,sectionName:"Section",collectorId:101,collectorName:"Technician",source:"catalog"});
    f.state().inventories.push(inventory(2,10));f.state().lots.push(lot(2,50,10));
    expect(await f.add(11)).toMatchObject({quantity:3,existing:false});
    expect(f.state().inventories[0].quantity).toBe(10);
  });
  it("atomically saves draft, catalog line and exact source reference without issuing or submitting", async () => {
    const f = fixture(); const data = await f.caller().operationalIssues.addToPurchaseDraft({ orderId: 1, itemId: 11 });
    expect(data).toMatchObject({ purchaseOrderId: 1, purchaseOrderItemId: 1, quantity: 3, status: "draft", existing: false });
    expect(f.state().headers[0]).toMatchObject({ status: "draft", siteId: 1, sectionId: 2, requestedById: 20 });
    expect(f.state().headers[0].notes).toContain("OPR-TEST-1"); expect(f.state().headers[0].ticketId).toBeUndefined();
    expect(f.state().poItems[0]).toMatchObject({ catalogItemId: 5, quantity: 3, unit: "حبة", requiredDate: null, deliveryLeadDays: 4, status: "pending" });
    expect(f.state().links[0]).toMatchObject({ orderItemId: 11, purchaseOrderId: 1, purchaseOrderItemId: 1 });
    expect(f.ports.issue).not.toHaveBeenCalled(); expect(f.state().orders[0]).toMatchObject({ status: "approved", revision: 1 });
    expect(f.state().audits).toHaveLength(1);
  });
  it("serializes duplicate clicks and returns the original document even after submission/stock arrival", async () => {
    const f = fixture(); const results = await Promise.all([f.add(), f.add()]);
    expect(results.map(r => r.purchaseOrderId)).toEqual([1, 1]); expect(f.state().headers).toHaveLength(1); expect(f.state().poItems).toHaveLength(1);
    f.state().headers[0].status = "pending_review"; f.state().inventories.push(inventory(1, 10));
    expect(await f.add()).toMatchObject({ purchaseOrderId: 1, existing: true }); expect(f.state().poItems).toHaveLength(1);
  });
  it("adds other items from the same order into the same actor-owned draft", async () => {
    const f = fixture(); await Promise.all([f.add(11), f.add(12)]);
    expect(f.state().headers).toHaveLength(1); expect(f.state().poItems.map((i: any) => i.catalogItemId)).toEqual([5, 6]);
    expect(f.state().links.map((l: any) => l.orderItemId)).toEqual([11, 12]);
  });
  it("does not append to another creator's draft", async () => {
    const f = fixture(); await f.add(11); await f.add(12, { ...warehouse, id: 21 });
    expect(f.state().headers).toHaveLength(2); expect(f.state().headers[1].requestedById).toBe(21);
  });
  it.each(["failItems", "failLink"] as const)("rolls back header/items/link/audit on %s", async flag => {
    const f = fixture(); f.flags[flag] = true; await expect(f.add()).rejects.toThrow();
    expect(f.state().headers).toHaveLength(0); expect(f.state().poItems).toHaveLength(0); expect(f.state().links).toHaveLength(0); expect(f.state().audits).toHaveLength(0);
  });
  it("buys only the unissued requirement", async () => {
    const f = fixture(); f.state().items[0].issuedQuantity = 2; expect(await f.add()).toMatchObject({ quantity: 1 });
  });
  it.each(["pending", "completed"])("does not procure for a %s order", async status => {
    const f = fixture(); f.state().orders[0].status = status; await expect(f.add()).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("rejects wrong-parent items and fully covered stock without creating documents", async () => {
    const f = fixture(); f.state().items[0].orderId = 999; await expect(f.add()).rejects.toMatchObject({ code: "BAD_REQUEST" });
    f.state().items[0].orderId = 1; f.state().inventories.push(inventory(1, 3)); f.state().lots.push(lot(1, 1, 3));
    await expect(f.add()).rejects.toMatchObject({ code: "CONFLICT" }); expect(f.state().headers).toHaveLength(0);
  });
  it("buys only the shortage when positive stock cannot cover the full requirement, without duplicate purchase", async () => {
    const f = fixture(); f.state().inventories.push(inventory(1, 1)); f.state().lots.push(lot(1, 1, 1));
    expect(await f.add()).toMatchObject({ quantity: 2, existing: false });
    expect(await f.add()).toMatchObject({ quantity: 2, existing: true, changed: false });
    expect(f.state().headers).toHaveLength(1); expect(f.state().poItems).toHaveLength(1);
    expect(f.state().inventories[0].quantity).toBe(1); expect(f.ports.issue).not.toHaveBeenCalled();
  });
  it.each(["catalogActive", "validSection", "unitActive"] as const)("validates %s before saving a new purchase relationship", async flag => {
    const f = fixture(); f.flags[flag] = false; await expect(f.add()).rejects.toThrow(); expect(f.state().headers).toHaveLength(0);
  });
  it("marks edited linked quantities for review and never creates a second active purchase", async () => {
    const f = fixture(); await f.add(); f.state().poItems[0].quantity = 9;
    expect((await f.service.availability(warehouse, 1)).items[0].purchase).toMatchObject({ changed: true, quantity: 9 });
    expect(await f.add()).toMatchObject({ changed: true, existing: true }); expect(f.state().poItems).toHaveLength(1);
  });
  it("can replace a removed draft line, preserving normal draft editing", async () => {
    const f = fixture(); await f.add(); f.state().poItems = [];
    expect(await f.add()).toMatchObject({ existing: false }); expect(f.state().links).toHaveLength(1);
    expect(f.state().headers).toHaveLength(2);
  });
  it("keeps the disabled feature and manager API mutations blocked", async () => {
    const f = fixture();
    await expect(f.caller(warehouse, false).operationalIssues.addToPurchaseDraft({ orderId: 1, itemId: 11 })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await expect(f.caller({ ...warehouse, id: 10, role: "it_manager" }).operationalIssues.addToPurchaseDraft({ orderId: 1, itemId: 11 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(f.ports.database).not.toHaveBeenCalled();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { pmv2ApprovedMaterialQuantity, assertPmv2UnitApprovalUntouched } from "../pmv2/materials/catalog-unit-policy";

const boundary = vi.hoisted(() => ({ db: null as any, catalog: null as any, stockUnit: "قطعة", stockQuantity: 0, audits: [] as any[] }));
vi.mock("../_core/db/client", () => ({ getDb: async () => boundary.db }));
vi.mock("../_core/db/notifications", () => ({ createNotification: async () => {} }));
vi.mock("../pmv2/audit/service", () => ({ writePmv2AuditWithDb: async (_tx: any, event: any) => { boundary.audits.push(structuredClone(event)); } }));
vi.mock("../pmv2/translation-queue", () => ({ queuePmv2Translation: async () => {} }));
vi.mock("../pmv2/technician/read-service", () => ({ Pmv2TechnicianAccessError: class extends Error {} }));
vi.mock("../pmv2/security/execution-access", () => ({ pmv2ExecutionActor: {}, pmv2ExecutionActorCondition: () => undefined, pmv2ExecutionTeamCondition: () => undefined }));
vi.mock("../pmv2/materials/replacement-coverage", () => ({}));
vi.mock("../pmv2/adapters/current-system", () => ({
  Pmv2ExternalReferenceError: class extends Error {},
  currentCatalogAdapter: { requireActiveItem: async () => ({ ...boundary.catalog }), getItemsByIds: async () => [{ ...boundary.catalog }], searchActiveItems: async () => [{ ...boundary.catalog }] },
  currentWarehouseAdapter: { requireActiveWarehouse: async (id: number) => ({ id }), requireSingleActiveMainWarehouse: async () => ({ id: 1 }) },
  currentInventoryAdapter: { getCatalogAvailability: async (_id: number, warehouseId: number) => ({ warehouseId, inventoryId: boundary.stockQuantity ? 10 : null,
    availableQuantity: boundary.stockQuantity, unit: boundary.stockUnit, ambiguous: false, lotsRequired: true }), getCatalogAvailabilities: async () => [] },
}));
import { Pmv2MaterialIdentityResolutionService } from "../pmv2/materials/material-identity-resolution-service";
import { Pmv2MaterialRequestService } from "../pmv2/materials/request-service";
import { Pmv2TeamIssueHandoffService } from "../pmv2/materials/team-issue-handoff-service";

const route = { version: 1, route: "material_request", catalogItemId: null, itemNameSnapshot: "وصف الفني", requestedQuantity: 3,
  unit: "حبة", teamWarehouseId: 4, inventoryId: null, availableQuantity: null, shortageQuantity: 3, materialRequestId: 6, materialRequestItemId: 7 };
function fixture() {
  let state: any = { context: { requestItemId: 7, requestId: 6, catalogItemId: null, itemNameSnapshot: "وصف الفني", requestedQuantity: "3", unitSnapshot: "حبة", status: "waiting_warehouse",
    receivedWarehouseQuantity: 0, issuedToTeamQuantity: 0, taskItemId: 2, taskId: 1, taskNumber: "PMV2-TEST", taskStatus: "in_progress", itemStatus: "waiting_material", itemResult: "needs_material",
    visitId: 3, requestedById: 15, teamId: 5, teamWarehouseId: 4 }, actions: [{ id: 50, action: "material_route_decision", note: JSON.stringify(route) }],
    actor: { id: 9, role: "warehouse", isActive: 1 }, history: false, duplicates: [], writes: [] };
  function dbFor(work: any): any {
    const chain = (rows: any[]) => {
      const query: any = { from: () => query, innerJoin: () => query, where: () => query, orderBy: () => query, limit: () => query,
        then: (resolve: any, reject: any) => Promise.resolve(rows).then(resolve, reject) };
      return query;
    };
    return {
      select(fields: any) {
        if (fields.requestItemId && fields.requestedQuantity) return chain([structuredClone(work.context)]);
        if (fields.requestItemId) return chain([]); // No other active material request.
        if (fields.taskItemId) return chain([structuredClone(work.context)]);
        if (fields.visitId) return chain([{ id: 40, visitId: 3 }]);
        if (fields.action) return chain(work.actions);
        if (fields.note) return chain(work.actions.filter((row: any) => row.action === "material_route_decision"));
        if (fields.id) return chain(work.duplicates);
        return chain([]);
      },
      async execute(statement: any) {
        const query = new MySqlDialect().sqlToQuery(statement);
        if (query.sql.includes("FROM users")) return [[work.actor]];
        if (query.sql.includes("FROM catalog_items")) return [[boundary.catalog]];
        if (query.sql.includes("AS hasHistory")) return [[{ hasHistory: Number(work.history) }]];
        if (query.sql.includes("FOR UPDATE")) return [[]];
        throw Error(`Unexpected SQL: ${query.sql}`);
      },
      update(table: any) { return { set(patch: any) { return { where: async () => { work.writes.push({ table: getTableName(table), patch }); Object.assign(work.context, patch); } }; } }; },
      insert(table: any) { return { values: async (value: any) => {
        const name = getTableName(table), id = 100 + work.writes.length;
        work.writes.push({ table: name, value });
        if (name === "pmv2_item_actions") work.actions.push({ id, ...value });
        return [{ insertId: id }];
      } }; },
    };
  }
  boundary.catalog = { id: 8, nameAr: "صنف الكتالوج", nameEn: "Catalog item", code: "A8", unit: "قطعة", isActive: 1 };
  boundary.db = { ...dbFor(state), transaction: async (work: any) => {
    const next = structuredClone(state);
    const result = await work(dbFor(next));
    state = next;
    return result;
  } };
  return { state: () => state };
}
beforeEach(() => { boundary.stockUnit = "قطعة"; boundary.stockQuantity = 0; boundary.audits.length = 0; });

describe("PMV2 authoritative catalog unit approval — isolated real service", () => {
  it("accepts a unitless technician free-text need and preserves its unknown unit until warehouse approval", async () => {
    const f = fixture();
    const result = await new Pmv2MaterialRequestService().submitMaterialNeed(15, { taskId: 1, taskItemId: 2, catalogItemId: null, unlistedItemName: "مادة جديدة", quantity: 2.5 });
    expect(result.unit).toBe(""); expect(result.route).toBe("material_request");
    const saved = f.state().writes.find((row: any) => row.table === "pmv2_material_request_items").value;
    expect(saved.unitSnapshot).toBeNull(); expect(saved.requestedQuantity).toBe(2.5);
  });
  it("keeps a unitless unresolved request blocking completion rather than silently skipping its route", async () => {
    fixture();
    const tx = {
      select(fields: any) {
        const rows = fields.note ? [{ id: 50, note: JSON.stringify({ ...route, unit: "" }) }]
          : [{ id: 7, catalogItemId: null, status: "waiting_warehouse" }];
        const query: any = { from: () => query, where: () => query, orderBy: () => query,
          then: (resolve: any, reject: any) => Promise.resolve(rows).then(resolve, reject) };
        return query;
      },
    };
    await expect(new Pmv2TeamIssueHandoffService().declareConsumptionWithDb(tx, 15, 1, 2, 3, [])).rejects.toThrow("غير مدرج");
  });
  it("ignores a forged technician unit and derives the catalog base unit freshly", async () => {
    const f = fixture();
    const result = await new Pmv2MaterialRequestService().submitMaterialNeed(15, { taskId: 1, taskItemId: 2, catalogItemId: 8, quantity: 2, unit: "كرتون" });
    expect(result.unit).toBe("قطعة");
    expect(f.state().writes.find((row: any) => row.table === "pmv2_material_request_items").value.unitSnapshot).toBe("قطعة");
  });
  it("binds catalog unit and warehouse approved quantity while retaining original request metadata", async () => {
    const f = fixture();
    const result = await new Pmv2MaterialIdentityResolutionService().resolveIdentity(9, { requestItemId: 7, catalogItemId: 8, requestedQuantity: 5 });
    expect(result.unit).toBe("قطعة"); expect(result.requestedQuantity).toBe(5);
    expect(f.state().context).toMatchObject({ catalogItemId: 8, requestedQuantity: "5", unitSnapshot: "قطعة" });
    const note = JSON.parse(f.state().actions.find((row: any) => row.action === "material_identity_resolved").note);
    expect(note).toMatchObject({ originalItemName: "وصف الفني", originalRequestedQuantity: 3, originalUnit: "حبة", requestedQuantity: 5, unit: "قطعة" });
    expect(f.state().writes.every((row: any) => ["pmv2_item_actions", "pmv2_material_request_items"].includes(row.table))).toBe(true);
  });
  it("repairs an existing untouched linked mismatch only for the same catalog identity, then rejects a stale repeat", async () => {
    const f = fixture(); f.state().context.catalogItemId = 8;
    f.state().actions[0].note = JSON.stringify({ ...route, catalogItemId: 8 });
    const service = new Pmv2MaterialIdentityResolutionService();
    await expect(service.resolveIdentity(9, { requestItemId: 7, catalogItemId: 9, requestedQuantity: 4 })).rejects.toThrow("مسبقًا");
    await service.resolveIdentity(9, { requestItemId: 7, catalogItemId: 8, requestedQuantity: 4 });
    const count = f.state().writes.length;
    await expect(service.resolveIdentity(9, { requestItemId: 7, catalogItemId: 8, requestedQuantity: 6 })).rejects.toThrow("مسبقًا");
    expect(f.state().writes).toHaveLength(count);
  });
  it("rejects another active request for the same catalog before repairing the current request", async () => {
    const f = fixture(); f.state().context.catalogItemId = 8;
    f.state().actions[0].note = JSON.stringify({ ...route, catalogItemId: 8 });
    f.state().duplicates = [{ id: 99 }];
    await expect(new Pmv2MaterialIdentityResolutionService().resolveIdentity(9, { requestItemId: 7, catalogItemId: 8, requestedQuantity: 4 })).rejects.toThrow("احتياج فعال آخر");
    expect(f.state().writes).toEqual([]);
  });
  it.each(["purchase", "transfer", "issue", "usage", "receipt", "return"])("denies %s history before unit/quantity mutation", async kind => {
    const f = fixture();
    if (kind === "purchase" || kind === "usage") f.state().history = true;
    if (kind === "receipt") f.state().context.receivedWarehouseQuantity = 1;
    if (kind === "issue") f.state().context.issuedToTeamQuantity = 1;
    if (kind === "transfer" || kind === "return") f.state().actions.push({ action: kind === "transfer" ? "material_transfer_linked" : "material_return_part_linked", note: JSON.stringify({ materialRequestItemId: 7 }) });
    await expect(new Pmv2MaterialIdentityResolutionService().resolveIdentity(9, { requestItemId: 7, catalogItemId: 8, requestedQuantity: 5 })).rejects.toThrow("حركة مواد سابقة");
    expect(f.state().writes).toEqual([]);
  });
  it.each(["delegate", "technician", "it_member", "accountant", "senior_management"])("denies a direct %s actor at the mutation boundary", async role => {
    const f = fixture(); f.state().actor.role = role;
    await expect(new Pmv2MaterialIdentityResolutionService().resolveIdentity(9, { requestItemId: 7, catalogItemId: 8 })).rejects.toThrow("صلاحية");
    expect(f.state().writes).toEqual([]);
  });
  it("rechecks active identity, open task, current catalog status and stock units", async () => {
    for (const scenario of ["inactiveActor", "cancelledTask", "inactiveCatalog", "differentStockUnit"]) {
      const f = fixture();
      if (scenario === "inactiveActor") f.state().actor.isActive = 0;
      if (scenario === "cancelledTask") f.state().context.taskStatus = "cancelled";
      if (scenario === "inactiveCatalog") boundary.catalog.isActive = 0;
      if (scenario === "differentStockUnit") { boundary.stockQuantity = 2; boundary.stockUnit = "كرتون"; }
      await expect(new Pmv2MaterialIdentityResolutionService().resolveIdentity(9, { requestItemId: 7, catalogItemId: 8 })).rejects.toThrow();
      expect(f.state().writes).toEqual([]);
    }
  });
  it("keeps the existing whole-unit policy and allows 3dp divisible units", () => {
    expect(() => pmv2ApprovedMaterialQuantity(1.5, "قطعة")).toThrow("لا تقبل الكسور");
    expect(pmv2ApprovedMaterialQuantity(1.125, "متر")).toBe(1.125);
    expect(() => pmv2ApprovedMaterialQuantity(1.1255, "متر")).toThrow("ثلاث منازل");
  });
  it("does not confuse unrelated well-formed history with this request", () => {
    expect(() => assertPmv2UnitApprovalUntouched({ received: 0, issued: 0, hasProcurementOrUsage: false, requestItemId: 7, routeActionId: 50,
      actions: [{ action: "material_transfer_linked", note: JSON.stringify({ materialRequestItemId: 99 }) }] })).not.toThrow();
  });
});

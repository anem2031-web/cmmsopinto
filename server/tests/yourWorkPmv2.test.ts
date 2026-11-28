import { createRequire } from "node:module";
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getTableColumns, getTableName } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import * as schema from "../../drizzle/schema";
import { readPmv2Operations, pendingPmv2ReturnAmount } from "../services/your-work/operations-pmv2";
const actor = (role = "warehouse") => ({ id: 30, role, isActive: 1, preferredLanguage: "ar" });
let memory: InstanceType<typeof DatabaseSync>, statements: string[];
const dialect = new MySqlDialect();
const timestamp = (v: any) => v == null ? null : Date.parse(String(v).replace(" ", "T") + (String(v).endsWith("Z") ? "" : "Z")) / 1000;
function insert(table: string, row: Record<string, any>) {
  const keys = Object.keys(row); memory.prepare(`INSERT INTO ${table} (${keys.map(k => `\`${k}\``).join(",")}) VALUES (${keys.map(() => "?").join(",")})`).run(...Object.values(row));
}
const database = () => ({ execute: async (statement: any) => {
  const q = dialect.sqlToQuery(statement); statements.push(q.sql);
  if (q.sql.includes("your-work:pmv2-schema")) return [["pmv2_material_requests", "pmv2_material_request_items", "pmv2_task_items", "pmv2_tasks", "pmv2_teams", "pmv2_item_actions"].map(name => ({ name }))];
  if (!/^\s*(?:\/\*[^]*?\*\/\s*)?SELECT\b/i.test(q.sql)) throw Error("Not a read");
  return [memory.prepare(q.sql).all(...q.params.map(v => v instanceof Date ? v.toISOString() : v))];
} });
const support = () => ({
  filterLots: vi.fn(async (_db: any, rows: any[]) => rows.filter(row => {
    const lot = memory.prepare("SELECT specificationStatus FROM inventory_lots WHERE id=?").get(Number(row.lotId)) as any;
    return lot?.specificationStatus == null || lot.specificationStatus === "approved";
  })),
  heldItems: vi.fn(async () => new Set<number>()), replacements: vi.fn(async () => new Map<number, any[]>()), replacementStock: vi.fn(async () => new Map<string, any>()),
  plan: vi.fn((input: any) => ({ complete: input.originalStock.reduce((sum: number, lot: any) => sum + Number(lot.quantity), 0) + input.replacements.reduce((sum: number, part: any) => sum + part.stock.reduce((total: number, lot: any) => total + Number(lot.quantity), 0), 0) >= input.requiredOriginal })),
});
function base(status = "waiting_material") {
  insert("warehouses", { id: 1, type: "main", isActive: 1 }); insert("warehouses", { id: 2, type: "branch", isActive: 1 });
  insert("pmv2_teams", { id: 1, warehouseId: 2, isActive: 1 }); insert("sections", { id: 1, siteId: 1 });
  insert("pmv2_program_targets", { id: 1, sectionId: 1, siteId: 1 });
  insert("pmv2_tasks", { id: 1, teamId: 1, programTargetId: 1, taskNumber: "PMV2-1", status: "waiting_material" });
  insert("pmv2_task_items", { id: 10, taskId: 1, titleSnapshot: "فحص", status, result: "needs_material" });
  insert("pmv2_visits", { id: 1, taskId: 1 });
  insert("catalog_items", { id: 1, nameAr: "مصباح", nameEn: "Lamp", nameUr: "چراغ", unit: "piece", isActive: 1 });
  insert("users", { id: 1, role: "technician", isActive: 1 }); insert("pmv2_team_members", { id: 1, teamId: 1, userId: 1, isActive: 1 });
}
function request(id = 100, status = "waiting_warehouse") {
  insert("pmv2_material_requests", { id, taskItemId: 10, teamId: 1, teamWarehouseId: 2, requestedById: 1, createdAt: "2026-11-28 08:00:00" });
  insert("pmv2_material_request_items", { id, requestId: id, catalogItemId: 1, itemNameSnapshot: "مصباح", requestedQuantity: 5, issuedToTeamQuantity: status === "issued_to_team" ? 5 : 0, unitSnapshot: "piece", status });
}
function route(materialRequestItemId: number | null = null) {
  insert("pmv2_item_actions", { id: 120, taskItemId: 10, visitId: 1, action: "material_route_decision", performedById: 1, createdAt: "2026-11-28 07:00:00", note: JSON.stringify({ version: 1, route: materialRequestItemId ? "material_request" : "team_inventory", catalogItemId: 1, itemNameSnapshot: "مصباح", requestedQuantity: 5, unit: "piece", teamWarehouseId: 2, materialRequestItemId }) });
}
function stock(warehouseId = 2, specificationStatus: string | null = null, quantity = 5) {
  insert("inventory", { id: 1, warehouseId, linkedItemId: 1, unit: "piece", isFrozen: 0 });
  insert("inventory_lots", { id: 1, catalogItemId: 1, specificationStatus, lotCode: "LOT-1", trackingToken: "token1" });
  insert("inventory_lot_balances", { id: 1, inventoryId: 1, lotId: 1, quantity });
}
beforeEach(() => {
  vi.stubEnv("PMV2_SIMPLIFIED_ENABLED", "false"); vi.stubEnv("INVENTORY_LOTS_ENABLED", "true"); statements = []; memory = new DatabaseSync(":memory:");
  memory.function("UNIX_TIMESTAMP", timestamp);
  const selected = [schema.pmv2MaterialRequests, schema.pmv2MaterialRequestItems, schema.pmv2MaterialUsages, schema.pmv2TaskItems, schema.pmv2Tasks, schema.pmv2Teams,
    schema.pmv2ItemActions, schema.pmv2Visits, schema.pmv2ProgramTargets, schema.warehouses, schema.catalogItems, schema.inventory,
    schema.inventoryLots, schema.inventoryLotBalances, schema.pmv2MaterialPurchaseLinks, schema.purchaseOrderItems, schema.purchaseOrders,
    schema.warehouseReceiptItems, schema.warehouseReceipts, schema.pmv2TeamMembers, schema.users, schema.sections, schema.assets];
  for (const table of selected) {
    const fields: any[] = Object.values(getTableColumns(table));
    memory.exec(`CREATE TABLE \`${getTableName(table)}\` (${fields.map(c => `\`${c.name}\` ${c.name === "id" ? "INTEGER PRIMARY KEY" : c.dataType === "number" ? "NUMERIC" : "TEXT"}`).join(",")})`);
  }
});
afterEach(() => { memory.close(); vi.unstubAllEnvs(); });

describe("Batched PMV2 personal warehouse actions", () => {
  it.each(["senior_management", "maintenance_manager", "general_maintenance_manager", "construction_procurement_manager", "it_manager", "operator"])("does not turn %s oversight into warehouse work", async role => {
    expect(await readPmv2Operations(database(), actor(role), support())).toEqual([]); expect(statements).toEqual([]);
  });
  it("reads the actual SQL against schema-shaped empty tables", async () => {
    expect(await readPmv2Operations(database(), actor(), support())).toEqual([]); expect(statements).toHaveLength(4);
  });
  it("shows an uncovered request from its arrival, with an exact focus link", async () => {
    base(); request(); const out = await readPmv2Operations(database(), actor(), support());
    expect(out).toHaveLength(1); expect(out[0]).toMatchObject({ action: "material_provide", reference: "PMV2-1", arrivedAt: Date.parse("2026-11-28T08:00:00Z") });
    expect(out[0].href).toContain("workRequestItem=100");
  });
  it("only offers identity repair for an untouched request with its actual route", async () => {
    base(); request(); route(100); memory.exec("UPDATE pmv2_material_request_items SET unitSnapshot='box'");
    expect((await readPmv2Operations(database(), actor(), support()))[0].action).toBe("material_resolve");
    insert("pmv2_material_usages", { id: 1, materialRequestItemId: 100 });
    expect(await readPmv2Operations(database(), actor(), support())).toEqual([]);
  });
  it("does not offer identity repair when its route is missing", async () => {
    base(); request(); memory.exec("UPDATE pmv2_material_request_items SET unitSnapshot='box'");
    expect(await readPmv2Operations(database(), actor(), support())).toEqual([]);
  });
  it("does not show a request fully covered by another person's pending purchase", async () => {
    base(); request(); insert("purchase_orders", { id: 1, status: "approved" }); insert("purchase_order_items", { id: 1, purchaseOrderId: 1, status: "approved" });
    insert("pmv2_material_purchase_links", { id: 1, materialRequestItemId: 100, purchaseOrderId: 1, purchaseOrderItemId: 1, linkedQuantity: 5 });
    expect(await readPmv2Operations(database(), actor(), support())).toEqual([]);
  });
  it("keeps specification-held receipts in the pending purchase coverage", async () => {
    base(); request(); insert("purchase_orders", { id: 1, status: "approved" }); insert("purchase_order_items", { id: 1, purchaseOrderId: 1, status: "delivered_to_warehouse" });
    insert("warehouse_receipts", { id: 1, status: "confirmed" }); insert("warehouse_receipt_items", { id: 1, receiptId: 1, purchaseOrderItemId: 1, receivedQuantity: 5 });
    insert("inventory_lots", { id: 1, receiptItemId: 1, specificationStatus: "pending" });
    insert("pmv2_material_purchase_links", { id: 1, materialRequestItemId: 100, purchaseOrderId: 1, purchaseOrderItemId: 1, linkedQuantity: 5 });
    expect(await readPmv2Operations(database(), actor(), support())).toEqual([]);
  });
  it("requires stock, a valid target and a current recipient for an issue", async () => {
    base(); route(); stock(); const lib = support();
    expect((await readPmv2Operations(database(), actor(), lib)).map(r => r.key)).toEqual(["pmv2-issue:120"]);
    memory.exec("DELETE FROM pmv2_team_members"); expect(await readPmv2Operations(database(), actor(), lib)).toEqual([]);
    insert("pmv2_team_members", { id: 1, teamId: 1, userId: 1, isActive: 1 }); memory.exec("DELETE FROM sections");
    expect(await readPmv2Operations(database(), actor(), lib)).toEqual([]);
  });
  it("never offers held lots or incomplete physical coverage for issue", async () => {
    base(); route(); stock(2, "pending"); expect(await readPmv2Operations(database(), actor(), support())).toEqual([]);
    memory.exec("UPDATE inventory_lots SET specificationStatus=NULL; UPDATE inventory_lot_balances SET quantity=4");
    expect(await readPmv2Operations(database(), actor(), support())).toEqual([]);
  });
  it("waits for shortage transfer and timestamps readiness by its confirmed link", async () => {
    base(); request(100, "external_purchase"); route(100); stock();
    expect(await readPmv2Operations(database(), actor(), support())).toEqual([]);
    memory.exec("UPDATE pmv2_material_request_items SET status='issued_to_team',issuedToTeamQuantity=5");
    insert("pmv2_item_actions", { id: 121, taskItemId: 10, visitId: 1, action: "material_transfer_linked", note: JSON.stringify({ version: 1, materialRequestItemId: 100 }), createdAt: "2026-11-29 09:00:00" });
    expect((await readPmv2Operations(database(), actor(), support()))[0]).toMatchObject({ arrivedAt: Date.parse("2026-11-29T09:00:00Z"), href: "/scheduled-maintenance/warehouse-requests?source=pmv2&workRequirement=120" });
  });
  it("removes an issued need and uses original-equivalent replacement quantities", async () => {
    base(); route(); stock(); insert("pmv2_item_actions", { id: 121, taskItemId: 10, visitId: 1, action: "material_issue_linked", note: JSON.stringify({ version: 2, routeDecisionActionId: 120, deliveryDocumentId: 5, catalogItemId: 2, quantity: 10, originalQuantity: 5 }) });
    expect(await readPmv2Operations(database(), actor(), support())).toEqual([]);
  });
  it("shows only the still-returnable declaration, then removes it after linked return", async () => {
    base("completed"); const note = { version: 1, routeDecisionActionId: 120, catalogItemId: 1, toReturnQuantity: 3 };
    insert("pmv2_item_actions", { id: 122, taskItemId: 10, visitId: 1, action: "material_consumption_declared", note: JSON.stringify(note), createdAt: "2026-11-28 12:00:00" });
    expect((await readPmv2Operations(database(), actor(), support())).map(r => r.action)).toEqual(["material_return"]);
    insert("pmv2_item_actions", { id: 123, taskItemId: 10, visitId: 1, action: "material_return_part_linked", note: JSON.stringify({ version: 1, declarationActionId: 122, returnId: 5, sourceDeliveryDocumentId: 7, quantity: 3 }) });
    expect(await readPmv2Operations(database(), actor(), support())).toEqual([]);
  });
  it("bounds repeated-parent reads by 500 unique request IDs", async () => {
    base(); for (let i = 100; i < 1300; i++) request(i);
    expect(await readPmv2Operations(database(), actor(), support())).toHaveLength(1200);
    expect(statements.filter(s => s.includes("your-work:pmv2-actions"))).toHaveLength(1);
    expect(statements.filter(s => s.includes("your-work:pmv2-request-state"))).toHaveLength(3);
    expect(statements.filter(s => s.includes("your-work:pmv2-purchase-coverage"))).toHaveLength(3);
  });
  it("does not convert infrastructure failures into an empty success", async () => {
    await expect(readPmv2Operations({ execute: async () => { throw Error("fixture failed"); } }, actor(), support())).rejects.toThrow("fixture failed");
  });
  it("calculates physical-mode returns and ignores malformed declarations", () => {
    expect(pendingPmv2ReturnAmount({ version: 1, routeDecisionActionId: 5, catalogItemId: 1, physicalMode: true, physicalUsages: [{ deliveryDocumentId: 7, usedQuantity: 2 }] }, [{ version: 2, routeDecisionActionId: 5, deliveryDocumentId: 7, quantity: 8 }], [{ quantity: 1 }])).toBe(5);
    expect(pendingPmv2ReturnAmount(null, [], [])).toBe(0);
  });
});

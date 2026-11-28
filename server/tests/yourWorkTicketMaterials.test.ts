import { createRequire } from "node:module";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readTicketMaterialOperations } from "../services/your-work/operations-ticket-materials";
import type { OperationsActor } from "../services/your-work/operations-port";
vi.mock("../maintenance-team-tickets/ticket-translations", () => ({ queueTeamTicketTranslations: async () => {} }));
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite");
const stores: any[] = [];
const actor = (role = "warehouse", isActive = 1): OperationsActor => ({ id: 7, role, isActive });
beforeEach(() => vi.stubEnv("INVENTORY_LOTS_ENABLED", "true"));
afterEach(() => { stores.splice(0).forEach(db => db.close()); vi.unstubAllEnvs(); });

function fixture() {
  const memory = new DatabaseSync(":memory:"); stores.push(memory);
  memory.function("UNIX_TIMESTAMP", (value: string | null) => value == null ? null : Date.parse(value.replace(" ", "T") + "Z") / 1000);
  memory.function("LEAST", { varargs: true }, (...values: number[]) => Math.min(...values));
  memory.exec(`
    CREATE TABLE users(id INTEGER PRIMARY KEY,name TEXT,role TEXT,isActive INTEGER);
    CREATE TABLE ticket_team_assignments(id INTEGER PRIMARY KEY,ticketId INTEGER,ticketItemId INTEGER,ticketNumber TEXT,titleSnapshot TEXT,teamId INTEGER,warehouseId INTEGER,materialRound INTEGER,stage TEXT,siteId INTEGER,sectionId INTEGER,createdAt TEXT);
    CREATE TABLE maintenance_teams(id INTEGER PRIMARY KEY,name TEXT,isActive INTEGER);
    CREATE TABLE maintenance_team_members(teamId INTEGER,userId INTEGER,isActive INTEGER);
    CREATE TABLE tickets(id INTEGER PRIMARY KEY,workflowModel TEXT,status TEXT,description TEXT,assignedToId INTEGER,maintenanceResponsibleDepartment TEXT);
    CREATE TABLE ticket_items(id INTEGER PRIMARY KEY,ticketId INTEGER,status TEXT);
    CREATE TABLE warehouses(id INTEGER PRIMARY KEY,type TEXT,isActive INTEGER,nameAr TEXT);
    CREATE TABLE sites(id INTEGER PRIMARY KEY,name TEXT); CREATE TABLE sections(id INTEGER PRIMARY KEY,name TEXT);
    CREATE TABLE ticket_team_material_needs(id INTEGER PRIMARY KEY,assignmentId INTEGER,materialRound INTEGER,catalogItemId INTEGER,itemNameSnapshot TEXT,originalItemName TEXT,unitSnapshot TEXT,requestedQuantity INTEGER,usedQuantity INTEGER,requestedById INTEGER,warehouseId INTEGER,createdAt TEXT);
    CREATE TABLE catalog_items(id INTEGER PRIMARY KEY,unit TEXT,isActive INTEGER,nameAr TEXT,nameEn TEXT,nameUr TEXT);
    CREATE TABLE catalog_units(nameAr TEXT,nameEn TEXT,isActive INTEGER);
    CREATE TABLE inventory(id INTEGER PRIMARY KEY,warehouseId INTEGER,linkedItemId INTEGER,quantity NUMERIC,isFrozen INTEGER,issueUnit TEXT,unit TEXT);
    CREATE TABLE inventory_lot_balances(inventoryId INTEGER,lotId INTEGER,quantity NUMERIC);
    CREATE TABLE inventory_lots(id INTEGER PRIMARY KEY,catalogItemId INTEGER,issueUnit TEXT,purchaseOrderItemId INTEGER,specificationStatus TEXT);
    CREATE TABLE ticket_team_actions(id INTEGER PRIMARY KEY,assignmentId INTEGER,kind TEXT,note TEXT,revision INTEGER,createdAt TEXT);
    CREATE TABLE ticket_team_delivery_links(id INTEGER PRIMARY KEY,needId INTEGER,deliveryDocumentId INTEGER,deliveryNumber TEXT,lotId INTEGER,inventoryTransactionId INTEGER,issuedQuantity INTEGER,receivedById INTEGER,usedQuantity INTEGER,returnedQuantity INTEGER);
    CREATE TABLE ticket_team_supply_links(id INTEGER PRIMARY KEY,needId INTEGER,sourceKind TEXT,sourceId INTEGER,sourceNumber TEXT,linkedQuantity INTEGER,status TEXT,createdAt TEXT);
    CREATE TABLE purchase_order_items(id INTEGER PRIMARY KEY,purchaseOrderId INTEGER,status TEXT,catalogItemId INTEGER,unit TEXT,receivedQuantity NUMERIC,receivedAt TEXT,purchaseCancelledAt TEXT);
    CREATE TABLE purchase_orders(id INTEGER PRIMARY KEY,status TEXT,ticketId INTEGER,ticketItemId INTEGER);
    CREATE TABLE warehouse_transfers(id INTEGER PRIMARY KEY,lotId INTEGER,createdAt TEXT);
    INSERT INTO users VALUES(7,'المستودع','warehouse',1),(8,'الفني','technician',1);
    INSERT INTO maintenance_teams VALUES(1,'الكهرباء',1); INSERT INTO maintenance_team_members VALUES(1,8,1);
    INSERT INTO warehouses VALUES(1,'main',1,'الرئيسي'),(2,'branch',1,'الفريق');
    INSERT INTO sites VALUES(1,'الملقا'); INSERT INTO sections VALUES(1,'فودوزو');
    INSERT INTO catalog_items VALUES(10,'قطعة',1,'مصباح','Lamp','چراغ'),(11,'علبة',1,'بديل','Replacement','متبادل');
  `);
  const queries: Array<{ sql: string; params: any[] }> = [], dialect = new MySqlDialect();
  const db: any = { execute: async (statement: any) => {
    const query = dialect.sqlToQuery(statement); queries.push(query);
    return [memory.prepare(query.sql).all(...query.params), []];
  } };
  const replacements = new Map<number, any[]>(), emergencies = new Map<number, { approved: boolean }>();
  const support = { replacements: async () => replacements, emergencies: async () => emergencies,
    filterLots: async (_db: any, rows: any[]) => rows.filter(row => (row.specificationStatus == null || row.specificationStatus === "approved") && !emergencies.has(Number(row.purchaseOrderItemId))) };
  function add(id = 1, values: { catalog?: number | null; stage?: string; round?: number; needRound?: number; used?: number | null; quantity?: number; date?: string | null; unit?: string } = {}) {
    const { catalog = 10, stage = "waiting_material", round = 1, needRound = round, used = null, quantity = 5, date = "2026-11-28 08:00:00", unit = "قطعة" } = values;
    memory.prepare("INSERT INTO tickets VALUES(?,'sub_ticket','in_progress','وصف',NULL,'maintenance_report_department_general')").run(id);
    memory.prepare("INSERT INTO ticket_items VALUES(?,?,'in_progress')").run(id, id);
    memory.prepare("INSERT INTO ticket_team_assignments VALUES(?,?,?,?,'فحص',1,2,?,?,1,1,'2026-10-01 01:00:00')").run(id, id, id, `MT-${id}`, round, stage);
    memory.prepare("INSERT INTO ticket_team_material_needs VALUES(?,?,?,?, 'المادة','الأصل',?,?,?,8,2,?)").run(id, id, needRound, catalog, unit, quantity, used, date);
  }
  function stock(warehouseId: number, quantity: number, options: { catalog?: number; id?: number; lot?: number; source?: number | null; specification?: string | null; frozen?: number; unit?: string } = {}) {
    const { catalog = 10, id = warehouseId * 100 + catalog, lot = id, source = null, specification = null, frozen = 0, unit = catalog === 11 ? "علبة" : "قطعة" } = options;
    memory.prepare("INSERT INTO inventory VALUES(?,?,?,?,?,?,?)").run(id, warehouseId, catalog, quantity, frozen, unit, unit);
    memory.prepare("INSERT INTO inventory_lots VALUES(?,?,?,?,?)").run(lot, catalog, unit, source, specification);
    memory.prepare("INSERT INTO inventory_lot_balances VALUES(?,?,?)").run(id, lot, quantity);
  }
  function source(id = 1, options: { status?: string; received?: number; receivedAt?: string | null; itemStatus?: string; cancelAt?: string | null; kind?: string; lot?: number } = {}) {
    const { status = "pending", received = 0, receivedAt = null, itemStatus = "approved", cancelAt = null, kind = "purchase", lot = 10 } = options;
    memory.prepare("INSERT INTO ticket_team_supply_links VALUES(?,?,?,?,'PR-1',5,?,'2026-11-28 09:00:00')").run(id, id, kind, id, status);
    if (kind === "purchase") {
      memory.prepare("INSERT INTO purchase_orders VALUES(?,'approved',?,?)").run(id, id, id);
      memory.prepare("INSERT INTO purchase_order_items VALUES(?,?,?,10,'قطعة',?,?,?)").run(id, id, itemStatus, received, receivedAt, cancelAt);
    } else memory.prepare("INSERT INTO warehouse_transfers VALUES(?,?,'2026-11-28 11:00:00')").run(id, lot);
  }
  function action(id: number, kind = "fixed", note = "تم الإصلاح", time: string | null = "2026-11-28 10:00:00", revision = 1) {
    memory.prepare("INSERT INTO ticket_team_actions VALUES(?,?,?,?,?,?)").run(id * 100 + revision, id, kind, note, revision, time);
  }
  return { memory, db, support, queries, add, stock, source, action, replacements, emergencies };
}

describe("personal ticket material operations", () => {
  it.each(["senior_management", "technician", "delegate", "it_manager", "accountant"])("does not show read-only or other actors' warehouse work to %s", async role => {
    const f = fixture(); f.add(); expect(await readTicketMaterialOperations(f.db, actor(role), f.support)).toEqual([]); expect(f.queries).toHaveLength(0);
  });
  it("rejects inactive warehouse identities before reading", async () => {
    const f = fixture(); f.add(); expect(await readTicketMaterialOperations(f.db, actor("warehouse", 0), f.support)).toEqual([]); expect(f.queries).toHaveLength(0);
  });
  it.each(["warehouse", "owner", "admin"])("shows genuinely actionable identity/supply tasks for %s", async role => {
    const f = fixture(); f.add(1, { catalog: null }); f.add(2);
    expect(await readTicketMaterialOperations(f.db, actor(role), f.support)).toMatchObject([
      { reference: "MT-1", action: "material_resolve", arrivedAt: Date.parse("2026-11-28T08:00:00Z") }, { reference: "MT-2", action: "material_provide" },
    ]);
    expect(f.queries.every(query => /^\s*(?:\/\*[\s\S]*?\*\/\s*)?SELECT/i.test(query.sql))).toBe(true);
  });
  it("uses all scoped candidates beyond 200 and chunks every dependent read at 500", async () => {
    const f = fixture(); for (let id = 1; id <= 1001; id++) f.add(id, { catalog: null });
    const items = await readTicketMaterialOperations(f.db, actor(), f.support); expect(items).toHaveLength(1001);
    expect(new Set(items.map(item => item.key)).size).toBe(1001);
    expect(f.queries.filter(query => query.sql.includes("your-work:ticket-material-heads"))).toHaveLength(1);
    expect(f.queries.filter(query => query.sql.includes("your-work:ticket-material-needs"))).toHaveLength(3);
    expect(f.queries.every(query => query.params.length <= 1000)).toBe(true);
    expect(f.queries.every(query => !/LIMIT\s+200/i.test(query.sql))).toBe(true);
    expect(f.queries.length).toBeLessThan(30);
  });
  it("excludes unrelated, orphaned, completed and old-round material needs", async () => {
    const f = fixture(); f.add(1); f.add(2, { stage: "ready_to_repair" }); f.add(3, { round: 2, needRound: 1 }); f.add(4); f.add(5); f.add(6);
    f.memory.exec("UPDATE ticket_items SET ticketId=99 WHERE id=4; UPDATE tickets SET workflowModel='department_tasks' WHERE id=5; UPDATE tickets SET status='closed' WHERE id=6");
    expect((await readTicketMaterialOperations(f.db, actor(), f.support)).map(row => row.reference)).toEqual(["MT-1"]);
  });
  it("omits waiting procurement and held specifications/emergency stock instead of assigning their wait to warehouse", async () => {
    const f = fixture(); f.add(); f.source(); expect(await readTicketMaterialOperations(f.db, actor(), f.support)).toEqual([]);
    f.memory.exec("UPDATE purchase_order_items SET receivedQuantity=5,receivedAt='2026-11-28 11:00:00'; UPDATE ticket_team_supply_links SET status='received'");
    f.stock(1, 5, { source: 1, specification: "pending" });
    expect(await readTicketMaterialOperations(f.db, actor(), f.support)).toEqual([]);
    f.memory.exec("UPDATE inventory_lots SET specificationStatus='approved'"); f.emergencies.set(1, { approved: false });
    expect(await readTicketMaterialOperations(f.db, actor(), f.support)).toEqual([]);
  });
  it("re-enters at recorded purchase receipt and enables the current transfer action", async () => {
    const f = fixture(); f.add(); f.source(1, { received: 5, receivedAt: "2026-11-28 11:00:00" }); f.stock(1, 5, { source: 1 });
    expect(await readTicketMaterialOperations(f.db, actor(), f.support)).toMatchObject([{ action: "material_provide", arrivedAt: Date.parse("2026-11-28T11:00:00Z") }]);
  });
  it("ready issue uses stock/unit/routing guards and exact transfer entry time", async () => {
    const f = fixture(); f.add(); f.stock(2, 5); f.source(1, { kind: "transfer", status: "received", lot: 210 });
    f.action(1, "needs_material", JSON.stringify({ version: 1, type: "ticket_material_need", round: 1, originalName: "الأصل", catalogItemId: 10, shortage: 5, message: "شراء" }));
    const result = await readTicketMaterialOperations(f.db, actor(), f.support);
    expect(result).toMatchObject([{ action: "material_issue", arrivedAt: Date.parse("2026-11-28T11:00:00Z"), href: "/scheduled-maintenance/warehouse-requests?source=tickets&ticketId=1&workReference=MT-1&workAssignment=1&workNeed=1" }]);
    f.memory.exec("UPDATE inventory SET isFrozen=1");
    expect((await readTicketMaterialOperations(f.db, actor(), f.support))).toMatchObject([{ action: "material_provide" }]); // purchase shortage remains a warehouse action.
  });
  it("identity unit review is unavailable after procurement/physical history", async () => {
    const f = fixture(); f.add(1, { unit: "كرتون" }); f.add(2, { unit: "كرتون" }); f.source(2);
    expect((await readTicketMaterialOperations(f.db, actor(), f.support)).map(row => row.reference)).toEqual(["MT-1"]);
    f.memory.exec("UPDATE catalog_items SET isActive=0 WHERE id=10"); expect(await readTicketMaterialOperations(f.db, actor(), f.support)).toEqual([]);
  });
  it("does not turn an ambiguous inventory identity into a fictitious purchase shortage", async () => {
    const f = fixture(); f.add(); f.stock(2, 5); f.stock(2, 5, { id: 999, lot: 999 });
    expect(await readTicketMaterialOperations(f.db, actor(), f.support)).toEqual([]);
  });
  it("uses actual usage declaration time for returns, never a later round or ticket creation", async () => {
    const f = fixture(); f.add(1, { stage: "awaiting_review", quantity: 10, used: 6 });
    f.memory.exec("INSERT INTO ticket_team_delivery_links VALUES(1,1,1,'DL-1',10,1,10,8,NULL,0)"); f.action(1);
    expect(await readTicketMaterialOperations(f.db, actor(), f.support)).toMatchObject([{ action: "material_return", arrivedAt: Date.parse("2026-11-28T10:00:00Z") }]);
    f.memory.exec("UPDATE ticket_team_actions SET createdAt=NULL");
    expect(await readTicketMaterialOperations(f.db, actor(), f.support)).toMatchObject([{ action: "material_return", arrivedAt: null }]);
  });
  it("handles unit-approved physical returns even though need.used remains null", async () => {
    const f = fixture(); f.add(1, { stage: "awaiting_review", quantity: 10 });
    f.memory.exec("INSERT INTO ticket_team_delivery_links VALUES(1,1,1,'DL-1',10,1,5,8,4,0)");
    f.action(1, "needs_material", JSON.stringify({ approvedStockUnit: { needId: 1, unit: "قطعة", fromUnit: "علبة", factor: 2, priorIssued: 5, priorReturned: 0, deliveryIds: [1] } }), "2026-11-28 09:00:00");
    f.action(1, "fixed", "تم", "2026-11-28 12:00:00", 2);
    expect(await readTicketMaterialOperations(f.db, actor(), f.support)).toMatchObject([{ action: "material_return", arrivedAt: Date.parse("2026-11-28T12:00:00Z") }]);
  });
  it("preserves unknown arrival instead of inventing a ticket/updated timestamp", async () => {
    const f = fixture(); f.add(1, { catalog: null, date: null });
    expect(await readTicketMaterialOperations(f.db, actor(), f.support)).toMatchObject([{ arrivedAt: null }]);
  });
  it("uses the approved replacement ratio for ready issue and never counts its lots as ordinary source stock", async () => {
    const f = fixture(); f.add(1, { quantity: 4 }); f.source(1, { itemStatus: "rejected", cancelAt: "2026-11-28 09:00:00" });
    f.stock(2, 2, { catalog: 11, lot: 50 });
    const plan = { planId: 1, caseId: 1, sourceItemId: 1, sourcePurchaseOrderId: 1, sourceTicketId: 1, sourceTicketItemId: 1, sourceCatalogItemId: 10,
      sourceUnit: "قطعة", originalUnit: "قطعة", quantityCovered: "10.000", originalQuantityCovered: "10.000", replacementItemId: 9, replacementPurchaseOrderId: 9,
      catalogItemId: 11, itemName: "بديل", replacementUnit: "علبة", orderUnit: "علبة", replacementQuantity: "5.000", orderQuantity: "5.000",
      lots: [{ lotId: 50, trackingToken: "LOT-50", unit: "علبة", issueUnit: "علبة", quantity: "5.000", originalQuantity: "10.000" }] };
    f.replacements.set(1, [plan]);
    expect(await readTicketMaterialOperations(f.db, actor(), f.support)).toMatchObject([{ action: "material_issue" }]);
    f.memory.exec("UPDATE ticket_team_material_needs SET requestedQuantity=5");
    expect((await readTicketMaterialOperations(f.db, actor(), f.support)).every(row => row.action !== "material_issue")).toBe(true);
    f.memory.exec("UPDATE ticket_team_material_needs SET requestedQuantity=4; UPDATE inventory_lots SET specificationStatus='pending'");
    expect((await readTicketMaterialOperations(f.db, actor(), f.support)).every(row => row.action !== "material_issue")).toBe(true);
    f.replacements.set(1, [{ ...plan, sourceTicketId: 99 }]);
    await expect(readTicketMaterialOperations(f.db, actor(), f.support)).rejects.toThrow("تعويض المورد لا يطابق");
  });
  it("recognizes replacement physical returns independently from original requested units", async () => {
    const f = fixture(); f.add(1, { stage: "awaiting_review", quantity: 4 }); f.source(1, { itemStatus: "rejected" });
    f.memory.exec("INSERT INTO ticket_team_delivery_links VALUES(1,1,1,'DL-1',50,1,2,8,1,0)"); f.action(1);
    f.replacements.set(1, [{ planId: 1, sourceItemId: 1, sourceTicketId: 1, sourceTicketItemId: 1, sourceCatalogItemId: 10, originalUnit: "قطعة", catalogItemId: 11,
      replacementUnit: "علبة", originalQuantityCovered: "10.000", lots: [{ lotId: 50, unit: "علبة", quantity: "5.000" }] }]);
    expect(await readTicketMaterialOperations(f.db, actor(), f.support)).toMatchObject([{ action: "material_return", arrivedAt: Date.parse("2026-11-28T10:00:00Z") }]);
    f.memory.exec("UPDATE ticket_team_delivery_links SET returnedQuantity=1"); expect(await readTicketMaterialOperations(f.db, actor(), f.support)).toEqual([]);
  });
  it("propagates query failures rather than hiding/truncating this source", async () => {
    const f = fixture(); f.add(); f.memory.exec("DROP TABLE ticket_team_actions");
    await expect(readTicketMaterialOperations(f.db, actor(), f.support)).rejects.toThrow();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { and, eq, sql } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import * as schema from "../../drizzle/schema";
import * as costing from "../_core/inventory-costing";
import { purchaseSpecificationsDatabase } from "./fixtures/purchaseSpecificationsDatabase";

const ports = vi.hoisted(() => ({ db: null as any, nativeReturn: null as any, calls: [] as any[] }));
vi.mock("../_core/db/client", () => ({ getDb: async () => ports.db }));
vi.mock("../pmv2/adapters/current-system", () => ({
  currentInventoryAdapter: {}, currentInventoryIssueAdapter: {}, currentDeliveryAdapter: {}, currentMaintenanceTargetAdapter: {},
  currentCatalogAdapter: { getItemsByIds: async (ids: number[]) => ids.map(id => ({ id, nameAr: `Material ${id}`, code: `C-${id}` })) },
  currentRecipientReturnAdapter: { createReturn: async (input: any, tx?: any) => {
    ports.calls.push({ input, tx });
    return ports.nativeReturn(input, tx);
  } },
}));
import { Pmv2TeamIssueHandoffService } from "../pmv2/materials/team-issue-handoff-service";

const DECLARATION = 120, ROUTE = 100, ITEM = 10;
const service = new Pmv2TeamIssueHandoffService();
let f: ReturnType<typeof purchaseSpecificationsDatabase> & { tx?: any; transactionConfig?: any; beforeDeliveryLock?: () => Promise<void> };

// Importing the entire legacy db module would initialize unrelated live modules.
// Execute its actual native writer body with disposable persistence and only
// its original-delivery source lookup/document-number ports supplied here.
const legacyAst = ts.createSourceFile("warehouse-returns.ts", readFileSync("server/_core/db/warehouse-returns.ts", "utf8"), ts.ScriptTarget.Latest, true);
const nativeNode = legacyAst.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "createRecipientWarehouseReturn");
if (!nativeNode) throw Error("Authoritative recipient return writer is missing");
const nativeCode = ts.transpileModule(`(${nativeNode.getText(legacyAst).replace(/^export /, "")})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const adapterAst = ts.createSourceFile("current-system.ts", readFileSync("server/pmv2/adapters/current-system.ts", "utf8"), ts.ScriptTarget.Latest, true);
const adapterDeclaration = adapterAst.statements.filter(ts.isVariableStatement).flatMap(node => [...node.declarationList.declarations])
  .find(node => node.name.getText(adapterAst) === "currentRecipientReturnAdapter");
if (!adapterDeclaration?.initializer) throw Error("Canonical recipient return adapter is missing");
const adapterCode = ts.transpileModule(`(${adapterDeclaration.initializer.getText(adapterAst)})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

function nativeWriter() {
  return vm.runInNewContext(nativeCode, {
    ...schema, ...costing, sql, eq, and,
    getDb: async () => ports.db,
    readRecipientReturnSourceById: async (id: number) => {
      const source = f.memory.prepare("SELECT * FROM delivery_documents WHERE id=?").get(id) as any;
      if (!source) throw Error("Source delivery is missing");
      const returned = f.memory.prepare("SELECT COALESCE(SUM(returnedQuantity),0) AS qty FROM warehouse_returns WHERE sourceDeliveryDocumentId=?").get(id) as any;
      return { ...source, sourceDeliveryDocumentId: id, deliveryNumber: `DLV-${id}`, lotCode: `LOT-${source.lotId}`,
        itemName: `Material ${source.catalogItemId}`, previouslyReturnedQuantity: Number(returned.qty),
        returnableQuantity: Number(source.quantity) - Number(returned.qty), deliveredToName: "Technician", poNumber: null,
        warehouseName: "Team stock", originalIssueUnitCost: Number(source.unitCost), movementTicketId: null, movementPurchaseOrderItemId: null };
    },
    getNextReturnNumber: async (tx: any) => {
      await tx.execute(sql`UPDATE test_return_counter SET sequence=sequence+1`);
      const [result] = await tx.execute(sql`SELECT sequence FROM test_return_counter`);
      return `RTN-${result[0].sequence}`;
    },
    createReturnDocument: async (data: any, tx: any) => {
      await tx.execute(sql`INSERT INTO return_documents(returnId,returnNumber,returnedQuantity)
        VALUES (${data.returnId},${data.returnNumber},${data.returnedQuantity})`);
    },
  });
}

function seed(options: { multiple?: boolean; physical?: boolean; used?: number } = {}) {
  const { multiple = false, physical = false, used = 3 } = options;
  f.insert("users", { id: 50, role: "warehouse", isActive: 1, name: "Warehouse" });
  f.insert("users", { id: 51, role: "technician", isActive: 1, name: "Technician" });
  f.insert("users", { id: 52, role: "admin", isActive: 1, name: "Admin" });
  f.insert("users", { id: 53, role: "owner", isActive: 1, name: "Owner" });
  f.insert("pmv2_teams", { id: 1, warehouseId: 2, code: "TEAM", isActive: 1 });
  f.insert("warehouses", { id: 2, nameAr: "Team stock", type: "branch", isActive: 1 });
  f.insert("pmv2_tasks", { id: 1, teamId: 1, taskNumber: "PM-1", status: "completed", programTargetId: 1 });
  f.insert("pmv2_task_items", { id: ITEM, taskId: 1, titleSnapshot: "Maintenance task", status: "completed", result: "repaired" });
  f.insert("pmv2_visits", { id: 1, taskId: 1, performedById: 51 });
  const quantities = multiple ? [2, 4] : [6];
  const physicalUsages: any[] = [];
  quantities.forEach((quantity, index) => {
    const id = 30 + index, lotId = 20 + index, inventoryId = 200 + index, catalogItemId = physical && index === 1 ? 901 : 900;
    f.insert("inventory", { id: inventoryId, warehouseId: 2, linkedItemId: catalogItemId, quantity: 0, averageCost: 5, totalCostValue: 0, itemName: `Material ${catalogItemId}`, unit: "قطعة" });
    f.insert("inventory_lots", { id: lotId, lotCode: `LOT-${lotId}`, catalogItemId, originalQuantity: quantity, remainingQuantity: 0 });
    f.insert("inventory_lot_balances", { id: index + 1, lotId, inventoryId, quantity: 0 });
    f.insert("delivery_documents", { id, inventoryId, lotId, warehouseId: 2, catalogItemId, quantity, unitCost: 5, unit: "قطعة", deliveredToId: 51 });
    const physicalUsed = multiple ? index === 0 ? 0 : used : used;
    physicalUsages.push({ deliveryDocumentId: id, usedQuantity: physicalUsed });
    const note = { version: 2, routeDecisionActionId: ROUTE, materialRequestItemId: null, deliveryDocumentId: id, deliveryNumber: `DLV-${id}`,
      inventoryTransactionId: 400 + index, inventoryLotId: lotId, lotCode: `LOT-${lotId}`, inventoryId, warehouseId: 2, catalogItemId,
      quantity, originalQuantity: quantity, generalStockQuantity: quantity, materialRequestQuantity: 0, requiredQuantity: 6,
      requesterUserId: 51, recipientUserId: 51, unit: "قطعة", ...(physical && index === 1 ? { replacementPlanId: 77, replacementItemName: "Replacement material" } : {}) };
    f.insert("pmv2_item_actions", { id: 110 + index, taskItemId: ITEM, visitId: 1, action: "material_issue_linked", note: JSON.stringify(note), performedById: 50 });
  });
  const route = { version: 1, route: "team_inventory", catalogItemId: 900, itemNameSnapshot: "Material 900", requestedQuantity: 6, unit: "قطعة",
    teamWarehouseId: 2, inventoryId: 200, availableQuantity: 6, shortageQuantity: 0, lotsRequired: true, materialRequestId: null, materialRequestItemId: null };
  f.insert("pmv2_item_actions", { id: ROUTE, taskItemId: ITEM, visitId: 1, action: "material_route_decision", note: JSON.stringify(route), performedById: 51 });
  const declaration = { version: 1, routeDecisionActionId: ROUTE, catalogItemId: 900, materialRequestItemId: null, requiredQuantity: 6,
    issuedQuantity: 6, usedQuantity: physical ? null : used, toReturnQuantity: physical ? null : 6 - used, unit: "قطعة", declaredById: 51,
    ...(physical ? { physicalMode: true, physicalUsages } : {}) };
  f.insert("pmv2_item_actions", { id: DECLARATION, taskItemId: ITEM, visitId: 1, action: "material_consumption_declared", note: JSON.stringify(declaration), performedById: 51 });
}

function snapshot() {
  return Object.fromEntries(["inventory", "inventory_lots", "inventory_lot_balances", "warehouse_returns", "inventory_transactions", "return_documents", "test_return_counter", "pmv2_item_actions", "pmv2_material_usages"]
    .map(table => [table, f.memory.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));
}
const allocations = [{ lotId: 20, quantity: 2 }, { lotId: 21, quantity: 1 }];
const confirm = (actor = 50, lotAllocations?: typeof allocations) => service.confirmPendingReturn(actor, { declarationActionId: DECLARATION, lotAllocations });

beforeEach(() => {
  ports.calls = [];
  f = purchaseSpecificationsDatabase();
  f.memory.exec(`
    ALTER TABLE users ADD COLUMN username TEXT;
    ALTER TABLE inventory ADD COLUMN internalCode TEXT;
    ALTER TABLE inventory ADD COLUMN manufacturerBarcode TEXT;
    ALTER TABLE inventory ADD COLUMN updatedAt TEXT;
    ALTER TABLE warehouse_returns ADD COLUMN purchaseOrderId INTEGER;
    ALTER TABLE warehouse_returns ADD COLUMN purchaseOrderItemId INTEGER;
    ALTER TABLE warehouse_returns ADD COLUMN inventoryId INTEGER;
    ALTER TABLE warehouse_returns ADD COLUMN sourceDeliveryDocumentId INTEGER;
    ALTER TABLE warehouse_returns ADD COLUMN reason TEXT;
    ALTER TABLE warehouse_returns ADD COLUMN returnedById INTEGER;
    ALTER TABLE inventory_transactions ADD COLUMN returnId INTEGER;
    CREATE TABLE delivery_documents(id INTEGER PRIMARY KEY,inventoryId INTEGER,lotId INTEGER,warehouseId INTEGER,catalogItemId INTEGER,quantity NUMERIC,unitCost NUMERIC,unit TEXT,deliveredToId INTEGER);
    CREATE TABLE return_documents(id INTEGER PRIMARY KEY,returnId INTEGER,returnNumber TEXT,returnedQuantity NUMERIC);
    CREATE TABLE test_return_counter(sequence INTEGER); INSERT INTO test_return_counter VALUES(0);
    CREATE TABLE pmv2_item_actions(id INTEGER PRIMARY KEY,taskItemId INTEGER,visitId INTEGER,action TEXT,note TEXT,performedById INTEGER,createdAt TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE pmv2_teams(id INTEGER PRIMARY KEY,warehouseId INTEGER,code TEXT,isActive INTEGER);
    CREATE TABLE pmv2_team_members(id INTEGER PRIMARY KEY,teamId INTEGER,userId INTEGER,isActive INTEGER);
    CREATE TABLE pmv2_tasks(id INTEGER PRIMARY KEY,teamId INTEGER,taskNumber TEXT,status TEXT,programTargetId INTEGER);
    CREATE TABLE pmv2_task_items(id INTEGER PRIMARY KEY,taskId INTEGER,titleSnapshot TEXT,status TEXT,result TEXT);
    CREATE TABLE pmv2_visits(id INTEGER PRIMARY KEY,taskId INTEGER,performedById INTEGER);
    CREATE TABLE pmv2_material_request_items(id INTEGER PRIMARY KEY,requestedQuantity NUMERIC,issuedToTeamQuantity NUMERIC,status TEXT);
    CREATE TABLE pmv2_material_usages(id INTEGER PRIMARY KEY,taskItemId INTEGER,visitId INTEGER,materialRequestItemId INTEGER,warehouseId INTEGER,catalogItemId INTEGER,inventoryTransactionId INTEGER,inventoryLotId INTEGER,deliveryDocumentId INTEGER,purchaseOrderItemId INTEGER,usedQuantity NUMERIC,unitSnapshot TEXT,recordedById INTEGER);
  `);
  const baseTransaction = f.db.transaction;
  f.db.transaction = (work: any, config?: any) => baseTransaction(async () => {
    f.transactionConfig = config;
    const tx = Object.create(f.db);
    tx.execute = async (query: any) => {
      const statement = new MySqlDialect().sqlToQuery(query).sql;
      if (f.beforeDeliveryLock && /SELECT id FROM delivery_documents WHERE id IN/.test(statement)) {
        const boundary = f.beforeDeliveryLock;
        f.beforeDeliveryLock = undefined;
        await boundary();
      }
      return f.db.execute(query);
    };
    tx.transaction = () => { throw Error("Nested transaction is forbidden in the atomic return fixture"); };
    f.tx = tx;
    return work(tx);
  });
  ports.db = f.db;
  ports.nativeReturn = nativeWriter();
});
afterEach(() => f.close());

describe("PMV2 physical return + task linkage + usage finalization share one transaction", () => {
  it("the real adapter forwards the exact transaction to the existing native writer", async () => {
    const writer = vi.fn(async (_input: any, _tx?: any) => ({ returnId: 1, returnNumber: "RTN-1", lotId: 20, lotCode: "LOT-20", returnedQuantity: 3 }));
    const adapter = vm.runInNewContext(adapterCode, { createRecipientWarehouseReturn: writer });
    const input = { sourceDeliveryDocumentId: 30, returnedQuantity: 3, reason: "Unused", returnedById: 50 }, tx = { marker: "shared transaction" };
    expect(await adapter.createReturn(input, tx)).toEqual({ returnId: 1, returnNumber: "RTN-1", sourceDeliveryDocumentId: 30, lotId: 20, lotCode: "LOT-20", returnedQuantity: 3 });
    expect(writer).toHaveBeenCalledWith(input, tx);
    await adapter.createReturn(input);
    expect(writer.mock.calls[1][0]).toBe(input);
    expect(writer.mock.calls[1][1]).toBeUndefined();
  });

  it("posts the native return, source lot/cost and final task records together", async () => {
    seed();
    const result = await confirm();
    expect(result).toMatchObject({ completed: true, remainingReturnQuantity: 0 });
    expect(result.posted).toHaveLength(1);
    expect(ports.calls[0].tx).toBe(f.tx);
    expect(f.transactionConfig).toEqual({ isolationLevel: "read committed" });
    expect(f.memory.prepare("SELECT quantity,totalCostValue FROM inventory WHERE id=200").get()).toEqual({ quantity: 3, totalCostValue: 15 });
    expect(f.memory.prepare("SELECT lotId,sourceDeliveryDocumentId,returnedQuantity FROM warehouse_returns").all()).toEqual([{ lotId: 20, sourceDeliveryDocumentId: 30, returnedQuantity: 3 }]);
    expect(f.memory.prepare("SELECT usedQuantity,deliveryDocumentId FROM pmv2_material_usages").all()).toEqual([{ usedQuantity: 3, deliveryDocumentId: 30 }]);
    expect(f.memory.prepare("SELECT action FROM pmv2_item_actions WHERE id>120 ORDER BY id").all()).toEqual([
      { action: "material_return_part_linked" }, { action: "material_consumption_finalized" }, { action: "material_return_completed" },
    ]);
    expect(await service.listPendingReturns()).toEqual([]);
  });

  it("rechecks the fresh source cap after another generic return commits before the delivery lock", async () => {
    seed();
    let externalState: ReturnType<typeof snapshot> | undefined;
    f.beforeDeliveryLock = async () => {
      // SQLite is not TiDB MVCC. Emulate an RC statement boundary before the
      // first physical lock (the outer unit has performed reads only), commit
      // a real native generic return independently, then resume the PMV2 unit.
      // The required isolation config is asserted separately above.
      expect(f.memory.prepare("SELECT COUNT(*) AS count FROM warehouse_returns").get()).toEqual({ count: 0 });
      f.memory.exec("COMMIT; BEGIN");
      await ports.nativeReturn({ sourceDeliveryDocumentId: 30, returnedQuantity: 5, reason: "Generic concurrent return", returnedById: 50 }, f.db);
      f.memory.exec("COMMIT; BEGIN");
      externalState = snapshot();
    };
    await expect(confirm()).rejects.toThrow(/أكبر من المتبقي/);
    expect(f.transactionConfig).toEqual({ isolationLevel: "read committed" });
    expect(snapshot()).toEqual(externalState);
    expect(f.memory.prepare("SELECT quantity,totalCostValue FROM inventory WHERE id=200").get()).toEqual({ quantity: 5, totalCostValue: 25 });
    expect(f.memory.prepare("SELECT returnedQuantity FROM warehouse_returns").all()).toEqual([{ returnedQuantity: 5 }]);
    expect(f.memory.prepare("SELECT COUNT(*) AS count FROM pmv2_item_actions WHERE action='material_return_part_linked'").get()).toEqual({ count: 0 });
  });

  it.each(["link", "usage", "completed"])("rolls back the physical stock/document if saving %s fails", async point => {
    seed();
    const before = snapshot();
    const table = point === "usage" ? "pmv2_material_usages" : "pmv2_item_actions";
    const condition = point === "link" ? "WHEN NEW.action='material_return_part_linked'" : point === "completed" ? "WHEN NEW.action='material_return_completed'" : "";
    f.memory.exec(`CREATE TRIGGER fail_${point} BEFORE INSERT ON ${table} ${condition} BEGIN SELECT RAISE(ABORT,'${point} failure'); END`);
    await expect(confirm()).rejects.toThrow(`${point} failure`);
    expect(snapshot()).toEqual(before);
    expect((await service.listPendingReturns())[0].remainingReturnQuantity).toBe(3);
    f.memory.exec(`DROP TRIGGER fail_${point}`);
    expect((await confirm()).completed).toBe(true);
    expect(f.memory.prepare("SELECT COUNT(*) AS count FROM warehouse_returns").get()).toEqual({ count: 1 });
  });

  it("rolls every earlier lot back if a later physical return fails", async () => {
    seed({ multiple: true });
    const before = snapshot();
    f.memory.exec("CREATE TRIGGER fail_second BEFORE INSERT ON warehouse_returns WHEN NEW.lotId=21 BEGIN SELECT RAISE(ABORT,'second lot failure'); END");
    await expect(confirm(50, allocations)).rejects.toThrow("second lot failure");
    expect(snapshot()).toEqual(before);
    f.memory.exec("DROP TRIGGER fail_second");
    expect((await confirm(50, allocations)).posted).toHaveLength(2);
    expect(f.memory.prepare("SELECT lotId,returnedQuantity FROM warehouse_returns ORDER BY lotId").all()).toEqual([{ lotId: 20, returnedQuantity: 2 }, { lotId: 21, returnedQuantity: 1 }]);
  });

  it.each(["sourceDeliveryDocumentId", "lotId", "returnedQuantity"])("rolls the native movement back if its %s does not match the task allocation", async field => {
    seed();
    const before = snapshot(), actual = ports.nativeReturn;
    ports.nativeReturn = async (input: any, tx: any) => ({ ...await actual(input, tx), [field]: 999 });
    await expect(confirm()).rejects.toThrow();
    expect(snapshot()).toEqual(before);
  });

  it("does not increase stock a second time on retry after a successful confirmation", async () => {
    seed();
    await confirm();
    const saved = snapshot();
    await expect(confirm()).rejects.toThrow(/لم يعد معلق|تم استلامه/);
    expect(snapshot()).toEqual(saved);
  });

  it("serializes concurrent confirmations into one physical return", async () => {
    seed();
    const result = await Promise.allSettled([confirm(), confirm()]);
    expect(result.filter(row => row.status === "fulfilled")).toHaveLength(1);
    expect(f.memory.prepare("SELECT returnedQuantity FROM warehouse_returns").all()).toEqual([{ returnedQuantity: 3 }]);
    expect(f.memory.prepare("SELECT quantity FROM inventory WHERE id=200").get()).toEqual({ quantity: 3 });
    expect(f.memory.prepare("SELECT COUNT(*) AS count FROM pmv2_item_actions WHERE action='material_return_completed'").get()).toEqual({ count: 1 });
  });

  it("keeps replacement physical units/lots and consumption separate from the original need", async () => {
    seed({ multiple: true, physical: true });
    const result = await confirm(50, allocations);
    expect(result).toMatchObject({ completed: true, remainingReturnQuantity: 0 });
    expect(f.memory.prepare("SELECT lotId,returnedQuantity FROM warehouse_returns ORDER BY lotId").all()).toEqual([{ lotId: 20, returnedQuantity: 2 }, { lotId: 21, returnedQuantity: 1 }]);
    expect(f.memory.prepare("SELECT catalogItemId,usedQuantity,deliveryDocumentId FROM pmv2_material_usages").all()).toEqual([{ catalogItemId: 901, usedQuantity: 3, deliveryDocumentId: 31 }]);
  });

  it.each([50, 52, 53])("preserves the active warehouse/admin/owner grant for actor %s", async actor => {
    seed();
    expect((await confirm(actor)).completed).toBe(true);
    expect(f.memory.prepare("SELECT returnedById FROM warehouse_returns").all()).toEqual([{ returnedById: actor }]);
  });

  it.each(["technician", "delegate", "accountant", "senior_management", "it_manager", "general_maintenance_manager"])("denies a direct %s call at the same physical-write boundary", async role => {
    seed();
    f.memory.prepare("UPDATE users SET role=? WHERE id=50").run(role);
    const before = snapshot();
    await expect(confirm()).rejects.toThrow();
    expect(snapshot()).toEqual(before);
    expect(ports.calls).toHaveLength(0);
  });

  it.each(["inactive", "missing"])("freshly denies a %s account after the pending list was read", async status => {
    seed();
    expect(await service.listPendingReturns()).toHaveLength(1);
    if (status === "inactive") f.memory.exec("UPDATE users SET isActive=0 WHERE id=50");
    else f.memory.exec("DELETE FROM users WHERE id=50");
    const before = snapshot();
    await expect(confirm()).rejects.toThrow();
    expect(snapshot()).toEqual(before);
    expect(ports.calls).toHaveLength(0);
  });

  it.each(["different_action", "missing_parent"])("rejects a forged %s declaration without posting another task's stock", async kind => {
    seed();
    if (kind === "different_action") f.memory.exec("UPDATE pmv2_item_actions SET action='other_action' WHERE id=120");
    else f.memory.exec("DELETE FROM pmv2_task_items WHERE id=10");
    const before = snapshot();
    await expect(confirm()).rejects.toThrow();
    expect(snapshot()).toEqual(before);
    expect(ports.calls).toHaveLength(0);
  });

  it("requires all pending multi-lot quantities before creating any physical return", async () => {
    seed({ multiple: true });
    const before = snapshot();
    await expect(confirm(50, [{ lotId: 20, quantity: 1 }])).rejects.toThrow(/مجموع توزيع/);
    expect(snapshot()).toEqual(before);
    expect(ports.calls).toHaveLength(0);
  });

  it("retains other task declarations and denies a missing or malformed declaration without a stock write", async () => {
    seed();
    const before = snapshot();
    await expect(service.confirmPendingReturn(50, { declarationActionId: 999 })).rejects.toThrow();
    f.memory.prepare("UPDATE pmv2_item_actions SET note='invalid JSON' WHERE id=120").run();
    const malformed = snapshot();
    await expect(confirm()).rejects.toThrow();
    expect(snapshot()).toEqual(malformed);
    expect(before.warehouse_returns).toEqual([]);
  });
});

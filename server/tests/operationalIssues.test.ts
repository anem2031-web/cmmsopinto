import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { and, eq, gte, notInArray, sql, getTableName } from "drizzle-orm";
import * as schema from "../../drizzle/schema";
import { calculateMovementTotal, normalizeInventoryQuantity, roundTo } from "../_core/inventory-costing";
import { assertOperationalIssueReference, recordOperationalDelivery } from "../services/operational-issues/issue-reference";
import { OperationalIssueService } from "../services/operational-issues/service";
import { createOperationalIssuesRouter } from "../routers/operational-issues/router";
import { router } from "../routers/_shared/procedures";
import { operationalNetCost } from "../../shared/operational-issues";
import { canRoleAccessPath } from "../../shared/roles";
import type { TrpcContext } from "../_core/context";
import { captureDocumentSignature, readDocumentSignature } from "../../shared/documentSignatureSnapshot";

const manager = { id: 10, role: "maintenance_manager", isActive: 1, name: "Manager" };
const warehouse = { id: 20, role: "warehouse", isActive: 1, name: "Warehouse" };
const body = { siteId: 1, sectionId: 2, collectorId: 101, reason: "تشغيل الموقع", operationKey: "create-1", items: [{ catalogItemId: 5, quantity: 3 }] };
const physicalSource = fs.readFileSync("server/_core/db/warehouse-returns.ts", "utf8");
const physicalAst = ts.createSourceFile("warehouse.ts", physicalSource, ts.ScriptTarget.Latest, true);
const physicalNode = physicalAst.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "issueDelivery");
if (!physicalNode) throw new Error("Canonical physical writer missing");
const physicalCode = ts.transpileModule(`(${physicalNode.getText(physicalAst).replace(/^export /, "")})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

function fixture() {
  let state: any = { orders: [], items: [], deliveries: [], documents: [], movements: [], returns: [], returnOps: [], stock: 10, lotStock: 10, audits: [], contexts: [] };
  const flags = { stockUnits: ["حبة"], catalogUnit: "حبة", failLedger: false, wrongLot: false, returnCalls: 0, collectorActive: 1, actorRole: "warehouse", sectionValid: true, warehouseSignature: null as string | null };
  let queue: Promise<any> = Promise.resolve(); const queries: any[] = [];
  const rows = (value: any[]) => [value];
  const issued = (id: number) => state.deliveries.filter((d: any) => d.orderItemId === id).reduce((sum: number, d: any) => sum + Number(d.quantity), 0);
  const tx: any = {
    execute: async (statement: any) => {
      const { sql: q, params: p } = new MySqlDialect().sqlToQuery(statement); queries.push({ q, p });
      if (q.includes("information_schema.TABLES")) return rows([]);
      if (q.startsWith("SELECT id FROM users WHERE id=")) return rows([{ id: p[0] }]);
      if (q.includes("FROM operational_issue_orders WHERE operationKey=")) return rows(state.orders.filter((o: any) => o.operationKey === p[0] && o.createdById === p[1]));
      if (q.includes("FROM sections WHERE")) return rows(flags.sectionValid && p[0] === 2 && p[1] === 1 ? [{ id: 2 }] : []);
      if (q.includes("FROM users WHERE id=") && q.includes("role='technician'")) return rows(p[0] === 101 && flags.collectorActive ? [{ id: 101 }] : []);
      if (q.includes("FROM catalog_items WHERE")) return rows(p[0] === 5 ? [{ id: 5, nameAr: "لمبة", unit: flags.catalogUnit }] : []);
      if (q.startsWith("SELECT DISTINCT COALESCE")) return rows(flags.stockUnits.map(unit => ({ unit })));
      if (q.startsWith("INSERT INTO operational_issue_orders")) {
        const id = state.orders.length + 1;
        state.orders.push({ id, createdById: p[0], collectorId: p[1], siteId: p[2], sectionId: p[3], reason: p[4], operationKey: p[5], requestFingerprint: p[6], status: "pending", revision: 0 }); return [{ insertId: id }];
      }
      if (q.startsWith("UPDATE operational_issue_orders SET orderNumber")) { state.orders.find((o: any) => o.id === p[1]).orderNumber = p[0]; return [{ affectedRows: 1 }]; }
      if (q.startsWith("INSERT INTO operational_issue_items")) { state.items.push({ id: state.items.length + 1, orderId: p[0], catalogItemId: p[1], itemName: p[2], unit: p[3], quantity: p[4] }); return [{ insertId: state.items.length }]; }
      if (q.startsWith("INSERT INTO audit_logs")) { state.audits.push(p); return [{ insertId: state.audits.length }]; }
      if (q.includes("FROM operational_issue_orders o")) {
        const hasId = q.includes("WHERE o.id=");
        return rows(state.orders.filter((o: any) => !hasId || o.id === p[0]).map((o: any) => ({ ...o, creatorName: "Manager", collectorName: "Technician", siteName: "Site", sectionName: "Section" })));
      }
      if (q.startsWith("UPDATE operational_issue_orders SET status='approved'")) { Object.assign(state.orders.find((o: any) => o.id === p[1]), { status: "approved", revision: 1 }); return [{ affectedRows: 1 }]; }
      if (q.includes("SELECT x.*,d.deliveryNumber") && q.includes("WHERE x.operationKey=")) return rows(state.deliveries.filter((d: any) => d.operationKey === p[0]));
      if (q.startsWith("SELECT * FROM operational_issue_items WHERE") || q.startsWith("SELECT id FROM operational_issue_items WHERE")) return rows(state.items.filter((i: any) => i.id === p[0] && i.orderId === p[1]));
      if (q.includes("SELECT i.*,o.orderNumber")) {
        const i = state.items.find((i: any) => i.id === p[1]), o = state.orders.find((o: any) => o.id === i?.orderId);
        return rows(i && o ? [{ ...i, ...o, id: i.id, orderId: o.id, collectorActive: flags.collectorActive, collectorRole: "technician", actorActive: 1, actorRole: flags.actorRole }] : []);
      }
      if (q.includes("SUM(quantity),0) AS issued")) return rows([{ issued: issued(p[0] as number) }]);
      if (q.startsWith("SELECT id FROM inventory")) return rows([{ id: 1 }]);
      if (q.startsWith("INSERT INTO operational_issue_deliveries")) {
        if (flags.failLedger) throw Error("ledger failed");
        state.deliveries.push({ id: state.deliveries.length + 1, orderItemId: p[0], deliveryDocumentId: p[1], inventoryTransactionId: p[2], quantity: p[3], lotUnitCost: p[4], cost: p[5], operationKey: p[6], requestFingerprint: p[7] }); return [{ insertId: state.deliveries.length }];
      }
      if (q.includes("SELECT COUNT(*) AS remaining")) return rows([{ remaining: state.items.filter((i: any) => i.orderId === p[0] && Number(i.quantity) > issued(i.id)).length }]);
      if (q.startsWith("UPDATE operational_issue_orders SET revision")) { const o = state.orders.find((o: any) => o.id === p[1]); o.status = p[0]; o.revision++; return [{ affectedRows: 1 }]; }
      if (q.startsWith("SELECT * FROM operational_issue_return_operations")) return rows(state.returnOps.filter((o: any) => o.operationKey === p[0]));
      if (q.includes("SELECT d.id FROM operational_issue_deliveries")) return rows(state.deliveries.filter((d: any) => state.items.some((i: any) => i.id === d.orderItemId && i.orderId === p[0]) && d.deliveryDocumentId === p[1]));
      if (q.startsWith("INSERT INTO operational_issue_return_operations")) { state.returnOps.push({ operationKey: p[0], orderId: p[1], deliveryDocumentId: p[2], quantity: p[3], reason: p[4], resultJson: p[5] }); return [{ insertId: 1 }]; }
      if (q.includes("SELECT i.*,COALESCE")) return rows(state.items.filter((i: any) => i.orderId === p[0]).map((i: any) => ({ ...i, issuedQuantity: issued(i.id) })));
      if (q.includes("SELECT x.*,d.deliveryNumber,l.lotCode")) return rows(state.deliveries.filter((d: any) => state.items.some((i: any) => i.id === d.orderItemId && i.orderId === p[0])).map((d: any) => ({ ...d, deliveryNumber: `DLV-${d.deliveryDocumentId}`, lotCode: "LOT-1", returnedQuantity: state.returns.filter((r: any) => r.sourceDeliveryDocumentId === d.deliveryDocumentId).reduce((s: number, r: any) => s + r.returnedQuantity, 0) })));
      throw Error("Unhandled in-memory SQL: " + q);
    },
    update: () => ({ set: (values: any) => ({ where: async () => {
      const amount = new MySqlDialect().sqlToQuery(values.quantity).params[0] as number;
      if (amount > state.stock) return [{ affectedRows: 0 }]; state.stock -= amount; return [{ affectedRows: 1 }];
    } }) }),
    insert: (table: any) => ({ values: async (value: any) => {
      const name = getTableName(table), list = name === "inventory_transactions" ? state.movements : name === "material_execution_cost_contexts" ? state.contexts : [];
      list.push(value); return [{ insertId: list.length || 1 }];
    } }),
  };
  const database: any = { execute: tx.execute, transaction: (work: (tx: any) => Promise<any>) => {
    const next = queue.then(async () => { const old = structuredClone(state); try { return await work(tx); } catch (e) { state = old; throw e; } }); queue = next.catch(() => {}); return next;
  } };
  const actualIssue = vm.runInNewContext(physicalCode, {
    captureDocumentSignature,
    ...schema, sql, and, eq, gte, notInArray, getDb: async () => database,
    isInventoryLotsEnabled: () => true, materialExecutionCostsEnabled: () => true,
    assertOperationalIssueReference, recordOperationalDelivery,
    getUserById: async (id: number) => id === 101 ? { id, name: "Technician", role: "technician", isActive: 1 } : { ...warehouse, signatureUrl: flags.warehouseSignature },
    getInventoryItemById: async () => ({ id: 1, linkedItemId: 5, quantity: state.stock, unit: "حبة", issueUnit: "حبة", averageCost: "5" }),
    consumeInventoryLotForIssue: async (input: any) => {
      if (input.quantity > state.lotStock) throw Error("lot stock exceeded"); state.lotStock -= input.quantity;
      return { lotId: 1, lotCode: "LOT-1", issueUnitCost: 10, trackingToken: "LOT-1", balanceQuantity: state.lotStock, remainingQuantity: state.lotStock };
    },
    normalizeIssueCostAllocations: async (input: any) => input.allocations.map((i: any) => ({ ...i, beneficiaryAssetId: null })),
    getNextDeliveryNumber: async () => `DLV-${state.documents.length + 1}`,
    createDeliveryDocument: async (input: any) => { const id = state.documents.length + 1; state.documents.push({ id, ...input }); return { insertId: id }; },
    normalizeInventoryQuantity, calculateMovementTotal, roundTo,
  });
  const ports = {
    database: vi.fn(async () => database),
    issue: vi.fn((current: any, input: any) => actualIssue(input, current)),
    resolveLot: vi.fn(async () => ({ linkedItemId: flags.wrongLot ? 6 : 5, inventoryId: 1, trackingToken: "LOT-1", unit: "حبة" })),
    returnDelivery: vi.fn(async (_tx: any, input: any) => {
      flags.returnCalls++; const document = state.documents.find((d: any) => d.id === input.sourceDeliveryDocumentId);
      const used = state.returns.filter((r: any) => r.sourceDeliveryDocumentId === document?.id).reduce((s: number, r: any) => s + r.returnedQuantity, 0);
      if (!document || used + input.returnedQuantity > document.quantity) throw Error("over-return");
      state.stock += input.returnedQuantity; state.lotStock += input.returnedQuantity;
      state.returns.push(input); return { returnNumber: `RTN-${state.returns.length}`, ...input };
    }),
  };
  const service = new OperationalIssueService(ports);
  return { service, ports, queries, flags, tx, state: () => state, async ready(quantity = 3) { const order = await service.create(manager, { ...body, items: [{ catalogItemId: 5, quantity }] }); await service.approve(warehouse, order.id, 0); return order; } };
}
beforeEach(() => vi.stubEnv("OPERATIONAL_ISSUES_ENABLED", "true"));
afterEach(() => vi.unstubAllEnvs());

describe("Operational order → existing physical issue → original-delivery return", () => {
  it.each([null, "cmms/uploads/u-20/original-signature.png"])("freezes the real warehouse issuer's signature in the actual physical writer: %s", async signature => {
    const f = fixture(); f.flags.warehouseSignature = signature; await f.ready();
    await f.service.issue(warehouse, { orderId: 1, itemId: 1, warehouseId: 1, lotTrackingToken: "LOT-1", quantity: 3, operationKey: "signature-fixture" });
    const document = f.state().documents[0];
    expect(document.deliveredByName).toBe(warehouse.name);
    expect(readDocumentSignature(document.deliveredBySignatureSnapshot, warehouse.id)).toMatchObject({ actorId: warehouse.id, name: warehouse.name, signatureUrl: signature });
    f.flags.warehouseSignature = "cmms/uploads/u-20/changed.png";
    expect(readDocumentSignature(document.deliveredBySignatureSnapshot, warehouse.id)?.signatureUrl).toBe(signature);
    expect(f.state().stock).toBe(7); expect(f.state().lotStock).toBe(7);
  });
  it("preserves the existing PMV2 warehouse batch route by carrying its authoritative task item reference", async () => {
    const source = fs.readFileSync("server/routers/inventory/warehouse-issue-batches.router.ts", "utf8");
    const ast = ts.createSourceFile("wis.ts", source, ts.ScriptTarget.Latest, true);
    const helper = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === "getPmv2WarehouseIssueContext")!;
    const execute = vi.fn(async (..._args: any[]) => [[{ materialRequestItemId: 8, taskItemId: 19, taskNumber: "PMV2-TEST", siteId: 1, sectionId: 2 }], []]);
    const context = vm.runInNewContext(ts.transpileModule(`(${helper.getText(ast)})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, {
      db: { getDb: async () => ({ execute }) }, toPositiveInt: (v: any) => Number(v) > 0 ? Number(v) : null,
      firstSqlRow: (v: any) => v[0][0], normalizeCostTarget: async (_db: any, target: any) => target,
    });
    expect((await context(70)).taskItemId).toBe(19); expect(execute.mock.calls[0][0]).toContain("taskItem.id AS taskItemId");
    let expression = "";
    function walk(n: ts.Node) { if (ts.isCallExpression(n) && n.expression.getText(ast) === "db.issueDelivery") { const object = n.arguments[0] as ts.ObjectLiteralExpression; expression = (object.properties.find(p => p.name?.getText(ast) === "pmv2TaskItemId") as ts.PropertyAssignment).initializer.getText(ast); } ts.forEachChild(n,walk); }
    walk(ast); const evalRef = (enabled: boolean, ticket: boolean) => vm.runInNewContext(expression, { operationalIssuesEnabled: () => enabled, linkToTicket: ticket, pmv2Context: { taskItemId: 19 } });
    expect(evalRef(true,false)).toBe(19); expect(evalRef(false,false)).toBeUndefined(); expect(evalRef(true,true)).toBeUndefined();
  });
  it("creates a stable request without affecting stock and retries creation safely", async () => {
    const f = fixture(); const one = await f.service.create(manager, body), two = await f.service.create(manager, body);
    expect(one.id).toBe(two.id); expect(f.state().orders).toHaveLength(1); expect(f.state().stock).toBe(10);
    await expect(f.service.create(manager, { ...body, reason: "changed" })).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("keeps new operational quantities compatible with the existing integer delivery and return documents", async () => {
    const f = fixture(); await expect(f.service.create(manager, { ...body, items: [{ catalogItemId: 5, quantity: 1.5 }] })).rejects.toThrow("الكمية");
    await f.ready(3);
    await expect(f.service.issue(warehouse, { orderId: 1, itemId: 1, warehouseId: 1, lotTrackingToken: "LOT-1", quantity: 1.5, operationKey: "fraction" })).rejects.toThrow("صحيحًا");
    expect(f.state().stock).toBe(10);
  });
  it("freezes the real stock issue unit rather than the purchase/catalog package unit, and rejects ambiguous or stale units", async () => {
    const f = fixture(); f.flags.catalogUnit = "كرتون";
    expect(await f.service.itemUnits(manager, [5])).toEqual([{ catalogItemId: 5, unit: "حبة" }]);
    await expect(f.service.create(manager, { ...body, items: [{ catalogItemId: 5, quantity: 3, unit: "كرتون" }] })).rejects.toThrow("وحدة الصرف");
    await f.ready(3); expect(f.state().items[0].unit).toBe("حبة");
    f.flags.stockUnits = ["حبة", "كرتون"]; await expect(f.service.itemUnits(manager, [5])).rejects.toThrow("مختلفة");
  });
  it("uses the actual existing physical writer, records original lot cost and completes the order", async () => {
    const f = fixture(); const order = await f.ready();
    await f.service.issue(warehouse, { orderId: order.id, itemId: 1, warehouseId: 1, lotTrackingToken: "LOT-1", quantity: 3, operationKey: "issue-1" });
    expect(f.state().stock).toBe(7); expect(f.state().lotStock).toBe(7);
    expect(f.state().documents).toHaveLength(1); expect(f.state().deliveries[0].cost).toBe(30);
    expect(f.state().contexts[0].executionSource).toBe("operational");
    expect(f.state().movements[0].unitCost).toBe("5.0000"); // existing inventory valuation is unchanged
    expect(f.state().orders[0].status).toBe("completed");
  });
  it("does not double issue on retries or simultaneous submission", async () => {
    const f = fixture(); await f.ready();
    const input = { orderId: 1, itemId: 1, warehouseId: 1, lotTrackingToken: "LOT-1", quantity: 3, operationKey: "once" };
    await Promise.all([f.service.issue(warehouse, input), f.service.issue(warehouse, input)]);
    expect(f.state().stock).toBe(7); expect(f.state().documents).toHaveLength(1);
    await expect(f.service.issue(warehouse, { ...input, quantity: 2 })).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("rejects oversupply and a different catalog lot without any stock change", async () => {
    const f = fixture(); await f.ready(2);
    const input = { orderId: 1, itemId: 1, warehouseId: 1, lotTrackingToken: "LOT-1", quantity: 3, operationKey: "oversupply" };
    await expect(f.service.issue(warehouse, input)).rejects.toThrow("المتبقي");
    f.flags.wrongLot = true; await expect(f.service.issue(warehouse, { ...input, quantity: 1 })).rejects.toThrow("اللوت");
    expect(f.state().stock).toBe(10); expect(f.state().documents).toHaveLength(0);
  });
  it("rolls back physical stock, lot, document and movement when the new reference write fails", async () => {
    const f = fixture(); await f.ready(); f.flags.failLedger = true;
    await expect(f.service.issue(warehouse, { orderId: 1, itemId: 1, warehouseId: 1, lotTrackingToken: "LOT-1", quantity: 3, operationKey: "failed" })).rejects.toThrow("ledger failed");
    expect(f.state().stock).toBe(10); expect(f.state().lotStock).toBe(10); expect(f.state().documents).toHaveLength(0); expect(f.state().movements).toHaveLength(0);
  });
  it("returns to the original delivery and lot, reduces net original cost, and retries without duplication", async () => {
    const f = fixture(); await f.ready();
    await f.service.issue(warehouse, { orderId: 1, itemId: 1, warehouseId: 1, lotTrackingToken: "LOT-1", quantity: 3, operationKey: "issue" });
    const returned = { orderId: 1, deliveryDocumentId: 1, quantity: 1, reason: "Unused", operationKey: "return-once" };
    await f.service.returnMaterial(warehouse, returned); await f.service.returnMaterial(warehouse, returned);
    expect(f.flags.returnCalls).toBe(1); expect(f.state().stock).toBe(8);
    expect((await f.service.detail(warehouse, 1)).cost).toEqual({ issued: 30, returned: 10, net: 20 });
    await expect(f.service.returnMaterial(warehouse, { ...returned, deliveryDocumentId: 100, operationKey: "other" })).rejects.toThrow("السند");
    await expect(f.service.returnMaterial(warehouse, { ...returned, quantity: 3, operationKey: "excess" })).rejects.toThrow("over-return");
  });
  it("requires approval, correct request/item pair and active designated collector", async () => {
    const f = fixture(); await f.service.create(manager, body);
    const input = { orderId: 1, itemId: 1, warehouseId: 1, lotTrackingToken: "LOT-1", quantity: 1, operationKey: "blocked" };
    await expect(f.service.issue(warehouse, input)).rejects.toThrow("معتمد");
    await f.service.approve(warehouse, 1, 0); f.flags.collectorActive = 0;
    await expect(f.service.issue(warehouse, input)).rejects.toThrow("الفني المحدد");
    await expect(f.service.issue(warehouse, { ...input, itemId: 100 })).rejects.toThrow("الصنف");
    expect(f.state().stock).toBe(10);
  });
  it.each(["technician", "it_member", "delegate", "operator", "observer"])("blocks creation/processing by %s", async role => {
    const f = fixture(); const actor = { ...manager, role };
    await expect(f.service.create(actor, body)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(f.service.approve(actor, 1, 0)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(f.ports.database).not.toHaveBeenCalled();
  });
  it.each(["maintenance_manager", "general_maintenance_manager", "construction_procurement_manager", "it_manager"])("validates site/section and scopes %s to their own requests", async role => {
    const f = fixture(); const actor = { ...manager, role };
    f.flags.sectionValid = false; await expect(f.service.create(actor, body)).rejects.toThrow("القسم");
    expect(f.state().orders).toHaveLength(0); f.flags.sectionValid = true; await f.service.create(actor, body);
    await expect(f.service.detail(actor, 1)).resolves.toHaveProperty("order.id", 1);
    await expect(f.service.detail({ ...actor, id: 11 }, 1)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(f.service.detail({ ...manager, role: "observer" }, 1)).resolves.toHaveProperty("order.id", 1);
  });
});

describe("Central reference guard and rollout", () => {
  it("retains IT manager access to existing own orders but closes the legacy catalog creation RPC", async () => {
    const f = fixture(); const actor = { ...manager, role: "it_manager" };
    const api = router({ operationalIssues: createOperationalIssuesRouter(f.ports, () => true) }).createCaller({ user: actor, req: {}, res: {} } as TrpcContext);
    expect(canRoleAccessPath(actor.role, "/operational-issues?source=menu")).toBe(true);
    expect(await api.operationalIssues.status()).toEqual({ enabled: true });
    await expect(api.operationalIssues.create({ ...body, items: body.items.map(item => ({ ...item, unit: "حبة" })) })).rejects.toMatchObject({code:"FORBIDDEN"});
    await f.service.create(actor,body); // Existing order fixture; the new inventory creation RPC is tested separately.
    expect(await api.operationalIssues.detail({ id: 1 })).toHaveProperty("order.createdById", actor.id);
    await api.operationalIssues.list();
    expect(f.queries.at(-1)?.q).toContain("WHERE o.createdById=?");
    expect(f.queries.at(-1)?.p).toEqual([actor.id]);
    await expect(api.operationalIssues.approve({ id: 1, revision: 0 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(api.operationalIssues.issue({ orderId: 1, itemId: 1, warehouseId: 1, lotTrackingToken: "LOT-1", quantity: 1, operationKey: "not-warehouse" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(api.operationalIssues.returnMaterial({ orderId: 1, deliveryDocumentId: 1, quantity: 1, reason: "Unused", operationKey: "not-warehouse-return" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    for (const path of ["/inventory", "/warehouse/issue", "/scheduled-maintenance/warehouse-requests", "/catalog"])
      expect(canRoleAccessPath(actor.role, path)).toBe(false);
    expect(canRoleAccessPath("it_member", "/operational-issues")).toBe(false);
    expect(f.state().stock).toBe(10); expect(f.state().documents).toHaveLength(0);
  });
  it("blocks independent issue while retaining named/team/PMV2 references", async () => {
    const f = fixture(); const base = { performedById: 20, catalogItemId: 5, quantity: 1 };
    await expect(assertOperationalIssueReference(f.tx, base)).rejects.toThrow("الصرف يتطلب");
    for (const reference of [{ ticketId: 1 }, { ticketItemId: 2 }, { pmv2TaskItemId: 3 }, { selectedTicketItemId: 4 }]) expect(await assertOperationalIssueReference(f.tx, { ...base, ...reference })).toBeNull();
  });
  it("does not read new tables or change legacy issues when rollout is disabled", async () => {
    vi.stubEnv("OPERATIONAL_ISSUES_ENABLED", "false"); const f = fixture();
    expect(await assertOperationalIssueReference(f.tx, { performedById: 20, catalogItemId: 5, quantity: 1 })).toBeNull(); expect(f.queries).toHaveLength(0);
    const api = router({ operationalIssues: createOperationalIssuesRouter(f.ports, () => false) }).createCaller({ user: warehouse, req: {}, res: {} } as TrpcContext);
    expect(await api.operationalIssues.list()).toEqual({ enabled: false, orders: [] }); expect(f.ports.database).not.toHaveBeenCalled();
  });
  it("keeps observer read-only through the central RPC guard", async () => {
    const f = fixture(); const api = router({ operationalIssues: createOperationalIssuesRouter(f.ports, () => true) }).createCaller({ user: { ...manager, role: "observer" }, req: {}, res: {} } as TrpcContext);
    expect(await api.operationalIssues.status()).toEqual({ enabled: true });
    await expect(api.operationalIssues.create(body)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(canRoleAccessPath("observer", "/operational-issues")).toBe(true); expect(canRoleAccessPath("technician", "/operational-issues")).toBe(false);
  });
  it("absorbs full-return rounding residue using the original snapshot", () => {
    expect(operationalNetCost([{ quantity: 3, returnedQuantity: 3, lotUnitCost: 0.3333, cost: 1 } as any])).toEqual({ issued: 1, returned: 1, net: 0 });
  });
});

import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { sql, and, eq, gte, notInArray, getTableName } from "drizzle-orm";
import * as schema from "../../drizzle/schema";
import { captureDocumentSignature } from "../../shared/documentSignatureSnapshot";
import {
  normalizeInventoryQuantity,
  calculateMovementTotal,
  roundTo,
} from "../_core/inventory-costing";
import {
  assertOperationalIssueReference,
  recordOperationalDelivery,
} from "../services/operational-issues/issue-reference";
import {
  createPrepared,
  issuePrepared,
  preparedStockChoices,
  preparedSelection,
} from "../services/operational-issues/prepared";
import { allocateOperationalFifo } from "../../shared/operational-dispatch";
import { OperationalIssueService } from "../services/operational-issues/service";
import { createOperationalIssuesRouter } from "../routers/operational-issues/router";
import { router } from "../routers/_shared/procedures";

const warehouse = { id: 20, role: "warehouse", isActive: 1, name: "Warehouse" };
const makeInput = () => ({
  warehouseId: 1,
  reason: "تشغيل",
  operationKey: "new-order",
  items: [
    {
      catalogItemId: 5,
      unit: "حبة",
      quantity: 3,
      source: "inventory" as const,
      siteId: 1,
      sectionId: 2,
      collectorId: 101,
    },
    {
      catalogItemId: 6,
      unit: "حبة",
      quantity: 2,
      source: "inventory" as const,
      siteId: 3,
      sectionId: 4,
      collectorId: 102,
    },
  ],
});
const issueInput = () => ({
  orderId: 1,
  revision: 1,
  operationKey: "batch",
  items: [
    { itemId: 1, actualCollectorId: 103, notes: "كشف المستودع" },
    { itemId: 2, actualCollectorId: null, notes: "" },
  ],
});
const source = fs.readFileSync("server/_core/db/warehouse-returns.ts", "utf8");
const ast = ts.createSourceFile(
  "physical.ts",
  source,
  ts.ScriptTarget.Latest,
  true
);
const node = ast.statements.find(
  n => ts.isFunctionDeclaration(n) && n.name?.text === "issueDelivery"
)!;
const physicalCode = ts.transpileModule(
  `(${node.getText(ast).replace(/^export /, "")})`,
  { compilerOptions: { target: ts.ScriptTarget.ES2022 } }
).outputText;
function fixture() {
  let state: any = {
    orders: [],
    items: [],
    batches: [],
    deliveries: [],
    documents: [],
    movements: [],
    allocations: [],
    contexts: [],
    audits: [],
    users: [
      { ...warehouse },
      { id: 10, role: "it_manager", isActive: 1, name: "IT" },
      ...[101, 102, 103].map(id => ({
        id,
        name: `Tech ${id}`,
        role: "technician",
        isActive: 1,
      })),
    ],
    inventories: [5, 6].map((id, n) => ({
      id: n + 1,
      linkedItemId: id,
      quantity: 10,
      unit: "حبة",
      issueUnit: "حبة",
      averageCost: "5",
      warehouseId: 1,
      warehouseNameAr: "الرئيسي",
      warehouseNameEn: "Main",
      isFrozen: 0,
    })),
    lots: [
      {
        inventoryId: 1,
        lotId: 11,
        quantity: 2,
        issueUnitCost: 10,
        receivedAt: "2026-01-01",
      },
      {
        inventoryId: 1,
        lotId: 12,
        quantity: 8,
        issueUnitCost: 20,
        receivedAt: "2026-02-01",
      },
      {
        inventoryId: 2,
        lotId: 13,
        quantity: 10,
        issueUnitCost: 30,
        receivedAt: "2026-01-01",
      },
    ].map(l => ({
      ...l,
      catalogItemId: l.inventoryId + 4,
      lotCode: `LOT-${l.lotId}`,
      trackingToken: `T-${l.lotId}`,
      issueUnit: "حبة",
      remainingQuantity: l.quantity,
    })),
  };
  const flags = {
    ready: true,
    failDocument: 0,
    failCommit: false,
    warehouseActive: true,
  };
  const queries: Array<{ q: string; p: any[] }> = [];
  let queue = Promise.resolve();
  const dialect = new MySqlDialect();
  const result = (data: any[]) => [structuredClone(data)];
  const used = (id: number) =>
    state.deliveries
      .filter((d: any) => d.orderItemId === id)
      .reduce((a: number, d: any) => a + d.quantity, 0);
  const tx: any = {
    execute: async (query: any) => {
      const { sql: q, params: p } = dialect.sqlToQuery(query);
      queries.push({ q, p });
      if (q.includes("information_schema"))
        return result(flags.ready ? [{ ok: 1 }] : []);
      if (q.startsWith("SELECT id,role,isActive FROM users"))
        return result(state.users.filter((u: any) => u.id === p[0]));
      if (q.includes("FROM operational_issue_orders WHERE operationKey"))
        return result(
          state.orders.filter(
            (o: any) => o.operationKey === p[0] && o.createdById === p[1]
          )
        );
      if (q.startsWith("SELECT * FROM operational_issue_orders"))
        return result(state.orders.filter((o: any) => o.id === p[0]));
      if (q.includes("FROM operational_issue_orders o"))
        return result(
          state.orders.filter(
            (o: any) => !q.includes("WHERE o.id=") || o.id === p[0]
          )
        );
      if (q.startsWith("SELECT id,nameAr,nameEn FROM warehouses"))
        return result(
          flags.warehouseActive
            ? [{ id: 1, nameAr: "الرئيسي", nameEn: "Main" }]
            : []
        );
      if (q.startsWith("SELECT s.id,s.siteId"))
        return result(
          [
            { id: 2, siteId: 1, name: "S2", siteName: "S1" },
            { id: 4, siteId: 3, name: "S4", siteName: "S3" },
          ].filter(s => p.includes(s.id))
        );
      if (q.includes("FROM users WHERE id IN"))
        return result(
          state.users.filter(
            (u: any) =>
              p.includes(u.id) && u.role === "technician" && u.isActive === 1
          )
        );
      if (q.startsWith("SELECT id FROM users WHERE id="))
        return result(
          state.users.filter(
            (u: any) =>
              u.id === p[0] && u.role === "technician" && u.isActive === 1
          )
        );
      if (q.startsWith("SELECT id,nameAr,nameEn,unit FROM catalog_items"))
        return result(
          [5, 6]
            .filter(id => p.includes(id))
            .map(id => ({ id, nameAr: `Item ${id}`, unit: "حبة" }))
        );
      if (q.startsWith("SELECT c.id,c.unit"))
        return result(
          [5, 6]
            .filter(id => p.slice(1).includes(id))
            .map(id => ({ id, unit: "حبة", stockUnit: "حبة" }))
        );
      if (q.startsWith("SELECT c.id,c.code"))
        return result(
          Array.from({ length: 51 }, (_, i) => ({
            id: i + 1,
            code: `C${i}`,
            nameAr: `Item${i}`,
            unit: "حبة",
          }))
        );
      if (q.includes("FROM inventory i INNER JOIN warehouses"))
        return result(
          state.inventories.filter(
            (i: any) =>
              p.slice(0, -1).includes(i.linkedItemId) &&
              i.warehouseId === p.at(-1) &&
              !i.isFrozen &&
              flags.warehouseActive
          )
        );
      if (q.includes("FROM inventory_lot_balances b"))
        return result(
          state.lots.filter(
            (l: any) => p.includes(l.catalogItemId) && l.quantity > 0
          )
        );
      if (q.startsWith("INSERT INTO operational_issue_orders")) {
        const id = state.orders.length + 1;
        state.orders.push({
          id,
          createdById: p[0],
          collectorId: p[1],
          siteId: p[2],
          sectionId: p[3],
          reason: p[4],
          operationKey: p[5],
          requestFingerprint: p[6],
          revision: 0,
          status: "pending",
        });
        return [{ insertId: id }];
      }
      if (q.startsWith("UPDATE operational_issue_orders SET orderNumber")) {
        state.orders.find((o: any) => o.id === p[1]).orderNumber = p[0];
        return [{ affectedRows: 1 }];
      }
      if (q.startsWith("INSERT INTO operational_issue_items")) {
        const id = state.items.length + 1;
        state.items.push({
          id,
          orderId: p[0],
          catalogItemId: p[1],
          itemName: p[2],
          unit: p[3],
          quantity: p[4],
          dispatchContext: p[5],
        });
        return [{ insertId: id }];
      }
      if (q.startsWith("SELECT userId,newValues FROM audit_logs"))
        return result(state.audits.filter((r:any)=>r.length===3&&r[1]===p[0]&&typeof r[2]==="string").map((r:any)=>({userId:r[0],newValues:r[2]})));
      if (q.startsWith("SELECT i.*,COALESCE"))
        return result(
          state.items
            .filter((i: any) => q.includes("WHERE i.id=") ? i.id === p[0] && i.orderId === p[1] : i.orderId === p[0])
            .map((i: any) => ({ ...i, issuedQuantity: used(i.id) }))
        );
      if (q.startsWith("SELECT * FROM operational_issue_batches"))
        return result(state.batches.filter((b: any) => b.orderId === p[0]));
      if (q.startsWith("INSERT INTO operational_issue_batches")) {
        state.batches.push({
          orderId: p[0],
          operationKey: p[1],
          requestFingerprint: p[2],
          issuedById: p[3],
          inputJson: p[4],
        });
        return [{ affectedRows: 1 }];
      }
      if (q.startsWith("UPDATE operational_issue_batches")) {
        if (flags.failCommit) throw Error("final ledger failed");
        state.batches.find((b: any) => b.orderId === p[1]).resultJson = p[0];
        return [{ affectedRows: 1 }];
      }
      if (q.startsWith("SELECT inputJson FROM operational_issue_batches"))
        return result(
          state.batches.filter(
            (b: any) =>
              b.orderId === p[0] &&
              (p.length === 1 ||
                (b.operationKey === p[1] && b.issuedById === p[2]))
          )
        );
      if (q.startsWith("SELECT id FROM inventory"))
        return result(state.inventories.filter((i: any) => i.id === p[0]));
      if (q.startsWith("SELECT i.*,o.orderNumber")) {
        const line = state.items.find((i: any) => i.id === p[1]),
          order = state.orders.find((o: any) => o.id === line?.orderId),
          actor = state.users.find((u: any) => u.id === p[0]);
        return result(
          line && order
            ? [
                {
                  ...line,
                  ...order,
                  id: line.id,
                  orderId: order.id,
                  actorActive: actor?.isActive,
                  actorRole: actor?.role,
                  collectorActive: 1,
                  collectorRole: "technician",
                },
              ]
            : []
        );
      }
      if (q.includes("SUM(quantity),0) AS issued"))
        return result([{ issued: used(Number(p[0])) }]);
      if (q.startsWith("INSERT INTO operational_issue_deliveries")) {
        state.deliveries.push({
          id: state.deliveries.length + 1,
          orderItemId: p[0],
          deliveryDocumentId: p[1],
          inventoryTransactionId: p[2],
          quantity: p[3],
          lotUnitCost: p[4],
          cost: p[5],
          operationKey: p[6],
          requestFingerprint: p[7],
        });
        return [{ insertId: state.deliveries.length }];
      }
      if (q.startsWith("SELECT COUNT(*) AS remaining"))
        return result([
          {
            remaining: state.items.filter(
              (i: any) => i.orderId === p[0] && i.quantity > used(i.id)
            ).length,
          },
        ]);
      if (q.startsWith("UPDATE operational_issue_orders SET revision")) {
        const order = state.orders.find((o: any) => o.id === p[1]);
        order.revision++;
        order.status = p[0];
        return [{ affectedRows: 1 }];
      }
      if (q.startsWith("INSERT INTO audit_logs")) {
        state.audits.push(p);
        return [{ affectedRows: 1 }];
      }
      if (q.startsWith("SELECT x.*,d.deliveryNumber")) return result([]);
      throw Error("Unhandled SQL: " + q);
    },
    update: () => ({
      set: (value: any) => ({
        where: async (condition: any) => {
          const qty = Number(dialect.sqlToQuery(value.quantity).params[0]),
            id = dialect.sqlToQuery(condition).params[0];
          const stock = state.inventories.find((i: any) => i.id === id);
          if (stock.quantity < qty) return [{ affectedRows: 0 }];
          stock.quantity -= qty;
          return [{ affectedRows: 1 }];
        },
      }),
    }),
    insert: (table: any) => ({
      values: async (value: any) => {
        const name = getTableName(table),
          list =
            name === "inventory_transactions"
              ? state.movements
              : name === "inventory_issue_cost_allocations"
                ? state.allocations
                : state.contexts;
        list.push(...(Array.isArray(value) ? value : [value]));
        return [{ insertId: list.length }];
      },
    }),
  };
  const db = {
    execute: tx.execute,
    transaction: (work: any) => {
      const next = queue.then(async () => {
        const before = structuredClone(state);
        try {
          return await work(tx);
        } catch (e) {
          state = before;
          throw e;
        }
      });
      queue = next.catch(() => {});
      return next;
    },
  };
  const actualIssue = vm.runInNewContext(physicalCode, {
    ...schema,
    sql,
    and,
    eq,
    gte,
    notInArray,
    captureDocumentSignature,
    normalizeInventoryQuantity,
    calculateMovementTotal,
    roundTo,
    getDb: async () => db,
    isInventoryLotsEnabled: () => true,
    materialExecutionCostsEnabled: () => true,
    assertOperationalIssueReference,
    recordOperationalDelivery,
    getUserById: async (id: number) =>
      state.users.find((u: any) => u.id === id),
    getInventoryItemById: async (id: number) =>
      state.inventories.find((i: any) => i.id === id),
    consumeInventoryLotForIssue: async (input: any) => {
      const lot = state.lots.find(
        (l: any) =>
          l.trackingToken === input.trackingToken &&
          l.inventoryId === input.inventoryId
      );
      if (!lot || lot.quantity < input.quantity)
        throw Error("lot insufficient");
      lot.quantity -= input.quantity;
      lot.remainingQuantity -= input.quantity;
      return { ...lot, issueUnitCost: lot.issueUnitCost };
    },
    normalizeIssueCostAllocations: async (input: any) =>
      input.allocations.map((a: any) => ({ ...a, beneficiaryAssetId: null })),
    getNextDeliveryNumber: async () => `DLV-${state.documents.length + 1}`,
    createDeliveryDocument: async (value: any) => {
      if (flags.failDocument === state.documents.length + 1)
        throw Error("document failed");
      const id = state.documents.length + 1;
      state.documents.push({ id, ...value });
      return { insertId: id };
    },
  });
  const ports = {
    database: vi.fn(async () => db),
    issue: vi.fn((tx: any, input: any) => actualIssue(input, tx)),
    returnDelivery: vi.fn(),
    resolveLot: vi.fn(),
  };
  const caller = (actor: any = warehouse) =>
    router({
      operationalIssues: createOperationalIssuesRouter(ports, () => true),
    }).createCaller({ user: actor, req: {}, res: {} } as any);
  return {
    state: () => state,
    flags,
    queries,
    ports,
    tx,
    caller,
    async ready(actor = warehouse) {
      await createPrepared(ports, actor, makeInput());
      state.orders[0].status = "approved";
      state.orders[0].revision = 1;
    },
  };
}
beforeEach(() => vi.stubEnv("OPERATIONAL_ISSUES_ENABLED", "true"));
afterEach(() => vi.unstubAllEnvs());
describe("Prepared operational issues through the canonical physical writer", () => {
  it("issues legacy operational lines through the same full multi-lot writer and retries without duplicate stock changes",async()=>{
    const f=fixture();await f.ready();f.state().items.forEach((line:any)=>{line.dispatchContext=null;});const service=new OperationalIssueService(f.ports);
    const input={orderId:1,itemId:1,warehouseId:1,quantity:3,operationKey:"legacy-full",selection:{mode:"manual" as const,lots:[{lotId:11,quantity:1},{lotId:12,quantity:2}]}};
    const result=await service.issue(warehouse,input);await service.issue(warehouse,input);
    expect(result.documents).toHaveLength(2);expect(f.state().documents).toHaveLength(2);expect(f.state().lots.map((l:any)=>l.quantity)).toEqual([1,6,10]);
    await expect(service.issue(warehouse,{...input,selection:{mode:"manual",lots:[{lotId:12,quantity:3}]}})).rejects.toMatchObject({code:"CONFLICT"});
  });
  it("rolls back a legacy multi-lot choice when the second physical document fails",async()=>{
    const f=fixture();await f.ready();f.state().items.forEach((line:any)=>{line.dispatchContext=null;});f.flags.failDocument=2;
    await expect(new OperationalIssueService(f.ports).issue(warehouse,{orderId:1,itemId:1,warehouseId:1,quantity:3,operationKey:"legacy-failure",selection:{mode:"manual",lots:[{lotId:11,quantity:1},{lotId:12,quantity:2}]}})).rejects.toThrow("failed");
    expect(f.state().documents).toEqual([]);expect(f.state().lots.map((l:any)=>l.quantity)).toEqual([2,8,10]);
  });
  it("manually selects a later lot for one line and confirms all lines in one batch",async()=>{
    const f=fixture();await f.ready();const input:any=issueInput();input.items[0].selection={mode:"manual",lots:[{lotId:12,quantity:3}]};
    await issuePrepared(f.ports,warehouse,input);
    expect(f.state().documents.map((d:any)=>[d.lotId,d.quantity])).toEqual([[12,3],[13,2]]);
    expect(f.state().lots.map((l:any)=>l.quantity)).toEqual([2,5,8]);expect(f.state().batches).toHaveLength(1);expect(f.state().orders[0].status).toBe("completed");
  });
  it.each(["partial","foreign","excess","duplicate"])("blocks %s manual selections for the entire order without stock changes",async kind=>{
    const f=fixture();await f.ready();const input:any=issueInput();
    input.items[0].selection={mode:"manual",lots:kind==="partial"?[{lotId:11,quantity:2}]:kind==="foreign"?[{lotId:13,quantity:3}]:kind==="excess"?[{lotId:11,quantity:3}]:[{lotId:12,quantity:1},{lotId:12,quantity:2}]};
    await expect(issuePrepared(f.ports,warehouse,input)).rejects.toThrow();expect(f.state().documents).toEqual([]);expect(f.state().batches).toEqual([]);expect(f.state().lots.map((l:any)=>l.quantity)).toEqual([2,8,10]);
  });
  it("rolls back every manually selected lot when a later document fails",async()=>{
    const f=fixture();await f.ready();const input:any=issueInput();input.items[0].selection={mode:"manual",lots:[{lotId:11,quantity:1},{lotId:12,quantity:2}]};f.flags.failDocument=3;
    await expect(issuePrepared(f.ports,warehouse,input)).rejects.toThrow("failed");expect(f.state().documents).toEqual([]);expect(f.state().batches).toEqual([]);expect(f.state().lots.map((l:any)=>l.quantity)).toEqual([2,8,10]);
  });
  it("saves per-line context without stock deduction and prevents duplicate saves", async () => {
    const f = fixture();
    await createPrepared(f.ports, warehouse, makeInput());
    await createPrepared(f.ports, warehouse, makeInput());
    expect(f.state().orders).toHaveLength(1);
    expect(f.state().documents).toHaveLength(0);
    expect(f.state().inventories.map((s: any) => s.quantity)).toEqual([10, 10]);
    expect(JSON.parse(f.state().items[1].dispatchContext)).toMatchObject({
      siteId: 3,
      sectionId: 4,
      collectorId: 102,
    });
    await expect(
      createPrepared(f.ports, warehouse, {
        ...makeInput(),
        reason: "different",
      })
    ).rejects.toThrow("مختلف");
  });
  it("splits FIFO, freezes actual recipients/notes, charges each line context at its real lot cost", async () => {
    const f = fixture();
    await f.ready();
    await f.caller().operationalIssues.issuePrepared(issueInput());
    expect(f.state().inventories.map((s: any) => s.quantity)).toEqual([7, 8]);
    expect(
      f
        .state()
        .documents.map((d: any) => [
          d.lotId,
          d.quantity,
          d.deliveredToId,
          d.deliveredToName,
        ])
    ).toEqual([
      [11, 2, 103, "Tech 103"],
      [12, 1, 103, "Tech 103"],
      [13, 2, 102, "Tech 102"],
    ]);
    expect(f.state().documents[0].notes).toContain("كشف المستودع");
    expect(f.state().documents[0].notes).toContain("Tech 101");
    expect(
      f
        .state()
        .allocations.map((c: any) => [
          c.beneficiarySiteId,
          c.beneficiarySectionId,
          c.allocatedCostTotal,
        ])
    ).toEqual([
      [1, 2, "20.00"],
      [1, 2, "20.00"],
      [3, 4, "60.00"],
    ]);
    expect(f.state().orders[0].status).toBe("completed");
    expect(f.state().movements.every((m: any) => m.unitCost === "5.0000")).toBe(
      true
    );
  });
  it.each(["document", "ledger"])(
    "rolls everything back on later %s failure",
    async kind => {
      const f = fixture();
      await f.ready();
      if (kind === "document") f.flags.failDocument = 3;
      else f.flags.failCommit = true;
      await expect(
        issuePrepared(f.ports, warehouse, issueInput())
      ).rejects.toThrow("failed");
      expect(f.state().inventories.map((s: any) => s.quantity)).toEqual([
        10, 10,
      ]);
      expect(f.state().lots.map((s: any) => s.quantity)).toEqual([2, 8, 10]);
      for (const key of [
        "batches",
        "deliveries",
        "documents",
        "movements",
        "allocations",
        "contexts",
      ])
        expect(f.state()[key]).toHaveLength(0);
      expect(f.state().orders[0].status).toBe("approved");
    }
  );
  it("serializes concurrent retries and denies changed/new replay keys", async () => {
    const f = fixture();
    await f.ready();
    await Promise.all([
      issuePrepared(f.ports, warehouse, issueInput()),
      issuePrepared(f.ports, warehouse, issueInput()),
    ]);
    expect(f.state().documents).toHaveLength(3);
    await expect(
      issuePrepared(f.ports, warehouse, {
        ...issueInput(),
        operationKey: "other",
      })
    ).rejects.toThrow("مسبق");
    await expect(
      issuePrepared(f.ports, warehouse, {
        ...issueInput(),
        items: issueInput().items.map(i => ({ ...i, notes: "changed" })),
      })
    ).rejects.toThrow("مسبق");
  });
  it.each([
    "shortage",
    "frozen",
    "inactive warehouse",
    "wrong unit",
    "missing lot",
    "stale revision",
    "missing line",
    "foreign line",
    "inactive recipient",
    "role changed",
  ])("rejects %s without any deduction", async kind => {
    const f = fixture();
    await f.ready();
    const input = issueInput();
    if (kind === "shortage") {
      f.state().inventories[1].quantity = 1;
      f.state().lots[2].quantity = 1;
    }
    if (kind === "frozen") f.state().inventories[0].isFrozen = 1;
    if (kind === "inactive warehouse") f.flags.warehouseActive = false;
    if (kind === "wrong unit") f.state().lots[0].issueUnit = "كرتون";
    if (kind === "missing lot") f.state().lots.shift();
    if (kind === "stale revision") input.revision = 0;
    if (kind === "missing line") input.items.pop();
    if (kind === "foreign line") input.items[0].itemId = 999;
    if (kind === "inactive recipient")
      f.state().users.find((u: any) => u.id === 103).isActive = 0;
    if (kind === "role changed") f.state().users[0].role = "technician";
    await expect(issuePrepared(f.ports, warehouse, input)).rejects.toThrow();
    expect(f.ports.issue).not.toHaveBeenCalled();
    expect(f.state().batches).toHaveLength(0);
  });
  it("does not bypass prepared dispatch through the single-line writer", async () => {
    const f = fixture();
    await f.ready();
    await expect(
      assertOperationalIssueReference(f.tx, {
        operationalIssueItemId: 1,
        performedById: 20,
        deliveredToId: 101,
        catalogItemId: 5,
        quantity: 1,
        operationKey: "direct",
      })
    ).rejects.toThrow("بالكامل");
  });
  it("requires fresh active permission even on completed retries", async () => {
    const f = fixture();
    await f.ready();
    await issuePrepared(f.ports, warehouse, issueInput());
    f.state().users[0].isActive = 0;
    await expect(
      issuePrepared(f.ports, warehouse, issueInput())
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("denies a missing order before reading line stock", async () => {
    const f = fixture();
    await expect(
      issuePrepared(f.ports, warehouse, issueInput())
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(f.ports.issue).not.toHaveBeenCalled();
  });
});
describe("Creation/source/central capability and bounded reads", () => {
  it.each([
    "warehouse",
    "it_manager",
    "maintenance_manager",
    "general_maintenance_manager",
    "construction_procurement_manager",
    "owner",
    "admin",
  ])("permits inventory creation to %s", async role => {
    const f = fixture();
    const actor = { ...warehouse, role };
    f.state().users[0].role = role;
    await expect(
      f.caller(actor).operationalIssues.createPrepared(makeInput())
    ).resolves.toHaveProperty("id");
  });
  it.each([
    "technician",
    "it_member",
    "accountant",
    "delegate",
    "observer",
    "senior_management",
    "executive_director",
    "food_warehouse",
  ])("denies new stock/create/issue RPCs to %s", async role => {
    const f = fixture();
    const api = f.caller({ ...warehouse, role }).operationalIssues;
    await expect(api.createPrepared(makeInput())).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(api.issuePrepared(issueInput())).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(api.stockChoices({ warehouseId: 1 })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(f.ports.database).not.toHaveBeenCalled();
  });
  it.each(["warehouse", "it_manager"])(
    "blocks catalog bypass by %s",
    async role => {
      const f = fixture(),
        actor = { ...warehouse, role };
      f.state().users[0].role = role;
      const input = makeInput();
      input.items[0].source = "catalog" as any;
      await expect(
        f.caller(actor).operationalIssues.createPrepared(input)
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(f.state().orders).toHaveLength(0);
    }
  );
  it.each(["owner", "admin"])(
    "allows %s to request catalog items without stock",
    async role => {
      const f = fixture(),
        actor = { ...warehouse, role };
      f.state().users[0].role = role;
      f.state().inventories = [];
      f.state().lots = [];
      const input = makeInput();
      input.items.forEach(i => (i.source = "catalog" as any));
      await expect(
        f.caller(actor).operationalIssues.createPrepared(input)
      ).resolves.toHaveProperty("id");
    }
  );
  it("denies mismatched section and inactive planned technician", async () => {
    const f = fixture(),
      input = makeInput();
    input.items[1].siteId = 1;
    await expect(createPrepared(f.ports, warehouse, input)).rejects.toThrow(
      "القسم"
    );
    input.items[1].siteId = 3;
    f.state().users.find((u: any) => u.id === 102).isActive = 0;
    await expect(createPrepared(f.ports, warehouse, input)).rejects.toThrow(
      "الفني"
    );
  });
  it("enforces the 20-line bound and schema setup", async () => {
    const f = fixture(),
      input = makeInput();
    await expect(
      f
        .caller()
        .operationalIssues.createPrepared({
          ...input,
          items: Array(21).fill(input.items[0]),
        })
    ).rejects.toThrow();
    f.flags.ready = false;
    await expect(
      createPrepared(f.ports, warehouse, input)
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(f.state().orders).toHaveLength(0);
  });
  it("paginates before enrichment with three queries, then makes an independent fresh read", async () => {
    const f = fixture();
    const value = await preparedStockChoices(f.ports, warehouse, {
      warehouseId: 1,
      search: "",
      afterId: 0,
    });
    expect(value.items).toHaveLength(50);
    expect(value.next).toBe(50);
    expect(f.queries).toHaveLength(3);
    expect(f.queries[0].q).toContain("LIMIT 51");
    expect(f.queries[1].p).toHaveLength(51);
    f.queries.length = 0;
    await preparedStockChoices(f.ports, warehouse, {
      warehouseId: 1,
      search: "changed",
      afterId: 50,
    });
    expect(f.queries).toHaveLength(3);
    expect(f.queries[0].p).toContain("%changed%");
  });
  it("batches repeated IDs and twenty selected lines in constant queries", async () => {
    const f = fixture();
    await preparedSelection(f.ports, warehouse, 1, Array(20).fill(5));
    expect(f.queries).toHaveLength(3);
    expect(f.queries[0].p).toEqual([1, 5]);
    f.queries.length = 0;
    await preparedSelection(
      f.ports,
      warehouse,
      1,
      Array.from({ length: 20 }, (_, i) => i + 1)
    );
    expect(f.queries).toHaveLength(3);
  });
  it("preserves creator-only read scope across requests", async () => {
    const f = fixture();
    await f.ready();
    const service = new OperationalIssueService(f.ports);
    await expect(
      service.detail({ id: 10, role: "it_manager", isActive: 1 }, 1)
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(service.detail(warehouse, 1)).resolves.toHaveProperty(
      "order.id",
      1
    );
    await expect(service.detail(warehouse, 99)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
  it("FIFO uses oldest date across inventory rows and rejects fractional DLV splits", () => {
    const stock: any = {
      totalQuantity: 3,
      needsReview: false,
      lots: [
        { lotId: 10, inventoryId: 1, quantity: 2, receivedAt: "2026-02-01" },
        { lotId: 20, inventoryId: 2, quantity: 1, receivedAt: "2026-01-01" },
      ],
    };
    expect(
      allocateOperationalFifo(stock, 2).map(l => [l.lotId, l.quantity])
    ).toEqual([
      [20, 1],
      [10, 1],
    ]);
    stock.lots[1].quantity = 0.5;
    expect(() => allocateOperationalFifo(stock, 2)).toThrow("كسري");
  });
});

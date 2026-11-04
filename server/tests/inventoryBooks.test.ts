import { describe, it, expect, vi } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { planBookFifo } from "../../shared/inventory-book";
import {
  readInventoryBooks,
  readInventoryBookPages,
  createInventoryBookProcedures,
} from "../routers/inventory/books.procedure";
import {
  loadCatalogBookTotals,
  canShowCatalogBook,
} from "../services/inventory-book-summary";
import { issueInventoryBook } from "../services/inventory-book-issue";
import { router } from "../routers/_shared/procedures";
import { activeBookStockUnit } from "../_core/inventory-book-policy";
import { createBookIssueProcedure } from "../routers/inventory/book-issue.procedure";
import { businessRpcAllowed } from "../../shared/business-role-policy";
vi.mock("../_core/authz/media-access", () => ({
  assertMediaMutationAccess: vi.fn(),
}));
const dialect = new MySqlDialect();
const sqlQuery = (query: any) => dialect.sqlToQuery(query);
const lot = (id: number, quantity: number, date: string, extra: any = {}) => ({
  lotId: id,
  inventoryId: id + 100,
  trackingToken: `token-${id}`,
  issueUnit: "حبة",
  inventoryUnit: "حبة",
  createdAt: date,
  balanceQuantity: quantity,
  isFrozen: 0,
  ...extra,
});
describe("book FIFO preserves physical lot identity", () => {
  it("allocates oldest first across pages, retaining quantities and costs", () => {
    const result = planBookFifo(
      [
        lot(2, 8, "2026-09-03", { issueUnitCost: 12 }),
        lot(1, 5, "2026-08-29", { issueUnitCost: 10 }),
      ],
      7,
      "حبة"
    );
    expect(
      result.map(row => [row.inventoryId, row.lotId, row.quantity])
    ).toEqual([
      [101, 1, 5],
      [102, 2, 2],
    ]);
    expect(
      result.reduce((sum, row) => sum + row.quantity * row.issueUnitCost, 0)
    ).toBe(74);
  });
  it("does not use frozen pages or a different unit and subtracts reserved cart quantities", () => {
    const result = planBookFifo(
      [
        lot(1, 100, "2026-01-01", { issueUnit: "كجم" }),
        lot(2, 100, "2026-02-01", { isFrozen: 1 }),
        lot(3, 5, "2026-03-01"),
        lot(4, 9, "2026-04-01"),
      ],
      7,
      "حبة",
      { "103:3": 3 }
    );
    expect(result.map(row => [row.lotId, row.quantity])).toEqual([
      [3, 2],
      [4, 5],
    ]);
  });
  it.each([0, -1, NaN, Infinity, 0.0001])(
    "rejects invalid quantity %s",
    quantity =>
      expect(() =>
        planBookFifo([lot(1, 5, "2026-01-01")], quantity, "حبة")
      ).toThrow()
  );
  it("rejects shortages without producing a partial plan", () =>
    expect(() => planBookFifo([lot(1, 5, "2026-01-01")], 6, "حبة")).toThrow(
      "لا يكفي"
    ));
  it("allocates three decimal quantities without rounding away a shortage", () => {
    expect(
      planBookFifo(
        [lot(1, 0.125, "2026-01-01"), lot(2, 1, "2026-02-01")],
        1.125,
        "حبة"
      ).map(row => row.quantity)
    ).toEqual([0.125, 1]);
  });
});
function readPort(data: any[][]) {
  const calls: ReturnType<typeof sqlQuery>[] = [];
  return {
    calls,
    execute: vi.fn(async (query: any) => {
      calls.push(sqlQuery(query));
      return [data[calls.length - 1] || []];
    }),
  };
}
describe("book reads are scoped and page before enrichment", () => {
  it.each([1, 36, 50])(
    "uses two reads for %s distinct books, never one read per displayed record",
    async size => {
      const db = readPort([
        Array.from({ length: size }, (_, id) => ({
          id: id + 1,
          nameAr: "دجاج",
          pageCount: 5,
        })),
        [
          {
            catalogItemId: 1,
            unit: "كجم",
            isFrozen: 1,
            quantity: 0,
            incoming: 50,
            outgoing: 50,
          },
          {
            catalogItemId: 1,
            unit: "حبة",
            isFrozen: 0,
            quantity: 0,
            incoming: 50,
            outgoing: 50,
          },
        ],
      ]);
      const result = await readInventoryBooks(db, {
        warehouseId: 1,
        limit: size,
        includeZero: true,
        search: "اسم المورد",
      });
      expect(db.calls).toHaveLength(2);
      expect(result.books).toHaveLength(size);
      expect(result.books[0].totals).toHaveLength(2);
      expect(db.calls[0].sql).toContain("LIMIT ? OFFSET ?");
      expect(db.calls[0].sql).toContain("aliases.resolvedCatalogItemId=c.id");
      expect(db.calls[0].params).toContain("%اسم المورد%");
      expect(db.calls[1].params.length).toBeLessThanOrEqual(3 * size + 5);
    }
  );
  it("does not enrich an empty page, and keeps search values parameterized", async () => {
    const db = readPort([[]]);
    expect(
      (await readInventoryBooks(db, { search: "%' OR 1=1 --", nodeIds: [] }))
        .books
    ).toEqual([]);
    expect(db.calls).toHaveLength(1);
    expect(db.calls[0].sql).not.toContain("OR 1=1 --");
    expect(db.calls[0].sql).toContain("1=0");
  });
  it("denies a missing master before reading pages or lots", async () => {
    const db = readPort([[]]);
    await expect(
      readInventoryBookPages(db, { catalogItemId: 999 })
    ).rejects.toThrow("غير موجود");
    expect(db.calls).toHaveLength(1);
  });
  it("loads histories without moving or dropping frozen/empty pages or mixing units", async () => {
    const db = readPort([
      [{ id: 1140206, nameAr: "دجاج" }],
      [
        { id: 210338, unit: "كجم", isFrozen: 1, quantity: 0 },
        { id: 210590, unit: "حبة", isFrozen: 0, quantity: 0 },
      ],
      [
        {
          inventoryId: 210338,
          lotId: 34,
          issueUnit: "كجم",
          balanceQuantity: 0,
        },
        {
          inventoryId: 210590,
          lotId: 297,
          issueUnit: "حبة",
          balanceQuantity: 0,
        },
      ],
      [
        { inventoryId: 210338, incoming: 50, outgoing: 50 },
        { inventoryId: 210590, incoming: 50, outgoing: 50 },
      ],
    ]);
    const result = await readInventoryBookPages(db, {
      catalogItemId: 1140206,
      warehouseId: 1,
    });
    expect(db.calls).toHaveLength(4);
    expect(
      result.pages.map(page => [page.id, page.unit, page.lots[0].lotId])
    ).toEqual([
      [210338, "كجم", 34],
      [210590, "حبة", 297],
    ]);
    expect(
      db.calls.every(call => !/^\s*(UPDATE|DELETE|INSERT)/i.test(call.sql))
    ).toBe(true);
    expect(db.calls[1].params).toContain(1140206);
    expect(db.calls[1].params).toContain(1);
  });
  it("does not reuse prior RPC scope and propagates infrastructure errors", async () => {
    const db = readPort([[], []]);
    await readInventoryBooks(db, { warehouseId: 1 });
    await readInventoryBooks(db, { warehouseId: 2 });
    expect(db.calls[0].params).toContain(1);
    expect(db.calls[1].params).toContain(2);
    const failure = Error("offline");
    await expect(
      readInventoryBooks(
        {
          execute: async () => {
            throw failure;
          },
        },
        {}
      )
    ).rejects.toBe(failure);
  });
  it("batch-enriches repeated parent IDs in chunks of 500 and reads fresh on the next call", async () => {
    const db = readPort([[], [], [], []]);
    const ids = Array.from({ length: 1001 }, (_, i) => i + 1).flatMap(id => [
      id,
      id,
    ]);
    await loadCatalogBookTotals(db, ids);
    expect(db.calls).toHaveLength(3);
    expect(db.calls.map(call => call.params.length)).toEqual([1000, 1000, 2]);
    await loadCatalogBookTotals(db, [1]);
    expect(db.calls).toHaveLength(4);
  });
  it("only reuses nonfrozen stock pages with an exact or registered alias unit", () => {
    const query = sqlQuery(activeBookStockUnit("حبة")!);
    expect(query.sql).toContain("isFrozen");
    expect(query.params).toContain(0);
    expect(query.sql).toContain("catalog_units");
    expect(query.params).toContain("حبة");
  });
});
describe("direct book RPC grants preserve existing roles", () => {
  it.each(["owner", "admin", "warehouse", "senior_management", "observer"])(
    "allows %s read only",
    async role => {
      const db = readPort([[]]);
      const api = router({
        inventory: router(
          createInventoryBookProcedures(
            async () => db,
            () => true
          )
        ),
      });
      await expect(
        api
          .createCaller({ user: { id: 1, role, isActive: 1 } } as any)
          .inventory.books({ warehouseId: 1 })
      ).resolves.toEqual({ books: [], nextId: null });
      expect(db.calls).toHaveLength(1);
    }
  );
  it.each([
    "accountant",
    "executive_director",
    "food_warehouse_assistant",
    "technician",
    "construction_procurement_manager",
    "general_maintenance_manager",
  ])("denies %s before loading book data", async role => {
    const get = vi.fn(async () => readPort([[]]));
    const api = router({
      inventory: router(createInventoryBookProcedures(get, () => true)),
    });
    await expect(
      api
        .createCaller({ user: { id: 1, role, isActive: 1 } } as any)
        .inventory.bookPages({ catalogItemId: 1, warehouseId: 1 })
    ).rejects.toThrow();
    expect(get).not.toHaveBeenCalled();
  });
  it("does not embed new stock history into catalog reads for unrelated or inactive roles", () => {
    expect(canShowCatalogBook({ role: "warehouse", isActive: 1 })).toBe(true);
    for (const role of ["warehouse", "owner", "admin"])
      expect(canShowCatalogBook({ role, isActive: 0 })).toBe(false);
    for (const role of [
      "construction_procurement_manager",
      "general_maintenance_manager",
      "accountant",
      "food_warehouse_assistant",
      "technician",
    ])
      expect(canShowCatalogBook({ role, isActive: 1 })).toBe(false);
  });
});
function issuePort(specificationById: Record<number, "pending" | "approved" | "rejected" | null> = {}) {
  const actor = { id: 5, role: "admin", isActive: 1 };
  let stored: any = null,
    writes: any[] = [];
  const calls: any[] = [];
  const database = {
    transaction: async (work: any) => {
      const beforeStored = stored,
        beforeWrites = [...writes];
      const tx = {
        execute: async (query: any) => {
          const parsed = sqlQuery(query);
          calls.push(parsed);
          if (parsed.sql.includes("FROM users")) return [[{ ...actor }]];
          if (parsed.sql.includes("FROM warehouses"))
            return [[{ id: 1, isActive: 1 }]];
          if (parsed.sql.includes("FROM catalog_items")) return [[{ id: 1 }]];
          if (parsed.sql.includes("SELECT newValues"))
            return [stored ? [{ newValues: stored }] : []];
          if (parsed.sql.includes("SELECT id FROM inventory"))
            return [[{ id: 101 }, { id: 102 }]];
          if (parsed.sql.startsWith("SELECT id,specificationStatus FROM inventory_lots"))
            return [parsed.params.map(id => ({ id, specificationStatus: specificationById[Number(id)] ?? null }))];
          if (parsed.sql.includes("JOIN inventory_lot_balances"))
            return [
              [
                lot(2, 8, "2026-09-03", { issueUnitCost: 12 }),
                lot(1, 5, "2026-08-29", { issueUnitCost: 10 }),
              ],
            ];
          if (parsed.sql.includes("INSERT INTO audit_logs")) {
            stored = parsed.params[2];
            return [[]];
          }
          if (parsed.sql.includes("UPDATE audit_logs")) {
            stored = JSON.stringify({
              ...JSON.parse(stored),
              effectsComplete: 1,
            });
            return [[]];
          }
          return [[]];
        },
      };
      try {
        return await work(tx);
      } catch (error) {
        stored = beforeStored;
        writes = beforeWrites;
        throw error;
      }
    },
  };
  return {
    database,
    actor,
    calls,
    writes: () => writes,
    add: (row: any) => writes.push(row),
  };
}
const issueInput = () => ({
  catalogItemId: 1,
  warehouseId: 1,
  deliveredToId: 7,
  deliveryQty: 7,
  deliveryUnit: "حبة",
  operationKey: "11111111-1111-4111-8111-111111111111",
  costAllocations: [
    { quantity: 7, beneficiarySiteId: 1, beneficiarySectionId: 2 },
  ],
});
describe("book delivery orchestration", () => {
  it("rejects direct FIFO requests when lot tracking is disabled before reading stock", async () => {
    const get = vi.fn();
    const api = router({
      purchaseOrders: router({
        deliverInventoryBook: createBookIssueProcedure(
          get,
          vi.fn(),
          undefined,
          () => false
        ),
      }),
    });
    await expect(
      api
        .createCaller({
          user: { id: 5, role: "admin", isActive: 1 },
        } as any)
        .purchaseOrders.deliverInventoryBook(issueInput())
    ).rejects.toThrow("تفعيل");
    expect(get).not.toHaveBeenCalled();
  });
  it.each(["owner", "admin"])(
    "allows %s through the actual book mutation while preserving actual identity",
    async role => {
      const port = issuePort();
      port.actor.role = role;
      const write = vi.fn(
        async (
          _line: any,
          _ctx: any,
          _tx: any,
          _callbacks: any[],
          _marked: Set<number>
        ) => ({ allocatedCostTotal: 0 })
      );
      const get = vi.fn(async () => port.database);
      const api = router({
        purchaseOrders: router({
          deliverInventoryBook: createBookIssueProcedure(
            get,
            write,
            undefined,
            () => true
          ),
        }),
      });
      await api
        .createCaller({ user: { id: 5, role, isActive: 1 } } as any)
        .purchaseOrders.deliverInventoryBook(issueInput());
      expect(get).toHaveBeenCalledTimes(1);
      expect(write).toHaveBeenCalledTimes(2);
      expect(write.mock.calls[0][1].user).toMatchObject({ id: 5, role });
    }
  );
  it.each([
    "warehouse",
    "senior_management",
    "executive_director",
    "accountant",
    "food_warehouse_assistant",
    "technician",
    "observer",
    "construction_procurement_manager",
    "general_maintenance_manager",
  ])("denies %s direct book writes before loading stock", async role => {
    const get = vi.fn();
    const api = router({
      purchaseOrders: router({
        deliverInventoryBook: createBookIssueProcedure(get, vi.fn()),
      }),
    });
    await expect(
      api
        .createCaller({ user: { id: 5, role, isActive: 1 } } as any)
        .purchaseOrders.deliverInventoryBook(issueInput())
    ).rejects.toThrow();
    expect(get).not.toHaveBeenCalled();
  });
  it.each(["owner", "admin", "warehouse"])(
    "rechecks active status for %s at the operation boundary",
    async role => {
      const get = vi.fn();
      const api = router({
        purchaseOrders: router({
          deliverInventoryBook: createBookIssueProcedure(get, vi.fn()),
        }),
      });
      await expect(
        api
          .createCaller({ user: { id: 5, role, isActive: 0 } } as any)
          .purchaseOrders.deliverInventoryBook(issueInput())
      ).rejects.toThrow();
      expect(get).not.toHaveBeenCalled();
    }
  );
  it("rechecks current role/activity even before a saved retry and allows independent requests after denial", async () => {
    const port = issuePort(), write = vi.fn(async () => ({}));
    const api = router({ purchaseOrders: router({ deliverInventoryBook: createBookIssueProcedure(async()=>port.database,write,undefined,()=>true) }) });
    const call = () => api.createCaller({user:{id:5,role:"admin",isActive:1}} as any).purchaseOrders.deliverInventoryBook(issueInput());
    port.actor.role="warehouse"; await expect(call()).rejects.toMatchObject({code:"FORBIDDEN"}); expect(write).not.toHaveBeenCalled();
    port.actor.role="admin"; await call(); expect(write).toHaveBeenCalledTimes(2);
    port.actor.isActive=0; await expect(call()).rejects.toMatchObject({code:"FORBIDDEN"}); expect(write).toHaveBeenCalledTimes(2);
    port.actor.isActive=1; await call(); expect(write).toHaveBeenCalledTimes(2);
    expect(port.calls.filter(call=>call.sql.includes("FROM users"))).toHaveLength(4);
  });
  it("preserves warehouse capabilities for the existing single-lot and request-tab issue endpoints",()=>{
    const warehouse={id:5,role:"warehouse",isActive:1};
    expect(businessRpcAllowed(warehouse,"mutation","purchaseOrders.deliverInventoryBook")).toBe(false);
    for(const path of ["purchaseOrders.deliverInventoryItem","ticketTeamExecution.issue","pmv2.warehouse.issueReadyRequirement","operationalIssues.issuePrepared"])
      expect(businessRpcAllowed(warehouse,"mutation",path)).toBe(true);
  });
  it("passes each physical allocation and the same transaction to the original writer and replays without double issue", async () => {
    const port = issuePort();
    const write = vi.fn(async (line: any, tx: any, callbacks: any[]) => {
      expect(tx.execute).toBeTypeOf("function");
      port.add(line);
      callbacks.push(async () => {});
      return {
        allocatedCostTotal:
          line.deliveryQty * (line.inventoryId === 101 ? 10 : 12),
      };
    });
    const result = await issueInventoryBook(
      port.database,
      issueInput(),
      5,
      write
    );
    expect(result.allocatedCostTotal).toBe(74);
    expect(
      port
        .writes()
        .map(line => [
          line.inventoryId,
          line.deliveryQty,
          line.costAllocations[0].quantity,
        ])
    ).toEqual([
      [101, 5, 5],
      [102, 2, 2],
    ]);
    await issueInventoryBook(port.database, issueInput(), 5, write);
    expect(write).toHaveBeenCalledTimes(2);
    await expect(
      issueInventoryBook(
        port.database,
        {
          ...issueInput(),
          deliveryQty: 8,
          costAllocations: [
            { ...issueInput().costAllocations[0], quantity: 8 },
          ],
        },
        5,
        write
      )
    ).rejects.toThrow("مختلف");
    expect(
      port.calls.filter(call => call.sql.includes("FOR UPDATE")).length
    ).toBeGreaterThan(2);
  });
  it("skips an older held construction receipt while allowing approved older stock in the same book", async () => {
    const port = issuePort({ 1: "pending", 2: "approved" });
    const write = vi.fn(async (line: any) => { port.add(line); return {}; });
    await issueInventoryBook(port.database, issueInput(), 5, write);
    expect(port.writes().map(line => [line.inventoryId, line.deliveryQty])).toEqual([[102, 7]]);
  });
  it("rolls back all earlier lines and never fires post-commit work when a later lot becomes unavailable", async () => {
    const port = issuePort();
    const finish = vi.fn();
    const write = vi.fn(async (line: any, tx: any, callbacks: any[]) => {
      if (line.inventoryId === 102) throw Error("lot frozen at execution");
      port.add(line);
      callbacks.push(finish);
      return {};
    });
    await expect(
      issueInventoryBook(port.database, issueInput(), 5, write)
    ).rejects.toThrow("frozen");
    expect(port.writes()).toEqual([]);
    expect(finish).not.toHaveBeenCalled();
  });
  it("resumes failed post-commit workflow synchronization without issuing the physical quantities again", async () => {
    const port = issuePort();
    const write = vi.fn(async (line: any, _tx: any, callbacks: any[]) => {
      port.add(line);
      callbacks.push(
        Object.assign(
          async () => {
            throw Error("sync temporarily unavailable");
          },
          { resumeData: { inventoryId: line.inventoryId } }
        )
      );
      return { allocatedCostTotal: 0 };
    });
    await expect(
      issueInventoryBook(port.database, issueInput(), 5, write)
    ).rejects.toThrow("sync temporarily");
    expect(port.writes()).toHaveLength(2);
    const resume = vi.fn(async () => {});
    await issueInventoryBook(port.database, issueInput(), 5, write, resume);
    expect(resume).toHaveBeenCalledTimes(2);
    expect(write).toHaveBeenCalledTimes(2);
    await issueInventoryBook(port.database, issueInput(), 5, write, resume);
    expect(resume).toHaveBeenCalledTimes(2);
    expect(port.writes()).toHaveLength(2);
  });
});

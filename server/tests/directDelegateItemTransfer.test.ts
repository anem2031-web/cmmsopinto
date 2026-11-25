import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { z } from "zod";
import { and, eq, isNull, sql } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { TRPCError } from "@trpc/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  purchaseOrderItems,
  purchaseOrderItemHistory,
  auditLogs,
} from "../../drizzle/schema";
import {
  router,
  protectedProcedure,
  delegateProcedure,
} from "../routers/_shared/procedures";
import { isDelegateRole } from "../../shared/roles";
import {
  canDirectlyReassignOwnItem,
  readDelegateAssignmentSources,
  delegateAssignmentOptions,
} from "../services/delegate-manager-assignment";
import { purchaseSpecificationsDatabase } from "./fixtures/purchaseSpecificationsDatabase";

const actor = {
  id: 11,
  role: "delegate",
  isActive: 1,
  name: "Untrusted display",
};
const dialect = new MySqlDialect();
let f: ReturnType<typeof purchaseSpecificationsDatabase>;
const notify = vi.fn();
const item = (id = 1) =>
  f.memory
    .prepare("SELECT * FROM purchase_order_items WHERE id=?")
    .get(id) as any;
function expression(
  name: string,
  kind: "property" | "function",
  file = "server/routers/purchase/purchase-orders.router.ts"
) {
  const ast = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true
  );
  let text = "";
  const visit = (node: ts.Node) => {
    if (
      kind === "property" &&
      ts.isPropertyAssignment(node) &&
      node.name.getText(ast) === name
    )
      text = node.initializer.getText(ast);
    if (
      kind === "function" &&
      ts.isFunctionDeclaration(node) &&
      node.name?.text === name
    )
      text = node.getText(ast).replace(/^export\s+/, "");
    ts.forEachChild(node, visit);
  };
  visit(ast);
  if (!text) throw Error("Missing " + name);
  return ts.transpileModule("(" + text + ")", {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
}
function transferWriter() {
  const scope: any = {
    purchaseOrderItems,
    purchaseOrderItemHistory,
    auditLogs,
    and,
    eq,
    isNull,
    sql,
    isDelegateRole,
    TRPCError,
    getDb: async () => f.db,
    readDelegateAssignmentSources,
    canDirectlyReassignOwnItem,
  };
  scope.createPOItemHistoryEvent = vm.runInNewContext(
    expression(
      "createPOItemHistoryEvent",
      "function",
      "server/_core/db/purchase.ts"
    ),
    scope
  );
  return vm.runInNewContext(
    expression(
      "requestPOItemDelegateChangeAtomic",
      "function",
      "server/_core/db/purchase.ts"
    ),
    scope
  );
}
function pricingWriter() {
  return vm.runInNewContext(
    expression(
      "updatePOItemIfDelegateChangeUnlocked",
      "function",
      "server/_core/db/purchase.ts"
    ),
    {
      purchaseOrderItems,
      and,
      eq,
      isNull,
      getDb: async () => f.db,
      pricingBundlesEnabled: () => false,
      readPOItemHistorySnapshot: async () => item(),
      recordPOItemMutationHistory: vi.fn(),
    }
  );
}
function api() {
  const scope = {
    z,
    TRPCError,
    protectedProcedure,
    delegateProcedure,
    delegateAssignmentOptions,
    console: { error: () => {} },
    db: {
      getDb: async () => f.db,
      getPOItemById: async (id: number) => item(id),
      getPurchaseOrderById: async (id: number) =>
        f.memory.prepare("SELECT * FROM purchase_orders WHERE id=?").get(id),
      requestPOItemDelegateChangeAtomic: transferWriter(),
      createNotification: notify,
    },
  };
  return router({
    purchaseOrders: router({
      requestDelegateChange: vm.runInNewContext(
        expression("requestDelegateChange", "property"),
        scope
      ),
      delegateAssignmentOptions: vm.runInNewContext(
        expression("delegateAssignmentOptions", "property"),
        scope
      ),
    }),
  });
}
const caller = (user = actor, authenticatedUser = user) =>
  api().createCaller({ user, authenticatedUser, req: {}, res: {} } as any)
    .purchaseOrders;
const move = (delegateId = 22, reason = "تحويل بسبب توزيع الأعمال") => ({
  itemId: 1,
  delegateId,
  reason,
});
const history = () =>
  f.memory
    .prepare("SELECT * FROM purchase_order_item_history ORDER BY id")
    .all() as any[];
const audits = () =>
  f.memory.prepare("SELECT * FROM audit_logs ORDER BY id").all() as any[];
beforeEach(() => {
  f = purchaseSpecificationsDatabase();
  notify.mockReset().mockResolvedValue(undefined);
  f.memory.exec(`ALTER TABLE users ADD COLUMN username TEXT;
    ALTER TABLE purchase_orders ADD COLUMN reviewedById INTEGER;ALTER TABLE purchase_orders ADD COLUMN reviewedAt TEXT;
    ALTER TABLE purchase_order_items ADD COLUMN delegateId INTEGER;ALTER TABLE purchase_order_items ADD COLUMN delegateAssignedAt TEXT;
    ALTER TABLE purchase_order_items ADD COLUMN batchId INTEGER;ALTER TABLE purchase_order_items ADD COLUMN delegateChangeRequestedAt TEXT;
    ALTER TABLE purchase_order_items ADD COLUMN delegateChangeReason TEXT;ALTER TABLE purchase_order_items ADD COLUMN delegateChangeRequestedById INTEGER;
    ALTER TABLE purchase_order_items ADD COLUMN estimatedUnitCost TEXT;ALTER TABLE purchase_order_items ADD COLUMN estimatedTotalCost TEXT;
    ALTER TABLE purchase_order_items ADD COLUMN estimatedById INTEGER;
    ALTER TABLE purchase_order_items ADD COLUMN actualUnitCost TEXT;ALTER TABLE purchase_order_items ADD COLUMN actualTotalCost TEXT;
    ALTER TABLE purchase_order_items ADD COLUMN purchasedAt TEXT;ALTER TABLE purchase_order_items ADD COLUMN purchasedById INTEGER;
    ALTER TABLE purchase_order_items ADD COLUMN requiredDate TEXT;
    CREATE TABLE tickets(id INTEGER PRIMARY KEY,maintenancePath TEXT);CREATE TABLE ticket_items(id INTEGER PRIMARY KEY,ticketId INTEGER,maintenancePath TEXT);
    CREATE TABLE external_maintenance_jobs(id INTEGER PRIMARY KEY,purchaseOrderId INTEGER);
    CREATE TABLE supplier_return_replacement_plans(id INTEGER PRIMARY KEY,purchaseOrderItemId INTEGER);
    CREATE TABLE delegate_pricing_bundle_items(id INTEGER PRIMARY KEY,purchaseOrderItemId INTEGER,removedAt TEXT);
    CREATE TABLE purchase_order_item_history(id INTEGER PRIMARY KEY,purchaseOrderItemId INTEGER,purchaseOrderId INTEGER,eventType TEXT,previousStatus TEXT,newStatus TEXT,previousDelegateId INTEGER,newDelegateId INTEGER,actorUserId INTEGER,actorName TEXT,note TEXT,metadata TEXT,createdAt TEXT);
  `);
  for (const user of [
    { ...actor, name: "Actual delegate", username: "original" },
    {
      id: 12,
      role: "delegate_manager",
      isActive: 1,
      name: "Actual manager",
      username: "manager",
    },
    {
      id: 22,
      role: "delegate",
      isActive: 1,
      name: "Recipient delegate",
      username: "target",
    },
    {
      id: 23,
      role: "delegate_manager",
      isActive: 1,
      name: "Recipient manager",
      username: "targetManager",
    },
    { id: 24, role: "delegate", isActive: 0, name: "Disabled" },
    { id: 1, role: "admin", isActive: 1, name: "Admin" },
  ])
    f.insert("users", user);
  f.insert("purchase_orders", {
    id: 100,
    poNumber: "PR-TEST",
    status: "pending_estimate",
    reviewedById: 9,
    reviewedAt: "2026-11-04 10:00:00",
    siteId: 7,
    sectionId: 8,
    packageId: 90,
  });
  for (let id = 1; id <= 2; id++)
    f.insert("purchase_order_items", {
      id,
      purchaseOrderId: 100,
      itemName: "Item " + id,
      quantity: 3,
      unit: "piece",
      status: "pending",
      reviewRole: "general_maintenance_manager",
      reviewedById: 9,
      reviewedAt: "2026-11-04 10:00:00",
      delegateId: 11,
      delegateAssignedAt: "2026-11-04 10:01:00",
      requiredDate: "2026-12-01",
      catalogItemId: 50 + id,
    });
  // The real mysql2 Drizzle driver serializes JSON columns. This inert adapter
  // performs the same JSON conversion while retaining the production writers.
  const insert = f.db.insert.bind(f.db);
  f.db.insert = (table: any) => ({
    values: (value: any) => {
      const encoded = { ...value };
      for (const key of ["metadata", "oldValues", "newValues"])
        if (encoded[key] != null && typeof encoded[key] === "object")
          encoded[key] = JSON.stringify(encoded[key]);
      return insert(table).values(encoded);
    },
  });
});
afterEach(() => f.close());

describe("Existing requestDelegateChange now transfers one own item directly", () => {
  it("writes only assignment/time and strict history/audit; no PO/review/need-date or legacy waiting state", async () => {
    const before = item(),
      untouched = item(2),
      header = f.memory.prepare("SELECT * FROM purchase_orders").all();
    await expect(caller().requestDelegateChange(move())).resolves.toEqual({
      success: true,
    });
    const { delegateId: old, delegateAssignedAt: oldAt, ...preserved } = before;
    const { delegateId: next, delegateAssignedAt: newAt, ...after } = item();
    expect(after).toEqual(preserved);
    expect(next).toBe(22);
    expect(newAt).not.toBe(oldAt);
    expect(item(2)).toEqual(untouched);
    expect(f.memory.prepare("SELECT * FROM purchase_orders").all()).toEqual(
      header
    );
    expect(history()).toHaveLength(1);
    expect(history()[0]).toMatchObject({
      eventType: "delegate_changed",
      previousStatus: "pending",
      newStatus: "pending",
      previousDelegateId: 11,
      newDelegateId: 22,
      actorUserId: 11,
      actorName: "Actual delegate",
      note: move().reason,
      createdAt: newAt,
    });
    expect(JSON.parse(history()[0].metadata)).toEqual({
      source: "delegate_item_transfer",
      previousDelegateAssignedAt: oldAt,
    });
    expect(JSON.parse(audits()[0].oldValues)).toMatchObject({
      delegateId: 11,
      delegateName: "Actual delegate",
      delegateAssignedAt: oldAt,
    });
    expect(JSON.parse(audits()[0].newValues)).toMatchObject({
      delegateId: 22,
      delegateName: "Recipient delegate",
      reason: move().reason,
      purchaseOrderId: 100,
    });
    expect(notify.mock.calls.map(([notice]) => notice.userId)).toEqual([22]);
    const locks = f.queries.filter(q => /FOR UPDATE/i.test(q.sql));
    expect(locks[0].sql).toMatch(/SELECT \* FROM purchase_orders/);
    expect(locks[1].sql).toMatch(/SELECT \* FROM purchase_order_items/);
    expect(locks[2].sql).toMatch(/FROM users[\s\S]*ORDER BY id FOR UPDATE/);
    expect(locks[2].params).toEqual([11, 22]);
    expect(locks.at(-1)!.sql).toMatch(/SELECT i\.\*[\s\S]*FOR UPDATE/);
  });
  it("allows both delegate-family directions, return to a previous delegate, and another repeated transfer", async () => {
    await caller().requestDelegateChange(move(23));
    const manager = { ...actor, id: 23, role: "delegate_manager" };
    await caller(manager).requestDelegateChange(
      move(11, "إرجاع للمندوب الأول للعمل")
    );
    await caller().requestDelegateChange(move(22, "توزيع جديد على مندوب آخر"));
    expect(item().delegateId).toBe(22);
    expect(
      history().map(row => [row.previousDelegateId, row.newDelegateId])
    ).toEqual([
      [11, 23],
      [23, 11],
      [11, 22],
    ]);
    expect(history().every(row => row.eventType === "delegate_changed")).toBe(
      true
    );
  });
  it("uses the actual authenticated identity rather than a projected user", async () => {
    await expect(
      caller(actor, { ...actor, id: 22 }).requestDelegateChange(move(23))
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(item().delegateId).toBe(11);
    expect(history()).toEqual([]);
  });
  it.each([11, 24, 1, 999])(
    "rejects self/nonfamily/inactive/missing target %s",
    async delegateId => {
      await expect(
        caller().requestDelegateChange(move(delegateId))
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(item().delegateId).toBe(11);
      expect(history()).toEqual([]);
      expect(audits()).toEqual([]);
    }
  );
  it.each([
    "UPDATE users SET isActive=0 WHERE id=11",
    "UPDATE users SET role='it_manager' WHERE id=11",
    "UPDATE users SET role='delegate_manager' WHERE id=11",
  ])("rechecks actor role/activity from locked row: %s", async change => {
    f.memory.exec(change);
    await expect(caller().requestDelegateChange(move())).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(item().delegateId).toBe(11);
  });
  it.each([
    "UPDATE users SET isActive=0 WHERE id=22",
    "UPDATE users SET role='admin' WHERE id=22",
  ])("rechecks current recipient on every transfer: %s", async change => {
    f.memory.exec(change);
    await expect(caller().requestDelegateChange(move())).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect(item().delegateId).toBe(11);
  });
  it.each([
    "status='estimated'",
    "batchId=7",
    "estimatedUnitCost='0'",
    "estimatedTotalCost='0'",
    "estimatedById=11",
    "actualUnitCost='2'",
    "actualTotalCost='6'",
    "purchasedAt='now'",
    "purchasedById=11",
    "delegateChangeRequestedAt='legacy-pending'",
    "reviewedById=NULL",
    "reviewedAt=NULL",
  ])("leaves ineligible/legacy pending item unchanged: %s", async change => {
    f.memory.exec("UPDATE purchase_order_items SET " + change + " WHERE id=1");
    const before = item();
    await expect(caller().requestDelegateChange(move())).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(item()).toEqual(before);
    expect(history()).toEqual([]);
    expect(audits()).toEqual([]);
  });
  it.each([
    "INSERT INTO external_maintenance_jobs VALUES(1,100)",
    "INSERT INTO supplier_return_replacement_plans VALUES(1,1)",
    "INSERT INTO delegate_pricing_bundle_items VALUES(1,1,NULL)",
    "INSERT INTO tickets VALUES(7,'C');UPDATE purchase_orders SET ticketId=7 WHERE id=100",
    "INSERT INTO tickets VALUES(7,'A');INSERT INTO ticket_items VALUES(8,7,'C');UPDATE purchase_orders SET ticketId=7,ticketItemId=8 WHERE id=100",
    "UPDATE purchase_orders SET ticketId=999 WHERE id=100",
    "UPDATE purchase_orders SET status='draft' WHERE id=100",
  ])("preserves external/bundle/source restrictions: %s", async change => {
    f.memory.exec(change);
    await expect(caller().requestDelegateChange(move())).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(item().delegateId).toBe(11);
    expect(history()).toEqual([]);
  });
  it("permits a removed historical bundle membership and legacy reviewed nonrouted item", async () => {
    f.memory.exec(
      "INSERT INTO delegate_pricing_bundle_items VALUES(1,1,'removed');UPDATE purchase_order_items SET reviewRole=NULL,reviewedById=NULL,reviewedAt=NULL WHERE id=1"
    );
    await expect(caller().requestDelegateChange(move())).resolves.toMatchObject(
      { success: true }
    );
    expect(item().delegateId).toBe(22);
  });
  it("rejects reason-only old clients clearly and never creates a legacy request", async () => {
    await expect(
      caller().requestDelegateChange({
        itemId: 1,
        reason: move().reason,
      } as any)
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("اختر المندوب الجديد"),
    });
    await expect(
      caller().requestDelegateChange({ ...move(), reason: "قص" })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      caller().requestDelegateChange({ ...move(), actorUserId: 22 } as any)
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(item().delegateChangeRequestedAt).toBeNull();
    expect(history()).toEqual([]);
    expect(notify).not.toHaveBeenCalled();
  });
});

describe("Atomic rollback and post-commit notification", () => {
  it.each(["purchase_order_item_history", "audit_logs"])(
    "rolls assignment/history back if %s persistence fails",
    async table => {
      f.memory.exec(
        "CREATE TRIGGER fail_write BEFORE INSERT ON " +
          table +
          " BEGIN SELECT RAISE(ABORT,'strict write offline'); END"
      );
      const before = item();
      await expect(caller().requestDelegateChange(move())).rejects.toThrow(
        "strict write offline"
      );
      expect(item()).toEqual(before);
      expect(history()).toEqual([]);
      expect(audits()).toEqual([]);
      expect(notify).not.toHaveBeenCalled();
    }
  );
  it("retains committed success if only the recipient notification fails", async () => {
    notify.mockImplementationOnce(async () => {
      expect(item().delegateId).toBe(22);
      expect(history()).toHaveLength(1);
      expect(audits()).toHaveLength(1);
      throw Error("notification offline");
    });
    await expect(caller().requestDelegateChange(move())).resolves.toEqual({
      success: true,
    });
    expect(item().delegateId).toBe(22);
  });
});

describe("Transfer/pricing races retain fresh ownership", () => {
  it("only one of two simultaneous transfers by the old owner commits", async () => {
    const call = caller(),
      result = await Promise.allSettled([
        call.requestDelegateChange(move(22)),
        call.requestDelegateChange(move(23)),
      ]);
    expect(result.filter(row => row.status === "fulfilled")).toHaveLength(1);
    expect(result.filter(row => row.status === "rejected")).toHaveLength(1);
    expect(history()).toHaveLength(1);
    expect(audits()).toHaveLength(1);
    expect([22, 23]).toContain(item().delegateId);
  });
  it("denies the stale delegate's price after transfer, then permits the new delegate's price", async () => {
    await caller().requestDelegateChange(move());
    const write = pricingWriter();
    expect(
      await write(
        1,
        {
          estimatedUnitCost: "5",
          estimatedTotalCost: "15",
          status: "estimated",
        },
        "pending",
        undefined,
        undefined,
        undefined,
        11
      )
    ).toBe(false);
    expect(item()).toMatchObject({
      delegateId: 22,
      status: "pending",
      estimatedUnitCost: null,
    });
    expect(
      await write(
        1,
        {
          estimatedUnitCost: "5",
          estimatedTotalCost: "15",
          status: "estimated",
        },
        "pending",
        undefined,
        undefined,
        undefined,
        22
      )
    ).toBe(true);
  });
  it("does not transfer an item whose pricing already won", async () => {
    await pricingWriter()(
      1,
      { estimatedUnitCost: "5", estimatedTotalCost: "15", status: "estimated" },
      "pending",
      undefined,
      undefined,
      undefined,
      11
    );
    await expect(caller().requestDelegateChange(move())).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(item()).toMatchObject({ delegateId: 11, status: "estimated" });
    expect(history()).toEqual([]);
  });
  it("serializes a pricing request racing behind the transfer's PO lock", async () => {
    const execute = f.db.execute.bind(f.db);
    let release!: () => void,
      signal!: () => void,
      paused = false;
    const waiting = new Promise<void>(resolve => {
        release = resolve;
      }),
      locked = new Promise<void>(resolve => {
        signal = resolve;
      });
    f.db.execute = async (statement: any) => {
      const result = await execute(statement),
        q = dialect.sqlToQuery(statement);
      if (!paused && /^SELECT \* FROM purchase_orders/.test(q.sql)) {
        paused = true;
        signal();
        await waiting;
      }
      return result;
    };
    const transferred = caller().requestDelegateChange(move());
    await locked;
    const priced = pricingWriter()(
      1,
      { estimatedUnitCost: "7", estimatedTotalCost: "21", status: "estimated" },
      "pending",
      undefined,
      undefined,
      undefined,
      11
    );
    release();
    await expect(transferred).resolves.toEqual({ success: true });
    expect(await priced).toBe(false);
    expect(item()).toMatchObject({
      delegateId: 22,
      status: "pending",
      estimatedUnitCost: null,
    });
  });
});

describe("Existing options RPC keeps default manager mode and scoped transfer mode separate", () => {
  it("returns active family recipients except the actual owner in transfer mode", async () => {
    const rows = await caller().delegateAssignmentOptions({
      forDelegateChange: true,
      itemId: 1,
    });
    expect(rows.map((row: any) => row.id)).toEqual([12, 22, 23]);
    await expect(caller().delegateAssignmentOptions()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
  it("revalidates source ownership and exact mode input without granting a directory", async () => {
    await caller().requestDelegateChange(move());
    await expect(
      caller().delegateAssignmentOptions({ forDelegateChange: true, itemId: 1 })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      caller().delegateAssignmentOptions({
        forDelegateChange: false,
        itemId: 1,
      } as any)
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      caller().delegateAssignmentOptions({ forDelegateChange: true, itemId: 0 })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

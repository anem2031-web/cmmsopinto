import { afterEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { PurchaseSupplyWaitService } from "../services/purchase-supply-wait";
import { chunkSupplyWaitItems, supplyWaitRpcAllowed, supplyWaitSaveInput } from "../../shared/purchase-supply-wait";
import { businessRpcAllowed } from "../../shared/business-role-policy";
import { createPurchaseSupplyWaitRouter } from "../routers/purchase/supply-wait.router";
import { router } from "../_core/trpc";
vi.mock("../_core/db", () => ({}));

const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite");
const T0 = "2026-11-08T10:00:00.000Z", reference = { itemId: 1, purchaseOrderId: 100 };
const actor = (id = 10, role = "delegate") => ({ id, role, isActive: 1 });
const input = (extra: any = {}) => ({ ...reference, kind: "preparing", reason: "تصنيع الصنف لدى المورد", expectedReceiptDate: "2026-11-12", revision: null, ...extra });
const openFixtures: any[] = [];
function fixture() {
  const memory = new DatabaseSync(":memory:");
  memory.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE users(id INTEGER PRIMARY KEY,role TEXT,isActive INTEGER,name TEXT,username TEXT);
    CREATE TABLE purchase_orders(id INTEGER PRIMARY KEY,status TEXT,requestedById INTEGER,reviewedById INTEGER,total TEXT,ticketId INTEGER);
    CREATE TABLE purchase_order_items(id INTEGER PRIMARY KEY,purchaseOrderId INTEGER,delegateId INTEGER,status TEXT,batchId INTEGER,delegateChangeRequestedAt TEXT,reviewRole TEXT,reviewedById INTEGER,reviewedAt TEXT,quantity INTEGER);
    CREATE TABLE purchase_item_supply_wait(itemId INTEGER PRIMARY KEY,purchaseOrderId INTEGER,kind TEXT,expectedReceiptDate TEXT,reason TEXT,createdById INTEGER,createdByName TEXT,createdAt TEXT,updatedById INTEGER,updatedByName TEXT,updatedAt TEXT,revision INTEGER,FOREIGN KEY(itemId) REFERENCES purchase_order_items(id) ON DELETE CASCADE);
    CREATE TABLE audit_logs(userId INTEGER,action TEXT,entityType TEXT,entityId INTEGER,newValues TEXT);
    INSERT INTO users VALUES(1,'admin',1,'Admin','ADMIN'),(2,'owner',1,'Owner','OWNER'),(10,'delegate',1,'Delegate','D'),(11,'delegate_manager',1,'Delegate manager','DM'),(20,'warehouse',1,'Requester','R'),(30,'senior_management',1,'Reviewer','REV'),(31,'senior_management',1,'Other reviewer','OTHER'),(40,'accountant',1,'Accountant','A');
    INSERT INTO purchase_orders VALUES(100,'approved',20,30,'100.00',99);
    INSERT INTO purchase_order_items VALUES(1,100,10,'approved',5,NULL,'senior_management',30,'2026-11-01',6);`);
  let now = T0, tail = Promise.resolve();
  const queries: { sql: string; params: any[] }[] = [];
  const options = { auditFails: false, readError: null as any, advanceAtUpdate: false, scopeDenied: false };
  memory.function("UTC_TIMESTAMP", { varargs: true }, () => now);
  memory.function("TWO_HOURS_AGO", () => new Date(Date.parse(now) - 7200000).toISOString());
  memory.function("DATE_FORMAT", (value: string, format: string) => format === "%Y-%m-%d" ? value.slice(0, 10) : new Date(value).toISOString());
  const db: any = { execute: async (statement: any) => {
    const q = new MySqlDialect().sqlToQuery(statement);
    queries.push({ sql: q.sql, params: q.params });
    if (options.readError && q.sql.includes("FROM purchase_item_supply_wait")) throw options.readError;
    if (options.auditFails && q.sql.startsWith("INSERT INTO audit_logs")) throw Error("audit unavailable");
    if (options.advanceAtUpdate && q.sql.startsWith("UPDATE purchase_item_supply_wait")) now = new Date(Date.parse(T0) + 7200000).toISOString();
    const sql = q.sql.replace(/\s+FOR UPDATE/g, "").replace(/DATE_SUB\(UTC_TIMESTAMP\(3\),INTERVAL 2 HOUR\)/g, "TWO_HOURS_AGO()");
    try {
      const prepared = memory.prepare(sql);
      if (/^\s*SELECT/.test(sql)) return [prepared.all(...q.params), []];
      return [{ affectedRows: Number(prepared.run(...q.params).changes) }, []];
    } catch (error: any) {
      if (error.message.includes("UNIQUE constraint")) throw Object.assign(error, { code: "ER_DUP_ENTRY" });
      if (error.message.includes("no such table: purchase_item_supply_wait")) throw Object.assign(error, { code: "ER_NO_SUCH_TABLE", errno: 1146 });
      throw error;
    }
  } };
  db.transaction = (work: any) => {
    const result = tail.then(async () => { memory.exec("BEGIN"); try { const value = await work(db); memory.exec("COMMIT"); return value; } catch (error) { memory.exec("ROLLBACK"); throw error; } });
    tail = result.then(() => undefined, () => undefined); return result;
  };
  const readScope = vi.fn(async (_actor: any, orders: any[]) => ({ filterItems: (order: any, items: any[]) => !options.scopeDenied && orders.some(p => p.id === order.id) ? items : [] }));
  const service = new PurchaseSupplyWaitService({ database: async () => db, readScope });
  const f = { memory, db, service, queries, options, readScope,
    setTime: (ms: number) => { now = new Date(Date.parse(T0) + ms).toISOString(); },
    list: (user = actor(), refs = [reference]) => service.list(user, { viewerId: user.id, viewerRole: user.role, items: refs }),
    note: () => memory.prepare("SELECT * FROM purchase_item_supply_wait WHERE itemId=1").get() as any,
    source: () => JSON.stringify([memory.prepare("SELECT * FROM purchase_orders").all(), memory.prepare("SELECT * FROM purchase_order_items").all()]),
  };
  openFixtures.push(f); return f;
}
afterEach(() => { openFixtures.splice(0).forEach(f => f.memory.close()); });

describe("optional supply-wait annotations", () => {
  it.each(["delegate", "delegate_manager"])("saves independently for %s, with immutable first-save time", async role => {
    const f = fixture(); f.memory.prepare("UPDATE users SET role=? WHERE id=10").run(role);
    const before = f.source(); await f.service.save(actor(10, role), input());
    expect(f.note().createdAt).toBe(T0); expect(f.note().createdById).toBe(10);
    f.setTime(3600000); await f.service.save(actor(10, role), input({ revision: 0, reason: "الموعد أكد من المورد" }));
    expect(f.note().createdAt).toBe(T0); expect(f.note().revision).toBe(1); expect(f.source()).toBe(before);
    expect(f.queries.filter(q => /^(UPDATE|INSERT|DELETE)/.test(q.sql)).every(q => /^(UPDATE purchase_item_supply_wait|INSERT INTO purchase_item_supply_wait|INSERT INTO audit_logs)/.test(q.sql))).toBe(true);
    expect(JSON.stringify(f.memory.prepare("SELECT newValues FROM audit_logs").all())).not.toContain("الموعد");
  });
  it.each([20, 30])("hides all note details from recipient %s until exactly two hours", async id => {
    const f = fixture(); await f.service.save(actor(), input());
    const user = actor(id, id === 20 ? "warehouse" : "senior_management");
    f.setTime(7199999); const before = await f.list(user);
    expect(before.items[0].note).toBeNull(); expect(JSON.stringify(before)).not.toContain("تصنيع"); expect(JSON.stringify(before)).not.toContain("2026-11-12");
    f.setTime(7200000); expect((await f.list(user)).items[0].note?.reason).toBe(input().reason);
    expect((await f.list(user)).items[0].note?.canEdit).toBe(false);
  });
  it("lets the assignee see immediately; closes editing exactly at the original deadline", async () => {
    const f = fixture(); await f.service.save(actor(), input());
    expect((await f.list()).items[0].note?.canEdit).toBe(true);
    f.setTime(7199999); await f.service.save(actor(), input({ revision: 0, reason: "تعديل أخير" }));
    f.setTime(7200000); expect((await f.list()).items[0].note?.canEdit).toBe(false);
    await expect(f.service.save(actor(), input({ revision: 1 }))).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it.each([[1, "admin"], [2, "owner"]])("gives %s/%s immediate view and editing after expiry", async (id, role) => {
    const f = fixture(); await f.service.save(actor(), input());
    expect((await f.list(actor(id as number, role as string))).items[0].note?.canEdit).toBe(true);
    f.setTime(10 * 86400000); await f.service.save(actor(id as number, role as string), input({ revision: 0, reason: "تصحيح الإدارة" }));
    expect(f.note().updatedById).toBe(id); expect(f.note().createdById).toBe(10); expect(f.note().createdAt).toBe(T0);
  });
  it("blocks unrelated reviewers/delegates and forged item-parent pairs", async () => {
    const f = fixture(); await f.service.save(actor(), input()); f.setTime(7200000);
    expect((await f.list(actor(31, "senior_management"))).items).toEqual([]);
    expect((await f.list(actor(11, "delegate_manager"))).items).toEqual([]);
    expect((await f.list(actor(), [{ ...reference, purchaseOrderId: 999 }])).items).toEqual([]);
    await expect(f.service.save(actor(), input({ purchaseOrderId: 999, revision: 0 }))).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(f.service.save(actor(11, "delegate_manager"), input({ revision: 0 }))).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("checks the original parent guard and missing parents", async () => {
    const f = fixture(); f.options.scopeDenied = true;
    expect((await f.list()).items).toEqual([]); await expect(f.service.save(actor(), input())).rejects.toMatchObject({ code: "FORBIDDEN" });
    f.options.scopeDenied = false; f.memory.exec("DELETE FROM purchase_orders");
    expect((await f.list()).items).toEqual([]);
  });
  it("supports the actual legacy reviewer without granting all reviewers", async () => {
    const f = fixture(); f.memory.exec("UPDATE purchase_order_items SET reviewRole=NULL,reviewedById=NULL,reviewedAt=NULL");
    await f.service.save(actor(), input()); f.setTime(7200000);
    expect((await f.list(actor(30, "senior_management"))).items[0].note).toBeTruthy();
    expect((await f.list(actor(31, "senior_management"))).items).toEqual([]);
  });
  it("does not use the legacy parent reviewer for a differently routed item", async () => {
    const f = fixture(); f.memory.exec("UPDATE purchase_order_items SET reviewedById=31"); await f.service.save(actor(), input()); f.setTime(7200000);
    expect((await f.list(actor(30, "senior_management"))).items).toEqual([]);
    expect((await f.list(actor(31, "senior_management"))).items[0].note).toBeTruthy();
  });
  it.each(["pending", "estimated", "purchased", "rejected", "cancelled"])("cannot create a new note for %s", async status => {
    const f = fixture(); f.memory.prepare("UPDATE purchase_order_items SET status=?").run(status);
    expect((await f.list()).items[0].canCreate).toBe(false); await expect(f.service.save(actor(), input())).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("allows an existing explanation to remain visible and editable during the original window after purchase", async () => {
    const f = fixture(); await f.service.save(actor(), input()); f.memory.exec("UPDATE purchase_order_items SET status='purchased'");
    await f.service.save(actor(), input({ revision: 0, reason: "بانتظار استلام الشراء" })); f.setTime(7200000);
    expect((await f.list(actor(20, "warehouse"))).items[0].note?.reason).toBe("بانتظار استلام الشراء");
  });
  it("enforces fresh active identity, assignment, and viewer ownership per call", async () => {
    const f = fixture(); await f.list();
    await expect(f.service.list(actor(), { viewerId: 1, viewerRole: "admin", items: [reference] })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(f.service.list(actor(), { viewerId: 10, viewerRole: "admin", items: [reference] })).rejects.toMatchObject({ code: "FORBIDDEN" });
    f.memory.exec("UPDATE users SET isActive=0 WHERE id=10"); await expect(f.list()).rejects.toMatchObject({ code: "FORBIDDEN" });
    f.memory.exec("UPDATE users SET isActive=1,role='warehouse' WHERE id=10"); await expect(f.service.save(actor(), input())).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("rechecks assignment on a subsequent save", async () => {
    const f = fixture(); await f.service.save(actor(), input()); f.memory.exec("UPDATE purchase_order_items SET delegateId=11");
    await expect(f.service.save(actor(), input({ revision: 0 }))).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("prevents duplicate concurrent creation and rejects stale edits", async () => {
    const f = fixture(); const results = await Promise.allSettled([f.service.save(actor(), input()), f.service.save(actor(), input())]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    await f.service.save(actor(), input({ revision: 0 })); await expect(f.service.save(actor(), input({ revision: 0 }))).rejects.toMatchObject({ code: "CONFLICT" });
    expect(f.note().revision).toBe(1);
  });
  it("checks the deadline again in the actual UPDATE", async () => {
    const f = fixture(); await f.service.save(actor(), input()); f.setTime(7199999); f.options.advanceAtUpdate = true;
    await expect(f.service.save(actor(), input({ revision: 0, reason: "too late" }))).rejects.toMatchObject({ code: "CONFLICT" });
    expect(f.note().reason).toBe(input().reason); expect(f.note().revision).toBe(0);
  });
  it("rolls back the optional note if its audit write fails", async () => {
    const f = fixture(); f.options.auditFails = true;
    await expect(f.service.save(actor(), input())).rejects.toThrow("audit unavailable"); expect(f.note()).toBeUndefined();
  });
  it("handles only the exact absent optional table, propagating other infrastructure failures", async () => {
    const f = fixture(); f.memory.exec("DROP TABLE purchase_item_supply_wait"); expect((await f.list()).available).toBe(false);
    f.options.readError = Object.assign(Error("connection failed"), { code: "ECONNRESET" }); await expect(f.list()).rejects.toThrow("connection failed");
  });
  it("does not block existing item deletion", async () => {
    const f = fixture(); await f.service.save(actor(), input()); f.memory.exec("DELETE FROM purchase_order_items WHERE id=1"); expect(f.note()).toBeUndefined();
  });
  it("loads repeated parent scope once and keeps query count bounded for 500 mixed items", async () => {
    const f = fixture(); const insert = f.memory.prepare("INSERT INTO purchase_order_items SELECT ?,100,10,'approved',5,NULL,'senior_management',30,'2026-11-01',6");
    for (let id = 2; id <= 500; id++) insert.run(id);
    const refs = Array.from({ length: 500 }, (_, i) => ({ itemId: i + 1, purchaseOrderId: 100 }));
    expect((await f.list(actor(), refs)).items).toHaveLength(500); expect(f.readScope).toHaveBeenCalledTimes(1);
    expect(f.readScope.mock.calls[0][1]).toHaveLength(1); expect(f.queries).toHaveLength(5);
    const chunks = chunkSupplyWaitItems([...refs, ...refs]); expect(chunks).toHaveLength(1);
    const large = chunkSupplyWaitItems(Array.from({ length: 2501 }, (_, i) => ({ itemId: i + 1, purchaseOrderId: 100 })));
    expect(large.map(chunk => chunk.length)).toEqual([500, 500, 500, 500, 500, 1]);
  });
});

describe("supply-wait API capabilities and input boundary", () => {
  it("checks direct RPC writes with the real middleware, never granting a reviewer write access", async () => {
    const f = fixture();
    const api = router({ purchaseSupplyWait: createPurchaseSupplyWaitRouter({ database: async () => f.db, readScope: f.readScope }) });
    const call = (user: any) => api.createCaller({ user, authenticatedUser: user, req: {}, res: {} } as any).purchaseSupplyWait;
    await call(actor()).save(input());
    expect(f.note().createdById).toBe(10);
    await expect(call(actor(30, "senior_management")).save(input({ revision: 0 }))).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(call(actor(20, "warehouse")).save(input({ revision: 0 }))).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await call(actor(20, "warehouse")).list({ viewerId: 20, viewerRole: "warehouse", items: [reference] })).items[0].note).toBeNull();
  });
  it("denies an observer's forged admin context at the direct RPC boundary", async () => {
    const f = fixture(); const api = router({ purchaseSupplyWait: createPurchaseSupplyWaitRouter({ database: async () => f.db, readScope: f.readScope }) });
    const caller = api.createCaller({ user: actor(1, "admin"), authenticatedUser: actor(1, "observer"), req: {}, res: {} } as any).purchaseSupplyWait;
    await expect(caller.list({ viewerId: 1, items: [reference] })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.save(input())).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(f.queries).toHaveLength(0);
  });
  it.each(["delegate", "delegate_manager", "admin", "owner"])("grants the reviewed writer %s only exact endpoints", role => {
    expect(supplyWaitRpcAllowed(actor(1, role), "mutation", "purchaseSupplyWait.save")).toBe(true);
    expect(supplyWaitRpcAllowed(actor(1, role), "mutation", "purchaseSupplyWait.list")).toBe(false);
    expect(supplyWaitRpcAllowed(actor(1, role), "query", "purchaseSupplyWait.unknown")).toBe(false);
  });
  it.each(["warehouse", "accountant", "senior_management", "executive_director", "user", "construction_procurement_manager"])("does not give %s a write capability", role => {
    expect(supplyWaitRpcAllowed(actor(1, role), "mutation", "purchaseSupplyWait.save")).toBe(false);
    expect(supplyWaitRpcAllowed(actor(1, role), "query", "purchaseSupplyWait.list")).toBe(true);
  });
  it.each(["observer", "gate_security", "technician"])("keeps %s denied", role => expect(supplyWaitRpcAllowed(actor(1, role), "query", "purchaseSupplyWait.list")).toBe(false));
  it("adds only a list grant to guarded business roles", () => {
    for (const role of ["warehouse", "accountant", "senior_management", "executive_director", "food_warehouse_assistant"]) {
      expect(businessRpcAllowed(actor(1, role), "query", "purchaseSupplyWait.list")).toBe(true);
      expect(businessRpcAllowed(actor(1, role), "mutation", "purchaseSupplyWait.save")).toBe(false);
    }
  });
  it.each([{ reason: " " }, { expectedReceiptDate: "2026-02-30" }, { expectedReceiptDate: "" }, { createdAt: T0 }, { kind: "other" }])("rejects missing/forged data %j", change => expect(() => supplyWaitSaveInput.parse(input(change))).toThrow());
  it("rejects invalid read chunk sizes", () => expect(() => chunkSupplyWaitItems([reference], 0)).toThrow());
});

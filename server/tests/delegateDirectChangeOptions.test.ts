import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { APP_ROLE } from "../../shared/roles";
import { delegateDirectoryRpcAllowed } from "../../shared/delegate-directory-policy";
import { delegateManagerAssignmentRpcAllowed, isDelegateChangeOptionsInput } from "../../shared/delegate-role";
import { router, protectedProcedure } from "../routers/_shared/procedures";
import { canDirectlyReassignOwnItem, canManagerAssignOwnItem, delegateAssignmentOptions, readDelegateAssignmentSources } from "../services/delegate-manager-assignment";
import { purchaseSpecificationsDatabase } from "./fixtures/purchaseSpecificationsDatabase";

const actor = { id: 11, role: "delegate", isActive: 1 };
let f: ReturnType<typeof purchaseSpecificationsDatabase>;
const stored = (id = 1) => f.memory.prepare("SELECT * FROM purchase_order_items WHERE id=?").get(id) as any;
const optionsInput = { forDelegateChange: true as const, itemId: 1 };
const api = () => router({ purchaseOrders: router({
  delegateAssignmentOptions: protectedProcedure.input(z.object({ forDelegateChange: z.literal(true), itemId: z.number().int().positive() }).strict().optional())
    .query(({ ctx, input }) => delegateAssignmentOptions(f.db, ctx.authenticatedUser ?? ctx.user, input)),
}) });
const call = (identity = actor, projected = false) => api().createCaller({
  user: projected ? { ...identity, role: "admin" } : identity,
  authenticatedUser: identity, req: {}, res: {},
} as any).purchaseOrders;

beforeEach(() => {
  f = purchaseSpecificationsDatabase();
  f.memory.exec(`ALTER TABLE users ADD COLUMN username TEXT;
    ALTER TABLE purchase_orders ADD COLUMN reviewedById INTEGER; ALTER TABLE purchase_orders ADD COLUMN reviewedAt TEXT;
    ALTER TABLE purchase_order_items ADD COLUMN delegateId INTEGER; ALTER TABLE purchase_order_items ADD COLUMN delegateAssignedAt TEXT;
    ALTER TABLE purchase_order_items ADD COLUMN batchId INTEGER; ALTER TABLE purchase_order_items ADD COLUMN delegateChangeRequestedAt TEXT;
    ALTER TABLE purchase_order_items ADD COLUMN estimatedUnitCost TEXT; ALTER TABLE purchase_order_items ADD COLUMN estimatedTotalCost TEXT;
    ALTER TABLE purchase_order_items ADD COLUMN estimatedById INTEGER;
    ALTER TABLE purchase_order_items ADD COLUMN actualUnitCost TEXT; ALTER TABLE purchase_order_items ADD COLUMN actualTotalCost TEXT;
    ALTER TABLE purchase_order_items ADD COLUMN purchasedAt TEXT; ALTER TABLE purchase_order_items ADD COLUMN purchasedById INTEGER;
    CREATE TABLE tickets(id INTEGER PRIMARY KEY,maintenancePath TEXT);
    CREATE TABLE ticket_items(id INTEGER PRIMARY KEY,ticketId INTEGER,maintenancePath TEXT);
    CREATE TABLE external_maintenance_jobs(id INTEGER PRIMARY KEY,purchaseOrderId INTEGER);
    CREATE TABLE supplier_return_replacement_plans(id INTEGER PRIMARY KEY,purchaseOrderItemId INTEGER);
    CREATE TABLE delegate_pricing_bundle_items(id INTEGER PRIMARY KEY,purchaseOrderItemId INTEGER,removedAt TEXT);`);
  for (const user of [
    { ...actor, name: "Current", username: "current" },
    { id: 12, role: "delegate_manager", isActive: 1, name: "Manager", username: "manager" },
    { id: 22, role: "delegate", isActive: 1, name: "Delegate", username: "delegate" },
    { id: 23, role: "delegate_manager", isActive: 0, name: "Disabled" },
    { id: 1, role: "admin", isActive: 1, name: "Admin" },
  ]) f.insert("users", user);
  f.insert("purchase_orders", { id: 100, status: "pending_estimate", reviewedById: 9, reviewedAt: "2026-11-25 08:00:00" });
  for (let id = 1; id <= 3; id++) f.insert("purchase_order_items", {
    id, purchaseOrderId: 100, itemName: `Item ${id}`, status: "pending", delegateId: 11,
    delegateAssignedAt: "2026-11-25 08:05:00", reviewRole: "general_maintenance_manager", reviewedById: 9, reviewedAt: "2026-11-25 08:00:00",
  });
});
afterEach(() => f.close());

describe("central recipient-mode capability is explicit and does not open the directory", () => {
  it("keeps no-input manager options and the manager mutation unchanged for every role", () => {
    for (const role of Object.values(APP_ROLE)) {
      const user = { ...actor, role };
      expect(delegateManagerAssignmentRpcAllowed(user, "query", "purchaseOrders.delegateAssignmentOptions")).toBe(role === "delegate_manager");
      expect(delegateManagerAssignmentRpcAllowed(user, "mutation", "purchaseOrders.assignOwnDelegateItem", optionsInput)).toBe(role === "delegate_manager");
      expect(delegateManagerAssignmentRpcAllowed(user, "query", "purchaseOrders.assignOwnDelegateItem", optionsInput)).toBe(false);
      expect(delegateManagerAssignmentRpcAllowed(user, "mutation", "purchaseOrders.delegateAssignmentOptions", optionsInput)).toBe(false);
      expect(delegateManagerAssignmentRpcAllowed(user, "query", "purchaseOrders.delegateAssignmentOptions", optionsInput)).toBe(["delegate", "delegate_manager"].includes(role));
    }
    for (const role of ["delegate", "delegate_manager"]) {
      expect(delegateDirectoryRpcAllowed(role, "users.list")).toBe(false);
      expect(delegateDirectoryRpcAllowed(role, "users.byRole", { role: "delegate" })).toBe(false);
    }
  });
  it.each([null, false, true, [], {}, "direct", { forDelegateChange: false, itemId: 1 }, { forDelegateChange: "true", itemId: 1 },
    { forDelegateChange: true }, { itemId: 1 }, { forDelegateChange: true, itemId: "1" }, { forDelegateChange: true, itemId: 0 },
    { forDelegateChange: true, itemId: -1 }, { forDelegateChange: true, itemId: 1.5 }, { forDelegateChange: true, itemId: Number.MAX_SAFE_INTEGER + 1 },
    { forDelegateChange: true, itemId: 1, includeAllUsers: true }])("rejects malformed or ambiguous raw mode: %j", raw => {
    expect(isDelegateChangeOptionsInput(raw)).toBe(false);
    for (const role of ["delegate", "delegate_manager"]) expect(delegateManagerAssignmentRpcAllowed({ ...actor, role }, "query", "purchaseOrders.delegateAssignmentOptions", raw)).toBe(false);
  });
  it("rejects inactive or invalid actor identities even in the explicit mode", () => {
    for (const user of [null, { ...actor, isActive: 0 }, { ...actor, id: 0 }, { ...actor, id: NaN }, { ...actor, id: 1.5 }])
      expect(delegateManagerAssignmentRpcAllowed(user, "query", "purchaseOrders.delegateAssignmentOptions", optionsInput)).toBe(false);
  });
});

describe("recipient names are scoped to a freshly eligible owned item", () => {
  it.each(["delegate", "delegate_manager"])("returns only active family recipients excluding the current %s", async role => {
    f.memory.exec(`UPDATE users SET role='${role}' WHERE id=11`);
    const before = stored();
    expect(await call({ ...actor, role }).delegateAssignmentOptions(optionsInput)).toEqual([
      { id: 12, name: "Manager", username: "manager" }, { id: 22, name: "Delegate", username: "delegate" },
    ]);
    expect(stored()).toEqual(before);
    expect(f.queries.map(query => query.params.length)).toEqual([1, 1, 1]);
    expect(f.queries.every(query => !/FOR UPDATE/i.test(query.sql))).toBe(true);
  });
  it("keeps legacy manager-only ordinary-delegate options with no input", async () => {
    f.memory.exec("UPDATE users SET role='delegate_manager' WHERE id=11");
    expect(await call({ ...actor, role: "delegate_manager" }).delegateAssignmentOptions()).toEqual([{ id: 22, name: "Delegate", username: "delegate" }]);
    await expect(call().delegateAssignmentOptions()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it.each(["owner", "admin", "observer", "warehouse", "maintenance_manager"])("does not trust an admin projection of %s", async role => {
    await expect(call({ ...actor, role }, true).delegateAssignmentOptions(optionsInput)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(f.queries).toHaveLength(0);
  });
  it.each(["UPDATE users SET isActive=0 WHERE id=11", "UPDATE users SET role='delegate_manager' WHERE id=11", "DELETE FROM users WHERE id=11"])("rechecks the current stored actor: %s", async update => {
    f.memory.exec(update);
    await expect(call().delegateAssignmentOptions(optionsInput)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(f.queries).toHaveLength(1);
  });
  it("rechecks ownership on every call and permits selecting a previous holder after a handoff", async () => {
    expect(await call().delegateAssignmentOptions(optionsInput)).toHaveLength(2);
    f.memory.exec("UPDATE purchase_order_items SET delegateId=22 WHERE id=1");
    await expect(call().delegateAssignmentOptions(optionsInput)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await call({ ...actor, id: 22 }).delegateAssignmentOptions(optionsInput)).toEqual([
      { id: 11, name: "Current", username: "current" }, { id: 12, name: "Manager", username: "manager" },
    ]);
    f.memory.exec("UPDATE purchase_order_items SET delegateId=11 WHERE id=1");
    expect(await call().delegateAssignmentOptions(optionsInput)).toHaveLength(2);
  });
  it.each(["UPDATE purchase_order_items SET delegateId=22 WHERE id=1", "DELETE FROM purchase_orders WHERE id=100", "DELETE FROM purchase_order_items WHERE id=1"])("denies foreign items and missing parents: %s", async update => {
    f.memory.exec(update);
    await expect(call().delegateAssignmentOptions(optionsInput)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(f.queries).toHaveLength(2);
  });
  it.each([
    "UPDATE purchase_order_items SET status='estimated' WHERE id=1", "UPDATE purchase_order_items SET estimatedUnitCost='0' WHERE id=1",
    "UPDATE purchase_order_items SET estimatedTotalCost='0' WHERE id=1", "UPDATE purchase_order_items SET estimatedById=11 WHERE id=1",
    "UPDATE purchase_order_items SET actualUnitCost='1' WHERE id=1", "UPDATE purchase_order_items SET purchasedAt='now' WHERE id=1",
    "UPDATE purchase_order_items SET batchId=4 WHERE id=1", "UPDATE purchase_order_items SET delegateChangeRequestedAt='now' WHERE id=1",
    "UPDATE purchase_order_items SET reviewedAt=NULL WHERE id=1", "UPDATE purchase_order_items SET reviewedById=NULL WHERE id=1",
    "UPDATE purchase_orders SET status='draft' WHERE id=100", "UPDATE purchase_orders SET status='closed' WHERE id=100",
    "INSERT INTO external_maintenance_jobs VALUES(1,100)", "INSERT INTO supplier_return_replacement_plans VALUES(1,1)",
    "INSERT INTO delegate_pricing_bundle_items VALUES(1,1,NULL)",
    "INSERT INTO tickets VALUES(7,'C'); UPDATE purchase_orders SET ticketId=7 WHERE id=100",
    "INSERT INTO tickets VALUES(7,'A'); INSERT INTO ticket_items VALUES(8,7,'C'); UPDATE purchase_orders SET ticketId=7,ticketItemId=8 WHERE id=100",
    "UPDATE purchase_orders SET ticketId=999 WHERE id=100",
    "INSERT INTO tickets VALUES(7,'A'); INSERT INTO ticket_items VALUES(8,99,'A'); UPDATE purchase_orders SET ticketId=7,ticketItemId=8 WHERE id=100",
  ])("does not reveal recipient names after an eligibility/source change: %s", async update => {
    f.memory.exec(update);
    await expect(call().delegateAssignmentOptions(optionsInput)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(f.queries).toHaveLength(2);
  });
  it("preserves committed legacy review checks and ignores removed pricing memberships", async () => {
    f.memory.exec("UPDATE purchase_order_items SET reviewRole=NULL,reviewedAt=NULL,reviewedById=NULL WHERE id=1; INSERT INTO delegate_pricing_bundle_items VALUES(1,1,'removed')");
    expect(await call().delegateAssignmentOptions(optionsInput)).toHaveLength(2);
    f.memory.exec("UPDATE purchase_orders SET reviewedById=NULL WHERE id=100");
    await expect(call().delegateAssignmentOptions(optionsInput)).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("propagates infrastructure failures instead of returning an empty recipient list", async () => {
    const failure = Error("source offline"); let reads = 0;
    const database = { execute: async (query: any) => { if (++reads === 2) throw failure; return f.db.execute(query); } };
    await expect(delegateAssignmentOptions(database, actor, optionsInput)).rejects.toBe(failure);
  });
});

describe("assignment source reads remain bounded and decisions independent", () => {
  it("deduplicates 1001 IDs into three chunks and uses locking reads only when explicitly requested", async () => {
    for (let id = 4; id <= 1001; id++) f.insert("purchase_order_items", { ...stored(), id });
    f.queries.length = 0;
    const result = await readDelegateAssignmentSources(f.db, [...Array.from({ length: 1001 }, (_, index) => index + 1), ...Array(1200).fill(1)]);
    expect(result).toHaveLength(1001); expect(f.queries.map(query => query.params.length)).toEqual([500, 500, 1]);
    expect(f.queries.every(query => !/FOR UPDATE/i.test(query.sql))).toBe(true);
    f.queries.length = 0; await readDelegateAssignmentSources(f.db, [1], true);
    expect(f.queries).toHaveLength(1); expect(f.queries[0].sql).toMatch(/FOR UPDATE\s*$/i);
    f.queries.length = 0; expect(await readDelegateAssignmentSources(f.db, [])).toEqual([]); expect(f.queries).toHaveLength(0);
    await expect(readDelegateAssignmentSources(f.db, [0])).rejects.toMatchObject({ code: "CONFLICT" });
    expect(f.queries).toHaveLength(0);
  });
  it("does not authorize a foreign or ineligible sibling when mixed IDs share the same PO", async () => {
    f.memory.exec("UPDATE purchase_order_items SET delegateId=22 WHERE id=2; UPDATE purchase_order_items SET reviewedAt=NULL WHERE id=3");
    const facts = await readDelegateAssignmentSources(f.db, [1, 2, 3, 999]);
    expect(facts.filter(item => canDirectlyReassignOwnItem(actor, item)).map(item => item.id)).toEqual([1]);
    expect(facts.every(item => !canManagerAssignOwnItem(actor, item))).toBe(true);
    expect(canManagerAssignOwnItem({ ...actor, role: "delegate_manager" }, facts[0])).toBe(true);
    expect(f.queries).toHaveLength(1);
  });
});

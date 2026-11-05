import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sql, eq, inArray, and, isNull } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { purchaseOrders, purchaseOrderItems, users, tickets, ticketItems, externalMaintenanceJobs } from "../../drizzle/schema";
import { readScopeChunks } from "../_core/authz/read-batch";
import { readFileSync } from "node:fs";
import ts from "typescript";
import vm from "node:vm";
import { purchaseSpecificationsDatabase } from "./fixtures/purchaseSpecificationsDatabase";
import { externalWorkshopInput, externalWorkshopFields, externalWorkshopForPurchaseItem, withExternalWorkshopPricing } from "../services/external-maintenance-pricing";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { isDelegateRole } from "../../shared/delegate-role";
import { isRoutedPurchaseItem } from "../../shared/purchase-item-review";
import { assertRoutedPurchaseItemReady } from "../services/purchase-review-routing";
import { summarizePurchasePricingStage } from "../../shared/purchasePricingStage";
vi.mock("../_core/db", () => ({}));
import { assertPOItemAssignedToDelegate, assertCanPerformPurchaseItemReviewAction, assertCanResolveReturnedPOItem } from "../_core/authz/guard";
import { protectedProcedure, delegateProcedure, router } from "../routers/_shared/procedures";

let f: ReturnType<typeof purchaseSpecificationsDatabase>;
const actor = { id: 7, role: "delegate", isActive: 1 };
const workshop = { workshopName: "ورشة الإصلاح", workshopPhone: "٠٥٠١٢٣٤٥٦٧", expectedReturnDate: "2026-11-09", workshopLocationUrl: "https://maps.example.test/repair", workshopNotes: "موعد الصيانة" };
const row = (table: string, id: number) => f.memory.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id) as any;
beforeEach(() => {
  f = purchaseSpecificationsDatabase();
  f.memory.exec(`
    ALTER TABLE purchase_order_items ADD COLUMN delegateId INTEGER;
    ALTER TABLE purchase_order_items ADD COLUMN batchId INTEGER;
    ALTER TABLE purchase_order_items ADD COLUMN delegateChangeRequestedAt TEXT;
    ALTER TABLE purchase_order_items ADD COLUMN estimatedUnitCost TEXT;
    ALTER TABLE purchase_order_items ADD COLUMN estimatedTotalCost TEXT;
    ALTER TABLE purchase_order_items ADD COLUMN updatedAt TEXT;
    CREATE TABLE tickets(id INTEGER PRIMARY KEY,maintenancePath TEXT);
    CREATE TABLE ticket_items(id INTEGER PRIMARY KEY,ticketId INTEGER,maintenancePath TEXT);
    CREATE TABLE external_maintenance_jobs(id INTEGER PRIMARY KEY,purchaseOrderId INTEGER,ticketId INTEGER,ticketItemId INTEGER,delegateId INTEGER,status TEXT,
      gateExitApprovedAt TEXT,gateEntryApprovedAt TEXT,warehouseReceivedAt TEXT,workshopName TEXT,workshopPhone TEXT,expectedReturnDate TEXT,workshopLocationUrl TEXT,workshopNotes TEXT);
  `);
  f.insert("users", { ...actor, name: "Delegate" });
  f.insert("users", { id: 8, role: "owner", isActive: 1 });
  f.insert("users", { id: 9, role: "warehouse", isActive: 1 });
  f.insert("tickets", { id: 30, maintenancePath: "C" });
  f.insert("ticket_items", { id: 31, ticketId: 30, maintenancePath: "C" });
  f.insert("purchase_orders", { id: 10, poNumber: "PR-EXT", ticketId: 30, ticketItemId: 31, status: "pending_estimate", requestedById: 9 });
  f.insert("purchase_order_items", { id: 20, purchaseOrderId: 10, delegateId: 7, status: "pending", quantity: 2, itemName: "إصلاح الأصل", unit: "خدمة", updatedAt: "2026-11-04 10:00:00" });
  f.insert("external_maintenance_jobs", { id: 40, purchaseOrderId: 10, ticketId: 30, ticketItemId: 31, delegateId: 7, status: "purchase_cycle", gateExitApprovedAt: "2026-11-04 10:00:00" });
});
afterEach(() => f.close());
function quote(options: any = {}) {
  const write = options.write || vi.fn(async (tx: any, current: any) => {
    const db = tx || f.db;
    const [result] = await db.execute(sql`UPDATE purchase_order_items SET estimatedUnitCost='50',estimatedTotalCost='100',status='estimated' WHERE id=20 AND delegateId=7 AND status='pending'`);
    if (Number(result.affectedRows) !== 1) throw Error("Quote changed");
    return { saved: true, currentActor: current?.actor.id };
  });
  return { write, run: () => withExternalWorkshopPricing({ database: f.db, transaction: (work: any) => f.db.transaction(work), actor, purchaseOrderId: 10, itemId: 20, externalWorkshop: workshop, ...options, write }) };
}

describe("external pricing persists required workshop and quote atomically", () => {
  it.each(["delegate", "delegate_manager"])("allows only the assigned active %s without changing other workflow/source data", async role => {
    f.memory.prepare("UPDATE users SET role=? WHERE id=7").run(role);
    const header = row("purchase_orders", 10), source = row("external_maintenance_jobs", 40);
    const q = quote({ actor: { ...actor, role } });
    await q.run();
    expect(q.write).toHaveBeenCalledOnce();
    expect(row("purchase_order_items", 20)).toMatchObject({ status: "estimated", delegateId: 7, estimatedUnitCost: "50", estimatedTotalCost: "100" });
    expect(row("purchase_orders", 10)).toEqual(header);
    const updated = row("external_maintenance_jobs", 40);
    expect(updated).toMatchObject(workshop);
    for (const key of ["ticketId", "ticketItemId", "purchaseOrderId", "delegateId", "status", "gateExitApprovedAt"]) expect(updated[key]).toEqual(source[key]);
    expect(f.memory.prepare("SELECT COUNT(*) AS count FROM audit_logs").get()).toEqual({ count: 1 });
  });
  it("keeps the owner pricing override but still requires all workshop fields", async () => {
    const missing = quote({ actor: { id: 8, role: "owner", isActive: 1 }, externalWorkshop: undefined });
    await expect(missing.run()).rejects.toMatchObject({ code: "BAD_REQUEST" }); expect(missing.write).not.toHaveBeenCalled();
    await quote({ actor: { id: 8, role: "owner", isActive: 1 } }).run();
    expect(row("external_maintenance_jobs", 40).workshopName).toBe(workshop.workshopName);
  });
  it("rejects a mismatched job/item delegate even for the owner override", async () => {
    f.memory.exec("UPDATE external_maintenance_jobs SET delegateId=99");
    const q = quote({ actor: { id: 8, role: "owner", isActive: 1 } });
    await expect(q.run()).rejects.toMatchObject({ code: "CONFLICT" }); expect(q.write).not.toHaveBeenCalled();
  });
  it.each([
    undefined, {}, { ...workshop, workshopName: " " }, { ...workshop, workshopPhone: " " }, { ...workshop, expectedReturnDate: "" },
    { ...workshop, expectedReturnDate: "2026-02-30" }, { ...workshop, expectedReturnDate: "2026-11-09T12:00:00Z" },
    { ...workshop, workshopLocationUrl: "javascript:alert(1)" }, { ...workshop, workshopLocationUrl: "file:///local" },
    { ...workshop, jobId: 99 }, { ...workshop, workshopName: "x".repeat(301) }, { ...workshop, workshopPhone: "x".repeat(51) },
  ])("rejects incomplete/malformed workshop input before any write: %j", async externalWorkshop => {
    const q = quote({ externalWorkshop }); const before = row("external_maintenance_jobs", 40);
    await expect(q.run()).rejects.toMatchObject({ code: "BAD_REQUEST" }); expect(q.write).not.toHaveBeenCalled();
    expect(row("external_maintenance_jobs", 40)).toEqual(before); expect(row("purchase_order_items", 20).status).toBe("pending");
    expect(f.queries.filter(query => /^\s*(UPDATE|INSERT)/i.test(query.sql))).toEqual([]);
  });
  it("accepts omitted optional values and stores them as NULL", async () => {
    await quote({ externalWorkshop: { workshopName: "  الورشة  ", workshopPhone: "  123  ", expectedReturnDate: "2026-11-09" } }).run();
    expect(row("external_maintenance_jobs", 40)).toMatchObject({ workshopName: "الورشة", workshopPhone: "123", workshopLocationUrl: null, workshopNotes: null });
  });
  it.each([
    "UPDATE users SET isActive=0 WHERE id=7", "UPDATE users SET role='warehouse' WHERE id=7",
    "UPDATE external_maintenance_jobs SET delegateId=99", "UPDATE purchase_order_items SET delegateId=99",
  ])("checks fresh identity and both assignments under the transaction: %s", async change => {
    f.memory.exec(change); const q = quote(); await expect(q.run()).rejects.toMatchObject({ code: change.includes("delegateId") ? "CONFLICT" : "FORBIDDEN" }); expect(q.write).not.toHaveBeenCalled();
  });
  it.each([
    "UPDATE external_maintenance_jobs SET ticketId=99", "UPDATE external_maintenance_jobs SET ticketItemId=NULL", "UPDATE external_maintenance_jobs SET status='waiting_gate_entry'",
    "UPDATE external_maintenance_jobs SET gateExitApprovedAt=NULL", "UPDATE external_maintenance_jobs SET gateEntryApprovedAt='2026-11-04'",
    "UPDATE external_maintenance_jobs SET warehouseReceivedAt='2026-11-04'", "UPDATE purchase_order_items SET status='approved'",
    "UPDATE purchase_order_items SET delegateChangeRequestedAt='2026-11-04'", "UPDATE purchase_orders SET status='closed'",
    "DELETE FROM ticket_items", "UPDATE ticket_items SET maintenancePath='B'", "DELETE FROM tickets",
    "INSERT INTO purchase_order_items(id,purchaseOrderId,status,delegateId) VALUES(21,10,'pending',7)",
    "INSERT INTO external_maintenance_jobs(id,purchaseOrderId) VALUES(41,10)",
  ])("rejects invalid source/current stage without altering quote: %s", async change => {
    f.memory.exec(change); const q = quote(); await expect(q.run()).rejects.toMatchObject({ code: "CONFLICT" }); expect(q.write).not.toHaveBeenCalled();
  });
  it("rejects a cross-parent item id and missing linked job for actual Path C", async () => {
    await expect(quote({ itemId: 999 }).run()).rejects.toMatchObject({ code: "CONFLICT" });
    f.memory.exec("DELETE FROM external_maintenance_jobs");
    await expect(quote({ externalWorkshop: undefined }).run()).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("keeps the ordinary purchase writer and does not add workshop fields to its read DTO", async () => {
    f.memory.exec("DELETE FROM external_maintenance_jobs;UPDATE ticket_items SET maintenancePath='B'");
    const write = vi.fn(async (tx: any) => { expect(tx).toBeUndefined(); return "ordinary unchanged"; });
    expect(await quote({ externalWorkshop: undefined, write }).run()).toBe("ordinary unchanged");
    expect(write).toHaveBeenCalledOnce(); expect(externalWorkshopFields(null)).toEqual({});
    await expect(quote().run()).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
  it.each(["quote", "workshop", "audit"])("rolls back quote and workshop when %s fails", async failing => {
    const originalExecute = f.db.execute;
    const write = vi.fn(async (tx: any) => {
      await tx.execute(sql`UPDATE purchase_order_items SET status='estimated',estimatedUnitCost='50' WHERE id=20`);
      if (failing === "quote") throw Error("Failed quote");
    });
    f.db.execute = async (statement: any) => {
      const { sql: text } = new (await import("drizzle-orm/mysql-core")).MySqlDialect().sqlToQuery(statement);
      if (failing === "workshop" && /^UPDATE external_maintenance_jobs/.test(text.trim()) || failing === "audit" && /^INSERT INTO audit_logs/.test(text.trim())) throw Error("Failed linked save");
      return originalExecute(statement);
    };
    const before = row("external_maintenance_jobs", 40);
    await expect(quote({ write }).run()).rejects.toThrow("Failed");
    expect(row("purchase_order_items", 20).status).toBe("pending"); expect(row("external_maintenance_jobs", 40)).toEqual(before);
    expect(f.memory.prepare("SELECT COUNT(*) AS count FROM audit_logs").get()).toEqual({ count: 0 });
  });
  it("does not save a second initial quote or overwrite workshop on retry/concurrent submission", async () => {
    const first = quote(), second = quote({ externalWorkshop: { ...workshop, workshopName: "Other workshop" } });
    const results = await Promise.allSettled([first.run(), second.run()]);
    expect(results.map(result => result.status)).toEqual(["fulfilled", "rejected"]);
    expect(row("external_maintenance_jobs", 40).workshopName).toBe(workshop.workshopName);
    expect(f.memory.prepare("SELECT COUNT(*) AS count FROM audit_logs").get()).toEqual({ count: 1 });
  });
  it("preserves the existing creator returned-item authorization callback", async () => {
    f.memory.exec("UPDATE purchase_order_items SET status='needs_item_revision'");
    const authorize = vi.fn(current => expect(current.actor.id).toBe(9));
    const write = vi.fn(async (tx: any) => tx.execute(sql`UPDATE purchase_order_items SET status='pending' WHERE id=20`));
    await quote({ actor: { id: 9, role: "warehouse", isActive: 1 }, creatorResubmission: true, authorize, write }).run();
    expect(authorize).toHaveBeenCalledOnce(); expect(row("purchase_order_items", 20).status).toBe("pending");
  });
});

describe("pricing read shape and validation remain local to external jobs", () => {
  it("gives legacy external jobs empty required values and keeps exact stored text", () => {
    expect(externalWorkshopFields({ id: 40 })).toEqual({ externalWorkshopRequired: true, externalWorkshop: { workshopName: "", workshopPhone: "", expectedReturnDate: "", workshopLocationUrl: "", workshopNotes: "" } });
    expect(externalWorkshopFields(workshop)).toMatchObject({ externalWorkshopRequired: true, externalWorkshop: workshop });
    expect(externalWorkshopInput.safeParse({ ...workshop, expectedReturnDate: "2028-02-29" }).success).toBe(true);
  });
  it("loads workshop context once for repeated authorized parent ids, never once per item", async () => {
    const source = ts.createSourceFile("purchase-orders.router.ts", readFileSync("server/routers/purchase/purchase-orders.router.ts", "utf8"), ts.ScriptTarget.Latest, true);
    const fn = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "enrichExternalWorkshopPricingItems")!;
    const context = { po: { id: 10, ticketId: 30, ticketItemId: 31 }, ticket: { id: 30, maintenancePath: "C" }, ticketItem: { id: 31, ticketId: 30, maintenancePath: "C" },
      externalJob: { ...workshop, purchaseOrderId: 10, ticketId: 30, ticketItemId: 31, delegateId: 7 }, externalItemCount: 1 };
    const load = vi.fn(async () => new Map([[10, context]]));
    const enrich = vm.runInNewContext(ts.transpileModule(`(${fn.getText(source).replace(/^export /, "")})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, { db: { getPurchaseOrderTicketContextBatch: load }, externalWorkshopForPurchaseItem });
    const items = Array.from({ length: 1001 }, (_, index) => ({ id: index + 1, purchaseOrderId: 10, delegateId: 7 }));
    const result = await enrich(items);
    expect(load).toHaveBeenCalledOnce(); expect(result).toHaveLength(1001); expect(result.every((item: any) => item.externalWorkshopRequired === true)).toBe(true);
    await enrich([]); expect(load).toHaveBeenCalledOnce();
    context.externalJob.delegateId = 8;
    expect((await enrich(items)).every((item: any) => !item.externalWorkshop)).toBe(true);
  });
  it.each(["foreignDelegate", "wrongPo", "wrongTicket", "wrongItemParent", "missingTicket", "missingItem", "nonExternalPath", "severalItems", "wrongSourceItem"])("does not expose workshop details through a visible but invalid source: %s", change => {
    const item = { id: 20, purchaseOrderId: 10, delegateId: 7 };
    const context: any = { po: { id: 10, ticketId: 30, ticketItemId: 31 }, ticket: { id: 30, maintenancePath: "C" }, ticketItem: { id: 31, ticketId: 30, maintenancePath: "C" },
      externalJob: { ...workshop, purchaseOrderId: 10, ticketId: 30, ticketItemId: 31, delegateId: 7 }, externalItemCount: 1 };
    expect(externalWorkshopForPurchaseItem(item, context)).toMatchObject({ externalWorkshopRequired: true });
    if (change === "foreignDelegate") context.externalJob.delegateId = 8;
    if (change === "wrongPo") context.externalJob.purchaseOrderId = 99;
    if (change === "wrongTicket") context.externalJob.ticketId = 99;
    if (change === "wrongItemParent") context.ticketItem.ticketId = 99;
    if (change === "missingTicket") context.ticket = null;
    if (change === "missingItem") context.ticketItem = null;
    if (change === "nonExternalPath") context.ticketItem.maintenancePath = "B";
    if (change === "severalItems") context.externalItemCount = 2;
    if (change === "wrongSourceItem") context.externalJob.ticketItemId = 99;
    expect(externalWorkshopForPurchaseItem(item, context)).toEqual({});
  });
  it("bounds the actual context loader by500 distinct parents without caching a later call", async () => {
    const file = ts.createSourceFile("purchase.ts", readFileSync("server/_core/db/purchase.ts", "utf8"), ts.ScriptTarget.Latest, true);
    const fn = file.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "getPurchaseOrderTicketContextBatch")!;
    const queries: any[] = [], dialect = new MySqlDialect();
    const database: any = { select: () => { const chain: any = { from: () => chain, leftJoin: () => chain, where: async (condition: any) => {
      const query = dialect.sqlToQuery(condition); queries.push(query);
      return query.params.map(id => ({ po: { id }, ticket: null, ticketItem: null, externalJob: null, externalItemCount: 1 }));
    } }; return chain; } };
    const load = vm.runInNewContext(ts.transpileModule(`(${fn.getText(file).replace(/^export /, "")})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText,
      { getDb: async () => database, readScopeChunks, purchaseOrders, tickets, ticketItems, externalMaintenanceJobs, sql, eq, inArray });
    const ids = Array.from({ length: 1001 }, (_, index) => index + 1);
    expect((await load([...ids, ...ids])).size).toBe(1001);
    expect(queries).toHaveLength(3); expect(queries.every(query => query.params.length <= 500)).toBe(true);
    expect((await load([9999])).size).toBe(1); expect(queries).toHaveLength(4); expect(queries[3].params).toEqual([9999]);
  });
});

describe("actual pricing API handlers cannot bypass workshop validation", () => {
  function expression(name: string, declaration: boolean, path = "server/routers/purchase/purchase-orders.router.ts") {
    const file = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
    let found = "";
    const visit = (node: ts.Node) => {
      if (declaration && ts.isFunctionDeclaration(node) && node.name?.text === name) found = node.getText(file).replace(/^export /, "");
      if (!declaration && ts.isPropertyAssignment(node) && node.name.getText(file) === name) found = node.initializer.getText(file);
      ts.forEachChild(node, visit);
    }; visit(file); if (!found) throw Error(`Missing production handler ${name}`);
    return ts.transpileModule(`(${found})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  }
  function endpoints() {
    const database: any = {
      getDb: async () => f.db, withTransaction: (work: any) => f.db.transaction(work),
      getPurchaseOrderById: async (id: number) => row("purchase_orders", id),
      getPOItemById: async (id: number) => row("purchase_order_items", id),
      getPOItems: async (id: number) => f.memory.prepare("SELECT * FROM purchase_order_items WHERE purchaseOrderId=?").all(id),
      getPOPricingBatches: async () => [],
      updatePurchaseOrder: (id: number, data: any, tx?: any) => (tx || f.db).update(purchaseOrders).set(data).where(eq(purchaseOrders.id, id)),
      updatePOItem: (id: number, data: any, tx?: any) => (tx || f.db).update(purchaseOrderItems).set(data).where(eq(purchaseOrderItems.id, id)),
      createAuditLog: vi.fn(), createNotification: vi.fn(),
    };
    database.updatePOItemIfDelegateChangeUnlocked = vm.runInNewContext(expression("updatePOItemIfDelegateChangeUnlocked", true, "server/_core/db/purchase.ts"), {
      purchaseOrderItems, and, eq, isNull, getDb: async () => f.db, pricingBundlesEnabled: () => false,
      readPOItemHistorySnapshot: async (_db: any, id: number) => row("purchase_order_items", id), recordPOItemMutationHistory: vi.fn(),
    });
    const context: any = { z, TRPCError, protectedProcedure, delegateProcedure, db: database, pricingBundlesEnabled: () => false,
      externalWorkshopInput, withExternalWorkshopPricing, isDelegateRole, isRoutedPurchaseItem, assertRoutedPurchaseItemReady,
      assertPOItemAssignedToDelegate, assertCanPerformPurchaseItemReviewAction, assertCanResolveReturnedPOItem,
      summarizePurchasePricingStage, assertItemOutsidePricingBundle: async () => {},
      purchaseOrders, purchaseOrderItems, users, eq, queuePurchaseTranslation: vi.fn(), createTranslatedProcurementComment: vi.fn(), syncPathBTicketFromPurchaseOrder: vi.fn() };
    context.withPendingReviewItemWrite = vm.runInNewContext(expression("withPendingReviewItemWrite", true), context);
    context.syncIndependentPurchasePricingStage = vm.runInNewContext(expression("syncIndependentPurchasePricingStage", true), context);
    context.withPurchaseItemReturnWrite = vm.runInNewContext(expression("withPurchaseItemReturnWrite", true), context);
    return router({ purchaseOrders: router({
      estimateCost: vm.runInNewContext(expression("estimateCost", false), context),
      editItem: vm.runInNewContext(expression("editItem", false), context),
      editAndResubmitReturnedItem: vm.runInNewContext(expression("editAndResubmitReturnedItem", false), context),
    }) });
  }
  function caller(user = actor) { return endpoints().createCaller({ user, authenticatedUser: user, req: {}, res: {} } as any).purchaseOrders; }
  it("rejects a direct estimate without workshop and accepts a valid quote through the actual existing writer", async () => {
    await expect(caller().estimateCost({ purchaseOrderId: 10, items: [{ id: 20, estimatedUnitCost: "50" }] })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(row("purchase_order_items", 20).status).toBe("pending");
    await caller().estimateCost({ purchaseOrderId: 10, items: [{ id: 20, estimatedUnitCost: "50", externalWorkshop: workshop }] });
    expect(row("purchase_order_items", 20)).toMatchObject({ status: "estimated", estimatedTotalCost: "100" });
    expect(row("external_maintenance_jobs", 40).workshopPhone).toBe(workshop.workshopPhone);
  });
  it("does not permit a quantity-only recalculation or price edit to avoid required workshop fields", async () => {
    f.memory.exec("UPDATE purchase_order_items SET status='estimated',estimatedUnitCost='50',estimatedTotalCost='100'");
    const owner = { id: 8, role: "owner", isActive: 1 };
    await expect(caller(owner).editItem({ id: 20, purchaseOrderId: 10, quantity: 3 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(row("purchase_order_items", 20).quantity).toBe(2);
    await caller(owner).editItem({ id: 20, purchaseOrderId: 10, quantity: 3, externalWorkshop: workshop });
    expect(row("purchase_order_items", 20)).toMatchObject({ quantity: 3, estimatedTotalCost: "150" });
  });
  it("does not make workshop data mandatory for a nonprice note edit", async () => {
    f.memory.exec("ALTER TABLE purchase_order_items ADD COLUMN notes TEXT");
    await caller({ id: 8, role: "owner", isActive: 1 }).editItem({ id: 20, purchaseOrderId: 10, notes: "No quote change" });
    expect(row("purchase_order_items", 20).notes).toBe("No quote change");
    expect(row("external_maintenance_jobs", 40).workshopName).toBeNull();
  });
  it("requires workshop data on the existing returned-item price save as well", async () => {
    f.memory.exec("ALTER TABLE purchase_order_items ADD COLUMN itemRevisionNote TEXT;ALTER TABLE purchase_order_items ADD COLUMN itemRevisionRequestedById INTEGER;ALTER TABLE purchase_order_items ADD COLUMN itemRevisionRequestedAt TEXT;UPDATE purchase_order_items SET status='needs_item_revision'");
    const creator = { id: 9, role: "warehouse", isActive: 1 };
    const data = { id: 20, purchaseOrderId: 10, estimatedUnitCost: "55" };
    await expect(caller(creator).editAndResubmitReturnedItem(data)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(row("purchase_order_items", 20).status).toBe("needs_item_revision");
    await caller(creator).editAndResubmitReturnedItem({ ...data, externalWorkshop: workshop });
    expect(row("purchase_order_items", 20)).toMatchObject({ status: "pending", estimatedTotalCost: "110" });
    expect(row("external_maintenance_jobs", 40).expectedReturnDate).toBe(workshop.expectedReturnDate);
  });
});

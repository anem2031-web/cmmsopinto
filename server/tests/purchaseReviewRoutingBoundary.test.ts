import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { describe, expect, it, vi } from "vitest";
import * as review from "../../shared/purchase-item-review";
import { requirePurchaseReviewSelection, purchaseReviewRecipients, assertNoWholeOrderRevisionOfRoutedItems, assertRoutedPurchaseItemReady } from "../services/purchase-review-routing";
import { purchaseItemNeedTimingShape, validatePurchaseItemNeedTiming } from "../routers/purchase/item-need-timing";
import { MAX_TICKET_PURCHASE_QUANTITY } from "../../shared/maintenance-team-tickets/purchase-quantities";
import { isDelegateRole } from "../../shared/roles";

const source = readFileSync("server/routers/purchase/purchase-orders.router.ts", "utf8");
const ast = ts.createSourceFile("purchase.ts", source, ts.ScriptTarget.Latest, true);
const properties = new Map<string, ts.PropertyAssignment>();
let lockSource = "";
let resolveSource = "";
let itemHistorySource = "";
function visit(node: ts.Node) {
  if (ts.isPropertyAssignment(node) && ["create", "saveDraft", "updateDraft"].includes(node.name.getText(ast)) && node.initializer.getText(ast).includes("protectedProcedure.input")) properties.set(node.name.getText(ast), node);
  if (ts.isFunctionDeclaration(node) && node.name?.text === "withPendingReviewItemWrite") lockSource = node.getText(ast);
  if (ts.isFunctionDeclaration(node) && node.name?.text === "resolveRoutedDelegateChange") resolveSource = node.getText(ast);
  if (ts.isPropertyAssignment(node) && node.name.getText(ast) === "itemHistory" && ts.isCallExpression(node.initializer)) itemHistorySource = node.initializer.arguments[0].getText(ast);
  ts.forEachChild(node, visit);
}
visit(ast);
function evaluate(code: string, scope: any) {
  return vm.runInNewContext(ts.transpileModule(`(${code})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, { isDelegateRole, ...scope });
}
const role = "general_maintenance_manager";
const item = { id: 2, purchaseOrderId: 1, reviewRole: role, status: "pending_review", updatedAt: "2026-11-03 10:00:00", reviewedById: null, itemName: "A" };
const actor = { id: 3, role, isActive: 1 };

describe("Purchase review form operation boundaries without DB/environment imports", () => {
  it.each(["saveDraft", "updateDraft", "create"])("%s rejects a missing review route before database work", async name => {
    const db = new Proxy({}, { get: () => { throw Error("Unexpected database access before validation"); } });
    const captured = evaluate(properties.get(name)!.initializer.getText(ast), {
      protectedProcedure: { input: (schema: any) => ({ mutation: (handler: any) => ({ schema, handler }) }) },
      z, TRPCError, ...review, requirePurchaseReviewSelection, purchaseItemNeedTimingShape, validatePurchaseItemNeedTiming,
      db, MAX_TICKET_PURCHASE_QUANTITY,
    });
    await expect(captured.handler({ input: { id: 1, items: [{ itemName: "A" }] }, ctx: { user: actor } })).rejects.toThrow("اختر جهة المراجعة");
    expect(() => captured.schema.parse({ id: 1, items: [{ itemName: "A", quantity: 1, deliveryLeadDays: 4, reviewRole: "accountant" }] })).toThrow();
  });
  it("requires a selected route for every active item, while preserving terminal history", () => {
    for (const selected of review.PURCHASE_REVIEW_ROLES) expect(() => requirePurchaseReviewSelection([{ itemName: "A", reviewRole: selected }])).not.toThrow();
    expect(() => requirePurchaseReviewSelection([{ reviewRole: role }, { reviewRole: null }])).toThrow("2");
    expect(() => requirePurchaseReviewSelection([{ status: "cancelled", reviewRole: null }, { reviewRole: role }])).not.toThrow();
  });
  it("routes notices only to selected departments and existing oversight, never all managers", () => {
    const users = [...review.PURCHASE_REVIEW_ROLES.map((role, i) => ({ id: i + 10, role, isActive: 1 })),
      { id: 20, role: "owner", isActive: 1 }, { id: 21, role: "admin", isActive: 1 },
      { id: 22, role, isActive: 0 }, { id: 23, role: "maintenance_manager", isActive: 1 }];
    expect(purchaseReviewRecipients(users, [{ reviewRole: role }], 10).map(user => user.id)).toEqual([20, 21]);
    expect(purchaseReviewRecipients(users, [{ reviewRole: "senior_management" }], 99).map(user => user.id)).toEqual([12, 20, 21]);
  });
  it("contains legacy whole-request resets only for independently routed requests", () => {
    expect(() => assertNoWholeOrderRevisionOfRoutedItems([{ reviewRole: role }])).toThrow("على مستوى الأصناف");
    expect(() => assertNoWholeOrderRevisionOfRoutedItems([{ reviewRole: null }])).not.toThrow();
  });
  it("never lets a routed pending draft or an unreviewed item bypass the actual estimation/submission boundary", () => {
    const released = { reviewRole: role, status: "pending", reviewedById: 3, reviewedAt: "2026-11-03" };
    expect(() => assertRoutedPurchaseItemReady({ status: "pending_review" }, released)).not.toThrow();
    for (const status of ["draft", "closed", "rejected", "revision_needed"]) expect(() => assertRoutedPurchaseItemReady({ status }, released)).toThrow();
    for (const broken of [{ ...released, reviewedById: null }, { ...released, reviewedAt: null }, { ...released, status: "pending_review" }]) {
      expect(() => assertRoutedPurchaseItemReady({ status: "pending_estimate" }, broken)).toThrow();
    }
    expect(() => assertRoutedPurchaseItemReady({ status: "draft" }, { status: "pending" })).not.toThrow();
  });
});

describe("Item history keeps the new early-review scope at the actual RPC", () => {
  it.each([true, false])("scopes the requested history item before loading it (own=%s)", async own => {
    const getPOItemTimeline = vi.fn(async () => ({ id: 2 }));
    const scope = { assert: vi.fn(), filterItems: (_po: any, items: any[]) => own ? items : [] };
    const run = evaluate(itemHistorySource, { TRPCError, db: { getPOItemById: async () => item, getPurchaseOrderById: async () => ({ id: 1 }), getPOItemTimeline },
      createPurchaseOrderReadScope: async () => scope, localizePurchaseUserNames: async (rows: any) => rows,
    });
    const pending = run({ input: { itemId: 2 }, ctx: { user: { id: 3, role: "senior_management", isActive: 1 } } });
    if (own) { await expect(pending).resolves.toEqual({ id: 2 }); expect(getPOItemTimeline).toHaveBeenCalledOnce(); }
    else { await expect(pending).rejects.toMatchObject({ code: "FORBIDDEN" }); expect(getPOItemTimeline).not.toHaveBeenCalled(); }
  });
});

describe("Routed delegate reassignment uses fresh authority at the write boundary", () => {
  function harness(changes: any = {}) {
    const order = { id: 1, status: "pending_estimate", ...(changes.order || {}) };
    const current = { ...item, status: "pending", reviewedById: actor.id, delegateId: 9, batchId: null, delegateChangeRequestedAt: "2026-11-03", ...(changes.item || {}) };
    const currentActor = { ...actor, ...(changes.actor || {}) };
    const delegate = { id: 10, role: "delegate", isActive: 1, ...(changes.delegate || {}) };
    const tables = { purchaseOrders: { id: "po" }, purchaseOrderItems: { id: "item" }, users: { id: "user" } };
    const sql: any = () => ({}); sql.join = () => ({});
    const tx = { select: () => ({ from: (table: any) => ({ where: () => ({ for: async () => table === tables.purchaseOrders ? [order] : table === tables.purchaseOrderItems ? [current] : [currentActor, delegate] }) }) }) };
    const atomic = vi.fn(async () => true);
    const run = evaluate(resolveSource, { ...tables, sql, eq: () => ({}), TRPCError,
      assertCanResolveDelegateChange: (user: any, subject: any) => {
        if (subject.itemStatus !== "pending" || subject.batchId || !subject.delegateChangeRequestedAt || !review.canResolvePurchaseItemReviewer(user, subject)) throw Error("Denied");
      }, db: { withTransaction: async (work: any) => work(tx), resolvePOItemDelegateChangeAtomic: atomic },
    });
    return { atomic, tx, run: () => run(actor, order, item, 10) };
  }
  it("rechecks actual reviewer and recipient and passes the current review identity into the atomic writer", async () => {
    const h = harness(); expect(await h.run()).toBe(true);
    expect(h.atomic).toHaveBeenCalledWith(expect.objectContaining({ reviewRole: role, reviewedById: actor.id, newDelegateId: 10 }), h.tx);
  });
  it.each([{ actor: { isActive: 0 } }, { actor: { role: "accountant" } }, { delegate: { isActive: 0 } },
    { item: { reviewedById: 999 } }, { item: { purchaseOrderId: 2 } }, { item: { status: "approved" } }, { order: { status: "closed" } }])("denies current-state changes without writing: %j", async changes => {
    const h = harness(changes); await expect(h.run()).rejects.toThrow(); expect(h.atomic).not.toHaveBeenCalled();
  });
});

describe("Review-time edit/delete/cancel recheck at the locked write boundary", () => {
  function harness(changes: any = {}) {
    const order = { id: 1, requestedById: 8, status: "pending_estimate" };
    const currentItem = { ...item, ...(changes.item || {}) };
    const currentActor = changes.missingActor ? null : { ...actor, ...(changes.actor || {}) };
    const guard = vi.fn((action, user, po, value) => {
      if (value.purchaseOrderId !== po.id || !review.canReviewPurchaseItem(user, value) || ["draft", "closed", "rejected", "revision_needed"].includes(po.status)) throw Error("Denied");
    });
    const tables = { purchaseOrders: { id: "po" }, purchaseOrderItems: { id: "item" }, users: { id: "user" } };
    const tx = { select: () => ({ from: (table: any) => ({ where: () => {
      const rows = table === tables.purchaseOrders ? [{ ...order, ...(changes.order || {}) }] : table === tables.purchaseOrderItems ? [currentItem] : currentActor ? [currentActor] : [];
      const result: any = Promise.resolve(rows); result.for = vi.fn(async () => rows); return result;
    } }) }) };
    const withTransaction = vi.fn(async work => work(tx));
    const run = evaluate(lockSource, { ...review, ...tables, TRPCError, db: { withTransaction }, eq: () => ({}), assertCanPerformPurchaseItemReviewAction: guard });
    return { run, guard, withTransaction, order, tx };
  }
  it.each(["editItem", "deleteItem", "cancelItem"])("%s locks and rechecks the current actor, item and parent", async action => {
    const h = harness(); const write = vi.fn(async tx => tx);
    expect(await h.run(actor, h.order, item, action, write)).toBe(h.tx);
    expect(h.withTransaction).toHaveBeenCalledTimes(1); expect(h.guard).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledTimes(1);
  });
  it.each([{ item: { status: "pending", reviewedById: 3 } }, { item: { updatedAt: "changed" } }, { item: { purchaseOrderId: 9 } },
    { actor: { isActive: 0 } }, { actor: { role: "accountant" } }, { missingActor: true }, { order: { status: "closed" } }])("rejects changed authority or workflow before writing: %j", async changes => {
    const h = harness(changes); const write = vi.fn();
    await expect(h.run(actor, h.order, item, "editItem", write)).rejects.toThrow();
    expect(write).not.toHaveBeenCalled();
  });
  it("preserves the existing non-review write path", async () => {
    const h = harness(); const write = vi.fn(async () => "legacy");
    expect(await h.run(actor, h.order, { ...item, reviewRole: null }, "editItem", write)).toBe("legacy");
    expect(h.withTransaction).not.toHaveBeenCalled();
  });
});

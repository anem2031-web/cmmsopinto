import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { TRPCError } from "@trpc/server";
import { describe, expect, it, vi } from "vitest";
import { PURCHASE_REVIEW_ROLES, canReviewPurchaseItem, canResolvePurchaseItemReviewer, isPendingPurchaseItemReview, isRoutedPurchaseItem, purchaseReviewRoleSchema } from "../../shared/purchase-item-review";
import { reviewRoutedPurchaseItems, type PurchaseItemReviewPort } from "../services/purchase-item-review";

const actor = { id: 11, role: "general_maintenance_manager", isActive: 1, name: "مراجع مباشر", signatureUrl: "cmms/current-reviewer.png" };
const item = (id: number, reviewRole: string | null = actor.role, extra: any = {}) => ({
  id, purchaseOrderId: 1, itemName: `صنف ${id}`, reviewRole, status: reviewRole ? "pending_review" : "pending", reviewedById: null, reviewedAt: null,
  reviewerSignatureSnapshot: null, delegateId: null, ticketItemId: 77, catalogItemId: 9, quantity: 3, ...extra,
});
function fixture(items = [item(1), item(2, "construction_procurement_manager")], orderExtra: any = {}) {
  const state: any = { order: { id: 1, status: "pending_review", reviewedById: null, reviewedAt: null, ...orderExtra }, items,
    users: [{ ...actor }, { id: 12, role: "construction_procurement_manager", isActive: 1, signatureUrl: "cmms/second.png" }, { id: 13, role: "senior_management", isActive: 1 }, { id: 99, role: "delegate", isActive: 1 }], events: [] };
  const port: PurchaseItemReviewPort = {
    lockOrder: vi.fn(async id => state.order?.id === id ? { ...state.order } : null),
    readItems: vi.fn(async id => state.items.filter((value: any) => value.purchaseOrderId === id).map((value: any) => ({ ...value }))),
    readUsers: vi.fn(async ids => state.users.filter((user: any) => ids.includes(user.id)).map((user: any) => ({ ...user }))),
    authorize: vi.fn(),
    updateItem: vi.fn(async (before, changes) => {
      const row = state.items.find((value: any) => value.id === before.id);
      if (!row || row.status !== "pending_review" || row.reviewedById != null || row.reviewedAt != null || row.reviewRole !== before.reviewRole) return false;
      Object.assign(row, changes); return true;
    }),
    updateOrder: vi.fn(async (_id, changes) => { Object.assign(state.order, changes); }),
    audit: vi.fn(async (user, _order, decisions) => { state.events.push({ actor: user.id, decisions }); }),
    now: () => new Date("2026-11-03T10:00:00.000Z"),
  };
  const run = async (decisions: any[], current: any = actor) => {
    const before = structuredClone(state);
    try { return await reviewRoutedPurchaseItems(current, { poId: 1, items: decisions }, port); }
    catch (error) { Object.assign(state, before); throw error; }
  };
  return { state, port, run };
}
const approve = (id: number) => ({ id, action: "approve", delegateId: 99 });

describe("Routed purchase review identity and explicit role scope", () => {
  it.each(PURCHASE_REVIEW_ROLES)("allows only its pending unreviewed items for %s", role => {
    const user = { ...actor, role };
    expect(canReviewPurchaseItem(user, item(1, role))).toBe(true);
    for (const other of PURCHASE_REVIEW_ROLES.filter(value => value !== role)) expect(canReviewPurchaseItem(user, item(1, other))).toBe(false);
    expect(canReviewPurchaseItem(user, item(1, role, { status: "estimated" }))).toBe(false);
    expect(canReviewPurchaseItem(user, item(1, role, { reviewedById: 11 }))).toBe(false);
    expect(canReviewPurchaseItem(user, item(1, role, { reviewedAt: "2026-11-01" }))).toBe(false);
  });
  it.each(["delegate", "accountant", "warehouse", "operator", "technician", "it_manager", "maintenance_manager", "purchase_manager", "food_warehouse_manager", "executive_director"])("does not grant routed reviews to unrelated role %s", role => {
    expect(canReviewPurchaseItem({ ...actor, role }, item(1))).toBe(false);
    expect(canResolvePurchaseItemReviewer({ ...actor, role }, item(1, actor.role, { reviewedById: actor.id }))).toBe(false);
  });
  it.each(["owner", "admin"])("preserves %s override only for active actors and pending rows", role => {
    expect(canReviewPurchaseItem({ ...actor, role }, item(1, "senior_management"))).toBe(true);
    expect(canReviewPurchaseItem({ ...actor, role }, item(1, actor.role, { status: "purchased" }))).toBe(false);
    expect(canResolvePurchaseItemReviewer({ ...actor, role }, item(1, "senior_management", { reviewedById: 88 }))).toBe(true);
    expect(canReviewPurchaseItem({ ...actor, role, isActive: 0 }, item(1))).toBe(false);
  });
  it.each([0, false, null, undefined])("denies inactive or missing activity %s", isActive => {
    expect(canReviewPurchaseItem({ ...actor, isActive }, item(1))).toBe(false);
    expect(canResolvePurchaseItemReviewer({ ...actor, isActive }, item(1, actor.role, { reviewedById: actor.id }))).toBe(false);
  });
  it("requires exact reviewer identity as well as role for delegate changes", () => {
    const reviewed = item(1, actor.role, { status: "pending", reviewedById: actor.id });
    expect(canResolvePurchaseItemReviewer(actor, reviewed)).toBe(true);
    expect(canResolvePurchaseItemReviewer({ ...actor, id: 22 }, reviewed)).toBe(false);
    expect(canResolvePurchaseItemReviewer({ ...actor, role: "senior_management" }, reviewed)).toBe(false);
  });
  it("leaves null historical routing to existing policy and handles loading identity", () => {
    expect(isRoutedPurchaseItem(item(1, null))).toBe(false);
    expect(isPendingPurchaseItemReview(item(1, null))).toBe(false);
    expect(canReviewPurchaseItem(actor, item(1, null))).toBe(false);
    expect(canResolvePurchaseItemReviewer(actor, item(1, null, { reviewedById: 11 }))).toBe(false);
    expect(canReviewPurchaseItem(null, item(1))).toBe(false);
    expect(canResolvePurchaseItemReviewer(undefined, item(1))).toBe(false);
    expect(purchaseReviewRoleSchema.safeParse("accountant").success).toBe(false);
  });
});

describe("Transaction-bound subset review without changing unrelated workflow", () => {
  it("sends one approved item immediately and preserves another department plus all source links", async () => {
    const f = fixture(); const beforeOther = { ...f.state.items[1] };
    const result = await f.run([approve(1)]);
    expect(f.state.items[0]).toMatchObject({ status: "pending", delegateId: 99, reviewedById: 11, reviewedAt: "2026-11-03 10:00:00", reviewerSignatureSnapshot: actor.signatureUrl, ticketItemId: 77, catalogItemId: 9, purchaseOrderId: 1, quantity: 3 });
    expect(f.state.items[1]).toEqual(beforeOther);
    expect(f.state.order).toMatchObject({ status: "pending_estimate", reviewedAt: null, reviewedById: null });
    expect(result.approvedItems.map(row => row.id)).toEqual([1]);
    expect(f.port.authorize).toHaveBeenCalledWith(expect.objectContaining({ id: 11, signatureUrl: actor.signatureUrl }), expect.objectContaining({ id: 1 }), [expect.objectContaining({ id: 1 })]);
    expect(f.state.events[0].decisions).toEqual([approve(1)]);
  });
  it("supports selected multiple items and loads actor/delegates once, not per item", async () => {
    const f = fixture(Array.from({ length: 20 }, (_, i) => item(i + 1)));
    await f.run(Array.from({ length: 20 }, (_, i) => approve(i + 1)));
    expect(f.port.readUsers).toHaveBeenCalledOnce(); expect(f.port.readUsers).toHaveBeenCalledWith([11, 99]);
    expect(f.port.readItems).toHaveBeenCalledOnce();
    expect(f.state.order).toMatchObject({ status: "pending_estimate", reviewedById: 11, reviewedAt: "2026-11-03 10:00:00", reviewerSignatureSnapshot: actor.signatureUrl });
  });
  it("stamps mixed actual reviewers per item and records the header completion without inventing one reviewer", async () => {
    const f = fixture(); await f.run([approve(1)]);
    const second = f.state.users.find((user: any) => user.id === 12);
    await f.run([approve(2)], second);
    expect(f.state.items.map((row: any) => row.reviewedById)).toEqual([11, 12]);
    expect(f.state.order).toMatchObject({ status: "pending_estimate", reviewedById: null, reviewedAt: "2026-11-03 10:00:00" });
  });
  it.each(["pending_estimate", "pending_accounting", "pending_management", "approved", "partial_purchase", "purchased", "received"])("late review preserves advanced header stage %s and untouched item price/batch", async status => {
    const advanced = item(2, "construction_procurement_manager", { status: "purchased", reviewedById: 12, reviewedAt: "2026-11-01", batchId: 50, estimatedUnitCost: "900", purchaseOrderId: 1 });
    const f = fixture([item(1), advanced], { status }); await f.run([approve(1)]);
    expect(f.state.order.status).toBe(status); expect(f.state.items[1]).toEqual(advanced);
  });
  it.each(["draft", "closed", "rejected", "revision_needed"])("blocks review under unavailable header %s", async status => {
    const f = fixture(undefined, { status }); await expect(f.run([approve(1)])).rejects.toMatchObject({ code: "CONFLICT" });
    expect(f.port.updateItem).not.toHaveBeenCalled();
  });
  it.each([[], [approve(1), approve(1)], Array.from({ length: 21 }, (_, i) => approve(i + 1))].map(decisions => ({ decisions })))("rejects empty/repeated/oversized request before reads", async ({ decisions }) => {
    const f = fixture(); await expect(f.run(decisions)).rejects.toMatchObject({ code: "BAD_REQUEST" }); expect(f.port.lockOrder).not.toHaveBeenCalled();
  });
  it("denies mixed own/foreign review item IDs atomically even for a supervisor", async () => {
    const f = fixture(); await expect(f.run([approve(1), approve(2)])).rejects.toMatchObject({ code: "FORBIDDEN" }); expect(f.state.items[0].status).toBe("pending_review"); expect(f.port.updateItem).not.toHaveBeenCalled();
  });
  it("denies missing items, foreign parent membership and legacy rows", async () => {
    for (const row of [undefined, item(1, actor.role, { purchaseOrderId: 2 }), item(1, null)]) {
      const f = fixture(row ? [row] : []); await expect(f.run([approve(1)])).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
  });
  it("fresh actor state defeats deactivation/changed role and session signature spoofing", async () => {
    for (const changed of [{ isActive: 0 }, { role: "accountant" }]) {
      const f = fixture(); Object.assign(f.state.users[0], changed);
      await expect(f.run([approve(1)])).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    const f = fixture(); await f.run([approve(1)], { ...actor, signatureUrl: "cmms/spoofed.png" });
    expect(f.state.items[0].reviewerSignatureSnapshot).toBe(actor.signatureUrl);
  });
  it.each([{ id: 99, role: "delegate", isActive: 0 }, { id: 99, role: "accountant", isActive: 1 }, { id: 100, role: "delegate", isActive: 1 }])("rejects inactive/foreign-role/missing delegate %o before all writes", async delegate => {
    const f = fixture(); f.state.users = [actor, delegate];
    await expect(f.run([approve(1)])).rejects.toMatchObject({ code: "BAD_REQUEST" }); expect(f.port.updateItem).not.toHaveBeenCalled();
  });
  it("reject reason is mandatory, trimmed, and only the newly reviewed row emits a rejection", async () => {
    const f = fixture(); await expect(f.run([{ id: 1, action: "reject", rejectionReason: "  " }])).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const result = await f.run([{ id: 1, action: "reject", rejectionReason: "  غير مطلوب  " }]);
    expect(result.rejectedEvents).toEqual([{ itemId: 1, itemName: "صنف 1", reason: "غير مطلوب" }]); expect(result.allRejected).toBe(false); expect(result.hasApproved).toBe(false);
    expect(f.state.items[1].status).toBe("pending_review");
  });
  it("rejects the order only when all its actual items are terminal", async () => {
    const f = fixture([item(1), item(2, actor.role)]);
    const result = await f.run([1, 2].map(id => ({ id, action: "reject", rejectionReason: "غير مطلوب" })));
    expect(result.allRejected).toBe(true); expect(f.state.order.status).toBe("rejected");
    expect(f.state.order.reviewedById).toBe(11);
  });
  it("never replaces an existing historical reviewer/signature/completion stamp", async () => {
    const f = fixture([item(1)], { reviewedById: 88, reviewedAt: "2026-10-01", reviewerSignatureSnapshot: "cmms/original.png" });
    await f.run([approve(1)]); expect(f.state.order).toMatchObject({ reviewedById: 88, reviewedAt: "2026-10-01", reviewerSignatureSnapshot: "cmms/original.png" });
  });
  it("repeat and consecutive actors cannot reassign a decided item or reuse cached authorization", async () => {
    const f = fixture(); await f.run([approve(1)]);
    await expect(f.run([approve(1)])).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(f.run([approve(2)])).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(f.state.items[0].delegateId).toBe(99); expect(f.state.events).toHaveLength(1);
  });
  it("rolls back earlier selected item changes on a conditional race or audit failure", async () => {
    const f = fixture([item(1), item(2)]); const before = structuredClone(f.state);
    vi.mocked(f.port.updateItem).mockImplementationOnce(async (row, changes) => { Object.assign(f.state.items.find((r: any) => r.id === row.id), changes); return true; }).mockResolvedValueOnce(false);
    await expect(f.run([approve(1), approve(2)])).rejects.toMatchObject({ code: "CONFLICT" }); expect(f.state).toEqual(before);
    const g = fixture(); vi.mocked(g.port.audit).mockRejectedValueOnce(new Error("audit storage failure"));
    await expect(g.run([approve(1)])).rejects.toThrow("audit storage failure"); expect(g.state.items[0].status).toBe("pending_review");
  });
  it("propagates infrastructure and central authorization failures", async () => {
    const f = fixture(); vi.mocked(f.port.readUsers).mockRejectedValueOnce(new Error("connection lost"));
    await expect(f.run([approve(1)])).rejects.toThrow("connection lost");
    const g = fixture(); vi.mocked(g.port.authorize).mockImplementationOnce(() => { throw new TRPCError({ code: "FORBIDDEN" }); });
    await expect(g.run([approve(1)])).rejects.toMatchObject({ code: "FORBIDDEN" }); expect(g.port.updateItem).not.toHaveBeenCalled();
  });
});

describe("Historical all-items review stays on the actual legacy handler", () => {
  const source = ts.createSourceFile("approvals.router.ts", readFileSync("server/routers/purchase/approvals.router.ts", "utf8"), ts.ScriptTarget.Latest, true);
  let handler = "";
  function find(node: ts.Node) {
    if (ts.isPropertyAssignment(node) && node.name.getText(source) === "reviewItems" && ts.isCallExpression(node.initializer)) handler = node.initializer.arguments[0].getText(source);
    ts.forEachChild(node, find);
  } find(source);
  function legacyFixture() {
    const state: any = { order: { id: 1, status: "pending_review", requestedById: 2, poNumber: "PR-legacy" }, items: [item(1, null), item(2, null)] };
    const db = { getPurchaseOrderById: vi.fn(async () => state.order), getPOItems: vi.fn(async () => state.items), withTransaction: (fn: any) => fn({}),
      updatePOItemIfNotTerminal: vi.fn(async (id, changes) => { Object.assign(state.items.find((row: any) => row.id === id), changes); return true; }),
      updatePurchaseOrder: vi.fn(async (_id, changes) => { Object.assign(state.order, changes); }), createNotification: vi.fn(), createAuditLog: vi.fn() };
    const scoped = vi.fn(reviewRoutedPurchaseItems);
    const run = vm.runInNewContext(ts.transpileModule(`(${handler})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, { db, isRoutedPurchaseItem, reviewRoutedPurchaseItems: scoped,
      assertCanPerformPOAction: (_name: string, user: any, po: any) => { if (user.role !== "general_maintenance_manager" || po.status !== "pending_review") throw new TRPCError({ code: "FORBIDDEN" }); },
      notifyItemRejection: vi.fn(), syncPathBTicketFromPurchaseOrder: vi.fn(), TRPCError });
    return { state, db, scoped, run: (items: any[]) => run({ input: { poId: 1, items }, ctx: { user: actor } }) };
  }
  it("keeps the all-members requirement and existing aggregate reviewer behavior", async () => {
    const f = legacyFixture(); await expect(f.run([approve(1)])).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await f.run([approve(1), approve(2)]);
    expect(f.state.order).toMatchObject({ status: "pending_estimate", reviewedById: 11 });
    expect(f.scoped).not.toHaveBeenCalled(); expect(f.state.items.every((row: any) => row.status === "pending" && row.delegateId === 99)).toBe(true);
  });
  it("runs the actual routed handler with fresh transaction reads and conditional SQL, notifying only selected approvals", async () => {
    const state: any = { order: { id: 1, status: "pending_review", requestedById: 2, poNumber: "PR-routed" }, items: [item(1), item(2, "construction_procurement_manager")],
      users: [{ ...actor }, { id: 99, role: "delegate", isActive: 1 }], history: [], audit: [], notifications: [] };
    const table = (name: string) => new Proxy({ table: name }, { get: (target: any, key) => key === "table" ? name : `${name}.${String(key)}` });
    const purchaseOrders = table("orders"), purchaseOrderItems = table("items"), users = table("users"), auditLogs = table("audit");
    const eq = (column: any, value: any) => ({ column, op: "eq", value });
    const inArray = (column: any, value: any) => ({ column, op: "in", value });
    const isNull = (column: any) => ({ column, op: "null" });
    const and = (...conditions: any[]) => ({ conditions });
    const matches = (row: any, expression: any): boolean => expression.conditions ? expression.conditions.every((part: any) => matches(row, part))
      : expression.op === "null" ? row[expression.column.split(".")[1]] == null
      : expression.op === "in" ? expression.value.includes(row[expression.column.split(".")[1]])
      : row[expression.column.split(".")[1]] === expression.value;
    const rows = (from: any) => from.table === "orders" ? [state.order] : state[from.table];
    const userReads = vi.fn();
    const conditions: any[] = [];
    const tx = {
      select: () => ({ from(from: any) { let condition: any; const query: any = { where(value: any) { condition = value; return query; }, limit() { return query; },
        async for() { if (from === users) userReads(); return rows(from).filter((row: any) => matches(row, condition)).map((row: any) => ({ ...row })); } }; return query; } }),
      update: (from: any) => ({ set(changes: any) { return { async where(condition: any) { conditions.push(condition); const selected = rows(from).filter((row: any) => matches(row, condition)); for (const row of selected) Object.assign(row, changes); return [{ affectedRows: selected.length }]; } }; } }),
      insert: (from: any) => ({ async values(value: any) { state[from.table].push(value); return [{ insertId: 1 }]; } }),
    };
    const central = vi.fn((user: any, _po: any, selected: any[]) => { if (!selected.every(row => canReviewPurchaseItem(user, row))) throw new TRPCError({ code: "FORBIDDEN" }); });
    const db = { getPurchaseOrderById: vi.fn(async () => ({ ...state.order })), getPOItems: vi.fn(async () => state.items.map((row: any) => ({ ...row }))),
      withTransaction: async (fn: any) => { const before = structuredClone(state); try { return await fn(tx); } catch (error) { Object.assign(state, before); throw error; } },
      createPOItemHistoryEvent: vi.fn(async (event, usedTx) => { expect(usedTx).toBe(tx); state.history.push(event); }),
      updatePurchaseOrder: vi.fn(async (_id, changes, usedTx) => { expect(usedTx).toBe(tx); Object.assign(state.order, changes); }),
      createNotification: vi.fn(async value => { state.notifications.push(value); }), createAuditLog: vi.fn() };
    const oldGuard = vi.fn(() => { throw Error("Routed request must not use the legacy whole-order guard"); });
    const run = vm.runInNewContext(ts.transpileModule(`(${handler})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, {
      db, tx, isRoutedPurchaseItem, reviewRoutedPurchaseItems, assertCanPerformPOAction: oldGuard, assertCanReviewPurchaseOrderItems: central,
      and, eq, isNull, inArray, purchaseOrders, purchaseOrderItems, users, auditLogs, notifyItemRejection: vi.fn(), syncPathBTicketFromPurchaseOrder: vi.fn(), TRPCError,
    });
    const input = { poId: 1, items: [approve(1)] }; const ctx = { user: actor };
    await run({ input, ctx });
    expect(oldGuard).not.toHaveBeenCalled(); expect(central).toHaveBeenCalledOnce(); expect(userReads).toHaveBeenCalledOnce();
    expect(state.items[0]).toMatchObject({ reviewedById: 11, reviewerSignatureSnapshot: actor.signatureUrl, status: "pending", delegateId: 99 });
    expect(state.items[1].status).toBe("pending_review");
    expect(state.notifications).toHaveLength(1); expect(state.notifications[0]).toMatchObject({ userId: 99 });
    expect(state.history[0]).toMatchObject({ purchaseOrderItemId: 1, actorUserId: 11, newStatus: "pending" });
    expect(state.audit[0].newValues.itemIds).toEqual([1]);
    expect(conditions[0].conditions).toEqual(expect.arrayContaining([eq("items.id", 1), eq("items.purchaseOrderId", 1), eq("items.reviewRole", actor.role), eq("items.status", "pending_review"), isNull("items.reviewedById"), isNull("items.reviewedAt")]));
    await expect(run({ input, ctx })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(state.history).toHaveLength(1); expect(state.notifications).toHaveLength(1);
  });
});

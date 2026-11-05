import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { sql } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { readScopeChunks } from "../_core/authz/read-batch";
import { canResolvePOItemDelegateChange } from "../_core/authz/engine";
import { assertCanReviewPurchaseOrderItems, assertCanPerformPurchaseItemReviewAction, createPurchaseOrderReadScope, assertCanViewPurchaseOrder, filterVisiblePurchaseOrders } from "../_core/authz/guard";
import { computeActionablePOs } from "../routers/purchase/actionable";
import { businessRpcAllowed } from "../../shared/business-role-policy";
import { mediaAccessPort } from "../_core/authz/media-access";
import { groupReadRows } from "../_core/authz/read-batch";
import { authorizeBusinessPurchaseTranslationRows, assertBusinessTranslationAccess } from "../_core/authz/business-resources";
import * as db from "../_core/db";

vi.mock("../_core/db", () => ({
  getPurchaseItemReviewScopeRows: vi.fn(async () => []),
  getLegacyPricingBatchReadScopeRows: vi.fn(async () => []),
  getPOItemsByDelegate: vi.fn(async () => []),
  getUserIdsByRole: vi.fn(async () => []),
  getPurchaseOrderById: vi.fn(),
  getPurchaseOrdersByIds: vi.fn(),
  getFullPOItemsForPOs: vi.fn(async () => []),
}));

const actor = (role = "general_maintenance_manager", id = 7, isActive: any = 1) => ({ role, id, isActive });
const order = (id = 10, status = "pending_review") => ({ id, status, poNumber: `PR-${id}`, requestedById: 99, reviewedById: 77 });
const item = (extra: any = {}) => ({ id: 101, purchaseOrderId: 10, reviewRole: "general_maintenance_manager", status: "pending_review", reviewedById: null, reviewedAt: null, ...extra });

beforeEach(() => { vi.clearAllMocks(); vi.mocked(db.getPurchaseItemReviewScopeRows).mockResolvedValue([]); vi.mocked(db.getPurchaseOrderById).mockResolvedValue(order() as any); vi.mocked(db.getPurchaseOrdersByIds).mockResolvedValue([order()] as any); vi.mocked(db.getFullPOItemsForPOs).mockResolvedValue([]); });

describe("Routed purchase item write boundaries", () => {
  it.each(["general_maintenance_manager", "construction_procurement_manager", "senior_management"])("allows only %s on its selected pending items, independently of the mixed header", role => {
    expect(() => assertCanReviewPurchaseOrderItems(actor(role), order(10, "pending_accounting"), [item({ reviewRole: role })])).not.toThrow();
    for (const action of ["editItem", "deleteItem", "cancelItem"] as const) {
      expect(() => assertCanPerformPurchaseItemReviewAction(action, actor(role), order(10, "pending_estimate"), item({ reviewRole: role }))).not.toThrow();
    }
  });
  it.each(["maintenance_manager", "general_maintenance_manager", "construction_procurement_manager", "senior_management", "accountant", "delegate", "warehouse", "purchase_manager", "food_warehouse_manager", "executive_director", "technician"])("denies %s on another route, including direct edit/delete/cancel", role => {
    const own = role === "general_maintenance_manager" ? "construction_procurement_manager" : "general_maintenance_manager";
    expect(() => assertCanReviewPurchaseOrderItems(actor(role), order(), [item({ reviewRole: own })])).toThrow();
    for (const action of ["editItem", "deleteItem", "cancelItem"] as const) expect(() => assertCanPerformPurchaseItemReviewAction(action, actor(role), order(), item({ reviewRole: own }))).toThrow();
  });
  it.each(["owner", "admin"])("keeps active %s as the explicit routed-review bypass", role => {
    expect(() => assertCanReviewPurchaseOrderItems(actor(role), order(), [item()])).not.toThrow();
    for (const action of ["editItem", "deleteItem", "cancelItem"] as const) expect(() => assertCanPerformPurchaseItemReviewAction(action, actor(role, 7, 0), order(), item())).toThrow();
  });
  it.each(["draft", "revision_needed", "closed", "rejected"])("denies a pending routed write under terminal/blocked parent %s", status => {
    expect(() => assertCanReviewPurchaseOrderItems(actor(), order(10, status), [item()])).toThrow();
    for (const role of ["general_maintenance_manager", "admin", "owner"]) {
      for (const action of ["editItem", "deleteItem", "cancelItem"] as const) expect(() => assertCanPerformPurchaseItemReviewAction(action, actor(role), order(10, status), item())).toThrow();
    }
  });
  it("rejects foreign parent, empty selections, inactive/missing active actor and already-reviewed rows", () => {
    for (const selected of [[], [item({ purchaseOrderId: 11 })], [item({ reviewedById: 7 })], [item({ reviewedAt: "2026-11-03" })], [item({ status: "pending" })]]) {
      expect(() => assertCanReviewPurchaseOrderItems(actor(), order(), selected)).toThrow();
    }
    for (const isActive of [0, false, null, undefined]) expect(() => assertCanReviewPurchaseOrderItems({ id: 7, role: "general_maintenance_manager", isActive }, order(), [item()])).toThrow();
    expect(() => assertCanReviewPurchaseOrderItems(actor(), order(), [item(), item({ id: 102, reviewRole: "senior_management" })])).toThrow();
  });
  it("does not let a sent item inherit an old header review permission", () => {
    for (const action of ["editItem", "deleteItem", "cancelItem"] as const) expect(() => assertCanPerformPurchaseItemReviewAction(action, actor(), order(), item({ status: "pending", reviewedById: 7 }))).toThrow();
    expect(() => assertCanPerformPurchaseItemReviewAction("cancelItem", actor("senior_management"), order(10, "pending_management"), item({ status: "estimated", reviewedById: 7 }))).not.toThrow();
  });
  it("keeps creator-returned item resolution and historical unrouted reviews", () => {
    expect(() => assertCanPerformPurchaseItemReviewAction("editItem", actor("purchase_requester", 99), order(10, "pending_estimate"), item({ status: "needs_item_revision", reviewedById: 7 }))).not.toThrow();
    for (const role of ["maintenance_manager", "general_maintenance_manager", "construction_procurement_manager", "purchase_manager", "food_warehouse_manager", "owner", "admin"]) expect(() => assertCanReviewPurchaseOrderItems({ id: 7, role }, order(), [item({ reviewRole: null })])).not.toThrow();
    expect(() => assertCanReviewPurchaseOrderItems(actor("senior_management"), order(), [item({ reviewRole: null })])).toThrow();
  });
  it("resolves a routed delegate-change request for the exact active item reviewer", () => {
    const subject = { ...item({ status: "pending", reviewedById: 7 }), delegateId: 55, itemStatus: "pending", batchId: null, delegateChangeRequestedAt: "2026-11-03" };
    expect(canResolvePOItemDelegateChange({ role: actor().role, userId: 7, isActive: 1 }, subject)).toBe(true);
    for (const change of [{ userId: 8 }, { role: "construction_procurement_manager" }, { isActive: 0 }]) expect(canResolvePOItemDelegateChange({ role: actor().role, userId: 7, isActive: 1, ...change }, subject)).toBe(false);
    expect(canResolvePOItemDelegateChange({ role: "senior_management", userId: 7, isActive: 1 }, { ...subject, reviewRole: "senior_management" })).toBe(true);
    expect(canResolvePOItemDelegateChange({ role: "senior_management", userId: 7, isActive: 1 }, { ...subject, reviewRole: null })).toBe(false);
  });
});

describe("Fresh RPC-scoped early senior review reads", () => {
  it("opens only assigned parent/items, while preserving normal management and creator reads", async () => {
    vi.mocked(db.getPurchaseItemReviewScopeRows).mockResolvedValue([item({ reviewRole: "senior_management" })]);
    const scope = await createPurchaseOrderReadScope(actor("senior_management"), [order(), order(11), order(12, "pending_management")]);
    expect(scope.filter([order(), order(11), order(12, "pending_management")]).map(v => v.id)).toEqual([10, 12]);
    expect(scope.isRoutedReviewOnly(order())).toBe(true);
    expect(scope.isRoutedReviewOnly(order(12, "pending_management"))).toBe(false);
    expect(scope.filterItems(order(), [item(), item({ id: 102 }), item({ id: 101, purchaseOrderId: 11 })]).map(v => v.id)).toEqual([101]);
    expect(scope.filterItems(order(12, "pending_management"), [item(), item({ id: 102 })])).toHaveLength(2);
    expect(() => scope.assert(order(11))).toThrow();
    expect(() => scope.assert(order(10, "draft"))).toThrow();
    const owned = { ...order(13), requestedById: 7 };
    expect(scope.filterItems(owned, [item(), item({ id: 102 })])).toHaveLength(2);
  });
  it("does not reuse scopes across actors/requests and propagates infrastructure failures", async () => {
    vi.mocked(db.getPurchaseItemReviewScopeRows).mockResolvedValueOnce([item({ reviewRole: "senior_management" })]).mockResolvedValueOnce([]);
    await expect(assertCanViewPurchaseOrder(actor("senior_management"), order())).resolves.toBeUndefined();
    await expect(assertCanViewPurchaseOrder(actor("senior_management", 8), order())).rejects.toThrow();
    expect(db.getPurchaseItemReviewScopeRows).toHaveBeenCalledTimes(2);
    vi.mocked(db.getPurchaseItemReviewScopeRows).mockRejectedValueOnce(Error("infrastructure failed"));
    await expect(filterVisiblePurchaseOrders(actor("senior_management"), [order()])).rejects.toThrow("infrastructure failed");
  });
  it("gives inactive reviewers no early scope and leaves unrelated role reads unchanged", async () => {
    expect(await filterVisiblePurchaseOrders(actor("senior_management", 7, 0), [order()])).toEqual([]);
    expect(db.getPurchaseItemReviewScopeRows).not.toHaveBeenCalled();
    expect(await filterVisiblePurchaseOrders(actor("general_maintenance_manager"), [order(), order(11)])).toHaveLength(2);
    expect(await filterVisiblePurchaseOrders(actor("accountant"), [order(), order(11, "pending_accounting")])).toHaveLength(1);
  });
  it("rechecks the actual media item and parent, not merely a readable mixed order", async () => {
    vi.mocked(db.getPurchaseItemReviewScopeRows).mockResolvedValue([item({ reviewRole: "senior_management" })]);
    await expect(mediaAccessPort.authorize(actor("senior_management"), { kind: "po", id: 101, parentId: 10 })).resolves.toBeUndefined();
    await expect(mediaAccessPort.authorize(actor("senior_management"), { kind: "po", id: 102, parentId: 10 })).rejects.toThrow();
    vi.mocked(db.getPurchaseOrderById).mockResolvedValueOnce(null);
    await expect(mediaAccessPort.authorize(actor("senior_management"), { kind: "po", id: 101, parentId: 404 })).rejects.toThrow();
    vi.mocked(db.getPurchaseItemReviewScopeRows).mockResolvedValueOnce([]);
    await expect(mediaAccessPort.authorize(actor("senior_management"), { kind: "po", id: 101, parentId: 10 })).rejects.toThrow();
    vi.mocked(db.getPurchaseOrderById).mockResolvedValueOnce(order(10, "pending_management") as any);
    await expect(mediaAccessPort.authorize(actor("senior_management"), { kind: "po", id: 102, parentId: 10 })).resolves.toBeUndefined();
  });
  it("filters actual PB details through one read snapshot and one batched enrichment", async () => {
    const file = "server/routers/purchase/purchase-packages.router.ts";
    const ast = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
    const declaration = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "getVisiblePackageOrdersWithItems")!;
    const parents = [order(), order(11), order(12, "pending_management")];
    const rows = [item(), item({ id: 102 }), item({ id: 103, purchaseOrderId: 11 }), item({ id: 104, purchaseOrderId: 12 })];
    vi.mocked(db.getPurchaseItemReviewScopeRows).mockResolvedValue([item({ reviewRole: "senior_management" })]);
    const reader = vi.fn(async (_ids: number[]) => rows);
    const code = ts.transpileModule(`(${declaration.getText(ast)})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
    const run = vm.runInNewContext(code, { db: { getPurchaseOrdersByPackage: async () => parents, getFullPOItemsForPOs: reader }, createPurchaseOrderReadScope, groupReadRows });
    const result = await run(actor("senior_management"), 55);
    expect(result.map((po: any) => [po.id, po.items.map((row: any) => row.id)])).toEqual([[10, [101]], [12, [104]]]);
    expect(reader.mock.calls).toEqual([[[10, 12]]]);
    expect(db.getPurchaseItemReviewScopeRows).toHaveBeenCalledTimes(1);
  });
  it("checks routed item/comment/history translation IDs rather than only their shared parent", async () => {
    vi.mocked(db.getPurchaseItemReviewScopeRows).mockResolvedValue([item({ reviewRole: "senior_management" })]);
    const user = actor("senior_management");
    for (const [type, allowed, forbidden] of [
      ["PO_ITEM", { id: 101, parentId: 10 }, { id: 102, parentId: 10 }],
      ["PO_COMMENT", { id: 21, parentId: 10, purchaseOrderItemId: 101 }, { id: 22, parentId: 10, purchaseOrderItemId: 102 }],
      ["PO_ITEM_HISTORY", { id: 31, parentId: 10, purchaseOrderItemId: 101 }, { id: 32, parentId: 10, purchaseOrderItemId: 102 }],
    ] as const) {
      await expect(authorizeBusinessPurchaseTranslationRows(user, type, [allowed])).resolves.toBeUndefined();
      await expect(authorizeBusinessPurchaseTranslationRows(user, type, [allowed, forbidden])).rejects.toThrow();
    }
    await expect(authorizeBusinessPurchaseTranslationRows(user, "PO_COMMENT", [{ id: 21, parentId: 10, purchaseOrderItemId: null }])).resolves.toBeUndefined();
    vi.mocked(db.getPurchaseOrdersByIds).mockResolvedValueOnce([]);
    await expect(authorizeBusinessPurchaseTranslationRows(user, "PO_ITEM", [{ id: 101, parentId: 404 }])).rejects.toThrow();
  });
  it("does not let an aggregate translation conceal foreign lines; normal financial reads retain parity", async () => {
    vi.mocked(db.getPurchaseItemReviewScopeRows).mockResolvedValue([item({ reviewRole: "senior_management", status: "estimated", reviewedById: 7 })]);
    vi.mocked(db.getFullPOItemsForPOs).mockResolvedValue([item({ batchId: 55 }), item({ id: 102, batchId: 55 })] as any);
    await expect(authorizeBusinessPurchaseTranslationRows(actor("senior_management"), "PO_BATCH", [{ id: 55, parentId: 10 }])).rejects.toThrow();
    vi.mocked(db.getFullPOItemsForPOs).mockResolvedValueOnce([item({ batchId: 55 })] as any);
    await expect(authorizeBusinessPurchaseTranslationRows(actor("senior_management"), "PO_BATCH", [{ id: 55, parentId: 10 }])).resolves.toBeUndefined();
    vi.mocked(db.getPurchaseOrdersByIds).mockResolvedValueOnce([order(10, "pending_management")] as any);
    vi.mocked(db.getFullPOItemsForPOs).mockClear();
    await expect(authorizeBusinessPurchaseTranslationRows(actor("senior_management"), "PO_ITEM", [{ id: 102, parentId: 10 }])).resolves.toBeUndefined();
    expect(db.getFullPOItemsForPOs).not.toHaveBeenCalled();
  });
  it("dispatches exact-entity checks at the translation boundary before any text read", async () => {
    vi.mocked(db.getPurchaseItemReviewScopeRows).mockResolvedValue([item({ reviewRole: "senior_management" })]);
    const source = { parents: vi.fn(async () => [{ id: 102, parentId: 10 }]), authorize: vi.fn(), authorizeRows: authorizeBusinessPurchaseTranslationRows };
    await expect(assertBusinessTranslationAccess(actor("senior_management"), { entityType: "PO_ITEM", entityIds: [102] }, "batch", source)).rejects.toThrow();
    expect(source.authorize).not.toHaveBeenCalled();
    vi.mocked(db.getPurchaseOrdersByIds).mockRejectedValueOnce(Error("parent read failed"));
    await expect(authorizeBusinessPurchaseTranslationRows(actor("senior_management"), "PO_ITEM", [{ id: 101, parentId: 10 }])).rejects.toThrow("parent read failed");
  });
});

describe("Actual slim loader and actionable gates", () => {
  it("loads distinct parents in bounded chunks, with explicit role/identity query scope", async () => {
    const file = "server/_core/db/purchase-read-lists.ts";
    const ast = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
    const declaration = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "getPurchaseItemReviewScopeRows")!;
    const queries: any[] = [];
    const source = ts.transpileModule(`(${declaration.getText(ast).replace(/^export /, "")})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
    const dialect = new MySqlDialect();
    const connection = vi.fn(async () => ({ execute: async (q: any) => { queries.push(dialect.sqlToQuery(q)); return [[], []]; } }));
    const load = vm.runInNewContext(source, { connection, readScopeChunks, sql });
    const ids = [...Array.from({ length: 1201 }, (_, i) => i + 1), 1, 500, 1001];
    await load(actor("senior_management"), ids);
    expect(queries).toHaveLength(3);
    expect(queries.map(q => q.params.length - 2)).toEqual([500, 500, 201]);
    for (const q of queries) { expect(q.params.slice(0, 2)).toEqual(["senior_management", 7]); expect(q.sql).toContain("reviewedById=?"); }
    await load(actor("accountant"), ids);
    await load(actor("senior_management"), []);
    expect(queries).toHaveLength(3);
  });
  it("shows only assigned routed review items under mixed headers, keeps legacy review and actual resolver", () => {
    const own = actor();
    const mixed = [item(), item({ id: 102, reviewRole: "senior_management" })];
    expect(computeActionablePOs(own, [order(10, "pending_accounting")], mixed)[0].reason).toContain("1 صنف");
    expect(computeActionablePOs(own, [order(10, "pending_management")], mixed)[0].reviewAction).toBe("review");
    expect(computeActionablePOs(actor("maintenance_manager"), [order()], mixed)).toEqual([]);
    expect(computeActionablePOs(actor("maintenance_manager"), [order()], [item({ reviewRole: null })])).toHaveLength(1);
    const followup = item({ status: "pending", reviewedById: 7, delegateChangeRequestedAt: "2026-11-03" });
    expect(computeActionablePOs(own, [order(10, "pending_estimate")], [followup])[0].actionLabel).toBe("اختيار مندوب");
    expect(computeActionablePOs(own, [order(10, "pending_management")], [followup])[0].reviewAction).toBe("delegate_change");
    expect(computeActionablePOs(actor(own.role, 8), [order(10, "pending_estimate")], [followup])).toEqual([]);
  });
  it("adds exact review and resolver capabilities to senior management, never executive/accountant", () => {
    for (const rpc of ["purchaseOrders.reviewItems", "purchaseOrders.resolveDelegateChange"]) {
      expect(businessRpcAllowed({ id: 7, role: "senior_management", isActive: 1 }, "mutation", rpc)).toBe(true);
      for (const role of ["executive_director", "accountant", "warehouse"]) expect(businessRpcAllowed({ id: 7, role, isActive: 1 }, "mutation", rpc)).toBe(false);
    }
  });
});

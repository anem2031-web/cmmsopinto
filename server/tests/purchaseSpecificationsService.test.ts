import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import { loadSpecificationParentScopes, PurchaseSpecificationsService, receiptSpecificationFields } from "../services/purchase-specifications";
import { specificationFixture, seedSpecificationReceipt, specificationPeople as people } from "./fixtures/purchaseSpecificationsSeed";
import { assertPOVisible, isPOVisible } from "../_core/authz/engine";
import { PO_STATUS } from "../_core/authz/policy";

let f: ReturnType<typeof specificationFixture>;
beforeEach(() => { f = specificationFixture(); });
afterEach(() => f.close());
const decision = (id = 1, revision = 0, value: "approved" | "rejected" = "approved", notes?: string) => ({ id, revision, decision: value, notes });

describe("Specification receipt registration, without historical changes", () => {
  const registration = (source: ReturnType<typeof seedSpecificationReceipt>) => ({ purchaseOrderItemId: source.itemId, purchaseOrderId: source.orderId, receiptId: source.receiptId, receiptItemId: source.receiptItemId, inventoryId: source.inventoryId, issueQuantity: source.quantity, createdById: 32 });
  it("marks only a confirmed construction receipt pending and leaves the receipt/stock/source unchanged", async () => {
    const source = seedSpecificationReceipt(f, { status: null });
    const before = f.snapshot(), lots = f.memory.prepare("SELECT * FROM inventory_lots").all();
    expect(await receiptSpecificationFields(f.db, registration(source))).toEqual({ specificationStatus: "pending" });
    expect(f.snapshot()).toEqual(before);
    expect(f.memory.prepare("SELECT * FROM inventory_lots").all()).toEqual(lots);
  });
  it("does not query or inspect independent receipts without a purchase item", async () => {
    expect(await receiptSpecificationFields(f.db, { purchaseOrderItemId: null, receiptId: 100, receiptItemId: 200, inventoryId: 300, createdById: 32, issueQuantity: 3 })).toEqual({ specificationStatus: null });
    expect(f.queries).toHaveLength(0);
  });
  it.each([null, "general_maintenance_manager", "senior_management"])("keeps nonconstruction route %s outside the hold", async reviewRole => {
    const source = seedSpecificationReceipt(f, { reviewRole, status: null });
    expect(await receiptSpecificationFields(f.db, registration(source))).toEqual({ specificationStatus: null });
    expect(f.queries).toHaveLength(1);
  });
  it.each(["order", "item", "receipt", "receiptItem", "inventory", "draft", "zero"])("denies a mismatched or unconfirmed %s source", async kind => {
    const source = seedSpecificationReceipt(f, { receiptStatus: kind === "draft" ? "draft" : "confirmed" });
    const input = registration(source);
    if (kind === "order") input.purchaseOrderId = 999;
    if (kind === "item") input.purchaseOrderItemId = 999;
    if (kind === "receipt") input.receiptId = 999;
    if (kind === "receiptItem") input.receiptItemId = 999;
    if (kind === "inventory") input.inventoryId = 999;
    if (kind === "zero") input.issueQuantity = 0;
    await expect(receiptSpecificationFields(f.db, input)).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

describe("Specification read lists and bounded parent authorization", () => {
  it("returns the exact received lot/source and photos, never unrelated old or nonconstruction stock", async () => {
    seedSpecificationReceipt(f);
    seedSpecificationReceipt(f, { id: 2, status: null });
    seedSpecificationReceipt(f, { id: 3, reviewRole: "general_maintenance_manager" });
    seedSpecificationReceipt(f, { id: 4, receiptStatus: "draft" });
    seedSpecificationReceipt(f, { id: 5, remaining: 0 });
    const result = await f.service.list(people.construction, {});
    expect(result).toMatchObject({ total: 1, page: 1, pageSize: 20 });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ id: 1, lotId: 1, revision: 0, status: "pending", purchaseOrderId: 10, purchaseOrderItemId: 1001, receiptId: 3001, receiptItemId: 4001, inventoryId: 2001, quantity: 6, remainingReturnableQuantity: 6, unit: "قطعة", purchasedPhotoUrl: "/purchase.jpg", invoicePhotoUrl: "/invoice.jpg", warehousePhotoUrl: "/received.jpg" });
    expect(f.readGuard).toHaveBeenCalledTimes(1);
  });
  it("applies search and SQL pagination before enriching the displayed parents", async () => {
    for (let id = 1; id <= 125; id++) seedSpecificationReceipt(f, { id, orderId: id + 100, name: `صنف ${id}` });
    const result = await f.service.list(people.construction, { page: 3, pageSize: 20 });
    expect(result.total).toBe(125);
    expect(result.rows.map(row => row.id)).toEqual(Array.from({ length: 20 }, (_, index) => 85 - index));
    const [, selectedParents] = f.readGuard.mock.calls[0];
    expect(selectedParents).toHaveLength(20);
    expect(f.queries).toHaveLength(4);
    expect(f.queries[2].sql).toMatch(/LIMIT \? OFFSET \?/);
    expect(f.queries[2].params.slice(-2)).toEqual([20, 40]);
    expect((await f.service.list(people.construction, { search: "صنف 125" })).rows.map(row => row.id)).toEqual([125]);
  });
  it("checks mixed own/foreign parents independently and refreshes scope for the next request", async () => {
    seedSpecificationReceipt(f, { id: 1, orderId: 10 });
    seedSpecificationReceipt(f, { id: 2, orderId: 20 });
    f.scope.set(31, new Set([10]));
    expect((await f.service.list(people.construction, {})).rows.map(row => row.id)).toEqual([1]);
    f.scope.set(31, new Set([20]));
    expect((await f.service.list(people.construction, {})).rows.map(row => row.id)).toEqual([2]);
    expect(f.readGuard).toHaveBeenCalledTimes(2);
    f.scope.set(31, new Set());
    await expect(f.service.decide(people.construction, decision(1))).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(f.get("inventory_lots", 1).specificationStatus).toBe("pending");
  });
  it("excludes broken parent and receipt-item ties and denies a direct decision on those lots", async () => {
    seedSpecificationReceipt(f, { id: 1 }); seedSpecificationReceipt(f, { id: 2, orderId: 20 });
    f.memory.exec("DELETE FROM purchase_orders WHERE id=10; UPDATE inventory_lots SET receiptItemId=999 WHERE id=2");
    expect((await f.service.list(people.construction, {})).rows).toEqual([]);
    await expect(f.service.decide(people.construction, decision(1))).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(f.service.decide(people.construction, decision(2))).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(f.memory.prepare("SELECT * FROM audit_logs").all()).toEqual([]);
  });
  it("loads 1,101 unique parent IDs in three bounded chunks despite 2,202 displayed members", async () => {
    const members: any[] = [];
    for (let id = 1; id <= 1101; id++) {
      f.insert("purchase_orders", { id, poNumber: `PR-${id}` });
      members.push({ purchaseOrderId: id }, { purchaseOrderId: id });
    }
    const authorize = await loadSpecificationParentScopes(f.db, people.construction, members, f.ports.readGuard);
    members.forEach(authorize);
    expect(f.queries).toHaveLength(3);
    expect(f.queries.map(row => row.params.length)).toEqual([500, 500, 101]);
    expect(f.readGuard).toHaveBeenCalledTimes(1);
    expect(f.readGuard.mock.calls[0][1]).toHaveLength(1101);
    expect(() => authorize({ purchaseOrderId: 9999 })).toThrow();
  });
  it("propagates infrastructure failures from both the database and scope loader", async () => {
    seedSpecificationReceipt(f);
    const failure = Error("scope infrastructure unavailable");
    f.readGuard.mockRejectedValueOnce(failure);
    await expect(f.service.list(people.construction, {})).rejects.toBe(failure);
    const bad = new PurchaseSpecificationsService({ database: async () => { throw failure; }, readGuard: f.readGuard });
    await expect(bad.list(people.construction, {})).rejects.toBe(failure);
    f.readGuard.mockResolvedValueOnce(() => { throw failure; });
    await expect(f.service.list(people.construction, {})).rejects.toBe(failure);
  });
  it("matches the existing warehouse visibility policy before total/page selection, including its own earlier-stage orders", async () => {
    const actor = people.warehouse, context = { role: actor.role, userId: actor.id };
    const sources: Array<{ id: number; order: any }> = [];
    for (const [index, status] of Object.values(PO_STATUS).entries()) {
      for (const own of [false, true]) {
        const id = index * 2 + Number(own) + 1, orderId = id + 100;
        seedSpecificationReceipt(f, { id, orderId, status: "rejected", requestedById: own ? actor.id : 999 });
        f.memory.prepare("UPDATE purchase_orders SET status=? WHERE id=?").run(status, orderId);
        sources.push({ id, order: f.get("purchase_orders", orderId) });
      }
    }
    const realGuard = vi.fn(async (user: any) => (order: any) => assertPOVisible({ role: user.role, userId: user.id }, order));
    const service = new PurchaseSpecificationsService({ database: async () => f.db, readGuard: realGuard });
    const expected = sources.filter(source => isPOVisible(context, source.order)).sort((a, b) => b.id - a.id);
    const results: number[] = [];
    for (let page = 1; page <= Math.ceil(expected.length / 3); page++) {
      const result = await service.rejectedReturns(actor, { page, pageSize: 3 });
      expect(result.total).toBe(expected.length);
      expect(result.rows.map(row => row.id)).toEqual(expected.slice((page - 1) * 3, page * 3).map(source => source.id));
      results.push(...result.rows.map(row => row.id));
    }
    expect(results).toEqual(expected.map(source => source.id));
    const ownDraft = sources.find(source => source.order.status === "draft" && source.order.requestedById === actor.id)!;
    const foreignDraft = sources.find(source => source.order.status === "draft" && source.order.requestedById !== actor.id)!;
    expect(results).toContain(ownDraft.id);
    expect(results).not.toContain(foreignDraft.id);
    await expect(service.rejectedReturnSource(actor, foreignDraft.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await service.rejectedReturnSource(actor, ownDraft.id)).toMatchObject({ id: ownDraft.id });
  });
});

describe("Decision authority, atomicity and source preservation", () => {
  it.each([people.construction, people.admin, people.owner])("records the actual $role approval actor with no stock/financial mutation", async actor => {
    seedSpecificationReceipt(f);
    const before = f.snapshot();
    expect(await f.service.decide(actor, decision(1, 0, "approved", "  مطابق  "))).toEqual({ id: 1, status: "approved", revision: 1 });
    expect(f.get("inventory_lots", 1)).toMatchObject({ specificationStatus: "approved", specificationRevision: 1, specificationReviewedById: actor.id, specificationNotes: "مطابق", originalQuantity: 6, remainingQuantity: 6 });
    const audit = f.memory.prepare("SELECT * FROM audit_logs").get() as any;
    expect(audit).toMatchObject({ userId: actor.id, entityType: "inventory_lot", entityId: 1, action: "specification_approved" });
    expect(JSON.parse(audit.newValues)).toMatchObject({ purchaseOrderId: 10, purchaseOrderItemId: 1001, receiptId: 3001, receiptItemId: 4001, quantity: 6, unit: "قطعة" });
    expect(f.snapshot()).toEqual(before);
  });
  it("allows rejection without a note, preserves the received quantity and does not create a return", async () => {
    seedSpecificationReceipt(f);
    const before = f.snapshot();
    await f.service.decide(people.construction, decision(1, 0, "rejected", "  "));
    expect(f.get("inventory_lots", 1)).toMatchObject({ specificationStatus: "rejected", specificationNotes: null, remainingQuantity: 6 });
    expect(f.snapshot()).toEqual(before);
    expect((await f.service.rejectedReturns(people.warehouse, {})).rows.map(row => row.id)).toEqual([1]);
  });
  it.each([people.warehouse.role, "accountant", "senior_management", "delegate", "technician", "it_manager", "general_maintenance_manager", "purchase_manager"])("denies direct %s decisions", async role => {
    seedSpecificationReceipt(f);
    await expect(f.service.decide({ id: 80, role, isActive: 1 }, decision())).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(f.queries).toHaveLength(0);
  });
  it.each(["inactive", "role_change", "missing"])("rechecks the %s actor at write time after a successful list", async change => {
    seedSpecificationReceipt(f); await f.service.list(people.construction, {});
    if (change === "inactive") f.memory.exec("UPDATE users SET isActive=0 WHERE id=31");
    if (change === "role_change") f.memory.exec("UPDATE users SET role='warehouse' WHERE id=31");
    if (change === "missing") f.memory.exec("DELETE FROM users WHERE id=31");
    await expect(f.service.decide(people.construction, decision())).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(f.get("inventory_lots", 1).specificationStatus).toBe("pending");
  });
  it("does not reuse the first actor's scope for a subsequent actor", async () => {
    seedSpecificationReceipt(f); f.scope.set(31, new Set([10])); f.scope.set(33, new Set());
    await f.service.list(people.construction, {});
    await expect(f.service.decide(people.admin, decision())).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(f.get("inventory_lots", 1).specificationStatus).toBe("pending");
  });
  it.each(["approved", "rejected"] as const)("rejects replay, stale revision and reversal after %s", async first => {
    seedSpecificationReceipt(f);
    await f.service.decide(people.construction, decision(1, 0, first));
    for (const next of [decision(1, 0, first), decision(1, 1, first === "approved" ? "rejected" : "approved")]) {
      await expect(f.service.decide(people.construction, next)).rejects.toMatchObject({ code: "CONFLICT" });
    }
    expect(f.memory.prepare("SELECT * FROM audit_logs").all()).toHaveLength(1);
  });
  it("rejects stale pending revision and serializes competing decisions into one decision and audit", async () => {
    seedSpecificationReceipt(f);
    await expect(f.service.decide(people.construction, decision(1, 9))).rejects.toMatchObject({ code: "CONFLICT" });
    const outcomes = await Promise.allSettled([f.service.decide(people.construction, decision()), f.service.decide(people.admin, decision(1, 0, "rejected"))]);
    expect(outcomes.map(row => row.status)).toEqual(["fulfilled", "rejected"]);
    expect(f.memory.prepare("SELECT * FROM audit_logs").all()).toHaveLength(1);
  });
  it("rolls the decision back if audit persistence fails", async () => {
    seedSpecificationReceipt(f);
    f.memory.exec("CREATE TRIGGER audit_failure BEFORE INSERT ON audit_logs BEGIN SELECT RAISE(ABORT,'audit failure'); END");
    await expect(f.service.decide(people.construction, decision())).rejects.toThrow("audit failure");
    expect(f.get("inventory_lots", 1)).toMatchObject({ specificationStatus: "pending", specificationRevision: 0, specificationReviewedById: null });
  });
  it.each([null, "general_maintenance_manager", "senior_management"])("refuses a forged pending lot on route %s", async reviewRole => {
    seedSpecificationReceipt(f, { reviewRole });
    await expect(f.service.decide(people.construction, decision())).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("Rejected source queue for the existing supplier return", () => {
  it.each([people.warehouse, people.admin, people.owner])("allows $role to resolve the exact remaining receipt source", async actor => {
    seedSpecificationReceipt(f, { status: "rejected", remaining: 4 });
    expect(await f.service.rejectedReturnSource(actor, 1)).toMatchObject({ lotId: 1, inventoryId: 2001, receiptId: 3001, receiptItemId: 4001, purchaseOrderItemId: 1001, remainingReturnableQuantity: 4 });
  });
  it("uses current remaining physical stock; a fully returned lot leaves the queue without changing its decision", async () => {
    seedSpecificationReceipt(f, { status: "rejected", remaining: 4 });
    expect((await f.service.rejectedReturns(people.warehouse, {})).rows).toHaveLength(1);
    f.memory.exec("UPDATE inventory_lot_balances SET quantity=0 WHERE lotId=1; UPDATE inventory_lots SET remainingQuantity=0 WHERE id=1");
    expect((await f.service.rejectedReturns(people.warehouse, {})).rows).toEqual([]);
    await expect(f.service.rejectedReturnSource(people.warehouse, 1)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(f.get("inventory_lots", 1).specificationStatus).toBe("rejected");
  });
  it.each(["pending", "approved", null])("never offers the %s lot to the rejected-only queue", async status => {
    seedSpecificationReceipt(f, { status });
    expect((await f.service.rejectedReturns(people.warehouse, {})).rows).toEqual([]);
    await expect(f.service.rejectedReturnSource(people.warehouse, 1)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("freshly checks warehouse identity, parent scope and source linkage before opening the return", async () => {
    seedSpecificationReceipt(f, { status: "rejected" });
    await f.service.rejectedReturns(people.warehouse, {});
    f.scope.set(32, new Set());
    await expect(f.service.rejectedReturnSource(people.warehouse, 1)).rejects.toMatchObject({ code: "FORBIDDEN" });
    f.scope.set(32, new Set([10])); f.memory.exec("UPDATE users SET isActive=0 WHERE id=32");
    await expect(f.service.rejectedReturnSource(people.warehouse, 1)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

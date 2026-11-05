import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sql, eq } from "drizzle-orm";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { purchaseOrders, purchaseOrderItems, users } from "../../drizzle/schema";
import { summarizePurchasePricingStage } from "../../shared/purchasePricingStage";
import { getDelegateItemActionMode } from "../routers/purchase/actionable";
import { isDelegateRole } from "../../shared/delegate-role";
import { isRoutedPurchaseItem } from "../../shared/purchase-item-review";
import { purchaseSpecificationsDatabase } from "./fixtures/purchaseSpecificationsDatabase";
vi.mock("../_core/db", () => ({}));
import { assertPOItemAssignedToDelegate, assertCanResolveReturnedPOItem } from "../_core/authz/guard";

const routerPath = "server/routers/purchase/purchase-orders.router.ts";
const current = readFileSync(routerPath, "utf8");
const original = readFileSync("tools/legacy-independent-batches/before-request-item-revision.fixture.txt", "utf8");
const procedure: any = { input: () => procedure, mutation: (work: any) => work, query: (work: any) => work };
function extract(name: string, source = current, declaration = false) {
  const file = ts.createSourceFile(routerPath, source, ts.ScriptTarget.Latest, true);
  let found = "";
  const visit = (node: ts.Node) => {
    if (declaration && ts.isFunctionDeclaration(node) && node.name?.text === name) found = node.getText(file).replace(/^export /, "");
    if (!declaration && ts.isPropertyAssignment(node) && node.name.getText(file) === name) found = node.initializer.getText(file);
    ts.forEachChild(node, visit);
  }; visit(file);
  if (!found) throw Error(`Missing actual handler ${name}`);
  return ts.transpileModule(`(${found})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
}
let f: ReturnType<typeof purchaseSpecificationsDatabase>, context: any, database: any;
const delegate = { id: 7, role: "delegate", isActive: 1, name: "Assigned delegate" };
const creator = { id: 9, role: "warehouse", isActive: 1, name: "Creator" };
const manager = { id: 8, role: "senior_management", isActive: 1, name: "Management" };
const get = (table: string, id: number) => f.memory.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id) as any;
const all = (table: string) => f.memory.prepare(`SELECT * FROM ${table} ORDER BY id`).all() as any[];
const call = (name: string, input: any, user = delegate, source = current) => vm.runInNewContext(extract(name, source), context)({ input, ctx: { user } });
const update = async (table: string, id: number, values: any) => {
  const entries = Object.entries(values).filter(([, value]) => value !== undefined);
  await f.db.execute(sql`UPDATE ${sql.identifier(table)} SET ${sql.join(entries.map(([key, value]) => sql`${sql.identifier(key)}=${value}`), sql`, `)} WHERE id=${id}`);
};
beforeEach(() => {
  f = purchaseSpecificationsDatabase();
  f.memory.exec(`
    ALTER TABLE purchase_orders ADD COLUMN totalEstimatedCost TEXT;
    ALTER TABLE purchase_orders ADD COLUMN accountingApprovedById INTEGER;
    ALTER TABLE purchase_orders ADD COLUMN accountingApprovedAt TEXT;
    ALTER TABLE purchase_orders ADD COLUMN managementApprovedById INTEGER;
    ALTER TABLE purchase_orders ADD COLUMN managementApprovedAt TEXT;
    ALTER TABLE purchase_order_items ADD COLUMN delegateId INTEGER;
    ALTER TABLE purchase_order_items ADD COLUMN batchId INTEGER;
    ALTER TABLE purchase_order_items ADD COLUMN estimatedUnitCost TEXT;
    ALTER TABLE purchase_order_items ADD COLUMN estimatedTotalCost TEXT;
    ALTER TABLE purchase_order_items ADD COLUMN updatedAt TEXT;
    ALTER TABLE purchase_order_items ADD COLUMN itemRevisionNote TEXT;
    ALTER TABLE purchase_order_items ADD COLUMN itemRevisionRequestedById INTEGER;
    ALTER TABLE purchase_order_items ADD COLUMN itemRevisionRequestedAt TEXT;
    ALTER TABLE purchase_order_items ADD COLUMN managementRejectionReason TEXT;
    ALTER TABLE purchase_order_items ADD COLUMN purchasedById INTEGER;
    ALTER TABLE purchase_order_items ADD COLUMN purchasedAt TEXT;
    CREATE TABLE po_pricing_batches(id INTEGER PRIMARY KEY,purchaseOrderId INTEGER,batchNumber INTEGER,submittedById INTEGER,status TEXT,itemCount INTEGER,totalEstimatedCost TEXT,purchasePackageSubmissionId INTEGER,scope TEXT,custodyAmount TEXT,accountingApprovedById INTEGER,accountingApprovedAt TEXT,managementApprovedById INTEGER,managementApprovedAt TEXT,managementNotes TEXT,rejectedById INTEGER,rejectedAt TEXT,rejectionReason TEXT,delegateSignatureSnapshot TEXT);
  `);
  for (const actor of [delegate, creator, manager]) f.insert("users", actor);
  f.insert("purchase_orders", { id: 10, poNumber: "PR-2026-180528", status: "pending_management", requestedById: 9, totalEstimatedCost: "433", accountingApprovedById: 6, accountingApprovedAt: "2026-11-05 08:00:00" });
  f.insert("po_pricing_batches", { id: 43, purchaseOrderId: 10, batchNumber: 1, submittedById: 7, status: "pending_management", totalEstimatedCost: "433", itemCount: 2, accountingApprovedById: 6, accountingApprovedAt: "2026-11-05 08:00:00" });
  for (const [id, amount] of [[20, 253], [21, 180]]) f.insert("purchase_order_items", { id, purchaseOrderId: 10, itemName: `Approved quote ${id}`, quantity: 1, unit: "قطعة", status: "estimated", delegateId: 7, batchId: 43, estimatedUnitCost: String(amount), estimatedTotalCost: String(amount), updatedAt: "2026-11-05 08:00:00" });
  f.insert("purchase_order_items", { id: 22, purchaseOrderId: 10, itemName: "Converter returned to creator", quantity: 1, unit: "قطعة", status: "pending", delegateId: 7, updatedAt: "2026-11-05 08:00:00" });
  database = {
    getDb: async () => f.db, withTransaction: (work: any) => f.db.transaction(work),
    getPurchaseOrderById: async (id: number) => get("purchase_orders", id), getPOItemById: async (id: number) => get("purchase_order_items", id),
    getPOItems: async (id: number) => all("purchase_order_items").filter(item => item.purchaseOrderId === id),
    getPOPricingBatches: async (id: number) => all("po_pricing_batches").filter(batch => batch.purchaseOrderId === id), getPOPricingBatchById: async (id: number) => get("po_pricing_batches", id),
    updatePOItem: (id: number, values: any) => update("purchase_order_items", id, values),
    updatePOItemIfNotTerminal: async (id: number, values: any) => { if (["cancelled", "rejected"].includes(get("purchase_order_items", id).status)) return false; await update("purchase_order_items", id, values); return true; },
    updatePurchaseOrder: vi.fn((id: number, values: any) => update("purchase_orders", id, values)), updatePOPricingBatch: (id: number, values: any) => update("po_pricing_batches", id, values),
    getUsersByRole: async () => [{ id: 6 }], getPurchaseManagerUsers: async () => [], createNotification: vi.fn(), createAuditLog: vi.fn(),
    getNextBatchNumber: async () => all("po_pricing_batches").length + 1,
    createPOPricingBatch: async (values: any) => { f.insert("po_pricing_batches", { id: 44, ...values }); return 44; },
  };
  context = { z, TRPCError, sql, eq, purchaseOrders, purchaseOrderItems, users, delegateProcedure: procedure, protectedProcedure: procedure, managementProcedure: procedure,
    db: database, summarizePurchasePricingStage, assertPOItemAssignedToDelegate, assertCanResolveReturnedPOItem, isDelegateRole, isRoutedPurchaseItem,
    assertRoutedPurchaseItemReady: () => {}, assertItemOutsidePricingBundle: vi.fn(), pricingBundlesEnabled: () => false, reservedPricingItemIds: async () => new Set(), isItemAssignedToPODelegate: (actor: any, item: any) => actor.id === item.delegateId,
    queuePurchaseTranslation: vi.fn(), createTranslatedProcurementComment: vi.fn(), syncPathBTicketFromPurchaseOrder: vi.fn(),
    externalWorkshopInput: z.object({}), withExternalWorkshopPricing: async ({ write }: any) => write(),
    finalizePricedBatchForPO: vi.fn(), archiveDelegatePricingBatchPdf: async () => true, reserveReplacementPricing: async () => null, trialEnabled: async () => false,
    assertLegacyApprovalOutsideUnifiedBundle: async () => {}, rejectPricingBatchIfEmpty: async () => false,
    getActivePricingBatchItems: (items: any[]) => items.filter(item => !["rejected", "cancelled"].includes(item.status)),
    approveReplacementManagement: async () => false, assertSingleReplacementRejection: async () => {}, returnReplacementToDelegate: async () => false,
    notifyItemRejection: vi.fn(), rejectPurchaseOrderIfAllItemsTerminal: vi.fn(),
    getPurchaseOrderTicketContext: async (id: number) => ({ po: get("purchase_orders", id), ticket: null, externalJob: null }),
  };
  context.syncIndependentPurchasePricingStage = vm.runInNewContext(extract("syncIndependentPurchasePricingStage", current, true), context);
  context.withPurchaseItemReturnWrite = vm.runInNewContext(extract("withPurchaseItemReturnWrite", current, true), context);
});
afterEach(() => f.close());

describe("actual legacy revision and independent pricing batch regression", () => {
  it("reproduces immutable HEAD resetting the433 batch header, then the same fixture succeeds after the fix", async () => {
    const batch = get("po_pricing_batches", 43), originals = all("purchase_order_items").slice(0, 2);
    await call("requestItemRevision", { itemId: 22, note: "Converter specification correction" }, delegate, original);
    expect(get("purchase_orders", 10).status).toBe("pending_accounting");
    expect(get("po_pricing_batches", 43)).toEqual(batch);
    await update("purchase_orders", 10, { status: "pending_management" }); await update("purchase_order_items", 22, { status: "pending" }); database.createNotification.mockClear();
    await call("requestItemRevision", { itemId: 22, note: "Converter specification correction" });
    expect(get("purchase_orders", 10)).toMatchObject({ status: "pending_management", totalEstimatedCost: "433", accountingApprovedById: 6 });
    expect(get("po_pricing_batches", 43)).toEqual(batch); expect(all("purchase_order_items").slice(0, 2)).toEqual(originals);
    expect(database.createNotification.mock.calls.map((args: any[]) => args[0].userId)).toEqual([9]);
  });
  it("revises only converter, resubmits it, sends B100, approves A433 and purchases A before B", async () => {
    const a = get("po_pricing_batches", 43);
    await call("requestItemRevision", { itemId: 22, note: "Converter specification correction" });
    await call("editAndResubmitReturnedItem", { id: 22, purchaseOrderId: 10, itemName: "Correct converter", quantity: 2 }, creator);
    expect(get("purchase_order_items", 22)).toMatchObject({ status: "pending", delegateId: 7 });
    expect(get("purchase_orders", 10).status).toBe("pending_management"); expect(get("po_pricing_batches", 43)).toEqual(a);
    await update("purchase_order_items", 22, { status: "estimated", estimatedUnitCost: "50", estimatedTotalCost: "100" });
    const submit = vm.runInNewContext(extract("submitPricedBatchForPO", current, true), context);
    await f.db.transaction((tx: any) => submit(10, delegate, { tx, bundleId: 50, selectedItemIds: [22], skipArchive: true }));
    expect(get("po_pricing_batches", 44)).toMatchObject({ status: "pending_accounting", totalEstimatedCost: "100" });
    expect(get("purchase_orders", 10)).toMatchObject({ status: "pending_accounting", totalEstimatedCost: "433" });
    const approval = readFileSync("server/routers/purchase/approvals.router.ts", "utf8");
    await call("approveManagementBatch", { batchId: 43 }, manager, approval);
    expect(get("po_pricing_batches", 43)).toMatchObject({ status: "approved", accountingApprovedById: 6, managementApprovedById: 8 });
    expect(getDelegateItemActionMode(get("purchase_orders", 10).status, get("purchase_order_items", 20))).toBe("purchase");
    await call("confirmItemPurchase", { itemId: 20, purchasedPhotoUrl: "photo", invoicePhotoUrl: "invoice" });
    expect(get("purchase_order_items", 20).status).toBe("purchased");
    expect(get("purchase_order_items", 21).status).toBe("approved");
    expect(get("purchase_order_items", 22)).toMatchObject({ status: "estimated", batchId: 44 });
    expect(get("po_pricing_batches", 44)).toMatchObject({ status: "pending_accounting", managementApprovedById: null });
  });
  it("rolls back the target return when summary persistence fails, without touching A", async () => {
    await update("purchase_orders", 10, { status: "pending_estimate" });
    const before = all("purchase_order_items"), batch = get("po_pricing_batches", 43);
    database.updatePurchaseOrder.mockRejectedValueOnce(Error("Header write failed"));
    await expect(call("requestItemRevision", { itemId: 22, note: "Correct this converter" })).rejects.toThrow("Header write failed");
    expect(all("purchase_order_items")).toEqual(before); expect(get("po_pricing_batches", 43)).toEqual(batch); expect(database.createNotification).not.toHaveBeenCalled();
  });
  it("rolls back B's new batch and membership if its header summary fails inside the existing bundle transaction", async () => {
    await update("purchase_order_items", 22, { status: "estimated", estimatedUnitCost: "100", estimatedTotalCost: "100" });
    const batch = get("po_pricing_batches", 43), item = get("purchase_order_items", 22);
    database.updatePurchaseOrder.mockRejectedValueOnce(Error("Header write failed"));
    const submit = vm.runInNewContext(extract("submitPricedBatchForPO", current, true), context);
    await expect(f.db.transaction((tx: any) => submit(10, delegate, { tx, bundleId: 50, selectedItemIds: [22], skipArchive: true }))).rejects.toThrow("Header write failed");
    expect(get("po_pricing_batches", 44)).toBeUndefined(); expect(get("po_pricing_batches", 43)).toEqual(batch); expect(get("purchase_order_items", 22)).toEqual(item);
  });
  it("resubmits B for pricing while previously approved A remains independently purchasable", async () => {
    await update("po_pricing_batches", 43, { status: "approved" }); await update("purchase_orders", 10, { status: "approved" });
    for (const id of [20, 21]) await update("purchase_order_items", id, { status: "approved" });
    await update("purchase_order_items", 22, { status: "needs_item_revision" });
    await call("resubmitItemRevision", { itemId: 22 }, creator);
    expect(get("purchase_orders", 10).status).toBe("pending_estimate");
    expect(getDelegateItemActionMode(get("purchase_orders", 10).status, get("purchase_order_items", 20))).toBe("purchase");
    await call("confirmItemPurchase", { itemId: 20, purchasedPhotoUrl: "photo", invoicePhotoUrl: "invoice" });
    expect(get("purchase_order_items", 20).status).toBe("purchased"); expect(get("purchase_order_items", 22).status).toBe("pending");
  });
  it("freshly denies foreign assignment, changed parent, changed stage, or a bundle reservation", async () => {
    const item = get("purchase_order_items", 22), po = get("purchase_orders", 10);
    await update("purchase_order_items", 22, { delegateId: 99 });
    await expect(call("requestItemRevision", { itemId: 22, note: "Correct this converter" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await update("purchase_order_items", 22, { delegateId: 7, purchaseOrderId: 999 });
    await expect(context.withPurchaseItemReturnWrite(delegate, po, item, "request", vi.fn())).rejects.toMatchObject({ code: "FORBIDDEN" });
    await update("purchase_order_items", 22, { purchaseOrderId: 10, status: "estimated" });
    await expect(context.withPurchaseItemReturnWrite(delegate, po, item, "request", vi.fn())).rejects.toMatchObject({ code: "CONFLICT" });
    await update("purchase_order_items", 22, { status: "pending" }); context.assertItemOutsidePricingBundle.mockRejectedValueOnce(new TRPCError({ code: "CONFLICT" }));
    await expect(call("requestItemRevision", { itemId: 22, note: "Correct this converter" })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(get("purchase_order_items", 22).status).toBe("pending");
  });
  it("serializes repeated revision requests against the current item", async () => {
    const results = await Promise.allSettled([call("requestItemRevision", { itemId: 22, note: "Correct this converter" }), call("requestItemRevision", { itemId: 22, note: "Correct this converter" })]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter(result => result.status === "rejected")).toHaveLength(1);
    expect(get("purchase_orders", 10).status).toBe("pending_management");
  });
  it.each(["draft", "closed", "rejected", "revision_needed"])("denies a fresh %s parent and stale actor role under the lock without writes", async status => {
    const po = get("purchase_orders", 10), item = get("purchase_order_items", 22), write = vi.fn();
    await update("purchase_orders", 10, { status });
    await expect(context.withPurchaseItemReturnWrite(delegate, po, item, "request", write)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(write).not.toHaveBeenCalled(); expect(get("purchase_order_items", 22).status).toBe("pending");
    await update("purchase_orders", 10, { status: "pending_management" }); await update("users", 7, { role: "warehouse" });
    await expect(context.withPurchaseItemReturnWrite(delegate, po, item, "request", write)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(write).not.toHaveBeenCalled();
  });
  it("simple resubmission preserves the pending management sibling and rolls back on a failed summary", async () => {
    await call("requestItemRevision", { itemId: 22, note: "Correct this converter" });
    await call("resubmitItemRevision", { itemId: 22 }, creator);
    expect(get("purchase_order_items", 22).status).toBe("pending"); expect(get("purchase_orders", 10).status).toBe("pending_management");
    await update("purchase_order_items", 22, { status: "needs_item_revision" }); await update("purchase_orders", 10, { status: "pending_estimate" });
    database.updatePurchaseOrder.mockRejectedValueOnce(Error("Header write failed"));
    await expect(call("resubmitItemRevision", { itemId: 22 }, creator)).rejects.toThrow("Header write failed");
    expect(get("purchase_order_items", 22).status).toBe("needs_item_revision");
  });
  it("keeps rejected A members rejected when the remaining A item is approved and B remains pending", async () => {
    await update("purchase_order_items", 20, { status: "rejected" });
    f.insert("po_pricing_batches", { id: 44, purchaseOrderId: 10, status: "pending_accounting" });
    await update("purchase_order_items", 22, { status: "estimated", batchId: 44 }); await update("purchase_orders", 10, { status: "pending_accounting" });
    await call("approveManagementBatch", { batchId: 43 }, manager, readFileSync("server/routers/purchase/approvals.router.ts", "utf8"));
    expect(get("purchase_order_items", 20).status).toBe("rejected"); expect(get("purchase_order_items", 21).status).toBe("approved"); expect(get("po_pricing_batches", 44).status).toBe("pending_accounting");
  });
});

describe("scoped pricing-batch read self-repair", () => {
  it("only closes permitted empty batches, including an explicitly empty scope", async () => {
    const batches = [{ id: 1, status: "pending_management" }, { id: 2, status: "pending_accounting" }];
    const write = vi.fn();
    const repair = vm.runInNewContext(extract("rejectEmptyPendingPricingBatches", readFileSync("server/routers/purchase/pricing-batch-state.ts", "utf8"), true), {
      db: { getPOItems: async () => [], getPOPricingBatches: async () => batches, updatePOPricingBatch: write }, isObserverReadScope: () => false,
      PENDING_BATCH_STATUSES: new Set(["pending_accounting", "pending_management"]), getActivePricingBatchItems: (items: any[]) => items,
    });
    await repair(10, { allowedBatchIds: [1] }); expect(write.mock.calls.map((args: any[]) => args[0])).toEqual([1]);
    write.mockClear(); await repair(10, { allowedBatchIds: [] }); expect(write).not.toHaveBeenCalled();
  });
});

describe("purchase header summary preserves legacy and routed stages", () => {
  it("keeps the genuine old unbatched whole-order accounting route", () => {
    expect(summarizePurchasePricingStage("pending_estimate", [{ status: "estimated", estimatedTotalCost: "233" }, { status: "needs_item_revision" }], [])).toEqual({ status: "pending_accounting", totalEstimatedCost: "233" });
  });
  it("does not infer a new accounting submission from batched quotes or missing batch metadata", () => {
    expect(summarizePurchasePricingStage("pending_management", [{ status: "estimated", batchId: 43, estimatedTotalCost: "433" }, { status: "needs_item_revision" }], [{ id: 43, status: "pending_management" }])).toEqual({ status: "pending_management" });
    expect(summarizePurchasePricingStage("pending_management", [{ status: "estimated", batchId: 43 }], [])).toEqual({ status: "pending_management" });
    expect(summarizePurchasePricingStage("pending_management", [{ status: "approved", batchId: 43, reviewRole: "senior_management" }], [])).toEqual({ status: "pending_management" });
  });
  it("summarizes actual A and B while retaining routed item review and terminal decisions", () => {
    const items = [{ status: "estimated", batchId: 43 }, { status: "estimated", batchId: 44 }];
    expect(summarizePurchasePricingStage("pending_management", items, [{ id: 43, status: "pending_management" }, { id: 44, status: "pending_accounting" }])).toEqual({ status: "pending_accounting" });
    expect(summarizePurchasePricingStage("pending_management", items.map(item => ({ ...item, reviewRole: "senior_management" })), [{ id: 43, status: "pending_management" }, { id: 44, status: "pending_accounting" }])).toEqual({ status: "pending_accounting" });
    expect(summarizePurchasePricingStage("pending_management", [{ status: "rejected", batchId: 43 }, { status: "cancelled" }], [{ id: 43, status: "pending_management" }])).toEqual({ status: "rejected" });
    expect(summarizePurchasePricingStage("closed", items, [{ id: 44, status: "pending_accounting" }])).toEqual({ status: "closed" });
    expect(summarizePurchasePricingStage("pending_estimate", [], [])).toEqual({ status: "pending_estimate" });
  });
});

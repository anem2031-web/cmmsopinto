import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { readScopeDatabase } from "./fixtures/readScopeDatabase";
import { readScopeChunks, groupReadRows } from "../_core/authz/read-batch";
import { createPurchaseOrderReadScope, assertCanViewPurchaseOrder, assertCanPerformPOAction } from "../_core/authz/guard";
import { computeActionablePOs } from "../routers/purchase/actionable";
import { mediaAccessPort } from "../_core/authz/media-access";
import { authorizeBusinessPurchaseTranslationRows, authorizeBusinessTranslationParents, assertBusinessTranslationAccess } from "../_core/authz/business-resources";
import { purchaseDocumentPermission } from "../_core/authz/purchase-document";
import * as db from "../_core/db";
import { router, protectedProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";

const state = vi.hoisted(() => ({ load: null as any, parent: null as any }));
vi.mock("../_core/db", () => ({
  getLegacyPricingBatchReadScopeRows: vi.fn((...args: any[]) => state.load(...args)),
  getPurchaseItemReviewScopeRows: vi.fn(async () => []),
  getPOItemsByDelegate: vi.fn(async () => []), getUserIdsByRole: vi.fn(async () => []),
  getPurchaseOrderById: vi.fn(async () => state.parent),
  getPurchaseOrdersByIds: vi.fn(async () => state.parent ? [state.parent] : []),
  getFullPOItemsForPOs: vi.fn(async () => []),
}));
const actor = (role = "senior_management", id = 7, isActive: any = 1) => ({ id, role, isActive });
const order = (id = 1, status = "pending_accounting", requestedById = 99) => ({ id, poNumber: `PR-${id}`, status, requestedById });
let memory: ReturnType<typeof readScopeDatabase>, database: any, queries: Array<{ sql: string; params: any[] }>;
let loader: (actor: any, ids?: number[], database?: any) => Promise<any[]>;
let unifiedTable = true;

beforeEach(() => {
  vi.clearAllMocks(); memory = readScopeDatabase(); queries = []; unifiedTable = true;
  memory.memory.exec(`CREATE TABLE users(id INTEGER,role TEXT,isActive INTEGER);
    CREATE TABLE purchase_packages(id INTEGER);
    CREATE TABLE delegate_pricing_bundle_approvals(bundleId INTEGER,status TEXT);
    CREATE TABLE delegate_pricing_bundle_batches(bundleId INTEGER,pricingBatchId INTEGER,purchaseOrderId INTEGER);
    INSERT INTO users VALUES(7,'senior_management',1),(8,'accountant',1),(9,'senior_management',0);`);
  const dialect = new MySqlDialect();
  database = { async execute(statement: any) {
    const query = dialect.sqlToQuery(statement); queries.push(query);
    if (query.sql.includes("information_schema.TABLES")) return [unifiedTable ? [{ TABLE_NAME: "delegate_pricing_bundle_approvals" }] : []];
    return [memory.memory.prepare(query.sql).all(...query.params as any[])];
  } };
  const file = "server/_core/db/purchase.ts", text = readFileSync(file, "utf8");
  const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const declaration = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "getLegacyPricingBatchReadScopeRows")!;
  loader = vm.runInNewContext(ts.transpileModule(`(${declaration.getText(ast).replace(/^export\s+/, "")})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText,
    { sql, readScopeChunks, getDb: async () => { throw Error("Live database forbidden"); } });
  state.load = (user: any, ids?: number[]) => loader(user, ids, database);
  state.parent = order();
  vi.mocked(db.getPurchaseItemReviewScopeRows).mockResolvedValue([]);
});
afterEach(() => { state.load = null; memory.memory.close(); });

function seed(id = 1, status = "pending_accounting", batch = id * 10 + 1, stage = "pending_management", item = id * 100 + 1) {
  memory.insert("purchase_orders", { id, status, requestedById: 99 });
  memory.insert("po_pricing_batches", { id: batch, purchaseOrderId: id, status: stage, accountingApprovedById: 8, accountingApprovedAt: "2026-11-05 09:00:00" });
  memory.insert("purchase_order_items", { id: item, purchaseOrderId: id, batchId: batch, status: "estimated" });
}
const line = (id = 101, batchId = 11, purchaseOrderId = 1, status = "estimated") => ({ id, batchId, purchaseOrderId, status });

function packageCaller(parents: any[], submission: any) {
  const file = "server/routers/purchase/purchase-packages.router.ts", source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  const property = (name: string) => {
    let code = "";
    const visit = (node: ts.Node) => { if (ts.isPropertyAssignment(node) && node.name.getText(source) === name) code = node.initializer.getText(source); ts.forEachChild(node, visit); };
    visit(source);
    return vm.runInNewContext(ts.transpileModule(`(${code})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, {
      z, TRPCError, protectedProcedure, createPurchaseOrderReadScope, groupReadRows,
      assertCanPerformPOAction: () => {}, loadDocumentListPort: async () => ({}), purchaseDocumentPermission: async () => ({ pdfAllowed: false }),
      db: { getPurchasePackageById: async () => ({ id: 50 }), getPurchaseOrdersByPackage: async () => parents,
        getPurchasePackagesList: async () => [{ id: 50, packageNumber: "PB-50" }], getPurchaseOrders: async () => parents,
        getPackageSubmissionsWithBatches: async () => [submission], getPackageSubmissionsWithBatchesForPackages: async () => [submission],
        getFullPOItemsForPOs: async () => [line(), line(201, 21, 2)] },
    });
  };
  return router({ purchasePackages: router({ submissions: property("submissions"), actionableSubmissionsForMe: property("actionableSubmissionsForMe") }) })
    .createCaller({ user: actor() } as any).purchasePackages;
}

describe("Actual SQL legacy pending batch read scope", () => {
  it("opens management A independently while B/header wait for accounting, with exact line/batch/comment scope", async () => {
    seed();
    memory.insert("po_pricing_batches", { id: 12, purchaseOrderId: 1, status: "pending_accounting" });
    memory.insert("purchase_order_items", line(102, 12));
    const scope = await createPurchaseOrderReadScope(actor(), [order()]);
    expect(() => scope.assert(order())).not.toThrow();
    expect(scope.hasLimitedItemScope(order())).toBe(true);
    expect(scope.filterItems(order(), [line(), line(102, 12), line(101, 11, 404)])).toEqual([line()]);
    expect(scope.filterBatches(order(), [{ id: 11, purchaseOrderId: 1 }, { id: 12, purchaseOrderId: 1 }, { id: 11, purchaseOrderId: 404 }])).toEqual([{ id: 11, purchaseOrderId: 1 }]);
    expect(scope.filterComments(order(), [{ purchaseOrderItemId: 101 }, { purchaseOrderItemId: 102 }, { purchaseOrderItemId: null }])).toEqual([{ purchaseOrderItemId: 101 }]);
    expect(scope.legacyApprovals).toEqual([{ purchaseOrderId: 1, batchId: 11, stage: "management", purchasePackageSubmissionId: null, itemIds: [101] }]);
    expect(() => assertCanPerformPOAction("approveManagement", actor(), order())).toThrow();
  });
  it("allows legacy accounting B under a different management header without granting senior legacy accounting", async () => {
    seed(1, "pending_management", 11, "pending_accounting");
    const parent = order(1, "pending_management");
    const accounting = await createPurchaseOrderReadScope(actor("accountant", 8), [parent]);
    expect(accounting.hasLimitedItemScope(parent)).toBe(true);
    expect(accounting.legacyApprovals[0].stage).toBe("accounting");
    const management = await createPurchaseOrderReadScope(actor(), [order()]);
    expect(management.legacyApprovals).toEqual([]);
    expect(() => management.assert(order())).toThrow();
  });
  it.each(["draft", "revision_needed", "closed", "rejected"])("does not revive a blocked parent %s", async status => {
    seed(1, status);
    expect(await loader(actor(), [1], database)).toEqual([]);
    const scope = await createPurchaseOrderReadScope(actor(), [order(1, status)]);
    expect(scope.legacyApprovals).toEqual([]);
  });
  it("denies missing parents, empty/cancelled batches, wrong stages, no accounting approval and grafted membership", async () => {
    seed();
    memory.memory.exec("UPDATE purchase_order_items SET status='cancelled'");
    expect(await loader(actor(), [1], database)).toEqual([]);
    memory.memory.exec("UPDATE purchase_order_items SET status='estimated'; UPDATE po_pricing_batches SET accountingApprovedAt=NULL");
    expect(await loader(actor(), [1], database)).toEqual([]);
    memory.memory.exec("UPDATE po_pricing_batches SET accountingApprovedAt='2026-11-05'; INSERT INTO purchase_order_items(id,purchaseOrderId,batchId,status) VALUES(999,999,11,'estimated')");
    expect(await loader(actor(), [1], database)).toEqual([]);
    memory.memory.exec("DELETE FROM purchase_order_items WHERE id=999; DELETE FROM purchase_orders");
    expect(await loader(actor(), [1], database)).toEqual([]);
  });
  it("excludes ANY unified DPB root independently of the rollout flag, while retaining historical DPB without a root", async () => {
    seed();
    memory.memory.exec("INSERT INTO delegate_pricing_bundle_batches VALUES(33,11,1)");
    expect(await loader(actor(), [1], database)).toHaveLength(1);
    memory.memory.exec("INSERT INTO delegate_pricing_bundle_approvals VALUES(33,'approved')");
    expect(await loader(actor(), [1], database)).toEqual([]);
    unifiedTable = false;
    expect(await loader(actor(), [1], database)).toHaveLength(1);
  });
  it("requires correct PB submission/package membership and stage without making a standalone approval row", async () => {
    seed();
    memory.memory.exec("UPDATE purchase_orders SET packageId=50; UPDATE po_pricing_batches SET purchasePackageSubmissionId=51");
    expect(await loader(actor(), [1], database)).toEqual([]);
    memory.memory.exec("INSERT INTO purchase_packages VALUES(50); INSERT INTO purchase_package_submissions(id,purchasePackageId,status) VALUES(51,50,'pending_management')");
    const scope = await createPurchaseOrderReadScope(actor(), [order()]);
    expect(scope.legacyApprovals).toHaveLength(1);
    expect(computeActionablePOs(actor(), [order()], [line()], scope.legacyApprovals)).toEqual([]);
    memory.memory.exec("UPDATE purchase_package_submissions SET purchasePackageId=999");
    expect(await loader(actor(), [1], database)).toEqual([]);
  });
  it.each(["delegate", "delegate_manager", "warehouse", "technician", "executive_director", "general_maintenance_manager"])("does not create a new finance grant for %s", async role => {
    seed();
    expect(await loader(actor(role), [1], database)).toEqual([]);
  });
  it("uses fresh active identity and fresh batch metadata on every request", async () => {
    seed();
    await expect(assertCanViewPurchaseOrder(actor(), order())).resolves.toBeUndefined();
    memory.memory.exec("UPDATE users SET isActive=0 WHERE id=7");
    await expect(assertCanViewPurchaseOrder(actor(), order())).rejects.toThrow();
    memory.memory.exec("UPDATE users SET isActive=1 WHERE id=7; UPDATE po_pricing_batches SET status='approved'");
    await expect(assertCanViewPurchaseOrder(actor(), order())).rejects.toThrow();
    expect(vi.mocked(db.getLegacyPricingBatchReadScopeRows)).toHaveBeenCalledTimes(3);
  });
  it("preserves creator, owner/admin and normal stage scope, while leaving executive action denied", async () => {
    seed();
    for (const user of [actor("owner"), actor("admin"), actor("senior_management", 99)]) {
      const scope = await createPurchaseOrderReadScope(user, [order()]);
      expect(scope.hasLimitedItemScope(order())).toBe(false);
      expect(scope.filterItems(order(), [line(), line(102, 12)])).toHaveLength(2);
    }
    const accounting = await createPurchaseOrderReadScope(actor("accountant", 8), [order()]);
    expect(accounting.hasLimitedItemScope(order())).toBe(false);
    expect(accounting.filterItems(order(), [line(), line(102, 12)])).toHaveLength(2);
    expect(() => assertCanPerformPOAction("approveManagement", actor("executive_director"), order(1, "pending_management"))).toThrow();
  });
  it("redacts only newly opened finance headers, retaining source links, true status and old routed/creator payloads", async () => {
    seed();
    const parent = { ...order(), ticketId: 5, ticketItemId: 6, packageId: 50, siteId: 3, requestedByName: "Requester",
      totalEstimatedCost: "900", custodyAmount: "70", notes: "sibling note", accountingApprovedByName: "Other", managementApprovedAt: "old", requesterSignatureSnapshot: "signature", itemNames: ["private sibling"], itemCount: 2 };
    const scope = await createPurchaseOrderReadScope(actor(), [parent]);
    expect(scope.projectOrder(parent)).toMatchObject({ id: 1, status: "pending_accounting", ticketId: 5, ticketItemId: 6, packageId: 50, siteId: 3, requestedByName: "Requester",
      totalEstimatedCost: null, custodyAmount: null, notes: null, accountingApprovedByName: null, managementApprovedAt: null, requesterSignatureSnapshot: null, itemNames: [], itemCount: 1 });
    expect(scope.filter([parent])[0]).toEqual(scope.projectOrder(parent));
    const creator = await createPurchaseOrderReadScope(actor("senior_management", 99), [parent]);
    expect(creator.projectOrder(parent)).toEqual(parent);
    vi.mocked(db.getPurchaseItemReviewScopeRows).mockResolvedValue([{ id: 104, purchaseOrderId: 1, status: "pending_review", reviewRole: "senior_management" }] as any);
    const routed = await createPurchaseOrderReadScope(actor(), [parent]);
    expect(routed.isRoutedReviewOnly(parent)).toBe(true);
    expect(routed.projectOrder(parent)).toEqual(parent);
    expect(routed.filterComments(parent, [{ purchaseOrderItemId: null }])).toEqual([{ purchaseOrderItemId: null }]);
    expect(routed.filterBatches(parent, [{ id: 12, purchaseOrderId: 1 }])).toEqual([{ id: 12, purchaseOrderId: 1 }]);
  });
  it("does not authorize PDF of the pending batch or a whole mixed order through the new read exception", async () => {
    seed();
    const scope = await createPurchaseOrderReadScope(actor(), [order()]);
    const batch = { id: 11, purchaseOrderId: 1, status: "pending_management", accountingApprovedById: 8, accountingApprovedAt: "2026-11-05 09:00:00" };
    const port: any = { order: async () => order(), batch: async () => batch, orderBatches: async () => [batch], orderItems: async () => [{ ...line(), estimatedUnitCost: "10" }],
      authorize: async (_user: any, parent: any) => scope.assert(parent) };
    expect(() => scope.assert(order())).not.toThrow();
    expect((await purchaseDocumentPermission(actor(), 1, 11, undefined, port)).pdfAllowed).toBe(false);
    expect((await purchaseDocumentPermission(actor(), 1, undefined, undefined, port)).pdfAllowed).toBe(false);
  });
  it("denies malformed actor/order IDs without querying and propagates infrastructure failures", async () => {
    for (const invalid of [0, -1, 1.2, NaN, Infinity]) {
      expect(await loader(actor("senior_management", invalid), [1], database)).toEqual([]);
      expect(await loader(actor(), [invalid], database)).toEqual([]);
    }
    expect(queries).toEqual([]);
    await expect(loader(actor(), [1], { execute: async () => { throw Error("scope unavailable"); } })).rejects.toThrow("scope unavailable");
  });
  it("chunks 1001 distinct parents and repeated IDs into three SQL reads plus one metadata check", async () => {
    for (let id = 1; id <= 1001; id++) seed(id);
    const parents = Array.from({ length: 1001 }, (_, i) => order(i + 1));
    const scope = await createPurchaseOrderReadScope(actor(), [...parents, ...parents]);
    expect(scope.filter(parents)).toHaveLength(1001);
    expect(queries).toHaveLength(4);
    const scopes = queries.slice(1).map(query => query.params.filter(value => typeof value === "number").length - 1);
    expect(scopes).toEqual([500, 500, 1]);
  });
});

describe("Independent actionable and direct item read boundaries", () => {
  it("keeps the real header and independent review+management rows with stable action identity", async () => {
    seed();
    const scope = await createPurchaseOrderReadScope(actor(), [order()]);
    const review = { id: 103, purchaseOrderId: 1, status: "pending_review", reviewRole: "senior_management" };
    const result = computeActionablePOs(actor(), [order()], [line(), review], scope.legacyApprovals);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ status: "pending_accounting", approvalAction: "management", actionKey: "management:1" });
    expect(result[0].reviewAction).toBeUndefined();
    expect(result[1]).toMatchObject({ status: "pending_accounting", reviewAction: "review" });
    expect(result[1].approvalAction).toBeUndefined();
  });
  it("does not duplicate ordinary stage work and does not accept foreign/missing/currently rejected item claims", async () => {
    seed();
    const scope = await createPurchaseOrderReadScope(actor(), [order()]);
    expect(computeActionablePOs(actor(), [order(1, "pending_management")], [line()], scope.legacyApprovals)).toHaveLength(1);
    for (const items of [[], [line(101, 12)], [line(101, 11, 404)], [line(101, 11, 1, "rejected")]]) {
      expect(computeActionablePOs(actor(), [order()], items, scope.legacyApprovals)).toEqual([]);
    }
  });
  it("checks exact permitted media and translation items afresh without exposing a sibling or parent-wide comment", async () => {
    seed();
    await expect(mediaAccessPort.authorize(actor(), { kind: "po", id: 101, parentId: 1 })).resolves.toBeUndefined();
    await expect(mediaAccessPort.authorize(actor(), { kind: "po", id: 102, parentId: 1 })).rejects.toThrow();
    await expect(authorizeBusinessPurchaseTranslationRows(actor(), "PO_ITEM", [{ id: 101, parentId: 1 }])).resolves.toBeUndefined();
    await expect(authorizeBusinessPurchaseTranslationRows(actor(), "PO_ITEM", [{ id: 102, parentId: 1 }])).rejects.toThrow();
    await expect(authorizeBusinessPurchaseTranslationRows(actor(), "PO_COMMENT", [{ id: 55, parentId: 1, purchaseOrderItemId: null }])).rejects.toThrow();
    await expect(authorizeBusinessTranslationParents(actor(), "po", [1])).rejects.toThrow();
    state.parent = null;
    await expect(mediaAccessPort.authorize(actor(), { kind: "po", id: 101, parentId: 1 })).rejects.toThrow();
  });
  it("routes accountant translation APIs through exact scoped item authorization too", async () => {
    seed(1, "pending_management", 11, "pending_accounting"); state.parent = order(1, "pending_management");
    const read = vi.fn();
    const port: any = { parents: async (_type: any, ids: number[]) => ids.map(id => ({ id, parentId: 1 })), authorize: read, authorizeRows: authorizeBusinessPurchaseTranslationRows };
    await expect(assertBusinessTranslationAccess(actor("accountant", 8), { entityType: "PO_ITEM", entityIds: [101] }, "batch", port)).resolves.toBeUndefined();
    await expect(assertBusinessTranslationAccess(actor("accountant", 8), { entityType: "PO_ITEM", entityIds: [102] }, "batch", port)).rejects.toThrow();
    expect(read).not.toHaveBeenCalled();
    await expect(authorizeBusinessTranslationParents(actor("accountant", 8), "po", [1])).rejects.toThrow();
  });
});

describe("Actual PB queries with a new partial finance exception", () => {
  function partial() {
    seed(); seed(2, "pending_accounting", 21, "pending_management", 201);
    memory.memory.exec("INSERT INTO purchase_packages VALUES(50); INSERT INTO purchase_package_submissions(id,purchasePackageId,status) VALUES(51,50,'pending_management'); UPDATE purchase_orders SET packageId=50; UPDATE po_pricing_batches SET purchasePackageSubmissionId=51; UPDATE po_pricing_batches SET accountingApprovedAt=NULL WHERE id=21");
    const parents = [{ ...order(), packageId: 50 }, { ...order(2), packageId: 50 }];
    const submission = { id: 51, purchasePackageId: 50, subNumber: 1, status: "pending_management", totalEstimatedCost: "999", custodyBalance: "600", accountingSignatureSnapshot: "AGGREGATE-SIGNATURE", accountingApprovedById: 8,
      batches: [{ id: 11, purchaseOrderId: 1, purchasePackageSubmissionId: 51, status: "pending_management", totalEstimatedCost: "100" },
        { id: 21, purchaseOrderId: 2, purchasePackageSubmissionId: 51, status: "pending_management", totalEstimatedCost: "899" }] };
    return { parents, submission };
  }
  it("redacts the partial aggregate header and omits its aggregate approval card, rather than offering approval of hidden members", async () => {
    const { parents, submission } = partial(), caller = packageCaller(parents, submission);
    const detail = await caller.submissions({ packageId: 50 });
    expect(detail).toHaveLength(1);
    expect(detail[0].batches.map((batch: any) => batch.id)).toEqual([11]);
    expect(detail[0]).toMatchObject({ id: 51, status: "pending_management", totalEstimatedCost: null, custodyBalance: null, accountingSignatureSnapshot: null, accountingApprovedById: null, pdfAllowed: false });
    expect(await caller.actionableSubmissionsForMe()).toEqual({ items: [], total: 0 });
  });
  it("does not change the prior normal-root PB response, even where that historic view was partial", async () => {
    const { parents, submission } = partial();
    parents[0].status = "pending_management";
    memory.memory.exec("UPDATE purchase_orders SET status='pending_management' WHERE id=1");
    const caller = packageCaller(parents, submission), detail = await caller.submissions({ packageId: 50 });
    expect(detail[0]).toMatchObject({ totalEstimatedCost: "999", custodyBalance: "600", accountingSignatureSnapshot: "AGGREGATE-SIGNATURE" });
    expect((await caller.actionableSubmissionsForMe()).items).toHaveLength(1);
  });
  it("allows a complete new finance submission and does not let a rejected inactive member block it when source membership is valid", async () => {
    const { parents, submission } = partial();
    memory.memory.exec("UPDATE po_pricing_batches SET accountingApprovedAt='2026-11-05 09:00:00' WHERE id=21");
    const complete = packageCaller(parents, submission);
    expect((await complete.submissions({ packageId: 50 }))[0].accountingSignatureSnapshot).toBe("AGGREGATE-SIGNATURE");
    expect((await complete.actionableSubmissionsForMe()).items).toHaveLength(1);
    memory.memory.exec("UPDATE po_pricing_batches SET status='rejected' WHERE id=21");
    submission.batches[1].status = "rejected";
    expect((await packageCaller(parents, submission).actionableSubmissionsForMe()).items).toHaveLength(1);
    submission.batches[1].purchasePackageSubmissionId = 999;
    expect((await packageCaller(parents, submission).actionableSubmissionsForMe()).items).toEqual([]);
  });
});

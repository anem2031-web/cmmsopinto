import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { emergencyAccountingArrival, readCandidatePurchaseHeaders, readYourWorkPurchases, type YourWorkPurchasePorts } from "../services/your-work/purchases";
import { yourWorkMillis } from "../../shared/your-work";
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");

// SQLite accepts JOIN ON subqueries which the deployed TiDB planner rejects.
// Keep its dialect boundary explicit before executing the real production SQL.
function assertTiDbJoinShape(text: string) {
  for (const on of Array.from(text.matchAll(/\bJOIN\b[\s\S]*?\bON\b([\s\S]*?)(?=\bJOIN\b|\bWHERE\b|$)/gi))) {
    if (/\b(?:SELECT|EXISTS)\b/i.test(on[1])) throw Error("TiDB does not support subqueries in JOIN ON");
  }
}

const f = vi.hoisted(() => ({ review: [] as any[], legacy: [] as any[] }));
vi.mock("../_core/db", () => ({
  getPurchaseItemReviewScopeRows: async () => f.review,
  getLegacyPricingBatchReadScopeRows: async () => f.legacy,
  getUserIdsByRole: async () => [],
}));
const user = (role = "general_maintenance_manager", id = 7) => ({ id, role, isActive: 1, preferredLanguage: "ar" });
const ctx = (actor = user()): any => ({ user: actor, authenticatedUser: actor, req: {}, res: {} });
const po = (id = 1, status = "pending_review", requestedById = 7): any => ({ id, poNumber: `PR-${id}`, status, requestedById, submittedAt: "2026-11-28 08:00:00" });
const item = (id = 10, purchaseOrderId = 1, status = "pending_review", reviewRole: string | null = "general_maintenance_manager"): any => ({
  id, purchaseOrderId, itemName: `Item-${id}`, status, reviewRole, reviewedAt: null, reviewedById: null,
});
function port(orders: any[] = [], items: any[] = [], extra: Partial<YourWorkPurchasePorts> = {}): Partial<YourWorkPurchasePorts> {
  return {
    database: vi.fn(async () => ({})), orders: vi.fn(async () => orders), items: vi.fn(async () => items),
    metadata: vi.fn(async () => ({ batches: [], comments: [], history: [], tables: new Set<string>() })),
    submissions: vi.fn(async () => []), bundleEnabled: () => false,
    bundleQueue: vi.fn(async () => ({ items: [], nextId: null })), bundleTimes: vi.fn(async () => []),
    specifications: vi.fn(async () => ({ rows: [], total: 0 })), returns: vi.fn(async () => ({ items: [], total: 0 })),
    returnTimes: vi.fn(async () => []), pendingInventory: vi.fn(async () => []), contexts: vi.fn(async () => new Map()), ...extra,
  };
}
beforeEach(() => { f.review = []; f.legacy = []; });

describe("Personal purchase work reuses actual role and record guards", () => {
  it("includes only routed items the current reviewer can act on and independently excludes missing parents", async () => {
    const orders = [po()], items = [item(), item(11, 1, "pending_review", "construction_procurement_manager"), item(12, 999)];
    const input = port(orders, items, { metadata: async () => ({ batches: [], comments: [], tables: new Set(), history: [{ purchaseOrderItemId: 10, reviewStartedAt: "2026-11-28 09:15:00" }] }) });
    const output = await readYourWorkPurchases(ctx(), input);
    expect(output.map(row => row.key)).toEqual(["pr:1:review:10"]);
    expect(output[0]).toMatchObject({ href: "/purchase-orders/1?itemId=10", action: "purchase_review", arrivedAt: yourWorkMillis("2026-11-28 09:15:00") });
    expect(input.items).toHaveBeenCalledTimes(1);
  });
  it("uses a proven submission for a first review and leaves a later unproven item arrival unknown", async () => {
    const rows = [item(), { ...item(11), createdAt: "2026-11-28 09:00:00" }];
    rows[0].createdAt = "2026-11-28 07:00:00";
    const output = await readYourWorkPurchases(ctx(), port([po()], rows));
    expect(output.map(row => row.arrivedAt)).toEqual([yourWorkMillis("2026-11-28 08:00:00"), null]);
  });
  it("uses resubmission rather than initial creation/submission for repeated header review", async () => {
    const p = port([po()], [item(10, 1, "pending", null)], { metadata: async () => ({ batches: [], tables: new Set(), history: [], comments: [{ purchaseOrderId: 1, resubmittedAt: "2026-11-28 14:00:00" }] }) });
    expect((await readYourWorkPurchases(ctx(), p))[0].arrivedAt).toBe(yourWorkMillis("2026-11-28 14:00:00"));
  });
  it.each(["purchase_requester", "operator", "owner", "admin"])("keeps creator revisions personal for %s", async role => {
    const orders = [po(1, "revision_needed"), po(2, "revision_needed", 99), po(3, "pending_estimate")];
    const returned = { ...item(13, 3, "needs_item_revision", null), itemRevisionRequestedAt: "2026-11-28 10:00:00" };
    const p = port(orders, [returned], { metadata: async () => ({ batches: [], tables: new Set(), history: [], comments: [{ purchaseOrderId: 1, returnedAt: "2026-11-28 09:00:00" }] }) });
    const result = await readYourWorkPurchases(ctx(user(role)), p);
    expect(result.map(row => row.key)).toEqual(["pr:1:revision", "pr:3:returned:13"]);
    expect(result.every(row => row.action === "purchase_revision")).toBe(true);
  });
  it("does not assign owners/admins other people's drafts, delegate pricing or purchasing", async () => {
    for (const role of ["owner", "admin"]) {
      const output = await readYourWorkPurchases(ctx(user(role)), port([po(1, "draft", 99), po(2, "pending_estimate", 99), po(3, "approved", 99)], [item(10, 2, "pending", null), item(11, 3, "approved", null)]));
      expect(output).toEqual([]);
    }
  });
  it.each(["purchase_requester", "owner", "admin"])("keeps an unsubmitted %s own draft actionable without inventing an arrival", async role => {
    const p = port([{ ...po(1, "draft"), createdAt: "2020-01-01 09:00:00" }, po(2, "draft", 99)]);
    expect(await readYourWorkPurchases(ctx(user(role)), p)).toEqual([{ key: "pr:1:draft", kind: "purchase", reference: "PR-1", action: "purchase_draft", href: "/purchase-orders/edit-draft/1", arrivedAt: null }]);
  });
  it("keeps legacy delegate changes with the actual original header reviewer", async () => {
    const orders = [{ ...po(1, "pending_estimate"), reviewedById: 99 }, { ...po(2, "pending_estimate"), reviewedById: 7 }];
    const items = [1, 2].map(id => ({ ...item(id, id, "pending", null), reviewedById: 7, delegateChangeRequestedAt: "2026-11-28 10:00:00" }));
    expect((await readYourWorkPurchases(ctx(), port(orders, items))).map(row => row.key)).toEqual(["pr:2:delegate:2"]);
  });
  it("retains a cancellation decision only for its requester, with the recorded cancellation time", async () => {
    const output = await readYourWorkPurchases(ctx(), port([po(1, "partial_purchase"), po(2, "partial_purchase", 88)], [
      { ...item(10, 1, "purchase_cancelled", null), purchaseCancelledAt: "2026-11-28 11:00:00" },
      item(11, 2, "purchase_cancelled", null),
    ]));
    expect(output).toHaveLength(1); expect(output[0].action).toBe("purchase_cancel_review");
    expect(output[0].arrivedAt).toBe(yourWorkMillis("2026-11-28 11:00:00"));
  });
  it("uses DPB > PB > individual finance while preserving independent item review", async () => {
    const orders = [po(1, "pending_management"), { ...po(2, "pending_management"), packageId: 30, packageNumber: "PB-30" }];
    const items = [item(100, 1, "estimated", null), item(101, 2, "estimated", null), item(102, 1, "estimated", null), item(103, 1, "pending_review", "senior_management")];
    items[0].batchId = 10; items[1].batchId = 11; items[2].batchId = 12;
    const batches = [{ id: 10, purchaseOrderId: 1, status: "pending_management", unifiedManaged: 1 },
      { id: 11, purchaseOrderId: 2, status: "pending_management", purchasePackageSubmissionId: 20 },
      { id: 12, batchNumber: 3, purchaseOrderId: 1, status: "pending_management", accountingApprovedById: 9, accountingApprovedAt: "2026-11-28 09:00:00" }];
    const p = port(orders, items, {
      bundleEnabled: () => true,
      bundleQueue: async (_actor, _after, stage) => ({ items: stage === "management" ? [{ id: 40, status: "pending_management", bundleNumber: "DPB-40", orderIds: [1], batchIds: [10], submissionIds: [] }] : [], nextId: null }),
      bundleTimes: async () => [{ bundleId: 40, accountingApprovedAt: "2026-11-28 09:00:00" }],
      metadata: async () => ({ batches, tables: new Set(), history: [], comments: [] }),
      submissions: async () => [{ id: 20, purchasePackageId: 30, subNumber: 2, status: "pending_management", accountingApprovedAt: "2026-11-28 10:00:00", batches: [batches[1]] }],
    });
    const output = await readYourWorkPurchases(ctx(user("senior_management")), p);
    expect(output.map(row => row.key)).toEqual(["dpb:40:management", "pb:20:management", "pr:1:review:103", "pr-batch:12:management"]);
    expect(output.find(row => row.kind === "pricing_submission")?.reference).toBe("PB-30-2");
  });
  it("does not treat partial emergency receipt progress as actionable approval", async () => {
    const p = port([po(1, "partial_purchase")], [{ ...item(1, 1, "estimated", null), batchId: 10 }], {
      bundleEnabled: () => true, bundleQueue: async () => ({ items: [{ id: 1, status: "awaiting_receipt", approvalReady: false }], nextId: null }),
      metadata: async () => ({ batches: [{ id: 10, purchaseOrderId: 1, status: "pending_accounting", unifiedManaged: 1 }], tables: new Set(), history: [], comments: [] }),
    });
    expect(await readYourWorkPurchases(ctx(user("accountant")), p)).toEqual([]);
  });
  it("reads every queue page and leaves emergency accounting arrival unknown", async () => {
    const queue = vi.fn(async (_actor, after: number) => ({ items: [{ id: after + 1, status: "pending_accounting", bundleNumber: `DPB-${after + 1}`, emergencyPurchase: true }], nextId: after === 0 ? 1 : null }));
    const p = port([], [], { bundleEnabled: () => true, bundleQueue: queue });
    const output = await readYourWorkPurchases(ctx(user("accountant")), p);
    expect(queue).toHaveBeenCalledTimes(2); expect(output.map(row => row.arrivedAt)).toEqual([null, null]);
  });
  it("starts emergency accounting at the exact final receipt/cancellation, never submission or mutable root time", async () => {
    expect(emergencyAccountingArrival([{ receiptAt: "2026-11-28 09:00:00" }, { receiptAt: "2026-11-28 12:00:00" }])).toBe(yourWorkMillis("2026-11-28 12:00:00"));
    expect(emergencyAccountingArrival([{ receiptAt: "2026-11-28 09:00:00" }, { cancelledAt: "2026-11-28 13:00:00" }])).toBe(yourWorkMillis("2026-11-28 13:00:00"));
    expect(emergencyAccountingArrival([{ receiptAt: "2026-11-28 09:00:00" }, {}])).toBeNull();
    expect(emergencyAccountingArrival([{ cancelledAt: "2026-11-28 13:00:00" }])).toBeNull();
    const p = port([], [], { bundleEnabled: () => true,
      bundleQueue: async () => ({ items: [{ id: 1, status: "pending_accounting", bundleNumber: "DPB-1", emergencyPurchase: true }], nextId: null }),
      bundleTimes: async () => [{ bundleId: 1, emergencyAccountingAt: yourWorkMillis("2026-11-28 13:00:00"), snapshotJson: { submittedAt: "2026-11-20T09:00:00Z" }, updatedAt: "2026-11-30 13:00:00" }],
    });
    expect((await readYourWorkPurchases(ctx(user("accountant")), p))[0].arrivedAt).toBe(yourWorkMillis("2026-11-28 13:00:00"));
  });
  it("rejects an aggregate PB whose complete membership cannot be approved by the actual actor", async () => {
    const batches = [{ id: 10, purchaseOrderId: 1, purchasePackageSubmissionId: 30, status: "pending_accounting" }, { id: 11, purchaseOrderId: 999, purchasePackageSubmissionId: 30, status: "pending_accounting" }];
    const p = port([{ ...po(1, "pending_accounting"), packageId: 3 }], [{ ...item(10, 1, "estimated", null), batchId: 10 }], {
      metadata: async () => ({ tables: new Set(), batches, comments: [], history: [] }),
      submissions: async () => [{ id: 30, purchasePackageId: 3, subNumber: 1, status: "pending_accounting", batches }],
    });
    expect(await readYourWorkPurchases(ctx(user("accountant")), p)).toEqual([]);
  });
  it("only offers actual warehouse receipt stages and excludes external maintenance services", async () => {
    const orders = [po(1, "partial_purchase"), po(2, "purchased"), po(3, "received")];
    const items = [{ ...item(10, 1, "purchased", null), purchasedAt: "2026-11-28 09:00:00" }, item(11, 2, "purchased", null), item(12, 3, "delivered_to_warehouse", null), item(13, 3, "delivered_to_warehouse", null)];
    const p = port(orders, items, { contexts: async () => new Map([[2, { externalJob: { id: 3 } }]]), pendingInventory: async () => [items[2]], metadata: async () => ({ tables: new Set(), comments: [], batches: [], history: [{ purchaseOrderItemId: 12, warehouseStartedAt: "2026-11-28 10:00:00" }] }) });
    const output = await readYourWorkPurchases(ctx(user("warehouse")), p);
    expect(output.map(row => row.key)).toEqual(["pr:1:receive:10", "pr:3:entry:12"]);
    expect(output[1].href).toBe("/warehouse/receive-v2?poId=3");
  });
  it("offers pending specification decisions to decision roles, never senior view-only", async () => {
    const spec = vi.fn(async () => ({ rows: [{ id: 30, poNumber: "PR-1", itemName: "Material", receivedAt: "2026-11-28 09:00:00" }], total: 1 }));
    const p = port([], [], { specifications: spec });
    expect((await readYourWorkPurchases(ctx(user("construction_procurement_manager")), p))[0]).toMatchObject({ key: "specification:30", href: "/purchase-orders?workView=specifications&focusId=30&focusPage=1" });
    expect(await readYourWorkPurchases(ctx(user("senior_management")), p)).toEqual([]); expect(spec).toHaveBeenCalledTimes(1);
  });
  it("offers only rejected warehouse return handoffs and ready creator choices", async () => {
    const p = port([], [], {
      metadata: async () => ({ batches: [], comments: [], history: [], tables: new Set(["supplier_return_cases", "supplier_return_events"]) }),
      returns: async () => ({ total: 4, items: [
        { id: 1, returnNumber: "RTN-1", handoverStatus: "rejected" },
        { id: 2, returnNumber: "RTN-2", handoverStatus: "accepted", creatorId: 7, creatorDecision: "pending", resolution: "change_item", originalPurchaseValue: "4", currency: "SAR", valuationBasis: "tax_inclusive" },
        { id: 3, returnNumber: "RTN-3", handoverStatus: "accepted", creatorId: 99, creatorDecision: "pending", resolution: "change_item" },
        { id: 4, returnNumber: "RTN-4", handoverStatus: "accepted", creatorId: 7, creatorDecision: "pending", resolution: "refund", originalPurchaseValue: "4", currency: "SAR", valuationBasis: "tax_inclusive" },
      ] }), returnTimes: async () => [{ caseId: 1, rejectedAt: "2026-11-28 09:00:00" }, { caseId: 2, resolutionAt: "2026-11-28 10:00:00" }],
    });
    expect((await readYourWorkPurchases(ctx(user("warehouse")), p)).map(row => row.key)).toEqual(["supplier-return:1", "supplier-return:2"]);
  });
  it("rejects excluded/inactive original identities before any source read, including admin projections", async () => {
    const p = port();
    for (const role of ["delegate", "delegate_manager", "purchase_manager", "technician", "gate_security", "observer"]) {
      await expect(readYourWorkPurchases({ ...ctx(user(role)), user: user("admin") }, p)).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    await expect(readYourWorkPurchases(ctx({ ...user(), isActive: 0 }), p)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(p.database).not.toHaveBeenCalled();
  });
  it("propagates source failures and rejects stalled cursors instead of returning partial success", async () => {
    await expect(readYourWorkPurchases(ctx(), port([], [], { metadata: async () => { throw Error("Fixture unavailable"); } }))).rejects.toThrow("Fixture unavailable");
    await expect(readYourWorkPurchases(ctx(user("accountant")), port([], [], { bundleEnabled: () => true, bundleQueue: async () => ({ items: [], nextId: 0 }) }))).rejects.toThrow("تعذر متابعة");
  });
});

describe("Actual batched SQL metadata on an isolated database fixture", () => {
  it("rejects a TiDB-incompatible JOIN ON subquery before SQLite can accept it", () => {
    expect(() => assertTiDbJoinShape("SELECT p.id FROM purchase_orders p LEFT JOIN purchase_order_items i ON i.id IN (SELECT id FROM purchase_order_items) WHERE p.id=1"))
      .toThrow("TiDB does not support subqueries in JOIN ON");
    expect(() => assertTiDbJoinShape("SELECT p.id FROM purchase_orders p LEFT JOIN purchase_order_items i ON i.purchaseOrderId=p.id WHERE EXISTS (SELECT 1 FROM purchase_order_items j WHERE j.id=i.id)"))
      .not.toThrow();
  });
  it("proves an emergency accounting arrival from all physical receipt/cancellation members using the actual SQL", async () => {
    const memory = new DatabaseSync(":memory:");
    memory.exec(`CREATE TABLE delegate_pricing_bundle_approvals (bundleId INT,accountingApprovedAt TEXT);
      CREATE TABLE delegate_pricing_bundles (id INT,snapshotJson TEXT);
      CREATE TABLE emergency_purchase_items (bundleId INT,purchaseOrderItemId INT,cancelledAt TEXT);
      CREATE TABLE warehouse_receipt_items (id INT,purchaseOrderItemId INT,receiptId INT,receivedQuantity INT);
      CREATE TABLE warehouse_receipts (id INT,status TEXT,createdAt TEXT);
      CREATE TABLE inventory_lots (id INT,receiptId INT,receiptItemId INT,purchaseOrderItemId INT);
      INSERT INTO delegate_pricing_bundle_approvals VALUES (5,NULL);
      INSERT INTO delegate_pricing_bundles VALUES (5,'{"submittedAt":"2026-11-20T08:00:00Z"}');
      INSERT INTO emergency_purchase_items VALUES (5,10,NULL),(5,11,'2026-11-29 09:00:00');
      INSERT INTO warehouse_receipts VALUES (50,'confirmed','2026-11-28 10:00:00'),(51,'confirmed','2026-11-30 10:00:00'),(52,'draft','2026-11-21 10:00:00');
      INSERT INTO warehouse_receipt_items VALUES (60,10,50,1),(61,10,51,1),(62,10,52,1);
      INSERT INTO inventory_lots VALUES (70,50,60,10),(71,51,61,10),(72,52,62,10);`);
    const dialect = new MySqlDialect(), queries: string[] = [];
    const database = { execute: async (query: any) => { const rendered = dialect.sqlToQuery(query); assertTiDbJoinShape(rendered.sql); queries.push(rendered.sql); return [memory.prepare(rendered.sql).all(...rendered.params as any[])]; } };
    const p = port([], [], { database: async () => database, bundleEnabled: () => true,
      bundleQueue: async () => ({ items: [{ id: 5, status: "pending_accounting", bundleNumber: "DPB-5", emergencyPurchase: true }], nextId: null }),
    });
    delete p.bundleTimes;
    try {
      const output = await readYourWorkPurchases(ctx(user("accountant")), p);
      expect(output[0].arrivedAt).toBe(yourWorkMillis("2026-11-29 09:00:00"));
      expect(queries).toHaveLength(2);
      expect(queries.every(query => !/INSERT|UPDATE|DELETE|FOR UPDATE/i.test(query))).toBe(true);
      memory.exec("INSERT INTO emergency_purchase_items VALUES (5,12,NULL)");
      expect((await readYourWorkPurchases(ctx(user("accountant")), p))[0].arrivedAt).toBeNull();
    } finally { memory.close(); }
  });
  it("selects current candidate headers before enrichment, retaining mixed-stage batches without loading inactive history", async () => {
    const memory = new DatabaseSync(":memory:");
    memory.exec(`CREATE TABLE purchase_orders (id INT,poNumber TEXT,status TEXT,requestedById INT,packageId INT);
      CREATE TABLE purchase_packages (id INT,packageNumber TEXT);
      CREATE TABLE purchase_order_items (id INT,purchaseOrderId INT,status TEXT,delegateChangeRequestedAt TEXT,batchId INT);
      CREATE TABLE po_pricing_batches (id INT,purchaseOrderId INT,status TEXT);
      INSERT INTO purchase_orders VALUES (1,'PR-1','pending_review',7,NULL),(2,'PR-2','closed',99,NULL),(3,'PR-3','received',99,8),(4,'PR-4','draft',99,NULL),(5,'PR-5','partial_purchase',7,NULL),(6,'PR-6','draft',7,NULL);
      INSERT INTO purchase_packages VALUES (8,'PB-8');
      INSERT INTO po_pricing_batches VALUES (30,3,'pending_accounting');
      INSERT INTO purchase_order_items VALUES (50,5,'purchased',NULL,NULL),(20,2,'pending_review',NULL,NULL);`);
    const dialect = new MySqlDialect();
    const database = { execute: async (query: any) => { const rendered = dialect.sqlToQuery(query); assertTiDbJoinShape(rendered.sql); return [memory.prepare(rendered.sql).all(...rendered.params as any[])]; } };
    try {
      expect((await readCandidatePurchaseHeaders(database, user("warehouse"))).map(row => row.id)).toEqual([1, 3, 5, 6]);
      expect((await readCandidatePurchaseHeaders(database, user("operator"))).map(row => row.id)).toEqual([1, 6]);
      expect((await readCandidatePurchaseHeaders(database, user("accountant"))).find(row => row.id === 3)?.packageNumber).toBe("PB-8");
      memory.exec(`CREATE TABLE users(id INT,role TEXT);
        INSERT INTO users VALUES(70,'food_warehouse_assistant'),(71,'operator');
        INSERT INTO purchase_orders VALUES(7,'PR-7','pending_review',70,NULL),(8,'PR-8','pending_review',71,NULL),(9,'PR-9','draft',70,NULL);`);
      expect((await readCandidatePurchaseHeaders(database, user("food_warehouse_manager"))).map(row => row.id)).toEqual([1, 6, 7]);
      expect((await readCandidatePurchaseHeaders(database, user("operator"))).map(row => row.id)).toEqual([1, 6]);
    } finally { memory.close(); }
  });
  it("includes NULL initial transitions, uses real table/column names, and bounds 1200 distinct items by chunks", async () => {
    const memory = new DatabaseSync(":memory:");
    memory.exec(`CREATE TABLE po_pricing_batches (id INT,purchaseOrderId INT,status TEXT);
      CREATE TABLE delegate_pricing_bundle_batches (pricingBatchId INT,bundleId INT);
      CREATE TABLE delegate_pricing_bundle_approvals (bundleId INT);
      CREATE TABLE procurement_comments (purchaseOrderId INT,actionType TEXT,createdAt TEXT);
      CREATE TABLE purchase_order_item_history (purchaseOrderItemId INT,newStatus TEXT,previousStatus TEXT,createdAt TEXT);`);
    const write = memory.prepare("INSERT INTO purchase_order_item_history VALUES (?,'pending_review',NULL,'2026-11-28 09:00:00')");
    for (let id = 1; id <= 1200; id++) write.run(id);
    const queries: string[] = [], dialect = new MySqlDialect();
    const database = { execute: async (query: any) => {
      const rendered = dialect.sqlToQuery(query); assertTiDbJoinShape(rendered.sql); queries.push(rendered.sql);
      if (rendered.sql.includes("information_schema.TABLES")) return [[{ name: "purchase_order_item_history" }, { name: "delegate_pricing_bundle_approvals" }]];
      return [memory.prepare(rendered.sql).all(...rendered.params as any[])];
    } };
    const p = port([po()], Array.from({ length: 1200 }, (_, index) => item(index + 1)), { database: async () => database });
    delete p.metadata;
    try {
      const output = await readYourWorkPurchases(ctx(), p);
      expect(output).toHaveLength(1200);
      expect(output.every(row => row.arrivedAt === yourWorkMillis("2026-11-28 09:00:00"))).toBe(true);
      expect(queries).toHaveLength(6); // table inventory + batches + comments + three 500-item chunks.
      expect(queries.filter(query => query.includes("FROM purchase_order_item_history"))).toHaveLength(3);
      expect(queries.every(query => !/INSERT|UPDATE|DELETE|FOR UPDATE/i.test(query))).toBe(true);
    } finally { memory.close(); }
  });
});

describe("Original-page deep links only select and scroll; never execute actions", () => {
  function code(file: string, find: (node: ts.Node, source: ts.SourceFile) => string | null) {
    const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let found: string | null = null;
    const visit = (node: ts.Node) => { found ??= find(node, source); if (!found) ts.forEachChild(node, visit); };
    visit(source); if (!found) throw Error(`Missing real navigation code in ${file}`);
    return ts.transpileModule(`(${found})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  }
  const scrolling = (node: ts.Node, source: ts.SourceFile) => ts.isCallExpression(node) && node.expression.getText(source) === "useEffect" &&
    node.arguments[0].getText(source).includes("scrollIntoView") ? node.arguments[0].getText(source) : null;
  it.each([
    ["client/src/components/purchase/SupplierReturns.tsx", { workFocusId: 17, list: { data: { items: [{ id: 17 }] } } }, "supplier-return-17"],
    ["client/src/pages/purchase/PurchaseOrderDetail.tsx", { focusedBatchId: 17, pricingBatches: [{ id: 17 }] }, "purchase-pricing-batch-17"],
    ["client/src/pages/purchase/PurchaseOrders.tsx", { workSpecificationView: true, canViewSpecifications: true, workFocusId: 17, specifications: { data: { rows: [{ id: 17 }] } } }, "purchase-specification-17"],
  ] as const)("the actual %s effect scrolls only to its loaded, permitted source row", (file, scope, expectedId) => {
    const scroll = vi.fn(), lookup = vi.fn((id: string) => id === expectedId ? { scrollIntoView: scroll } : null);
    // PurchaseOrderDetail also contains the older item-scroll effect; choose the new batch-specific effect explicitly.
    const finder = file.includes("PurchaseOrderDetail") ? (node: ts.Node, source: ts.SourceFile) => {
      const text = scrolling(node, source); return text?.includes("purchase-pricing-batch-") ? text : null;
    } : scrolling;
    const run = vm.runInNewContext(code(file, finder), { ...scope, Number, window: { setTimeout: (fn: () => void) => { fn(); return 1; }, clearTimeout: vi.fn() }, document: { getElementById: lookup } });
    run(); expect(lookup).toHaveBeenCalledWith(expectedId); expect(scroll).toHaveBeenCalledOnce();
  });
  it("does not navigate into specification data without the existing page permission", () => {
    const lookup = vi.fn();
    const run = vm.runInNewContext(code("client/src/pages/purchase/PurchaseOrders.tsx", scrolling), {
      workSpecificationView: true, canViewSpecifications: false, workFocusId: 17,
      specifications: { data: { rows: [{ id: 17 }] } }, Number, window: { setTimeout: vi.fn() }, document: { getElementById: lookup },
    });
    run(); expect(lookup).not.toHaveBeenCalled();
  });
});

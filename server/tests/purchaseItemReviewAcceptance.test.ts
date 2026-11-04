import { afterEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { sql } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { reviewRoutedPurchaseItems } from "../services/purchase-item-review";
import { UnifiedBundleApprovalService } from "../services/delegate-pricing-bundles/unified-approval";
import { assertCanReviewPurchaseOrderItems } from "../_core/authz/guard";
import { assertPOVisible, assertCanPerformAction } from "../_core/authz/engine";
import { canApprovePricingBundleStage } from "../../shared/business-role-policy";
import { getDelegateItemActionMode, computeActionablePOs } from "../routers/purchase/actionable";

// These tests never import a pool, environment, OCR, storage, or a network client.
vi.mock("../_core/db", () => ({}));
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite");
const close: Array<() => void> = [];
afterEach(() => close.splice(0).forEach(fn => fn()));
const people = [
  { id: 31, role: "general_maintenance_manager", isActive: 1, name: "Maintenance reviewer", signatureUrl: "old-maintenance.png" },
  { id: 32, role: "construction_procurement_manager", isActive: 1, name: "Construction reviewer", signatureUrl: "old-construction.png" },
  { id: 33, role: "senior_management", isActive: 1, name: "Senior reviewer", signatureUrl: "old-senior.png" },
  { id: 41, role: "delegate", isActive: 1, name: "Delegate", signatureUrl: null },
];
const op = (id: number) => `00000000-0000-4000-8000-${String(id).padStart(12, "0")}`;

function fixture(source?: "ticket" | "pmv2" | "return") {
  const memory = new DatabaseSync(":memory:"); close.push(() => memory.close());
  memory.exec(`
    CREATE TABLE users(id INTEGER PRIMARY KEY,role TEXT,isActive INTEGER,name TEXT,signatureUrl TEXT);
    CREATE TABLE purchase_packages(id INTEGER PRIMARY KEY,packageNumber TEXT);
    CREATE TABLE purchase_orders(id INTEGER PRIMARY KEY,poNumber TEXT,status TEXT,packageId INTEGER,requestedById INTEGER,ticketId INTEGER,ticketItemId INTEGER,siteId INTEGER,sectionId INTEGER,reviewedById INTEGER,reviewedAt TEXT,reviewerSignatureSnapshot TEXT,rejectedById INTEGER,rejectedAt TEXT,rejectionReason TEXT);
    CREATE TABLE purchase_order_items(id INTEGER PRIMARY KEY,purchaseOrderId INTEGER,itemName TEXT,quantity NUMERIC,unit TEXT,status TEXT,reviewRole TEXT,reviewedById INTEGER,reviewedAt TEXT,reviewerSignatureSnapshot TEXT,delegateId INTEGER,delegateAssignedAt TEXT,managementRejectionReason TEXT,batchId INTEGER,estimatedUnitCost TEXT,estimatedTotalCost TEXT,catalogItemId INTEGER);
    CREATE TABLE delegate_pricing_bundles(id INTEGER PRIMARY KEY,bundleNumber TEXT,delegateId INTEGER,snapshotJson TEXT);
    CREATE TABLE delegate_pricing_bundle_items(bundleId INTEGER,purchaseOrderItemId INTEGER,removedAt TEXT);
    CREATE TABLE delegate_pricing_bundle_batches(bundleId INTEGER,purchaseOrderId INTEGER,pricingBatchId INTEGER,purchasePackageSubmissionId INTEGER);
    CREATE TABLE delegate_pricing_bundle_approvals(bundleId INTEGER PRIMARY KEY,status TEXT,revision INTEGER DEFAULT 0,custodyBalance TEXT,accountingApprovedById INTEGER,accountingApprovedAt TEXT,accountingSignatureSnapshot TEXT,accountingNotes TEXT,accountingRejections TEXT,accountingOperationKey TEXT,accountingRequestHash TEXT,managementApprovedById INTEGER,managementApprovedAt TEXT,managementSignatureSnapshot TEXT,managementNotes TEXT,managementRejections TEXT,managementOperationKey TEXT,managementRequestHash TEXT,sendEffectsDone INTEGER DEFAULT 1,accountingEffectsDone INTEGER DEFAULT 0,managementEffectsDone INTEGER DEFAULT 0);
    CREATE TABLE po_pricing_batches(id INTEGER PRIMARY KEY,purchaseOrderId INTEGER,batchNumber INTEGER,submittedById INTEGER,purchasePackageSubmissionId INTEGER,status TEXT,itemCount INTEGER,totalEstimatedCost TEXT,custodyAmount TEXT,accountingApprovedById INTEGER,accountingApprovedAt TEXT,accountingSignatureSnapshot TEXT,accountingNotes TEXT,managementApprovedById INTEGER,managementApprovedAt TEXT,managementNotes TEXT);
    CREATE TABLE purchase_package_submissions(id INTEGER PRIMARY KEY,purchasePackageId INTEGER,status TEXT);
    CREATE TABLE audit_logs(id INTEGER PRIMARY KEY,userId INTEGER,action TEXT,entityType TEXT,entityId INTEGER,newValues TEXT);
    CREATE TABLE tickets(id INTEGER PRIMARY KEY,ticketNumber TEXT);
    CREATE TABLE ticket_items(id INTEGER PRIMARY KEY,ticketId INTEGER);
    CREATE TABLE pmv2_material_purchase_links(id INTEGER PRIMARY KEY,materialRequestItemId INTEGER,purchaseOrderId INTEGER,purchaseOrderItemId INTEGER,linkedQuantity NUMERIC);
    CREATE TABLE supplier_return_cases(id INTEGER PRIMARY KEY,purchaseOrderId INTEGER,purchaseOrderItemId INTEGER);
    CREATE TABLE supplier_return_replacement_plans(id INTEGER PRIMARY KEY,caseId INTEGER,purchaseOrderId INTEGER,purchaseOrderItemId INTEGER,originalQuantityCovered NUMERIC);
    CREATE TABLE inventory(id INTEGER PRIMARY KEY,quantity NUMERIC,unit TEXT,averageCost NUMERIC,totalCostValue NUMERIC);
    CREATE TABLE inventory_lots(id INTEGER PRIMARY KEY,inventoryId INTEGER,originalQuantity NUMERIC,issueUnitCost NUMERIC);
    CREATE TABLE inventory_lot_balances(lotId INTEGER,inventoryId INTEGER,warehouseId INTEGER,quantity NUMERIC);
    INSERT INTO purchase_orders(id,poNumber,status,requestedById,ticketId,ticketItemId,siteId,sectionId) VALUES(10,'PR-10','pending_review',99,${source === "ticket" || source === "return" ? "500,501" : "NULL,NULL"},50,51);
    INSERT INTO inventory VALUES(90,17,'قطعة',3.25,55.25);
    INSERT INTO inventory_lots VALUES(900,90,17,3.25);
    INSERT INTO inventory_lot_balances VALUES(900,90,1,17);
  `);
  for (const person of people) memory.prepare("INSERT INTO users VALUES(?,?,?,?,?)").run(person.id, person.role, person.isActive, person.name, person.signatureUrl);
  const get = (table: string, id = 10) => memory.prepare(`SELECT * FROM ${table} WHERE ${table === "delegate_pricing_bundle_approvals" ? "bundleId" : "id"}=?`).get(id) as any;
  const all = () => memory.prepare("SELECT * FROM purchase_order_items ORDER BY id").all() as any[];
  const specs = source ? [{ id: 101, role: people[0].role }] : [...people.slice(0, 3).map((person, i) => ({ id: 101 + i, role: person.role })), { id: 104, role: people[1].role }];
  for (const spec of specs) memory.prepare("INSERT INTO purchase_order_items(id,purchaseOrderId,itemName,quantity,unit,status,reviewRole,catalogItemId) VALUES(?,10,?,2,'قطعة','pending_review',?,?)").run(spec.id, `Material ${spec.id}`, spec.role, spec.id + 1000);
  if (source === "ticket" || source === "return") memory.exec("INSERT INTO tickets VALUES(500,'MT-500');INSERT INTO ticket_items VALUES(501,500)");
  if (source === "pmv2") memory.exec("INSERT INTO pmv2_material_purchase_links VALUES(700,701,10,101,2)");
  if (source === "return") memory.exec("INSERT INTO supplier_return_cases VALUES(700,8,81);INSERT INTO supplier_return_replacement_plans VALUES(701,700,10,101,2)");
  const sources = () => ["tickets", "ticket_items", "pmv2_material_purchase_links", "supplier_return_cases", "supplier_return_replacement_plans"].map(table => [table, memory.prepare(`SELECT * FROM ${table} ORDER BY id`).all()]);
  const stock = () => ["inventory", "inventory_lots", "inventory_lot_balances"].map(table => [table, memory.prepare(`SELECT * FROM ${table}`).all()]);
  const dialect = new MySqlDialect();
  const tx = { execute: async (statement: any) => {
    const query = dialect.sqlToQuery(statement), text = query.sql.replace(/ FOR UPDATE/g, "");
    const prepared = memory.prepare(text);
    return /^SELECT\b/i.test(text.trim()) ? [prepared.all(...query.params as any[]), []] : [{ affectedRows: Number(prepared.run(...query.params as any[]).changes) }, []];
  } };
  let chain = Promise.resolve();
  const database = { ...tx, transaction: (fn: any) => {
    const result = chain.then(async () => { memory.exec("BEGIN"); try { const value = await fn(tx); memory.exec("COMMIT"); return value; } catch (error) { memory.exec("ROLLBACK"); throw error; } });
    chain = result.then(() => undefined, () => undefined); return result;
  } };
  const patch = (table: string, id: number, changes: any) => {
    const entries = Object.entries(changes);
    return memory.prepare(`UPDATE ${table} SET ${entries.map(([key]) => `${key}=?`).join(",")} WHERE id=?`).run(...entries.map(([, value]) => value instanceof Date ? value.toISOString() : value), id);
  };
  const review = (person: typeof people[number], ids: number[]) => database.transaction(() => reviewRoutedPurchaseItems(person, { poId: 10, items: ids.map(id => ({ id, action: "approve", delegateId: 41 })) }, {
    lockOrder: async () => get("purchase_orders"), readItems: async () => all(),
    readUsers: async ids => memory.prepare(`SELECT * FROM users WHERE id IN (${ids.map(() => "?").join(",")})`).all(...ids) as any,
    authorize: assertCanReviewPurchaseOrderItems,
    updateItem: async (row, changes) => { patch("purchase_order_items", row.id, changes); return true; },
    updateOrder: async (id, changes) => { patch("purchase_orders", id, changes); },
    audit: async (actor, order, decisions) => { memory.prepare("INSERT INTO audit_logs(userId,action,entityType,entityId,newValues) VALUES(?,'review_po_items','purchase_order',?,?)").run(actor.id, order.id, JSON.stringify(decisions)); },
  }));
  const finish = vi.fn(async () => {});
  const approval = new UnifiedBundleApprovalService({
    enabled: () => true, database: async () => database,
    readGuard: async actor => order => assertPOVisible({ role: actor.role, userId: actor.id }, order),
    authorizeStage: (actor, stage, orders) => {
      if (!canApprovePricingBundleStage(actor, stage)) throw Error("DPB stage denied");
      if (actor.role === "senior_management" && stage === "accounting") return;
      for (const order of orders) assertCanPerformAction(stage === "accounting" ? "approveAccounting" : "approveManagement", { role: actor.role, userId: actor.id }, { ...order, status: `pending_${stage}` });
    },
    updateItem: async (_tx, row, changes) => { patch("purchase_order_items", row.id, changes); },
    replacement: async () => false, finish,
  });
  // Quote/send is an integration boundary supplied by the existing real pricing-service
  // suites in acceptance.run.mjs. Build its output from actual reviewed rows, never new IDs.
  const priceAndSubmit = (selected: number[]) => {
    const rows = all().filter(row => selected.includes(row.id));
    expect(rows.every(row => getDelegateItemActionMode(get("purchase_orders").status, row) === "estimate")).toBe(true);
    for (const row of rows) patch("purchase_order_items", row.id, { status: "estimated", batchId: 1, estimatedUnitCost: "10", estimatedTotalCost: "20" });
    const order = get("purchase_orders");
    const snapshot = { number: "DPB-ACCEPTANCE", delegate: { id: 41, name: "Delegate" }, rows: all().filter(row => selected.includes(row.id)).map(row => ({ ...row, poNumber: order.poNumber, ticketId: order.ticketId, ticketItemId: order.ticketItemId, siteId: order.siteId, sectionId: order.sectionId, packageId: null })), signatures: [] };
    memory.prepare("INSERT INTO delegate_pricing_bundles VALUES(24,?,41,?)").run(snapshot.number, JSON.stringify(snapshot));
    memory.exec(`INSERT INTO delegate_pricing_bundle_approvals(bundleId,status) VALUES(24,'pending_accounting');INSERT INTO delegate_pricing_bundle_batches VALUES(24,10,1,NULL)`);
    memory.prepare("INSERT INTO po_pricing_batches(id,purchaseOrderId,batchNumber,submittedById,status,itemCount,totalEstimatedCost) VALUES(1,10,1,41,'pending_accounting',?,?)").run(rows.length, String(rows.length * 20));
    for (const id of selected) memory.prepare("INSERT INTO delegate_pricing_bundle_items VALUES(24,?,NULL)").run(id);
    patch("purchase_orders", 10, { status: "pending_accounting" });
  };
  const approve = (stage: "accounting" | "management", revision: number, n: number) => approval.approve(people[2], stage, { id: 24, revision, operationKey: op(n), custodyBalance: "265", rejections: [] });
  return { memory, get, all, review, approve, approval, priceAndSubmit, finish, sources, stock };
}

describe("Independent SQL acceptance: routed review and existing DPB approvals", () => {
  it("lets three actual reviewers send subsets, preserves an unreviewed item, then approves finance separately and allows late review without resetting the batch", async () => {
    const f = fixture(), stock = f.stock();
    const other = f.get("purchase_order_items", 104);
    await expect(f.review(people[0], [101, 102])).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(f.get("purchase_order_items", 101).status).toBe("pending_review");
    for (let i = 0; i < 3; i++) await f.review(people[i], [101 + i]);
    expect(f.get("purchase_order_items", 104)).toEqual(other);
    expect(f.all().slice(0, 3).map(row => row.reviewedById)).toEqual([31, 32, 33]);
    f.priceAndSubmit([101, 102, 103]);
    await expect(f.approve("management", 0, 1)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(f.get("delegate_pricing_bundle_approvals", 24).revision).toBe(0);
    expect((await f.approve("accounting", 0, 2)).status).toBe("pending_management");
    expect(f.all().slice(0, 3).every(row => row.status === "estimated")).toBe(true);
    expect((await f.approve("management", 1, 3)).status).toBe("approved");
    const approved = f.all().slice(0, 3), batch = f.get("po_pricing_batches", 1);
    expect(approved.every(row => getDelegateItemActionMode(f.get("purchase_orders").status, row) === "purchase")).toBe(true);
    expect(f.get("purchase_order_items", 104)).toEqual(other);
    expect(computeActionablePOs(people[1], [f.get("purchase_orders")], f.all())[0].reviewAction).toBe("review");
    await f.review(people[1], [104]);
    expect(f.get("po_pricing_batches", 1)).toEqual(batch);
    expect(f.all().slice(0, 3)).toEqual(approved);
    expect(getDelegateItemActionMode(f.get("purchase_orders").status, f.get("purchase_order_items", 104))).toBe("estimate");
    await expect(f.approve("management", 1, 3)).resolves.toMatchObject({ replayed: true });
    expect(f.get("delegate_pricing_bundle_approvals", 24)).toMatchObject({ accountingApprovedById: 33, managementApprovedById: 33, revision: 2, custodyBalance: "265" });
    expect(f.stock()).toEqual(stock);
  });
  it.each(["ticket", "pmv2", "return"] as const)("keeps the %s source identity, quantity, catalog identity, and balances through review and both financial stages", async source => {
    const f = fixture(source);
    const sourceBefore = f.sources(), stockBefore = f.stock();
    const headerBefore = f.get("purchase_orders");
    await f.review(people[0], [101]); f.priceAndSubmit([101]);
    await f.approve("accounting", 0, 5); await f.approve("management", 1, 6);
    expect(f.sources()).toEqual(sourceBefore);
    expect(f.get("purchase_orders")).toMatchObject({ id: headerBefore.id, ticketId: headerBefore.ticketId, ticketItemId: headerBefore.ticketItemId, siteId: 50, sectionId: 51 });
    expect(f.get("purchase_order_items", 101)).toMatchObject({ id: 101, purchaseOrderId: 10, catalogItemId: 1101, quantity: 2, unit: "قطعة", status: "approved", reviewedById: 31, delegateId: 41 });
    expect(f.stock()).toEqual(stockBefore);
  });
});

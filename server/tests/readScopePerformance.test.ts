import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { inArray } from "drizzle-orm";
import { tickets, ticketItems, purchaseOrders } from "../../drizzle/schema";
import { readScopeDatabase } from "./fixtures/readScopeDatabase";
import { groupReadRows, readScopeChunks } from "../_core/authz/read-batch";
import { loadTicketReadScope } from "../_core/db/ticket-read-scope";
import { assertTicketReadable } from "../routers/tickets/tickets.access";
import { loadDocumentListPort } from "../_core/db/document-list";
import { purchaseDocumentPermission } from "../_core/authz/purchase-document";
import { decorateDocumentRows } from "../_core/authz/document-list";
import { getPurchaseOrdersByIds, getPurchaseOrdersForPackages, getFullPOItemsForPOs, getPackageSubmissionsWithBatchesForPackages } from "../_core/db/purchase-read-lists";
import { assertCanViewPurchaseOrder, createPurchaseOrderReadGuard, createPurchaseOrderReadScope, filterVisiblePurchaseOrders } from "../_core/authz/guard";
import { assertBusinessTranslationAccess } from "../_core/authz/business-resources";
import { assertTechnicianTranslationAccess } from "../_core/authz/technician-resources";
import { APP_ROLE } from "../../shared/roles";
import { router, protectedProcedure } from "../_core/trpc";

const state = vi.hoisted(() => ({ database: null as any, delegates: vi.fn(), assistants: vi.fn() }));
vi.mock("../_core/db/client", () => ({ getDb: async () => { if (!state.database) throw Error("Live DB forbidden"); return state.database; } }));
vi.mock("../_core/db", () => ({
  getDb: async () => state.database,
  // Legacy fixtures contain no routed-review assignments.
  getPurchaseItemReviewScopeRows: async () => [],
  getPOItemsByDelegate: state.delegates, getUserIdsByRole: state.assistants,
  getPurchaseOrdersByIds: (ids: number[]) => getPurchaseOrdersByIds(ids, state.database),
  getPurchaseOrderById: async (id: number) => (await state.database.select().from(purchaseOrders).where(inArray(purchaseOrders.id, [id])))[0],
  getPurchaseOrdersForPackages: (ids: number[]) => getPurchaseOrdersForPackages(ids, state.database),
  getTicketItems: (id: number) => state.database.select().from(ticketItems).where(inArray(ticketItems.ticketId, [id])),
  getTicketById: async (id: number) => (await state.database.select().from(tickets).where(inArray(tickets.id, [id])))[0],
  isUserAssignedToTicketTasks: async () => false,
}));
const actor = (role = "accountant", id = 7) => ({ id, role, isActive: 1 });
const approval = { accountingApprovedById: 7, accountingApprovedAt: "2026-10-20 09:00:00", managementApprovedById: 7, managementApprovedAt: "2026-10-20 10:00:00" };
let memory: ReturnType<typeof readScopeDatabase>;
beforeEach(() => {
  vi.clearAllMocks(); memory = readScopeDatabase(); state.database = memory;
  state.delegates.mockResolvedValue([{ purchaseOrderId: 1 }]); state.assistants.mockResolvedValue([8]);
});
afterEach(() => { state.database = null; memory.memory.close(); });

function handler(file: string, name: string, scope: any) {
  const ast = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  let code = "";
  function visit(node: ts.Node) {
    if (ts.isPropertyAssignment(node) && node.name.getText(ast) === name) code = node.initializer.getText(ast);
    ts.forEachChild(node, visit);
  }
  visit(ast); if (!code) throw Error(`Missing handler ${name}`);
  return vm.runInNewContext(ts.transpileModule(`(${code})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, scope);
}

describe("Request-local visibility and bounded scope readers", () => {
  it.each(Object.values(APP_ROLE))("preserves original purchase visibility for %s", async role => {
    const user = actor(role), check = await createPurchaseOrderReadGuard(user);
    for (const order of [{ id: 1, status: "draft", requestedById: 9 }, { id: 2, status: "received", requestedById: 8 }, { id: 3, status: "pending_management", requestedById: 7 }]) {
      const outcome = async (run: () => any) => { try { await run(); return "allowed"; } catch (error: any) { return error.code; } };
      expect(await outcome(() => check(order))).toBe(await outcome(() => assertCanViewPurchaseOrder(user, order)));
    }
  });
  it("loads delegate scope once for100decisions and reloads it for a different request", async () => {
    const check = await createPurchaseOrderReadGuard(actor("delegate"));
    for (let i = 0; i < 100; i++) check({ id: 1, status: "draft", requestedById: 9 });
    expect(state.delegates).toHaveBeenCalledTimes(1);
    state.delegates.mockResolvedValue([]);
    const next = await createPurchaseOrderReadGuard(actor("delegate"));
    expect(() => next({ id: 1, status: "draft", requestedById: 9 })).toThrow();
    expect(state.delegates).toHaveBeenCalledTimes(2);
  });
  it("chunks/deduplicates IDs without launching an unbounded Promise.all", async () => {
    const read = vi.fn(async (ids: number[]) => ids);
    const ids = Array.from({ length: 1101 }, (_, i) => i + 1);
    expect(await readScopeChunks([...ids, ...ids], read)).toEqual(ids);
    expect(read.mock.calls.map(([ids]) => ids.length)).toEqual([500, 500, 101]);
    read.mockClear(); expect(await readScopeChunks([], read)).toEqual([]); expect(read).not.toHaveBeenCalled();
  });
});

describe("Real SQL list scopes and complete aggregate authorization", () => {
  function purchaseFixture() {
    memory.insert("purchase_orders", { id: 1, status: "pending_accounting", requestedById: 7, packageId: 5, poNumber: "PR-1" });
    memory.insert("purchase_orders", { id: 2, status: "pending_accounting", requestedById: 8, packageId: 5, poNumber: "PR-2" });
    memory.insert("purchase_package_submissions", { id: 20, purchasePackageId: 5, subNumber: 1, ...approval });
    for (let id = 1; id <= 100; id++) memory.insert("po_pricing_batches", { id, batchNumber: id, purchaseOrderId: 1, submittedById: 7, purchasePackageSubmissionId: 20, ...approval });
    memory.insert("po_pricing_batches", { id: 101, purchaseOrderId: 2, submittedById: 8, purchasePackageSubmissionId: 20 });
  }
  it("100 displayed batches use two scope queries and cannot hide an unapproved foreign member", async () => {
    purchaseFixture();
    const port = await loadDocumentListPort([{ entityType: "purchase_package_submission_financial", entityId: 20 }], memory, { actor: actor(), orders: [{ id: 1 }, { id: 2 }] });
    for (let i = 0; i < 100; i++) expect((await purchaseDocumentPermission(actor(), 1, undefined, 20, port)).pdfAllowed).toBe(false);
    expect(memory.queries).toHaveLength(2);
    expect(await port.batches(20)).toHaveLength(101);
    memory.memory.prepare("UPDATE po_pricing_batches SET accountingApprovedById=7,accountingApprovedAt='2026-10-20 09:00:00' WHERE id=101").run();
    const next = await loadDocumentListPort([{ entityType: "purchase_package_submission_financial", entityId: 20 }], memory, { actor: actor(), orders: [{ id: 1 }, { id: 2 }] });
    expect((await purchaseDocumentPermission(actor(), 1, undefined, 20, next)).pdfAllowed).toBe(true);
    expect((await purchaseDocumentPermission(actor("accountant", 8), 1, undefined, 20, next)).pdfAllowed).toBe(false);
  });
  it("preserves empty submissions and ID ordering with two SQL reads for100submissions", async () => {
    for (let id = 1; id <= 100; id++) memory.insert("purchase_package_submissions", { id, purchasePackageId: id % 2 ? 5 : 6, subNumber: id });
    memory.insert("po_pricing_batches", { id: 2, purchasePackageSubmissionId: 1, purchaseOrderId: 1 });
    memory.insert("po_pricing_batches", { id: 1, purchasePackageSubmissionId: 1, purchaseOrderId: 1 });
    const rows = await getPackageSubmissionsWithBatchesForPackages([5, 6, 5], memory);
    expect(rows).toHaveLength(100); expect(rows[0].batches.map((b: any) => b.id)).toEqual([1, 2]);
    expect(rows[1].batches).toEqual([]); expect(memory.queries).toHaveLength(2);
  });
  it("a1101document scope stays complete with500-ID SQL chunks", async () => {
    const ids = Array.from({ length: 1101 }, (_, i) => i + 1);
    for (const id of ids) {
      memory.insert("purchase_orders", { id, status: "closed", requestedById: 9 });
      memory.insert("po_pricing_batches", { id, purchaseOrderId: id, submittedById: 7 });
    }
    const scope = await loadDocumentListPort(ids.map(id => ({ entityType: "po_financial_batch", entityId: id })), memory, { actor: actor("owner") });
    expect(memory.queries).toHaveLength(6);
    expect(memory.queries.every(query => query.params.length <= 500)).toBe(true);
    expect((await purchaseDocumentPermission(actor("owner"), 1101, 1101, undefined, scope)).pdfAllowed).toBe(true);
  });
  it("shares completed financial archives across accountants with bounded reads for repeated and distinct parents", async () => {
    const rows = Array.from({ length: 1101 }, (_, i) => ({ entityType: "po_financial_batch", entityId: i + 1, fileKey: `cmms/uploads/financial-${i + 1}.pdf` }));
    for (const row of rows) {
      memory.insert("purchase_orders", { id: row.entityId, status: "closed", requestedById: 9 });
      memory.insert("po_pricing_batches", { id: row.entityId, purchaseOrderId: row.entityId, ...approval,
        managementApprovedAt: row.entityId === 1101 ? null : approval.managementApprovedAt });
    }
    const reader = actor("accountant", 44);
    const repeated = [...rows, ...rows];
    const port = await loadDocumentListPort(repeated, memory, { actor: reader });
    const decorated = await decorateDocumentRows(reader, repeated, port);
    expect(decorated.filter(row => row.pdfAllowed)).toHaveLength(2200);
    expect(decorated.filter(row => row.entityId === 1101).every(row => row.fileUrl === null)).toBe(true);
    expect(memory.queries).toHaveLength(6);
    expect(memory.queries.every(query => query.params.length <= 500)).toBe(true);
    memory.memory.exec("UPDATE po_pricing_batches SET managementApprovedAt=NULL WHERE id=1");
    const nextReader = actor("accountant", 45);
    const next = await decorateDocumentRows(nextReader, rows.slice(0, 2), await loadDocumentListPort(rows.slice(0, 2), memory, { actor: nextReader }));
    expect(next.map(row => row.pdfAllowed)).toEqual([false, true]);
  });
  it("full item batch retains names and quantities instead of the lightweight actionable DTO", async () => {
    for (const id of [3, 1, 2]) memory.insert("purchase_order_items", { id, purchaseOrderId: id === 3 ? 2 : 1, itemName: `item${id}`, quantity: "2.5", batchId: id });
    const rows = await getFullPOItemsForPOs([1, 2], memory);
    expect(rows.map(row => row.id)).toEqual([1, 2, 3]); expect(rows[0]).toMatchObject({ itemName: "item1", quantity: "2.5" });
    expect(memory.queries).toHaveLength(1);
  });
  it("actual listPricingBatches keeps the approval guard but removes the query per row", async () => {
    purchaseFixture();
    const beforeRead = vi.fn(async () => {});
    const proc = handler("server/routers/purchase/purchase-orders.router.ts", "listPricingBatches", {
      z, TRPCError, protectedProcedure, assertCanViewPurchaseOrder, purchaseDocumentPermission,
      isPurchasePdfApprover: (user: any) => ["accountant", "senior_management"].includes(user.role),
      rejectEmptyPendingPricingBatches: beforeRead,
      loadDocumentListPort: (rows: any[], _db: any, options: any) => loadDocumentListPort(rows, memory, options),
      db: {
        getPurchaseOrderById: async () => ({ id: 1, status: "pending_accounting", requestedById: 7 }),
        getPOPricingBatches: async () => memory.memory.prepare("SELECT * FROM po_pricing_batches WHERE purchaseOrderId=1 ORDER BY batchNumber").all(),
      },
    });
    const caller = router({ purchaseOrders: router({ listPricingBatches: proc }) }).createCaller({ user: actor() } as any);
    const rows = await caller.purchaseOrders.listPricingBatches({ purchaseOrderId: 1 });
    expect(rows).toHaveLength(100); expect(rows.every((row: any) => row.pdfAllowed === false)).toBe(true);
    expect(memory.queries).toHaveLength(3); expect(beforeRead).toHaveBeenCalledOnce();
  });
  it("actual package submissions keep the full DTO and deny aggregate PDF with a hidden foreign batch", async () => {
    purchaseFixture();
    memory.insert("purchase_order_items", { id: 50, purchaseOrderId: 1, batchId: 1, itemName: "Visible", quantity: "3" });
    memory.insert("purchase_order_items", { id: 51, purchaseOrderId: 2, batchId: 101, itemName: "Foreign", quantity: "9" });
    const proc = handler("server/routers/purchase/purchase-packages.router.ts", "submissions", {
      z, TRPCError, protectedProcedure, createPurchaseOrderReadScope, groupReadRows, purchaseDocumentPermission,
      assertCanPerformPOAction: () => {},
      loadDocumentListPort: (rows: any[], _db: any, options: any) => loadDocumentListPort(rows, memory, options),
      db: {
        getPurchasePackageById: async () => ({ id: 5 }),
        getPurchaseOrdersByPackage: () => getPurchaseOrdersForPackages([5], memory),
        getPackageSubmissionsWithBatches: () => getPackageSubmissionsWithBatchesForPackages([5], memory),
        getFullPOItemsForPOs: (ids: number[]) => getFullPOItemsForPOs(ids, memory),
      },
    });
    const caller = (user: any) => router({ purchasePackages: router({ submissions: proc }) }).createCaller({ user } as any);
    const rows = await caller(actor()).purchasePackages.submissions({ packageId: 5 });
    expect(rows).toHaveLength(1); expect(rows[0].batches).toHaveLength(101);
    expect(rows[0].batches[0]).toMatchObject({ poNumber: "PR-1", poStatus: "pending_accounting", items: [{ itemName: "Visible", quantity: "3" }] });
    expect(rows[0].pdfAllowed).toBe(false); expect(memory.queries).toHaveLength(6);
    memory.queries.length = 0;
    const own = await caller(actor("delegate")).purchasePackages.submissions({ packageId: 5 });
    expect(own[0].batches).toHaveLength(100);
    expect(JSON.stringify(own)).not.toContain('"Foreign"');
    expect(own[0].pdfAllowed).toBe(false); // All submission members remain mandatory for aggregate PDF.
    expect(state.delegates).toHaveBeenCalledTimes(1); // List and document checks share the same RPC visibility context.
  });
  it("actual actionable submissions bulk-load all visible packages without one read per package", async () => {
    for (let id = 1; id <= 30; id++) {
      memory.insert("purchase_orders", { id, packageId: id, requestedById: 7, poNumber: `PR-${id}`, status: "pending_accounting" });
      memory.insert("purchase_package_submissions", { id, purchasePackageId: id, subNumber: 1, status: "pending_accounting" });
      memory.insert("po_pricing_batches", { id, purchaseOrderId: id, purchasePackageSubmissionId: id, status: "pending_accounting" });
    }
    const bulk = vi.fn((ids: number[]) => getPackageSubmissionsWithBatchesForPackages(ids, memory));
    const proc = handler("server/routers/purchase/purchase-packages.router.ts", "actionableSubmissionsForMe", {
      TRPCError, protectedProcedure, filterVisiblePurchaseOrders, groupReadRows, assertCanPerformPOAction: () => {},
      db: { getPurchasePackagesList: async () => Array.from({ length: 30 }, (_, i) => ({ id: i + 1, packageNumber: `PB-${i + 1}` })),
        getPurchaseOrders: async () => memory.memory.prepare("SELECT * FROM purchase_orders").all(),
        getPackageSubmissionsWithBatchesForPackages: bulk },
    });
    const query = router({ purchasePackages: router({ actionableSubmissionsForMe: proc }) }).createCaller({ user: actor() } as any);
    const result = await query.purchasePackages.actionableSubmissionsForMe();
    expect(result.items).toHaveLength(30); expect(bulk).toHaveBeenCalledTimes(1); expect(memory.queries).toHaveLength(2);
  });
  it("does not turn a failed database read into permission denied or an empty list", async () => {
    const broken = { select() { throw Error("Read unavailable"); } };
    await expect(loadDocumentListPort([{ entityType: "po_financial_batch", entityId: 1 }], broken)).rejects.toThrow("Read unavailable");
    await expect(getFullPOItemsForPOs([1], broken)).rejects.toThrow("Read unavailable");
  });
});

describe("Batch translations retain every parent decision", () => {
  it.each(["accountant", "warehouse", "senior_management", "executive_director", "food_warehouse_assistant"])("bulk PO translations match %s scope and reject missing/foreign IDs", async role => {
    memory.insert("purchase_orders", { id: 1, status: "pending_management", requestedById: 7 });
    memory.insert("purchase_orders", { id: 2, status: "pending_management", requestedById: 7 });
    const input = { entityType: "PO", entityIds: [1, 2, 1] };
    await expect(assertBusinessTranslationAccess(actor(role), input, "batch")).resolves.toBeUndefined();
    expect(memory.queries).toHaveLength(1);
    await expect(assertBusinessTranslationAccess(actor(role), { ...input, entityIds: [1, 999] }, "batch")).rejects.toMatchObject({ code: "FORBIDDEN" });
    if (role === "food_warehouse_assistant") {
      memory.memory.prepare("UPDATE purchase_orders SET requestedById=8 WHERE id=2").run();
      await expect(assertBusinessTranslationAccess(actor(role), input, "batch")).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
  });
  it("authorizes100technician tickets through one bulk read when directly assigned", async () => {
    for (let id = 1; id <= 100; id++) memory.insert("tickets", { id, assignedToId: 7, reportedById: 9 });
    const ids = Array.from({ length: 100 }, (_, i) => i + 1);
    await assertTechnicianTranslationAccess(actor("technician"), { entityType: "TICKET", entityIds: ids }, "batch");
    expect(memory.queries).toHaveLength(1);
    memory.memory.prepare("UPDATE tickets SET assignedToId=8 WHERE id=100").run();
    await expect(assertTechnicianTranslationAccess(actor("technician"), { entityType: "TICKET", entityIds: ids }, "batch")).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(memory.queries).toHaveLength(4); // ticket + items + assignment reads; not100parent reads
  });
  it("original ticket guard still honors item assignment and source task links, without foreign grants", async () => {
    for (const id of [1, 2, 3]) memory.insert("tickets", { id, assignedToId: 9, reportedById: 9, sourceTaskId: id === 2 ? 50 : null });
    memory.insert("ticket_items", { id: 11, ticketId: 1, assignedTechnicianId: 7 });
    memory.insert("ticket_tasks", { id: 50, ticketId: 99 });
    memory.insert("ticket_task_assignees", { id: 1, taskId: 50, userId: 7 });
    const scope = await loadTicketReadScope(actor("technician"), [1, 2, 3], memory);
    for (const id of [1, 2]) await expect(assertTicketReadable(actor("technician"), scope.tickets.get(id), undefined, scope.source)).resolves.toBeUndefined();
    await expect(assertTicketReadable(actor("technician"), scope.tickets.get(3), undefined, scope.source)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(memory.queries).toHaveLength(3);
  });
  it.each(["it_manager", "it_member"])("retains %s secondary item/department assignment with bounded reads", async role => {
    const department = "maintenance_report_department_it";
    for (const id of [1, 2, 3]) memory.insert("tickets", { id, assignedToId: 9, reportedById: 9 });
    memory.insert("ticket_items", { id: 1, ticketId: 1, responsibleDepartment: department });
    memory.insert("ticket_departments", { id: 1, ticketId: 2, department, responsibleManagerId: 8 });
    const scope = await loadTicketReadScope(actor(role), [1, 2, 3], memory);
    for (const id of [1, 2]) await expect(assertTicketReadable(actor(role), scope.tickets.get(id), undefined, scope.source)).resolves.toBeUndefined();
    await expect(assertTicketReadable(actor(role), scope.tickets.get(3), undefined, scope.source)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(memory.queries).toHaveLength(4);
  });
  it("PO_PACKAGE translation needs one visible order in EVERY requested package", async () => {
    for (const id of [1, 2]) memory.insert("purchase_orders", { id, packageId: id, requestedById: 7, status: "draft" });
    await expect(assertBusinessTranslationAccess(actor("food_warehouse_assistant"), { entityType: "PO_PACKAGE", entityIds: [1, 2] }, "batch")).resolves.toBeUndefined();
    memory.memory.prepare("UPDATE purchase_orders SET requestedById=8 WHERE id=2").run();
    await expect(assertBusinessTranslationAccess(actor("food_warehouse_assistant"), { entityType: "PO_PACKAGE", entityIds: [1, 2] }, "batch")).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("a missing child is rejected before any batched parent authorization", async () => {
    const authorizeMany = vi.fn();
    await expect(assertBusinessTranslationAccess(actor(), { entityType: "PO_ITEM", entityIds: [1, 2] }, "batch", {
      parents: async () => [{ id: 1, parentId: 1 }], authorize: vi.fn(), authorizeMany,
    })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(authorizeMany).not.toHaveBeenCalled();
  });
  it("the real central middleware rejects a mixed translation batch before the text reader", async () => {
    memory.insert("purchase_orders", { id: 1, requestedById: 7, status: "draft" });
    memory.insert("purchase_orders", { id: 2, requestedById: 8, status: "draft" });
    memory.insert("purchase_order_items", { id: 11, purchaseOrderId: 1 });
    memory.insert("purchase_order_items", { id: 12, purchaseOrderId: 2 });
    const reader = vi.fn(() => "translated");
    const proc = protectedProcedure.input(z.object({ entityType: z.string(), entityIds: z.array(z.number()) })).query(reader);
    const query = (active = 1) => router({ translation: router({ getBatchTranslations: proc }) }).createCaller({ user: { ...actor("food_warehouse_assistant"), isActive: active } } as any);
    await expect(query().translation.getBatchTranslations({ entityType: "PO_ITEM", entityIds: [11, 12] })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(reader).not.toHaveBeenCalled();
    memory.queries.length = 0;
    await expect(query(0).translation.getBatchTranslations({ entityType: "PO_ITEM", entityIds: [11, 12] })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(memory.queries).toHaveLength(0);
    await expect(query().translation.getBatchTranslations({ entityType: "PO_ITEM", entityIds: [11] })).resolves.toBe("translated");
  });
});

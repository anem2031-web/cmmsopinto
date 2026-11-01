import { describe, it, expect, vi } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { getTableName } from "drizzle-orm";
import { getAttachmentDocumentPage, loadDocumentListPort } from "../_core/db/document-list";
import { decorateDocumentRows } from "../_core/authz/document-list";
import { purchaseAttachmentPermission, type PurchaseDocumentPort } from "../_core/authz/purchase-document";
import { documentListPageInput, documentDayBoundary } from "../../shared/document-list";
import { PricingBundleService } from "../services/delegate-pricing-bundles/service";
import { businessRpcAllowed } from "../../shared/business-role-policy";
vi.mock("../_core/db/client", () => ({ getDb: () => { throw Error("No live DB in tests"); } }));
vi.mock("../_core/db", () => ({}));

const dialect = new MySqlDialect();
const approved = (id: number) => ({ accountingApprovedById: id, accountingApprovedAt: "2026-10-19 10:00:00" });
const actor = (role = "accountant", id = 7) => ({ id, role, isActive: 1 });

describe("Document list bounded reads and unchanged exact-scope PDF authorization", () => {
  it("preloads 100 attachment scopes with three reads, preserving partial submission denials", async () => {
    const calls: string[] = [];
    const batches = [
      { id: 1, purchaseOrderId: 10, submittedById: 4, ...approved(7) },
      { id: 2, purchaseOrderId: 20, purchasePackageSubmissionId: 30, ...approved(7) },
      { id: 3, purchaseOrderId: 21, purchasePackageSubmissionId: 30, ...approved(8) },
    ];
    const orders = [{ id: 10 }, { id: 20 }, { id: 21 }];
    const submissions = [{ id: 30, purchasePackageId: 40, ...approved(7) }];
    const data: Record<string, any[]> = { po_pricing_batches: batches, purchase_orders: orders, purchase_package_submissions: submissions };
    const database = { select: () => ({ from: (table: any) => ({ where: () => { calls.push(getTableName(table)); return Promise.resolve(data[getTableName(table)]); } }) }) };
    const attachments = Array.from({ length: 100 }, (_, i) => ({ id: i + 1, entityType: i % 2 ? "delegate_package_submission_pricing" : "delegate_pricing_batch", entityId: i % 2 ? 30 : 1, fileKey: `cmms/uploads/private-${i}.pdf` }));
    const port = await loadDocumentListPort(attachments, database);
    const result = await decorateDocumentRows(actor(), attachments, port);
    expect(calls).toHaveLength(3);
    for (const row of result) {
      const allowed = row.entityId === 1;
      expect(row.pdfAllowed).toBe(allowed);
      expect(row.fileKey !== null).toBe(allowed);
      expect(row.fileUrl !== null).toBe(allowed);
      expect(row.reviewUrl).toBe(allowed ? null : "/purchase-packages/40?submissionId=30");
    }
    expect(calls).toHaveLength(3); // guard decisions perform no additional DB reads
    Object.assign(batches[2], approved(7));
    const newlyApproved = (await decorateDocumentRows(actor(), attachments, await loadDocumentListPort(attachments, database)))[1];
    expect(newlyApproved.pdfAllowed).toBe(true);
    expect(newlyApproved.reviewUrl).toBeNull();
  });

  it.each(["accountant", "senior_management", "owner", "admin", "delegate"])("matches the original guard for %s, including missing and foreign scope records", async role => {
    const table = new Map([[1, { id: 1, purchaseOrderId: 10, submittedById: 7, ...approved(7) }], [2, { id: 2, purchaseOrderId: 999, submittedById: 8 }]]);
    const port: PurchaseDocumentPort = { order: async id => id === 10 ? { id } : null, batch: async id => table.get(id), submission: async () => null, batches: async () => [], authorize: async () => {} };
    for (const id of [1, 2, 99]) {
      const original = await purchaseAttachmentPermission(actor(role), "po_financial_batch", id, port);
      const [row] = await decorateDocumentRows(actor(role), [{ entityType: "po_financial_batch", entityId: id, fileKey: "cmms/uploads/x.pdf" }], port);
      expect(row.pdfAllowed).toBe(original.pdfAllowed);
      expect(row.fileKey).toBe(original.pdfAllowed ? "cmms/uploads/x.pdf" : null);
    }
  });

  it("propagates database outages rather than treating them as a normal approval denial", async () => {
    const port: PurchaseDocumentPort = { order: async () => null, batch: async () => { throw Error("outage"); }, submission: async () => null, batches: async () => [], authorize: async () => {} };
    await expect(decorateDocumentRows(actor(), [{ entityType: "po_financial_batch", entityId: 1 }], port)).rejects.toThrow("outage");
  });
});

describe("Document SQL pagination, search and delegate isolation", () => {
  it.each(["po_financial_batch", "delegate_pricing_documents"] as const)("pages %s before scope authorization and never interpolates user search", async kind => {
    const queries: { sql: string; params: unknown[] }[] = [];
    const database = { execute: async (statement: any) => {
      const query = dialect.sqlToQuery(statement); queries.push(query);
      if (query.sql.startsWith("SELECT COUNT")) return [[{ total: 63 }], []];
      if (query.sql.startsWith("SELECT d.delegateId")) return [[{ delegateId: 7, delegateName: "Own", count: 63 }], []];
      return [[{ id: 21, entityId: 1, entityType: "delegate_pricing_batch" }], []];
    } };
    const search = "O'Reilly%_=";
    const input = documentListPageInput.parse({ page: 2, search, delegateId: 8, dateFrom: "2026-10-19", dateTo: "2026-10-20", sort: "oldest" });
    const result = await getAttachmentDocumentPage(kind, input, 7, database);
    expect(result).toMatchObject({ page: 2, total: 63, count: 63, pageSize: 20 });
    expect(queries).toHaveLength(3);
    const select = queries[2];
    expect(select.sql).toContain("LIMIT ? OFFSET ?");
    expect(select.params.slice(-2)).toEqual([20, 20]);
    for (const query of queries) {
      expect(query.sql).not.toContain(search);
      expect(query.sql).toContain("d.delegateId=?");
      expect(query.params).toContain(7);
    }
    expect(select.params).toContain(8); // own delegate AND requested delegate, never replacing own scope
    expect(select.sql).toContain("d.createdAt ASC,d.id ASC");
    expect(select.params).toContain("%O'Reilly=%=_==%");
    expect(documentDayBoundary("2026-10-19")).toBe("2026-10-18 21:00:00");
    expect(documentDayBoundary("2026-10-20", true)).toBe("2026-10-20 21:00:00");
  });
  it("clamps stale pages when filtered results shrink", async () => {
    const queries: any[] = [];
    const db = { execute: async (q: any) => { const query = dialect.sqlToQuery(q); queries.push(query); return query.sql.startsWith("SELECT COUNT") ? [[{ total: 1 }], []] : [[], []]; } };
    expect((await getAttachmentDocumentPage("po_financial_batch", documentListPageInput.parse({ page: 8 }), undefined, db)).page).toBe(1);
    expect(queries.at(-1).params.slice(-2)).toEqual([20, 0]);
  });
  it.each([{ page: 0 }, { page: 1, pageSize: 500 }, { page: 1, delegateId: -1 }, { page: 1, dateFrom: "2026-02-30" }])("rejects invalid paging input %j", input => {
    expect(documentListPageInput.safeParse(input).success).toBe(false);
  });
});

describe("Pricing bundle paged read", () => {
  it("keeps old list available while paged lists hydrate only this page's approval scopes", async () => {
    const queries: any[] = [];
    const database = { execute: async (statement: any) => {
      const q = dialect.sqlToQuery(statement); queries.push(q);
      if (q.sql.startsWith("SELECT COUNT")) return [[{ total: 80 }], []];
      if (q.sql.startsWith("SELECT b.delegateId")) return [[{ delegateId: 7, delegateName: "Own", count: 80 }], []];
      if (q.sql.startsWith("SELECT l.bundleId")) return [[], []];
      return [[{ id: 41, status: "archived", sentTotals: '["10"]', sentOrderIds: '[10]', sentOrderNumbers: '["PR-10"]' }], []];
    } };
    const service = new PricingBundleService({ database: async () => database } as any);
    const result = await service.listPage(actor(), documentListPageInput.parse({ page: 3 }));
    expect(result).toMatchObject({ page: 3, total: 80, rows: [{ id: 41, pdfAllowed: false, total: 10 }] });
    expect(queries[2].params.slice(-2)).toEqual([20, 40]);
    expect(queries[3].params).toEqual([41]);
  });
  it("runs the new read alias through the central business guard without adding write permissions", () => {
    for (const role of ["accountant", "senior_management"]) {
      expect(businessRpcAllowed(actor(role), "query", "delegatePricingBundles.listPage")).toBe(true);
      expect(businessRpcAllowed(actor(role), "mutation", "delegatePricingBundles.send")).toBe(false);
    }
    for (const role of ["warehouse", "food_warehouse_assistant", "executive_director"]) expect(businessRpcAllowed(actor(role), "query", "delegatePricingBundles.listPage")).toBe(false);
  });
});

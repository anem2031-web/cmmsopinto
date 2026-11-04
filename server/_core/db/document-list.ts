import { inArray, or, sql } from "drizzle-orm";
import { poPricingBatches, purchaseOrders, purchasePackageSubmissions } from "../../../drizzle/schema";
import { getDb } from "./client";
import { documentDayBoundary, documentSearchPattern, type DocumentListPageInput } from "../../../shared/document-list";
import { purchaseDocumentPort, type PurchaseDocumentPort } from "../authz/purchase-document";
import { readScopeChunks, groupReadRows } from "../authz/read-batch";
import { APP_ROLE } from "../../../shared/roles";

type DocumentReadOptions = {
  actor?: { id: number; role: string };
  /** Trusted rows already fetched in this same RPC, never client input. */
  orders?: any[];
  /** Optional guard from the same RPC's list visibility context. */
  authorize?: (order: any) => void;
};

export async function documentQueryRows(database: any, query: any): Promise<any[]> {
  const result = await database.execute(query);
  return Array.isArray(result[0]) ? result[0] : [];
}

/** Bulk scope reads feed the existing exact-scope guard, including all submission batches. */
export async function loadDocumentListPort(rows: any[], database?: any, options: DocumentReadOptions = {}): Promise<PurchaseDocumentPort> {
  const db = database ?? await getDb();
  if (!db) throw new Error("Database unavailable");
  const batchIds = Array.from(new Set(rows.filter(r => ["po_financial_batch", "delegate_pricing_batch"].includes(r.entityType)).map(r => Number(r.entityId))));
  const submissionIds = Array.from(new Set(rows.filter(r => ["purchase_package_submission_financial", "delegate_package_submission_pricing"].includes(r.entityType)).map(r => Number(r.entityId))));
  // Normal pages use one batch read; large legacy lists are bounded to 500 IDs.
  const batchScopes = Array.from(new Set([...batchIds, ...submissionIds]));
  const [batches, submissions] = await Promise.all([
    readScopeChunks(batchScopes, ids => {
      const selected = new Set(ids);
      const direct = batchIds.filter(id => selected.has(id));
      const packages = submissionIds.filter(id => selected.has(id));
      return db.select().from(poPricingBatches).where(or(
        direct.length ? inArray(poPricingBatches.id, direct) : undefined,
        packages.length ? inArray(poPricingBatches.purchasePackageSubmissionId, packages) : undefined,
      ));
    }),
    readScopeChunks(submissionIds, ids => db.select().from(purchasePackageSubmissions).where(inArray(purchasePackageSubmissions.id, ids))),
  ]);
  // A batch may be selected by ID and by its submission in different chunks.
  const uniqueBatches = Array.from(new Map<number, any>(batches.map((b: any) => [Number(b.id), b])).values());
  const seeded = new Map<number, any>((options.orders ?? []).map(order => [Number(order.id), order]));
  const orderIds = Array.from(new Set<number>(uniqueBatches.map((b: any) => Number(b.purchaseOrderId)))).filter(id => !seeded.has(id));
  const orders = [...Array.from(seeded.values()), ...await readScopeChunks(orderIds, ids => db.select().from(purchaseOrders).where(inArray(purchaseOrders.id, ids)))];
  const byId = (list: any[]) => new Map(list.map(row => [Number(row.id), row]));
  const batchMap = byId(uniqueBatches), submissionMap = byId(submissions), orderMap = byId(orders);
  const bySubmission = groupReadRows(uniqueBatches, row => Number(row.purchasePackageSubmissionId));
  const check = options.actor ? options.authorize ?? await (await import("../authz/guard")).createPurchaseOrderReadGuard(options.actor, orders) : undefined;
  return {
    order: async id => orderMap.get(id), batch: async id => batchMap.get(id),
    submission: async id => submissionMap.get(id),
    batches: async id => bySubmission.get(id) ?? [],
    authorize: async (actor, order) => {
      if (!check) return purchaseDocumentPort.authorize(actor, order);
      if (actor.id !== options.actor!.id || actor.role !== options.actor!.role) throw new Error("Read scope actor mismatch");
      check(order);
    },
  };
}

function completedFinancialApprovals(alias: "b" | "s" | "scope_batch") {
  const table = sql.identifier(alias);
  return sql`${table}.accountingApprovedById > 0 AND ${table}.accountingApprovedAt IS NOT NULL
    AND ${table}.managementApprovedById > 0 AND ${table}.managementApprovedAt IS NOT NULL`;
}

/** Single union keeps mixed legacy/package documents ordered and paged in SQL.
 * actorRole is supplied by the authenticated RPC, never by list input.
 */
export function attachmentDocumentSource(kind: "po_financial_batch" | "delegate_pricing_documents", actorRole?: string) {
  const financial = kind === "po_financial_batch";
  const requireBothApprovals = financial && actorRole === APP_ROLE.ACCOUNTANT;
  return sql`(
    SELECT a.*, b.submittedById AS delegateId, u.name AS delegateName,
      b.totalEstimatedCost, b.custodyAmount AS custodyBalance,
      'pricing_batch' AS documentScope
    FROM attachments a LEFT JOIN po_pricing_batches b ON b.id=a.entityId
    LEFT JOIN users u ON u.id=b.submittedById
    WHERE a.entityType=${financial ? "po_financial_batch" : "delegate_pricing_batch"}
      ${requireBothApprovals ? sql`AND ${completedFinancialApprovals("b")}` : sql``}
    UNION ALL
    SELECT a.*, ${financial ? sql`b.submittedById` : sql`COALESCE(b.submittedById,a.uploadedById)`} AS delegateId,
      u.name AS delegateName, ${financial ? sql`s.totalEstimatedCost` : sql`COALESCE(t.total,0)`} AS totalEstimatedCost,
      s.custodyBalance, 'package_submission' AS documentScope
    FROM attachments a LEFT JOIN purchase_package_submissions s ON s.id=a.entityId
    LEFT JOIN (SELECT purchasePackageSubmissionId, MIN(id) AS firstBatchId,
      SUM(COALESCE(totalEstimatedCost,0)) AS total
      ${requireBothApprovals ? sql`, SUM(CASE WHEN ${completedFinancialApprovals("scope_batch")} THEN 0 ELSE 1 END) AS incompleteApprovals` : sql``}
      FROM po_pricing_batches scope_batch
      WHERE purchasePackageSubmissionId IS NOT NULL GROUP BY purchasePackageSubmissionId) t ON t.purchasePackageSubmissionId=a.entityId
    LEFT JOIN po_pricing_batches b ON b.id=t.firstBatchId
    LEFT JOIN users u ON u.id=${financial ? sql`b.submittedById` : sql`COALESCE(b.submittedById,a.uploadedById)`}
    WHERE a.entityType=${financial ? "purchase_package_submission_financial" : "delegate_package_submission_pricing"}
      ${requireBothApprovals ? sql`AND ${completedFinancialApprovals("s")}
        AND t.firstBatchId IS NOT NULL AND t.incompleteApprovals=0` : sql``}
  ) d`;
}

export async function getAttachmentDocumentPage(kind: "po_financial_batch" | "delegate_pricing_documents", input: DocumentListPageInput, ownDelegateId?: number, database?: any, actorRole?: string) {
  const db = database ?? await getDb();
  if (!db) throw new Error("Database unavailable");
  const source = attachmentDocumentSource(kind, actorRole);
  const base = ownDelegateId == null ? sql`1=1` : sql`d.delegateId=${ownDelegateId}`;
  const conditions = [base];
  if (input.delegateId != null) conditions.push(sql`d.delegateId=${input.delegateId}`);
  if (input.search) {
    const pattern = documentSearchPattern(input.search);
    conditions.push(sql`(d.fileName LIKE ${pattern} ESCAPE '=' OR COALESCE(d.delegateName,'بلا مندوب') LIKE ${pattern} ESCAPE '=')`);
  }
  if (input.dateFrom) conditions.push(sql`d.createdAt >= ${documentDayBoundary(input.dateFrom)}`);
  if (input.dateTo) conditions.push(sql`d.createdAt < ${documentDayBoundary(input.dateTo, true)}`);
  const where = sql.join(conditions, sql` AND `);
  const [totals, delegates] = await Promise.all([
    documentQueryRows(db, sql`SELECT COUNT(*) AS total FROM ${source} WHERE ${where}`),
    documentQueryRows(db, sql`SELECT d.delegateId,d.delegateName,COUNT(*) AS count FROM ${source} WHERE ${base} GROUP BY d.delegateId,d.delegateName`),
  ]);
  const total = Number(totals[0]?.total || 0);
  const page = Math.min(input.page, Math.max(1, Math.ceil(total / input.pageSize)));
  const direction = input.sort === "oldest" ? sql`ASC` : sql`DESC`;
  const rows = await documentQueryRows(db, sql`SELECT d.* FROM ${source} WHERE ${where} ORDER BY d.createdAt ${direction},d.id ${direction} LIMIT ${input.pageSize} OFFSET ${(page - 1) * input.pageSize}`);
  return { rows, total, page, pageSize: input.pageSize,
    count: delegates.reduce((n, row) => n + Number(row.count), 0),
    delegates: delegates.filter(row => row.delegateId != null).map(row => ({ id: Number(row.delegateId), name: row.delegateName || `مستخدم #${row.delegateId}` })) };
}

import { sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { canReadApprovedPricingDocuments, type ApprovedPricingDocumentActor } from "../../../shared/approved-pricing-documents";
import { documentDayBoundary, documentSearchPattern, type DocumentListPageInput } from "../../../shared/document-list";
import { PRICING_BUNDLE_LIMIT, type PricingBundleSnapshot } from "../../../shared/delegate-pricing-bundles";
import { readScopeChunks, groupReadRows } from "../../_core/authz/read-batch";
import { executionRows as rows } from "../operational-issues/issue-reference";
import { approvedBundleCondition, approvedBundleSnapshot } from "./approved-document";
import { unifiedBundleApprovalsEnabled } from "./unified-feature";
import type { PricingBundlePorts } from "./service";

const deny = () => new TRPCError({ code: "FORBIDDEN", message: "الوثيقة متاحة للمخولين بعد اكتمال اعتماد الإدارة العليا فقط" });
const parse = (value: any) => typeof value === "string" ? JSON.parse(value) : value;

/** Only approved DPB documents: no original PDF storage access or writer ports. */
export class ApprovedPricingDocumentReader {
  constructor(private ports: Pick<PricingBundlePorts, "database" | "render" | "signature" | "fixedApprovedPdf">, private enabled: () => boolean) {}
  private async currentActor(actor: ApprovedPricingDocumentActor) {
    if (!canReadApprovedPricingDocuments(actor)) throw deny();
    const db = await this.ports.database();
    const named = !["admin", "owner"].includes(actor.role);
    const identities = await rows(db, sql`SELECT id,username,role,isActive FROM users WHERE id=${actor.id}
      ${named ? sql`OR LOWER(username)=${(actor.username || "").toLowerCase()}` : sql``}`);
    const stored = identities.find(row => Number(row.id) === actor.id);
    if (named && identities.filter(row => (row.username || "").toLowerCase() === (actor.username || "").toLowerCase()).length !== 1) throw deny();
    if (!canReadApprovedPricingDocuments(stored) || Number(stored.id) !== actor.id
      || stored.role !== actor.role || (stored.username || "").toLowerCase() !== (actor.username || "").toLowerCase()) throw deny();
    return db;
  }
  private async scope(db: any, ids: number[]) {
    const members = await readScopeChunks(ids, chunk => rows(db, sql`SELECT m.bundleId,m.purchaseOrderItemId,i.purchaseOrderId,
      COALESCE(s.managementApprovedAt,pb.managementApprovedAt) AS approvedAt
      ${unifiedBundleApprovalsEnabled() ? sql`,a.managementApprovedAt AS unifiedApprovedAt,a.accountingRejections,a.managementRejections` : sql``}
      FROM delegate_pricing_bundle_items m JOIN purchase_order_items i ON i.id=m.purchaseOrderItemId
      JOIN delegate_pricing_bundle_batches l ON l.bundleId=m.bundleId AND l.purchaseOrderId=i.purchaseOrderId
      JOIN po_pricing_batches pb ON pb.id=l.pricingBatchId
      LEFT JOIN purchase_package_submissions s ON s.id=l.purchasePackageSubmissionId
      ${unifiedBundleApprovalsEnabled() ? sql`LEFT JOIN delegate_pricing_bundle_approvals a ON a.bundleId=m.bundleId` : sql``}
      WHERE m.removedAt IS NULL AND m.bundleId IN (${sql.join(chunk.map(id => sql`${id}`), sql`,`)})`));
    return groupReadRows(members, (row: any) => Number(row.bundleId));
  }
  private snapshot(bundle: any, members: any[]): PricingBundleSnapshot | null {
    let snapshot: PricingBundleSnapshot;
    try { snapshot = parse(bundle.snapshotJson); } catch { return null; }
    if (!snapshot || snapshot.number !== bundle.bundleNumber || Number(snapshot.delegate?.id) !== Number(bundle.delegateId)
      || !Array.isArray(snapshot.rows) || !snapshot.rows.length || snapshot.rows.length > PRICING_BUNDLE_LIMIT
      || !Array.isArray(snapshot.signatures) || members.length !== snapshot.rows.length) return null;
    const memberIds = new Set(members.map(row => Number(row.purchaseOrderItemId)));
    if (memberIds.size !== members.length || new Set(snapshot.rows.map(row => row.id)).size !== members.length
      || snapshot.rows.some(row => !members.some(member => Number(member.purchaseOrderItemId) === row.id && Number(member.purchaseOrderId) === row.purchaseOrderId))) return null;
    return snapshot;
  }
  async listPage(actor: ApprovedPricingDocumentActor, input: DocumentListPageInput) {
    const db = await this.currentActor(actor);
    const empty = { rows: [], total: 0, page: 1, pageSize: input.pageSize };
    if (!this.enabled()) return empty;
    const conditions = [sql`b.status IN ('sent','archived')`, approvedBundleCondition()];
    if (input.search) {
      const pattern = documentSearchPattern(input.search);
      conditions.push(sql`(b.bundleNumber LIKE ${pattern} ESCAPE '=' OR u.name LIKE ${pattern} ESCAPE '=')`);
    }
    if (input.dateFrom) conditions.push(sql`b.sentAt>=${documentDayBoundary(input.dateFrom)}`);
    if (input.dateTo) conditions.push(sql`b.sentAt<${documentDayBoundary(input.dateTo, true)}`);
    const where = sql.join(conditions, sql` AND `);
    const [count] = await rows(db, sql`SELECT COUNT(*) AS total FROM delegate_pricing_bundles b JOIN users u ON u.id=b.delegateId WHERE ${where}`);
    const total = Number(count?.total || 0), page = Math.min(input.page, Math.max(1, Math.ceil(total / input.pageSize)));
    const direction = input.sort === "oldest" ? sql`ASC` : sql`DESC`;
    const bundles = await rows(db, sql`SELECT b.id,b.bundleNumber,b.delegateId,b.snapshotJson,u.name AS delegateName
      FROM delegate_pricing_bundles b JOIN users u ON u.id=b.delegateId WHERE ${where}
      ORDER BY b.sentAt ${direction},b.id ${direction} LIMIT ${input.pageSize} OFFSET ${(page-1)*input.pageSize}`);
    const scopes = await this.scope(db, bundles.map(row => Number(row.id)));
    const result = bundles.flatMap(bundle => {
      const members = scopes.get(Number(bundle.id)) || [], snapshot = this.snapshot(bundle, members);
      if (!snapshot) return [];
      const root = members[0];
      const rejected = new Set([...(parse(root.accountingRejections) || []), ...(parse(root.managementRejections) || [])].map(row => Number(row.itemId)));
      const total = snapshot.rows.filter(row => !rejected.has(row.id)).reduce((sum, row) => sum + Math.round(Number(row.estimatedTotalCost)*100), 0) / 100;
      const dates = members.map(row => String(row.approvedAt)).sort();
      const approvedAt = root.unifiedApprovedAt || dates[dates.length-1];
      return [{ id: Number(bundle.id), bundleNumber: bundle.bundleNumber, delegateName: bundle.delegateName, approvedAt, total }];
    });
    return { rows: result, total, page, pageSize: input.pageSize };
  }
  async pdf(actor: ApprovedPricingDocumentActor, id: number) {
    const db = await this.currentActor(actor);
    if (!this.enabled() || !Number.isSafeInteger(id) || id <= 0) throw deny();
    // Recheck complete membership/parents/stage for this operation; never use a list snapshot.
    const [bundle] = await rows(db, sql`SELECT b.id,b.bundleNumber,b.delegateId,b.snapshotJson FROM delegate_pricing_bundles b
      WHERE b.id=${id} AND b.status IN ('sent','archived') AND ${approvedBundleCondition()}`);
    if (!bundle) throw deny();
    const scopes = await this.scope(db, [id]);
    const snapshot = this.snapshot(bundle, scopes.get(id) || []);
    if (!snapshot) throw deny();
    const approved = await approvedBundleSnapshot(db, bundle, snapshot, source => this.ports.signature(source));
    const fixed = await this.ports.fixedApprovedPdf?.(db, bundle, approved);
    const pdf = fixed ?? await this.ports.render(approved);
    if (!Buffer.isBuffer(pdf) || !pdf.length || pdf.length > 8*1024*1024) throw new Error("تعذر تجهيز ملف PDF");
    return { name: `${bundle.bundleNumber}.pdf`, content: pdf.toString("base64") };
  }
}

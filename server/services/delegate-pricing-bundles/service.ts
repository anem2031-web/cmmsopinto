import { sql } from "drizzle-orm";
import { isDelegateRole } from "../../../shared/roles";
import { TRPCError } from "@trpc/server";
import { executionRows as rows } from "../operational-issues/issue-reference";
import { assertBundleItemEligible, canReadPricingBundles, PRICING_BUNDLE_LIMIT, type PricingBundleActor, type PricingBundleSnapshot, type PricingBundleRow } from "../../../shared/delegate-pricing-bundles";
import { hasOwnPurchaseDocumentApproval, isPurchasePdfApprover, PURCHASE_PDF_APPROVAL_MESSAGE } from "../../_core/authz/purchase-document";
import { documentDayBoundary, documentSearchPattern, type DocumentListPageInput } from "../../../shared/document-list";
import { supplierReturnDatabaseEnabled } from "../../supplier-return-followup/feature";
import { approvedBundleCondition, approvedBundleSnapshot } from "./approved-document";
import { initializeUnifiedApproval, unifiedBundleApprovalsEnabled } from "./unified-feature";
import type { UnifiedApprovalPorts } from "./unified-approval";
import { isRoutedPurchaseItem } from "../../../shared/purchase-item-review";
export interface PricingBundlePorts {
  database(): Promise<any>;
  submitPO(poId: number, actor: PricingBundleActor, options: { selectedItemIds: number[]; tx: any; purchasePackageSubmissionId?: number; skipArchive: true; bundleId: number; delegateSignatureSnapshot?: string | null }): Promise<any>;
  createPackageSubmission(packageId: number, actorId: number, tx: any): Promise<{ id: number } | null>;
  render(snapshot: PricingBundleSnapshot): Promise<Buffer>;
  signature(source: string | null): Promise<string>;
  sync(poId: number, actorId: number, batchId: number): Promise<void>;
  finishUnifiedSend?(actor: PricingBundleActor, bundleId:number):Promise<void>;
  unified?:UnifiedApprovalPorts;
}
const fail = (message: string, code: "BAD_REQUEST" | "CONFLICT" | "FORBIDDEN" | "NOT_FOUND" = "BAD_REQUEST"): never => { throw new TRPCError({ code, message }); };
const json = (value: any) => typeof value === "string" ? JSON.parse(value) : value;
export class PricingBundleService {
  private readonly pendingPdfs = new Map<number, Promise<Buffer>>();
  constructor(private ports: PricingBundlePorts) {}
  private read(actor: PricingBundleActor) { if (!canReadPricingBundles(actor)) fail("غير مخول بعرض حزم التسعير", "FORBIDDEN"); }
  private write(actor: PricingBundleActor) { if (actor.isActive !== 1 || !isDelegateRole(actor.role)) fail("إدارة حزمة التسعير متاحة للمندوب فقط", "FORBIDDEN"); }
  private async actorLock(tx: any, actor: PricingBundleActor) {
    this.write(actor);
    const [stored] = await rows(tx, sql`SELECT id FROM users WHERE id=${actor.id} AND isActive=1 AND role=${actor.role} FOR UPDATE`);
    if (!stored) fail("الحساب غير مخول", "FORBIDDEN");
  }
  private async header(tx: any, actor: PricingBundleActor, id: number, lock = false) {
    this.read(actor);
    const [bundle] = await rows(tx, sql`SELECT id,bundleNumber,delegateId,status,revision,createdAt,sentAt,effectsDone FROM delegate_pricing_bundles WHERE id=${id} ${lock ? sql`FOR UPDATE` : sql``}`);
    if (!bundle) fail("حزمة التسعير غير موجودة", "NOT_FOUND");
    if (isDelegateRole(actor.role) && Number(bundle.delegateId) !== actor.id) fail("الحزمة لا تخصك", "FORBIDDEN");
    return bundle;
  }
  private async approvalRows(database: any, ids: number[]) {
    if (!ids.length) return [];
    return rows(database, sql`SELECT l.bundleId,l.purchaseOrderId,l.pricingBatchId,l.purchasePackageSubmissionId,
      b.id AS actualBatchId,b.purchaseOrderId AS actualPurchaseOrderId,b.purchasePackageSubmissionId AS actualSubmissionId,
      b.accountingApprovedById,b.accountingApprovedAt,b.managementApprovedById,b.managementApprovedAt,
      s.id AS actualPackageSubmissionId,s.accountingApprovedById AS submissionAccountingApprovedById,s.accountingApprovedAt AS submissionAccountingApprovedAt,
      s.managementApprovedById AS submissionManagementApprovedById,s.managementApprovedAt AS submissionManagementApprovedAt,
      ${unifiedBundleApprovalsEnabled()?sql`a.status AS unifiedStatus,a.accountingApprovedById AS unifiedAccountingId,a.accountingApprovedAt AS unifiedAccountingAt,a.managementApprovedById AS unifiedManagementId,a.managementApprovedAt AS unifiedManagementAt,`:sql``}
      p.id AS actualOrderId
      FROM delegate_pricing_bundle_batches l LEFT JOIN po_pricing_batches b ON b.id=l.pricingBatchId
      LEFT JOIN purchase_orders p ON p.id=l.purchaseOrderId
      LEFT JOIN purchase_package_submissions s ON s.id=l.purchasePackageSubmissionId
      ${unifiedBundleApprovalsEnabled()?sql`LEFT JOIN delegate_pricing_bundle_approvals a ON a.bundleId=l.bundleId`:sql``}
      WHERE l.bundleId IN (${sql.join(ids.map(id => sql`${id}`), sql`,`)})`);
  }
  private permission(actor: PricingBundleActor, bundle: any, purchaseOrderIds: number[], approvals: any[] = []) {
    const blocked = { pdfAllowed: false, pdfBlockedReason: bundle.status === "open" ? "تنزيل PDF متاح بعد إرسال الحزمة للحسابات فقط" : PURCHASE_PDF_APPROVAL_MESSAGE };
    if (bundle.status === "open" || actor.role === "observer") return blocked;
    if (!isPurchasePdfApprover(actor)) return { pdfAllowed: true, pdfBlockedReason: null as string | null };
    const expected = new Set(purchaseOrderIds);
    const linked = approvals.filter(row => Number(row.bundleId) === Number(bundle.id));
    if (!expected.size || linked.length !== expected.size || new Set(linked.map(row => Number(row.purchaseOrderId))).size !== expected.size) return blocked;
    for (const row of linked) {
      const unifiedApproval=row.unifiedStatus?{accountingApprovedById:row.unifiedAccountingId,accountingApprovedAt:row.unifiedAccountingAt,
        managementApprovedById:row.unifiedManagementId,managementApprovedAt:row.unifiedManagementAt}:null;
      if (!expected.has(Number(row.purchaseOrderId)) || Number(row.actualOrderId) !== Number(row.purchaseOrderId)
        || Number(row.actualBatchId) !== Number(row.pricingBatchId) || Number(row.actualPurchaseOrderId) !== Number(row.purchaseOrderId)
        || !hasOwnPurchaseDocumentApproval(actor, unifiedApproval||row)) return blocked;
      if (row.purchasePackageSubmissionId != null) {
        if (Number(row.actualSubmissionId) !== Number(row.purchasePackageSubmissionId) || Number(row.actualPackageSubmissionId) !== Number(row.purchasePackageSubmissionId)
          || !hasOwnPurchaseDocumentApproval(actor, unifiedApproval||{ accountingApprovedById: row.submissionAccountingApprovedById, accountingApprovedAt: row.submissionAccountingApprovedAt,
            managementApprovedById: row.submissionManagementApprovedById, managementApprovedAt: row.submissionManagementApprovedAt })) return blocked;
      } else if (row.actualSubmissionId != null) return blocked;
    }
    return { pdfAllowed: true, pdfBlockedReason: null as string | null };
  }
  private async audit(tx: any, actorId: number, bundleId: number, action: string, detail: unknown = null) {
    await tx.execute(sql`INSERT INTO audit_logs (userId,action,entityType,entityId,newValues) VALUES (${actorId},${action},'delegate_pricing_bundle',${bundleId},${JSON.stringify(detail)})`);
  }
  private async source(tx: any, itemId: number, lock = false) {
    // Source identities are never rewritten. PO item is the unit of membership.
    const [item] = await rows(tx, sql`SELECT i.*,p.poNumber,p.packageId,p.status AS purchaseOrderStatus,p.siteId,p.sectionId,p.ticketId,p.ticketItemId,
      COALESCE(s.name,'—') AS sectionName,COALESCE(t.name,'—') AS siteName,COALESCE(n.nameAr,c.name,'—') AS categoryName
      FROM purchase_order_items i INNER JOIN purchase_orders p ON p.id=i.purchaseOrderId
      LEFT JOIN sections s ON s.id=p.sectionId LEFT JOIN sites t ON t.id=p.siteId LEFT JOIN center_categories c ON c.id=p.categoryId
      LEFT JOIN catalog_items ci ON ci.id=i.catalogItemId LEFT JOIN catalog_nodes n ON n.id=ci.nodeId
      WHERE i.id=${itemId} ${lock ? sql`FOR UPDATE` : sql``}`);
    if (!item) fail("الصنف غير موجود", "NOT_FOUND");
    return item;
  }
  private eligible(item: any, actorId: number) { try { assertBundleItemEligible(item, actorId); } catch (error: any) { fail(error.message, "CONFLICT"); } }
  private snapshotRow(item: any): PricingBundleRow {
    return { id: Number(item.id), purchaseOrderId: Number(item.purchaseOrderId), poNumber: item.poNumber, packageId: item.packageId ?? null, itemName: item.itemName, categoryName: item.categoryName, sectionName: item.sectionName, siteName: item.siteName, siteId: item.siteId ?? null, sectionId: item.sectionId ?? null, ticketId: item.ticketId ?? null, ticketItemId: item.ticketItemId ?? null, quantity: Number(item.quantity), unit: item.unit || "—", estimatedUnitCost: String(item.estimatedUnitCost), estimatedTotalCost: String(item.estimatedTotalCost), supplierName: item.supplierName || "—", delegateId: Number(item.delegateId), status: item.status,
      ...(isRoutedPurchaseItem(item) ? { reviewRole: item.reviewRole, reviewedById: Number(item.reviewedById), reviewedAt: item.reviewedAt instanceof Date ? item.reviewedAt.toISOString() : String(item.reviewedAt || "") } : {}),
    };
  }
  async list(actor: PricingBundleActor) {
    this.read(actor);
    const bundles = await rows(await this.ports.database(), sql`SELECT b.id,b.bundleNumber,b.delegateId,b.status,b.revision,b.createdAt,b.sentAt,b.effectsDone,u.name AS delegateName,
      (SELECT COUNT(*) FROM delegate_pricing_bundle_items i WHERE i.bundleId=b.id AND i.removedAt IS NULL) AS itemCount,
      (SELECT SUM(p.estimatedTotalCost) FROM delegate_pricing_bundle_items i INNER JOIN purchase_order_items p ON p.id=i.purchaseOrderItemId WHERE i.bundleId=b.id AND i.removedAt IS NULL) AS openTotal,
      JSON_EXTRACT(b.snapshotJson,'$.rows[*].estimatedTotalCost') AS sentTotals,
      JSON_EXTRACT(b.snapshotJson,'$.rows[*].purchaseOrderId') AS sentOrderIds,JSON_EXTRACT(b.snapshotJson,'$.rows[*].poNumber') AS sentOrderNumbers
      FROM delegate_pricing_bundles b INNER JOIN users u ON u.id=b.delegateId WHERE ${isDelegateRole(actor.role) ? sql`b.delegateId=${actor.id}` : isPurchasePdfApprover(actor) ? sql`b.status IN ('sent','archived')` : sql`1=1`} ORDER BY b.id DESC LIMIT 200`);
    return this.presentList(actor, bundles);
  }
  /** Document center only: sent archive, filters and pagination before approval hydration. */
  async listPage(actor: PricingBundleActor, input: DocumentListPageInput) {
    this.read(actor);
    const database = await this.ports.database();
    const base = sql`b.status IN ('sent','archived') AND ${isDelegateRole(actor.role) ? sql`b.delegateId=${actor.id}` : sql`1=1`} AND ${approvedBundleCondition()}`;
    const conditions = [base];
    if (input.delegateId != null) conditions.push(sql`b.delegateId=${input.delegateId}`);
    if (input.dateFrom) conditions.push(sql`COALESCE(b.sentAt,b.createdAt) >= ${documentDayBoundary(input.dateFrom)}`);
    if (input.dateTo) conditions.push(sql`COALESCE(b.sentAt,b.createdAt) < ${documentDayBoundary(input.dateTo, true)}`);
    if (input.search) {
      const pattern = documentSearchPattern(input.search);
      conditions.push(sql`(b.bundleNumber LIKE ${pattern} ESCAPE '=' OR u.name LIKE ${pattern} ESCAPE '=' OR JSON_EXTRACT(b.snapshotJson,'$.rows[*].poNumber') LIKE ${pattern} ESCAPE '=')`);
    }
    const where = sql.join(conditions, sql` AND `);
    const [totals, delegates] = await Promise.all([
      rows(database, sql`SELECT COUNT(*) AS total FROM delegate_pricing_bundles b INNER JOIN users u ON u.id=b.delegateId WHERE ${where}`),
      rows(database, sql`SELECT b.delegateId,u.name AS delegateName,COUNT(*) AS count FROM delegate_pricing_bundles b INNER JOIN users u ON u.id=b.delegateId WHERE ${base} GROUP BY b.delegateId,u.name`),
    ]);
    const total = Number(totals[0]?.total || 0);
    const page = Math.min(input.page, Math.max(1, Math.ceil(total / input.pageSize)));
    const direction = input.sort === "oldest" ? sql`ASC` : sql`DESC`;
    const bundles = await rows(database, sql`SELECT b.id,b.bundleNumber,b.delegateId,b.status,b.revision,b.createdAt,b.sentAt,b.effectsDone,u.name AS delegateName,
      JSON_EXTRACT(b.snapshotJson,'$.rows[*].estimatedTotalCost') AS sentTotals,
      JSON_EXTRACT(b.snapshotJson,'$.rows[*].purchaseOrderId') AS sentOrderIds,JSON_EXTRACT(b.snapshotJson,'$.rows[*].poNumber') AS sentOrderNumbers
      FROM delegate_pricing_bundles b INNER JOIN users u ON u.id=b.delegateId WHERE ${where}
      ORDER BY COALESCE(b.sentAt,b.createdAt) ${direction},b.id ${direction} LIMIT ${input.pageSize} OFFSET ${(page - 1) * input.pageSize}`);
    return { rows: await this.presentList(actor, bundles, true), total, page, pageSize: input.pageSize,
      count: delegates.reduce((n: number, row: any) => n + Number(row.count), 0),
      delegates: delegates.map((row: any) => ({ id: Number(row.delegateId), name: row.delegateName })) };
  }
  private async presentList(actor: PricingBundleActor, bundles: any[], approvedDocuments = false) {
    const visible = isPurchasePdfApprover(actor) ? bundles.filter((bundle: any) => ["sent", "archived"].includes(bundle.status)) : bundles;
    // listPage filters the complete membership through approvedBundleCondition before
    // pagination. Its final financial rendition is shared by the two approval roles;
    // the ordinary pricing list and the delegate's frozen PDF retain exact-actor rules.
    const completedForRole = approvedDocuments && isPurchasePdfApprover(actor);
    const approvals = isPurchasePdfApprover(actor) && !completedForRole ? await this.approvalRows(await this.ports.database(), visible.map((bundle: any) => Number(bundle.id))) : [];
    return visible.map(({ openTotal, sentTotals, sentOrderIds, sentOrderNumbers, ...bundle }: any) => {
      const totals = sentTotals == null ? null : json(sentTotals);
      const total = bundle.status === "open" ? Number(openTotal || 0) : Array.isArray(totals) && totals.length > 0 ? totals.reduce((sum: number, value: unknown) => sum + Math.round(Number(value) * 100), 0) / 100 : null;
      const ids = sentOrderIds == null ? [] : json(sentOrderIds), numbers = sentOrderNumbers == null ? [] : json(sentOrderNumbers);
      const purchaseOrders = Array.isArray(ids) ? Array.from(new Map(ids.map((id: any, i: number) => [Number(id), { id: Number(id), poNumber: numbers?.[i] || `PR-${id}` }])).values()) : [];
      return { ...bundle, total: total != null && Number.isFinite(total) ? total : null, purchaseOrders,
        ...(completedForRole ? { pdfAllowed: true, pdfBlockedReason: null } : this.permission(actor, bundle, purchaseOrders.map((order: any) => order.id), approvals)) };
    });
  }
  async detail(actor: PricingBundleActor, id: number) {
    const tx = await this.ports.database(), bundle = await this.header(tx, actor, id);
    if (isPurchasePdfApprover(actor) && bundle.status === "open") fail("الحزمة لم تُرسل للحسابات", "FORBIDDEN");
    let items: PricingBundleRow[];
    if (bundle.status === "open") {
      const links = await rows(tx, sql`SELECT purchaseOrderItemId FROM delegate_pricing_bundle_items WHERE bundleId=${id} AND removedAt IS NULL ORDER BY id`);
      items = [];
      for (const link of links) items.push(this.snapshotRow(await this.source(tx, Number(link.purchaseOrderItemId))));
    } else {
      const [stored] = await rows(tx, sql`SELECT snapshotJson FROM delegate_pricing_bundles WHERE id=${id}`);
      items = (json(stored.snapshotJson) as PricingBundleSnapshot).rows;
    }
    // Never disclose PDF bytes/keys or signature snapshots in read DTOs (observer included).
    const [person] = await rows(tx, sql`SELECT name FROM users WHERE id=${bundle.delegateId}`);
    const approvals = isPurchasePdfApprover(actor) ? await this.approvalRows(tx, [id]) : [];
    return { ...bundle, delegateName: person?.name || "—", items, total: items.reduce((sum, item) => sum + Math.round(Number(item.estimatedTotalCost) * 100), 0) / 100,
      ...this.permission(actor, bundle, items.map(item => Number(item.purchaseOrderId)), approvals) };
  }
  async add(actor: PricingBundleActor, itemId: number) {
    this.write(actor);
    return (await this.ports.database()).transaction(async (tx: any) => {
      await this.actorLock(tx, actor);
      const item = await this.source(tx, itemId, true); this.eligible(item, actor.id);
      const [existing] = await rows(tx, sql`SELECT bundleId FROM delegate_pricing_bundle_items WHERE reservedItemId=${itemId} FOR UPDATE`);
      if (existing) { await this.header(tx, actor, Number(existing.bundleId)); return { id: Number(existing.bundleId) }; }
      let [bundle] = await rows(tx, sql`SELECT id,bundleNumber FROM delegate_pricing_bundles WHERE openDelegateId=${actor.id} FOR UPDATE`);
      if (!bundle) {
        await tx.execute(sql`INSERT INTO delegate_pricing_bundles (delegateId,openDelegateId,status) VALUES (${actor.id},${actor.id},'open')`);
        [bundle] = await rows(tx, sql`SELECT id FROM delegate_pricing_bundles WHERE openDelegateId=${actor.id}`);
        const number = `DPB-${new Intl.DateTimeFormat("en", { year: "numeric", timeZone: "Asia/Riyadh" }).format(new Date())}-${String(bundle.id).padStart(6, "0")}`;
        await tx.execute(sql`UPDATE delegate_pricing_bundles SET bundleNumber=${number} WHERE id=${bundle.id}`);
      }
      const [{ count }] = await rows(tx, sql`SELECT COUNT(*) AS count FROM delegate_pricing_bundle_items WHERE bundleId=${bundle.id} AND removedAt IS NULL`);
      if (Number(count) >= PRICING_BUNDLE_LIMIT) fail("اكتمل الحد الأقصى للحزمة (20 صنفًا)؛ أرسلها للحسابات", "CONFLICT");
      await tx.execute(sql`INSERT INTO delegate_pricing_bundle_items (bundleId,purchaseOrderItemId,reservedItemId) VALUES (${bundle.id},${itemId},${itemId})`);
      await tx.execute(sql`UPDATE delegate_pricing_bundles SET revision=revision+1 WHERE id=${bundle.id}`);
      await this.audit(tx, actor.id, Number(bundle.id), "pricing_bundle_item_added", { itemId });
      return { id: Number(bundle.id) };
    });
  }
  async remove(actor: PricingBundleActor, id: number, itemId: number) {
    this.write(actor);
    return (await this.ports.database()).transaction(async (tx: any) => {
      await this.actorLock(tx, actor); const bundle = await this.header(tx, actor, id, true);
      if (bundle.status !== "open") fail("لا يمكن تعديل حزمة أُرسلت للحسابات", "CONFLICT");
      const [link] = await rows(tx, sql`SELECT id FROM delegate_pricing_bundle_items WHERE bundleId=${id} AND purchaseOrderItemId=${itemId} AND removedAt IS NULL FOR UPDATE`);
      if (!link) fail("الصنف لا ينتمي إلى هذه الحزمة", "NOT_FOUND");
      await tx.execute(sql`UPDATE delegate_pricing_bundle_items SET reservedItemId=NULL,removedAt=CURRENT_TIMESTAMP WHERE id=${link.id}`);
      await tx.execute(sql`UPDATE delegate_pricing_bundles SET revision=revision+1 WHERE id=${id}`);
      await this.audit(tx, actor.id, id, "pricing_bundle_item_returned", { itemId });
      return { success: true };
    });
  }
  private async snapshot(tx: any, actor: PricingBundleActor, bundle: any) {
    const links = await rows(tx, sql`SELECT purchaseOrderItemId FROM delegate_pricing_bundle_items WHERE bundleId=${bundle.id} AND removedAt IS NULL ORDER BY purchaseOrderItemId FOR UPDATE`);
    if (links.length === 0 || links.length > PRICING_BUNDLE_LIMIT) fail("الحزمة يجب أن تحتوي من 1 إلى 20 صنفًا");
    const items: PricingBundleRow[] = [];
    const sources = new Map<number, any>();
    for (const link of links) { const item = await this.source(tx, Number(link.purchaseOrderItemId), true); this.eligible(item, Number(bundle.delegateId)); sources.set(Number(item.id), item); items.push(this.snapshotRow(item)); }
    const routedItems = Array.from(sources.values()).filter(isRoutedPurchaseItem);
    if (routedItems.some(item => !Number.isSafeInteger(Number(item.reviewedById)) || Number(item.reviewedById) <= 0 || !item.reviewedAt)) fail("لم يكتمل توثيق مراجع أحد أصناف الحزمة", "CONFLICT");
    const reviewerIds = Array.from(new Set(routedItems.map(item => Number(item.reviewedById))));
    const reviewerRows = reviewerIds.length ? await rows(tx, sql`SELECT id,name FROM users WHERE id IN (${sql.join(reviewerIds.map(id => sql`${id}`), sql`,`)})`) : [];
    const reviewers = new Map(reviewerRows.map((row: any) => [Number(row.id), row]));
    const [delegate] = await rows(tx, sql`SELECT id,name,signatureUrl FROM users WHERE id=${bundle.delegateId}`);
    const signatures: PricingBundleSnapshot["signatures"] = [];
    // Keep the signature bytes frozen at send, but fetch each distinct image only once.
    const images = new Map<string, Promise<string>>();
    const image = (source: string | null) => {
      if (!source) return Promise.resolve("");
      if (!images.has(source)) images.set(source, this.ports.signature(source));
      return images.get(source)!;
    };
    for (const poId of Array.from(new Set(items.map(item => item.purchaseOrderId))).sort((a,b) => a-b)) {
      const [po] = await rows(tx, sql`SELECT p.poNumber,r.name AS requesterName,v.name AS reviewerName,p.requestedById AS requesterId,p.reviewedById AS reviewerId,COALESCE(NULLIF(p.requesterSignatureSnapshot,''),r.signatureUrl) AS requesterSignature,COALESCE(NULLIF(p.reviewerSignatureSnapshot,''),v.signatureUrl) AS reviewerSignature FROM purchase_orders p LEFT JOIN users r ON r.id=p.requestedById LEFT JOIN users v ON v.id=p.reviewedById WHERE p.id=${poId}`);
      if (!po) fail("طلب أصناف الحزمة غير موجود", "CONFLICT");
      const included = items.filter(item => item.purchaseOrderId === poId);
      const groups = new Map<string, PricingBundleSnapshot["signatures"][number]>();
      for (const includedItem of included) {
        const source = sources.get(includedItem.id)!;
        const routed = isRoutedPurchaseItem(source), reviewer = routed ? reviewers.get(Number(source.reviewedById)) : null;
        if (routed && !reviewer) fail("مراجع أحد أصناف الحزمة غير موجود", "CONFLICT");
        const reviewerId = routed ? Number(source.reviewedById) : po.reviewerId == null ? null : Number(po.reviewerId);
        // A missing signature at review time remains blank; never borrow today's profile signature.
        const reviewerSource = routed ? source.reviewerSignatureSnapshot || null : po.reviewerSignature || null;
        const reviewedAt = routed ? includedItem.reviewedAt : undefined;
        const key = `${reviewerId}|${reviewerSource || ""}|${reviewedAt || ""}`;
        const previous = groups.get(key);
        if (previous) { previous.purchaseOrderItemIds?.push(includedItem.id); continue; }
        groups.set(key, { purchaseOrderId: poId, poNumber: po.poNumber, requesterId: po.requesterId == null ? null : Number(po.requesterId), requesterName: po.requesterName || "—", reviewerId,
          reviewerName: routed ? reviewer.name || "—" : po.reviewerName || "—", requesterSignature: po.requesterSignature || "", reviewerSignature: reviewerSource || "", requesterSource: po.requesterSignature || null, reviewerSource,
          ...(routedItems.length ? { purchaseOrderItemIds: [includedItem.id], ...(reviewedAt ? { reviewedAt } : {}) } : {}),
        });
      }
      signatures.push(...Array.from(groups.values()));
    }
    const [delegateSignature, frozenSignatures] = await Promise.all([
      image(delegate.signatureUrl),
      Promise.all(signatures.map(async signature => {
        const [requesterSignature, reviewerSignature] = await Promise.all([image(signature.requesterSource ?? null), image(signature.reviewerSource ?? null)]);
        return { ...signature, requesterSignature, reviewerSignature };
      })),
    ]);
    return { number: bundle.bundleNumber, submittedAt: new Date().toISOString(), delegate: { id: Number(delegate.id), name: delegate.name || "—", signature: delegateSignature, signatureSource: delegate.signatureUrl || null }, rows: items, signatures: frozenSignatures, ...(routedItems.length ? { reviewSignatureVersion: 2 as const } : {}) } satisfies PricingBundleSnapshot;
  }
  async send(actor: PricingBundleActor, id: number, revision: number) {
    this.write(actor);
    await (await this.ports.database()).transaction(async (tx: any) => {
      await this.actorLock(tx, actor); const bundle = await this.header(tx, actor, id, true);
      if (bundle.status !== "open") return; // Idempotent repeated send; no second accounting batch.
      if (Number(bundle.revision) !== revision) fail("تغيرت محتويات الحزمة؛ حدّث الشاشة قبل الإرسال", "CONFLICT");
      const snapshot = await this.snapshot(tx, actor, bundle);
      // Return compensation is approved per pricing batch (its custody is only
      // the difference). A purchase-package submission would use the ordinary
      // aggregate custody writer instead, so reject that combination before
      // creating any accounting submission.
      const packagedOrderIds = Array.from(new Set(snapshot.rows.filter(item => item.packageId != null).map(item => item.purchaseOrderId)));
      if (packagedOrderIds.length) {
        const [database] = await rows(tx, sql`SELECT DATABASE() AS databaseName`);
        if (supplierReturnDatabaseEnabled(database?.databaseName)) {
          const replacements = await rows(tx, sql`SELECT purchaseOrderId FROM supplier_return_replacement_plans
            WHERE purchaseOrderId IN (${sql.join(packagedOrderIds.map(orderId => sql`${orderId}`), sql`,`)}) LIMIT 1`);
          if (replacements.length) fail("طلب تعويض المرتجع يعتمد فرق السعر في دفعة مستقلة؛ أخرجه من حزمة الشراء قبل إرسال التسعير", "CONFLICT");
        }
      }
      const compensations: NonNullable<PricingBundleSnapshot["compensations"]> = [];
      // Freeze the document inputs atomically with accounting; PDF rendering is deferred to download.
      const submissions = new Map<number, number>();
      for (const packageId of Array.from(new Set(snapshot.rows.map(item => item.packageId).filter((v): v is number => v != null))).sort((a,b) => a-b)) {
        await rows(tx, sql`SELECT id FROM purchase_packages WHERE id=${packageId} FOR UPDATE`);
        const submission = await this.ports.createPackageSubmission(packageId, actor.id, tx);
        if (!submission) throw new TRPCError({ code: "BAD_REQUEST", message: "تعذر إنشاء دفعة الحزمة الأصلية" });
        submissions.set(packageId, submission.id);
      }
      for (const poId of Array.from(new Set(snapshot.rows.map(item => item.purchaseOrderId))).sort((a,b) => a-b)) {
        const items = snapshot.rows.filter(item => item.purchaseOrderId === poId);
        const submissionId = items[0].packageId == null ? undefined : submissions.get(items[0].packageId);
        const signature = snapshot.signatures.find(entry => entry.purchaseOrderId === poId)!;
        // Existing PDF snapshot columns are initialized once, inside the same send transaction.
        if (items.some(item => isRoutedPurchaseItem(item))) {
          await tx.execute(sql`UPDATE purchase_orders SET requesterSignatureSnapshot=COALESCE(NULLIF(requesterSignatureSnapshot,''),${signature.requesterSource ?? null}) WHERE id=${poId}`);
        } else {
          await tx.execute(sql`UPDATE purchase_orders SET requesterSignatureSnapshot=COALESCE(NULLIF(requesterSignatureSnapshot,''),${signature.requesterSource ?? null}),reviewerSignatureSnapshot=COALESCE(NULLIF(reviewerSignatureSnapshot,''),${signature.reviewerSource ?? null}) WHERE id=${poId}`);
        }
        const batch = await this.ports.submitPO(poId, actor, { selectedItemIds: items.map(item => item.id), tx, purchasePackageSubmissionId: submissionId, skipArchive: true, bundleId: id, delegateSignatureSnapshot: snapshot.delegate.signatureSource });
        if (!batch.batchId || batch.itemCount !== items.length) fail("لم تتطابق دفعة الحسابات مع أصناف الحزمة", "CONFLICT");
        if (batch.replacementCompensation) compensations.push(batch.replacementCompensation);
        await tx.execute(sql`INSERT INTO delegate_pricing_bundle_batches (bundleId,purchaseOrderId,pricingBatchId,purchasePackageSubmissionId) VALUES (${id},${poId},${batch.batchId},${submissionId ?? null})`);
      }
      await tx.execute(sql`UPDATE delegate_pricing_bundle_items SET reservedItemId=NULL WHERE bundleId=${id} AND removedAt IS NULL`);
      await tx.execute(sql`UPDATE delegate_pricing_bundles SET status='archived',openDelegateId=NULL,sentAt=CURRENT_TIMESTAMP,revision=revision+1,snapshotJson=${JSON.stringify(compensations.length ? { ...snapshot, compensations } : snapshot)},pdfContent=NULL WHERE id=${id}`);
      await this.audit(tx, actor.id, id, "pricing_bundle_sent", { itemIds: snapshot.rows.map(item => item.id) });
      await this.audit(tx, actor.id, id, "pricing_bundle_archived", { automatic: true });
      await initializeUnifiedApproval(tx,id);
    });
    // Durable per-PO finalization retries existing notifications/audit/ticket sync, never accounting submission.
    try { return {success:true,effectsDone:await this.finish(actor,id)}; }
    catch (error) { console.error("[PricingBundle] finalization is pending", error); return { success: true, effectsDone: false }; }
  }
  async finish(actor: PricingBundleActor, id: number) {
    this.write(actor);
    const done=await (await this.ports.database()).transaction(async (tx: any) => {
      const bundle = await this.header(tx, actor, id, true);
      if (bundle.status === "open") fail("الحزمة لم تُرسل");
      if (bundle.effectsDone) return true;
      const batches = await rows(tx, sql`SELECT purchaseOrderId,pricingBatchId FROM delegate_pricing_bundle_batches WHERE bundleId=${id} AND effectsDone=0 ORDER BY purchaseOrderId`);
      try {
        for (const batch of batches) {
          await this.ports.sync(Number(batch.purchaseOrderId), actor.id, Number(batch.pricingBatchId));
          await tx.execute(sql`UPDATE delegate_pricing_bundle_batches SET effectsDone=1 WHERE bundleId=${id} AND pricingBatchId=${Number(batch.pricingBatchId)}`);
        }
        await tx.execute(sql`UPDATE delegate_pricing_bundles SET effectsDone=1 WHERE id=${id}`); return true;
      } catch (error) { console.error("[PricingBundle] linked workflow finalization requires retry", error); return false; }
    });
    if(unifiedBundleApprovalsEnabled()&&this.ports.finishUnifiedSend)await this.ports.finishUnifiedSend(actor,id);
    return done;
  }
  async pdf(actor: PricingBundleActor, id: number, approvedDocument = false) {
    this.read(actor); if (actor.role === "observer") fail("المراقب لا يستطيع التصدير", "FORBIDDEN");
    const database = await this.ports.database();
    // Authorize every request before consulting the shared render promise, including cached files.
    const bundle = await this.header(database, actor, id);
    if (bundle.status === "open") fail("تنزيل PDF متاح بعد إرسال الحزمة للحسابات فقط", "CONFLICT");
    if (isPurchasePdfApprover(actor) && !approvedDocument) {
      const [stored] = await rows(database, sql`SELECT snapshotJson FROM delegate_pricing_bundles WHERE id=${id}`);
      const frozen = json(stored?.snapshotJson);
      const ids = Array.isArray(frozen?.rows) ? frozen.rows.map((item: any) => Number(item?.purchaseOrderId)) : [];
      const permission = this.permission(actor, bundle, ids, await this.approvalRows(database, [id]));
      if (!permission.pdfAllowed) fail(permission.pdfBlockedReason!, "FORBIDDEN");
    }
    if (approvedDocument && !isDelegateRole(actor.role)) {
      const [stored] = await rows(database, sql`SELECT snapshotJson FROM delegate_pricing_bundles WHERE id=${id}`);
      const snapshot = json(stored?.snapshotJson) as PricingBundleSnapshot;
      // Retain the historical approved-document shape; new routed snapshots
      // additionally require exact item/reviewer membership before rendering.
      if (!snapshot || snapshot.number !== bundle.bundleNumber || Number(snapshot.delegate?.id) !== Number(bundle.delegateId)
        || !Array.isArray(snapshot.rows) || !snapshot.rows.length || snapshot.rows.length > PRICING_BUNDLE_LIMIT
        || !Array.isArray(snapshot.signatures)) fail("لقطة الحزمة المحفوظة غير مكتملة؛ تعذر إنشاء PDF");
      if (snapshot.reviewSignatureVersion !== undefined || snapshot.rows.some(item => item.reviewRole != null)) this.readSnapshot(snapshot, bundle);
      // This fresh full-membership check is the authorization boundary for the
      // completed document shared by accounting/management, not a prior list flag.
      // Never replace pdfContent or the delegate's frozen snapshot.
      const approved = await approvedBundleSnapshot(database, bundle, snapshot, source => this.ports.signature(source));
      const pdf = this.checkedPdf(await this.ports.render(approved));
      return { name: `${bundle.bundleNumber}.pdf`, content: pdf.toString("base64") };
    }
    let pending = this.pendingPdfs.get(id);
    if (!pending) {
      pending = this.storedPdf(database, bundle).finally(() => this.pendingPdfs.delete(id));
      this.pendingPdfs.set(id, pending);
    }
    const pdf = await pending;
    return { name: `${bundle.bundleNumber}.pdf`, content: pdf.toString("base64") };
  }
  private checkedPdf(value: unknown): Buffer {
    if (!(Buffer.isBuffer(value) || value instanceof Uint8Array) || value.length === 0 || value.length > 8 * 1024 * 1024)
      fail("تعذر تجهيز ملف PDF؛ الحزمة مرسلة للحسابات. أعد محاولة التنزيل");
    return Buffer.from(value as Uint8Array);
  }
  private readSnapshot(raw: unknown, bundle: any): PricingBundleSnapshot {
    let snapshot: PricingBundleSnapshot;
    try {
      snapshot = json(raw);
      if (!snapshot || snapshot.number !== bundle.bundleNumber || Number(snapshot.delegate?.id) !== Number(bundle.delegateId)
        || typeof snapshot.delegate?.signature !== "string" || !Array.isArray(snapshot.rows)
        || snapshot.rows.length === 0 || snapshot.rows.length > PRICING_BUNDLE_LIMIT || !Array.isArray(snapshot.signatures)
        || snapshot.rows.some(item => !item || !Number.isInteger(item.id) || !Number.isInteger(item.purchaseOrderId)
          || !snapshot.signatures.some(signature => signature.purchaseOrderId === item.purchaseOrderId
            && typeof signature.requesterSignature === "string" && typeof signature.reviewerSignature === "string"))) throw Error("Invalid frozen snapshot");
      if (snapshot.reviewSignatureVersion !== undefined && snapshot.reviewSignatureVersion !== 2) throw Error("Unknown review snapshot version");
      if (snapshot.reviewSignatureVersion === 2) {
        const byItem = new Map(snapshot.rows.map(item => [item.id, item]));
        if (snapshot.signatures.some(signature => !Array.isArray(signature.purchaseOrderItemIds) || !signature.purchaseOrderItemIds.length
          || new Set(signature.purchaseOrderItemIds).size !== signature.purchaseOrderItemIds.length
          || signature.purchaseOrderItemIds.some(id => byItem.get(id)?.purchaseOrderId !== signature.purchaseOrderId))) throw Error("Invalid signature membership");
        for (const item of snapshot.rows) {
          const linked = snapshot.signatures.filter(signature => signature.purchaseOrderItemIds?.includes(item.id));
          if (linked.length !== 1) throw Error("Ambiguous item reviewer");
          if (item.reviewRole != null && (!isRoutedPurchaseItem(item) || !item.reviewedAt || !Number.isSafeInteger(item.reviewedById)
            || Number(item.reviewedById) <= 0 || linked[0].reviewerId !== item.reviewedById || linked[0].reviewedAt !== item.reviewedAt)) throw Error("Invalid item review decision");
        }
      } else if (snapshot.rows.some(item => item.reviewRole != null)) throw Error("Missing review snapshot version");
    } catch {
      fail("لقطة الحزمة المحفوظة غير مكتملة؛ تعذر إنشاء PDF");
    }
    return snapshot!;
  }
  private async storedPdf(database: any, bundle: any): Promise<Buffer> {
    const [stored] = await rows(database, sql`SELECT pdfContent,snapshotJson FROM delegate_pricing_bundles WHERE id=${bundle.id}`);
    if (stored?.pdfContent != null) return this.checkedPdf(stored.pdfContent);
    const snapshot = this.readSnapshot(stored?.snapshotJson, bundle);
    let pdf: Buffer;
    try { pdf = this.checkedPdf(await this.ports.render(snapshot!)); }
    catch (cause) { throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "تعذر تجهيز ملف PDF؛ الحزمة مرسلة للحسابات. أعد محاولة التنزيل", cause }); }
    // Render outside SQL transactions. Concurrent app instances keep the first saved bytes.
    await database.execute(sql`UPDATE delegate_pricing_bundles SET pdfContent=${pdf} WHERE id=${bundle.id} AND status IN ('sent','archived') AND pdfContent IS NULL AND revision=${Number(bundle.revision)}`);
    const [saved] = await rows(database, sql`SELECT pdfContent FROM delegate_pricing_bundles WHERE id=${bundle.id}`);
    return this.checkedPdf(saved?.pdfContent);
  }
  async archive(actor: PricingBundleActor, id: number) {
    this.write(actor); const database = await this.ports.database();
    return database.transaction(async (tx: any) => {
      await this.actorLock(tx, actor); const bundle = await this.header(tx, actor, id, true);
      if (bundle.status === "open") fail("أرسل الحزمة أولًا");
      await tx.execute(sql`UPDATE delegate_pricing_bundles SET status='archived' WHERE id=${id}`);
      await this.audit(tx, actor.id, id, "pricing_bundle_archived"); return { success: true };
    });
  }
}

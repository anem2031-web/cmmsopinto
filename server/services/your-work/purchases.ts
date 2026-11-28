import { TRPCError } from "@trpc/server";
import { sql } from "drizzle-orm";
import type { TrpcContext } from "../../_core/context";
import * as db from "../../_core/db";
import { createPurchaseOrderReadScope, createPurchaseOrderReadGuard } from "../../_core/authz/guard";
import { readScopeChunks, groupReadRows } from "../../_core/authz/read-batch";
import { canPerformAction, canPerformItemStatusAction, canResolvePOItemDelegateChange, canResolveCreatorReturnedItem } from "../../_core/authz/engine";
import { ROUTED_REVIEW_BLOCKED_PO_STATUSES } from "../../_core/authz/policy";
import { canReviewPurchaseItem, isRoutedPurchaseItem } from "../../../shared/purchase-item-review";
import { canReviewPurchaseSpecifications } from "../../../shared/purchase-specifications";
import { canApprovePricingBundleStage } from "../../../shared/business-role-policy";
import { canReadYourWork, yourWorkMillis, type YourWorkIdentity, type YourWorkItem } from "../../../shared/your-work";

type Stage = "accounting" | "management";
type Scope = Awaited<ReturnType<typeof createPurchaseOrderReadScope>>;
export type PurchaseWorkMetadata = { batches: any[]; comments: any[]; history: any[]; tables: Set<string> };
export interface YourWorkPurchasePorts {
  database(): Promise<any>;
  orders(actor: YourWorkIdentity): Promise<any[]>;
  items(ids: number[]): Promise<any[]>;
  scope(actor: YourWorkIdentity, orders: any[]): Promise<Scope>;
  metadata(database: any, orderIds: number[], itemIds: number[]): Promise<PurchaseWorkMetadata>;
  submissions(ids: number[]): Promise<any[]>;
  bundleEnabled(): boolean;
  bundleQueue(actor: YourWorkIdentity, afterId: number, stage?: Stage): Promise<{ items: any[]; nextId: number | null }>;
  bundleTimes(database: any, ids: number[], emergencyIds?: number[]): Promise<any[]>;
  specifications(actor: YourWorkIdentity, page: number): Promise<{ rows: any[]; total: number }>;
  returns(actor: YourWorkIdentity, database: any, page: number): Promise<{ items: any[]; total: number }>;
  returnTimes(database: any, ids: number[]): Promise<any[]>;
  pendingInventory(): Promise<any[]>;
  contexts(ids: number[]): Promise<Map<number, any>>;
}
const idsSql = (ids: number[]) => sql.join(ids.map(id => sql`${id}`), sql`, `);
/** Exact transition: the last first physical receipt or cancellation that made every frozen member accounted for. */
export function emergencyAccountingArrival(members: readonly { cancelledAt?: unknown; receiptAt?: unknown }[]): number | null {
  if (!members.length || !members.some(member => member.cancelledAt == null && yourWorkMillis(member.receiptAt) != null)) return null;
  const times = members.map(member => yourWorkMillis(member.cancelledAt ?? member.receiptAt));
  return times.some(time => time == null) ? null : Math.max(...times as number[]);
}
async function rows(database: any, query: any): Promise<any[]> {
  const result = await database.execute(query);
  if (!Array.isArray(result?.[0])) throw new Error("تعذر قراءة الأعمال المطلوبة في المشتريات");
  return result[0];
}
/** Candidate headers only: no historical order/item-name/delegate enrichment. The canonical scope still authorizes every parent below. */
export async function readCandidatePurchaseHeaders(database: any, actor: YourWorkIdentity): Promise<any[]> {
  const functional = ["owner", "admin", "maintenance_manager", "general_maintenance_manager", "construction_procurement_manager", "accountant", "senior_management", "warehouse"].includes(actor.role);
  const warehouse = ["owner", "admin", "warehouse"].includes(actor.role);
  const actorScope = functional ? sql`1=1` : actor.role === "food_warehouse_manager"
    ? sql`(p.requestedById=${actor.id} OR EXISTS (SELECT 1 FROM users requester WHERE requester.id=p.requestedById AND requester.role='food_warehouse_assistant'))`
    : sql`p.requestedById=${actor.id}`;
  return rows(database, sql`SELECT p.*,pk.packageNumber FROM purchase_orders p LEFT JOIN purchase_packages pk ON pk.id=p.packageId
    WHERE ${actorScope}
      AND (p.status<>'draft' OR p.requestedById=${actor.id})
      AND ((p.status='draft' AND p.requestedById=${actor.id}) OR p.status IN ('pending_review','revision_needed','pending_accounting','pending_management')
        OR (p.status NOT IN ('closed','rejected') AND EXISTS(SELECT 1 FROM purchase_order_items i WHERE i.purchaseOrderId=p.id AND
          (i.status IN ('pending_review','needs_item_revision','purchase_cancelled') OR (i.status='pending' AND i.batchId IS NULL AND i.delegateChangeRequestedAt IS NOT NULL)
            ${warehouse ? sql`OR i.status IN ('purchased','delivered_to_warehouse')` : sql``})))
        OR EXISTS(SELECT 1 FROM po_pricing_batches b WHERE b.purchaseOrderId=p.id AND b.status IN ('pending_accounting','pending_management')))
    ORDER BY p.id`);
}
const defaults: YourWorkPurchasePorts = {
  database: async () => { const value = await db.getDb(); if (!value) throw new Error("قاعدة البيانات غير متاحة"); return value; },
  orders: async actor => readCandidatePurchaseHeaders(await defaults.database(), actor),
  items: ids => db.getFullPOItemsForPOs(ids),
  scope: createPurchaseOrderReadScope,
  metadata: async (database, orderIds, itemIds) => {
    const tables = new Set<string>((await rows(database, sql`SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()
      AND TABLE_NAME IN ('delegate_pricing_bundle_approvals','purchase_order_item_history','supplier_return_cases','supplier_return_events')`)).map(row => String(row.name).toLowerCase()));
    const batches = await readScopeChunks(orderIds, chunk => rows(database, sql`SELECT b.*,
      ${tables.has("delegate_pricing_bundle_approvals") ? sql`EXISTS(SELECT 1 FROM delegate_pricing_bundle_batches l JOIN delegate_pricing_bundle_approvals a ON a.bundleId=l.bundleId WHERE l.pricingBatchId=b.id)` : sql`0`} AS unifiedManaged
      FROM po_pricing_batches b WHERE b.purchaseOrderId IN (${idsSql(chunk)}) AND b.status IN ('pending_accounting','pending_management')`));
    const comments = await readScopeChunks(orderIds, chunk => rows(database, sql`SELECT purchaseOrderId,
      MAX(CASE WHEN actionType='resubmitted' THEN createdAt END) AS resubmittedAt,
      MAX(CASE WHEN actionType='return_for_revision' THEN createdAt END) AS returnedAt
      FROM procurement_comments WHERE purchaseOrderId IN (${idsSql(chunk)}) GROUP BY purchaseOrderId`));
    const history = tables.has("purchase_order_item_history") ? await readScopeChunks(itemIds, chunk => rows(database, sql`SELECT purchaseOrderItemId,
      MAX(CASE WHEN newStatus='pending_review' AND (previousStatus IS NULL OR previousStatus<>newStatus) THEN createdAt END) AS reviewStartedAt,
      MAX(CASE WHEN newStatus='delivered_to_warehouse' AND (previousStatus IS NULL OR previousStatus<>newStatus) THEN createdAt END) AS warehouseStartedAt
      FROM purchase_order_item_history WHERE purchaseOrderItemId IN (${idsSql(chunk)}) GROUP BY purchaseOrderItemId`)) : [];
    return { batches, comments, history, tables };
  },
  submissions: ids => db.getPackageSubmissionsWithBatchesForPackages(ids),
  bundleEnabled: () => process.env.DELEGATE_PRICING_BUNDLES_ENABLED === "true" && process.env.DELEGATE_PRICING_BUNDLE_APPROVALS_ENABLED === "true",
  bundleQueue: async (actor, afterId, stage) => {
    const [{ UnifiedBundleApprovalService }, { unifiedApprovalPorts }] = await Promise.all([
      import("../delegate-pricing-bundles/unified-approval"), import("../../routers/delegate-pricing-bundles/unified-ports"),
    ]);
    return new UnifiedBundleApprovalService(unifiedApprovalPorts).queue(actor as any, afterId, stage);
  },
  bundleTimes: async (database, ids, emergencyIds = []) => {
    const saved = await readScopeChunks(ids, chunk => rows(database, sql`SELECT a.bundleId,a.accountingApprovedAt,b.snapshotJson
      FROM delegate_pricing_bundle_approvals a JOIN delegate_pricing_bundles b ON b.id=a.bundleId WHERE a.bundleId IN (${idsSql(chunk)})`));
    // The confirmed receipt writer creates the physical receipt and moves the root in the same transaction.
    // ReceivedAt on a generic/older invoice draft, updatedAt, and the delegate's delivery are never used.
    const coverage = await readScopeChunks(emergencyIds, chunk => rows(database, sql`SELECT e.bundleId,e.purchaseOrderItemId,e.cancelledAt,
      MIN(CASE WHEN r.id IS NOT NULL AND l.id IS NOT NULL THEN r.createdAt END) AS receiptAt
      FROM emergency_purchase_items e
      LEFT JOIN warehouse_receipt_items ri ON ri.purchaseOrderItemId=e.purchaseOrderItemId AND ri.receivedQuantity>0
      LEFT JOIN warehouse_receipts r ON r.id=ri.receiptId AND r.status='confirmed'
      LEFT JOIN inventory_lots l ON l.receiptId=r.id AND l.receiptItemId=ri.id AND l.purchaseOrderItemId=ri.purchaseOrderItemId
      WHERE e.bundleId IN (${idsSql(chunk)}) GROUP BY e.bundleId,e.purchaseOrderItemId,e.cancelledAt`));
    const byBundle = groupReadRows(coverage, row => Number(row.bundleId));
    return saved.map(row => ({ ...row, emergencyAccountingAt: emergencyAccountingArrival(byBundle.get(Number(row.bundleId)) || []) }));
  },
  specifications: async (actor, page) => {
    const { PurchaseSpecificationsService } = await import("../purchase-specifications");
    return new PurchaseSpecificationsService({ database: defaults.database, readGuard: createPurchaseOrderReadGuard }).list(actor, { page, pageSize: 50 });
  },
  returns: async (actor, database, page) => {
    const { supplierReturnStatus, listSupplierReturns } = await import("../../supplier-return-followup/runtime");
    if (!(await supplierReturnStatus(actor, database)).enabled) return { items: [], total: 0 };
    return listSupplierReturns(actor, { page, pageSize: 50, status: "active" }, database);
  },
  returnTimes: (database, ids) => readScopeChunks(ids, chunk => rows(database, sql`SELECT caseId,
    MAX(CASE WHEN action='reject' THEN createdAt END) AS rejectedAt,
    MAX(CASE WHEN action='resolve' THEN createdAt END) AS resolutionAt,
    MAX(CASE WHEN action='cash_refund_confirmed' THEN createdAt END) AS refundAt
    FROM supplier_return_events WHERE caseId IN (${idsSql(chunk)}) GROUP BY caseId`)),
  pendingInventory: () => db.getPOItemsPendingInventoryEntry(),
  contexts: ids => db.getPurchaseOrderTicketContextBatch(ids),
};

const financeAction = (stage: Stage) => stage === "accounting" ? "purchase_accounting" as const : "purchase_management" as const;
function financeAllowed(actor: YourWorkIdentity, stage: Stage, poStatus: string) {
  // The DPB-only senior accounting capability must not escape into PR/PB.
  if (!["owner", "admin", stage === "accounting" ? "accountant" : "senior_management"].includes(actor.role)) return false;
  return canPerformAction(stage === "accounting" ? "approveAccounting" : "approveManagement", { role: actor.role, userId: actor.id, isActive: actor.isActive }, { status: poStatus });
}
function title(item: any, actor: YourWorkIdentity): string | null {
  return actor.preferredLanguage === "en" ? item.itemNameEn || item.itemName_en || item.itemName || null
    : actor.preferredLanguage === "ur" ? item.itemNameUr || item.itemName_ur || item.itemName || null : item.itemNameAr || item.itemName_ar || item.itemName || null;
}
const blocked = (po: any) => (ROUTED_REVIEW_BLOCKED_PO_STATUSES as readonly string[]).includes(po.status);
const itemLink = (po: any, item?: any) => `/purchase-orders/${po.id}${item ? `?itemId=${item.id}` : ""}`;

/** One request-local authorization scope and batched transitions; never invokes a writer or a repairing query. */
export async function readYourWorkPurchases(ctx: TrpcContext, overrides: Partial<YourWorkPurchasePorts> = {}): Promise<YourWorkItem[]> {
  const actor = ctx.authenticatedUser ?? ctx.user;
  if (!canReadYourWork(actor)) throw new TRPCError({ code: "FORBIDDEN" });
  const port = { ...defaults, ...overrides };
  const database = await port.database();
  const allOrders = await port.orders(actor);
  const scope = await port.scope(actor, allOrders);
  const visible = scope.filter(allOrders), byId = new Map(visible.map(po => [Number(po.id), po]));
  const rawItems = await port.items(visible.map(po => Number(po.id)));
  const grouped = groupReadRows(rawItems, (item: any) => Number(item.purchaseOrderId));
  const items = visible.flatMap(po => scope.filterItems(po, grouped.get(Number(po.id)) || []));
  const byPo = groupReadRows(items, (item: any) => Number(item.purchaseOrderId));
  const metadata = await port.metadata(database, visible.map(po => Number(po.id)), items.map(item => Number(item.id)));
  const commentByPo = new Map(metadata.comments.map(row => [Number(row.purchaseOrderId), row]));
  const historyByItem = new Map(metadata.history.map(row => [Number(row.purchaseOrderItemId), row]));
  const result: YourWorkItem[] = [], coveredBatches = new Set<number>(), coveredSubmissions = new Set<number>(), unifiedOrders = new Set<number>();

  if (port.bundleEnabled() && ["accountant", "senior_management", "owner", "admin"].includes(actor.role)) {
    const bundleRows: any[] = [];
    const stages: (Stage | undefined)[] = actor.role === "senior_management" ? ["accounting", "management"] : [undefined];
    for (const stage of stages) {
      let afterId = 0;
      for (;;) {
        const page = await port.bundleQueue(actor, afterId, stage);
        bundleRows.push(...page.items);
        if (page.nextId == null) break;
        if (!(page.nextId > afterId)) throw new Error("تعذر متابعة صفحات حزم التسعير");
        afterId = page.nextId;
      }
    }
    const times = new Map((await port.bundleTimes(database, bundleRows.map(row => Number(row.id)), bundleRows.filter(row => row.emergencyPurchase && row.status === "pending_accounting").map(row => Number(row.id)))).map(row => [Number(row.bundleId), row]));
    for (const row of bundleRows) {
      // The early emergency card is progress, not an available approval.
      if (row.approvalReady === false || !["pending_accounting", "pending_management"].includes(row.status)) continue;
      const stage: Stage = row.status === "pending_accounting" ? "accounting" : "management";
      if (!canApprovePricingBundleStage(actor as any, stage)) continue;
      const saved = times.get(Number(row.id));
      const snapshot = saved?.snapshotJson == null ? null : typeof saved.snapshotJson === "string" ? JSON.parse(saved.snapshotJson) : saved.snapshotJson;
      const arrival = stage === "management" ? saved?.accountingApprovedAt : row.emergencyPurchase ? saved?.emergencyAccountingAt : snapshot?.submittedAt;
      result.push({ key: `dpb:${row.id}:${stage}`, kind: "pricing_bundle", reference: row.bundleNumber, action: financeAction(stage),
        href: `/delegate-pricing-bundles?approval=${row.id}&stage=${stage}`, arrivedAt: yourWorkMillis(arrival) });
      for (const id of row.batchIds || []) coveredBatches.add(Number(id));
      for (const id of row.submissionIds || []) coveredSubmissions.add(Number(id));
      for (const id of row.orderIds || []) unifiedOrders.add(Number(id));
    }
  }

  if (["accountant", "senior_management", "owner", "admin"].includes(actor.role)) {
    const submissions = await port.submissions(visible.map(po => Number(po.packageId)).filter(Boolean));
    const unifiedBatchIds = new Set(metadata.batches.filter(batch => Number(batch.unifiedManaged) === 1).map(batch => Number(batch.id)));
    for (const sub of submissions) {
      if (coveredSubmissions.has(Number(sub.id)) || (sub.batches || []).some((b: any) => unifiedBatchIds.has(Number(b.id)))) continue;
      const stage: Stage | null = sub.status == null || sub.status === "pending_accounting" ? "accounting" : sub.status === "pending_management" ? "management" : null;
      if (!stage || !financeAllowed(actor, stage, `pending_${stage}`)) continue;
      const batches = sub.batches || [], pending = batches.filter((batch: any) => batch.status === `pending_${stage}`);
      if (!pending.length || batches.some((batch: any) => {
        const po = byId.get(Number(batch.purchaseOrderId));
        return !po || Number(po.packageId) !== Number(sub.purchasePackageId) ||
          Number(batch.purchasePackageSubmissionId) !== Number(sub.id) || !["rejected", `pending_${stage}`].includes(batch.status) ||
          scope.filterBatches(po, [batch]).length === 0 || (batch.status !== "rejected" && !(byPo.get(Number(po.id)) || []).some((item: any) => Number(item.batchId) === Number(batch.id) && item.status === "estimated"));
      })) continue;
      const po = byId.get(Number(pending[0].purchaseOrderId))!;
      result.push({ key: `pb:${sub.id}:${stage}`, kind: "pricing_submission", reference: `${(po as any).packageNumber || `PB-${sub.purchasePackageId}`}-${sub.subNumber}`,
        action: financeAction(stage), href: `/purchase-packages/${sub.purchasePackageId}?submissionId=${sub.id}`,
        arrivedAt: yourWorkMillis(stage === "accounting" ? sub.createdAt : sub.accountingApprovedAt) });
      for (const batch of pending) coveredBatches.add(Number(batch.id));
    }
  }

  const batchesByPo = groupReadRows(metadata.batches, batch => Number(batch.purchaseOrderId));
  for (const po of visible as any[]) {
    const poItems = byPo.get(Number(po.id)) || [], comments = commentByPo.get(Number(po.id));
    if (po.status === "draft" && Number(po.requestedById) === actor.id &&
      canPerformAction("editDraft", { role: actor.role, userId: actor.id, isActive: actor.isActive, isCreator: true }, po) &&
      canPerformAction("submitDraft", { role: actor.role, userId: actor.id, isActive: actor.isActive, isCreator: true }, po)) {
      result.push({ key: `pr:${po.id}:draft`, kind: "purchase", reference: po.poNumber, action: "purchase_draft", href: `/purchase-orders/edit-draft/${po.id}`, arrivedAt: null });
      continue;
    }
    if (po.status === "revision_needed" && Number(po.requestedById) === actor.id) {
      result.push({ key: `pr:${po.id}:revision`, kind: "purchase", reference: po.poNumber, action: "purchase_revision", href: itemLink(po), arrivedAt: yourWorkMillis(comments?.returnedAt) });
      continue;
    }
    if (blocked(po)) continue;
    for (const item of poItems as any[]) {
      const base = { kind: "purchase" as const, reference: po.poNumber, title: title(item, actor), href: itemLink(po, item) };
      const officialArrival = comments?.resubmittedAt || po.submittedAt;
      const existingAtSubmission = yourWorkMillis(item.createdAt) != null && yourWorkMillis(officialArrival) != null && yourWorkMillis(item.createdAt)! <= yourWorkMillis(officialArrival)!;
      if (canReviewPurchaseItem(actor, item)) result.push({ ...base, key: `pr:${po.id}:review:${item.id}`, action: "purchase_review", arrivedAt: yourWorkMillis(historyByItem.get(Number(item.id))?.reviewStartedAt || (existingAtSubmission ? officialArrival : null)) });
      else if (canResolvePOItemDelegateChange({ role: actor.role, userId: actor.id, isActive: actor.isActive }, { ...item, itemStatus: item.status, reviewedById: item.reviewRole != null ? item.reviewedById : po.reviewedById })) {
        result.push({ ...base, key: `pr:${po.id}:delegate:${item.id}`, action: "purchase_delegate_change", arrivedAt: yourWorkMillis(item.delegateChangeRequestedAt) });
      } else if (Number(po.requestedById) === actor.id && canResolveCreatorReturnedItem({ role: actor.role, userId: actor.id }, { requestedById: po.requestedById, itemStatus: item.status })) {
        result.push({ ...base, key: `pr:${po.id}:returned:${item.id}`, action: item.status === "purchase_cancelled" ? "purchase_cancel_review" : "purchase_revision", arrivedAt: yourWorkMillis(item.status === "purchase_cancelled" ? item.purchaseCancelledAt : item.itemRevisionRequestedAt) });
      }
    }
    if (po.status === "pending_review" && poItems.some(item => !isRoutedPurchaseItem(item) && ["pending", "pending_review"].includes(item.status)) && canPerformAction("reviewItems", { role: actor.role, userId: actor.id, isActive: actor.isActive }, po)) {
      result.push({ key: `pr:${po.id}:review`, kind: "purchase", reference: po.poNumber, action: "purchase_review", href: itemLink(po), arrivedAt: yourWorkMillis(comments?.resubmittedAt || po.submittedAt) });
    }
    for (const batch of batchesByPo.get(Number(po.id)) || []) {
      if (Number(batch.unifiedManaged) === 1 || coveredBatches.has(Number(batch.id)) || batch.purchasePackageSubmissionId != null) continue;
      const stage: Stage = batch.status === "pending_accounting" ? "accounting" : "management";
      if (!financeAllowed(actor, stage, `pending_${stage}`) || scope.filterBatches(po, [batch]).length === 0 || !poItems.some(item => Number(item.batchId) === Number(batch.id) && item.status === "estimated")) continue;
      if (stage === "management" && !(Number(batch.accountingApprovedById) > 0 && batch.accountingApprovedAt)) continue;
      result.push({ key: `pr-batch:${batch.id}:${stage}`, kind: "purchase", reference: `${po.poNumber} / ${batch.batchNumber}`, action: financeAction(stage), href: `${itemLink(po)}?workBatchId=${batch.id}`, arrivedAt: yourWorkMillis(stage === "accounting" ? batch.submittedAt : batch.accountingApprovedAt) });
    }
    const stage: Stage | null = po.status === "pending_accounting" ? "accounting" : po.status === "pending_management" ? "management" : null;
    if (stage && !unifiedOrders.has(Number(po.id)) && !poItems.some(item => item.batchId != null || isRoutedPurchaseItem(item)) && poItems.some(item => item.status === "estimated") && financeAllowed(actor, stage, po.status)) {
      result.push({ key: `pr:${po.id}:${stage}`, kind: "purchase", reference: po.poNumber, action: financeAction(stage), href: itemLink(po), arrivedAt: yourWorkMillis(stage === "management" ? po.accountingApprovedAt : null) });
    }
  }

  if (["warehouse", "owner", "admin"].includes(actor.role)) {
    const pending = await port.pendingInventory();
    const pendingIds = new Set(pending.map((item: any) => Number(item.id)));
    // Existing context reader loads all linked tickets/jobs in bounded chunks.
    const contexts = await port.contexts(visible.map(po => Number(po.id)));
    for (const item of items as any[]) {
      const po: any = byId.get(Number(item.purchaseOrderId));
      if (!po || blocked(po)) continue;
      const context = contexts.get(Number(po.id));
      if (context?.externalJob || context?.ticket?.maintenancePath === "C") continue;
      if (item.status === "purchased" && canPerformItemStatusAction("confirmDeliveryToWarehouse", { role: actor.role, userId: actor.id, isActive: actor.isActive }, item.status)) {
        result.push({ key: `pr:${po.id}:receive:${item.id}`, kind: "purchase", reference: po.poNumber, title: title(item, actor), action: "purchase_receive", href: itemLink(po, item), arrivedAt: yourWorkMillis(item.purchasedAt) });
      } else if (item.status === "delivered_to_warehouse" && pendingIds.has(Number(item.id))) {
        result.push({ key: `pr:${po.id}:entry:${item.id}`, kind: "purchase", reference: po.poNumber, title: title(item, actor), action: "purchase_receive", href: `/warehouse/receive-v2?poId=${po.id}${item.supplierInvoiceNumber ? `&invoiceNumber=${encodeURIComponent(item.supplierInvoiceNumber)}` : ""}`, arrivedAt: yourWorkMillis(historyByItem.get(Number(item.id))?.warehouseStartedAt) });
      }
    }
  }

  if (canReviewPurchaseSpecifications(actor)) {
    for (let page = 1;; page++) {
      const value = await port.specifications(actor, page);
      value.rows.forEach((row, index) => result.push({ key: `specification:${row.id}`, kind: "specification", reference: row.poNumber, title: row.itemName,
        action: "specification_review", href: `/purchase-orders?workView=specifications&focusId=${row.id}&focusPage=${Math.floor(((page - 1) * 50 + index) / 10) + 1}`, arrivedAt: yourWorkMillis(row.receivedAt) }));
      if (page * 50 >= value.total) break;
      if (page >= 100000) throw new Error("تعذر إكمال قراءة أعمال مطابقة المواصفات");
    }
  }
  if (metadata.tables.has("supplier_return_cases")) {
    const returns: any[] = [];
    for (let page = 1;; page++) {
      const value = await port.returns(actor, database, page);
      returns.push(...value.items.map((row, index) => ({ ...row, page: Math.floor(((page - 1) * 50 + index) / 20) + 1 })));
      if (page * 50 >= value.total) break;
      if (page >= 100000) throw new Error("تعذر إكمال قراءة أعمال مرتجعات المورد");
    }
    const times = metadata.tables.has("supplier_return_events") ? new Map((await port.returnTimes(database, returns.map(row => Number(row.id)))).map(row => [Number(row.caseId), row])) : new Map();
    for (const row of returns) {
      if (row.closedAt) continue;
      const warehouse = ["warehouse", "owner", "admin"].includes(actor.role) && row.handoverStatus === "rejected" && !row.resolution;
      const creator = Number(row.creatorId) === actor.id && row.handoverStatus === "accepted" && row.creatorDecision === "pending" && !row.replacementPlanId &&
        row.originalPurchaseValue != null && row.currency === "SAR" && row.valuationBasis === "tax_inclusive" &&
        (row.resolution === "change_item" || row.resolution === "refund" && !!row.confirmedRefundId);
      if (!warehouse && !creator) continue;
      const recorded = times.get(Number(row.id));
      result.push({ key: `supplier-return:${row.id}`, kind: "supplier_return", reference: row.returnNumber, title: row.itemName, action: "return_followup",
        href: `/returns-center?tab=suppliers&focusId=${row.id}&focusPage=${row.page}`,
        arrivedAt: yourWorkMillis(warehouse ? recorded?.rejectedAt : row.resolution === "refund" ? recorded?.refundAt : recorded?.resolutionAt) });
    }
  }
  return result;
}

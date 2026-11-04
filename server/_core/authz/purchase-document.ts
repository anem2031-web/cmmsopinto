import { TRPCError } from "@trpc/server";
import { isDelegateRole } from "../../../shared/delegate-role";
export type PurchaseDocumentActor = { id: number; role: string };
export interface PurchaseDocumentPort {
  order(id: number): Promise<any>;
  batch(id: number): Promise<any>;
  submission(id: number): Promise<any>;
  batches(submissionId: number): Promise<any[]>;
  orderBatches?(orderId: number): Promise<any[]>;
  orderItems?(orderId: number): Promise<any[]>;
  authorize(user: PurchaseDocumentActor, order: any): Promise<void>;
}
export const purchaseDocumentPort: PurchaseDocumentPort = {
  order: async id => (await import("../db")).getPurchaseOrderById(id),
  batch: async id => (await import("../db")).getPOPricingBatchById(id),
  submission: async id => (await import("../db")).getPurchasePackageSubmissionById(id),
  batches: async id => (await import("../db")).getPricingBatchesBySubmission(id),
  orderBatches: async id => (await import("../db")).getPOPricingBatches(id),
  orderItems: async id => (await import("../db")).getPOItems(id),
  authorize: async (user, order) => (await import("./guard")).assertCanViewPurchaseOrder(user, order),
};
const denied = (message = "ليس لديك صلاحية لمستند طلب الشراء المحدد") => new TRPCError({ code: "FORBIDDEN", message });
export const PURCHASE_PDF_APPROVAL_MESSAGE = "فتح وتنزيل PDF متاح بعد اعتمادك لهذه المعاملة فقط";
const FINANCIAL_ARCHIVE_APPROVAL_MESSAGE = "الوثيقة المالية متاحة للحسابات بعد اكتمال اعتماد الحسابات والإدارة العليا";
export const isPurchasePdfApprover = (user: PurchaseDocumentActor) => ["accountant", "senior_management"].includes(user.role);

/** An exact approval belongs to an actor, not to a later aggregate header state. */
export function hasOwnPurchaseDocumentApproval(user: PurchaseDocumentActor, scope: any): boolean {
  if (!isPurchasePdfApprover(user)) return true;
  const prefix = user.role === "accountant" ? "accounting" : "management";
  const at = scope?.[`${prefix}ApprovedAt`];
  return Number.isSafeInteger(user.id) && user.id > 0
    && Number(scope?.[`${prefix}ApprovedById`]) === user.id
    && at != null && String(at).trim().length > 0 && Number.isFinite(new Date(at).getTime());
}
export function assertOwnPurchaseDocumentApproval(user: PurchaseDocumentActor, scopes: any[]): void {
  if (isPurchasePdfApprover(user) && (!scopes.length || !scopes.every(scope => hasOwnPurchaseDocumentApproval(user, scope)))) {
    throw denied(PURCHASE_PDF_APPROVAL_MESSAGE);
  }
}

export function wholeOrderPdfApproved(user: PurchaseDocumentActor, order: any, batches: any[], items: any[]): boolean {
  if (!batches.length) return hasOwnPurchaseDocumentApproval(user, order);
  const visible = items.filter(item => !["rejected", "cancelled", "purchase_cancelled"].includes(item.status) && !!(item.estimatedUnitCost || item.actualUnitCost));
  return visible.length > 0 && visible.every(item => {
    const batch = batches.find(candidate => Number(candidate.id) === Number(item.batchId) && Number(candidate.purchaseOrderId) === Number(order.id));
    return !!batch && hasOwnPurchaseDocumentApproval(user, batch);
  });
}

/** Authorize the complete document scope before any PDF renderer or storage read. */
export async function authorizePurchaseDocument(user: PurchaseDocumentActor, poId: number, batchId?: number, submissionId?: number, source = purchaseDocumentPort) {
  if (![poId, batchId, submissionId].filter(id => id !== undefined).every(id => Number.isSafeInteger(id) && id! > 0) || (batchId && submissionId)) throw denied();
  const order = await source.order(poId);
  if (!order) throw new TRPCError({ code: "NOT_FOUND", message: "طلب الشراء غير موجود" });
  const approvalRole = isPurchasePdfApprover(user);
  if (submissionId) {
    const submission = await source.submission(submissionId);
    if (!submission) throw denied();
    const batches = await source.batches(submissionId);
    if (!batches.length || !batches.some(batch => Number(batch.purchaseOrderId) === poId)) throw denied();
    assertOwnPurchaseDocumentApproval(user, [submission, ...batches]);
    for (const batch of batches) {
      if (isDelegateRole(user.role) && Number(batch.submittedById) !== user.id) throw denied();
      const related = Number(batch.purchaseOrderId) === poId ? order : await source.order(Number(batch.purchaseOrderId));
      if (!related) throw denied();
      if (!approvalRole) await source.authorize(user, related);
    }
  } else if (batchId) {
    const batch = await source.batch(batchId);
    if (!batch || Number(batch.purchaseOrderId) !== poId || (isDelegateRole(user.role) && Number(batch.submittedById) !== user.id)) throw denied();
    assertOwnPurchaseDocumentApproval(user, [batch]);
    if (!approvalRole) await source.authorize(user, order);
  } else {
    if (approvalRole) {
      const batches = await source.orderBatches?.(poId) ?? [];
      // Legacy unbatched approvals remain available; a header approval can never
      // authorize another subsequently submitted batch in a whole-order PDF.
      if (!wholeOrderPdfApproved(user, order, batches, batches.length ? await source.orderItems?.(poId) ?? [] : [])) throw denied(PURCHASE_PDF_APPROVAL_MESSAGE);
    } else await source.authorize(user, order);
  }
  return order;
}

export async function purchaseDocumentPermission(user: PurchaseDocumentActor, poId: number, batchId?: number, submissionId?: number, source = purchaseDocumentPort) {
  try {
    await authorizePurchaseDocument(user, poId, batchId, submissionId, source);
    return { pdfAllowed: true, pdfBlockedReason: null as string | null };
  } catch (error) {
    if (!(error instanceof TRPCError) || !["FORBIDDEN", "NOT_FOUND", "BAD_REQUEST"].includes(error.code)) throw error;
    return { pdfAllowed: false, pdfBlockedReason: isPurchasePdfApprover(user) ? PURCHASE_PDF_APPROVAL_MESSAGE : "ليس لديك صلاحية لتنزيل هذا المستند" };
  }
}

/** Whole-order list metadata uses bounded bulk reads, never a query per card. */
export async function withPurchaseDocumentPermissions<T extends Record<string, any>>(user: PurchaseDocumentActor, orders: T[]): Promise<Array<T & { pdfAllowed: boolean; pdfBlockedReason: string | null }>> {
  if (!isPurchasePdfApprover(user) || !orders.length) return orders.map(order => ({ ...order, pdfAllowed: true, pdfBlockedReason: null }));
  const db = await import("../db"), ids = orders.map(order => Number(order.id));
  const [batches, items] = await Promise.all([db.getPOPricingBatchesForPOs(ids), db.getPurchaseDocumentItemsForPOs(ids)]);
  const grouped = new Map<number, any[]>();
  const itemGroups = new Map<number, any[]>();
  for (const batch of batches) {
    if (!grouped.has(batch.purchaseOrderId)) grouped.set(batch.purchaseOrderId, []);
    grouped.get(batch.purchaseOrderId)!.push(batch);
  }
  for (const item of items) {
    if (!itemGroups.has(Number(item.purchaseOrderId))) itemGroups.set(Number(item.purchaseOrderId), []);
    itemGroups.get(Number(item.purchaseOrderId))!.push(item);
  }
  return orders.map(order => {
    const scopes = grouped.get(Number(order.id));
    const pdfAllowed = wholeOrderPdfApproved(user, order, scopes ?? [], itemGroups.get(Number(order.id)) ?? []);
    return { ...order, pdfAllowed, pdfBlockedReason: pdfAllowed ? null : PURCHASE_PDF_APPROVAL_MESSAGE };
  });
}

export const PURCHASE_ATTACHMENT_TYPES = ["po_financial_batch", "purchase_package_submission_financial", "delegate_pricing_batch", "delegate_package_submission_pricing"] as const;
export function isPurchaseDocumentAttachment(type: string) { return (PURCHASE_ATTACHMENT_TYPES as readonly string[]).includes(type); }

/** Completed archived financial documents are shared by the accounting role.
 * Pricing documents and live PO exports retain their exact-actor approval rule.
 * List callers supply a bulk-loaded port; downloads supply fresh readers.
 */
async function authorizeCompletedFinancialArchive(user: PurchaseDocumentActor, scopes: any[], batches: any[], source: PurchaseDocumentPort) {
  const fullyApproved = scopes.length > 0 && scopes.every(scope => ["accounting", "management"].every(prefix => {
    const approvedById = Number(scope?.[`${prefix}ApprovedById`]);
    const approvedAt = scope?.[`${prefix}ApprovedAt`];
    return Number.isSafeInteger(approvedById) && approvedById > 0
      && approvedAt != null && String(approvedAt).trim().length > 0 && Number.isFinite(new Date(approvedAt).getTime());
  }));
  if (!Number.isSafeInteger(user.id) || user.id <= 0 || !batches.length || !fullyApproved) throw denied(FINANCIAL_ARCHIVE_APPROVAL_MESSAGE);
  const orderIds = Array.from(new Set<number>(batches.map(batch => Number(batch.purchaseOrderId))));
  let firstOrder: any;
  for (const id of orderIds) {
    if (!Number.isSafeInteger(id) || id <= 0) throw denied();
    const order = await source.order(id);
    if (!order) throw denied();
    firstOrder ??= order;
  }
  return firstOrder;
}

/** Archived attachment identifiers are batch/submission IDs, never PO IDs. */
export async function authorizePurchaseAttachment(user: PurchaseDocumentActor, type: string, entityId: number, source = purchaseDocumentPort) {
  if (!Number.isSafeInteger(entityId) || entityId <= 0 || !isPurchaseDocumentAttachment(type)) throw denied();
  const financial = type === "po_financial_batch" || type === "purchase_package_submission_financial";
  if (financial && !["owner", "admin", "accountant", "senior_management"].includes(user.role)) throw denied();
  if (!financial && !isDelegateRole(user.role) && !["owner", "admin", "accountant", "senior_management"].includes(user.role)) throw denied();
  if (type === "po_financial_batch" || type === "delegate_pricing_batch") {
    const batch = await source.batch(entityId);
    if (!batch || !Number.isSafeInteger(Number(batch.purchaseOrderId)) || Number(batch.purchaseOrderId) <= 0) throw denied();
    if (financial && user.role === "accountant") return authorizeCompletedFinancialArchive(user, [batch], [batch], source);
    return authorizePurchaseDocument(user, Number(batch.purchaseOrderId), entityId, undefined, source);
  }
  const batches = await source.batches(entityId);
  if (!batches.length) throw denied();
  if (financial && user.role === "accountant") {
    return authorizeCompletedFinancialArchive(user, [await source.submission(entityId), ...batches], batches, source);
  }
  return authorizePurchaseDocument(user, Number(batches[0].purchaseOrderId), undefined, entityId, source);
}

export async function purchaseAttachmentPermission(user: PurchaseDocumentActor, type: string, entityId: number, source = purchaseDocumentPort) {
  try { await authorizePurchaseAttachment(user, type, entityId, source); return { pdfAllowed: true, pdfBlockedReason: null as string | null }; }
  catch (error) {
    if (!(error instanceof TRPCError) || !["FORBIDDEN", "NOT_FOUND", "BAD_REQUEST"].includes(error.code)) throw error;
    const sharedFinancialArchive = user.role === "accountant" && ["po_financial_batch", "purchase_package_submission_financial"].includes(type);
    return { pdfAllowed: false, pdfBlockedReason: sharedFinancialArchive ? FINANCIAL_ARCHIVE_APPROVAL_MESSAGE
      : isPurchasePdfApprover(user) ? PURCHASE_PDF_APPROVAL_MESSAGE : "ليس لديك صلاحية لتنزيل هذا المستند" };
  }
}

import type { PurchaseDocumentActor, PurchaseDocumentPort } from "./purchase-document";
import { isPurchasePdfApprover, purchaseAttachmentPermission } from "./purchase-document";
import { mediaKeyFromValue } from "./media-access";
import { isDelegateRole } from "../../../shared/delegate-role";

/** Reuse the exact download guard; no approval decision is cached across requests. */
export async function decorateDocumentRows(user: PurchaseDocumentActor, rows: any[], source: PurchaseDocumentPort) {
  const cache = new Map<string, Promise<any>>();
  return Promise.all(rows.map(async row => {
    const key = `${row.entityType}:${row.entityId}`;
    if (!cache.has(key)) cache.set(key, (async () => {
      // Retains the delegate's existing own archived-document list behavior.
      const access = isDelegateRole(user.role) && Number(row.delegateId) === user.id
        ? { pdfAllowed: true, pdfBlockedReason: null }
        : await purchaseAttachmentPermission(user, row.entityType, Number(row.entityId), source);
      const isBatch = ["po_financial_batch", "delegate_pricing_batch"].includes(row.entityType);
      const scope = isBatch ? await source.batch(Number(row.entityId)) : await source.submission(Number(row.entityId));
      // «بيانات المعاملة» هي مساحة عمل المراجع قبل قراره. بعد أن يعتمد
      // المحاسب/الإدارة هذا النطاق تنتهي مهمته ويُتاح له المستند الثابت بدل
      // إبقاء رابط معاملة قديمة. بقية الأدوار تحتفظ بسلوكها السابق.
      const activeReview = !isPurchasePdfApprover(user) || !access.pdfAllowed;
      const reviewUrl = scope && activeReview
        ? isBatch ? `/purchase-orders/${scope.purchaseOrderId}` : `/purchase-packages/${scope.purchasePackageId}?submissionId=${scope.id}`
        : null;
      return { ...access, reviewUrl };
    })());
    const access = await cache.get(key)!;
    const mediaKey = mediaKeyFromValue(row.fileKey) || mediaKeyFromValue(row.fileUrl);
    return { ...row, ...access,
      fileUrl: access.pdfAllowed && mediaKey ? `/api/media?key=${encodeURIComponent(mediaKey)}` : null,
      fileKey: access.pdfAllowed ? mediaKey : null };
  }));
}

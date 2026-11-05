import { ROUTED_REVIEW_BLOCKED_PO_STATUSES } from "./policy";

export type LegacyApprovalStage = "accounting" | "management";
export interface LegacyPricingBatchReadScope {
  purchaseOrderId: number;
  batchId: number;
  purchasePackageSubmissionId: number | null;
  stage: LegacyApprovalStage;
  itemIds: number[];
}

/** SQL proves current actor, real parent/membership and absence of a unified DPB
 * root. Keep this per-request projection separate from the PO's true status. */
export function groupLegacyPricingBatchReadScopes(
  actor: { role: string; isActive?: number | boolean | null }, rows: readonly any[],
): LegacyPricingBatchReadScope[] {
  const stage = actor.role === "accountant" ? "accounting" : actor.role === "senior_management" ? "management" : null;
  if (!stage || !(actor.isActive === 1 || actor.isActive === true)) return [];
  const grouped = new Map<number, LegacyPricingBatchReadScope>();
  for (const row of rows) {
    const purchaseOrderId = Number(row.purchaseOrderId), batchId = Number(row.batchId), itemId = Number(row.itemId);
    if (![purchaseOrderId, batchId, itemId].every(id => Number.isSafeInteger(id) && id > 0) ||
      Number(row.itemPurchaseOrderId) !== purchaseOrderId || row.itemStatus !== "estimated" ||
      row.batchStatus !== `pending_${stage}` ||
      (ROUTED_REVIEW_BLOCKED_PO_STATUSES as readonly string[]).includes(row.parentStatus) ||
      (stage === "management" && !(Number(row.accountingApprovedById) > 0 && row.accountingApprovedAt))) continue;
    const entry = grouped.get(batchId) ?? { purchaseOrderId, batchId, stage,
      purchasePackageSubmissionId: row.purchasePackageSubmissionId == null ? null : Number(row.purchasePackageSubmissionId), itemIds: [] };
    if (entry.purchaseOrderId !== purchaseOrderId) continue;
    if (!entry.itemIds.includes(itemId)) entry.itemIds.push(itemId);
    grouped.set(batchId, entry);
  }
  return Array.from(grouped.values());
}

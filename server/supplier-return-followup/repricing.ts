import { sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import type { FollowupTx } from "./commands";
import { ReturnFollowupError } from "./policy";
import { readRows, trialEnabled } from "./runtime";
import { canApprovePricingBundleStage } from "../../shared/business-role-policy";

const conflict = (message: string): never => { throw new ReturnFollowupError("CONFLICT", message); };

/** Legacy whole-order approval/rejection is not a valid compensation writer. */
export async function assertNoReplacementOrder(tx: FollowupTx, purchaseOrderId: number) {
  if (!await trialEnabled(tx)) return;
  const [plan] = await readRows(tx, sql`SELECT id FROM supplier_return_replacement_plans WHERE purchaseOrderId=${purchaseOrderId} LIMIT 1`);
  if (plan) throw new TRPCError({ code: "CONFLICT", message: "طلب التعويض يُراجع من دفعة تسعيره فقط" });
}

export async function assertSingleReplacementRejection(tx: FollowupTx, purchaseOrderId: number, rejectedIds: number[]) {
  if (!await trialEnabled(tx)) return;
  const [plan] = await readRows(tx, sql`SELECT purchaseOrderItemId FROM supplier_return_replacement_plans WHERE purchaseOrderId=${purchaseOrderId} LIMIT 1`);
  if (plan && (rejectedIds.length !== 1 || Number(plan.purchaseOrderItemId) !== rejectedIds[0]))
    throw new TRPCError({ code: "CONFLICT", message: "رفض تسعير البديل يجب أن يخص الصنف البديل وحده" });
}

/** Rejection of a replacement price keeps the same item and source links.
 * The existing batch is historical; a new pricing batch must be submitted.
 * The caller must run this within one database transaction.
 */
export async function returnReplacementToDelegate(tx: FollowupTx, actorId: number, actorRole: string, stage: "accounting" | "management", batchId: number, itemId: number, reason: string) {
  return returnReplacementPrice(tx, actorId, actorRole, stage, batchId, itemId, reason, false);
}

/** Explicit DPB accounting exception; legacy callers cannot request this grant. */
export async function returnReplacementToDelegateFromUnifiedBundle(tx: FollowupTx, actorId: number, actorRole: string, stage: "accounting" | "management", bundleId: number, batchId: number, itemId: number, reason: string) {
  if (!await trialEnabled(tx)) return false;
  if (actorRole !== "senior_management" || stage !== "accounting" || !Number.isSafeInteger(bundleId) || bundleId <= 0) {
    throw new ReturnFollowupError("FORBIDDEN", "هذا الإجراء مقصور على اعتماد حسابات حزمة التسعير" );
  }
  const [scope] = await readRows(tx, sql`SELECT a.status AS approvalStatus,b.bundleNumber,b.delegateId AS bundleDelegateId,b.snapshotJson,
      pb.status AS batchStatus,pb.submittedById,i.*,p.ticketId,p.ticketItemId
    FROM delegate_pricing_bundle_approvals a
    INNER JOIN delegate_pricing_bundles b ON b.id=a.bundleId AND b.status IN ('sent','archived')
    INNER JOIN delegate_pricing_bundle_batches l ON l.bundleId=a.bundleId AND l.pricingBatchId=${batchId}
    INNER JOIN po_pricing_batches pb ON pb.id=l.pricingBatchId AND pb.purchaseOrderId=l.purchaseOrderId
    INNER JOIN delegate_pricing_bundle_items m ON m.bundleId=a.bundleId AND m.purchaseOrderItemId=${itemId} AND m.removedAt IS NULL
    INNER JOIN purchase_order_items i ON i.id=m.purchaseOrderItemId AND i.purchaseOrderId=l.purchaseOrderId AND i.batchId=pb.id
    INNER JOIN purchase_orders p ON p.id=i.purchaseOrderId
    WHERE a.bundleId=${bundleId} FOR UPDATE`);
  if (!scope || scope.approvalStatus !== "pending_accounting" || scope.batchStatus !== "pending_accounting"
    || scope.status !== "estimated" || Number(scope.delegateId) !== Number(scope.submittedById)
    || Number(scope.bundleDelegateId) !== Number(scope.submittedById)) conflict("تغير ارتباط البديل بحزمة التسعير أو مرحلة اعتمادها");
  let snapshot: any;
  try { snapshot = typeof scope.snapshotJson === "string" ? JSON.parse(scope.snapshotJson) : scope.snapshotJson; } catch { conflict("لقطة حزمة التسعير غير صالحة"); }
  const frozen = Array.isArray(snapshot?.rows) ? snapshot.rows.find((row: any) => Number(row.id) === itemId) : null;
  if (!frozen || snapshot.number !== scope.bundleNumber || Number(snapshot.delegate?.id) !== Number(scope.submittedById)
    || Number(frozen.purchaseOrderId) !== Number(scope.purchaseOrderId) || Number(frozen.quantity) !== Number(scope.quantity)
    || Number(frozen.estimatedTotalCost) !== Number(scope.estimatedTotalCost)) conflict("صنف البديل لا يطابق لقطة حزمة التسعير");
  return returnReplacementPrice(tx, actorId, actorRole, stage, batchId, itemId, reason, true);
}

async function returnReplacementPrice(tx: FollowupTx, actorId: number, actorRole: string, stage: "accounting" | "management", batchId: number, itemId: number, reason: string, verifiedDpbAccounting: boolean) {
  if (!await trialEnabled(tx)) return false;
  if (reason.trim().length < 10) conflict("سبب رفض تسعير البديل يجب أن يكون 10 أحرف على الأقل");
  const [actor] = await readRows(tx, sql`SELECT id,role,isActive FROM users WHERE id=${actorId} FOR UPDATE`);
  if (!actor || actor.role !== actorRole || Number(actor.isActive) !== 1
    || !((stage === "accounting" ? ["accountant", "owner", "admin"] : ["senior_management", "owner", "admin"]).includes(actorRole)
      || verifiedDpbAccounting && stage === "accounting" && actorRole === "senior_management" && canApprovePricingBundleStage({ id: actorId, role: actorRole, isActive: Number(actor.isActive) }, stage)))
    throw new ReturnFollowupError("FORBIDDEN", "حساب المعتمد غير متاح");
  const [plan] = await readRows(tx, sql`SELECT p.*,c.delegateId,c.handoverStatus,b.status AS batchStatus,b.purchasePackageSubmissionId,
      i.batchId AS itemBatchId,i.status AS itemStatus,i.delegateId AS itemDelegateId,po.status AS poStatus
    FROM supplier_return_replacement_plans p
    INNER JOIN supplier_return_cases c ON c.id=p.caseId
    INNER JOIN po_pricing_batches b ON b.id=${batchId} AND b.purchaseOrderId=p.purchaseOrderId
    INNER JOIN purchase_order_items i ON i.id=p.purchaseOrderItemId AND i.purchaseOrderId=p.purchaseOrderId
    INNER JOIN purchase_orders po ON po.id=p.purchaseOrderId
    WHERE p.purchaseOrderItemId=${itemId} FOR UPDATE`);
  if (!plan) return false;
  const expectedPlan = stage === "accounting" ? "pending_accounting" : "pending_management";
  if (plan.status !== expectedPlan || plan.batchStatus !== expectedPlan || plan.purchasePackageSubmissionId != null
    || Number(plan.itemBatchId) !== batchId || plan.itemStatus !== "estimated" || plan.handoverStatus !== "accepted"
    || Number(plan.itemDelegateId) !== Number(plan.delegateId)) conflict("تغيرت مرحلة تسعير البديل؛ حدّث الصفحة");
  const activeItems = await readRows(tx, sql`SELECT id FROM purchase_order_items
    WHERE batchId=${batchId} AND purchaseOrderId=${plan.purchaseOrderId} AND status NOT IN ('cancelled','rejected') FOR UPDATE`);
  if (activeItems.length !== 1 || Number(activeItems[0].id) !== itemId) conflict("دفعة البديل تضم أصنافًا أخرى؛ يلزم مراجعتها منفصلة");
  const [allocation] = await readRows(tx, sql`SELECT id,status FROM supplier_return_settlements
    WHERE id=${plan.creditAllocationSettlementId} AND caseId=${plan.caseId} AND type='credit_allocation' FOR UPDATE`);
  const allocationStatus = stage === "accounting" ? "pending" : "accounting_approved";
  if (!allocation || allocation.status !== allocationStatus) conflict("حجز رصيد المرتجع تغير أثناء المراجعة");
  if (plan.fundingSettlementId != null) {
    if (stage !== "management") conflict("عهدة التعويض ليست في مرحلة اعتماد الإدارة");
    const [funding] = await readRows(tx, sql`SELECT id,status FROM supplier_return_settlements
      WHERE id=${plan.fundingSettlementId} AND caseId=${plan.caseId} AND type='additional_funding' FOR UPDATE`);
    if (!funding || funding.status !== "accounting_approved") conflict("فرق العهدة تغير أثناء المراجعة");
    const [fundingWrite] = await tx.execute(sql`UPDATE supplier_return_settlements SET status='cancelled',revision=revision+1
      WHERE id=${funding.id} AND status='accounting_approved'`);
    if (Number(fundingWrite?.affectedRows) !== 1) conflict("تعذر تحرير فرق العهدة");
  }
  const [allocationWrite] = await tx.execute(sql`UPDATE supplier_return_settlements SET status='cancelled',revision=revision+1
    WHERE id=${allocation.id} AND status=${allocationStatus}`);
  if (Number(allocationWrite?.affectedRows) !== 1) conflict("تعذر تحرير رصيد المرتجع");
  const [batchWrite] = await tx.execute(sql`UPDATE po_pricing_batches SET status='rejected',rejectedById=${actorId},rejectedAt=CURRENT_TIMESTAMP,
    rejectionReason=${reason.trim()} WHERE id=${batchId} AND status=${expectedPlan} AND purchaseOrderId=${plan.purchaseOrderId}`);
  if (Number(batchWrite?.affectedRows) !== 1) conflict("تغيرت دفعة التسعير");
  const [itemWrite] = await tx.execute(sql`UPDATE purchase_order_items SET status='pending',batchId=NULL,estimatedUnitCost=NULL,
    estimatedTotalCost=NULL,managementRejectionReason=${reason.trim()} WHERE id=${itemId} AND purchaseOrderId=${plan.purchaseOrderId}
    AND batchId=${batchId} AND status='estimated'`);
  if (Number(itemWrite?.affectedRows) !== 1) conflict("تغير صنف البديل");
  const [planWrite] = await tx.execute(sql`UPDATE supplier_return_replacement_plans SET status='pending_review',quotedById=NULL,quotedAt=NULL,
    quotedTotal=NULL,currency=NULL,valuationBasis=NULL,creditAllocationSettlementId=NULL,fundingSettlementId=NULL,
    creditAllocated=NULL,additionalFunding=NULL,revision=revision+1 WHERE id=${plan.id} AND status=${expectedPlan}
    AND creditAllocationSettlementId=${allocation.id}`);
  if (Number(planWrite?.affectedRows) !== 1) conflict("تغيرت خطة البديل");
  const [orderWrite] = await tx.execute(sql`UPDATE purchase_orders SET status='pending_estimate',
    totalEstimatedCost=NULL,totalEstimatedText=NULL,custodyAmount=NULL,
    accountingApprovedById=NULL,accountingApprovedAt=NULL,accountingNotes=NULL,accountingSignatureSnapshot=NULL,
    managementApprovedById=NULL,managementApprovedAt=NULL,managementNotes=NULL
    WHERE id=${plan.purchaseOrderId}
    AND status IN ('pending_accounting','pending_management')`);
  if (Number(orderWrite?.affectedRows) !== 1) conflict("تغيرت مرحلة طلب البديل");
  await tx.execute(sql`INSERT INTO notifications (userId,title,message,type,relatedPoId)
    VALUES (${plan.delegateId},'إعادة تسعير البديل',${`رُفض سعر البديل ويجب إعادة تسعير الصنف نفسه. السبب: ${reason.trim()}`},'warning',${plan.purchaseOrderId})`);
  return true;
}

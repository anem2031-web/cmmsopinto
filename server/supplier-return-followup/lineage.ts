import { sql } from "drizzle-orm";
import { ReturnFollowupError } from "./policy";
import type { FollowupTx } from "./commands";

async function rows(tx: FollowupTx, query: any): Promise<any[]> {
  const result = await tx.execute(query);
  if (!Array.isArray(result?.[0])) throw Error("تعذر قراءة رابط جولات التعويض");
  return result[0];
}
const conflict = (message: string): never => { throw new ReturnFollowupError("CONFLICT", message); };

/** The last received lot is the financial source of this round. Its parent
 * identifies provenance, never a second credit or a different stock movement. */
export async function resolveReturnLineageOrigin(tx: FollowupTx, source: {
  lotId: number; receiptId: number; receiptItemId: number;
  purchaseOrderId: number | null; purchaseOrderItemId: number | null;
}) {
  const ordinary = { parentReplacementPlanId: null, creatorId: null,
    rootPurchaseOrderId: source.purchaseOrderId, rootPurchaseOrderItemId: source.purchaseOrderItemId };
  if (!source.purchaseOrderItemId) return ordinary;
  const plans = await rows(tx, sql`SELECT p.id,p.caseId,p.status,p.purchaseOrderId,p.purchaseOrderItemId,
      c.creatorId,c.createdById,c.handoverStatus,c.parentReplacementPlanId,
      c.purchaseOrderId AS sourcePurchaseOrderId,c.purchaseOrderItemId AS sourcePurchaseOrderItemId,
      CASE WHEN c.parentReplacementPlanId IS NULL THEN 1 ELSE EXISTS(
        SELECT 1 FROM supplier_return_replacement_plans previous
        INNER JOIN supplier_return_cases previousCase ON previousCase.id=previous.caseId AND previousCase.handoverStatus='accepted'
        INNER JOIN supplier_return_replacement_links k ON k.caseId=previous.caseId
          AND k.purchaseOrderId=previous.purchaseOrderId AND k.purchaseOrderItemId=previous.purchaseOrderItemId
        WHERE previous.id=c.parentReplacementPlanId AND previous.status='received'
          AND previous.purchaseOrderId=c.purchaseOrderId AND previous.purchaseOrderItemId=c.purchaseOrderItemId
          AND k.lotId=c.lotId AND k.receiptId=c.receiptId AND k.receiptItemId=c.receiptItemId
      ) END AS parentSourceValid,
      EXISTS(SELECT 1 FROM supplier_return_replacement_links k WHERE k.caseId=c.id
        AND k.purchaseOrderId=p.purchaseOrderId AND k.purchaseOrderItemId=p.purchaseOrderItemId
        AND k.lotId=${source.lotId} AND k.receiptId=${source.receiptId} AND k.receiptItemId=${source.receiptItemId}) AS exactReceipt
    FROM supplier_return_replacement_plans p INNER JOIN supplier_return_cases c ON c.id=p.caseId
    WHERE p.purchaseOrderItemId=${source.purchaseOrderItemId} FOR UPDATE`);
  if (!plans.length) return ordinary;
  if (plans.length !== 1) conflict("مصدر المرتجع مرتبط بأكثر من خطة بديل");
  const plan = plans[0];
  if (plan.status !== "received" || plan.handoverStatus !== "accepted"
    || Number(plan.purchaseOrderId) !== source.purchaseOrderId || Number(plan.exactReceipt) !== 1
    || Number(plan.parentSourceValid) !== 1) {
    conflict("لا يمكن تعويض البديل قبل اكتمال استلامه وتثبيت لُوته الأصلي");
  }
  const seen = new Set<number>([Number(plan.id)]);
  let root = plan;
  let parentId = plan.parentReplacementPlanId;
  for (let depth = 0; parentId != null; depth++) {
    if (depth >= 63 || seen.has(Number(parentId))) conflict("تسلسل جولات التعويض غير صالح؛ يلزم مراجعة الروابط");
    seen.add(Number(parentId));
    const [parent] = await rows(tx, sql`SELECT p.id,c.parentReplacementPlanId,c.creatorId,c.createdById,
        c.purchaseOrderId AS sourcePurchaseOrderId,c.purchaseOrderItemId AS sourcePurchaseOrderItemId,
        CASE WHEN c.parentReplacementPlanId IS NULL THEN 1 ELSE EXISTS(
          SELECT 1 FROM supplier_return_replacement_plans previous
          INNER JOIN supplier_return_cases previousCase ON previousCase.id=previous.caseId AND previousCase.handoverStatus='accepted'
          INNER JOIN supplier_return_replacement_links k ON k.caseId=previous.caseId
            AND k.purchaseOrderId=previous.purchaseOrderId AND k.purchaseOrderItemId=previous.purchaseOrderItemId
          WHERE previous.id=c.parentReplacementPlanId AND previous.status='received'
            AND previous.purchaseOrderId=c.purchaseOrderId AND previous.purchaseOrderItemId=c.purchaseOrderItemId
            AND k.lotId=c.lotId AND k.receiptId=c.receiptId AND k.receiptItemId=c.receiptItemId
        ) END AS parentSourceValid
      FROM supplier_return_replacement_plans p INNER JOIN supplier_return_cases c ON c.id=p.caseId WHERE p.id=${Number(parentId)}`);
    if (!parent) conflict("مرجع جولة التعويض السابقة غير موجود");
    if (Number(parent.parentSourceValid) !== 1) conflict("روابط الجولة السابقة لا تطابق لوتها وفاتورتها");
    if (Number(parent.creatorId ?? parent.createdById) !== Number(plan.creatorId ?? plan.createdById)) conflict("مسؤول الاحتياج الأصلي لا يطابق جولات التعويض");
    root = parent;
    parentId = parent.parentReplacementPlanId;
  }
  return { parentReplacementPlanId: Number(plan.id), creatorId: Number(root.creatorId ?? root.createdById),
    rootPurchaseOrderId: root.sourcePurchaseOrderId == null ? null : Number(root.sourcePurchaseOrderId),
    rootPurchaseOrderItemId: root.sourcePurchaseOrderItemId == null ? null : Number(root.sourcePurchaseOrderItemId) };
}

export async function resolveReturnLineage(tx: FollowupTx, source: Parameters<typeof resolveReturnLineageOrigin>[1]) {
  const { parentReplacementPlanId, creatorId } = await resolveReturnLineageOrigin(tx, source);
  return { parentReplacementPlanId, creatorId };
}

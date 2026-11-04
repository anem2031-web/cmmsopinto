import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { isDelegateRole } from "../../shared/roles";
import { z } from "zod";
import { decimal4, format4 } from "./amounts";
import { ReturnFollowupError } from "./policy";
import { readRows, trialEnabled } from "./runtime";
import type { FollowupPort } from "./commands";

export const confirmSupplierRefundInput = z.object({
  caseId: z.number().int().positive(), expectedRevision: z.number().int().nonnegative(),
  method: z.enum(["cash", "transfer"]), reference: z.string().trim().min(3).max(100),
  operationKey: z.string().min(16).max(100),
}).strict();
const conflict = (message: string): never => { throw new ReturnFollowupError("CONFLICT", message); };
const deny = (message: string): never => { throw new ReturnFollowupError("FORBIDDEN", message); };

/** Delegate attests actual cash/transfer receipt. No stock or purchase writer. */
export async function confirmSupplierRefund(actor: {id:number;role:string}, raw: z.input<typeof confirmSupplierRefundInput>, port: FollowupPort) {
  const input = confirmSupplierRefundInput.parse(raw);
  return port.transaction(async tx => {
    if (!await trialEnabled(tx)) deny("متابعة مرتجع المورد غير مفعّلة لهذه القاعدة");
    const [user] = await readRows(tx, sql`SELECT id,role,isActive FROM users WHERE id=${actor.id} FOR UPDATE`);
    if (!user || user.role !== actor.role || Number(user.isActive) !== 1 || !isDelegateRole(actor.role)) deny("تأكيد الاسترداد للمندوب المسند فقط");
    const [record] = await readRows(tx, sql`SELECT * FROM supplier_return_cases WHERE id=${input.caseId} FOR UPDATE`);
    if (!record || Number(record.delegateId) !== actor.id) deny("المرتجع غير مسند إليك");
    const [source] = await readRows(tx, sql`SELECT id,inventoryId,purchaseOrderId,purchaseOrderItemId,sourceDeliveryDocumentId FROM warehouse_returns WHERE id=${record.returnId} FOR UPDATE`);
    if (!source || source.sourceDeliveryDocumentId != null || Number(source.inventoryId) !== Number(record.inventoryId)
      || Number(source.purchaseOrderId) !== Number(record.purchaseOrderId) || Number(source.purchaseOrderItemId) !== Number(record.purchaseOrderItemId)) conflict("تغير مصدر المرتجع");
    const hash = createHash("sha256").update(JSON.stringify({actorId:actor.id,...input})).digest("hex");
    const [previous] = await readRows(tx, sql`SELECT actorId,requestHash,result FROM supplier_return_events WHERE caseId=${input.caseId} AND operationKey=${input.operationKey}`);
    if (previous) {
      if (Number(previous.actorId) !== actor.id || previous.requestHash !== hash) conflict("مفتاح العملية مستخدم لإجراء مختلف");
      return typeof previous.result === "string" ? JSON.parse(previous.result) : previous.result;
    }
    if (record.closedAt || record.handoverStatus !== "accepted" || record.resolution !== "refund" || record.creatorDecision !== "pending"
      || Number(record.revision) !== input.expectedRevision) conflict("المرتجع ليس بانتظار إثبات استرداد المبلغ");
    if (record.originalPurchaseValue == null || record.currency !== "SAR" || record.valuationBasis !== "tax_inclusive") conflict("قيمة فاتورة المرتجع غير مثبتة");
    const [credit] = await readRows(tx, sql`SELECT id,amount,status,currency,valuationBasis FROM supplier_return_settlements
      WHERE caseId=${input.caseId} AND operationKey=${`handover-credit:${input.caseId}`} AND type='supplier_credit' FOR UPDATE`);
    if (!credit || credit.status !== "completed" || credit.currency !== "SAR" || credit.valuationBasis !== "tax_inclusive"
      || decimal4(String(credit.amount)) !== decimal4(String(record.originalPurchaseValue))) conflict("رصيد المرتجع غير متاح");
    const [used] = await readRows(tx, sql`SELECT id FROM supplier_return_settlements WHERE caseId=${input.caseId}
      AND type IN ('cash_refund','credit_allocation') AND status NOT IN ('cancelled','rejected') LIMIT 1 FOR UPDATE`);
    if (used) conflict("سبق استرداد أو حجز رصيد هذا المرتجع");
    const amount = format4(decimal4(String(credit.amount)));
    const [saved] = await tx.execute(sql`INSERT INTO supplier_return_settlements
      (caseId,operationKey,type,status,amount,currency,valuationBasis,sourceCreditId,referenceNumber,notes,createdById,completedById,completedAt)
      VALUES (${input.caseId},${`cash-refund:${input.caseId}`},'cash_refund','completed',${amount},'SAR','tax_inclusive',${credit.id},${input.reference},${input.method},${actor.id},${actor.id},CURRENT_TIMESTAMP)`);
    if (!Number.isSafeInteger(Number(saved?.insertId)) || Number(saved.insertId) <= 0) conflict("تعذر تسجيل الاسترداد");
    const [written] = await tx.execute(sql`UPDATE supplier_return_cases SET revision=revision+1 WHERE id=${input.caseId} AND revision=${input.expectedRevision}`);
    if (Number(written?.affectedRows) !== 1) conflict("تغير المرتجع أثناء تأكيد الاسترداد");
    const result = {caseId:input.caseId,revision:input.expectedRevision+1,amount,method:input.method};
    await tx.execute(sql`INSERT INTO supplier_return_events
      (caseId,actorId,action,operationKey,requestHash,fromRevision,toRevision,beforeState,afterState,reason,result)
      VALUES (${input.caseId},${actor.id},'cash_refund_confirmed',${input.operationKey},${hash},${input.expectedRevision},${result.revision},
        ${JSON.stringify({resolution:record.resolution})},${JSON.stringify(result)},${input.reference},${JSON.stringify(result)})`);
    return result;
  });
}

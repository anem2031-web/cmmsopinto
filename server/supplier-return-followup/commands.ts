import { createHash } from "node:crypto";
import { isDelegateRole } from "../../shared/roles";
import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { decideHandover, resendHandover, chooseResolution, ReturnFollowupError, type Actor, type Followup } from "./policy";
import { decimal4, format4 } from "./amounts";
import { verifyStandaloneReturnSource } from "./standalone-source";

/** This adapter deliberately has no stock writer and no default/live DB import.
 * The RPC must apply its central capability guard before supplying this port.
 */
export interface FollowupTx { execute(query: SQL): Promise<any>; }
export interface FollowupPort { transaction<T>(work: (tx: FollowupTx) => Promise<T>): Promise<T>; }
const base = z.object({ caseId: z.number().int().positive(), expectedRevision: z.number().int().nonnegative(), operationKey: z.string().min(16).max(100) });
export const followupCommand = z.discriminatedUnion("action", [
  base.extend({ action: z.literal("accept") }).strict(),
  base.extend({ action: z.literal("reject"), reason: z.string().trim().min(1).max(4000) }).strict(),
  base.extend({ action: z.literal("resend") }).strict(),
  base.extend({ action: z.literal("resolve"), resolution: z.enum(["same_item", "change_item", "refund"]) }).strict(),
]);
export type FollowupCommand = z.infer<typeof followupCommand>;
const deny = (message: string): never => { throw new ReturnFollowupError("FORBIDDEN", message); };
const conflict = (message: string): never => { throw new ReturnFollowupError("CONFLICT", message); };
async function rows(tx: FollowupTx, query: SQL): Promise<any[]> {
  const result = await tx.execute(query);
  if (!Array.isArray(result?.[0])) throw Error("Invalid supplier return database response");
  return result[0];
}
function parseJson(value: any) { return typeof value === "string" ? JSON.parse(value) : value; }

/** Case lock serializes all decisions. Identity and source existence are checked
 * before replay, so a past success cannot bypass a newly revoked permission.
 */
export async function executeFollowupCommand(port: FollowupPort, actor: Pick<Actor, "id" | "role">, raw: FollowupCommand) {
  const input = followupCommand.parse(raw);
  const hash = createHash("sha256").update(JSON.stringify({ actorId: actor.id, ...input })).digest("hex");
  return port.transaction(async tx => {
    const [identity] = await rows(tx, sql`SELECT id,role,isActive FROM users WHERE id=${actor.id} FOR UPDATE`);
    if (!identity || identity.role !== actor.role || Number(identity.isActive) !== 1) deny("الحساب غير متاح");
    const [record] = await rows(tx, sql`SELECT * FROM supplier_return_cases WHERE id=${input.caseId} FOR UPDATE`);
    if (!record) deny("المرتجع غير متاح");
    if (input.action === "resend") {
      if (!["warehouse", "owner", "admin"].includes(actor.role)) deny("إعادة التسليم للمستودع فقط");
    } else if (!isDelegateRole(actor.role) || Number(record.delegateId) !== actor.id) deny("المرتجع لمندوب آخر");
    const [source] = await rows(tx, sql`SELECT id,inventoryId,purchaseOrderId,purchaseOrderItemId,sourceDeliveryDocumentId FROM warehouse_returns WHERE id=${Number(record.returnId)} FOR UPDATE`);
    if (!source || source.sourceDeliveryDocumentId != null || Number(source.inventoryId) !== Number(record.inventoryId)
      || (source.purchaseOrderId ?? null) !== (record.purchaseOrderId ?? null)
      || (source.purchaseOrderItemId ?? null) !== (record.purchaseOrderItemId ?? null)) conflict("تغير مصدر المرتجع؛ يلزم المراجعة");
    if (record.purchaseOrderId != null) {
      const [parent] = await rows(tx, sql`SELECT p.id FROM purchase_orders p
        WHERE p.id=${Number(record.purchaseOrderId)} AND (${record.purchaseOrderItemId ?? null} IS NULL OR EXISTS
          (SELECT 1 FROM purchase_order_items i WHERE i.id=${record.purchaseOrderItemId ?? null} AND i.purchaseOrderId=p.id))`);
      if (!parent) deny("طلب الشراء المرتبط غير متاح");
    }
    const standaloneSource = record.purchaseOrderId == null && record.purchaseOrderItemId == null
      ? await verifyStandaloneReturnSource(tx, record) : null;
    const [previous] = await rows(tx, sql`SELECT actorId,requestHash,result FROM supplier_return_events WHERE caseId=${input.caseId} AND operationKey=${input.operationKey}`);
    if (previous) {
      if (Number(previous.actorId) !== actor.id || previous.requestHash !== hash) conflict("مفتاح العملية مستخدم لطلب مختلف");
      const result = parseJson(previous.result);
      if (!result) throw Error("Missing supplier return replay result");
      return result as { caseId: number; revision: number; handover: Followup["handover"]; resolution: Followup["resolution"] };
    }
    if (record.closedAt) conflict("متابعة المرتجع مغلقة");
    const before: Followup = {
      delegateId: Number(record.delegateId), creatorId: standaloneSource?.creatorId ?? (record.creatorId == null ? null : Number(record.creatorId)),
      returnedQuantity: Number(record.returnedQuantity), revision: Number(record.revision), handover: record.handoverStatus,
      resolution: record.resolution, rejectionReason: record.rejectionReason, creatorDecision: record.creatorDecision,
    };
    const currentActor = { ...actor, active: true };
    const after = input.action === "resend" ? resendHandover(currentActor, before, input.expectedRevision)
      : input.action === "resolve" ? chooseResolution(currentActor, before, input.expectedRevision, input.resolution)
      : decideHandover(currentActor, before, input.expectedRevision, input.action === "accept", input.action === "reject" ? input.reason : "");
    // A same-item choice freezes the original item identity (catalog ID when
    // available) and returned quantity. It does not create or approve a PO.
    if (input.action === "resolve" && input.resolution === "same_item") {
      const [item] = await rows(tx, sql`SELECT COALESCE(i.itemName,v.itemName) AS itemName,ci.id AS activeCatalogId
        FROM inventory v
        LEFT JOIN purchase_order_items i ON i.id=${record.purchaseOrderItemId ?? null} AND i.purchaseOrderId=${record.purchaseOrderId ?? null}
        LEFT JOIN catalog_items ci ON ci.id=COALESCE(i.catalogItemId,v.linkedItemId) AND ci.isActive=1
        WHERE v.id=${Number(record.inventoryId)}`);
      if (!item?.itemName?.trim()) conflict("تعذر تحديد اسم الصنف الأصلي من المخزون");
      const [existingPlan] = await rows(tx, sql`SELECT id FROM supplier_return_replacement_plans WHERE caseId=${input.caseId} LIMIT 1`);
      if (existingPlan) conflict("يوجد طلب بديل سابق لهذا المرتجع");
      await tx.execute(sql`INSERT INTO supplier_return_replacement_plans
        (caseId,planNumber,status,catalogItemId,itemName,replacementQuantity,replacementUnit,originalQuantityCovered,selectedById,createdById)
        VALUES (${input.caseId},1,'pending_review',${item.activeCatalogId == null ? null : Number(item.activeCatalogId)},${item.itemName},${record.returnedQuantity},${record.returnedUnit},${record.returnedQuantity},${actor.id},${actor.id})`);
    }
    const result = { caseId: input.caseId, revision: after.revision, handover: after.handover, resolution: after.resolution };
    const handoverDecision = input.action === "accept" || input.action === "reject";
    const write = await tx.execute(sql`UPDATE supplier_return_cases SET handoverStatus=${after.handover},rejectionReason=${after.rejectionReason},resolution=${after.resolution},creatorDecision=${after.creatorDecision},revision=${after.revision}
      ${handoverDecision ? sql`,handoverDecidedById=${actor.id},handoverDecidedAt=CURRENT_TIMESTAMP` : sql``}
      ${input.action === "resolve" ? sql`,resolutionDecidedById=${actor.id},resolutionDecidedAt=CURRENT_TIMESTAMP` : sql``}
      WHERE id=${input.caseId} AND revision=${before.revision}`);
    if (Number(write?.[0]?.affectedRows) !== 1) conflict("تغير المرتجع؛ حدّث الصفحة");
    // The owner has chosen to recognize supplier credit when the assigned
    // delegate confirms handover. The case lock and event key make this a
    // single transition; an unavailable legacy invoice value is not guessed.
    if (input.action === "accept" && record.originalPurchaseValue != null) {
      if (!record.currency || !["tax_inclusive", "tax_exclusive"].includes(record.valuationBasis)) conflict("بيانات قيمة فاتورة المرتجع غير مكتملة");
      const amount = format4(decimal4(String(record.originalPurchaseValue)));
      const [existingCredit] = await rows(tx, sql`SELECT id FROM supplier_return_settlements WHERE caseId=${input.caseId} AND type='supplier_credit' LIMIT 1`);
      if (existingCredit) conflict("رُصد رصيد هذا المرتجع مسبقًا؛ يلزم مراجعة التسوية");
      await tx.execute(sql`INSERT INTO supplier_return_settlements
        (caseId,operationKey,type,status,amount,currency,valuationBasis,referenceNumber,notes,createdById,completedById,completedAt)
        VALUES (${input.caseId},${`handover-credit:${input.caseId}`},'supplier_credit','completed',${amount},${record.currency},${record.valuationBasis},${String(record.returnId)},'رصيد تعويض مثبت عند تأكيد المندوب استلام المرتجع',${actor.id},${actor.id},CURRENT_TIMESTAMP)`);
    }
    await tx.execute(sql`INSERT INTO supplier_return_events (caseId,actorId,action,operationKey,requestHash,fromRevision,toRevision,beforeState,afterState,reason,result)
      VALUES (${input.caseId},${actor.id},${input.action},${input.operationKey},${hash},${before.revision},${after.revision},${JSON.stringify(before)},${JSON.stringify(after)},${input.action === "reject" ? input.reason : null},${JSON.stringify(result)})`);
    const target = input.action === "reject" ? Number(record.createdById)
      : input.action === "resend" ? Number(record.delegateId)
      : input.action === "resolve" && input.resolution !== "same_item" ? Number(before.creatorId) : 0;
    if (Number.isSafeInteger(target) && target > 0) {
      const message = input.action === "reject" ? `لم يستلم المندوب المرتجع: ${input.reason}`
        : input.action === "resend" ? "أعاد المستودع إرسال المرتجع لتأكيد استلامك"
        : "اختار المندوب إجراء مرتجع يحتاج مراجعتك بصفتك منشئ الطلب";
      await tx.execute(sql`INSERT INTO notifications (userId,title,message,type) VALUES (${target},'متابعة مرتجع مورد',${message},'info')`);
    }
    return result;
  });
}

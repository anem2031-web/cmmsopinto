import { sql } from "drizzle-orm";
import { operationalIssuesEnabled } from "./feature";
import { dispatchContext } from "../../../shared/operational-dispatch";
import { assertOperationalReplacementIdentity, loadOperationalReplacements, operationalReplacementTablesReady } from "./replacement";
import type { OperationalLine } from "../../../shared/operational-issues";

export async function executionRows(tx: any, query: any): Promise<any[]> {
  const result = await tx.execute(query); return Array.isArray(result[0]) ? result[0] : [];
}

/** Runs in the existing physical writer transaction. No new table read when disabled. */
export async function assertOperationalIssueReference(tx: any, input: {
  operationalIssueItemId?: number; ticketId?: number; ticketItemId?: number; pmv2TaskItemId?: number; selectedTicketItemId?: number;
  deliveredToId?: number; performedById: number; catalogItemId: number | null; quantity: number; operationKey?: string; operationalBatchKey?: string;
  lotTrackingToken?: string; unit?: string; operationalReplacementAware?: boolean;
}) {
  if (!operationalIssuesEnabled()) {
    if (input.operationalIssueItemId) throw new Error("الصرف التشغيلي غير متاح حاليًا");
    return null;
  }
  const other = input.ticketId || input.ticketItemId || input.pmv2TaskItemId || input.selectedTicketItemId;
  if (!input.operationalIssueItemId) {
    if (!other) throw new Error("الصرف يتطلب بلاغ صيانة أو مهمة أو أمر صرف تشغيلي معتمد");
    return null;
  }
  if (other) throw new Error("يجب تحديد مرجع تنفيذ واحد للصرف");
  if (!input.operationKey) throw new Error("معرف عملية الصرف مطلوب");
  const [line] = await executionRows(tx, sql`SELECT i.*,o.orderNumber,o.status,o.collectorId,o.siteId,o.sectionId,
    u.isActive AS collectorActive,u.role AS collectorRole,p.isActive AS actorActive,p.role AS actorRole
    FROM operational_issue_items i INNER JOIN operational_issue_orders o ON o.id=i.orderId
    INNER JOIN users u ON u.id=o.collectorId INNER JOIN users p ON p.id=${input.performedById}
    WHERE i.id=${input.operationalIssueItemId} FOR UPDATE`);
  if (!line || line.status !== "approved") throw new Error("أمر الصرف غير معتمد أو تم استكماله");
  if (Number(line.actorActive) !== 1 || !["warehouse", "owner", "admin"].includes(line.actorRole)) throw new Error("الصرف للمستودع فقط");
  const context = dispatchContext(line.dispatchContext);
  if (context) {
    if (!input.operationalBatchKey) throw new Error("يلزم تأكيد صرف الطلب بالكامل");
    const [batch] = await executionRows(tx, sql`SELECT inputJson FROM operational_issue_batches WHERE orderId=${Number(line.orderId)} AND operationKey=${input.operationalBatchKey} AND issuedById=${input.performedById}`);
    const recipients = batch && (typeof batch.inputJson === "string" ? JSON.parse(batch.inputJson) : batch.inputJson);
    const recipient = Array.isArray(recipients) && recipients.find(r => Number(r.itemId) === Number(line.id));
    if (!recipient || Number(recipient.actualCollectorId) !== input.deliveredToId) throw new Error("المستلم لا يطابق عملية الصرف الجماعي");
    const [person] = await executionRows(tx, sql`SELECT id FROM users WHERE id=${input.deliveredToId} AND isActive=1 AND role='technician'`);
    if (!person) throw new Error("المستلم غير نشط أو ليس فنيًا");
  } else if (Number(line.collectorActive) !== 1 || line.collectorRole !== "technician" || Number(line.collectorId) !== input.deliveredToId) throw new Error("المستلم يجب أن يكون الفني المحدد في أمر الصرف");
  const replacement = await assertOperationalReplacementIdentity(tx, line, input);
  if (!replacement) {
    if (Number(line.catalogItemId) !== input.catalogItemId) throw new Error("اللوت لا يطابق صنف أمر الصرف");
    const [used] = await executionRows(tx, sql`SELECT COALESCE(SUM(quantity),0) AS issued FROM operational_issue_deliveries WHERE orderItemId=${Number(line.id)}`);
    if (Math.round((Number(used.issued) + input.quantity) * 1000) > Math.round(Number(line.quantity) * 1000)) throw new Error("الكمية تتجاوز المتبقي المعتمد في أمر الصرف");
  }
  return { orderId: Number(line.orderId), itemId: Number(line.id), orderNumber: String(line.orderNumber), siteId: context?.siteId ?? Number(line.siteId), sectionId: context?.sectionId ?? Number(line.sectionId), replacementAware: Boolean(replacement) };
}

export async function recordOperationalDelivery(tx: any, reference: NonNullable<Awaited<ReturnType<typeof assertOperationalIssueReference>>>, value: {
  deliveryDocumentId: number; inventoryTransactionId: number; quantity: number; lotUnitCost: number; cost: number; operationKey: string; requestFingerprint: string; actorId: number;
}) {
  await tx.execute(sql`INSERT INTO operational_issue_deliveries (orderItemId,deliveryDocumentId,inventoryTransactionId,quantity,lotUnitCost,cost,operationKey,requestFingerprint,issuedById)
    VALUES (${reference.itemId},${value.deliveryDocumentId},${value.inventoryTransactionId},${value.quantity},${value.lotUnitCost},${value.cost},${value.operationKey},${value.requestFingerprint},${value.actorId})`);
  if (reference.replacementAware || await operationalReplacementTablesReady(tx)) {
    const lines = await executionRows(tx, sql`SELECT i.*,COALESCE((SELECT SUM(d.quantity) FROM operational_issue_deliveries d WHERE d.orderItemId=i.id),0) AS issuedQuantity
      FROM operational_issue_items i WHERE i.orderId=${reference.orderId} ORDER BY i.id`) as OperationalLine[];
    const replacements = await loadOperationalReplacements(tx, lines);
    if (replacements.size) {
      const complete = lines.length > 0 && lines.every(line => Math.round((replacements.get(Number(line.id))?.issued ?? Number(line.issuedQuantity)) * 1000) >= Math.round(Number(line.quantity) * 1000));
      await tx.execute(sql`UPDATE operational_issue_orders SET revision=revision+1,status=${complete ? "completed" : "approved"} WHERE id=${reference.orderId}`);
      return;
    }
  }
  const [remaining] = await executionRows(tx, sql`SELECT COUNT(*) AS remaining FROM operational_issue_items i WHERE i.orderId=${reference.orderId}
    AND i.quantity>(SELECT COALESCE(SUM(d.quantity),0) FROM operational_issue_deliveries d WHERE d.orderItemId=i.id)`);
  await tx.execute(sql`UPDATE operational_issue_orders SET revision=revision+1,status=${Number(remaining.remaining) === 0 ? "completed" : "approved"} WHERE id=${reference.orderId}`);
}

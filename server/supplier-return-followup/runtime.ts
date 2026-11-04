import { sql } from "drizzle-orm";
import { isDelegateRole } from "../../shared/roles";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { executeFollowupCommand, type FollowupCommand, type FollowupPort, type FollowupTx } from "./commands";
import { createSupplierReturnOnce, type NewReturnRequest } from "./create-once";
import { previewReturnValuation, savedReturnValuation } from "./valuation";
import { supplierReturnDatabaseEnabled } from "./feature";
import { resolveReturnLineage } from "./lineage";

type Actor = { id: number; role: string };
const allowed = ["warehouse", "delegate", "delegate_manager", "admin", "owner", "maintenance_manager", "general_maintenance_manager", "construction_procurement_manager", "it_manager", "purchase_manager", "accountant", "senior_management", "executive_director", "user", "operator", "technician", "it_member", "supervisor", "purchase_requester", "food_warehouse_manager", "food_warehouse_assistant"];
export async function readRows(tx: FollowupTx, query: Parameters<FollowupTx["execute"]>[0]): Promise<any[]> {
  const result = await tx.execute(query);
  if (!Array.isArray(result?.[0])) throw Error("Invalid supplier return response");
  return result[0];
}
/** Rechecked at each read/write boundary; production requires an explicit flag. */
export async function trialEnabled(tx: FollowupTx) {
  const [db] = await readRows(tx, sql`SELECT DATABASE() AS databaseName`);
  return supplierReturnDatabaseEnabled(db?.databaseName);
}
async function identity(tx: FollowupTx, actor: Actor) {
  if (!allowed.includes(actor.role)) throw new TRPCError({ code: "FORBIDDEN" });
  const [u] = await readRows(tx, sql`SELECT id,role,isActive FROM users WHERE id=${actor.id}`);
  if (!u || u.role !== actor.role || Number(u.isActive) !== 1) throw new TRPCError({ code: "FORBIDDEN" });
}
export async function trialPort() {
  const db = await (await import("../_core/db/client")).getDb();
  if (!db) throw Error("Database unavailable");
  return db;
}
export async function supplierReturnStatus(actor: Actor, tx: FollowupTx) {
  await identity(tx, actor);
  return { enabled: await trialEnabled(tx) };
}
export const listInput = z.object({ page: z.number().int().min(1).max(100000).default(1), pageSize: z.number().int().min(1).max(50).default(20), status: z.enum(["active", "completed", "all"]).default("active") });
export const valuationInput = z.object({ trackingToken: z.string().trim().min(1).max(150), warehouseId: z.number().int().positive(), returnedQuantity: z.number().int().positive() }).strict();
export async function supplierReturnValuePreview(actor: Actor, raw: z.input<typeof valuationInput>, tx: FollowupTx) {
  if (!["warehouse", "admin", "owner"].includes(actor.role)) throw new TRPCError({ code: "FORBIDDEN" });
  await identity(tx, actor);
  if (!await trialEnabled(tx)) throw new TRPCError({ code: "FORBIDDEN" });
  return previewReturnValuation(tx, valuationInput.parse(raw));
}
export async function listSupplierReturns(actor: Actor, raw: z.input<typeof listInput>, tx: FollowupTx) {
  const input = listInput.parse(raw);
  await identity(tx, actor);
  if (!await trialEnabled(tx)) throw new TRPCError({ code: "FORBIDDEN", message: "متابعة مرتجع المورد غير مفعّلة لهذه القاعدة" });
  // Source existence and assignment are evaluated in SQL before pagination.
  // No single-record authorization reader is called inside a result loop.
  const creatorId = sql`COALESCE(c.creatorId,CASE WHEN c.purchaseOrderId IS NULL AND c.purchaseOrderItemId IS NULL
    AND originalReceipt.id IS NOT NULL AND originalLine.id IS NOT NULL AND originalLot.id IS NOT NULL AND originalBalance.id IS NOT NULL
    AND r.returnedQuantity=c.returnedQuantity AND r.returnedQuantity>0
    AND TRIM(originalLot.issueUnit)=TRIM(c.returnedUnit) AND TRIM(originalLot.issueUnit)<>''
    AND (originalLot.catalogItemId IS NULL OR originalLine.catalogItemId IS NULL OR originalLot.catalogItemId=originalLine.catalogItemId)
    AND (originalLot.catalogItemId IS NULL OR v.linkedItemId IS NULL OR originalLot.catalogItemId=v.linkedItemId)
    AND (originalLine.catalogItemId IS NULL OR v.linkedItemId IS NULL OR originalLine.catalogItemId=v.linkedItemId)
    THEN c.createdById ELSE NULL END)`;
  const scope = sql`r.sourceDeliveryDocumentId IS NULL AND r.inventoryId=c.inventoryId
    AND r.purchaseOrderId <=> c.purchaseOrderId AND r.purchaseOrderItemId <=> c.purchaseOrderItemId
    AND (c.purchaseOrderId IS NULL OR p.id IS NOT NULL)
    AND (c.purchaseOrderItemId IS NULL OR (i.id IS NOT NULL AND i.purchaseOrderId=p.id))
    ${isDelegateRole(actor.role) ? sql`AND c.delegateId=${actor.id}` : ["warehouse", "admin", "owner"].includes(actor.role) ? sql`` : sql`AND ${creatorId}=${actor.id}`}
    ${input.status === "active" ? sql`AND c.closedAt IS NULL` : input.status === "completed" ? sql`AND c.closedAt IS NOT NULL` : sql``}`;
  const joins = sql`FROM supplier_return_cases c INNER JOIN warehouse_returns r ON r.id=c.returnId
    INNER JOIN inventory v ON v.id=c.inventoryId
    LEFT JOIN warehouse_receipts originalReceipt ON originalReceipt.id=c.receiptId AND originalReceipt.id=r.receiptId AND originalReceipt.status='confirmed' AND originalReceipt.purchaseOrderId IS NULL
    LEFT JOIN warehouse_receipt_items originalLine ON originalLine.id=c.receiptItemId AND originalLine.receiptId=originalReceipt.id AND originalLine.inventoryId=c.inventoryId AND originalLine.purchaseOrderItemId IS NULL
    LEFT JOIN inventory_lots originalLot ON originalLot.id=c.lotId AND originalLot.id=r.lotId AND originalLot.receiptId=originalReceipt.id AND originalLot.receiptItemId=originalLine.id AND originalLot.sourceType='receipt' AND originalLot.purchaseOrderId IS NULL AND originalLot.purchaseOrderItemId IS NULL
    LEFT JOIN inventory_lot_balances originalBalance ON originalBalance.lotId=originalLot.id AND originalBalance.inventoryId=c.inventoryId
    LEFT JOIN supplier_return_replacement_plans parentPlan ON parentPlan.id=c.parentReplacementPlanId
    LEFT JOIN supplier_return_cases parentCase ON parentCase.id=parentPlan.caseId
    LEFT JOIN warehouse_returns parentReturn ON parentReturn.id=parentCase.returnId
    LEFT JOIN supplier_return_replacement_plans plan ON plan.caseId=c.id AND plan.planNumber=1
    LEFT JOIN purchase_orders replacementOrder ON replacementOrder.id=plan.purchaseOrderId
    LEFT JOIN supplier_return_settlements credit ON credit.caseId=c.id AND credit.type='supplier_credit' AND credit.status='completed' AND credit.operationKey=CONCAT('handover-credit:',c.id)
    LEFT JOIN supplier_return_settlements refund ON refund.caseId=c.id AND refund.type='cash_refund' AND refund.status='completed' AND refund.operationKey=CONCAT('cash-refund:',c.id)
    LEFT JOIN purchase_orders p ON p.id=c.purchaseOrderId
    LEFT JOIN purchase_order_items i ON i.id=c.purchaseOrderItemId`;
  const [count] = await readRows(tx, sql`SELECT COUNT(*) AS total ${joins} WHERE ${scope}`);
  const items = await readRows(tx, sql`SELECT c.id,c.returnId,c.delegateId,c.returnedQuantity,c.returnedUnit,c.returnReason,c.handoverStatus,c.rejectionReason,c.resolution,c.creatorDecision,c.revision,c.closedAt,c.originalPurchaseValue,c.currency,c.valuationBasis,
    plan.id AS replacementPlanId,plan.status AS replacementPlanStatus,plan.purchaseOrderId AS replacementPurchaseOrderId,replacementOrder.poNumber AS replacementPoNumber,
    plan.quotedTotal AS replacementQuotedTotal,plan.creditAllocated AS replacementCreditAllocated,plan.additionalFunding AS replacementAdditionalFunding,
    plan.catalogItemId AS replacementCatalogItemId,plan.itemName AS replacementItemName,plan.replacementQuantity,plan.replacementUnit,
    (SELECT imageUrl FROM catalog_item_images WHERE itemId=plan.catalogItemId ORDER BY (imageType='main') DESC,sortOrder,id LIMIT 1) AS replacementPhotoUrl,
    p.siteId AS originalSiteId,p.sectionId AS originalSectionId,p.categoryId AS originalCategoryId,p.assetId AS originalAssetId,
    i.siteId AS originalItemSiteId,i.sectionId AS originalItemSectionId,i.categoryId AS originalItemCategoryId,i.assetId AS originalItemAssetId,
    p.ticketId AS originalTicketId,p.ticketItemId AS originalTicketItemId,${creatorId} AS creatorId,
    c.parentReplacementPlanId,parentCase.id AS parentCaseId,parentReturn.returnNumber AS parentReturnNumber,
    credit.amount AS supplierCreditAmount,
    CASE WHEN plan.status='received' AND credit.amount IS NOT NULL AND plan.creditAllocated IS NOT NULL
      THEN GREATEST(0,credit.amount-plan.creditAllocated) ELSE NULL END AS residualCustodyAmount,
    refund.id AS confirmedRefundId,refund.amount AS confirmedRefundAmount,refund.referenceNumber AS refundReference,
    r.returnNumber,p.poNumber,originalReceipt.receiptNumber AS originalReceiptNumber,COALESCE(i.itemName,v.itemName) AS itemName,i.photoUrl AS originalPhotoUrl
    ${joins} WHERE ${scope} ORDER BY c.createdAt DESC,c.id DESC LIMIT ${input.pageSize} OFFSET ${(input.page-1)*input.pageSize}`);
  if (items.some(row => isDelegateRole(actor.role) ? Number(row.delegateId) !== actor.id
    : !["warehouse", "admin", "owner"].includes(actor.role) && Number(row.creatorId) !== actor.id)) throw new TRPCError({ code: "FORBIDDEN" });
  return { items, total: Number(count?.total ?? 0), page: input.page, pageSize: input.pageSize };
}
export async function runTrialCommand(actor: Actor, input: FollowupCommand, port: FollowupPort) {
  // Gate inside the transaction; never use a snapshot from an earlier read RPC.
  return executeFollowupCommand({ transaction: work => port.transaction(async tx => {
    if (!await trialEnabled(tx)) throw new TRPCError({ code: "FORBIDDEN" });
    return work(tx);
  }) }, actor, input);
}
export async function createTrialReturn(actor: Actor, input: NewReturnRequest, port: FollowupPort) {
  return createSupplierReturnOnce({ transaction: work => port.transaction(async tx => {
    if (!await trialEnabled(tx)) throw new TRPCError({ code: "FORBIDDEN" });
    return work(tx);
  }) }, actor, input, async (tx, request, metadata) => {
    const { createLotAwareSupplierReturn } = await import("../_core/db/warehouse-returns");
    const [delegate] = await readRows(tx, sql`SELECT name,username FROM users WHERE id=${request.delegateId}`);
    const returned = await createLotAwareSupplierReturn({ ...request, returnedById: actor.id, recipientName: delegate?.name || delegate?.username }, tx);
    const { valuation, source: invoiceSource } = await savedReturnValuation(tx, returned.returnId);
    const [source] = await readRows(tx, sql`SELECT r.*,p.requestedById,l.receiptItemId,v.unit
      FROM warehouse_returns r INNER JOIN inventory v ON v.id=r.inventoryId
      LEFT JOIN purchase_orders p ON p.id=r.purchaseOrderId LEFT JOIN inventory_lots l ON l.id=r.lotId
      WHERE r.id=${returned.returnId}`);
    if (!source || !source.unit) throw Error("تعذر تثبيت مصدر المرتجع ووحدته");
    const lineage = await resolveReturnLineage(tx, { lotId: Number(source.lotId), receiptId: Number(source.receiptId), receiptItemId: Number(source.receiptItemId),
      purchaseOrderId: source.purchaseOrderId == null ? null : Number(source.purchaseOrderId), purchaseOrderItemId: source.purchaseOrderItemId == null ? null : Number(source.purchaseOrderItemId) });
    const creatorId = lineage.creatorId ?? source.requestedById ?? (source.purchaseOrderId == null && source.purchaseOrderItemId == null ? actor.id : null);
    const returnedUnit = invoiceSource.issueUnit?.trim() || source.unit;
    const [insert] = await tx.execute(sql`INSERT INTO supplier_return_cases
      (returnId,delegateId,creatorId,createdById,parentReplacementPlanId,purchaseOrderId,purchaseOrderItemId,receiptId,receiptItemId,lotId,inventoryId,returnedQuantity,returnedUnit,returnReason,creationKey,creationRequestHash,originalPurchaseValue,currency,valuationBasis,valuationSource)
      VALUES (${returned.returnId},${request.delegateId},${creatorId},${actor.id},${lineage.parentReplacementPlanId},${source.purchaseOrderId ?? null},${source.purchaseOrderItemId ?? null},${source.receiptId ?? null},${source.receiptItemId ?? null},${source.lotId ?? null},${source.inventoryId},${source.returnedQuantity},${returnedUnit},${request.reason},${metadata.creationKey},${metadata.creationRequestHash},${valuation.originalPurchaseValue},${valuation.currency},${valuation.valuationBasis},${valuation.valuationSource})`);
    const caseId = Number(insert?.insertId);
    if (!Number.isSafeInteger(caseId) || caseId <= 0) throw Error("تعذر إنشاء متابعة المرتجع");
    await tx.execute(sql`INSERT INTO supplier_return_events (caseId,actorId,action,operationKey,requestHash,fromRevision,toRevision,afterState,reason,result)
      VALUES (${caseId},${actor.id},'created',${metadata.creationKey},${metadata.creationRequestHash},0,0,
      ${JSON.stringify({ handoverStatus: "awaiting_delegate", delegateId: request.delegateId, parentReplacementPlanId: lineage.parentReplacementPlanId, returnedQuantity: request.returnedQuantity, returnedUnit, valuation,
        invoice: { receiptId: invoiceSource.receiptId, receiptItemId: invoiceSource.receiptItemId, lotId: invoiceSource.lotId, vendorName: invoiceSource.vendorName, invoiceNumber: invoiceSource.invoiceNumber,
          originalQuantity: invoiceSource.originalQuantity, conversionFactor: invoiceSource.conversionFactor, lineTotal: invoiceSource.invoiceLineTotal } })},${request.reason},${JSON.stringify({ caseId, returnId: returned.returnId })})`);
    await tx.execute(sql`INSERT INTO notifications (userId,title,message,type) VALUES (${request.delegateId},'مرتجع مورد بانتظار استلامك',${`المرتجع ${returned.returnNumber}، الكمية ${request.returnedQuantity} ${returnedUnit} — ${request.reason}`},'info')`);
    return { caseId, returnId: returned.returnId };
  });
}

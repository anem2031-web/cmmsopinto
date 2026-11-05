import { TRPCError } from "@trpc/server";
import { sql, type SQL } from "drizzle-orm";
import { readScopeChunks } from "../_core/authz/read-batch";
import { isDelegateRole } from "../../shared/delegate-role";
import { canReadExternalFollowupRole, externalFollowupListInput, externalFollowupDetailInput,
  type ExternalFollowupListInput, type ExternalFollowupSummary, type ExternalFollowupDetail } from "../../shared/external-maintenance-followup";

export type ExternalFollowupActor = { id: number; role: string; isActive?: number };
export type ExternalFollowupDatabase = { execute(query: SQL): Promise<any> };
const denied = () => new TRPCError({ code: "FORBIDDEN", message: "ليس لديك صلاحية لمتابعة عملية الصيانة الخارجية" });
async function rows(database: ExternalFollowupDatabase, query: SQL): Promise<any[]> {
  const [result] = await database.execute(query);
  if (!Array.isArray(result)) throw Error("Invalid external maintenance followup read response");
  return result;
}
export async function assertCurrentExternalFollowupActor(database: ExternalFollowupDatabase, actor: ExternalFollowupActor) {
  if (!Number.isSafeInteger(actor.id) || actor.id <= 0 || actor.isActive !== 1 || !canReadExternalFollowupRole(actor.role)) throw denied();
  const [current] = await rows(database, sql`SELECT id,role,isActive FROM users WHERE id=${actor.id}`);
  if (!current || Number(current.id) !== actor.id || current.role !== actor.role || Number(current.isActive) !== 1) throw denied();
}
/** Do not consult a mutable rollout flag to bypass an existing unified approval. */
async function hasUnifiedApprovalTable(database: ExternalFollowupDatabase): Promise<boolean> {
  const metadata = await rows(database, sql`SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='delegate_pricing_bundle_approvals'`);
  return metadata.length > 0;
}
function approvedSource(unified: boolean): SQL {
  const root = unified ? sql`LEFT JOIN delegate_pricing_bundle_approvals a ON a.bundleId=b.id` : sql``;
  const rootApproval = unified ? sql`(a.bundleId IS NULL OR (a.status='approved'
    AND COALESCE(a.accountingApprovedById,0)>0 AND a.accountingApprovedAt IS NOT NULL
    AND COALESCE(a.managementApprovedById,0)>0 AND a.managementApprovedAt IS NOT NULL
    AND NOT JSON_CONTAINS(COALESCE(a.accountingRejections,JSON_ARRAY()),JSON_OBJECT('itemId',i.id))
    AND NOT JSON_CONTAINS(COALESCE(a.managementRejections,JSON_ARRAY()),JSON_OBJECT('itemId',i.id))))` : sql`1=1`;
  return sql`pb.id IS NOT NULL AND pb.purchaseOrderId=p.id AND pb.status='approved'
    AND COALESCE(pb.accountingApprovedById,0)>0 AND pb.accountingApprovedAt IS NOT NULL
    AND COALESCE(pb.managementApprovedById,0)>0 AND pb.managementApprovedAt IS NOT NULL
    AND (pb.purchasePackageSubmissionId IS NULL OR (s.id=pb.purchasePackageSubmissionId AND s.purchasePackageId=p.packageId
      AND s.status='approved' AND COALESCE(s.accountingApprovedById,0)>0 AND s.accountingApprovedAt IS NOT NULL
      AND COALESCE(s.managementApprovedById,0)>0 AND s.managementApprovedAt IS NOT NULL))
    AND ((NOT EXISTS(SELECT 1 FROM delegate_pricing_bundle_batches linked WHERE linked.pricingBatchId=pb.id)
      AND NOT EXISTS(SELECT 1 FROM delegate_pricing_bundle_items linked WHERE linked.purchaseOrderItemId=i.id AND linked.removedAt IS NULL))
      OR EXISTS(SELECT 1 FROM delegate_pricing_bundle_items member
        JOIN delegate_pricing_bundles b ON b.id=member.bundleId
        JOIN delegate_pricing_bundle_batches linked ON linked.bundleId=b.id AND linked.purchaseOrderId=p.id AND linked.pricingBatchId=pb.id
        ${root}
        WHERE member.purchaseOrderItemId=i.id AND member.removedAt IS NULL AND b.status IN ('sent','archived')
          AND b.delegateId=j.delegateId AND ${rootApproval}
          AND ((linked.purchasePackageSubmissionId IS NULL AND pb.purchasePackageSubmissionId IS NULL)
            OR linked.purchasePackageSubmissionId=pb.purchasePackageSubmissionId)))`;
}
function sourceFrom(): SQL {
  return sql`FROM external_maintenance_jobs j
    JOIN purchase_orders p ON p.id=j.purchaseOrderId
    JOIN purchase_order_items i ON i.purchaseOrderId=p.id
    JOIN tickets t ON t.id=j.ticketId
    LEFT JOIN ticket_items ti ON ti.id=j.ticketItemId AND ti.ticketId=t.id
    JOIN users delegate ON delegate.id=j.delegateId
    LEFT JOIN po_pricing_batches pb ON pb.id=i.batchId
    LEFT JOIN purchase_package_submissions s ON s.id=pb.purchasePackageSubmissionId`;
}
function baseSourceWhere(actor: ExternalFollowupActor): SQL {
  // The gate creates one service item per asset. Never guess a source after a
  // malformed extra item/job, wrong parent, cancellation or uncommitted approval.
  return sql`j.gateExitApprovedAt IS NOT NULL
    AND j.status IN ('purchase_cycle','waiting_gate_entry','waiting_warehouse_receipt','waiting_technician_handover','delivered_for_reinstall','reinstall_in_progress','ready_for_closure','closed')
    AND p.ticketId=j.ticketId AND ((p.ticketItemId IS NULL AND j.ticketItemId IS NULL) OR p.ticketItemId=j.ticketItemId)
    AND ((j.ticketItemId IS NULL AND t.maintenancePath='C') OR (ti.id=j.ticketItemId AND ti.maintenancePath='C'))
    AND p.status NOT IN ('draft','rejected','revision_needed')
    AND i.status NOT IN ('pending_review','rejected','cancelled','purchase_cancelled','needs_item_revision')
    AND i.delegateId=j.delegateId
    AND (SELECT COUNT(*) FROM purchase_order_items singleItem WHERE singleItem.purchaseOrderId=p.id)=1
    AND (SELECT COUNT(*) FROM external_maintenance_jobs singleJob WHERE singleJob.purchaseOrderId=p.id)=1
    AND (j.warehouseReceivedAt IS NULL OR j.gateEntryApprovedAt IS NOT NULL)
    AND ${isDelegateRole(actor.role) ? sql`j.delegateId=${actor.id} AND i.delegateId=${actor.id}` : sql`1=1`}`;
}
const acceptedItem = sql`i.status IN ('approved','funded','purchased','delivered_to_warehouse','delivered_to_requester')`;
function sourceWhere(actor: ExternalFollowupActor, unified: boolean): SQL {
  return sql`${baseSourceWhere(actor)} AND ${acceptedItem} AND ${approvedSource(unified)}`;
}
const summaryColumns = sql`j.id AS jobId,j.purchaseTitle,j.assetBeforePhotoUrl,j.delegateId,delegate.name AS delegateName,
  CAST(j.expectedReturnDate AS CHAR) AS expectedReturnDate,j.status,
  CAST(j.gateEntryApprovedAt AS CHAR) AS gateEntryApprovedAt,CAST(j.warehouseReceivedAt AS CHAR) AS warehouseReceivedAt`;
function normalizeSummary(row: any): ExternalFollowupSummary {
  return { jobId: Number(row.jobId), purchaseTitle: row.purchaseTitle ?? null, assetBeforePhotoUrl: row.assetBeforePhotoUrl ?? null,
    delegateId: Number(row.delegateId), delegateName: row.delegateName ?? null, expectedReturnDate: row.expectedReturnDate ?? null,
    status: row.status, gateEntryApprovedAt: row.gateEntryApprovedAt ?? null, warehouseReceivedAt: row.warehouseReceivedAt ?? null };
}
export async function listExternalMaintenanceFollowup(database: ExternalFollowupDatabase, actor: ExternalFollowupActor, rawInput: unknown) {
  const input: ExternalFollowupListInput = externalFollowupListInput.parse(rawInput);
  await assertCurrentExternalFollowupActor(database, actor);
  const unified = await hasUnifiedApprovalTable(database);
  const where = sql`${sourceWhere(actor, unified)} AND ${input.view === "active" ? sql`j.warehouseReceivedAt IS NULL` : input.view === "received" ? sql`j.warehouseReceivedAt IS NOT NULL` : sql`1=1`}`;
  const [[total], page] = await Promise.all([
    rows(database, sql`SELECT COUNT(*) AS total ${sourceFrom()} WHERE ${where}`),
    rows(database, sql`SELECT ${summaryColumns} ${sourceFrom()} WHERE ${where}
      ORDER BY j.updatedAt DESC,j.id DESC LIMIT ${input.pageSize} OFFSET ${(input.page - 1) * input.pageSize}`),
  ]);
  return { rows: page.map(normalizeSummary), total: Number(total?.total ?? 0), page: input.page, pageSize: input.pageSize };
}
export async function externalMaintenanceFollowupDetail(database: ExternalFollowupDatabase, actor: ExternalFollowupActor, rawInput: unknown): Promise<ExternalFollowupDetail> {
  const { jobId } = externalFollowupDetailInput.parse(rawInput);
  await assertCurrentExternalFollowupActor(database, actor);
  const unified = await hasUnifiedApprovalTable(database);
  const [detail] = await rows(database, sql`SELECT ${summaryColumns},j.assetName,j.assetAfterReturnPhotoUrl,j.ticketId,t.ticketNumber,
      COALESCE(NULLIF(ti.description,''),t.description) AS ticketDescription,j.purchaseOrderId,p.poNumber,
      j.workshopName,j.workshopPhone,j.workshopLocationUrl,j.workshopNotes,j.assetBeforeCondition,j.warehouseNotes,
      j.exitDocumentNumber,j.returnDocumentNumber,CAST(j.gateExitApprovedAt AS CHAR) AS gateExitApprovedAt,j.gateExitCarrierName,j.gateExitNotes,
      j.gateEntryCarrierName,j.gateEntryNotes,j.returnCondition,j.warehouseReturnNotes,
      exited.name AS gateExitApprovedByName,entered.name AS gateEntryApprovedByName,received.name AS warehouseReceivedByName
    ${sourceFrom()}
    LEFT JOIN users exited ON exited.id=j.gateExitApprovedById
    LEFT JOIN users entered ON entered.id=j.gateEntryApprovedById
    LEFT JOIN users received ON received.id=j.warehouseReceivedById
    WHERE j.id=${jobId} AND ${sourceWhere(actor, unified)} LIMIT 1`);
  if (!detail) throw new TRPCError({ code: "NOT_FOUND", message: "عملية الصيانة الخارجية غير متاحة للمتابعة" });
  return { ...detail, ...normalizeSummary(detail), ticketId: Number(detail.ticketId), purchaseOrderId: Number(detail.purchaseOrderId) };
}

/** Exact asset-key scope: before images stay readable for the current assigned
 * delegate's pricing. Return images also require final source approval. */
export async function externalDelegateFollowupMediaSources(database: ExternalFollowupDatabase, actor: ExternalFollowupActor, jobIds: number[]) {
  if (!isDelegateRole(actor.role)) throw denied();
  const ids = Array.from(new Set(jobIds));
  if (ids.some(id => !Number.isSafeInteger(id) || id <= 0)) throw denied();
  if (!ids.length) return [];
  await assertCurrentExternalFollowupActor(database, actor);
  const unified = await hasUnifiedApprovalTable(database);
  return readScopeChunks(ids, part => rows(database, sql`SELECT j.id AS jobId,j.ticketId,j.assetBeforePhotoUrl,j.assetAfterReturnPhotoUrl,j.workshopReportUrl,
      CASE WHEN ${acceptedItem} AND ${approvedSource(unified)} THEN 1 ELSE 0 END AS followupApproved
    ${sourceFrom()} WHERE j.id IN (${sql.join(part.map(id => sql`${id}`), sql`,`)}) AND ${baseSourceWhere(actor)}`));
}

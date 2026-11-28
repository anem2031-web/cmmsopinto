import { sql } from "drizzle-orm";
import { canPrepareSettlementDraft, canReviewSettlementDraft } from "../../../shared/inventory-settlement-review";
import type { YourWorkItem } from "../../../shared/your-work";
import { operationCapability, operationItem, operationRows, privilegedOperationActor, type OperationsActor, type OperationsDatabase } from "./operations-port";

export function classifySettlementOperations(actor: OperationsActor, rows: any[]): YourWorkItem[] {
  return rows.flatMap(row => {
    let action: YourWorkItem["action"] | null = null, arrivedAt: any = null;
    const owns = privilegedOperationActor(actor) || Number(row.preparedById) === actor.id;
    if (canPrepareSettlementDraft(actor.role) && owns && row.status === "returned") {
      action = row.correctionId ? "settlement_correct" : "settlement_prepare";
      arrivedAt = row.returnedAt;
    } else if (canReviewSettlementDraft(actor.role) && row.status === "pending_review" && !row.correctionId
      && Number(row.preparedById) !== actor.id && Number(row.lastSubmittedById) !== actor.id && !Number(row.contributed)) {
      action = "settlement_review"; arrivedAt = row.submittedAtMs;
    }
    const capability = action === "settlement_review" ? "inventoryCount.approveSettlementDraft" : action === "settlement_correct" ? "inventoryCount.correctCount" : "inventoryCount.saveSettlementDraft";
    if (!action || !operationCapability(actor, capability)) return [];
    const path = actor.role === "warehouse" ? "/inventory-operations" : "/inventory-settlement-review";
    return [operationItem({ key: `settlement:${row.id}:${action}`, kind: "settlement", reference: row.operationNumber || `#${row.id}`, title: row.reason,
      action, href: `${path}?draftId=${row.id}`, arrivedAt })];
  });
}

export async function readSettlementOperations(db: OperationsDatabase, actor: OperationsActor): Promise<YourWorkItem[]> {
  if (!canPrepareSettlementDraft(actor.role) && !canReviewSettlementDraft(actor.role)) return [];
  const candidates = await operationRows(db, sql`/* your-work:settlements */ SELECT d.id,d.status,d.preparedById,d.lastSubmittedById,d.reason,o.operationNumber,
    UNIX_TIMESTAMP(d.submittedAt)*1000 AS submittedAtMs,
    (SELECT UNIX_TIMESTAMP(e.createdAt)*1000 FROM inventory_settlement_draft_events e WHERE e.draftId=d.id AND e.action IN ('returned','correction_requested') ORDER BY e.id DESC LIMIT 1) AS returnedAt,
    EXISTS (SELECT 1 FROM inventory_settlement_draft_events e WHERE e.draftId=d.id AND e.actorId=${actor.id} AND e.action IN ('created','edited','submitted','count_corrected')) AS contributed,
    correction.id AS correctionId FROM inventory_settlement_drafts d INNER JOIN inventory_count_operations o ON o.id=d.sourceCountOperationId AND o.status='completed'
    LEFT JOIN inventory_count_corrections correction ON correction.draftId=d.id AND correction.operationId=o.id AND correction.status='pending'
    WHERE d.status IN ('pending_review','returned') AND NOT EXISTS (SELECT 1 FROM inventory_settlements posted WHERE posted.sourceCountOperationId=o.id AND posted.status='applied')
    AND (${actor.role === "warehouse" ? sql`d.preparedById=${actor.id} AND d.status='returned'` : sql`TRUE`})`);
  return classifySettlementOperations(actor, candidates);
}

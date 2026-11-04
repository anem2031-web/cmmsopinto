import { sql } from "drizzle-orm";
import { groupReadRows, readScopeChunks } from "../_core/authz/read-batch";
import type { FollowupTx } from "./commands";
import { readRows } from "./runtime";

export type ActiveCompensationCase = {
  id: number; sourceItemId: number; sourcePurchaseOrderId: number;
  parentReplacementPlanId: number | null; returnedQuantity: string; returnedUnit: string;
  planId: number | null; planStatus: string | null;
};
type Node = ActiveCompensationCase & { closedAt: unknown; replacementItemId: number | null; replacementOrderId: number | null };
const positive = (value: unknown) => Number.isSafeInteger(Number(value)) && Number(value) > 0;
const invalid = (): never => { throw Error("روابط متابعة جولات تعويض المرتجع غير مكتملة أو غير متطابقة"); };

/** Provenance only. The caller checks its original need and actor separately.
 * Closed ancestors still lead to active descendants; each root is projected
 * independently from fresh, bounded reads inside the caller's operation. */
export async function loadActiveCompensationCases(tx: FollowupTx, sourceItemIds: number[], options: { includeReceived?: boolean } = {}): Promise<Map<number, ActiveCompensationCase[]>> {
  const roots = Array.from(new Set(sourceItemIds));
  if (roots.some(id => !positive(id))) invalid();
  const graph = new Map<number, Node[]>(), loaded = new Set<number>();
  let frontier = roots;
  for (let depth = 0; frontier.length; depth++) {
    if (depth >= 64) invalid();
    const found = await readScopeChunks(frontier, part => readRows(tx, sql`SELECT c.id,c.purchaseOrderItemId AS sourceItemId,
        c.purchaseOrderId AS sourcePurchaseOrderId,c.parentReplacementPlanId,c.returnedQuantity,c.returnedUnit,c.closedAt,
        source.id AS sourceItemExists,sourceOrder.id AS sourceOrderExists,
        p.id AS planId,p.status AS planStatus,p.purchaseOrderId AS replacementOrderId,p.purchaseOrderItemId AS replacementItemId,
        replacement.id AS replacementItemExists,replacementOrder.id AS replacementOrderExists,
        CASE WHEN c.parentReplacementPlanId IS NULL THEN 1 ELSE EXISTS(
          SELECT 1 FROM supplier_return_replacement_plans previous
          INNER JOIN supplier_return_cases previousCase ON previousCase.id=previous.caseId AND previousCase.handoverStatus='accepted'
          INNER JOIN supplier_return_replacement_links k ON k.caseId=previous.caseId
            AND k.purchaseOrderId=previous.purchaseOrderId AND k.purchaseOrderItemId=previous.purchaseOrderItemId
          WHERE previous.id=c.parentReplacementPlanId AND previous.status='received'
            AND previous.purchaseOrderId=c.purchaseOrderId AND previous.purchaseOrderItemId=c.purchaseOrderItemId
            AND k.lotId=c.lotId AND k.receiptId=c.receiptId AND k.receiptItemId=c.receiptItemId
        ) END AS parentSourceValid
      FROM supplier_return_cases c
      LEFT JOIN purchase_order_items source ON source.id=c.purchaseOrderItemId AND source.purchaseOrderId=c.purchaseOrderId
      LEFT JOIN purchase_orders sourceOrder ON sourceOrder.id=source.purchaseOrderId
      LEFT JOIN supplier_return_replacement_plans p ON p.caseId=c.id AND p.planNumber=1
      LEFT JOIN purchase_order_items replacement ON replacement.id=p.purchaseOrderItemId AND replacement.purchaseOrderId=p.purchaseOrderId
      LEFT JOIN purchase_orders replacementOrder ON replacementOrder.id=replacement.purchaseOrderId
      WHERE c.purchaseOrderItemId IN (${sql.join(part.map(id => sql`${id}`), sql`,`)}) ORDER BY c.id FOR UPDATE`));
    const included = new Set(frontier), seenCases = new Set<number>();
    const normalized: Node[] = found.map(row => {
      if (!included.has(Number(row.sourceItemId)) || !positive(row.id) || seenCases.has(Number(row.id))
        || Number(row.sourceItemExists) !== Number(row.sourceItemId) || Number(row.sourceOrderExists) !== Number(row.sourcePurchaseOrderId)
        || (row.parentReplacementPlanId != null && Number(row.parentSourceValid) !== 1)) invalid();
      seenCases.add(Number(row.id));
      const linked = row.replacementItemId != null || row.replacementOrderId != null;
      if (linked && (!positive(row.planId) || !positive(row.replacementItemId) || !positive(row.replacementOrderId)
        || Number(row.replacementItemExists) !== Number(row.replacementItemId) || Number(row.replacementOrderExists) !== Number(row.replacementOrderId))) invalid();
      if (row.planStatus === "received" && !linked) invalid();
      return { id: Number(row.id), sourceItemId: Number(row.sourceItemId), sourcePurchaseOrderId: Number(row.sourcePurchaseOrderId),
        parentReplacementPlanId: row.parentReplacementPlanId == null ? null : Number(row.parentReplacementPlanId),
        returnedQuantity: String(row.returnedQuantity), returnedUnit: String(row.returnedUnit ?? "").trim(), closedAt: row.closedAt,
        planId: row.planId == null ? null : Number(row.planId), planStatus: row.planStatus ?? null,
        replacementItemId: row.replacementItemId == null ? null : Number(row.replacementItemId),
        replacementOrderId: row.replacementOrderId == null ? null : Number(row.replacementOrderId) };
    });
    for (const [id, nodes] of Array.from(groupReadRows(normalized, row => row.sourceItemId).entries())) graph.set(id, nodes);
    frontier.forEach(id => loaded.add(id));
    frontier = Array.from(new Set(normalized.flatMap(row => row.replacementItemId != null && !loaded.has(row.replacementItemId) ? [row.replacementItemId] : [])));
  }
  const result = new Map<number, ActiveCompensationCase[]>();
  for (const root of roots) {
    const active: ActiveCompensationCase[] = [];
    const visit = (sourceId: number, expectedParent: Node | null, path: Set<number>) => {
      if (path.has(sourceId)) invalid();
      const nextPath = new Set(path); nextPath.add(sourceId);
      for (const row of graph.get(sourceId) ?? []) {
        if (expectedParent && (row.parentReplacementPlanId !== expectedParent.planId || row.sourcePurchaseOrderId !== expectedParent.replacementOrderId)) invalid();
        if (row.closedAt == null || (options.includeReceived && row.planStatus === "received")) active.push(row);
        if (row.replacementItemId != null) visit(row.replacementItemId, row, nextPath);
      }
    };
    visit(root, null, new Set());
    if (active.length) result.set(root, active);
  }
  return result;
}

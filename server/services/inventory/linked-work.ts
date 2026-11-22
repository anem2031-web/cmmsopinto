import { sql, type SQL } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

import {
  linkedWorkMessage,
  type LinkedWork,
} from "../../../shared/inventory-linked-work";
type Port = { execute(query: SQL): Promise<any> };
async function rows(db: Port, query: SQL): Promise<any[]> {
  const result = await db.execute(query);
  if (!Array.isArray(result?.[0]))
    throw new Error("تعذر قراءة ارتباطات الأصناف");
  return result[0];
}
const ids = (values: number[]) =>
  sql.join(
    values.map(value => sql`${value}`),
    sql`,`
  );
const positive = (value: unknown) => Math.max(0, Number(value) || 0);

/** Resolve accepted replacement receipts back to their original purchase items.
 * A replacement can have a different catalog item or unit; never guess its quantity. */
async function replacementOrigins(
  db: Port,
  lotIds: number[]
): Promise<Map<number, Set<number>>> {
  const result = new Map<number, Set<number>>();
  if (!lotIds.length) return result;
  const tables = await rows(
    db,
    sql`SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('supplier_return_cases','supplier_return_replacement_plans','supplier_return_replacement_links')`
  );
  const names = new Set(tables.map(row => String(row.name).toLowerCase()));
  const required = [
    "supplier_return_cases",
    "supplier_return_replacement_plans",
    "supplier_return_replacement_links",
  ];
  if (!required.some(name => names.has(name))) return result;
  if (!required.every(name => names.has(name)))
    throw new Error("جداول روابط تعويض المورد غير مكتملة؛ يلزم مراجعتها");
  for (let offset = 0; offset < lotIds.length; offset += 500) {
    const chain = await rows(
      db,
      sql`WITH RECURSIVE provenance AS (
      SELECT link.lotId AS physicalLotId,c.purchaseOrderItemId AS sourceItemId,c.parentReplacementPlanId AS parentPlanId,c.lotId AS sourceLotId,c.receiptId AS sourceReceiptId,c.receiptItemId AS sourceReceiptItemId,1 AS depth
      FROM supplier_return_replacement_links link
      JOIN supplier_return_replacement_plans p ON p.caseId=link.caseId AND p.purchaseOrderItemId=link.purchaseOrderItemId AND p.purchaseOrderId=link.purchaseOrderId AND p.status='received'
      JOIN supplier_return_cases c ON c.id=p.caseId AND c.handoverStatus='accepted'
      JOIN inventory_lots l ON l.id=link.lotId AND l.purchaseOrderItemId=p.purchaseOrderItemId AND l.receiptId=link.receiptId AND l.receiptItemId=link.receiptItemId
      WHERE link.lotId IN (${ids(lotIds.slice(offset, offset + 500))})
      UNION ALL
      SELECT prior.physicalLotId,c.purchaseOrderItemId,c.parentReplacementPlanId,c.lotId,c.receiptId,c.receiptItemId,prior.depth+1
      FROM provenance prior JOIN supplier_return_replacement_plans p ON p.id=prior.parentPlanId AND p.purchaseOrderItemId=prior.sourceItemId AND p.status='received'
      JOIN supplier_return_cases c ON c.id=p.caseId AND c.handoverStatus='accepted'
      JOIN supplier_return_replacement_links priorLink ON priorLink.caseId=p.caseId AND priorLink.purchaseOrderItemId=p.purchaseOrderItemId AND priorLink.purchaseOrderId=p.purchaseOrderId AND priorLink.lotId=prior.sourceLotId AND priorLink.receiptId=prior.sourceReceiptId AND priorLink.receiptItemId=prior.sourceReceiptItemId
      WHERE prior.depth<64
    ) SELECT physicalLotId,sourceItemId,parentPlanId,depth FROM provenance`
    );
    for (const row of chain) {
      if (Number(row.depth) >= 64 && row.parentPlanId != null)
        throw new Error("روابط تعويض المورد تحتاج مراجعة");
      const lotId = Number(row.physicalLotId),
        sourceId = Number(row.sourceItemId);
      if (!Number.isSafeInteger(sourceId) || sourceId <= 0)
        throw new Error("مصدر تعويض المورد غير صالح");
      const sources = result.get(lotId) || new Set<number>();
      sources.add(sourceId);
      result.set(lotId, sources);
    }
  }
  return result;
}

/** Project recorded purchase links against physical balances without changing stock. */
export async function loadLinkedWork(
  db: Port,
  catalogItemIds: number[]
): Promise<Map<number, LinkedWork[]>> {
  const out = new Map<number, LinkedWork[]>();
  const unique = Array.from(
    new Set(
      catalogItemIds
        .map(Number)
        .filter(id => Number.isSafeInteger(id) && id > 0)
    )
  );
  for (let offset = 0; offset < unique.length; offset += 500) {
    const chunk = unique.slice(offset, offset + 500);
    const lots = await rows(
      db,
      sql`SELECT l.id AS lotId,l.purchaseOrderItemId AS purchaseItemId,l.catalogItemId,
      l.purchaseUnit,l.issueUnit,l.conversionFactor,b.quantity AS balanceQuantity,i.warehouseId,
      p.ticketId,t.ticketNumber,poi.quantity AS purchaseQuantity,poi.deliveredQuantity,poi.status AS purchaseItemStatus,poi.unit AS purchaseOrderUnit
      FROM inventory_lots l JOIN inventory_lot_balances b ON b.lotId=l.id
      JOIN inventory i ON i.id=b.inventoryId AND i.linkedItemId=l.catalogItemId
      JOIN purchase_order_items poi ON poi.id=l.purchaseOrderItemId
      JOIN purchase_orders p ON p.id=poi.purchaseOrderId
      LEFT JOIN tickets t ON t.id=p.ticketId
      WHERE l.catalogItemId IN (${ids(chunk)}) AND b.quantity>0 AND i.quantity>0
        AND l.sourceType='receipt' AND l.purchaseOrderItemId IS NOT NULL
      ORDER BY l.purchaseOrderItemId,l.id,i.warehouseId`
    );
    if (!lots.length) continue;
    const physicalIds = Array.from(
      new Set<number>(lots.map(row => Number(row.purchaseItemId)))
    );
    const origins = await replacementOrigins(
      db,
      Array.from(new Set<number>(lots.map(row => Number(row.lotId))))
    );
    const purchaseIds = Array.from(
      new Set<number>(
        physicalIds.concat(
          Array.from(origins.values()).flatMap(values => Array.from(values))
        )
      )
    );
    const budgets = new Map<string, number>();
    const team: any[] = [],
      pmv2: any[] = [];
    for (let poOffset = 0; poOffset < purchaseIds.length; poOffset += 500) {
      const purchaseChunk = purchaseIds.slice(poOffset, poOffset + 500);
      team.push(
        ...(await rows(
          db,
          sql`SELECT s.sourceId AS purchaseItemId,s.id AS linkId,s.needId,s.linkedQuantity,
        s.status AS linkStatus,n.requestedQuantity,n.unitSnapshot,a.ticketNumber,a.stage,a.materialRound,n.materialRound AS needRound,
        COALESCE((SELECT SUM(d.issuedQuantity) FROM ticket_team_delivery_links d WHERE d.needId=n.id),0) AS issuedQuantity,
        EXISTS(SELECT 1 FROM ticket_team_delivery_links d JOIN delivery_documents doc ON doc.id=d.deliveryDocumentId WHERE d.needId=n.id AND TRIM(COALESCE(doc.unit,''))<>TRIM(COALESCE(n.unitSnapshot,''))) AS issuedUnitMismatch
        FROM ticket_team_supply_links s JOIN ticket_team_material_needs n ON n.id=s.needId
        JOIN ticket_team_assignments a ON a.id=n.assignmentId
        WHERE s.sourceKind='purchase' AND s.sourceId IN (${ids(purchaseChunk)}) ORDER BY s.id`
        ))
      );
      pmv2.push(
        ...(await rows(
          db,
          sql`SELECT k.purchaseOrderItemId AS purchaseItemId,k.id AS linkId,k.materialRequestItemId AS needId,
        k.linkedQuantity,n.requestedQuantity,n.issuedToTeamQuantity AS issuedQuantity,n.unitSnapshot,n.status AS needStatus,t.taskNumber
        FROM pmv2_material_purchase_links k JOIN pmv2_material_request_items n ON n.id=k.materialRequestItemId
        JOIN pmv2_material_requests r ON r.id=n.requestId JOIN pmv2_task_items ti ON ti.id=r.taskItemId
        JOIN pmv2_tasks t ON t.id=ti.taskId WHERE k.purchaseOrderItemId IN (${ids(purchaseChunk)}) ORDER BY k.id`
        ))
      );
    }
    for (const purchaseId of physicalIds) {
      const physical = lots
        .filter(row => Number(row.purchaseItemId) === purchaseId)
        .map(row => ({ ...row, left: positive(row.balanceQuantity) }));
      const originIds = new Set<number>([purchaseId]);
      for (const lot of physical)
        for (const origin of Array.from(origins.get(Number(lot.lotId)) || []))
          originIds.add(origin);
      const teamLinks = team.filter(row =>
        originIds.has(Number(row.purchaseItemId))
      );
      const pmv2Links = pmv2.filter(row =>
        originIds.has(Number(row.purchaseItemId))
      );
      const sources: Array<{
        kind: "ticket" | "pmv2";
        reference: string;
        need: string;
        unit: string;
        linked: number;
        pending: number;
        sourceId: number;
        uncertain: boolean;
      }> = [];
      for (const row of teamLinks) {
        if (
          (row.linkStatus === "cancelled" &&
            Number(row.purchaseItemId) === purchaseId) ||
          row.stage !== "waiting_material" ||
          Number(row.materialRound) !== Number(row.needRound) ||
          !row.ticketNumber
        )
          continue;
        sources.push({
          kind: "ticket",
          reference: String(row.ticketNumber),
          need: `ticket:${row.needId}`,
          sourceId: Number(row.purchaseItemId),
          uncertain:
            Number(row.issuedUnitMismatch) === 1 ||
            Number(row.purchaseItemId) !== purchaseId,
          unit: String(row.unitSnapshot || ""),
          linked: positive(row.linkedQuantity),
          pending:
            (Number(row.issuedUnitMismatch) === 1 ||
              Number(row.purchaseItemId) !== purchaseId) &&
            positive(row.issuedQuantity) > 0
              ? positive(row.requestedQuantity)
              : Math.max(
                  0,
                  positive(row.requestedQuantity) - positive(row.issuedQuantity)
                ),
        });
      }
      for (const row of pmv2Links) {
        if (
          ["issued_to_team", "consumed", "cancelled"].includes(
            String(row.needStatus)
          ) ||
          !row.taskNumber
        )
          continue;
        sources.push({
          kind: "pmv2",
          reference: String(row.taskNumber),
          need: `pmv2:${row.needId}`,
          sourceId: Number(row.purchaseItemId),
          uncertain: Number(row.purchaseItemId) !== purchaseId,
          unit: String(row.unitSnapshot || ""),
          linked: positive(row.linkedQuantity),
          pending: Math.max(
            0,
            positive(row.requestedQuantity) - positive(row.issuedQuantity)
          ),
        });
      }
      if (!teamLinks.length && !pmv2Links.length && physical[0]?.ticketNumber &&
        !["delivered_to_requester", "cancelled", "rejected", "purchase_cancelled"].includes(String(physical[0].purchaseItemStatus))) {
        const p = physical[0];
        sources.push({
          kind: "ticket",
          reference: String(p.ticketNumber),
          need: `purchase:${purchaseId}`,
          sourceId: purchaseId,
          uncertain: false,
          unit: String(p.purchaseOrderUnit || ""),
          linked: positive(p.purchaseQuantity),
          pending: Math.max(
            0,
            positive(p.purchaseQuantity) - positive(p.deliveredQuantity)
          ),
        });
      }
      // A partially received PO shared by multiple needs has no recorded
      // allocation to each need. Show every reference without inventing a split.
      const activeSources = sources.filter(
        source =>
          Math.min(source.linked, budgets.get(source.need) ?? source.pending) >
          0
      );
      const commonUnit = String(physical[0]?.issueUnit || "").trim();
      const ambiguous =
        activeSources.length > 1 &&
        (!commonUnit ||
          activeSources.some(
            source => source.uncertain || source.unit.trim() !== commonUnit
          ) ||
          physical.some(
            lot => String(lot.issueUnit || "").trim() !== commonUnit
          ) ||
          activeSources.reduce(
            (sum, source) =>
              sum +
              Math.min(
                source.linked,
                budgets.get(source.need) ?? source.pending
              ),
            0
          ) >
            physical.reduce((sum, lot) => sum + lot.left, 0) + 0.0005);
      if (ambiguous) {
        for (const source of activeSources)
          for (const lot of physical) {
            if (
              source.sourceId !== purchaseId &&
              !origins.get(Number(lot.lotId))?.has(source.sourceId)
            )
              continue;
            const key = Number(lot.catalogItemId),
              list = out.get(key) || [];
            if (
              !list.some(
                x =>
                  x.kind === source.kind &&
                  x.reference === source.reference &&
                  x.warehouseId === Number(lot.warehouseId)
              )
            )
              list.push({
                kind: source.kind,
                reference: source.reference,
                quantity: null,
                unit: commonUnit || source.unit,
                warehouseId: Number(lot.warehouseId),
              });
            out.set(key, list);
          }
        continue;
      }
      for (const source of sources) {
        const budget = budgets.get(source.need) ?? source.pending;
        let left = Math.min(source.linked, budget);
        if (left <= 0) continue;
        for (const lot of physical) {
          if (
            left <= 0 ||
            lot.left <= 0 ||
            (source.sourceId !== purchaseId &&
              !origins.get(Number(lot.lotId))?.has(source.sourceId))
          )
            continue;
          const issueUnit = String(lot.issueUnit || "").trim();
          const sourceUnit = source.unit.trim();
          const factor = source.uncertain
            ? null
            : sourceUnit && sourceUnit === issueUnit
              ? 1
              : sourceUnit &&
                  sourceUnit === String(lot.purchaseUnit || "").trim() &&
                  positive(lot.conversionFactor) > 0
                ? positive(lot.conversionFactor)
                : null;
          const actual =
            factor == null ? null : Math.min(lot.left, left * factor);
          const consumed = factor == null ? 0 : actual! / factor;
          const entry: LinkedWork = {
            kind: source.kind,
            reference: source.reference,
            quantity: actual == null ? null : Math.round(actual * 1000) / 1000,
            unit: issueUnit || sourceUnit,
            warehouseId: Number(lot.warehouseId),
          };
          const key = Number(lot.catalogItemId);
          const list = out.get(key) || [];
          const previous = list.find(
            x =>
              x.kind === entry.kind &&
              x.reference === entry.reference &&
              x.unit === entry.unit &&
              x.warehouseId === entry.warehouseId
          );
          if (previous)
            previous.quantity =
              previous.quantity == null || entry.quantity == null
                ? null
                : Math.round((previous.quantity + entry.quantity) * 1000) /
                  1000;
          else list.push(entry);
          out.set(key, list);
          left = Math.max(0, left - consumed);
          budgets.set(
            source.need,
            Math.max(0, (budgets.get(source.need) ?? source.pending) - consumed)
          );
          lot.left = factor == null ? 0 : Math.max(0, lot.left - actual!);
        }
      }
    }
  }
  return out;
}
export async function assertNoLinkedWork(db: Port, catalogItemIds: number[]) {
  const found = await loadLinkedWork(db, catalogItemIds);
  for (const id of catalogItemIds) {
    const links = found.get(Number(id));
    if (links?.length)
      throw new TRPCError({
        code: "CONFLICT",
        message: linkedWorkMessage(links),
      });
  }
}

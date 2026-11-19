import { sql } from "drizzle-orm";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, adminOwnerProcedure } from "./_shared/procedures";
import { createPurchaseOrderReadScope } from "../_core/authz/guard";
import { readScopeChunks } from "../_core/authz/read-batch";
import * as db from "../_core/db";

async function rows(database: any, query: any): Promise<any[]> {
  const result = await database.execute(query);
  if (!Array.isArray(result?.[0])) throw new Error("تعذر قراءة بيانات وحدة الإنجاز");
  return result[0];
}

function actor(ctx: any) {
  const current = ctx.authenticatedUser ?? ctx.user;
  if (!current || !["owner", "admin"].includes(current.role) || Number(current.isActive) !== 1)
    throw new TRPCError({ code: "FORBIDDEN", message: "وحدة الإنجاز متاحة للمالك والأدمن النشطين فقط" });
  return current;
}

async function connection() {
  const database = await db.getDb();
  if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "تعذر الاتصال بقاعدة البيانات" });
  return database;
}

const selection = sql`SELECT i.id,i.purchaseOrderId,i.itemName,i.quantity,i.unit,i.status,i.delegateId,
  i.reviewRole,i.reviewedAt,i.delegateAssignedAt,i.purchasedAt,i.receivedAt,i.deliveredAt,
  i.delegateChangeReason,i.itemRevisionNote,i.purchaseCancelReason,i.managementRejectionReason,
  p.poNumber,p.status AS orderStatus,p.submittedAt,p.requestedById,p.ticketId,
  t.ticketNumber,requester.name AS requesterName,delegate.name AS delegateName,delegate.role AS delegateRole,
  COALESCE(reviewer.name,CASE WHEN i.reviewRole IS NULL THEN orderReviewer.name ELSE NULL END) AS reviewerName,
  COALESCE(i.reviewedAt,CASE WHEN i.reviewRole IS NULL THEN p.reviewedAt ELSE NULL END) AS effectiveReviewedAt,
  b.status AS batchStatus,b.submittedAt AS pricingSubmittedAt,b.accountingApprovedAt,b.managementApprovedAt
  FROM purchase_order_items i INNER JOIN purchase_orders p ON p.id=i.purchaseOrderId
  LEFT JOIN tickets t ON t.id=p.ticketId LEFT JOIN users requester ON requester.id=p.requestedById
  LEFT JOIN users delegate ON delegate.id=i.delegateId LEFT JOIN users reviewer ON reviewer.id=i.reviewedById
  LEFT JOIN users orderReviewer ON orderReviewer.id=p.reviewedById
  LEFT JOIN po_pricing_batches b ON b.id=i.batchId`;

async function findLinkedTicketEvidence(database: any, ids: number[]) {
  if (!ids.length) return { available: true, byItem: new Map<number, any[]>() };
  const tables = await rows(database, sql`SELECT TABLE_NAME AS name FROM information_schema.TABLES
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('ticket_team_supply_links','ticket_team_material_needs',
      'ticket_team_assignments','ticket_team_delivery_links','inventory_lots','inventory_transactions')`);
  if (new Set(tables.map(row => String(row.name).toLowerCase())).size !== 6)
    return { available: false, byItem: new Map<number, any[]>() };
  const linked = await readScopeChunks(ids, chunk => rows(database, sql`SELECT s.sourceId AS itemId,t.ticketNumber,
    d.id AS deliveryId,d.createdAt AS issuedAt,d.issuedQuantity,d.deliveryNumber,
    recipient.name AS recipientName,performer.name AS performerName
    FROM ticket_team_supply_links s JOIN ticket_team_material_needs n ON n.id=s.needId
    JOIN ticket_team_assignments a ON a.id=n.assignmentId JOIN tickets t ON t.id=a.ticketId
    LEFT JOIN ticket_team_delivery_links d ON d.needId=n.id AND d.lotId IN
      (SELECT l.id FROM inventory_lots l WHERE l.purchaseOrderItemId=s.sourceId)
    LEFT JOIN inventory_transactions movement ON movement.id=d.inventoryTransactionId
    LEFT JOIN users recipient ON recipient.id=d.receivedById LEFT JOIN users performer ON performer.id=movement.performedById
    WHERE s.sourceKind='purchase' AND s.status<>'cancelled' AND s.sourceId IN (${sql.join(chunk.map(id => sql`${id}`), sql`,`)})
    ORDER BY s.sourceId,d.createdAt,d.id`));
  const byItem = new Map<number, any[]>();
  for (const row of linked) {
    const id = Number(row.itemId), existing = byItem.get(id) ?? [];
    existing.push(row); byItem.set(id, existing);
  }
  return { available: true, byItem };
}

function attachTickets(item: any, evidence: { available: boolean; byItem: Map<number, any[]> }) {
  const links = evidence.byItem.get(Number(item.id)) ?? [];
  return { ...item,
    ticketNumbers: Array.from(new Set([item.ticketNumber, ...links.map(link => link.ticketNumber)].filter(Boolean))),
    ticketEvidenceAvailable: evidence.available,
    issues: links.filter(link => link.deliveryId != null).map(link => ({
      id: Number(link.deliveryId), date: link.issuedAt, quantity: link.issuedQuantity,
      documentNumber: link.deliveryNumber, recipientName: link.recipientName, actorName: link.performerName,
      ticketNumber: link.ticketNumber,
    })),
  };
}

async function stageStarts(database: any, items: any[]) {
  const ids = items.filter(item => ["pending_review", "pending"].includes(item.status)).map(item => Number(item.id));
  const found = await readScopeChunks(ids, chunk => rows(database, sql`SELECT purchaseOrderItemId,
    MAX(CASE WHEN newStatus='pending_review' THEN createdAt END) AS reviewStartedAt,
    MAX(CASE WHEN newStatus='pending' AND eventType IN ('delegate_changed','review_decision','status_changed') THEN createdAt END) AS delegateWaitStartedAt
    FROM purchase_order_item_history WHERE purchaseOrderItemId IN (${sql.join(chunk.map(id => sql`${id}`), sql`,`)}) GROUP BY purchaseOrderItemId`));
  return new Map(found.map(row => [Number(row.purchaseOrderItemId), row]));
}

export const achievementRouter = router({
  purchaseItems: adminOwnerProcedure.input(z.object({
    search: z.string().trim().max(150).default(""),
    beforeId: z.number().int().positive().optional(),
  })).query(async ({ ctx, input }) => {
    const user = actor(ctx), database = await connection();
    const term = `%${input.search}%`;
    const raw = await rows(database, sql`${selection} WHERE p.status<>'draft'
      ${input.beforeId ? sql`AND i.id<${input.beforeId}` : sql``}
      ${input.search ? sql`AND (i.itemName LIKE ${term} OR p.poNumber LIKE ${term} OR t.ticketNumber LIKE ${term})` : sql``}
      ORDER BY i.id DESC LIMIT 51`);
    const page = raw.slice(0, 50);
    const parents = await db.getPurchaseOrdersByIds(page.map(item => Number(item.purchaseOrderId)), database);
    const scope = await createPurchaseOrderReadScope(user, parents);
    const parentById = new Map(parents.map(parent => [Number(parent.id), parent]));
    const visible = page.filter(item => {
      const parent = parentById.get(Number(item.purchaseOrderId));
      return !!parent && scope.filterItems(parent, [item]).length === 1;
    });
    const [evidence, starts] = await Promise.all([findLinkedTicketEvidence(database, visible.map(item => Number(item.id))), stageStarts(database, visible)]);
    return { items: visible.map(item => attachTickets({ ...item, reviewStartedAt: starts.get(Number(item.id))?.reviewStartedAt ?? null, delegateWaitStartedAt: starts.get(Number(item.id))?.delegateWaitStartedAt ?? null }, evidence)), nextId: raw.length > 50 ? Number(page[page.length - 1].id) : null };
  }),
  purchaseItem: adminOwnerProcedure.input(z.object({ id: z.number().int().positive() })).query(async ({ ctx, input }) => {
    const user = actor(ctx), database = await connection();
    const [item] = await rows(database, sql`${selection} WHERE i.id=${input.id} LIMIT 1`);
    if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "الصنف غير موجود" });
    const parent = await db.getPurchaseOrderById(Number(item.purchaseOrderId));
    if (!parent) throw new TRPCError({ code: "NOT_FOUND", message: "طلب الشراء غير موجود" });
    const scope = await createPurchaseOrderReadScope(user, [parent]);
    scope.assert(parent);
    if (!scope.filterItems(parent, [item]).length) throw new TRPCError({ code: "FORBIDDEN" });
    const [history, evidence, starts] = await Promise.all([db.getPOItemTimeline(input.id), findLinkedTicketEvidence(database, [input.id]), stageStarts(database, [item])]);
    if (!history) throw new TRPCError({ code: "NOT_FOUND", message: "تعذر تحميل سجل الصنف" });
    const assignedIds = Array.from(new Set(history.events.flatMap((event: any) => [event.previousDelegateId, event.newDelegateId])
      .map(Number).filter((id: number) => Number.isSafeInteger(id) && id > 0))) as number[];
    const people = await readScopeChunks(assignedIds, ids => rows(database, sql`SELECT id,name FROM users WHERE id IN (${sql.join(ids.map(id => sql`${id}`), sql`,`)})`));
    const names = new Map(people.map(person => [Number(person.id), person.name]));
    return { item: attachTickets({ ...item, reviewStartedAt: starts.get(Number(item.id))?.reviewStartedAt ?? null, delegateWaitStartedAt: starts.get(Number(item.id))?.delegateWaitStartedAt ?? null }, evidence), events: history.events.map((event: any) => ({ ...event,
      previousDelegateName: names.get(Number(event.previousDelegateId)) ?? null,
      newDelegateName: names.get(Number(event.newDelegateId)) ?? null,
    })) };
  }),
});

import { asc, inArray, sql } from "drizzle-orm";
import { purchaseOrders, purchaseOrderItems, purchasePackageSubmissions, poPricingBatches } from "../../../drizzle/schema";
import { readScopeChunks, groupReadRows } from "../authz/read-batch";
import { getDb } from "./client";

async function connection(database?: any) {
  const db = database ?? await getDb();
  if (!db) throw new Error("تعذر تحميل نطاق بيانات الشراء");
  return db;
}

export async function getPurchaseOrdersByIds(ids: number[], database?: any): Promise<any[]> {
  if (!ids.length) return [];
  const db = await connection(database);
  return readScopeChunks(ids, selected => db.select().from(purchaseOrders).where(inArray(purchaseOrders.id, selected)));
}

export async function getPurchaseOrdersForPackages(ids: number[], database?: any): Promise<any[]> {
  if (!ids.length) return [];
  const db = await connection(database);
  return readScopeChunks(ids, selected => db.select().from(purchaseOrders)
    .where(inArray(purchaseOrders.packageId, selected)).orderBy(asc(purchaseOrders.id)));
}

/** Full getPOItems shape and per-order ID ordering, not the small actionable DTO. */
export async function getFullPOItemsForPOs(ids: number[], database?: any): Promise<any[]> {
  if (!ids.length) return [];
  const db = await connection(database);
  return readScopeChunks(ids, selected => db.select().from(purchaseOrderItems)
    .where(inArray(purchaseOrderItems.purchaseOrderId, selected)).orderBy(asc(purchaseOrderItems.id)));
}

/** Slim assignment metadata for one authenticated RPC; never a permission cache. */
export async function getPurchaseItemReviewScopeRows(
  actor: { id: number; role: string }, orderIds?: number[], database?: any,
): Promise<any[]> {
  if (actor.role !== "senior_management" || orderIds?.length === 0) return [];
  const db = await connection(database);
  const read = async (ids?: number[]) => {
    const result = await db.execute(sql`SELECT id,purchaseOrderId,reviewRole,reviewedById,reviewedAt,status
      FROM purchase_order_items WHERE reviewRole=${actor.role}
      AND (status='pending_review' OR reviewedById=${actor.id})
      ${ids ? sql`AND purchaseOrderId IN (${sql.join(ids.map(id => sql`${id}`), sql`,`)})` : sql``}`);
    return (result?.[0] ?? []) as any[];
  };
  return orderIds ? readScopeChunks(orderIds, read) : read();
}

/** Both levels are batched. Every submission includes ALL its batches. */
export async function getPackageSubmissionsWithBatchesForPackages(ids: number[], database?: any): Promise<any[]> {
  if (!ids.length) return [];
  const db = await connection(database);
  const submissions: any[] = await readScopeChunks(ids, selected => db.select().from(purchasePackageSubmissions)
    .where(inArray(purchasePackageSubmissions.purchasePackageId, selected)).orderBy(asc(purchasePackageSubmissions.subNumber)));
  const batches: any[] = await readScopeChunks(submissions.map(row => Number(row.id)), selected => db.select().from(poPricingBatches)
    .where(inArray(poPricingBatches.purchasePackageSubmissionId, selected)).orderBy(asc(poPricingBatches.id)));
  const grouped = groupReadRows(batches, row => Number(row.purchasePackageSubmissionId));
  return submissions.map(row => ({ ...row, batches: grouped.get(Number(row.id)) ?? [] }));
}

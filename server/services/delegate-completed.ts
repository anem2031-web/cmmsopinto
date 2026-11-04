import { sql, type SQL } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { isDelegateRole } from "../../shared/roles";
import { assertPOVisible, assertItemAssignedToDelegate } from "../_core/authz/engine";
import { delegateCompletedInput, type DelegateCompletedInput, type DelegateCompletedItem } from "../../shared/delegate-completed";
import { documentSearchPattern } from "../../shared/document-list";

interface ReadDatabase { execute(query: SQL): Promise<any>; }
async function read(db: ReadDatabase, query: SQL): Promise<any[]> {
  const result = await db.execute(query);
  if (!Array.isArray(result?.[0])) throw new Error("Invalid completed items response");
  return result[0];
}
export async function listDelegateCompleted(actor: { id: number; role: string }, raw: DelegateCompletedInput, database?: ReadDatabase) {
  if (!isDelegateRole(actor.role)) throw new TRPCError({ code: "FORBIDDEN" });
  const input = delegateCompletedInput.parse(raw);
  const db = database ?? await (await import("../_core/db/client")).getDb();
  if (!db) throw new Error("Database unavailable");
  const [identity] = await read(db, sql`SELECT id,role,isActive FROM users WHERE id=${actor.id}`);
  if (!identity || identity.role !== actor.role || !isDelegateRole(identity.role) || Number(identity.isActive) !== 1) throw new TRPCError({ code: "FORBIDDEN" });
  const pattern = documentSearchPattern(input.search);
  // No item fan-out: EXISTS/subquery handle external jobs without duplicating rows.
  const completed = sql`(i.status IN ('delivered_to_warehouse','delivered_to_requester') OR
    (i.status='purchased' AND EXISTS (SELECT 1 FROM external_maintenance_jobs e WHERE e.purchaseOrderId=p.id
      AND (e.warehouseReceivedAt IS NOT NULL OR e.status IN ('waiting_technician_handover','delivered_for_reinstall','reinstall_in_progress','ready_for_closure','closed')))))`;
  const scope = sql`i.delegateId=${actor.id} AND ${completed}
    ${input.search ? sql`AND (i.itemName LIKE ${pattern} ESCAPE '=' OR p.poNumber LIKE ${pattern} ESCAPE '=')` : sql``}`;
  const [count] = await read(db, sql`SELECT COUNT(*) AS total FROM purchase_order_items i INNER JOIN purchase_orders p ON p.id=i.purchaseOrderId WHERE ${scope}`);
  // Filtering and pagination run in SQL, before any per-record permission decisions.
  const page = await read(db, sql`SELECT i.id,i.purchaseOrderId,i.delegateId,i.itemName,i.quantity,i.unit,
    COALESCE(i.receivedAt,(SELECT MAX(e.warehouseReceivedAt) FROM external_maintenance_jobs e WHERE e.purchaseOrderId=p.id)) AS receivedAt,
    p.id AS parentId,p.poNumber,p.status AS parentStatus,p.requestedById
    FROM purchase_order_items i INNER JOIN purchase_orders p ON p.id=i.purchaseOrderId
    WHERE ${scope} ORDER BY receivedAt DESC,i.id DESC LIMIT ${input.pageSize} OFFSET ${(input.page-1)*input.pageSize}`);
  // Trusted, current-RPC joined rows provide the existing central guard's assignment
  // context. Do not load all of a delegate's historical items or query per row.
  const parentIds = Array.from(new Set<number>(page.filter(r => Number(r.delegateId) === actor.id && Number(r.parentId) === Number(r.purchaseOrderId)).map(r => Number(r.parentId))));
  const context = { role: actor.role, userId: actor.id, delegateAssignedPoIds: parentIds };
  const items: DelegateCompletedItem[] = page.map(row => {
    if (!row.parentId || Number(row.parentId) !== Number(row.purchaseOrderId)) throw new TRPCError({ code: "FORBIDDEN" });
    assertItemAssignedToDelegate(context, { delegateId: Number(row.delegateId) });
    assertPOVisible(context, { id: Number(row.parentId), status: row.parentStatus, requestedById: row.requestedById });
    return { id: Number(row.id), purchaseOrderId: Number(row.purchaseOrderId), poNumber: row.poNumber,
      itemName: row.itemName, quantity: Number(row.quantity), unit: row.unit, receivedAt: row.receivedAt };
  });
  return { items, total: Number(count?.total ?? 0), page: input.page, pageSize: input.pageSize };
}

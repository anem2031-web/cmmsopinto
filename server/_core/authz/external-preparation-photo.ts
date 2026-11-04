import { sql } from "drizzle-orm";

/** Same item-level eligibility as the warehouse's waiting-preparation list. */
export async function isWaitingExternalWarehousePreparation(ticketId: number): Promise<boolean> {
  const { getDb } = await import("../db/client");
  const db = await getDb();
  if (!db) throw new Error("Database unavailable while checking external preparation photo");
  const [rows]: any = await db.execute(sql`
    SELECT item.id FROM ticket_items item
    INNER JOIN tickets ticket ON ticket.id = item.ticketId
    LEFT JOIN external_maintenance_jobs job ON job.ticketItemId = item.id
    WHERE item.ticketId = ${ticketId}
      AND item.maintenancePath = 'C' AND item.status = 'work_approved'
      AND (job.id IS NULL OR (job.purchaseOrderId IS NULL AND job.gateExitApprovedAt IS NULL AND (
        job.status='waiting_warehouse_preparation' OR (job.status='waiting_gate_exit' AND (
          job.purchaseTitle IS NULL OR TRIM(job.purchaseTitle)='' OR job.delegateReceiptStatus IS NULL
          OR job.delegateReceiptStatus<>'accepted' OR job.preparationRevision<=0 OR job.delegateId IS NULL OR job.delegateId<=0
          OR job.delegateReceiptById IS NULL OR job.delegateReceiptById<>job.delegateId OR job.delegateReceiptAt IS NULL
          OR job.warehousePreparedAt IS NULL OR job.delegateReceiptAt<job.warehousePreparedAt
        ))
      )))
    LIMIT 1
  `);
  if (!Array.isArray(rows)) throw new Error("Invalid external preparation photo scope response");
  return rows.length > 0;
}

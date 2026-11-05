import { TRPCError } from "@trpc/server";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { isDelegateRole } from "../../shared/delegate-role";

const optionalText = (max: number) => z.string().trim().max(max).optional();
export const externalWorkshopInput = z.object({
  workshopName: z.string().trim().min(1, "اسم الورشة مطلوب").max(300),
  workshopPhone: z.string().trim().min(1, "رقم هاتف الورشة مطلوب").max(50),
  expectedReturnDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "موعد العودة المتوقع مطلوب")
    .refine(value => { const parsed = new Date(`${value}T00:00:00Z`); return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value; }, "اختر تاريخ عودة صحيحًا"),
  workshopLocationUrl: optionalText(2048).refine(value => {
    if (!value) return true;
    try { return ["http:", "https:"].includes(new URL(value).protocol); } catch { return false; }
  }, "رابط موقع الورشة يجب أن يكون http أو https"),
  workshopNotes: optionalText(4000),
}).strict();
export type ExternalWorkshopInput = z.infer<typeof externalWorkshopInput>;

export function externalWorkshopFields(job: any) {
  if (!job) return {};
  return {
    externalWorkshopRequired: true,
    externalWorkshop: {
      workshopName: job.workshopName || "", workshopPhone: job.workshopPhone || "",
      expectedReturnDate: job.expectedReturnDate || "", workshopLocationUrl: job.workshopLocationUrl || "",
      workshopNotes: job.workshopNotes || "",
    },
  };
}

/** A visible PO item does not grant workshop details for a mismatched job. */
export function externalWorkshopForPurchaseItem(item: any, context: any) {
  const { po, ticket, ticketItem, externalJob: job, externalItemCount } = context || {};
  const sourceItemId = job?.ticketItemId == null ? null : Number(job.ticketItemId);
  if (!job || !po || !ticket || Number(item.purchaseOrderId) !== Number(po.id) || Number(job.purchaseOrderId) !== Number(po.id)
    || Number(job.ticketId) !== Number(ticket.id) || Number(po.ticketId) !== Number(ticket.id) || Number(externalItemCount) !== 1
    || !Number.isSafeInteger(Number(job.delegateId)) || Number(job.delegateId) <= 0 || Number(item.delegateId) !== Number(job.delegateId)
    || sourceItemId !== (po.ticketItemId == null ? null : Number(po.ticketItemId))) return {};
  if (sourceItemId == null ? ticket.maintenancePath !== "C"
    : !ticketItem || Number(ticketItem.id) !== sourceItemId || Number(ticketItem.ticketId) !== Number(ticket.id) || ticketItem.maintenancePath !== "C") return {};
  return externalWorkshopFields(job);
}

type Actor = { id: number; role: string; isActive?: number | boolean | null };
type Database = { execute(statement: any): Promise<any> };
type Current = { po: any; item: any; actor: any };
type PricingPort<T> = {
  database: Database;
  transaction(work: (tx: any) => Promise<T>): Promise<T>;
  existingTx?: any;
  actor: Actor;
  purchaseOrderId: number;
  itemId: number;
  externalWorkshop?: unknown;
  creatorResubmission?: boolean;
  authorize?(current: Current): Promise<void> | void;
  write(tx?: any, current?: Current): Promise<T>;
};
async function read(database: Database, statement: any): Promise<any[]> {
  const [result] = await database.execute(statement);
  if (!Array.isArray(result)) throw Error("Invalid external workshop pricing read response");
  return result;
}
const denied = () => new TRPCError({ code: "FORBIDDEN", message: "لا يمكنك تسعير مهمة الصيانة الخارجية المسندة لمستخدم آخر" });
const conflict = () => new TRPCError({ code: "CONFLICT", message: "تغيّر مصدر الصيانة الخارجية أو مرحلتها؛ حدّث الصفحة" });

/** The ordinary writer is unchanged. External jobs are found from the stored
 * relation, not a client flag, and their quote and workshop commit together. */
export async function withExternalWorkshopPricing<T>(port: PricingPort<T>): Promise<T> {
  const observed = await read(port.database, sql`SELECT id FROM external_maintenance_jobs WHERE purchaseOrderId=${port.purchaseOrderId}`);
  if (observed.length === 0) {
    const [source] = await read(port.database, sql`SELECT COALESCE(ti.maintenancePath,t.maintenancePath) AS maintenancePath
      FROM purchase_orders p LEFT JOIN tickets t ON t.id=p.ticketId LEFT JOIN ticket_items ti ON ti.id=p.ticketItemId WHERE p.id=${port.purchaseOrderId}`);
    if (source?.maintenancePath === "C") throw conflict();
    if (port.externalWorkshop !== undefined) throw new TRPCError({ code: "BAD_REQUEST", message: "بيانات الورشة تخص طلب الصيانة الخارجية فقط" });
    return port.write(port.existingTx);
  }
  if (observed.length !== 1) throw conflict();
  const parsed = externalWorkshopInput.safeParse(port.externalWorkshop);
  if (!parsed.success) throw new TRPCError({ code: "BAD_REQUEST", message: parsed.error.issues.map(issue => issue.message).join("؛ ") });
  const values = parsed.data;
  const apply = async (tx: Database): Promise<T> => {
    const [po] = await read(tx, sql`SELECT * FROM purchase_orders WHERE id=${port.purchaseOrderId} FOR UPDATE`);
    const items = await read(tx, sql`SELECT * FROM purchase_order_items WHERE purchaseOrderId=${port.purchaseOrderId} ORDER BY id FOR UPDATE`);
    const [actor] = await read(tx, sql`SELECT id,role,isActive FROM users WHERE id=${port.actor.id} FOR UPDATE`);
    const jobs = await read(tx, sql`SELECT * FROM external_maintenance_jobs WHERE purchaseOrderId=${port.purchaseOrderId} FOR UPDATE`);
    const job = jobs[0], item = items.find(row => Number(row.id) === port.itemId);
    if (!actor || actor.role !== port.actor.role || Number(actor.isActive) !== 1) throw denied();
    if (!po || !item || Number(item.purchaseOrderId) !== Number(po.id) || items.length !== 1 || jobs.length !== 1
      || Number(job.id) !== Number(observed[0].id) || Number(job.purchaseOrderId) !== Number(po.id)
      || !Number.isSafeInteger(Number(job.ticketId)) || Number(job.ticketId) <= 0 || Number(po.ticketId) !== Number(job.ticketId)
      || !Number.isSafeInteger(Number(job.delegateId)) || Number(job.delegateId) <= 0 || Number(item.delegateId) !== Number(job.delegateId)
      || (po.ticketItemId == null ? null : Number(po.ticketItemId)) !== (job.ticketItemId == null ? null : Number(job.ticketItemId))
      || job.status !== "purchase_cycle" || !job.gateExitApprovedAt || job.gateEntryApprovedAt || job.warehouseReceivedAt
      || ["draft", "closed", "rejected", "revision_needed"].includes(po.status)
      || item.delegateChangeRequestedAt || !["pending", "estimated", ...(port.creatorResubmission ? ["needs_item_revision", "purchase_cancelled"] : [])].includes(item.status)) throw conflict();
    if (isDelegateRole(actor.role)) {
      if (Number(job.delegateId) !== actor.id || Number(item.delegateId) !== actor.id) throw denied();
    } else if (!["owner", "admin"].includes(actor.role) && !(port.creatorResubmission && Number(po.requestedById) === actor.id)) throw denied();
    const [ticket] = await read(tx, sql`SELECT id,maintenancePath FROM tickets WHERE id=${job.ticketId} FOR UPDATE`);
    const ticketItems = job.ticketItemId == null ? [] : await read(tx, sql`SELECT id,ticketId,maintenancePath FROM ticket_items WHERE id=${job.ticketItemId} FOR UPDATE`);
    if (!ticket || (job.ticketItemId == null ? ticket.maintenancePath !== "C" : ticketItems.length !== 1 || Number(ticketItems[0].ticketId) !== Number(ticket.id) || ticketItems[0].maintenancePath !== "C")) throw conflict();
    await port.authorize?.({ po, item, actor });
    const result = await port.write(tx, { po, item, actor });
    await tx.execute(sql`UPDATE external_maintenance_jobs SET workshopName=${values.workshopName},workshopPhone=${values.workshopPhone},expectedReturnDate=${values.expectedReturnDate},
      workshopLocationUrl=${values.workshopLocationUrl || null},workshopNotes=${values.workshopNotes || null}
      WHERE id=${job.id} AND purchaseOrderId=${po.id}`);
    await tx.execute(sql`INSERT INTO audit_logs(userId,action,entityType,entityId,oldValues,newValues)
      VALUES(${actor.id},'external_workshop_priced','external_maintenance_job',${job.id},
      ${JSON.stringify({workshopName:job.workshopName??null,workshopPhone:job.workshopPhone??null,expectedReturnDate:job.expectedReturnDate??null,workshopLocationUrl:job.workshopLocationUrl??null,workshopNotes:job.workshopNotes??null})},
      ${JSON.stringify({...values,purchaseOrderId:po.id,purchaseOrderItemId:item.id})})`);
    return result;
  };
  return port.existingTx ? apply(port.existingTx) : port.transaction(apply);
}

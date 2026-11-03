import { sql, type SQL } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { readScopeChunks } from "../_core/authz/read-batch";
import { mediaKeyFromValue } from "../_core/authz/media-access";
import { reportMediaForRows } from "./report-media";

type Actor = { id: number; role: string; isActive?: number };
type Port = { execute(query: SQL): Promise<any> };
const allowed = (actor: Actor) =>
  actor.role === "warehouse" &&
  actor.isActive === 1 &&
  Number.isSafeInteger(actor.id) &&
  actor.id > 0;
const validId = (id: number) => Number.isSafeInteger(id) && id > 0;
async function scope(db: Port, actor: Actor, selector: SQL, detail = false) {
  // Match the existing warehouse material queue, including received/return needs.
  // An assignment without a material request never grants ticket access.
  const result =
    await db.execute(sql`SELECT a.id AS assignmentId,k.id AS ticketId,k.beforePhotoUrl,
    CASE WHEN originTask.id IS NOT NULL THEN original.id ELSE NULL END AS originalTicketId,
    CASE WHEN originTask.id IS NOT NULL THEN original.beforePhotoUrl ELSE NULL END AS originalPhotoUrl
    ${detail ? sql`,a.ticketNumber,k.title,k.description,k.status,k.priority,k.createdAt,t.name AS teamName,s.name AS siteName,c.name AS sectionName` : sql``}
    FROM ticket_team_assignments a
    INNER JOIN tickets k ON k.id=a.ticketId
    INNER JOIN ticket_items i ON i.id=a.ticketItemId AND i.ticketId=k.id
    INNER JOIN maintenance_teams t ON t.id=a.teamId
    INNER JOIN users viewer ON viewer.id=${actor.id} AND viewer.role='warehouse' AND viewer.isActive=1
    LEFT JOIN tickets original ON original.id=k.parentTicketId
    LEFT JOIN ticket_tasks originTask ON originTask.id=k.sourceTaskId AND originTask.ticketId=original.id AND originTask.convertedTicketId=k.id
    ${detail ? sql`LEFT JOIN sites s ON s.id=a.siteId LEFT JOIN sections c ON c.id=a.sectionId` : sql``}
    WHERE k.workflowModel='sub_ticket' AND (${selector})
    AND EXISTS (SELECT 1 FROM ticket_team_material_needs n WHERE n.assignmentId=a.id)
    ${detail ? sql`` : sql`LIMIT 1`}`);
  if (!Array.isArray(result?.[0]))
    throw Error("تعذر التحقق من البلاغ المرتبط بطلب المواد");
  return result[0] as any[];
}

/** Bounded, independent record decisions. Never reuse this scope for a file read. */
export async function loadWarehouseMaterialTicketScope(
  db: Port,
  actor: Actor,
  ids: number[]
) {
  if (!allowed(actor) || ids.some(id => !validId(id)))
    throw new TRPCError({ code: "FORBIDDEN" });
  const records = await readScopeChunks(ids, chunk =>
    scope(
      db,
      actor,
      sql`k.id IN (${sql.join(
        chunk.map(id => sql`${id}`),
        sql`,`
      )})`,
      true
    )
  );
  return new Map<number, any>(records.map(row => [Number(row.ticketId), row]));
}

/** Narrow read DTO: no ticket writers, signatures, financial files, or parent-page grant. */
export async function readWarehouseMaterialTicket(
  db: Port,
  actor: Actor,
  ticketId: number
) {
  const row = (
    await loadWarehouseMaterialTicketScope(db, actor, [ticketId])
  ).get(ticketId);
  if (!row)
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "البلاغ غير مرتبط بطلب مواد متاح للمستودع",
    });
  const media = await reportMediaForRows(db, [row]);
  return {
    id: Number(row.ticketId),
    ticketNumber: String(row.ticketNumber),
    title: String(row.title || ""),
    description: String(row.description || ""),
    status: String(row.status || ""),
    priority: String(row.priority || ""),
    createdAt: row.createdAt,
    siteName: String(row.siteName || ""),
    sectionName: String(row.sectionName || ""),
    teamName: String(row.teamName || ""),
    reportMedia: media.get(Number(row.assignmentId)) || [],
  };
}

/** Exact report media only; recheck the account and material-request link on every file. */
export async function canReadWarehouseMaterialTicketMedia(
  db: Port,
  actor: Actor,
  sourceTicketId: number,
  key: string
) {
  if (!allowed(actor) || !validId(sourceTicketId)) return false;
  const records = await scope(
    db,
    actor,
    sql`k.id=${sourceTicketId} OR (original.id=${sourceTicketId} AND originTask.id IS NOT NULL)`
  );
  const media = await reportMediaForRows(db, records);
  return Array.from(media.values()).some(items =>
    items.some(item => mediaKeyFromValue(item.url) === key)
  );
}

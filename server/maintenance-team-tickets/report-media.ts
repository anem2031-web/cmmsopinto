import { sql, type SQL } from "drizzle-orm";
import type { TeamManagementActor } from "../../shared/maintenance-team-tickets/team-management";
import type { TicketReportMedia } from "../../shared/maintenance-team-tickets/assignment";
import { canReadTicketTeamExecution } from "../../shared/maintenance-team-tickets/execution-permissions";
import { groupReadRows, readScopeChunks } from "../_core/authz/read-batch";
import { mediaKeyFromValue } from "../_core/authz/media-access";
import { ticketTeamQueueScope } from "../routers/maintenance-teams/assignment-read-scope";

type Port = { execute(query: SQL): Promise<any> };
const read = async (db: Port, query: SQL): Promise<any[]> => {
  const result = await db.execute(query);
  if (!Array.isArray(result?.[0])) throw Error("تعذر تحميل وسائط البلاغ");
  return result[0];
};
const allowed = (actor: TeamManagementActor) =>
  actor.active &&
  ["technician", "it_manager", "it_member", "owner", "admin"].includes(
    actor.role
  ) &&
  canReadTicketTeamExecution(actor.role);
const identifiers = (ids: number[]) =>
  sql.join(
    ids.map(id => sql`${id}`),
    sql`,`
  );
function reportScope(actor: TeamManagementActor, selector: SQL) {
  return sql`SELECT a.id AS assignmentId,k.id AS ticketId,k.beforePhotoUrl,
    CASE WHEN originTask.id IS NOT NULL THEN original.id ELSE NULL END AS originalTicketId,
    CASE WHEN originTask.id IS NOT NULL THEN original.beforePhotoUrl ELSE NULL END AS originalPhotoUrl
    FROM ticket_team_assignments a INNER JOIN maintenance_teams t ON t.id=a.teamId
    INNER JOIN tickets k ON k.id=a.ticketId
    INNER JOIN ticket_items i ON i.id=a.ticketItemId AND i.ticketId=k.id
    INNER JOIN users viewer ON viewer.id=${actor.id} AND viewer.isActive=1 AND viewer.role=${actor.role}
    LEFT JOIN tickets original ON original.id=k.parentTicketId
    LEFT JOIN ticket_tasks originTask ON originTask.id=k.sourceTaskId AND originTask.ticketId=original.id AND originTask.convertedTicketId=k.id
    WHERE k.workflowModel='sub_ticket' AND (${selector}) AND (${ticketTeamQueueScope(actor)})`;
}
function attachmentType(row: any): TicketReportMedia["type"] | null {
  const mime = String(row.mimeType || "")
    .trim()
    .toLowerCase();
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime && mime !== "application/octet-stream") return null;
  const name = String(row.fileName || row.fileUrl || "").split(/[?#]/)[0];
  if (/\.(png|jpe?g|webp|gif|avif|heic|heif|bmp)$/i.test(name)) return "image";
  if (/\.(mp4|webm|mov|m4v|ogg|ogv)$/i.test(name)) return "video";
  return null;
}
export async function reportMediaForRows(db: Port, records: any[]) {
  const parentIds = records
    .flatMap(row => [Number(row.ticketId), Number(row.originalTicketId)])
    .filter(id => id > 0);
  const attachments = await readScopeChunks(parentIds, ids =>
    read(
      db,
      sql`SELECT entityId,fileUrl,fileName,mimeType
    FROM attachments WHERE entityType='ticket' AND entityId IN (${identifiers(ids)}) ORDER BY id`
    )
  );
  const byTicket = groupReadRows(attachments, row => Number(row.entityId));
  return new Map<number, TicketReportMedia[]>(
    records.map(row => {
      const media: TicketReportMedia[] = [];
      const add = (
        url: unknown,
        type: TicketReportMedia["type"],
        name: string
      ) => {
        if (
          typeof url === "string" &&
          url &&
          !media.some(item => item.url === url)
        )
          media.push({ url, type, name });
      };
      add(row.originalPhotoUrl || row.beforePhotoUrl, "image", "");
      for (const id of [Number(row.originalTicketId), Number(row.ticketId)]) {
        for (const attachment of byTicket.get(id) || []) {
          const type = attachmentType(attachment);
          if (type)
            add(attachment.fileUrl, type, String(attachment.fileName || ""));
        }
      }
      return [Number(row.assignmentId), media];
    })
  );
}

/** IDs come from the scoped, limited queue. Recheck each assignment in bounded reads. */
export async function loadTeamReportMedia(
  db: Port,
  actor: TeamManagementActor,
  assignments: Array<{ assignmentId: number; ticketId: number }>
) {
  if (!allowed(actor) || !assignments.length)
    return new Map<number, TicketReportMedia[]>();
  const parents = new Map(
    assignments.map(row => [row.assignmentId, row.ticketId])
  );
  const records = await readScopeChunks(Array.from(parents.keys()), ids =>
    read(db, reportScope(actor, sql`a.id IN (${identifiers(ids)})`))
  );
  return reportMediaForRows(
    db,
    records.filter(
      row => parents.get(Number(row.assignmentId)) === Number(row.ticketId)
    )
  );
}

/** File-boundary grant only for current team members and exact report image/video keys.
 * This does not grant the parent ticket page, PDFs, signatures, or after-photo fields. */
export async function canReadTeamReportMedia(
  db: Port,
  actor: TeamManagementActor,
  sourceTicketId: number,
  key: string
) {
  if (
    !allowed(actor) ||
    !["technician", "it_manager", "it_member"].includes(actor.role)
  )
    return false;
  const records = await read(
    db,
    sql`${reportScope(actor, sql`k.id=${sourceTicketId} OR (original.id=${sourceTicketId} AND originTask.id IS NOT NULL)`)} LIMIT 1`
  );
  const media = await reportMediaForRows(db, records);
  return Array.from(media.values()).some(items =>
    items.some(item => mediaKeyFromValue(item.url) === key)
  );
}

import { TRPCError } from "@trpc/server";
import { isDelegateRole } from "../../../shared/delegate-role";
import { mediaReferenceUnavailable, resolveMediaReferenceSources } from "./media-reference-sources";
import { assertGateSecurityMediaReference } from "./gate-security-guard";
import { authorizePurchaseAttachment, isPurchaseDocumentAttachment, isPurchasePdfApprover } from "./purchase-document";

export type MediaActor = { id: number; role: string; isActive?: number };
export type MediaReference = { kind: string; id: number; parentId?: number | null; entityType?: string; ownerId?: number | null };
export interface MediaAccessPort {
  references(key: string): Promise<MediaReference[]>;
  authorize(user: MediaActor, reference: MediaReference, key?: string): Promise<void>;
}
const denied = () => new TRPCError({ code: "FORBIDDEN", message: "ليس لديك صلاحية لفتح هذا الملف" });

async function teamReportMediaReadable(user: MediaActor, ticketId: number, key?: string): Promise<boolean> {
  if (!key || !["technician", "it_manager", "it_member", "warehouse"].includes(user.role)) return false;
  const [{ getDb }, { canReadTeamReportMedia }] = await Promise.all([
    import("../db/client"), import("../../maintenance-team-tickets/report-media"),
  ]);
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "تعذر التحقق من وسائط البلاغ" });
  if (user.role === "warehouse") {
    const { canReadWarehouseMaterialTicketMedia } = await import("../../maintenance-team-tickets/warehouse-ticket-reader");
    return canReadWarehouseMaterialTicketMedia(db, user, ticketId, key);
  }
  return canReadTeamReportMedia(db, { id: user.id, role: user.role, active: user.isActive === 1 }, ticketId, key);
}

export function normalizeMediaKey(raw: unknown): string {
  if (typeof raw !== "string") throw denied();
  const key = raw.replace(/^\/+/, "");
  if (!key.startsWith("cmms/") || key.length > 1000 || /[\\\x00-\x1f?#]|%(?:2e|2f|5c|25)/i.test(key)
    || key.split("/").some(segment => !segment || segment === "." || segment === "..")) throw denied();
  return key;
}

/** Recognize stored proxy URLs/keys without ever fetching a remote URL. */
export function mediaKeyFromValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    if (value.startsWith("cmms/")) return normalizeMediaKey(value);
    const url = new URL(value, "http://media.local");
    if (url.pathname === "/api/media") return normalizeMediaKey(url.searchParams.get("key"));
    const match = value.match(/idrivee2\.com\/[^/]+\/(cmms\/.+)$/);
    return match ? normalizeMediaKey(decodeURIComponent(match[1])) : null;
  } catch { return null; }
}
function containsKey(value: unknown, key: string): boolean {
  if (typeof value === "string") {
    if (mediaKeyFromValue(value) === key) return true;
    try { return containsKey(JSON.parse(value), key); } catch { return false; }
  }
  if (Array.isArray(value)) return value.some(child => containsKey(child, key));
  return !!value && typeof value === "object" && Object.values(value).some(child => containsKey(child, key));
}

const metadataCache = new WeakMap<object, { at: number; columns: Map<string, Set<string>> }>();
export const mediaAccessPort: MediaAccessPort = {
  async references(key) {
    const { getDb } = await import("../db");
    const schema = await import("../../../drizzle/schema");
    const { sql } = await import("drizzle-orm");
    const sources = resolveMediaReferenceSources(schema);
    const connection = await getDb();
    if (!connection) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "تعذر التحقق من صلاحية الملف" });
    // Older installations need not contain every optional module/table. Read
    // metadata only, and omit unavailable reference sources instead of breaking
    // all otherwise valid images because an unrelated module is absent.
    let metadata = metadataCache.get(connection);
    if (!metadata || Date.now() - metadata.at > 60_000) {
      const tableNames = sources.map(source => source.tableName);
      const [rows]: any = await connection.execute(sql`SELECT TABLE_NAME AS tableName, COLUMN_NAME AS columnName
        FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (${sql.join(tableNames.map(name => sql`${name}`), sql`,`)})`);
      const columns = new Map<string, Set<string>>();
      if (!Array.isArray(rows)) throw mediaReferenceUnavailable("Invalid column metadata response");
      for (const row of rows) {
        const name = row?.tableName ?? row?.TABLE_NAME;
        const column = row?.columnName ?? row?.COLUMN_NAME;
        if (typeof name !== "string" || !name || typeof column !== "string" || !column) {
          throw mediaReferenceUnavailable("Invalid column metadata entry");
        }
        if (!columns.has(name)) columns.set(name, new Set());
        columns.get(name)!.add(column);
      }
      metadata = { at: Date.now(), columns };
      // A missing optional table/file column may be added by a migration. Do
      // not cache its absence and mistake a newly linked file for an upload.
      const complete = sources.every(source => [source.id, source.parent, source.owner, source.entity, ...source.files]
        .every(column => !column || columns.get(source.tableName)?.has(column.name)));
      if (complete) metadataCache.set(connection, metadata);
    }
    const patterns = [key, encodeURIComponent(key)].map(value => `%${value.replace(/[\\%_]/g, char => `\\${char}`)}%`);
    const available = sources.flatMap(source => {
      const columns = metadata!.columns.get(source.tableName);
      if (!columns) return [];
      // Scan all file columns that actually exist, even on older schemas.
      const files = source.files.filter(column => columns.has(column.name));
      if (!files.length) return [];
      // Existing files must retain every column needed to authorize their parent.
      for (const column of [source.id, source.parent, source.owner, source.entity]) {
        if (column && !columns.has(column.name)) {
          throw mediaReferenceUnavailable(`Missing scope column: ${source.tableName}.${column.name}`);
        }
      }
      return [{ ...source, files }];
    });
    if (!available.length) return [];
    const queries = available.map(source => {
      const { table, kind, id, parent, owner, entity, files: columns } = source;
      return sql`SELECT ${kind} AS kind, ${id} AS id, ${parent} AS parentId,
        ${owner ?? sql`NULL`} AS ownerId, ${entity ?? sql`NULL`} AS entityType,
        JSON_ARRAY(${sql.join(columns, sql`,`)}) AS payload FROM ${table}
        WHERE ${sql.join(columns.flatMap(column => patterns.map(pattern => sql`${column} LIKE ${pattern}`)), sql` OR `)}`;
    });
    const [rows]: any = await connection.execute(sql.join(queries, sql` UNION ALL `));
    return rows.filter((row: any) => containsKey(row.payload, key)).map(({ payload, ...reference }: any) => reference);
  },
  async authorize(user, ref, key) {
    if (user.role === "gate_security") {
      await assertGateSecurityMediaReference(user, ref);
      return;
    }
    if (ref.kind === "attachment") {
      const type = ref.entityType || "";
      if (isPurchaseDocumentAttachment(type)) {
        // Preserve the delegate's existing frozen archive access, independent of
        // a later PO reassignment. The new approval prerequisite is financial-role only.
        if (isDelegateRole(user.role) && ["delegate_pricing_batch", "delegate_package_submission_pricing"].includes(type)) {
          if (ref.ownerId !== user.id) throw denied();
          return;
        }
        await authorizePurchaseAttachment(user, type, ref.parentId!);
        return;
      }
      const { assertCanAccessAttachments } = await import("../../routers/uploads/attachments.access");
      try {
        await assertCanAccessAttachments(user, type, ref.parentId!);
        return;
      } catch (error) {
        if (type === "ticket" && ref.parentId && error instanceof TRPCError && ["FORBIDDEN", "NOT_FOUND"].includes(error.code)
          && await teamReportMediaReadable(user, ref.parentId, key)) return;
        throw error;
      }
    }
    if (ref.kind === "signature") { if (ref.ownerId !== user.id) throw denied(); return; }
    if (ref.kind === "reference") return;
    if (ref.kind === "warehouse" || ref.kind === "receipt") { if (user.role !== "warehouse") throw denied(); return; }
    if (ref.kind === "inventory" || ref.kind === "delivery") {
      if (!isDelegateRole(user.role) && !["warehouse", "senior_management", "executive_director", "maintenance_manager", "purchase_requester", "food_warehouse_manager", "food_warehouse_assistant"].includes(user.role)) throw denied();
      return;
    }
    if (ref.kind === "pm") {
      if (ref.ownerId !== user.id && !["maintenance_manager", "general_maintenance_manager", "supervisor", "senior_management", "executive_director"].includes(user.role)) {
        const db = await import("../db");
        const workOrder = await db.getPMWorkOrderById(ref.parentId!);
        if (workOrder?.assignedToId !== user.id) throw denied();
      }
      return;
    }
    const db = await import("../db");
    if (ref.kind === "external" && user.role === "warehouse") return;
    if (ref.kind === "external" && isDelegateRole(user.role)) {
      const { loadExternalDelegateScopes, isPrepurchaseExternalJob, isExternalDelegateJob } = await import("./external-delegate-access");
      const scope = (await loadExternalDelegateScopes([ref.id])).get(ref.id);
      if (!scope || Number(scope.ticketId) !== Number(ref.parentId)) throw denied();
      if (isPrepurchaseExternalJob(scope)) {
        if (!isExternalDelegateJob(user, scope) || !key || mediaKeyFromValue(scope.assetBeforePhotoUrl) !== key) throw denied();
        return;
      }
      const { assertDelegateExternalAssetKey } = await import("./external-followup-media");
      await assertDelegateExternalAssetKey(user, [ref], key || "", mediaKeyFromValue);
      return;
    }
    if (ref.kind === "ticket" || ref.kind === "external") {
      const ticket = await db.getTicketById(ref.parentId!);
      if (!ticket) throw denied();
      // Only the initial photo actually displayed in the warehouse preparation
      // card. Do not grant ticket detail, after photos, or arbitrary attachments.
      if (ref.kind === "ticket" && user.role === "warehouse" && key
        && mediaKeyFromValue(ticket.beforePhotoUrl) === key) {
        const { isWaitingExternalWarehousePreparation } = await import("./external-preparation-photo");
        if (await isWaitingExternalWarehousePreparation(ticket.id)) return;
      }
      const { assertTicketReadable } = await import("../../routers/tickets/tickets.access");
      try {
        await assertTicketReadable(user, ticket);
        return;
      } catch (error) {
        if (ref.kind === "ticket" && error instanceof TRPCError && ["FORBIDDEN", "NOT_FOUND"].includes(error.code)
          && await teamReportMediaReadable(user, ticket.id, key)) return;
        throw error;
      }
    }
    if (ref.kind === "po") {
      const po = await db.getPurchaseOrderById(ref.parentId!);
      if (!po) throw denied();
      const { createPurchaseOrderReadScope } = await import("./guard");
      const scope = await createPurchaseOrderReadScope(user, [po]);
      scope.assert(po);
      if (scope.isRoutedReviewOnly(po) && !scope.filterItems(po, [{ id: ref.id, purchaseOrderId: po.id }]).length) throw denied();
      return;
    }
    if (ref.kind === "construction" || ref.kind === "construction_task") {
      if (["maintenance_manager", "construction_procurement_manager", "senior_management"].includes(user.role)) return;
      const connection = await db.getDb();
      if (!connection) throw denied();
      const { constructionProjectMembers, constructionTasks } = await import("../../../drizzle/schema");
      const { and, eq } = await import("drizzle-orm");
      let projectId = ref.parentId!;
      if (ref.kind === "construction_task") {
        const [task] = await connection.select({ projectId: constructionTasks.projectId }).from(constructionTasks).where(eq(constructionTasks.id, ref.parentId!)).limit(1);
        if (!task) throw denied();
        projectId = task.projectId;
      }
      const members = await connection.select({ id: constructionProjectMembers.id }).from(constructionProjectMembers)
        .where(and(eq(constructionProjectMembers.projectId, projectId), eq(constructionProjectMembers.userId, user.id))).limit(1);
      if (!members.length) throw denied();
      return;
    }
    throw denied();
  },
};

/** Authenticated file reads obey the same parent-document scope as its UI/API. */
export async function assertMediaAccess(user: MediaActor | null | undefined, rawKey: unknown, port = mediaAccessPort): Promise<string> {
  if (!user || user.isActive !== 1) throw denied();
  const key = normalizeMediaKey(rawKey);
  if (["owner", "admin"].includes(user.role)) return key;
  // Backups contain authentication data; the observer's read-only admin view
  // does not grant downloading a raw database backup through a known URL.
  if (key.startsWith("cmms/backups/")) throw denied();
  if (user.role === "observer") return key;
  const references = await port.references(key);
  const externalReferences = references.filter(reference => reference.kind === "external");
  if (isDelegateRole(user.role) && externalReferences.length) {
    // A report/image graft must not turn an original financial PDF into a new
    // asset permission. Keep its original document boundary independently.
    for (const reference of references.filter(reference => reference.kind === "attachment" && isPurchaseDocumentAttachment(reference.entityType || ""))) {
      await port.authorize(user, reference, key);
    }
    if (port === mediaAccessPort) {
      const { assertDelegateExternalAssetKey } = await import("./external-followup-media");
      await assertDelegateExternalAssetKey(user, externalReferences, key, mediaKeyFromValue);
      return key;
    }
    // Custom ports keep the same external-before-fallback contract in callers
    // and isolated tests; one readable own external source is sufficient.
    for (const reference of externalReferences) {
      try { await port.authorize(user, reference, key); return key; }
      catch (error) { if (!(error instanceof TRPCError) || !["FORBIDDEN", "NOT_FOUND", "BAD_REQUEST"].includes(error.code)) throw error; }
    }
    throw denied();
  }
  // A restricted financial PDF cannot be made public by grafting the same key
  // onto an otherwise readable image/catalog record. Its original document gate
  // must pass before the ordinary any-readable-reference fallback below.
  if (isPurchasePdfApprover(user)) {
    for (const reference of references.filter(ref => ref.kind === "attachment" && isPurchaseDocumentAttachment(ref.entityType || ""))) {
      await port.authorize(user, reference, key);
    }
  }
  // Preview an unlinked upload only. Once saved, its parent determines access
  // even if the uploader later loses access to that document.
  if (user.role !== "gate_security" && !references.length && key.startsWith(`cmms/uploads/u-${user.id}/`)) return key;
  for (const reference of references) {
    try { await port.authorize(user, reference, key); return key; }
    catch (error) { if (!(error instanceof TRPCError) || !["FORBIDDEN", "NOT_FOUND", "BAD_REQUEST"].includes(error.code)) throw error; }
  }
  throw denied();
}

/** Prevent attaching another user's known private key to an editable own record. */
export async function assertMediaInputAccess(user: MediaActor, input: unknown, authorize = assertMediaAccess): Promise<void> {
  const keys = new Set<string>();
  function visit(value: unknown, depth = 0, fileField = false) {
    if (depth > 20) throw denied();
    if (typeof value === "string" && fileField) {
      const key = mediaKeyFromValue(value);
      if (key) keys.add(key);
      else if (/^\s*[\[{]/.test(value)) { try { visit(JSON.parse(value), depth + 1, true); } catch (error) { if (error instanceof TRPCError) throw error; } }
    }
    else if (Array.isArray(value)) value.forEach(child => visit(child, depth + 1, fileField));
    else if (value && typeof value === "object") Object.entries(value).forEach(([name, child]) => visit(child, depth + 1, fileField || /(?:urls?|keys?|photos|images|attachments)$/i.test(name)));
  }
  visit(input);
  for (const key of Array.from(keys)) await authorize(user, key);
}

/** Rename has a readable source and a new destination, not two existing files. */
export async function assertMediaMutationAccess(user: MediaActor, path: string, input: unknown, authorize = assertMediaAccess) {
  if (path === "construction.customFields.setValue") {
    await assertMediaInputAccess(user, { attachments: [(input as any)?.value] }, authorize);
  }
  if (path !== "assetDocuments.renamePhoto") return assertMediaInputAccess(user, input, authorize);
  const value = input as Record<string, unknown> | null;
  normalizeMediaKey(value?.newKey);
  await authorize(user, value?.oldKey);
}

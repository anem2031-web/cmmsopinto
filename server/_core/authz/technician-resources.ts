import { TRPCError } from "@trpc/server";
import { isDelegateRole } from "../../../shared/delegate-role";
import type { SupportedLanguage } from "../../services/translation/translation";

const translationTables = {
  TICKET_STATUS_HISTORY: "ticketStatusHistory", TICKET_ITEM: "ticketItems",
  TICKET_DEPARTMENT: "ticketDepartments", TICKET_TASK: "ticketTasks", INSPECTION_RESULT: "inspectionResults",
} as const;
type Actor = { id: number; role: string; preferredLanguage?: string | null };
export interface TechnicianTranslationPort {
  parents(type: string, ids: number[]): Promise<Array<{ id: number; ticketId: number }>>;
  assertTicket(user: Actor, ticketId: number): Promise<void>;
  assertTickets?(user: Actor, ticketIds: number[]): Promise<void>;
}
async function assertTicket(user: Actor, ticketId: number) {
  const db = await import("../db");
  const { assertTicketReadable } = await import("../../routers/tickets/tickets.access");
  const ticket = await db.getTicketById(ticketId);
  if (!ticket) throw new TRPCError({ code: "NOT_FOUND", message: "البلاغ غير موجود" });
  await assertTicketReadable(user, ticket);
  return ticket;
}
const translationPort: TechnicianTranslationPort = {
  async assertTickets(user, ids) {
    const { loadTicketReadScope } = await import("../db/ticket-read-scope");
    const { assertTicketReadable } = await import("../../routers/tickets/tickets.access");
    const scope = await loadTicketReadScope(user, ids);
    for (const id of ids) {
      const ticket = scope.tickets.get(id);
      if (!ticket) throw new TRPCError({ code: "NOT_FOUND", message: "البلاغ غير موجود" });
      await assertTicketReadable(user, ticket, undefined, scope.source);
    }
  },
  async assertTicket(user, ticketId) { await assertTicket(user, ticketId); },
  async parents(type, ids) {
    if (type === "TICKET") return ids.map(id => ({ id, ticketId: id }));
    const { getDb } = await import("../db/client");
    const schema = await import("../../../drizzle/schema");
    const { inArray } = await import("drizzle-orm");
    const table = schema[translationTables[type as keyof typeof translationTables]];
    const connection = await getDb();
    if (!connection) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "قاعدة البيانات غير متاحة" });
    return connection.select({ id: table.id, ticketId: table.ticketId }).from(table).where(inArray(table.id, ids));
  },
};
/** All IDs must be authorized before the translation reader sees any of them. */
export async function assertTechnicianTranslationAccess(user: Actor, raw: unknown, mode: "single" | "batch", port = translationPort) {
  if (user.role !== "technician") return;
  const input = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const type = String(input.entityType);
  // Match the selected procedure's parser; unrelated extra properties are ignored.
  const values = mode === "batch" ? input.entityIds : [input.entityId];
  if ((type !== "TICKET" && !Object.hasOwn(translationTables, type)) || !Array.isArray(values)
    || values.length > 200 || values.some(id => !Number.isSafeInteger(id) || id <= 0)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "الترجمة متاحة لبيانات مهام الفني فقط" });
  }
  const ids = Array.from(new Set(values)) as number[];
  if (!ids.length) return;
  const rows = await port.parents(type, ids);
  if (rows.length !== ids.length || ids.some(id => !rows.some(row => row.id === id))) {
    throw new TRPCError({ code: "FORBIDDEN", message: "بيانات الترجمة غير متاحة" });
  }
  const ticketIds = Array.from(new Set(rows.map(row => row.ticketId)));
  if (port.assertTickets && ticketIds.length > 1) await port.assertTickets(user, ticketIds);
  else for (const ticketId of ticketIds) await port.assertTicket(user, ticketId);
}

/** Small display references for one authorized ticket, rather than global directories. */
export async function readTicketExecutionReferences(user: Actor, ticketId: number) {
  const ticket = await assertTicket(user, ticketId);
  const db = await import("../db");
  const schema = await import("../../../drizzle/schema");
  const { eq, inArray, or } = await import("drizzle-orm");
  const connection = await db.getDb();
  if (!connection) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "قاعدة البيانات غير متاحة" });
  const [history, inspections, items] = await Promise.all([
    db.getTicketHistory(ticketId), db.getInspectionResultsByTicket(ticketId), db.getTicketItems(ticketId),
  ]);
  const ids = Array.from(new Set([
    ticket.reportedById, ticket.assignedToId, ticket.maintenanceResponsibleManagerId,
    ...history.map(row => row.changedById),
    ...inspections.flatMap(row => [row.inspectorId, row.performedById, row.recordedById]),
    ...items.flatMap((row: { assignedToId: number | null; responsibleManagerId: number | null }) => [row.assignedToId, row.responsibleManagerId]),
  ].filter((id): id is number => typeof id === "number" && id > 0)));
  const [users, sites, sections, technicians, categories] = await Promise.all([
    ids.length ? connection.select({ id: schema.users.id, name: schema.users.name, role: schema.users.role, isActive: schema.users.isActive })
      .from(schema.users).where(inArray(schema.users.id, ids)) : [],
    connection.select({ id: schema.sites.id, name: schema.sites.name, nameEn: schema.sites.nameEn, nameUr: schema.sites.nameUr }).from(schema.sites).where(eq(schema.sites.id, ticket.siteId ?? 0)),
    connection.select({ id: schema.sections.id, name: schema.sections.name, nameEn: schema.sections.nameEn, nameUr: schema.sections.nameUr }).from(schema.sections).where(eq(schema.sections.id, ticket.sectionId ?? 0)),
    connection.select({ id: schema.technicians.id, name: schema.technicians.name, nameEn: schema.technicians.nameEn, nameUr: schema.technicians.nameUr }).from(schema.technicians).where(eq(schema.technicians.id, ticket.assignedTechnicianId ?? 0)),
    connection.select({ id: schema.centerCategories.id, name: schema.centerCategories.name, isActive: schema.centerCategories.isActive }).from(schema.centerCategories)
      .where(ticket.reportedById === user.id && ticket.status === "pending_triage"
        ? or(eq(schema.centerCategories.isActive, 1), eq(schema.centerCategories.id, ticket.categoryId ?? 0))
        : eq(schema.centerCategories.id, ticket.categoryId ?? 0)),
  ]);
  const { localizeNamedRecords } = await import("../../services/translation/localizedMasterData");
  const language = (user.preferredLanguage || "ar") as SupportedLanguage;
  const [localizedUsers, localizedSites, localizedSections, localizedTechnicians, localizedCategories] = await Promise.all([
    localizeNamedRecords("USER", users, language), localizeNamedRecords("SITE", sites, language),
    localizeNamedRecords("SECTION", sections, language), localizeNamedRecords("TECHNICIAN", technicians, language),
    localizeNamedRecords("CENTER_CATEGORY", categories, language),
  ]);
  return { users: isDelegateRole(user.role) ? localizedUsers.map(({ id, name }) => ({ id, name })) : localizedUsers,
    sites: localizedSites, sections: localizedSections, technicians: localizedTechnicians, categories: localizedCategories };
}

/** Called only after PMV2's persisted actor/team guard authorized this source. */
export async function readPmv2TicketReferences(source: { siteId: number; sectionId: number | null; assetId: number | null }, language: SupportedLanguage = "ar") {
  const { getDb } = await import("../db/client");
  const schema = await import("../../../drizzle/schema");
  const { and, eq, or } = await import("drizzle-orm");
  const connection = await getDb();
  if (!connection) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "قاعدة البيانات غير متاحة" });
  const [sites, sections, assets, categories] = await Promise.all([
    connection.select({ id: schema.sites.id, name: schema.sites.name, nameEn: schema.sites.nameEn, nameUr: schema.sites.nameUr }).from(schema.sites).where(eq(schema.sites.id, source.siteId)),
    connection.select({ id: schema.sections.id, name: schema.sections.name, nameEn: schema.sections.nameEn, nameUr: schema.sections.nameUr }).from(schema.sections)
      .where(source.sectionId != null ? eq(schema.sections.id, source.sectionId)
        : and(eq(schema.sections.siteId, source.siteId), eq(schema.sections.isActive, 1))),
    connection.select({ id: schema.assets.id, name: schema.assets.name, sectionId: schema.assets.sectionId }).from(schema.assets)
      .leftJoin(schema.sections, eq(schema.sections.id, schema.assets.sectionId))
      .where(source.assetId != null ? eq(schema.assets.id, source.assetId)
        : and(or(eq(schema.assets.siteId, source.siteId), eq(schema.sections.siteId, source.siteId)),
          source.sectionId != null ? eq(schema.assets.sectionId, source.sectionId) : undefined)),
    connection.select({ id: schema.centerCategories.id, name: schema.centerCategories.name }).from(schema.centerCategories).where(eq(schema.centerCategories.isActive, 1)),
  ]);
  const { localizeNamedRecords } = await import("../../services/translation/localizedMasterData");
  const [localizedSites, localizedSections, localizedAssets, localizedCategories] = await Promise.all([
    localizeNamedRecords("SITE", sites, language), localizeNamedRecords("SECTION", sections, language),
    localizeNamedRecords("ASSET", assets, language), localizeNamedRecords("CENTER_CATEGORY", categories, language),
  ]);
  return { sites: localizedSites, sections: localizedSections, assets: localizedAssets, categories: localizedCategories };
}

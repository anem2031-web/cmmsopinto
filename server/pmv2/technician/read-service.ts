import { pmv2ExecutionActor, pmv2ExecutionActorCondition, pmv2ExecutionTeamCondition } from "../security/execution-access";
import { and, asc, desc, eq, inArray, isNull, lte, ne, or, sql } from "drizzle-orm";
import {
  assets,
  attachments,
  pmv2ItemActions,
  pmv2ProgramTargets,
  pmv2TaskItems,
  pmv2TaskTicketLinks,
  pmv2Tasks,
  pmv2Teams,
  pmv2VisitMembers,
  pmv2Visits,
  sections,
  sites,
} from "../../../drizzle/schema";
import { getDb } from "../../_core/db/client";
import { getRiyadhDateOnly } from "../scheduler/utils";
import { loadUnifiedTeamNames } from "../security/unified-team-names";
import { isPmv2SimplifiedEnabled } from "../simplified/feature";
import { loadAuthorizedTaskItemTitles } from "../security/task-item-translations";
import { currentTicketAdapter } from "../adapters/current-system";

async function requireDb() {
  const db = await getDb();
  if (!db) throw new Error("تعذر الاتصال بقاعدة البيانات");
  return db;
}

export class Pmv2TechnicianAccessError extends Error {
  constructor(message = "المهمة غير موجودة ضمن مهامك") {
    super(message);
    this.name = "Pmv2TechnicianAccessError";
  }
}

/**
 * Technician task/read boundary.
 * Active technicians require team membership; designated administrative executors may access all teams.
 * Patch 096 keeps prior non-final Tasks visible across date boundaries without mutating dueDate.
 * Patch 111 also keeps a completed prior Task visible while an explicit Visit is still open,
 * so the Visit leader can close it without reopening or mutating the Task itself.
 */
export class Pmv2TechnicianReadService {
  async listTodayTasks(userId: number, date = getRiyadhDateOnly(), completedArchive = false) {
    const db = await requireDb();
    const query = db
      .select({
        id: pmv2Tasks.id,
        taskNumber: pmv2Tasks.taskNumber,
        dueDate: pmv2Tasks.dueDate,
        status: pmv2Tasks.status,
        teamId: pmv2Tasks.teamId,
        teamCode: pmv2Teams.code,
        siteId: pmv2ProgramTargets.siteId,
        siteName: sites.name,
        sectionId: pmv2ProgramTargets.sectionId,
        sectionName: sections.name,
        assetId: pmv2ProgramTargets.assetId,
        assetName: assets.name,
        itemCount: sql<number>`count(${pmv2TaskItems.id})`,
        completedItemCount: sql<number>`coalesce(sum(case when ${pmv2TaskItems.status} = 'completed' then 1 else 0 end), 0)`,
        activeItemCount: sql<number>`coalesce(sum(case when ${pmv2TaskItems.status} in ('pending','in_progress','ready_to_complete') then 1 else 0 end), 0)`,
        waitingMaterialCount: sql<number>`coalesce(sum(case when ${pmv2TaskItems.status} = 'waiting_material' then 1 else 0 end), 0)`,
        waitingTicketCount: sql<number>`coalesce(sum(case when ${pmv2TaskItems.status} = 'waiting_ticket' then 1 else 0 end), 0)`,
        hasOpenVisit: sql<number>`exists (select 1 from ${pmv2Visits} where ${pmv2Visits.taskId} = ${pmv2Tasks.id} and ${pmv2Visits.endedAt} is null)`,
      })
      .from(pmv2Tasks)
      .innerJoin(
        pmv2ExecutionActor, pmv2ExecutionActorCondition(userId),
      )
      .innerJoin(pmv2Teams, eq(pmv2Teams.id, pmv2Tasks.teamId))
      .innerJoin(pmv2ProgramTargets, eq(pmv2ProgramTargets.id, pmv2Tasks.programTargetId))
      .leftJoin(sites, eq(sites.id, pmv2ProgramTargets.siteId))
      .leftJoin(sections, eq(sections.id, pmv2ProgramTargets.sectionId))
      .leftJoin(assets, eq(assets.id, pmv2ProgramTargets.assetId))
      .leftJoin(pmv2TaskItems, eq(pmv2TaskItems.taskId, pmv2Tasks.id))
      .where(
        and(
          pmv2ExecutionTeamCondition(userId, pmv2Tasks.teamId),
          lte(pmv2Tasks.dueDate, date),
          ne(pmv2Tasks.status, "cancelled"),
          completedArchive ? and(eq(pmv2Tasks.status, "completed"), sql<boolean>`not exists (select 1 from ${pmv2Visits} where ${pmv2Visits.taskId} = ${pmv2Tasks.id} and ${pmv2Visits.endedAt} is null)`) : or(
            eq(pmv2Tasks.dueDate, date),
            ne(pmv2Tasks.status, "completed"),
            sql<boolean>`exists (
              select 1
              from ${pmv2Visits}
              where ${pmv2Visits.taskId} = ${pmv2Tasks.id}
                and ${pmv2Visits.endedAt} is null
            )`,
          ),
        ),
      )
      .groupBy(
        pmv2Tasks.id,
        pmv2Tasks.taskNumber,
        pmv2Tasks.dueDate,
        pmv2Tasks.status,
        pmv2Tasks.teamId,
        pmv2Teams.code,
        pmv2ProgramTargets.siteId,
        sites.name,
        pmv2ProgramTargets.sectionId,
        sections.name,
        pmv2ProgramTargets.assetId,
        assets.name,
      )
      .orderBy(desc(pmv2Tasks.dueDate), asc(pmv2Tasks.taskNumber));
    const rows = await (completedArchive ? query.limit(100) : query);

    const unifiedNames = await loadUnifiedTeamNames(db, rows.map(row => Number(row.teamId)));
    const items = rows.map(row => ({
      ...row,
      teamCode: unifiedNames.get(Number(row.teamId)) ?? row.teamCode,
      itemCount: Number(row.itemCount ?? 0),
      completedItemCount: Number(row.completedItemCount ?? 0),
      activeItemCount: Number(row.activeItemCount ?? 0),
      waitingMaterialCount: Number(row.waitingMaterialCount ?? 0),
      waitingTicketCount: Number(row.waitingTicketCount ?? 0),
      hasOpenVisit: Number(row.hasOpenVisit ?? 0) > 0,
      isCarryOver: String(row.dueDate) < date,
    }));

    return {
      date,
      todayCount: items.filter(item => !item.isCarryOver).length,
      carryOverCount: items.filter(item => item.isCarryOver).length,
      items,
    };
  }

  /** Same authenticated team scope; active feed plus a bounded completed archive. */
  async listWorkspaceTasks(userId: number, date = getRiyadhDateOnly()) {
    const [active, archive] = await Promise.all([this.listTodayTasks(userId, date), this.listTodayTasks(userId, date, true)]);
    const items = Array.from(new Map([...active.items, ...archive.items].map(item => [item.id, item])).values());
    return { ...active, items, archiveLimit: 100, archiveMayHaveMore: archive.items.length === 100 };
  }

  async getVisitState(userId: number, taskId: number) {
    const db = await requireDb();
    const allowed = await db
      .select({ id: pmv2Tasks.id })
      .from(pmv2Tasks)
      .innerJoin(
        pmv2ExecutionActor, pmv2ExecutionActorCondition(userId),
      )
      .where(and(pmv2ExecutionTeamCondition(userId, pmv2Tasks.teamId), eq(pmv2Tasks.id, taskId)))
      .limit(1);

    if (!allowed[0]) throw new Pmv2TechnicianAccessError();

    const openVisits = await db
      .select({ id: pmv2Visits.id, startedAt: pmv2Visits.startedAt })
      .from(pmv2Visits)
      .where(and(eq(pmv2Visits.taskId, taskId), isNull(pmv2Visits.endedAt)))
      .orderBy(desc(pmv2Visits.startedAt), desc(pmv2Visits.id))
      .limit(2);

    if (openVisits.length === 0) {
      return {
        hasOpenVisit: false as const,
        conflict: false,
        visitId: null,
        startedAt: null,
        isMember: false,
        isLeader: false,
      };
    }

    const visit = openVisits[0];
    const membership = await db
      .select({ isLeader: pmv2VisitMembers.isLeader })
      .from(pmv2VisitMembers)
      .where(
        and(
          eq(pmv2VisitMembers.visitId, visit.id),
          eq(pmv2VisitMembers.userId, userId),
        ),
      )
      .limit(1);

    return {
      hasOpenVisit: true as const,
      conflict: openVisits.length > 1,
      visitId: visit.id,
      startedAt: visit.startedAt,
      isMember: Boolean(membership[0]),
      isLeader: Number(membership[0]?.isLeader ?? 0) === 1,
    };
  }


  async getItemEvidence(userId: number, taskId: number, taskItemId: number) {
    const db = await requireDb();
    const allowed = await db
      .select({ id: pmv2TaskItems.id })
      .from(pmv2TaskItems)
      .innerJoin(pmv2Tasks, eq(pmv2Tasks.id, pmv2TaskItems.taskId))
      .innerJoin(
        pmv2ExecutionActor, pmv2ExecutionActorCondition(userId),
      )
      .where(
        and(
          pmv2ExecutionTeamCondition(userId, pmv2Tasks.teamId),
          eq(pmv2Tasks.id, taskId),
          eq(pmv2TaskItems.id, taskItemId),
          eq(pmv2TaskItems.taskId, taskId),
        ),
      )
      .limit(1);

    if (!allowed[0]) throw new Pmv2TechnicianAccessError("البند غير موجود ضمن مهامك");

    const actionRows = await db
      .select({
        id: pmv2ItemActions.id,
        visitId: pmv2ItemActions.visitId,
        action: pmv2ItemActions.action,
        result: pmv2ItemActions.result,
        performedById: pmv2ItemActions.performedById,
        createdAt: pmv2ItemActions.createdAt,
      })
      .from(pmv2ItemActions)
      .where(eq(pmv2ItemActions.taskItemId, taskItemId))
      .orderBy(desc(pmv2ItemActions.id));

    const evidence = await db
      .select({
        id: attachments.id,
        itemActionId: pmv2ItemActions.id,
        action: pmv2ItemActions.action,
        result: pmv2ItemActions.result,
        fileName: attachments.fileName,
        fileUrl: attachments.fileUrl,
        fileKey: attachments.fileKey,
        mimeType: attachments.mimeType,
        fileSize: attachments.fileSize,
        uploadedById: attachments.uploadedById,
        createdAt: attachments.createdAt,
      })
      .from(attachments)
      .innerJoin(
        pmv2ItemActions,
        and(
          eq(attachments.entityType, "pmv2_item_action"),
          eq(attachments.entityId, pmv2ItemActions.id),
        ),
      )
      .where(eq(pmv2ItemActions.taskItemId, taskItemId))
      .orderBy(desc(attachments.createdAt), desc(attachments.id));

    const openVisits = await db
      .select({ id: pmv2Visits.id })
      .from(pmv2Visits)
      .where(and(eq(pmv2Visits.taskId, taskId), isNull(pmv2Visits.endedAt)))
      .orderBy(desc(pmv2Visits.startedAt), desc(pmv2Visits.id))
      .limit(2);

    let uploadActionId: number | null = null;
    let uploadBlockedReason: "no_open_visit" | "visit_conflict" | "no_own_action" | null = null;

    if (openVisits.length === 0) {
      uploadBlockedReason = "no_open_visit";
    } else if (openVisits.length > 1) {
      uploadBlockedReason = "visit_conflict";
    } else {
      const openVisitId = openVisits[0].id;
      const ownAction = actionRows.find(
        row => Number(row.visitId) === Number(openVisitId) && Number(row.performedById) === Number(userId),
      );
      if (ownAction) uploadActionId = ownAction.id;
      else uploadBlockedReason = "no_own_action";
    }

    return {
      taskId,
      taskItemId,
      uploadActionId,
      uploadBlockedReason,
      evidence,
    };
  }

  async listTaskItems(userId: number, taskId: number, language: "ar" | "en" | "ur" = "ar") {
    const db = await requireDb();
    const allowed = await db
      .select({ id: pmv2Tasks.id })
      .from(pmv2Tasks)
      .innerJoin(
        pmv2ExecutionActor, pmv2ExecutionActorCondition(userId),
      )
      .where(and(pmv2ExecutionTeamCondition(userId, pmv2Tasks.teamId), eq(pmv2Tasks.id, taskId)))
      .limit(1);

    if (!allowed[0]) throw new Pmv2TechnicianAccessError();

    const items = await db
      .select({
        id: pmv2TaskItems.id,
        taskId: pmv2TaskItems.taskId,
        titleSnapshot: pmv2TaskItems.titleSnapshot,
        sortOrderSnapshot: pmv2TaskItems.sortOrderSnapshot,
        scheduledDate: pmv2TaskItems.scheduledDate,
        status: pmv2TaskItems.status,
        result: pmv2TaskItems.result,
        recurrenceLabelSnapshot: pmv2TaskItems.recurrenceLabelSnapshot,
      })
      .from(pmv2TaskItems)
      .where(eq(pmv2TaskItems.taskId, taskId))
      .orderBy(asc(pmv2TaskItems.sortOrderSnapshot), asc(pmv2TaskItems.id));

    const itemIds = items.map(item => Number(item.id));
    if (itemIds.length === 0) return items.map(item => ({ ...item, linkedTicket: null }));

    const links = await db
      .select({
        id: pmv2TaskTicketLinks.id,
        taskItemId: pmv2TaskTicketLinks.taskItemId,
        ticketId: pmv2TaskTicketLinks.ticketId,
        createdAt: pmv2TaskTicketLinks.createdAt,
      })
      .from(pmv2TaskTicketLinks)
      .where(inArray(pmv2TaskTicketLinks.taskItemId, itemIds))
      .orderBy(desc(pmv2TaskTicketLinks.createdAt), desc(pmv2TaskTicketLinks.id));

    const latestLinkByItem = new Map<number, { ticketId: number }>();
    for (const link of links) {
      const taskItemId = Number(link.taskItemId);
      if (!latestLinkByItem.has(taskItemId)) {
        latestLinkByItem.set(taskItemId, { ticketId: Number(link.ticketId) });
      }
    }

    const localizedTitles = isPmv2SimplifiedEnabled() ? await loadAuthorizedTaskItemTitles(db, itemIds, language) : null;

    const ticketIds = [...new Set([...latestLinkByItem.values()].map(link => link.ticketId))];
    const ticketRefs = await currentTicketAdapter.getTicketsByIds(ticketIds);
    const ticketById = new Map(ticketRefs.map(ticket => [ticket.id, ticket]));

    return items.map(item => {
      const link = latestLinkByItem.get(Number(item.id));
      return {
        ...item,
        ...(localizedTitles ? { localizedTitle: localizedTitles.get(Number(item.id)) ?? item.titleSnapshot } : {}),
        linkedTicket: link ? (ticketById.get(link.ticketId) ?? null) : null,
      };
    });
  }
}

export const pmv2TechnicianReadService = new Pmv2TechnicianReadService();

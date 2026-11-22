import { and, asc, desc, eq, inArray, lt, ne, notInArray, or, sql } from "drizzle-orm";
import {
  assets,
  pmv2Checklists,
  pmv2ItemActions,
  pmv2Programs,
  pmv2DailyReportReviews,
  pmv2ProgramTargets,
  pmv2TaskItems,
  pmv2Tasks,
  pmv2TeamMembers,
  pmv2Teams,
  pmv2VisitMembers,
  pmv2Visits,
  sections,
  sites,
  users,
} from "../../../drizzle/schema";
import { getDb } from "../../_core/db/client";
import { pmv2TaskTimelineService } from "../tracking/timeline-service";
import { queuePmv2Translation } from "../translation-queue";
import { isPmv2SimplifiedEnabled } from "../simplified/feature";
import { listPmv2Members } from "../security/team-membership-list";
import { loadUnifiedTeamNames } from "../security/unified-team-names";

async function requireDb() {
  const db = await getDb();
  if (!db) throw new Error("تعذر الاتصال بقاعدة البيانات");
  return db;
}

function isMissingReviewTableError(error: unknown) {
  const anyError = error as any;
  return anyError?.code === "ER_NO_SUCH_TABLE" || String(anyError?.message || "").includes("pmv2_daily_report_reviews");
}

function asIso(value: unknown): string | null {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toISOString();
}

function dayBounds(date: string) {
  const start = new Date(`${date}T00:00:00+03:00`);
  const end = new Date(`${date}T24:00:00+03:00`);
  return { start, end };
}

function minutesOverlap(startValue: unknown, endValue: unknown, dayStart: Date, dayEnd: Date) {
  const start = startValue == null ? NaN : new Date(String(startValue)).getTime();
  const end = endValue == null ? dayEnd.getTime() : new Date(String(endValue)).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  const from = Math.max(start, dayStart.getTime());
  const to = Math.min(end, dayEnd.getTime());
  return to > from ? Math.round((to - from) / 60000) : 0;
}

function inDay(value: unknown, start: Date, end: Date) {
  if (value == null) return false;
  const time = new Date(String(value)).getTime();
  return Number.isFinite(time) && time >= start.getTime() && time < end.getTime();
}

function outcomeLabel(code: string) {
  if (code === "completed") return "منجزة اليوم";
  if (code === "worked_pending") return "بدأت وما زالت معلقة";
  if (code === "not_started") return "لم تبدأ اليوم";
  if (code === "carryover_open") return "مرحلة من يوم سابق";
  return code;
}

export type DailyReportFilters = {
  date: string;
  teamId?: number;
  technicianUserId?: number;
};

export class Pmv2DailyReportService {
  async listFilters() {
    const db = await requireDb();
    const [teams, technicians] = await Promise.all([
      db.select({ id: pmv2Teams.id, code: pmv2Teams.code })
        .from(pmv2Teams)
        .where(eq(pmv2Teams.isActive, 1))
        .orderBy(asc(pmv2Teams.code)),
      isPmv2SimplifiedEnabled()
        ? listPmv2Members(db, { includeInactiveTeams: true }).then(rows => rows.map(row => ({ ...row, name: row.userName })).sort((a,b) => a.name.localeCompare(b.name) || a.teamCode.localeCompare(b.teamCode)))
        : db.selectDistinct({
          userId: users.id,
          name: users.name,
          teamId: pmv2TeamMembers.teamId,
          teamCode: pmv2Teams.code,
        })
          .from(pmv2TeamMembers)
          .innerJoin(pmv2Teams, eq(pmv2Teams.id, pmv2TeamMembers.teamId))
          .innerJoin(users, eq(users.id, pmv2TeamMembers.userId))
          .where(and(eq(pmv2TeamMembers.isActive, 1), eq(users.isActive, 1)))
          .orderBy(asc(users.name), asc(pmv2Teams.code)),
    ]);

    return {
      teams: teams.map((row) => ({ id: Number(row.id), code: String(row.code) })),
      technicians: technicians.map((row) => ({
        userId: Number(row.userId),
        name: row.name || `مستخدم #${row.userId}`,
        teamId: Number(row.teamId),
        teamCode: String(row.teamCode),
      })),
    };
  }

  async getReview(date: string, teamId: number) {
    const db = await requireDb();
    try {
      const rows = await db.select({
        id: pmv2DailyReportReviews.id,
        reportDate: pmv2DailyReportReviews.reportDate,
        teamId: pmv2DailyReportReviews.teamId,
        reviewedById: pmv2DailyReportReviews.reviewedById,
        reviewerName: users.name,
        reviewedAt: pmv2DailyReportReviews.reviewedAt,
        note: pmv2DailyReportReviews.note,
      })
        .from(pmv2DailyReportReviews)
        .leftJoin(users, eq(users.id, pmv2DailyReportReviews.reviewedById))
        .where(and(
          eq(pmv2DailyReportReviews.reportDate, date),
          eq(pmv2DailyReportReviews.teamId, teamId),
        ))
        .limit(1);
      const row = rows[0];
      return row ? {
        id: Number(row.id),
        reportDate: String(row.reportDate),
        teamId: Number(row.teamId),
        reviewedById: Number(row.reviewedById),
        reviewerName: row.reviewerName || `مستخدم #${row.reviewedById}`,
        reviewedAt: asIso(row.reviewedAt),
        note: row.note == null ? null : String(row.note),
      } : null;
    } catch (error) {
      if (isMissingReviewTableError(error)) return null;
      throw error;
    }
  }

  async markReviewed(input: { date: string; teamId: number; reviewedById: number; note?: string | null }) {
    const db = await requireDb();
    try {
      await db.insert(pmv2DailyReportReviews).values({
        reportDate: input.date,
        teamId: input.teamId,
        reviewedById: input.reviewedById,
        note: input.note?.trim() || null,
      }).onDuplicateKeyUpdate({
        set: {
          reviewedById: input.reviewedById,
          reviewedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
          note: input.note?.trim() || null,
        },
      });
    } catch (error) {
      if (isMissingReviewTableError(error)) {
        throw new Error("يلزم تطبيق ترحيل PATCH142 لجدول مراجعة تقارير PM V2 أولًا");
      }
      throw error;
    }
    const review = await this.getReview(input.date, input.teamId);
    const note = input.note?.trim() || null;
    if (review?.id && note) {
      await queuePmv2Translation("PMV2_DAILY_REPORT_REVIEW", Number(review.id), [{ fieldName: "note", text: note }], input.reviewedById);
    }
    return review;
  }

  async clearReview(date: string, teamId: number) {
    const db = await requireDb();
    try {
      await db.delete(pmv2DailyReportReviews).where(and(
        eq(pmv2DailyReportReviews.reportDate, date),
        eq(pmv2DailyReportReviews.teamId, teamId),
      ));
    } catch (error) {
      if (isMissingReviewTableError(error)) {
        throw new Error("يلزم تطبيق ترحيل PATCH142 لجدول مراجعة تقارير PM V2 أولًا");
      }
      throw error;
    }
    return { ok: true };
  }

  async getDailyReport(filters: DailyReportFilters) {
    const db = await requireDb();
    const { start: dayStart, end: dayEnd } = dayBounds(filters.date);
    const now = new Date();
    const effectiveDayEnd = now.getTime() > dayStart.getTime() && now.getTime() < dayEnd.getTime() ? now : dayEnd;

    let allowedTeamIds: number[] | null = null;
    if (filters.technicianUserId) {
      const memberships = isPmv2SimplifiedEnabled()
        ? await listPmv2Members(db, { userId: filters.technicianUserId, includeInactiveUsers: true, includeInactiveTeams: true })
        : await db.select({ teamId: pmv2TeamMembers.teamId })
          .from(pmv2TeamMembers)
          .where(and(
            eq(pmv2TeamMembers.userId, filters.technicianUserId),
            eq(pmv2TeamMembers.isActive, 1),
          ));
      allowedTeamIds = memberships.map((row) => Number(row.teamId));
      if (filters.teamId && !allowedTeamIds.includes(filters.teamId)) allowedTeamIds = [];
    }

    const taskConditions: any[] = [ne(pmv2Tasks.status, "cancelled")];
    if (filters.teamId) taskConditions.push(eq(pmv2Tasks.teamId, filters.teamId));
    else if (allowedTeamIds) {
      if (!allowedTeamIds.length) return this.emptyReport(filters, filters.teamId ? await this.getReview(filters.date, filters.teamId) : null);
      taskConditions.push(inArray(pmv2Tasks.teamId, allowedTeamIds));
    }

    // Daily report scope:
    // 1) everything scheduled for the selected day,
    // 2) every older task that is still open (carry-over),
    // 3) completed carry-over tasks that had PM V2 activity on the selected day.
    const candidateRows = await db.select({
      id: pmv2Tasks.id,
      taskNumber: pmv2Tasks.taskNumber,
      dueDate: pmv2Tasks.dueDate,
      status: pmv2Tasks.status,
      teamId: pmv2Tasks.teamId,
      teamCode: pmv2Teams.code,
      checklistId: pmv2Checklists.id,
      checklistName: pmv2Checklists.name,
      siteName: sites.name,
      sectionName: sections.name,
      assetName: assets.name,
    })
      .from(pmv2Tasks)
      .innerJoin(pmv2Teams, eq(pmv2Teams.id, pmv2Tasks.teamId))
      .innerJoin(pmv2Programs, eq(pmv2Programs.id, pmv2Tasks.programId))
      .innerJoin(pmv2Checklists, eq(pmv2Checklists.id, pmv2Programs.checklistId))
      .innerJoin(pmv2ProgramTargets, eq(pmv2ProgramTargets.id, pmv2Tasks.programTargetId))
      .leftJoin(sites, eq(sites.id, pmv2ProgramTargets.siteId))
      .leftJoin(sections, eq(sections.id, pmv2ProgramTargets.sectionId))
      .leftJoin(assets, eq(assets.id, pmv2ProgramTargets.assetId))
      .where(and(
        ...taskConditions,
        or(
          eq(pmv2Tasks.dueDate, filters.date),
          and(lt(pmv2Tasks.dueDate, filters.date), notInArray(pmv2Tasks.status, ["completed", "cancelled"])),
          sql<boolean>`exists (
            select 1 from ${pmv2TaskItems} ti
            inner join ${pmv2ItemActions} ia on ia.taskItemId = ti.id
            where ti.taskId = ${pmv2Tasks.id}
              and date(date_add(ia.createdAt, interval 3 hour)) = ${filters.date}
          )`,
          sql<boolean>`exists (
            select 1 from ${pmv2Visits} v
            where v.taskId = ${pmv2Tasks.id}
              and (
                date(date_add(v.startedAt, interval 3 hour)) = ${filters.date}
                or date(date_add(v.endedAt, interval 3 hour)) = ${filters.date}
              )
          )`,
        ),
      ))
      .orderBy(asc(pmv2Tasks.dueDate), asc(pmv2Tasks.taskNumber));

    const taskIds = candidateRows.map((row) => Number(row.id));
    if (!taskIds.length) return this.emptyReport(filters, filters.teamId ? await this.getReview(filters.date, filters.teamId) : null);

    const [itemRows, actionRows, visitRows] = await Promise.all([
      db.select({
        id: pmv2TaskItems.id,
        taskId: pmv2TaskItems.taskId,
        title: pmv2TaskItems.titleSnapshot,
        status: pmv2TaskItems.status,
        result: pmv2TaskItems.result,
        sortOrder: pmv2TaskItems.sortOrderSnapshot,
      })
        .from(pmv2TaskItems)
        .where(inArray(pmv2TaskItems.taskId, taskIds))
        .orderBy(asc(pmv2TaskItems.taskId), asc(pmv2TaskItems.sortOrderSnapshot), asc(pmv2TaskItems.id)),
      db.select({
        id: pmv2ItemActions.id,
        taskId: pmv2TaskItems.taskId,
        taskItemId: pmv2ItemActions.taskItemId,
        taskItemTitle: pmv2TaskItems.titleSnapshot,
        visitId: pmv2ItemActions.visitId,
        action: pmv2ItemActions.action,
        result: pmv2ItemActions.result,
        note: pmv2ItemActions.note,
        performedById: pmv2ItemActions.performedById,
        performerName: users.name,
        createdAt: pmv2ItemActions.createdAt,
      })
        .from(pmv2ItemActions)
        .innerJoin(pmv2TaskItems, eq(pmv2TaskItems.id, pmv2ItemActions.taskItemId))
        .leftJoin(users, eq(users.id, pmv2ItemActions.performedById))
        .where(inArray(pmv2TaskItems.taskId, taskIds))
        .orderBy(asc(pmv2ItemActions.createdAt), asc(pmv2ItemActions.id)),
      db.select({
        id: pmv2Visits.id,
        taskId: pmv2Visits.taskId,
        startedAt: pmv2Visits.startedAt,
        endedAt: pmv2Visits.endedAt,
      })
        .from(pmv2Visits)
        .where(inArray(pmv2Visits.taskId, taskIds))
        .orderBy(asc(pmv2Visits.startedAt), asc(pmv2Visits.id)),
    ]);

    const visitIds = visitRows.map((row) => Number(row.id));
    const visitMembers = visitIds.length ? await db.select({
      visitId: pmv2VisitMembers.visitId,
      userId: pmv2VisitMembers.userId,
      isLeader: pmv2VisitMembers.isLeader,
      name: users.name,
    })
      .from(pmv2VisitMembers)
      .leftJoin(users, eq(users.id, pmv2VisitMembers.userId))
      .where(inArray(pmv2VisitMembers.visitId, visitIds)) : [];

    const itemsByTask = new Map<number, typeof itemRows>();
    for (const item of itemRows) {
      const key = Number(item.taskId);
      const group = itemsByTask.get(key) ?? [];
      group.push(item);
      itemsByTask.set(key, group);
    }
    const actionsByTask = new Map<number, typeof actionRows>();
    for (const action of actionRows) {
      const key = Number(action.taskId);
      const group = actionsByTask.get(key) ?? [];
      group.push(action);
      actionsByTask.set(key, group);
    }
    const visitsByTask = new Map<number, typeof visitRows>();
    for (const visit of visitRows) {
      const key = Number(visit.taskId);
      const group = visitsByTask.get(key) ?? [];
      group.push(visit);
      visitsByTask.set(key, group);
    }
    const membersByVisit = new Map<number, typeof visitMembers>();
    for (const member of visitMembers) {
      const key = Number(member.visitId);
      const group = membersByVisit.get(key) ?? [];
      group.push(member);
      membersByVisit.set(key, group);
    }

    const unifiedNames = await loadUnifiedTeamNames(db, candidateRows.map(row => Number(row.teamId)));
    const taskReports = await Promise.all(candidateRows.map(async (row) => {
      const taskId = Number(row.id);
      const items = itemsByTask.get(taskId) ?? [];
      const allActions = actionsByTask.get(taskId) ?? [];
      const dayActions = allActions.filter((action) => inDay(action.createdAt, dayStart, dayEnd));
      const allVisits = visitsByTask.get(taskId) ?? [];
      const dayVisits = allVisits.filter((visit) => minutesOverlap(visit.startedAt, visit.endedAt, dayStart, effectiveDayEnd) > 0);
      const scheduledForDate = String(row.dueDate) === filters.date;
      const carryOver = String(row.dueDate) < filters.date;
      const activityToday = dayActions.length > 0 || dayVisits.length > 0;
      const completedToday = dayActions.some((action) =>
        (action.action === "submit_result" && ["ok", "fixed"].includes(String(action.result || "")))
        || action.action === "ticket_closed_completion",
      ) && String(row.status) === "completed";

      const relevantTechActions = filters.technicianUserId
        ? dayActions.filter((action) => Number(action.performedById) === filters.technicianUserId)
        : dayActions;
      const participatedVisitIds = new Set<number>();
      for (const visit of dayVisits) {
        const members = membersByVisit.get(Number(visit.id)) ?? [];
        if (!filters.technicianUserId || members.some((member) => Number(member.userId) === filters.technicianUserId)) {
          participatedVisitIds.add(Number(visit.id));
        }
      }
      const scopedDayVisits = filters.technicianUserId
        ? dayVisits.filter((visit) => participatedVisitIds.has(Number(visit.id)))
        : dayVisits;
      const technicianParticipatedToday = filters.technicianUserId
        ? relevantTechActions.length > 0 || participatedVisitIds.size > 0
        : activityToday;

      let outcome = "not_started";
      if (completedToday) outcome = "completed";
      else if (activityToday) outcome = "worked_pending";
      else if (carryOver) outcome = "carryover_open";

      const dayNotes = (filters.technicianUserId ? relevantTechActions : dayActions)
        .filter((action) => String(action.note || "").trim().length > 0)
        .map((action) => ({
          actionId: Number(action.id),
          taskItemId: Number(action.taskItemId),
          taskItemTitle: String(action.taskItemTitle),
          note: String(action.note).trim(),
          performedById: Number(action.performedById),
          performedByName: action.performerName || `مستخدم #${action.performedById}`,
          at: asIso(action.createdAt),
        }));

      const participantsMap = new Map<number, { userId: number; name: string; isLeader: boolean }>();
      for (const visit of dayVisits) {
        for (const member of membersByVisit.get(Number(visit.id)) ?? []) {
          const userId = Number(member.userId);
          const existing = participantsMap.get(userId);
          participantsMap.set(userId, {
            userId,
            name: member.name || `مستخدم #${userId}`,
            isLeader: Boolean(existing?.isLeader || Number(member.isLeader) === 1),
          });
        }
      }
      for (const action of dayActions) {
        const userId = Number(action.performedById);
        if (!participantsMap.has(userId)) participantsMap.set(userId, {
          userId,
          name: action.performerName || `مستخدم #${userId}`,
          isLeader: false,
        });
      }

      const activityTimes = [
        ...dayActions.map((action) => new Date(String(action.createdAt)).getTime()),
        ...dayVisits.flatMap((visit) => [
          new Date(String(visit.startedAt)).getTime(),
          visit.endedAt ? new Date(String(visit.endedAt)).getTime() : NaN,
        ]),
      ].filter(Number.isFinite) as number[];

      const dayVisitMinutes = dayVisits.reduce((sum, visit) => sum + minutesOverlap(visit.startedAt, visit.endedAt, dayStart, effectiveDayEnd), 0);
      const technicianVisitMinutesToday = scopedDayVisits.reduce((sum, visit) => sum + minutesOverlap(visit.startedAt, visit.endedAt, dayStart, effectiveDayEnd), 0);
      const hasOpenVisit = dayVisits.some((visit) => visit.endedAt == null);
      const timeline = String(row.status) === "completed" && !carryOver
        ? null
        : await pmv2TaskTimelineService.getForManagement(taskId);
      const current = timeline?.summary.currentResponsibility ?? null;

      return {
        id: taskId,
        taskNumber: String(row.taskNumber),
        dueDate: String(row.dueDate),
        status: String(row.status),
        teamId: Number(row.teamId),
        teamCode: unifiedNames.get(Number(row.teamId)) ?? String(row.teamCode),
        checklistId: Number(row.checklistId),
        checklistName: String(row.checklistName),
        targetLabel: row.assetName ? `أصل: ${row.assetName}` : row.sectionName ? `قسم: ${row.sectionName}` : row.siteName ? `موقع: ${row.siteName}` : "—",
        scheduledForDate,
        carryOver,
        activityToday,
        technicianParticipatedToday,
        outcome,
        outcomeLabel: outcomeLabel(outcome),
        firstActivityAt: activityTimes.length ? new Date(Math.min(...activityTimes)).toISOString() : null,
        lastActivityAt: activityTimes.length ? new Date(Math.max(...activityTimes)).toISOString() : null,
        visitMinutesToday: dayVisitMinutes,
        technicianVisitMinutesToday,
        hasOpenVisit,
        notes: dayNotes,
        participants: [...participantsMap.values()].sort((a, b) => Number(b.isLeader) - Number(a.isLeader) || a.name.localeCompare(b.name, "ar")),
        items: items.map((item) => ({
          id: Number(item.id),
          title: String(item.title),
          status: String(item.status),
          result: item.result == null ? null : String(item.result),
        })),
        currentResponsibility: current,
        currentSince: current?.since ?? null,
        totalAgeMinutes: timeline?.summary.totalAgeMinutes ?? 0,
      };
    }));

    const scheduled = taskReports.filter((task) => task.scheduledForDate);
    const completed = scheduled.filter((task) => task.outcome === "completed");
    const workedPending = scheduled.filter((task) => task.outcome === "worked_pending");
    const notStarted = scheduled.filter((task) => task.outcome === "not_started");
    const carryOverOpen = taskReports.filter((task) => task.carryOver && task.status !== "completed");
    const carryOverWorked = taskReports.filter((task) => task.carryOver && task.activityToday);

    const summary = {
      assignedToday: scheduled.length,
      completedToday: completed.length,
      workedPending: workedPending.length,
      notStarted: notStarted.length,
      carryOverOpen: carryOverOpen.length,
      carryOverWorked: carryOverWorked.length,
      completionRate: scheduled.length ? Math.round((completed.length / scheduled.length) * 100) : 0,
      visitMinutesToday: taskReports.reduce((sum, task) => sum + Number(task.visitMinutesToday || 0), 0),
      techniciansActive: new Set(taskReports.flatMap((task) => task.participants.map((participant) => participant.userId))).size,
      openVisits: taskReports.filter((task) => task.hasOpenVisit).length,
      technicianParticipatedAssigned: filters.technicianUserId ? scheduled.filter((task) => task.technicianParticipatedToday).length : null,
      technicianParticipatedCompleted: filters.technicianUserId ? completed.filter((task) => task.technicianParticipatedToday).length : null,
      technicianVisitMinutesToday: filters.technicianUserId ? taskReports.reduce((sum, task) => sum + Number(task.technicianVisitMinutesToday || 0), 0) : null,
    };

    const review = filters.teamId ? await this.getReview(filters.date, filters.teamId) : null;

    return {
      date: filters.date,
      generatedAt: new Date().toISOString(),
      filters: { teamId: filters.teamId ?? null, technicianUserId: filters.technicianUserId ?? null },
      review,
      assignmentScope: filters.technicianUserId
        ? "PM V2 يكلّف المهمة على مستوى الفريق؛ مقارنة الفني تعرض مهام فريقه مع مشاركته الفعلية المسجلة في الزيارات والإجراءات."
        : "التكليف في PM V2 على مستوى الفريق، والتقرير يقارن مهام الفريق المجدولة بما تم تنفيذه فعليًا.",
      summary,
      tasks: taskReports,
    };
  }

  private emptyReport(filters: DailyReportFilters, review: any = null) {
    return {
      date: filters.date,
      generatedAt: new Date().toISOString(),
      filters: { teamId: filters.teamId ?? null, technicianUserId: filters.technicianUserId ?? null },
      review,
      assignmentScope: filters.technicianUserId
        ? "PM V2 يكلّف المهمة على مستوى الفريق؛ مقارنة الفني تعرض مهام فريقه مع مشاركته الفعلية المسجلة في الزيارات والإجراءات."
        : "التكليف في PM V2 على مستوى الفريق، والتقرير يقارن مهام الفريق المجدولة بما تم تنفيذه فعليًا.",
      summary: {
        assignedToday: 0,
        completedToday: 0,
        workedPending: 0,
        notStarted: 0,
        carryOverOpen: 0,
        carryOverWorked: 0,
        completionRate: 0,
        visitMinutesToday: 0,
        techniciansActive: 0,
        openVisits: 0,
        technicianParticipatedAssigned: filters.technicianUserId ? 0 : null,
        technicianParticipatedCompleted: filters.technicianUserId ? 0 : null,
        technicianVisitMinutesToday: filters.technicianUserId ? 0 : null,
      },
      tasks: [] as any[],
    };
  }
}

export const pmv2DailyReportService = new Pmv2DailyReportService();

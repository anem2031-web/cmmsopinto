import { and, asc, desc, eq, gte, like, lt, lte, notInArray, or, sql } from "drizzle-orm";
import {
  assets,
  pmv2Checklists,
  pmv2ChecklistItems,
  pmv2Programs,
  pmv2ProgramTargets,
  pmv2TaskItems,
  pmv2Tasks,
  pmv2Teams,
  sections,
  sites,
} from "../../../drizzle/schema";
import { getDb } from "../../_core/db/client";
import { loadUnifiedTeamNames } from "../security/unified-team-names";
import {
  PMV2_DAILY_TEAM_CAPACITY_MINUTES,
  PMV2_DAILY_WORKLOAD_AVAILABLE_THROUGH_MINUTES,
  PMV2_DAILY_WORKLOAD_HIGH_THROUGH_MINUTES,
  PMV2_DAILY_WORKLOAD_MEDIUM_THROUGH_MINUTES,
  classifyPmv2DailyWorkload,
} from "./workload";

async function requireDb() {
  const db = await getDb();
  if (!db) throw new Error("تعذر الاتصال بقاعدة البيانات");
  return db;
}

export type Pmv2DailyWorkloadFilters = {
  dateFrom: string;
  dateTo: string;
  teamId?: number;
};

export type Pmv2TaskListFilters = {
  page?: number;
  pageSize?: number;
  search?: string;
  teamId?: number;
  dateFrom?: string;
  dateTo?: string;
  overdueBefore?: string;
  excludeFinished?: boolean;
  excludeCancelled?: boolean;
};

function buildTaskWhere(filters: Pmv2TaskListFilters) {
  const conditions: any[] = [];
  if (filters.teamId) conditions.push(eq(pmv2Tasks.teamId, filters.teamId));
  if (filters.dateFrom && filters.dateTo && filters.dateFrom === filters.dateTo) {
    conditions.push(eq(pmv2Tasks.dueDate, filters.dateFrom));
  } else {
    if (filters.dateFrom) conditions.push(gte(pmv2Tasks.dueDate, filters.dateFrom));
    if (filters.dateTo) conditions.push(lte(pmv2Tasks.dueDate, filters.dateTo));
  }
  if (filters.overdueBefore) conditions.push(lt(pmv2Tasks.dueDate, filters.overdueBefore));
  if (filters.excludeFinished) {
    conditions.push(notInArray(pmv2Tasks.status, ["completed", "cancelled"]));
  } else if (filters.excludeCancelled) {
    conditions.push(notInArray(pmv2Tasks.status, ["cancelled"]));
  }

  const search = filters.search?.trim();
  if (search) {
    const pattern = `%${search}%`;
    conditions.push(or(
      like(pmv2Tasks.taskNumber, pattern),
      like(pmv2Teams.code, pattern),
      like(pmv2Checklists.name, pattern),
      like(sites.name, pattern),
      like(sections.name, pattern),
      like(assets.name, pattern),
    ));
  }
  return conditions.length ? and(...conditions) : undefined;
}

function taskBaseSelect(db: Awaited<ReturnType<typeof requireDb>>) {
  return db
    .select({
      id: pmv2Tasks.id,
      taskNumber: pmv2Tasks.taskNumber,
      dueDate: pmv2Tasks.dueDate,
      status: pmv2Tasks.status,
      programId: pmv2Tasks.programId,
      programTargetId: pmv2Tasks.programTargetId,
      teamId: pmv2Tasks.teamId,
      teamCode: pmv2Teams.code,
      estimatedDurationMinutes: pmv2Programs.estimatedDurationMinutes,
      checklistName: pmv2Checklists.name,
      siteId: pmv2ProgramTargets.siteId,
      siteName: sites.name,
      sectionId: pmv2ProgramTargets.sectionId,
      sectionName: sections.name,
      assetId: pmv2ProgramTargets.assetId,
      assetName: assets.name,
    })
    .from(pmv2Tasks)
    .innerJoin(pmv2Programs, eq(pmv2Programs.id, pmv2Tasks.programId))
    .innerJoin(pmv2Teams, eq(pmv2Teams.id, pmv2Tasks.teamId))
    .innerJoin(pmv2Checklists, eq(pmv2Checklists.id, pmv2Programs.checklistId))
    .innerJoin(pmv2ProgramTargets, eq(pmv2ProgramTargets.id, pmv2Tasks.programTargetId))
    .leftJoin(sites, eq(sites.id, pmv2ProgramTargets.siteId))
    .leftJoin(sections, eq(sections.id, pmv2ProgramTargets.sectionId))
    .leftJoin(assets, eq(assets.id, pmv2ProgramTargets.assetId));
}

export class Pmv2TaskReadService {
  async listDailyTeamWorkload(filters: Pmv2DailyWorkloadFilters) {
    const db = await requireDb();
    const conditions: any[] = [
      gte(pmv2Tasks.dueDate, filters.dateFrom),
      lte(pmv2Tasks.dueDate, filters.dateTo),
      notInArray(pmv2Tasks.status, ["cancelled"]),
    ];
    if (filters.teamId) conditions.push(eq(pmv2Tasks.teamId, filters.teamId));

    const rows = await db
      .select({
        teamId: pmv2Tasks.teamId,
        teamCode: pmv2Teams.code,
        dueDate: pmv2Tasks.dueDate,
        taskCount: sql<number>`count(*)`,
        estimatedTaskCount: sql<number>`sum(case when ${pmv2Programs.estimatedDurationMinutes} is not null then 1 else 0 end)`,
        unknownDurationTaskCount: sql<number>`sum(case when ${pmv2Programs.estimatedDurationMinutes} is null then 1 else 0 end)`,
        totalEstimatedMinutes: sql<number>`coalesce(sum(coalesce(${pmv2Programs.estimatedDurationMinutes}, 0)), 0)`,
      })
      .from(pmv2Tasks)
      .innerJoin(pmv2Programs, eq(pmv2Programs.id, pmv2Tasks.programId))
      .innerJoin(pmv2Teams, eq(pmv2Teams.id, pmv2Tasks.teamId))
      .where(and(...conditions))
      .groupBy(pmv2Tasks.teamId, pmv2Teams.code, pmv2Tasks.dueDate)
      .orderBy(asc(pmv2Tasks.dueDate), asc(pmv2Teams.code));

    const unifiedNames = await loadUnifiedTeamNames(db, rows.map(row => Number(row.teamId)));
    const items = rows.map(row => {
      const taskCount = Number(row.taskCount ?? 0);
      const estimatedTaskCount = Number(row.estimatedTaskCount ?? 0);
      const unknownDurationTaskCount = Number(row.unknownDurationTaskCount ?? 0);
      const totalEstimatedMinutes = Number(row.totalEstimatedMinutes ?? 0);
      return {
        teamId: Number(row.teamId),
        teamCode: unifiedNames.get(Number(row.teamId)) ?? row.teamCode,
        dueDate: row.dueDate,
        taskCount,
        estimatedTaskCount,
        unknownDurationTaskCount,
        totalEstimatedMinutes,
        estimateComplete: taskCount > 0 && unknownDurationTaskCount === 0,
        status: classifyPmv2DailyWorkload(totalEstimatedMinutes),
      };
    });

    return {
      items,
      capacityMinutes: PMV2_DAILY_TEAM_CAPACITY_MINUTES,
      thresholds: {
        availableThroughMinutes: PMV2_DAILY_WORKLOAD_AVAILABLE_THROUGH_MINUTES,
        mediumThroughMinutes: PMV2_DAILY_WORKLOAD_MEDIUM_THROUGH_MINUTES,
        highThroughMinutes: PMV2_DAILY_WORKLOAD_HIGH_THROUGH_MINUTES,
      },
    };
  }

  async listTasks(filters: Pmv2TaskListFilters = {}) {
    const db = await requireDb();
    const page = Math.max(1, filters.page ?? 1);
    const pageSize = Math.min(50, Math.max(1, filters.pageSize ?? 25));
    const offset = (page - 1) * pageSize;
    const where = buildTaskWhere(filters);

    const items = await taskBaseSelect(db)
      .where(where)
      .orderBy(asc(pmv2Tasks.dueDate), desc(pmv2Tasks.id))
      .limit(pageSize)
      .offset(offset);

    const countRows = await db
      .select({ total: sql<number>`count(*)` })
      .from(pmv2Tasks)
      .innerJoin(pmv2Programs, eq(pmv2Programs.id, pmv2Tasks.programId))
      .innerJoin(pmv2Teams, eq(pmv2Teams.id, pmv2Tasks.teamId))
      .innerJoin(pmv2Checklists, eq(pmv2Checklists.id, pmv2Programs.checklistId))
      .innerJoin(pmv2ProgramTargets, eq(pmv2ProgramTargets.id, pmv2Tasks.programTargetId))
      .leftJoin(sites, eq(sites.id, pmv2ProgramTargets.siteId))
      .leftJoin(sections, eq(sections.id, pmv2ProgramTargets.sectionId))
      .leftJoin(assets, eq(assets.id, pmv2ProgramTargets.assetId))
      .where(where);

    const total = Number(countRows[0]?.total ?? 0);
    const unifiedNames = await loadUnifiedTeamNames(db, items.map(row => Number(row.teamId)));
    return { items: items.map(row => ({ ...row, teamCode: unifiedNames.get(Number(row.teamId)) ?? row.teamCode })), total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
  }

  async listTaskItems(taskId: number) {
    const db = await requireDb();
    return db
      .select({
        id: pmv2TaskItems.id,
        taskId: pmv2TaskItems.taskId,
        sourceChecklistItemId: pmv2TaskItems.sourceChecklistItemId,
        titleSnapshot: pmv2TaskItems.titleSnapshot,
        sortOrderSnapshot: pmv2TaskItems.sortOrderSnapshot,
        frequencySnapshot: sql<string | null>`coalesce(${pmv2TaskItems.frequencySnapshot}, ${pmv2ChecklistItems.frequency})`,
        frequencyValueSnapshot: sql<number | null>`case when ${pmv2TaskItems.frequencySnapshot} is null then ${pmv2ChecklistItems.frequencyValue} else ${pmv2TaskItems.frequencyValueSnapshot} end`,
        weekdaySnapshot: sql<number | null>`case when ${pmv2TaskItems.frequencySnapshot} is null then ${pmv2ChecklistItems.weekday} else ${pmv2TaskItems.weekdaySnapshot} end`,
        monthDaySnapshot: sql<number | null>`case when ${pmv2TaskItems.frequencySnapshot} is null then ${pmv2ChecklistItems.monthDay} else ${pmv2TaskItems.monthDaySnapshot} end`,
        anchorDateSnapshot: sql<string | null>`case when ${pmv2TaskItems.frequencySnapshot} is null then ${pmv2ChecklistItems.anchorDate} else ${pmv2TaskItems.anchorDateSnapshot} end`,
        recurrenceLabelSnapshot: pmv2TaskItems.recurrenceLabelSnapshot,
        scheduledDate: pmv2TaskItems.scheduledDate,
        status: pmv2TaskItems.status,
        result: pmv2TaskItems.result,
      })
      .from(pmv2TaskItems)
      .innerJoin(pmv2ChecklistItems, eq(pmv2ChecklistItems.id, pmv2TaskItems.sourceChecklistItemId))
      .where(eq(pmv2TaskItems.taskId, taskId))
      .orderBy(asc(pmv2TaskItems.sortOrderSnapshot), asc(pmv2TaskItems.id));
  }
}

export const pmv2TaskReadService = new Pmv2TaskReadService();

import { and, asc, eq, sql } from "drizzle-orm";
import {
  pmv2ChecklistItems,
  pmv2Checklists,
  pmv2Programs,
  pmv2ProgramTargets,
  pmv2Specialties,
  pmv2TaskItems,
  pmv2Tasks,
  pmv2Teams,
} from "../../../drizzle/schema";
import { getDb } from "../../_core/db/client";
import { writePmv2Audit } from "../audit/service";
import { queuePmv2Translation } from "../translation-queue";
import type {
  Pmv2SchedulerChecklistItemRecord,
  Pmv2SchedulerProgramRecord,
  Pmv2SchedulerRepository,
  Pmv2SchedulerTargetRecord,
} from "./engine";
import { buildPmv2TaskNumber } from "./utils";
import { isPmv2SimplifiedEnabled } from "../simplified/feature";

async function requireDb() {
  const db = await getDb();
  if (!db) throw new Error("تعذر الاتصال بقاعدة البيانات");
  return db;
}

function isDuplicateEntry(error: unknown): boolean {
  const value = error as { code?: string; errno?: number } | null;
  return value?.code === "ER_DUP_ENTRY" || value?.errno === 1062;
}

export class Pmv2DbSchedulerRepository implements Pmv2SchedulerRepository {
  async listActivePrograms(): Promise<Pmv2SchedulerProgramRecord[]> {
    const db = await requireDb();
    return db
      .select({
        id: pmv2Programs.id,
        title: pmv2Programs.title,
        teamId: pmv2Programs.teamId,
        checklistId: pmv2Programs.checklistId,
        createdAt: pmv2Programs.createdAt,
      })
      .from(pmv2Programs)
      .innerJoin(pmv2Teams, eq(pmv2Teams.id, pmv2Programs.teamId))
      .innerJoin(pmv2Specialties, eq(pmv2Specialties.id, pmv2Teams.specialtyId))
      .innerJoin(pmv2Checklists, eq(pmv2Checklists.id, pmv2Programs.checklistId))
      .where(
        and(
          eq(pmv2Programs.isActive, 1),
          eq(pmv2Teams.isActive, 1),
          eq(pmv2Specialties.isActive, 1),
          eq(pmv2Checklists.isActive, 1),
          // Simplified programs have their own transactional scheduler.
          isPmv2SimplifiedEnabled() ? sql`NOT EXISTS (SELECT 1 FROM pmv2_simplified_plans sp WHERE sp.programId = ${pmv2Programs.id})` : undefined,
        ),
      )
      .orderBy(asc(pmv2Programs.id));
  }

  async listActiveChecklistItems(
    checklistId: number,
  ): Promise<Pmv2SchedulerChecklistItemRecord[]> {
    const db = await requireDb();
    return db
      .select()
      .from(pmv2ChecklistItems)
      .where(
        and(
          eq(pmv2ChecklistItems.checklistId, checklistId),
          eq(pmv2ChecklistItems.isActive, 1),
        ),
      )
      .orderBy(asc(pmv2ChecklistItems.sortOrder), asc(pmv2ChecklistItems.id));
  }

  async listProgramTargets(programId: number): Promise<Pmv2SchedulerTargetRecord[]> {
    const db = await requireDb();
    return db
      .select({
        id: pmv2ProgramTargets.id,
        siteId: pmv2ProgramTargets.siteId,
        sectionId: pmv2ProgramTargets.sectionId,
        assetId: pmv2ProgramTargets.assetId,
      })
      .from(pmv2ProgramTargets)
      .where(eq(pmv2ProgramTargets.programId, programId))
      .orderBy(asc(pmv2ProgramTargets.id));
  }

  async getOrCreateTask(input: {
    programId: number;
    programTargetId: number;
    teamId: number;
    dueDate: string;
  }) {
    const db = await requireDb();
    const existing = await db
      .select({ id: pmv2Tasks.id })
      .from(pmv2Tasks)
      .where(
        and(
          eq(pmv2Tasks.programId, input.programId),
          eq(pmv2Tasks.programTargetId, input.programTargetId),
          eq(pmv2Tasks.dueDate, input.dueDate),
        ),
      )
      .limit(1);
    if (existing[0]) return { id: existing[0].id, created: false };

    try {
      const taskNumber = buildPmv2TaskNumber(
        input.dueDate,
        input.programId,
        input.programTargetId,
      );
      const result = await db.insert(pmv2Tasks).values({
        programId: input.programId,
        programTargetId: input.programTargetId,
        teamId: input.teamId,
        taskNumber,
        dueDate: input.dueDate,
        status: "pending",
      });
      const id = Number(result[0].insertId);
      await writePmv2Audit({
        action: "task.generated",
        entity: "task",
        entityId: id,
        newValues: input,
      });

      return { id, created: true };
    } catch (error) {
      if (!isDuplicateEntry(error)) throw error;
      const raced = await db
        .select({ id: pmv2Tasks.id })
        .from(pmv2Tasks)
        .where(
          and(
            eq(pmv2Tasks.programId, input.programId),
            eq(pmv2Tasks.programTargetId, input.programTargetId),
            eq(pmv2Tasks.dueDate, input.dueDate),
          ),
        )
        .limit(1);
      if (!raced[0]) throw error;
      return { id: raced[0].id, created: false };
    }
  }

  async ensureTaskItem(input: {
    taskId: number;
    sourceChecklistItemId: number;
    titleSnapshot: string;
    sortOrderSnapshot: number;
    frequencySnapshot: "daily" | "weekly" | "monthly" | "quarterly" | "biannual" | "annual";
    frequencyValueSnapshot: number | null;
    weekdaySnapshot: number | null;
    monthDaySnapshot: number | null;
    anchorDateSnapshot: string | null;
    recurrenceLabelSnapshot: string | null;
    scheduledDate: string;
  }): Promise<boolean> {
    const db = await requireDb();
    const existing = await db
      .select({ id: pmv2TaskItems.id })
      .from(pmv2TaskItems)
      .where(
        and(
          eq(pmv2TaskItems.taskId, input.taskId),
          eq(pmv2TaskItems.sourceChecklistItemId, input.sourceChecklistItemId),
          eq(pmv2TaskItems.scheduledDate, input.scheduledDate),
        ),
      )
      .limit(1);
    if (existing[0]) return false;

    try {
      const result = await db.insert(pmv2TaskItems).values({
        ...input,
        status: "pending",
        result: null,
      });
      const id = Number(result[0].insertId);
      await writePmv2Audit({
        action: "task_item.generated",
        entity: "task_item",
        entityId: id,
        newValues: input,
      });
      await queuePmv2Translation("PMV2_TASK_ITEM", id, [
        ["titleSnapshot", input.titleSnapshot],
      ]);
      return true;
    } catch (error) {
      if (isDuplicateEntry(error)) return false;
      throw error;
    }
  }
}

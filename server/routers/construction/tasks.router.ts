import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { eq, desc, asc, and, like, or, count, sql, inArray } from "drizzle-orm";
import { router, protectedProcedure } from "../_shared/procedures";
import { getDb } from "../../db";
import {
  constructionTasks,
  constructionTaskComments,
  constructionTimeLogs,
  constructionFieldValues,
  constructionCustomFields,
  constructionPhases,
  constructionProjects,
  type InsertConstructionTask,
} from "../../../drizzle/schema";

async function generateTaskNumber(db: NonNullable<Awaited<ReturnType<typeof getDb>>>, projectId: number) {
  const [result] = await db.select({ cnt: count() }).from(constructionTasks)
    .where(eq(constructionTasks.projectId, projectId));
  const num = (result?.cnt ?? 0) + 1;
  return `TSK-${projectId}-${String(num).padStart(4, "0")}`;
}

async function recalculateParentProgress(db: NonNullable<Awaited<ReturnType<typeof getDb>>>, phaseId: number, projectId: number) {
  // Phase progress
  const [phaseStats] = await db.select({
    total: count(),
    completed: sql<number>`SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END)`,
  }).from(constructionTasks).where(eq(constructionTasks.phaseId, phaseId));

  const total = phaseStats?.total ?? 0;
  const completed = phaseStats?.completed ?? 0;
  const phaseProgress = total > 0 ? Math.round((completed / total) * 10000) / 100 : 0;

  await db.update(constructionPhases)
    .set({ progressPercent: String(phaseProgress) })
    .where(eq(constructionPhases.id, phaseId));

  // Project progress
  const phases = await db.select({ progress: constructionPhases.progressPercent })
    .from(constructionPhases).where(eq(constructionPhases.projectId, projectId));

  const avgProgress = phases.length > 0
    ? phases.reduce((s, p) => s + Number(p.progress ?? 0), 0) / phases.length
    : 0;

  await db.update(constructionProjects)
    .set({ progressPercent: String(Math.round(avgProgress * 100) / 100) })
    .where(eq(constructionProjects.id, projectId));
}

export const tasksRouter = router({

  // List tasks with filters
  list: protectedProcedure
    .input(z.object({
      projectId: z.number().optional(),
      phaseId: z.number().optional(),
      activityId: z.number().optional(),
      status: z.string().optional(),
      priority: z.string().optional(),
      assignedToId: z.number().optional(),
      search: z.string().optional(),
      isOverdue: z.boolean().optional(),
      isCriticalPath: z.boolean().optional(),
      page: z.number().min(1).default(1),
      pageSize: z.number().min(1).max(200).default(20),
    }).optional())
    .query(async ({ input, ctx }) => {
      const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available" });
      const { projectId, phaseId, activityId, status, priority, assignedToId,
        search, isOverdue, isCriticalPath, page = 1, pageSize = 20 } = input || {};
      const offset = (page - 1) * pageSize;

      const conditions: any[] = [];
      if (projectId) conditions.push(eq(constructionTasks.projectId, projectId));
      if (phaseId) conditions.push(eq(constructionTasks.phaseId, phaseId));
      if (activityId) conditions.push(eq(constructionTasks.activityId, activityId));
      if (status) conditions.push(eq(constructionTasks.status, status as any));
      if (priority) conditions.push(eq(constructionTasks.priority, priority as any));
      if (assignedToId) conditions.push(eq(constructionTasks.assignedToId, assignedToId));
      if (isCriticalPath) conditions.push(eq(constructionTasks.isCriticalPath, true));
      if (search) conditions.push(like(constructionTasks.title, `%${search}%`));
      if (isOverdue) {
        conditions.push(
          sql`${constructionTasks.endDatePlanned} < CURDATE() AND ${constructionTasks.status} NOT IN ('completed')`
        );
      }

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

      const [tasks, totalResult] = await Promise.all([
        db.select().from(constructionTasks)
          .where(whereClause)
          .orderBy(desc(constructionTasks.createdAt))
          .limit(pageSize).offset(offset),
        db.select({ cnt: count() }).from(constructionTasks).where(whereClause),
      ]);

      return {
        data: tasks,
        total: totalResult[0]?.cnt ?? 0,
        page,
        pageSize,
        totalPages: Math.ceil((totalResult[0]?.cnt ?? 0) / pageSize),
      };
    }),

  // Kanban board data — all tasks grouped by status
  kanban: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      phaseId: z.number().optional(),
      activityId: z.number().optional(),
      assignedToId: z.number().optional(),
    }))
    .query(async ({ input }) => {
      const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available" });
      const conditions: any[] = [eq(constructionTasks.projectId, input.projectId)];
      if (input.phaseId) conditions.push(eq(constructionTasks.phaseId, input.phaseId));
      if (input.activityId) conditions.push(eq(constructionTasks.activityId, input.activityId));
      if (input.assignedToId) conditions.push(eq(constructionTasks.assignedToId, input.assignedToId));

      const tasks = await db.select().from(constructionTasks)
        .where(and(...conditions))
        .orderBy(asc(constructionTasks.priority), asc(constructionTasks.endDatePlanned));

      const statuses = ["new", "in_progress", "pending_approval", "pending_materials", "on_hold", "completed"] as const;
      const grouped: Record<string, typeof tasks> = {};
      for (const s of statuses) grouped[s] = [];
      for (const t of tasks) grouped[t.status].push(t);

      return grouped;
    }),

  // Gantt data — tasks with dates and dependencies
  gantt: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available" });
      const tasks = await db.select().from(constructionTasks)
        .where(eq(constructionTasks.projectId, input.projectId))
        .orderBy(asc(constructionTasks.startDatePlanned));
      return tasks;
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available" });
      const [task] = await db.select().from(constructionTasks)
        .where(eq(constructionTasks.id, input.id)).limit(1);
      if (!task) throw new TRPCError({ code: "NOT_FOUND", message: "المهمة غير موجودة" });

      // Get comments, time logs, field values
      const [comments, timeLogs, fieldValues] = await Promise.all([
        db.select().from(constructionTaskComments)
          .where(eq(constructionTaskComments.taskId, input.id))
          .orderBy(asc(constructionTaskComments.createdAt)),
        db.select().from(constructionTimeLogs)
          .where(eq(constructionTimeLogs.taskId, input.id))
          .orderBy(desc(constructionTimeLogs.createdAt)),
        db.select({
          value: constructionFieldValues,
          field: constructionCustomFields,
        })
          .from(constructionFieldValues)
          .leftJoin(constructionCustomFields, eq(constructionFieldValues.fieldId, constructionCustomFields.id))
          .where(eq(constructionFieldValues.taskId, input.id)),
      ]);

      const totalMinutes = timeLogs.reduce((s, l) => s + (l.durationMinutes ?? 0), 0);

      return { ...task, comments, timeLogs, fieldValues, totalLoggedMinutes: totalMinutes };
    }),

  create: protectedProcedure
    .input(z.object({
      activityId: z.number(),
      phaseId: z.number(),
      projectId: z.number(),
      title: z.string().min(1),
      description: z.string().optional(),
      priority: z.enum(["low", "medium", "high", "critical"]).default("medium"),
      assignedToId: z.number().optional(),
      startDatePlanned: z.string().optional(),
      endDatePlanned: z.string().optional(),
      estimatedHours: z.string().optional(),
      estimatedCost: z.string().optional(),
      sprintPoints: z.number().optional(),
      locationLat: z.string().optional(),
      locationLng: z.string().optional(),
      locationDetail: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available" });
      const taskNumber = await generateTaskNumber(db, input.projectId);

      const data: InsertConstructionTask = {
        ...input,
        taskNumber,
        status: "new",
        assignedById: input.assignedToId ? ctx.user.id : undefined,
        assignedAt: input.assignedToId ? new Date() : undefined,
        createdById: ctx.user.id,
      };

      const result = await db.insert(constructionTasks).values(data);
      return { id: Number((result as any).insertId), taskNumber };
    }),

  update: protectedProcedure
    .input(z.object({
      id: z.number(),
      title: z.string().optional(),
      description: z.string().optional(),
      priority: z.enum(["low", "medium", "high", "critical"]).optional(),
      assignedToId: z.number().nullable().optional(),
      startDatePlanned: z.string().optional(),
      endDatePlanned: z.string().optional(),
      startDateActual: z.string().optional(),
      endDateActual: z.string().optional(),
      estimatedHours: z.string().optional(),
      actualHours: z.string().optional(),
      estimatedCost: z.string().optional(),
      actualCost: z.string().optional(),
      progressPercent: z.string().optional(),
      sprintPoints: z.number().optional(),
      locationLat: z.string().optional(),
      locationLng: z.string().optional(),
      locationDetail: z.string().optional(),
      isCriticalPath: z.boolean().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available" });
      const { id, ...data } = input;
      await db.update(constructionTasks).set(data).where(eq(constructionTasks.id, id));
      return { success: true };
    }),

  // Change status — most critical mutation
  changeStatus: protectedProcedure
    .input(z.object({
      id: z.number(),
      status: z.enum(["new", "in_progress", "pending_approval", "pending_materials", "on_hold", "completed"]),
      holdReason: z.enum(["weather", "pending_approval", "subcontractor", "administrative", "other"]).optional(),
      holdNote: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available" });
      const [task] = await db.select().from(constructionTasks)
        .where(eq(constructionTasks.id, input.id)).limit(1);
      if (!task) throw new TRPCError({ code: "NOT_FOUND", message: "المهمة غير موجودة" });

      // Enforce holdReason when status = on_hold
      if (input.status === "on_hold" && !input.holdReason) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "يجب تحديد سبب التوقف عند تغيير الحالة إلى موقوفة",
        });
      }

      const updateData: any = {
        status: input.status,
        holdReason: input.status === "on_hold" ? input.holdReason : null,
        holdNote: input.status === "on_hold" ? input.holdNote : null,
      };

      if (input.status === "completed") {
        updateData.completedAt = new Date();
        updateData.completedById = ctx.user.id;
        updateData.progressPercent = "100";
      }
      if (input.status === "in_progress" && !task.startDateActual) {
        updateData.startDateActual = new Date().toISOString().split("T")[0];
      }

      await db.update(constructionTasks).set(updateData).where(eq(constructionTasks.id, input.id));

      // Recalculate parent progress
      await recalculateParentProgress(db, task.phaseId, task.projectId);

      return { success: true, newStatus: input.status };
    }),

  // Bulk status change
  bulkChangeStatus: protectedProcedure
    .input(z.object({
      ids: z.array(z.number()),
      status: z.enum(["new", "in_progress", "pending_approval", "pending_materials", "on_hold", "completed"]),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available" });
      if (input.status === "on_hold") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "لا يمكن تغيير حالة مهام متعددة إلى موقوفة دفعة واحدة — يجب تحديد سبب لكل مهمة",
        });
      }
      await db.update(constructionTasks)
        .set({ status: input.status })
        .where(inArray(constructionTasks.id, input.ids));
      return { success: true, count: input.ids.length };
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available" });
      const [task] = await db.select().from(constructionTasks)
        .where(eq(constructionTasks.id, input.id)).limit(1);
      if (!task) throw new TRPCError({ code: "NOT_FOUND", message: "المهمة غير موجودة" });
      await db.delete(constructionTasks).where(eq(constructionTasks.id, input.id));
      await recalculateParentProgress(db, task.phaseId, task.projectId);
      return { success: true };
    }),
});

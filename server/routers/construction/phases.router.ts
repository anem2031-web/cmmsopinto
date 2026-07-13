import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { eq, asc, count, sql, and } from "drizzle-orm";
import { router, protectedProcedure } from "../_shared/procedures";
import { getDb } from "../../_core/db";
import {
  constructionPhases,
  constructionActivities,
  constructionTasks,
  constructionProjectMembers,
  constructionProjects,
  type InsertConstructionPhase,
} from "../../../drizzle/schema";

async function assertPhaseAccess(phaseId: number, userId: number, requireEdit = false) {
  const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available" });
  const [phase] = await db.select().from(constructionPhases)
    .where(eq(constructionPhases.id, phaseId)).limit(1);
  if (!phase) throw new TRPCError({ code: "NOT_FOUND", message: "المرحلة غير موجودة" });

  const [project] = await db.select().from(constructionProjects)
    .where(eq(constructionProjects.id, phase.projectId)).limit(1);

  const isOwnerOrManager = project?.ownerId === userId || project?.managerId === userId;
  if (!isOwnerOrManager) {
    const [member] = await db.select().from(constructionProjectMembers)
      .where(and(eq(constructionProjectMembers.projectId, phase.projectId), eq(constructionProjectMembers.userId, userId)))
      .limit(1);
    if (!member) throw new TRPCError({ code: "FORBIDDEN", message: "ليس لديك صلاحية" });
    if (requireEdit && !member.canEdit) throw new TRPCError({ code: "FORBIDDEN", message: "ليس لديك صلاحية التعديل" });
  }
  return phase;
}

export const phasesRouter = router({

  list: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available" });
      const phases = await db.select().from(constructionPhases)
        .where(eq(constructionPhases.projectId, input.projectId))
        .orderBy(asc(constructionPhases.orderIndex));

      // Get task counts per phase
      const taskCounts = await db.select({
        phaseId: constructionTasks.phaseId,
        total: count(),
        completed: sql<number>`SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END)`,
        overdue: sql<number>`SUM(CASE WHEN endDatePlanned < CURDATE() AND status NOT IN ('completed') THEN 1 ELSE 0 END)`,
      }).from(constructionTasks)
        .where(eq(constructionTasks.projectId, input.projectId))
        .groupBy(constructionTasks.phaseId);

      const countMap = Object.fromEntries(taskCounts.map(t => [t.phaseId, t]));

      return phases.map(p => ({
        ...p,
        taskTotal: countMap[p.id]?.total ?? 0,
        taskCompleted: countMap[p.id]?.completed ?? 0,
        taskOverdue: countMap[p.id]?.overdue ?? 0,
      }));
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input, ctx }) => {
      const phase = await assertPhaseAccess(input.id, ctx.user.id);
      return phase;
    }),

  create: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      name: z.string().min(1),
      nameEn: z.string().optional(),
      description: z.string().optional(),
      orderIndex: z.number().optional(),
      startDatePlanned: z.string().optional(),
      endDatePlanned: z.string().optional(),
      budgetPlanned: z.string().optional(),
      laborCost: z.string().optional(),
      issueLevel: z.enum(["low", "medium", "high", "critical"]).optional(),
      tags: z.array(z.string()).optional(),
      checklist: z.array(z.object({ id: z.string(), text: z.string(), done: z.boolean() })).optional(),
      attachments: z.array(z.object({ name: z.string(), url: z.string(), uploadedAt: z.string() })).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available" });
      // Get next order index
      const [last] = await db.select({ maxOrder: sql<number>`COALESCE(MAX(\`orderIndex\`), -1)` })
        .from(constructionPhases).where(eq(constructionPhases.projectId, input.projectId));

      const data: InsertConstructionPhase = {
        ...input,
        orderIndex: input.orderIndex ?? ((last?.maxOrder ?? -1) + 1),
        createdById: ctx.user.id,
      };
      const result = await db.insert(constructionPhases).values(data);
      return { id: Number((result as any)?.insertId ?? (result as any)?.[0]?.insertId ?? 0) };
    }),

  update: protectedProcedure
    .input(z.object({
      id: z.number(),
      name: z.string().optional(),
      nameEn: z.string().optional(),
      description: z.string().optional(),
      status: z.enum(["pending", "active", "on_hold", "completed"]).optional(),
      startDatePlanned: z.string().optional(),
      endDatePlanned: z.string().optional(),
      startDateActual: z.string().optional(),
      endDateActual: z.string().optional(),
      budgetPlanned: z.string().optional(),
      budgetActual: z.string().optional(),
      laborCost: z.string().optional(),
      issueLevel: z.enum(["low", "medium", "high", "critical"]).nullable().optional(),
      tags: z.array(z.string()).optional(),
      checklist: z.array(z.object({ id: z.string(), text: z.string(), done: z.boolean() })).optional(),
      attachments: z.array(z.object({ name: z.string(), url: z.string(), uploadedAt: z.string() })).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available" });
      const { id, ...data } = input;
      await assertPhaseAccess(id, ctx.user.id, true);
      await db.update(constructionPhases).set(data).where(eq(constructionPhases.id, id));
      return { success: true };
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available" });
      await assertPhaseAccess(input.id, ctx.user.id, true);
      await db.delete(constructionPhases).where(eq(constructionPhases.id, input.id));
      return { success: true };
    }),

  reorder: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      orderedIds: z.array(z.number()),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available" });
      await Promise.all(
        input.orderedIds.map((id, index) =>
          db.update(constructionPhases)
            .set({ orderIndex: index })
            .where(and(eq(constructionPhases.id, id), eq(constructionPhases.projectId, input.projectId)))
        )
      );
      return { success: true };
    }),

  // Recalculate phase progress from its tasks
  recalculateProgress: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available" });
      const [stats] = await db.select({
        total: count(),
        completed: sql<number>`SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END)`,
      }).from(constructionTasks).where(eq(constructionTasks.phaseId, input.id));

      const total = stats?.total ?? 0;
      const completed = stats?.completed ?? 0;
      const progress = total > 0 ? Math.round((completed / total) * 10000) / 100 : 0;

      await db.update(constructionPhases)
        .set({ progressPercent: String(progress) })
        .where(eq(constructionPhases.id, input.id));

      return { progress };
    }),
});

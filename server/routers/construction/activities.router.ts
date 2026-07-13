import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { eq, asc, and, sql, count } from "drizzle-orm";
import { router, protectedProcedure } from "../_shared/procedures";
import { getDb } from "../../_core/db";
import {
  constructionActivities,
  constructionTasks,
  constructionProjectMembers,
  constructionProjects,
  type InsertConstructionActivity,
} from "../../../drizzle/schema";

export const activitiesRouter = router({

  list: protectedProcedure
    .input(z.object({ phaseId: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available" });
      const activities = await db.select().from(constructionActivities)
        .where(eq(constructionActivities.phaseId, input.phaseId))
        .orderBy(asc(constructionActivities.orderIndex));

      const taskCounts = await db.select({
        activityId: constructionTasks.activityId,
        total: count(),
        completed: sql<number>`SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END)`,
      }).from(constructionTasks)
        .where(eq(constructionTasks.phaseId, input.phaseId))
        .groupBy(constructionTasks.activityId);

      const countMap = Object.fromEntries(taskCounts.map(t => [t.activityId, t]));

      return activities.map(a => ({
        ...a,
        taskTotal: countMap[a.id]?.total ?? 0,
        taskCompleted: countMap[a.id]?.completed ?? 0,
      }));
    }),

  listByProject: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available" });
      return db.select().from(constructionActivities)
        .where(eq(constructionActivities.projectId, input.projectId))
        .orderBy(asc(constructionActivities.orderIndex));
    }),

  create: protectedProcedure
    .input(z.object({
      phaseId: z.number(),
      projectId: z.number(),
      name: z.string().min(1),
      nameEn: z.string().optional(),
      description: z.string().optional(),
      responsibleId: z.number().optional(),
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
      const [last] = await db.select({ maxOrder: sql<number>`COALESCE(MAX(\`orderIndex\`), -1)` })
        .from(constructionActivities).where(eq(constructionActivities.phaseId, input.phaseId));

      const data: InsertConstructionActivity = {
        ...input,
        orderIndex: (last?.maxOrder ?? -1) + 1,
        createdById: ctx.user.id,
      };
      const result = await db.insert(constructionActivities).values(data);
      return { id: Number((result as any)?.insertId ?? (result as any)?.[0]?.insertId ?? 0) };
    }),

  update: protectedProcedure
    .input(z.object({
      id: z.number(),
      name: z.string().optional(),
      nameEn: z.string().optional(),
      description: z.string().optional(),
      status: z.enum(["pending", "active", "on_hold", "completed"]).optional(),
      responsibleId: z.number().optional(),
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
    .mutation(async ({ input }) => {
      const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available" });
      const { id, ...data } = input;
      await db.update(constructionActivities).set(data).where(eq(constructionActivities.id, id));
      return { success: true };
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available" });
      await db.delete(constructionActivities).where(eq(constructionActivities.id, input.id));
      return { success: true };
    }),

  reorder: protectedProcedure
    .input(z.object({
      phaseId: z.number(),
      orderedIds: z.array(z.number()),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available" });
      await Promise.all(
        input.orderedIds.map((id, index) =>
          db.update(constructionActivities)
            .set({ orderIndex: index })
            .where(and(eq(constructionActivities.id, id), eq(constructionActivities.phaseId, input.phaseId)))
        )
      );
      return { success: true };
    }),
});

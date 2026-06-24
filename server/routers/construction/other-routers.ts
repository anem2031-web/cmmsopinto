import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { eq, desc, asc, and, count, sql } from "drizzle-orm";
import { router, protectedProcedure } from "../_shared/procedures";
import { getDb } from "../../db";
import {
  constructionTaskComments,
  constructionTaskDependencies,
  constructionProjectMembers,
  constructionTimeLogs,
  constructionCustomFields,
  constructionFieldValues,
  constructionAutomations,
  constructionGoals,
  constructionDailyReports,
  constructionQuantityTracking,
  constructionChangeOrders,
  constructionSafetyLogs,
  constructionTasks,
  constructionPhases,
  constructionProjects,
} from "../../../drizzle/schema";

// ── Task Comments ────────────────────────────────────────────
export const taskCommentsRouter = router({
  list: protectedProcedure
    .input(z.object({ taskId: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available" });
      return db.select().from(constructionTaskComments)
        .where(eq(constructionTaskComments.taskId, input.taskId))
        .orderBy(asc(constructionTaskComments.createdAt));
    }),

  create: protectedProcedure
    .input(z.object({
      taskId: z.number(),
      projectId: z.number(),
      comment: z.string().min(1),
      attachmentUrls: z.array(z.string()).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available" });
      const result = await db.insert(constructionTaskComments).values({
        ...input,
        attachmentUrls: input.attachmentUrls ? input.attachmentUrls : null,
        userId: ctx.user.id,
        userName: ctx.user.name ?? ctx.user.username ?? "مستخدم",
        userRole: ctx.user.role,
      });
      return { id: Number((result as any)?.insertId ?? (result as any)?.[0]?.insertId ?? 0) };
    }),

  update: protectedProcedure
    .input(z.object({ id: z.number(), comment: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available" });
      const [comment] = await db.select().from(constructionTaskComments)
        .where(eq(constructionTaskComments.id, input.id)).limit(1);
      if (comment?.userId !== ctx.user.id)
        throw new TRPCError({ code: "FORBIDDEN", message: "لا يمكنك تعديل تعليق شخص آخر" });
      await db.update(constructionTaskComments)
        .set({ comment: input.comment }).where(eq(constructionTaskComments.id, input.id));
      return { success: true };
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available" });
      const [comment] = await db.select().from(constructionTaskComments)
        .where(eq(constructionTaskComments.id, input.id)).limit(1);
      if (comment?.userId !== ctx.user.id)
        throw new TRPCError({ code: "FORBIDDEN", message: "لا يمكنك حذف تعليق شخص آخر" });
      await db.delete(constructionTaskComments).where(eq(constructionTaskComments.id, input.id));
      return { success: true };
    }),
});

// ── Task Dependencies ────────────────────────────────────────
export const taskDependenciesRouter = router({
  list: protectedProcedure
    .input(z.object({ taskId: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available" });
      return db.select().from(constructionTaskDependencies)
        .where(eq(constructionTaskDependencies.taskId, input.taskId));
    }),

  create: protectedProcedure
    .input(z.object({
      taskId: z.number(),
      dependsOnTaskId: z.number(),
      dependencyType: z.enum(["finish_to_start", "start_to_start", "finish_to_finish", "start_to_finish"]).default("finish_to_start"),
      lagDays: z.number().default(0),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available" });
      if (input.taskId === input.dependsOnTaskId)
        throw new TRPCError({ code: "BAD_REQUEST", message: "لا يمكن ربط المهمة بنفسها" });
      const result = await db.insert(constructionTaskDependencies).values({
        ...input, createdById: ctx.user.id,
      });
      return { id: Number((result as any)?.insertId ?? (result as any)?.[0]?.insertId ?? 0) };
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available" });
      await db.delete(constructionTaskDependencies)
        .where(eq(constructionTaskDependencies.id, input.id));
      return { success: true };
    }),
});

// ── Project Members ──────────────────────────────────────────
export const membersRouter = router({
  list: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available" });
      return db.select().from(constructionProjectMembers)
        .where(eq(constructionProjectMembers.projectId, input.projectId))
        .orderBy(asc(constructionProjectMembers.joinedAt));
    }),

  add: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      userId: z.number(),
      role: z.enum(["manager", "supervisor", "engineer", "technician", "subcontractor", "viewer"]).default("viewer"),
      canEdit: z.boolean().default(false),
      canDelete: z.boolean().default(false),
      canApprove: z.boolean().default(false),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available" });
      const result = await db.insert(constructionProjectMembers).values({
        ...input, addedById: ctx.user.id,
      });
      return { id: Number((result as any)?.insertId ?? (result as any)?.[0]?.insertId ?? 0) };
    }),

  updateRole: protectedProcedure
    .input(z.object({
      id: z.number(),
      role: z.enum(["manager", "supervisor", "engineer", "technician", "subcontractor", "viewer"]),
      canEdit: z.boolean().optional(),
      canDelete: z.boolean().optional(),
      canApprove: z.boolean().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available" });
      const { id, ...data } = input;
      await db.update(constructionProjectMembers).set(data)
        .where(eq(constructionProjectMembers.id, id));
      return { success: true };
    }),

  remove: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available" });
      await db.delete(constructionProjectMembers)
        .where(eq(constructionProjectMembers.id, input.id));
      return { success: true };
    }),

  workload: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available" });
      const members = await db.select().from(constructionProjectMembers)
        .where(eq(constructionProjectMembers.projectId, input.projectId));

      const workloadData = await Promise.all(members.map(async (m) => {
        const [taskStats] = await db.select({
          activeCount: sql<number>`SUM(CASE WHEN status NOT IN ('completed') THEN 1 ELSE 0 END)`,
          totalCount: count(),
          completedCount: sql<number>`SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END)`,
        }).from(constructionTasks)
          .where(and(
            eq(constructionTasks.projectId, input.projectId),
            eq(constructionTasks.assignedToId, m.userId)
          ));
        return { ...m, ...taskStats };
      }));

      return workloadData;
    }),
});

// ── Time Logs ────────────────────────────────────────────────
export const timeLogsRouter = router({
  list: protectedProcedure
    .input(z.object({ taskId: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available" });
      return db.select().from(constructionTimeLogs)
        .where(eq(constructionTimeLogs.taskId, input.taskId))
        .orderBy(desc(constructionTimeLogs.createdAt));
    }),

  create: protectedProcedure
    .input(z.object({
      taskId: z.number(),
      projectId: z.number(),
      durationMinutes: z.number().min(1),
      description: z.string().optional(),
      logType: z.enum(["auto", "manual"]).default("manual"),
      hourlyRate: z.string().optional(),
      startTime: z.string().optional(),
      endTime: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available" });
      const totalCost = input.hourlyRate && input.durationMinutes
        ? String((Number(input.hourlyRate) * input.durationMinutes) / 60)
        : undefined;
      const result = await db.insert(constructionTimeLogs).values({
        ...input,
        startTime: input.startTime ? new Date(input.startTime) : undefined,
        endTime: input.endTime ? new Date(input.endTime) : undefined,
        totalCost,
        userId: ctx.user.id,
      });
      return { id: Number((result as any)?.insertId ?? (result as any)?.[0]?.insertId ?? 0) };
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available" });
      await db.delete(constructionTimeLogs).where(eq(constructionTimeLogs.id, input.id));
      return { success: true };
    }),

  projectSummary: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available" });
      const [summary] = await db.select({
        totalMinutes: sql<number>`SUM(durationMinutes)`,
        totalCost: sql<number>`SUM(totalCost)`,
        logCount: count(),
      }).from(constructionTimeLogs).where(eq(constructionTimeLogs.projectId, input.projectId));
      return summary;
    }),
});

// ── Custom Fields ────────────────────────────────────────────
export const customFieldsRouter = router({
  list: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available" });
      return db.select().from(constructionCustomFields)
        .where(eq(constructionCustomFields.projectId, input.projectId))
        .orderBy(asc(constructionCustomFields.orderIndex));
    }),

  create: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      name: z.string().min(1),
      fieldType: z.enum(["text", "number", "date", "dropdown", "user", "file", "rating", "url"]),
      options: z.array(z.string()).optional(),
      isRequired: z.boolean().default(false),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available" });
      const [last] = await db.select({ maxOrder: sql<number>`COALESCE(MAX(\`orderIndex\`), -1)` })
        .from(constructionCustomFields).where(eq(constructionCustomFields.projectId, input.projectId));
      const result = await db.insert(constructionCustomFields).values({
        ...input,
        options: input.options ? input.options : null,
        orderIndex: (last?.maxOrder ?? -1) + 1,
        createdById: ctx.user.id,
      });
      return { id: Number((result as any)?.insertId ?? (result as any)?.[0]?.insertId ?? 0) };
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available" });
      await db.delete(constructionCustomFields).where(eq(constructionCustomFields.id, input.id));
      return { success: true };
    }),

  setValue: protectedProcedure
    .input(z.object({
      fieldId: z.number(),
      taskId: z.number(),
      value: z.string(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available" });
      const [existing] = await db.select().from(constructionFieldValues)
        .where(and(eq(constructionFieldValues.fieldId, input.fieldId), eq(constructionFieldValues.taskId, input.taskId)))
        .limit(1);
      if (existing) {
        await db.update(constructionFieldValues).set({ value: input.value })
          .where(eq(constructionFieldValues.id, existing.id));
      } else {
        await db.insert(constructionFieldValues).values(input);
      }
      return { success: true };
    }),
});

// ── Automations ──────────────────────────────────────────────
export const automationsRouter = router({
  list: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available" });
      return db.select().from(constructionAutomations)
        .where(eq(constructionAutomations.projectId, input.projectId))
        .orderBy(desc(constructionAutomations.createdAt));
    }),

  create: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      name: z.string().min(1),
      triggerType: z.enum(["status_change", "date_passed", "task_completed", "phase_completed", "member_overloaded", "daily_schedule"]),
      triggerCondition: z.record(z.string(), z.any()).optional(),
      actionType: z.enum(["create_purchase_order", "send_notification", "create_report", "update_status", "reassign_task", "check_inventory"]),
      actionConfig: z.record(z.string(), z.any()).optional(),
      isActive: z.boolean().default(true),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available" });
      const result = await db.insert(constructionAutomations).values({
        ...input,
        triggerCondition: input.triggerCondition ?? null,
        actionConfig: input.actionConfig ?? null,
        createdById: ctx.user.id,
      });
      return { id: Number((result as any)?.insertId ?? (result as any)?.[0]?.insertId ?? 0) };
    }),

  toggle: protectedProcedure
    .input(z.object({ id: z.number(), isActive: z.boolean() }))
    .mutation(async ({ input }) => {
      const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available" });
      await db.update(constructionAutomations)
        .set({ isActive: input.isActive }).where(eq(constructionAutomations.id, input.id));
      return { success: true };
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available" });
      await db.delete(constructionAutomations).where(eq(constructionAutomations.id, input.id));
      return { success: true };
    }),
});

// ── Goals ────────────────────────────────────────────────────
export const goalsRouter = router({
  list: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available" });
      return db.select().from(constructionGoals)
        .where(eq(constructionGoals.projectId, input.projectId))
        .orderBy(asc(constructionGoals.createdAt));
    }),

  create: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      title: z.string().min(1),
      description: z.string().optional(),
      goalType: z.enum(["completion", "budget", "quality", "safety"]).default("completion"),
      targetValue: z.string().optional(),
      unit: z.string().optional(),
      dueDate: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available" });
      const result = await db.insert(constructionGoals).values({
        ...input, createdById: ctx.user.id,
      });
      return { id: Number((result as any)?.insertId ?? (result as any)?.[0]?.insertId ?? 0) };
    }),

  update: protectedProcedure
    .input(z.object({
      id: z.number(),
      title: z.string().optional(),
      currentValue: z.string().optional(),
      status: z.enum(["on_track", "at_risk", "behind", "completed"]).optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available" });
      const { id, ...data } = input;
      await db.update(constructionGoals).set(data).where(eq(constructionGoals.id, id));
      return { success: true };
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available" });
      await db.delete(constructionGoals).where(eq(constructionGoals.id, input.id));
      return { success: true };
    }),
});

// ── Daily Reports ────────────────────────────────────────────
export const dailyReportsRouter = router({
  list: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      page: z.number().default(1),
      pageSize: z.number().default(20),
    }))
    .query(async ({ input }) => {
      const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available" });
      const offset = (input.page - 1) * input.pageSize;
      const [reports, totalResult] = await Promise.all([
        db.select().from(constructionDailyReports)
          .where(eq(constructionDailyReports.projectId, input.projectId))
          .orderBy(desc(constructionDailyReports.reportDate))
          .limit(input.pageSize).offset(offset),
        db.select({ cnt: count() }).from(constructionDailyReports)
          .where(eq(constructionDailyReports.projectId, input.projectId)),
      ]);
      return {
        data: reports,
        total: totalResult[0]?.cnt ?? 0,
        totalPages: Math.ceil((totalResult[0]?.cnt ?? 0) / input.pageSize),
      };
    }),

  getByDate: protectedProcedure
    .input(z.object({ projectId: z.number(), date: z.string() }))
    .query(async ({ input }) => {
      const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available" });
      const [report] = await db.select().from(constructionDailyReports)
        .where(and(
          eq(constructionDailyReports.projectId, input.projectId),
          eq(constructionDailyReports.reportDate, input.date)
        )).limit(1);
      return report ?? null;
    }),

  create: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      reportDate: z.string(),
      weather: z.enum(["sunny", "cloudy", "rainy", "stormy", "windy"]).default("sunny"),
      workerCount: z.number().default(0),
      workCompleted: z.string().optional(),
      obstacles: z.string().optional(),
      materialsUsed: z.string().optional(),
      safetyNotes: z.string().optional(),
      tomorrowPlan: z.string().optional(),
      photoUrls: z.array(z.string()).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available" });
      const result = await db.insert(constructionDailyReports).values({
        ...input,
        photoUrls: input.photoUrls ?? null,
        submittedById: ctx.user.id,
      });
      return { id: Number((result as any)?.insertId ?? (result as any)?.[0]?.insertId ?? 0) };
    }),

  approve: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available" });
      await db.update(constructionDailyReports)
        .set({ approvedById: ctx.user.id, approvedAt: new Date() })
        .where(eq(constructionDailyReports.id, input.id));
      return { success: true };
    }),
});

// ── Quantity Tracking ────────────────────────────────────────
export const quantityTrackingRouter = router({
  list: protectedProcedure
    .input(z.object({ taskId: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available" });
      return db.select().from(constructionQuantityTracking)
        .where(eq(constructionQuantityTracking.taskId, input.taskId));
    }),

  listByProject: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available" });
      return db.select().from(constructionQuantityTracking)
        .where(eq(constructionQuantityTracking.projectId, input.projectId));
    }),

  create: protectedProcedure
    .input(z.object({
      taskId: z.number(),
      projectId: z.number(),
      materialName: z.string().min(1),
      unit: z.string().min(1),
      quantityPlanned: z.string().default("0"),
      quantityActual: z.string().default("0"),
      unitCostPlanned: z.string().optional(),
      unitCostActual: z.string().optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available" });
      const result = await db.insert(constructionQuantityTracking).values({
        ...input, createdById: ctx.user.id,
      });
      return { id: Number((result as any)?.insertId ?? (result as any)?.[0]?.insertId ?? 0) };
    }),

  update: protectedProcedure
    .input(z.object({
      id: z.number(),
      quantityActual: z.string().optional(),
      unitCostActual: z.string().optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available" });
      const { id, ...data } = input;
      await db.update(constructionQuantityTracking).set(data)
        .where(eq(constructionQuantityTracking.id, id));
      return { success: true };
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available" });
      await db.delete(constructionQuantityTracking)
        .where(eq(constructionQuantityTracking.id, input.id));
      return { success: true };
    }),
});

// ── Change Orders ────────────────────────────────────────────
export const changeOrdersRouter = router({
  list: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available" });
      return db.select().from(constructionChangeOrders)
        .where(eq(constructionChangeOrders.projectId, input.projectId))
        .orderBy(desc(constructionChangeOrders.createdAt));
    }),

  create: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      phaseId: z.number().optional(),
      activityId: z.number().optional(),
      title: z.string().min(1),
      description: z.string().min(1),
      reason: z.enum(["design_change", "client_request", "site_condition", "error_correction", "other"]),
      impactDays: z.number().default(0),
      impactCost: z.string().default("0"),
      attachmentUrls: z.array(z.string()).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available" });
      const [countResult] = await db.select({ cnt: count() }).from(constructionChangeOrders)
        .where(eq(constructionChangeOrders.projectId, input.projectId));
      const changeNumber = `CO-${input.projectId}-${String((countResult?.cnt ?? 0) + 1).padStart(3, "0")}`;
      const result = await db.insert(constructionChangeOrders).values({
        ...input,
        changeNumber,
        attachmentUrls: input.attachmentUrls ?? null,
        requestedById: ctx.user.id,
      });
      return { id: Number((result as any)?.insertId ?? (result as any)?.[0]?.insertId ?? 0), changeNumber };
    }),

  approve: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available" });
      await db.update(constructionChangeOrders)
        .set({ status: "approved", approvedById: ctx.user.id, approvedAt: new Date() })
        .where(eq(constructionChangeOrders.id, input.id));
      return { success: true };
    }),

  reject: protectedProcedure
    .input(z.object({ id: z.number(), rejectionReason: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available" });
      await db.update(constructionChangeOrders)
        .set({ status: "rejected", approvedById: ctx.user.id, approvedAt: new Date(), rejectionReason: input.rejectionReason })
        .where(eq(constructionChangeOrders.id, input.id));
      return { success: true };
    }),
});

// ── Safety Logs ──────────────────────────────────────────────
export const safetyLogsRouter = router({
  list: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      page: z.number().default(1),
      pageSize: z.number().default(20),
    }))
    .query(async ({ input }) => {
      const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available" });
      const offset = (input.page - 1) * input.pageSize;
      const [logs, totalResult] = await Promise.all([
        db.select().from(constructionSafetyLogs)
          .where(eq(constructionSafetyLogs.projectId, input.projectId))
          .orderBy(desc(constructionSafetyLogs.logDate))
          .limit(input.pageSize).offset(offset),
        db.select({ cnt: count() }).from(constructionSafetyLogs)
          .where(eq(constructionSafetyLogs.projectId, input.projectId)),
      ]);
      return {
        data: logs,
        total: totalResult[0]?.cnt ?? 0,
        totalPages: Math.ceil((totalResult[0]?.cnt ?? 0) / input.pageSize),
      };
    }),

  create: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      logDate: z.string(),
      incidentType: z.enum(["near_miss", "minor_injury", "major_injury", "property_damage", "safety_violation", "inspection"]),
      severity: z.enum(["low", "medium", "high", "critical"]).default("low"),
      title: z.string().min(1),
      description: z.string().min(1),
      location: z.string().optional(),
      involvedPersons: z.string().optional(),
      immediateAction: z.string().optional(),
      correctiveAction: z.string().optional(),
      photoUrls: z.array(z.string()).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available" });
      const result = await db.insert(constructionSafetyLogs).values({
        ...input,
        photoUrls: input.photoUrls ?? null,
        reportedById: ctx.user.id,
      });
      return { id: Number((result as any)?.insertId ?? (result as any)?.[0]?.insertId ?? 0) };
    }),

  close: protectedProcedure
    .input(z.object({ id: z.number(), correctiveAction: z.string().optional() }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available" });
      await db.update(constructionSafetyLogs)
        .set({
          isClosed: true,
          closedAt: new Date(),
          investigatedById: ctx.user.id,
          correctiveAction: input.correctiveAction,
        })
        .where(eq(constructionSafetyLogs.id, input.id));
      return { success: true };
    }),
});

// ── Reports ──────────────────────────────────────────────────
export const constructionReportsRouter = router({
  // Delay analysis
  delayAnalysis: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available" });
      const [byReason] = await db.select({
        weather: sql<number>`SUM(CASE WHEN holdReason = 'weather' THEN 1 ELSE 0 END)`,
        pending_approval: sql<number>`SUM(CASE WHEN holdReason = 'pending_approval' THEN 1 ELSE 0 END)`,
        subcontractor: sql<number>`SUM(CASE WHEN holdReason = 'subcontractor' THEN 1 ELSE 0 END)`,
        administrative: sql<number>`SUM(CASE WHEN holdReason = 'administrative' THEN 1 ELSE 0 END)`,
        other: sql<number>`SUM(CASE WHEN holdReason = 'other' THEN 1 ELSE 0 END)`,
        overdue: sql<number>`SUM(CASE WHEN endDatePlanned < CURDATE() AND status NOT IN ('completed') THEN 1 ELSE 0 END)`,
      }).from(constructionTasks).where(eq(constructionTasks.projectId, input.projectId));
      return byReason;
    }),

  // Team performance
  teamPerformance: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available" });
      return db.select({
        assignedToId: constructionTasks.assignedToId,
        total: count(),
        completed: sql<number>`SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END)`,
        overdue: sql<number>`SUM(CASE WHEN endDatePlanned < CURDATE() AND status NOT IN ('completed') THEN 1 ELSE 0 END)`,
        totalHours: sql<number>`SUM(actualHours)`,
      }).from(constructionTasks)
        .where(eq(constructionTasks.projectId, input.projectId))
        .groupBy(constructionTasks.assignedToId);
    }),

  // Budget summary
  budgetSummary: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available" });
      const [taskBudget] = await db.select({
        estimatedTotal: sql<number>`SUM(estimated_cost)`,
        actualTotal: sql<number>`SUM(actual_cost)`,
      }).from(constructionTasks).where(eq(constructionTasks.projectId, input.projectId));

      const [project] = await db.select({
        budgetPlanned: constructionProjects.budgetPlanned,
        budgetActual: constructionProjects.budgetActual,
      }).from(constructionProjects).where(eq(constructionProjects.id, input.projectId)).limit(1);

      return { taskBudget, project };
    }),

  // Quantity summary
  quantitySummary: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available" });
      return db.select({
        materialName: constructionQuantityTracking.materialName,
        unit: constructionQuantityTracking.unit,
        totalPlanned: sql<number>`SUM(quantityPlanned)`,
        totalActual: sql<number>`SUM(quantityActual)`,
      }).from(constructionQuantityTracking)
        .where(eq(constructionQuantityTracking.projectId, input.projectId))
        .groupBy(constructionQuantityTracking.materialName, constructionQuantityTracking.unit);
    }),

  // Safety summary
  safetySummary: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available" });
      const [stats] = await db.select({
        total: count(),
        open: sql<number>`SUM(CASE WHEN isClosed = 0 THEN 1 ELSE 0 END)`,
        critical: sql<number>`SUM(CASE WHEN severity = 'critical' THEN 1 ELSE 0 END)`,
        injuries: sql<number>`SUM(CASE WHEN incidentType IN ('minor_injury','major_injury') THEN 1 ELSE 0 END)`,
      }).from(constructionSafetyLogs).where(eq(constructionSafetyLogs.projectId, input.projectId));
      return stats;
    }),
});

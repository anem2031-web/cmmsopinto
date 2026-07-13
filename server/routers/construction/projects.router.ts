import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { eq, desc, asc, and, like, or, count, sql } from "drizzle-orm";
import { router, protectedProcedure } from "../_shared/procedures";
import { getDb } from "../../_core/db";
import {
  constructionProjects,
  constructionPhases,
  constructionTasks,
  constructionProjectMembers,
  type InsertConstructionProject,
} from "../../../drizzle/schema";

// ── Helpers ─────────────────────────────────────────────────
// الأدوار المسموح لها بالوصول لجميع المشاريع
const CONSTRUCTION_ALLOWED_ROLES = ["owner", "admin", "maintenance_manager", "senior_management"] as const;

async function assertProjectAccess(projectId: number, userId: number, userRole: string, requireEdit = false) {
  const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available" });
  const project = await db
    .select()
    .from(constructionProjects)
    .where(eq(constructionProjects.id, projectId))
    .limit(1);
  if (!project[0]) throw new TRPCError({ code: "NOT_FOUND", message: "المشروع غير موجود" });

  // الأدوار المحددة ترى جميع المشاريع بدون قيود
  const isAllowedRole = (CONSTRUCTION_ALLOWED_ROLES as readonly string[]).includes(userRole);
  if (isAllowedRole) {
    return { project: project[0], member: null };
  }

  // باقي الأدوار تحتاج عضوية في المشروع
  const member = await db
    .select()
    .from(constructionProjectMembers)
    .where(
      and(
        eq(constructionProjectMembers.projectId, projectId),
        eq(constructionProjectMembers.userId, userId)
      )
    )
    .limit(1);

  if (!member[0]) {
    throw new TRPCError({ code: "FORBIDDEN", message: "ليس لديك صلاحية لهذا المشروع" });
  }
  if (requireEdit && !member[0]?.canEdit) {
    throw new TRPCError({ code: "FORBIDDEN", message: "ليس لديك صلاحية التعديل" });
  }
  return { project: project[0], member: member[0] };
}

async function generateProjectNumber(db: NonNullable<Awaited<ReturnType<typeof getDb>>>) {
  const year = new Date().getFullYear();
  
  // Get all existing project numbers for this year to find next available
  const existing = await db
    .select({ projectNumber: constructionProjects.projectNumber })
    .from(constructionProjects)
    .where(like(constructionProjects.projectNumber, `PRJ-${year}-%`));

  // Extract sequence numbers and find max
  let maxSeq = 0;
  for (const row of existing) {
    const parts = row.projectNumber?.split("-");
    if (parts && parts.length === 3) {
      const seq = parseInt(parts[2], 10);
      if (!isNaN(seq) && seq > maxSeq) maxSeq = seq;
    }
  }

  const nextSeq = maxSeq + 1;
  return `PRJ-${year}-${String(nextSeq).padStart(4, "0")}`;
}

// ── Router ──────────────────────────────────────────────────
export const projectsRouter = router({

  // List all projects with filters and pagination
  list: protectedProcedure
    .input(z.object({
      status: z.string().optional(),
      search: z.string().optional(),
      siteId: z.number().optional(),
      managerId: z.number().optional(),
      isArchived: z.boolean().optional().default(false),
      page: z.number().min(1).default(1),
      pageSize: z.number().min(1).max(100).default(20),
    }).optional())
    .query(async ({ input, ctx }) => {
      const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available" });
      const { status, search, siteId, managerId, isArchived = false, page = 1, pageSize = 20 } = input || {};
      const offset = (page - 1) * pageSize;

      const conditions = [eq(constructionProjects.isArchived, isArchived)];
      if (status) conditions.push(eq(constructionProjects.status, status as any));
      if (siteId) conditions.push(eq(constructionProjects.siteId, siteId));
      if (managerId) conditions.push(eq(constructionProjects.managerId, managerId));
      if (search) {
        conditions.push(
          or(
            like(constructionProjects.name, `%${search}%`),
            like(constructionProjects.projectNumber, `%${search}%`)
          )!
        );
      }

      const [projects, totalResult] = await Promise.all([
        db.select().from(constructionProjects)
          .where(and(...conditions))
          .orderBy(desc(constructionProjects.createdAt))
          .limit(pageSize)
          .offset(offset),
        db.select({ cnt: count() }).from(constructionProjects).where(and(...conditions)),
      ]);

      return {
        data: projects,
        total: totalResult[0]?.cnt ?? 0,
        page,
        pageSize,
        totalPages: Math.ceil((totalResult[0]?.cnt ?? 0) / pageSize),
      };
    }),

  // Get single project with stats
  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input, ctx }) => {
      const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available" });
      await assertProjectAccess(input.id, ctx.user.id, ctx.user.role);

      const [project] = await db
        .select()
        .from(constructionProjects)
        .where(eq(constructionProjects.id, input.id))
        .limit(1);

      if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "المشروع غير موجود" });

      // Get stats
      const [phaseCount, taskStats, memberCount] = await Promise.all([
        db.select({ cnt: count() }).from(constructionPhases)
          .where(eq(constructionPhases.projectId, input.id)),
        db.select({
          total: count(),
          completed: sql<number>`SUM(CASE WHEN \`status\` = 'completed' THEN 1 ELSE 0 END)`,
          overdue: sql<number>`SUM(CASE WHEN \`endDatePlanned\` < CURDATE() AND \`status\` NOT IN ('completed','cancelled') THEN 1 ELSE 0 END)`,
        }).from(constructionTasks).where(eq(constructionTasks.projectId, input.id)),
        db.select({ cnt: count() }).from(constructionProjectMembers)
          .where(eq(constructionProjectMembers.projectId, input.id)),
      ]);

      return {
        ...project,
        stats: {
          phaseCount: phaseCount[0]?.cnt ?? 0,
          taskTotal: taskStats[0]?.total ?? 0,
          taskCompleted: taskStats[0]?.completed ?? 0,
          taskOverdue: taskStats[0]?.overdue ?? 0,
          memberCount: memberCount[0]?.cnt ?? 0,
        },
      };
    }),

  // Create project
  create: protectedProcedure
    .input(z.object({
      name: z.string().min(1),
      nameEn: z.string().optional(),
      description: z.string().optional(),
      status: z.enum(["planning", "active", "on_hold", "completed", "cancelled"]).default("planning"),
      priority: z.enum(["low", "medium", "high", "critical"]).default("medium"),
      siteId: z.number().optional(),
      sectionId: z.number().optional(),
      managerId: z.number().optional(),
      budgetPlanned: z.string().optional(),
      laborCost: z.string().optional(),
      issueLevel: z.enum(["low", "medium", "high", "critical"]).optional(),
      tags: z.array(z.string()).optional(),
      checklist: z.array(z.object({ id: z.string(), text: z.string(), done: z.boolean() })).optional(),
      attachments: z.array(z.object({ name: z.string(), url: z.string(), uploadedAt: z.string() })).optional(),
      startDatePlanned: z.string().optional(),
      endDatePlanned: z.string().optional(),
      coverImageUrl: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available" });
      const projectNumber = await generateProjectNumber(db);

      const data: InsertConstructionProject = {
        ...input,
        projectNumber,
        ownerId: ctx.user.id,
        createdById: ctx.user.id,
      };

      const result = await db.insert(constructionProjects).values(data);
      // TiDB/MySQL2 returns insertId in different formats
      const rawResult = result as any;
      const newId = Number(
        rawResult?.insertId ??
        rawResult?.[0]?.insertId ??
        rawResult?.lastInsertRowid ??
        0
      );

      if (!newId || isNaN(newId)) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "فشل إنشاء المشروع — لم يُعاد الـ ID" });
      }

      // Auto-add creator as manager member
      await db.insert(constructionProjectMembers).values({
        projectId: newId,
        userId: ctx.user.id,
        role: "manager",
        canEdit: true,
        canDelete: true,
        canApprove: true,
        addedById: ctx.user.id,
      });

      return { id: newId, projectNumber };
    }),

  // Update project
  update: protectedProcedure
    .input(z.object({
      id: z.number(),
      name: z.string().min(1).optional(),
      nameEn: z.string().optional(),
      description: z.string().optional(),
      status: z.enum(["planning", "active", "on_hold", "completed", "cancelled"]).optional(),
      priority: z.enum(["low", "medium", "high", "critical"]).optional(),
      siteId: z.number().optional(),
      sectionId: z.number().optional(),
      managerId: z.number().optional(),
      budgetPlanned: z.string().optional(),
      budgetActual: z.string().optional(),
      laborCost: z.string().optional(),
      issueLevel: z.enum(["low", "medium", "high", "critical"]).nullable().optional(),
      tags: z.array(z.string()).optional(),
      checklist: z.array(z.object({ id: z.string(), text: z.string(), done: z.boolean() })).optional(),
      attachments: z.array(z.object({ name: z.string(), url: z.string(), uploadedAt: z.string() })).optional(),
      startDatePlanned: z.string().optional(),
      endDatePlanned: z.string().optional(),
      startDateActual: z.string().optional(),
      endDateActual: z.string().optional(),
      coverImageUrl: z.string().optional(),
      isArchived: z.boolean().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available" });
      const { id, ...data } = input;
      await assertProjectAccess(id, ctx.user.id, ctx.user.role, true);
      await db.update(constructionProjects).set(data).where(eq(constructionProjects.id, id));
      return { success: true };
    }),

  // Delete project
  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available" });
      const { project } = await assertProjectAccess(input.id, ctx.user.id, ctx.user.role, true);
      if (project.ownerId !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "فقط مالك المشروع يستطيع الحذف" });
      }
      await db.delete(constructionProjects).where(eq(constructionProjects.id, input.id));
      return { success: true };
    }),

  // Recalculate project progress from phases
  recalculateProgress: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available" });
      const phases = await db
        .select({ progress: constructionPhases.progressPercent })
        .from(constructionPhases)
        .where(eq(constructionPhases.projectId, input.id));

      if (phases.length === 0) return { progress: 0 };

      const avg = phases.reduce((sum, p) => sum + Number(p.progress ?? 0), 0) / phases.length;
      const progress = Math.round(avg * 100) / 100;

      await db
        .update(constructionProjects)
        .set({ progressPercent: String(progress) })
        .where(eq(constructionProjects.id, input.id));

      return { progress };
    }),

  // Portfolio stats for dashboard
  portfolioStats: protectedProcedure
    .query(async ({ ctx }) => {
      const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available" });
      const [stats] = await db.select({
        total: count(),
        active: sql<number>`SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END)`,
        planning: sql<number>`SUM(CASE WHEN status = 'planning' THEN 1 ELSE 0 END)`,
        completed: sql<number>`SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END)`,
        on_hold: sql<number>`SUM(CASE WHEN status = 'on_hold' THEN 1 ELSE 0 END)`,
      }).from(constructionProjects).where(eq(constructionProjects.isArchived, false));

      const allProjects = await db
        .select({ progress: constructionProjects.progressPercent })
        .from(constructionProjects)
        .where(eq(constructionProjects.isArchived, false));

      const avgProgress = allProjects.length > 0
        ? allProjects.reduce((s, p) => s + Number(p.progress ?? 0), 0) / allProjects.length
        : 0;

      return { ...stats, avgProgress: Math.round(avgProgress) };
    }),
});

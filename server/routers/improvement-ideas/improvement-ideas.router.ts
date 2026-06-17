import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { router, protectedProcedure, supervisorProcedure, managementProcedure } from "../_shared/procedures";
import { detectLanguage, type SupportedLanguage } from "../../services/translation";
import * as db from "../../db";
import * as ideasDb from "../../improvementIdeas";

// ملاحظة: الترجمة التلقائية (ar/en/ur) للعنوان والوصف غير مفعّلة بهذه المرحلة الأولى
// (الحقول title_ar/en/ur موجودة بقاعدة البيانات وجاهزة لربطها بمحرك الترجمة لاحقاً بدون أي تعديل على الجدول)

export const improvementIdeasRouter = router({
  listPaginated: protectedProcedure.input(z.object({
    status: z.string().optional(),
    priority: z.string().optional(),
    category: z.string().optional(),
    siteId: z.number().optional(),
    sectionId: z.number().optional(),
    submittedById: z.number().optional(),
    assignedToId: z.number().optional(),
    search: z.string().optional(),
    page: z.number().min(1).default(1),
    pageSize: z.number().min(1).max(100).default(10),
  }).optional()).query(async ({ input }) => {
    const { page = 1, pageSize = 10, ...filters } = input || {};
    return ideasDb.getImprovementIdeasPaginated(filters, page, pageSize);
  }),

  getById: protectedProcedure.input(z.object({ id: z.number() })).query(async ({ input }) => {
    const idea = await ideasDb.getImprovementIdeaById(input.id);
    if (!idea) throw new TRPCError({ code: "NOT_FOUND", message: "الفكرة غير موجودة" });
    return idea;
  }),

  create: protectedProcedure.input(z.object({
    title: z.string().min(1),
    description: z.string().optional(),
    category: z.string(),
    priority: z.string().default("medium"),
    expectedBenefit: z.string().optional(),
    siteId: z.number().optional(),
    sectionId: z.number().optional(),
    assetId: z.number().optional(),
  })).mutation(async ({ input, ctx }) => {
    const requestNumber = await ideasDb.getNextImprovementIdeaNumber();
    const detectedLang: SupportedLanguage = await detectLanguage(input.title).catch(() => "ar" as SupportedLanguage);

    const id = await ideasDb.createImprovementIdea({
      ...input,
      requestNumber,
      originalLanguage: detectedLang,
      submittedById: ctx.user.id,
      status: "new",
    });

    await db.createAuditLog({ userId: ctx.user.id, action: "create_improvement_idea", entityType: "improvement_idea", entityId: id! });

    // إشعار موظفي الفرز (نفس أدوار فرز البلاغات: مشرف / مدير صيانة)
    const supervisors = await db.getUsersByRole("supervisor");
    const managers = await db.getManagerUsers();
    for (const u of [...supervisors, ...managers]) {
      await db.createNotification({ userId: u.id, title: "فكرة تحسين جديدة", message: `${requestNumber} - ${input.title} بانتظار الفرز`, type: "info" });
    }

    return { id, requestNumber };
  }),

  // الفرز: مشرف أو مدير صيانة يراجع الفكرة ويرسلها للإدارة العليا
  triage: supervisorProcedure.input(z.object({ id: z.number() })).mutation(async ({ input, ctx }) => {
    const idea = await ideasDb.getImprovementIdeaById(input.id);
    if (!idea) throw new TRPCError({ code: "NOT_FOUND", message: "الفكرة غير موجودة" });
    if (idea.status !== "new") throw new TRPCError({ code: "BAD_REQUEST", message: "هذه الفكرة تم فرزها مسبقاً" });

    await ideasDb.triageImprovementIdea(input.id, ctx.user.id);
    await db.createAuditLog({ userId: ctx.user.id, action: "triage_improvement_idea", entityType: "improvement_idea", entityId: input.id });

    const seniors = await db.getUsersByRole("senior_management");
    for (const u of seniors) {
      await db.createNotification({ userId: u.id, title: "فكرة تحسين بانتظار قرارك", message: `${idea.requestNumber} - ${idea.title}`, type: "info" });
    }
  }),

  // قرار الإدارة العليا: موافقة (+تكليف منفّذ) / تأجيل (+تاريخ) / إلغاء (+سبب)
  decide: managementProcedure.input(z.object({
    id: z.number(),
    decision: z.enum(["approved", "postponed", "cancelled"]),
    decisionNotes: z.string().optional(),
    assignedToId: z.number().optional(),
    postponedUntil: z.string().optional(), // ISO date string
    cancelReason: z.string().optional(),
  })).mutation(async ({ input, ctx }) => {
    const idea = await ideasDb.getImprovementIdeaById(input.id);
    if (!idea) throw new TRPCError({ code: "NOT_FOUND", message: "الفكرة غير موجودة" });
    if (idea.status !== "pending_decision") throw new TRPCError({ code: "BAD_REQUEST", message: "هذه الفكرة ليست بانتظار قرار حالياً" });

    if (input.decision === "approved" && !input.assignedToId) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "يجب تحديد الشخص المكلَّف بالتنفيذ عند الموافقة" });
    }
    if (input.decision === "postponed" && !input.postponedUntil) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "يجب تحديد تاريخ التأجيل" });
    }

    await ideasDb.decideImprovementIdea(input.id, {
      decision: input.decision,
      decidedById: ctx.user.id,
      decisionNotes: input.decisionNotes,
      assignedToId: input.assignedToId,
      postponedUntil: input.postponedUntil ? new Date(input.postponedUntil) : undefined,
      cancelReason: input.cancelReason,
    });

    await db.createAuditLog({ userId: ctx.user.id, action: `decide_improvement_idea_${input.decision}`, entityType: "improvement_idea", entityId: input.id });

    const decisionTitle = input.decision === "approved" ? "تمت الموافقة على فكرتك" : input.decision === "postponed" ? "تم تأجيل فكرتك" : "تم إلغاء فكرتك";
    await db.createNotification({
      userId: idea.submittedById,
      title: decisionTitle,
      message: `${idea.requestNumber} - ${idea.title}`,
      type: input.decision === "approved" ? "success" : "info",
    });

    if (input.decision === "approved" && input.assignedToId) {
      await db.createNotification({
        userId: input.assignedToId,
        title: "تم تكليفك بتنفيذ فكرة تحسين",
        message: `${idea.requestNumber} - ${idea.title}`,
        type: "info",
      });
    }
  }),

  // إكمال التنفيذ — فقط الشخص المكلَّف (أو admin/owner)
  complete: protectedProcedure.input(z.object({
    id: z.number(),
    completionNotes: z.string().optional(),
  })).mutation(async ({ input, ctx }) => {
    const idea = await ideasDb.getImprovementIdeaById(input.id);
    if (!idea) throw new TRPCError({ code: "NOT_FOUND", message: "الفكرة غير موجودة" });
    if (idea.status !== "in_progress") throw new TRPCError({ code: "BAD_REQUEST", message: "هذه الفكرة ليست قيد التنفيذ حالياً" });

    const canComplete = idea.assignedToId === ctx.user.id || ["admin", "owner"].includes(ctx.user.role);
    if (!canComplete) throw new TRPCError({ code: "FORBIDDEN", message: "فقط الشخص المكلَّف بالتنفيذ يقدر يُكمل هذي الفكرة" });

    await ideasDb.completeImprovementIdea(input.id, input.completionNotes);
    await db.createAuditLog({ userId: ctx.user.id, action: "complete_improvement_idea", entityType: "improvement_idea", entityId: input.id });

    await db.createNotification({
      userId: idea.submittedById,
      title: "تم تنفيذ فكرتك بنجاح",
      message: `${idea.requestNumber} - ${idea.title}`,
      type: "success",
    });
  }),

  // حذف — فقط مقدّم الطلب وبحالة "جديد" (قبل الفرز)، أو admin/owner بأي وقت
  delete: protectedProcedure.input(z.object({ id: z.number() })).mutation(async ({ input, ctx }) => {
    const idea = await ideasDb.getImprovementIdeaById(input.id);
    if (!idea) throw new TRPCError({ code: "NOT_FOUND", message: "الفكرة غير موجودة" });

    const canDelete = (idea.submittedById === ctx.user.id && idea.status === "new") || ["admin", "owner"].includes(ctx.user.role);
    if (!canDelete) throw new TRPCError({ code: "FORBIDDEN", message: "لا يمكنك حذف هذه الفكرة" });

    await ideasDb.deleteImprovementIdea(input.id);
    await db.createAuditLog({ userId: ctx.user.id, action: "delete_improvement_idea", entityType: "improvement_idea", entityId: input.id });
  }),
});

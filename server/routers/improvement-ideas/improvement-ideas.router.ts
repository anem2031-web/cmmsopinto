import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { router, protectedProcedure, ideaTriageProcedure, managementProcedure } from "../_shared/procedures";
import { detectLanguage, type SupportedLanguage } from "../../services/translation/translation";
import * as db from "../../_core/db";
import * as ideasDb from "../../services/improvement-ideas/improvementIdeas";

// الأدوار صاحبة الرؤية الكاملة (الفرز + التصنيف + اتخاذ القرار النهائي مجتمعين برؤية كل المقترحات)
const FULL_VISIBILITY_ROLES = ["maintenance_manager", "senior_management", "executive_director", "owner", "admin"];

// الموظف العادي لا يرى إلا حالة مقترحه فقط — بدون أي بيانات داخلية عن المراجعة أو القرار
function sanitizeForEmployee(idea: any) {
  const { triagerName, deciderName, decisionNotes, cancelReason, completionNotes, groupCategory,
    linkedTicketNumber, linkedTicketStatus, linkedPONumber, linkedPOStatus, ...safe } = idea;
  return safe;
}

export const improvementIdeasRouter = router({
  // قائمة مرقّمة — تُستخدم لتبويب "الكل" (الأدوار صاحبة الصلاحية) وتبويب "أفكاري" (الموظف العادي)
  listPaginated: protectedProcedure.input(z.object({
    status: z.string().optional(),
    priority: z.string().optional(),
    category: z.string().optional(),
    groupCategory: z.string().optional(),
    siteId: z.number().optional(),
    sectionId: z.number().optional(),
    search: z.string().optional(),
    page: z.number().min(1).default(1),
    pageSize: z.number().min(1).max(100).default(10),
  }).optional()).query(async ({ input, ctx }) => {
    const { page = 1, pageSize = 10, ...filters } = input || {};
    const hasFullVisibility = FULL_VISIBILITY_ROLES.includes(ctx.user.role);
    const finalFilters: any = hasFullVisibility ? filters : { ...filters, submittedById: ctx.user.id };
    const result = await ideasDb.getImprovementIdeasPaginated(finalFilters, page, pageSize);
    if (hasFullVisibility) return result;
    return { ...result, ideas: result.ideas.map(sanitizeForEmployee) };
  }),

  getById: protectedProcedure.input(z.object({ id: z.number() })).query(async ({ input, ctx }) => {
    const idea = await ideasDb.getImprovementIdeaById(input.id);
    if (!idea) throw new TRPCError({ code: "NOT_FOUND", message: "الفكرة غير موجودة" });

    const hasFullVisibility = FULL_VISIBILITY_ROLES.includes(ctx.user.role);
    if (!hasFullVisibility) {
      if (idea.submittedById !== ctx.user.id) throw new TRPCError({ code: "FORBIDDEN", message: "لا يمكنك الاطلاع على مقترحات الآخرين" });
      return sanitizeForEmployee(idea);
    }
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

    // إشعار الأدوار صاحبة صلاحية الفرز والتصنيف فقط (مدير الصيانة + owner/admin)
    const managers = await db.getManagerUsers();
    for (const u of managers) {
      await db.createNotification({ userId: u.id, title: "فكرة تحسين جديدة", message: `${requestNumber} - ${input.title} بانتظار الفرز والتصنيف`, type: "info" });
    }

    return { id, requestNumber };
  }),

  // عدّادات المجموعات للأفكار المصنّفة (لعرض المجلدات بانتظار قرار الإدارة)
  getGroupedClassifiedCounts: protectedProcedure.query(async ({ ctx }) => {
    if (!FULL_VISIBILITY_ROLES.includes(ctx.user.role)) throw new TRPCError({ code: "FORBIDDEN", message: "غير مخوَّل" });
    return ideasDb.getGroupedClassifiedCounts();
  }),

  // الأفكار المصنّفة داخل مجموعة معيّنة، مرتبة حسب الأولوية
  getClassifiedByGroup: protectedProcedure.input(z.object({ groupCategory: z.string() })).query(async ({ input, ctx }) => {
    if (!FULL_VISIBILITY_ROLES.includes(ctx.user.role)) throw new TRPCError({ code: "FORBIDDEN", message: "غير مخوَّل" });
    return ideasDb.getClassifiedIdeasByGroup(input.groupCategory);
  }),

  // الأفكار المعتمدة بانتظار تحويلها لتذكرة/طلب شراء — يظهر فقط لأدوار الفرز (ليس الإدارة العليا)
  getApproved: ideaTriageProcedure.query(async () => {
    return ideasDb.getApprovedIdeas();
  }),

  // الفرز والتصنيف: تصحيح التصنيف + تحديد المجموعة/الملف + تحديد الأولوية — بإجراء واحد
  classify: ideaTriageProcedure.input(z.object({
    id: z.number(),
    category: z.string(),
    groupCategory: z.string(),
    priority: z.string(),
  })).mutation(async ({ input, ctx }) => {
    const idea = await ideasDb.getImprovementIdeaById(input.id);
    if (!idea) throw new TRPCError({ code: "NOT_FOUND", message: "الفكرة غير موجودة" });
    if (idea.status !== "new") throw new TRPCError({ code: "BAD_REQUEST", message: "هذه الفكرة تم فرزها وتصنيفها مسبقاً" });

    await ideasDb.classifyImprovementIdea(input.id, {
      classifiedById: ctx.user.id,
      category: input.category,
      groupCategory: input.groupCategory,
      priority: input.priority,
    });
    await db.createAuditLog({ userId: ctx.user.id, action: "classify_improvement_idea", entityType: "improvement_idea", entityId: input.id });

    // ملاحظة: لا تُرسل إشعارات لدور الإدارة العليا هنا — حسب السياسة المعتمدة،
    // هذا الدور يستقبل فقط إشعار "طلب شراء بانتظار اعتمادك" ولا شيء غيره.
    // (الحماية مفروضة أيضاً مركزياً داخل db.createNotification كطبقة أمان إضافية)
  }),

  // قرار الإدارة العليا: موافقة / تأجيل (+تاريخ) / إلغاء (+سبب)
  decide: managementProcedure.input(z.object({
    id: z.number(),
    decision: z.enum(["approved", "postponed", "cancelled"]),
    decisionNotes: z.string().optional(),
    postponedUntil: z.string().optional(), // ISO date string
    cancelReason: z.string().optional(),
  })).mutation(async ({ input, ctx }) => {
    const idea = await ideasDb.getImprovementIdeaById(input.id);
    if (!idea) throw new TRPCError({ code: "NOT_FOUND", message: "الفكرة غير موجودة" });
    if (idea.status !== "classified") throw new TRPCError({ code: "BAD_REQUEST", message: "هذه الفكرة ليست بانتظار قرار حالياً" });

    if (input.decision === "postponed" && !input.postponedUntil) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "يجب تحديد تاريخ التأجيل" });
    }

    await ideasDb.decideImprovementIdea(input.id, {
      decision: input.decision,
      decidedById: ctx.user.id,
      decisionNotes: input.decisionNotes,
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

    if (input.decision === "approved") {
      const managers = await db.getManagerUsers();
      for (const u of managers) {
        await db.createNotification({ userId: u.id, title: "فكرة معتمدة بانتظار التحويل", message: `${idea.requestNumber} - ${idea.title}`, type: "success" });
      }
    }
  }),

  // ربط الفكرة المعتمدة بتذكرة تم إنشاؤها فعلياً من نافذة البلاغات الأصلية
  linkToTicket: ideaTriageProcedure.input(z.object({ id: z.number(), ticketId: z.number() })).mutation(async ({ input, ctx }) => {
    const idea = await ideasDb.getImprovementIdeaById(input.id);
    if (!idea) throw new TRPCError({ code: "NOT_FOUND", message: "الفكرة غير موجودة" });
    if (idea.status !== "approved") throw new TRPCError({ code: "BAD_REQUEST", message: "هذه الفكرة ليست معتمدة حالياً" });

    await ideasDb.linkIdeaToTicket(input.id, input.ticketId);
    await db.createAuditLog({ userId: ctx.user.id, action: "link_improvement_idea_ticket", entityType: "improvement_idea", entityId: input.id });
  }),

  // ربط الفكرة المعتمدة بطلب شراء تم إنشاؤه فعلياً من نافذة المشتريات الأصلية
  linkToPurchaseOrder: ideaTriageProcedure.input(z.object({ id: z.number(), purchaseOrderId: z.number() })).mutation(async ({ input, ctx }) => {
    const idea = await ideasDb.getImprovementIdeaById(input.id);
    if (!idea) throw new TRPCError({ code: "NOT_FOUND", message: "الفكرة غير موجودة" });
    if (idea.status !== "approved") throw new TRPCError({ code: "BAD_REQUEST", message: "هذه الفكرة ليست معتمدة حالياً" });

    await ideasDb.linkIdeaToPurchaseOrder(input.id, input.purchaseOrderId);
    await db.createAuditLog({ userId: ctx.user.id, action: "link_improvement_idea_po", entityType: "improvement_idea", entityId: input.id });
  }),

  // تأكيد إكمال التنفيذ — يدوي، متاح لأدوار الفرز بأي وقت أثناء "قيد التنفيذ"
  complete: ideaTriageProcedure.input(z.object({
    id: z.number(),
    completionNotes: z.string().optional(),
  })).mutation(async ({ input, ctx }) => {
    const idea = await ideasDb.getImprovementIdeaById(input.id);
    if (!idea) throw new TRPCError({ code: "NOT_FOUND", message: "الفكرة غير موجودة" });
    if (idea.status !== "in_progress") throw new TRPCError({ code: "BAD_REQUEST", message: "هذه الفكرة ليست قيد التنفيذ حالياً" });

    await ideasDb.completeImprovementIdea(input.id, input.completionNotes);
    await db.createAuditLog({ userId: ctx.user.id, action: "complete_improvement_idea", entityType: "improvement_idea", entityId: input.id });

    await db.createNotification({
      userId: idea.submittedById,
      title: "تم تنفيذ فكرتك بنجاح",
      message: `${idea.requestNumber} - ${idea.title}`,
      type: "success",
    });
  }),

  // حذف — فقط مقدّم الطلب وبحالة "جديدة" (قبل الفرز)، أو admin/owner بأي وقت
  delete: protectedProcedure.input(z.object({ id: z.number() })).mutation(async ({ input, ctx }) => {
    const idea = await ideasDb.getImprovementIdeaById(input.id);
    if (!idea) throw new TRPCError({ code: "NOT_FOUND", message: "الفكرة غير موجودة" });

    const canDelete = (idea.submittedById === ctx.user.id && idea.status === "new") || ["admin", "owner"].includes(ctx.user.role);
    if (!canDelete) throw new TRPCError({ code: "FORBIDDEN", message: "لا يمكنك حذف هذه الفكرة" });

    await ideasDb.deleteImprovementIdea(input.id);
    await db.createAuditLog({ userId: ctx.user.id, action: "delete_improvement_idea", entityType: "improvement_idea", entityId: input.id });
  }),
});

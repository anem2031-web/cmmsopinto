import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { router, protectedProcedure, managerProcedure } from "../_shared/procedures";
import { detectLanguage, type SupportedLanguage } from "../../services/translation/translation";
import { queueTranslation, translationCache } from "../../services/translation/translationEngine";
import * as db from "../../_core/db";

export const ticketsRouter = router({
  list: protectedProcedure.input(z.object({
    status: z.string().optional(),
    priority: z.string().optional(),
    siteId: z.number().optional(),
    sectionId: z.number().optional(),
    assetId: z.number().optional(),
    search: z.string().optional(),
    category: z.string().optional(),
    assignedTechnicianId: z.number().optional(),
    assignedToId: z.number().optional(), // Phase 2: filter by user-based assignment
  }).optional()).query(async ({ input, ctx }) => {
    const role = ctx.user.role;
    let filters: any = input || {};
    if (role === "operator") filters.reportedById = ctx.user.id;
    else if (role === "technician") filters.assignedToId = ctx.user.id;
    return db.getTickets(filters);
  }),

  // صفحات حقيقية لقائمة البلاغات (10 بلاغات/صفحة افتراضياً) — لا تؤثر على list الأصلي
  listPaginated: protectedProcedure.input(z.object({
    status: z.string().optional(),
    priority: z.string().optional(),
    siteId: z.number().optional(),
    sectionId: z.number().optional(),
    assetId: z.number().optional(),
    search: z.string().optional(),
    category: z.string().optional(),
    assignedTechnicianId: z.number().optional(),
    assignedToId: z.number().optional(),
    page: z.number().min(1).default(1),
    pageSize: z.number().min(1).max(100).default(10),
  }).optional()).query(async ({ input, ctx }) => {
    const role = ctx.user.role;
    const { page = 1, pageSize = 10, ...rest } = input || {};
    let filters: any = rest;
    if (role === "operator") filters.reportedById = ctx.user.id;
    else if (role === "technician") filters.assignedToId = ctx.user.id;
    return db.getTicketsPaginated(filters, page, pageSize);
  }),

  getById: protectedProcedure.input(z.object({ id: z.number() })).query(async ({ input }) => {
    const ticket = await db.getTicketById(input.id);
    if (!ticket) throw new TRPCError({ code: "NOT_FOUND", message: "البلاغ غير موجود" });
    return ticket;
  }),

  create: protectedProcedure.input(z.object({
    title: z.string().min(1),
    description: z.string().optional(),
    priority: z.string().default("medium"),
    category: z.string().default("general"),
    siteId: z.number().optional(),
    sectionId: z.number().optional(),
    assetId: z.number().optional(),
    locationDetail: z.string().optional(),
    beforePhotoUrl: z.string().optional(),
  })).mutation(async ({ input, ctx }) => {
    const ticketNumber = await db.getNextTicketNumber();

    // كشف اللغة فقط — الترجمة تحدث في الخلفية
    const detectedLang: SupportedLanguage = await detectLanguage(input.title).catch(() => "ar" as SupportedLanguage);

    // إنشاء التذكرة فوراً بدون انتظار الترجمة
    const id = await db.createTicket({
      ...input,
      originalLanguage: detectedLang,
      ticketNumber,
      reportedById: ctx.user.id,
      status: "pending_triage"
    });
    // ترجمة في الخلفية — المستخدم لا ينتظر
    const fieldsToQueue = [
      { fieldName: "title", text: input.title },
      ...(input.description ? [{ fieldName: "description", text: input.description }] : []),
    ];
    queueTranslation({
      entityType: "TICKET",
      entityId: id!,
      fields: fieldsToQueue,
      sourceLanguage: detectedLang,
      userId: ctx.user.id,
    }).catch(e => console.error("[Ticket] Queue translation failed:", e));

    await db.addTicketStatusHistory({ ticketId: id!, fromStatus: undefined, toStatus: "pending_triage", changedById: ctx.user.id });
    await db.createAuditLog({ userId: ctx.user.id, action: "create_ticket", entityType: "ticket", entityId: id! });
    // Notify supervisors first (new workflow)
    const supervisors = await db.getUsersByRole("supervisor");
    for (const sup of supervisors) {
      await db.createNotification({ userId: sup.id, title: "بلاغ جديد بانتظار الفرز", message: `البلاغ ${ticketNumber} - ${input.title} بانتظار الفرز والتصنيف`, type: "info", relatedTicketId: id! });
    }
    // Also notify maintenance managers
    const managers = await db.getManagerUsers();
    for (const mgr of managers) {
      await db.createNotification({ userId: mgr.id, title: "بلاغ جديد", message: `تم إنشاء بلاغ جديد: ${ticketNumber} - ${input.title}`, type: "info", relatedTicketId: id! });
    }
    return { id, ticketNumber };
  }),

  update: protectedProcedure.input(z.object({
    id: z.number(),
    title: z.string().optional(),
    description: z.string().optional(),
    priority: z.string().optional(),
    category: z.string().optional(),
    siteId: z.number().optional(),
    locationDetail: z.string().optional(),
  })).mutation(async ({ input, ctx }) => {
    const ticket = await db.getTicketById(input.id);
    if (!ticket) throw new TRPCError({ code: "NOT_FOUND", message: "البلاغ غير موجود" });
    // Only owner/admin/manager or the reporter can edit
    const canEdit = ["owner", "admin", "maintenance_manager"].includes(ctx.user.role) || ticket.reportedById === ctx.user.id;
    if (!canEdit) throw new TRPCError({ code: "FORBIDDEN", message: "ليس لديك صلاحية لتعديل هذا البلاغ" });
    if (ticket.status === "closed") throw new TRPCError({ code: "BAD_REQUEST", message: "لا يمكن تعديل بلاغ مغلق" });
    const { id, ...updateData } = input;
    const oldValues: any = {};
    const newValues: any = {};
    if (input.title && input.title !== ticket.title) { oldValues.title = ticket.title; newValues.title = input.title; }
    if (input.description && input.description !== ticket.description) { oldValues.description = ticket.description; newValues.description = input.description; }
    if (input.priority && input.priority !== ticket.priority) { oldValues.priority = ticket.priority; newValues.priority = input.priority; }
    if (input.category && input.category !== ticket.category) { oldValues.category = ticket.category; newValues.category = input.category; }
    if (input.siteId && input.siteId !== ticket.siteId) { oldValues.siteId = ticket.siteId; newValues.siteId = input.siteId; }
    // تحديث التذكرة فوراً
    await db.updateTicket(id, { ...updateData });

    // إعادة الترجمة في الخلفية إذا تغيرت حقول نصية
    const fieldsToRequeue = [
      ...(input.title && input.title !== ticket.title
        ? [{ fieldName: "title", text: input.title }] : []),
      ...(input.description && input.description !== ticket.description
        ? [{ fieldName: "description", text: input.description }] : []),
    ];
    if (fieldsToRequeue.length > 0) {
      const detectedLang = await detectLanguage(fieldsToRequeue[0].text).catch(() => ticket.originalLanguage as SupportedLanguage);
      queueTranslation({
        entityType: "TICKET",
        entityId: id,
        fields: fieldsToRequeue,
        sourceLanguage: detectedLang,
        userId: ctx.user.id,
      }).catch(e => console.error("[Ticket] Queue translation update failed:", e));
      translationCache.invalidate("TICKET", id);
    }

await db.createAuditLog({ userId: ctx.user.id, action: "update_ticket", entityType: "ticket", entityId: id, oldValues, newValues });
    // Notify managers about ticket edit
    if (Object.keys(newValues).length > 0) {
      const managers = await db.getManagerUsers();
      const changedFields = Object.keys(newValues).join(", ");
      for (const mgr of managers) {
        if (mgr.id !== ctx.user.id) {
          await db.createNotification({ userId: mgr.id, title: `تعديل بلاغ #${ticket.ticketNumber}`, message: `قام ${ctx.user.name} بتعديل البلاغ "${ticket.title}" - الحقول: ${changedFields}`, type: "ticket_updated", relatedTicketId: id });
        }
      }
    }
    return { success: true };
  }),

  delete: protectedProcedure.input(z.object({ id: z.number() })).mutation(async ({ input, ctx }) => {
    const ticket = await db.getTicketById(input.id);
    if (!ticket) throw new TRPCError({ code: "NOT_FOUND", message: "البلاغ غير موجود" });
    // Only owner/admin can delete
    if (!["owner", "admin"].includes(ctx.user.role)) {
      throw new TRPCError({ code: "FORBIDDEN", message: "ليس لديك صلاحية لحذف البلاغات" });
    }
    await db.deleteTicket(input.id);
    await db.createAuditLog({ userId: ctx.user.id, action: "delete_ticket", entityType: "ticket", entityId: input.id, oldValues: { ticketNumber: ticket.ticketNumber, title: ticket.title, status: ticket.status } });
    // Notify managers about ticket deletion
    const managers = await db.getManagerUsers();
    for (const mgr of managers) {
      if (mgr.id !== ctx.user.id) {
        await db.createNotification({ userId: mgr.id, title: `حذف بلاغ #${ticket.ticketNumber}`, message: `قام ${ctx.user.name} بحذف البلاغ "${ticket.title}"`, type: "ticket_deleted", relatedTicketId: input.id });
      }
    }
    return { success: true };
  }),

  history: protectedProcedure.input(z.object({ ticketId: z.number() })).query(async ({ input }) => {
    return db.getTicketHistory(input.ticketId);
  }),

  createTicket: protectedProcedure.input(z.object({
    title: z.string(),
    description: z.string().optional(),
    priority: z.enum(["low", "medium", "high", "critical"]),
    category: z.enum(["electrical", "plumbing", "hvac", "structural", "mechanical", "general", "safety", "cleaning"]),
    siteId: z.number().optional(),
    assetId: z.number().optional(),
    locationDetail: z.string().optional(),
  })).mutation(async ({ input, ctx }) => {
    const ticketNumber = `TK-${Date.now()}`;
    const ticket = await db.createTicket({
      ticketNumber,
      title: input.title,
      description: input.description,
      priority: input.priority as any,
      category: input.category as any,
      siteId: input.siteId,
      assetId: input.assetId,
      locationDetail: input.locationDetail,
      reportedById: ctx.user.id,
      status: "pending_triage",
    });
    if (!ticket) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
    await db.addTicketStatusHistory({ ticketId: typeof ticket === 'number' ? ticket : (ticket as any).id, fromStatus: "new", toStatus: "pending_triage", changedById: ctx.user.id });
    return ticket;
  }),
});

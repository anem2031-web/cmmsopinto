import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { router, protectedProcedure, managerProcedure, supervisorProcedure } from "../_shared/procedures";
import * as db from "../../_core/db";

export const ticketsClosureRouter = router({
  getConfirmation: protectedProcedure.input(z.object({ id: z.number() })).query(async ({ input }) => {
    const confirmation = await db.getTicketConfirmation(input.id);
    if (!confirmation) return null;
    const confirmedBy = await db.getUserById(confirmation.confirmedById);
    return {
      ...confirmation,
      confirmedByName: confirmedBy?.name || confirmedBy?.username || "غير معروف",
    };
  }),

  close: managerProcedure.input(z.object({ id: z.number() })).mutation(async ({ input, ctx }) => {
    const ticket = await db.getTicketById(input.id);
    if (!ticket) throw new TRPCError({ code: "NOT_FOUND" });
    await db.updateTicket(input.id, { status: "closed", closedAt: new Date() });
    await db.addTicketStatusHistory({ ticketId: input.id, fromStatus: ticket.status, toStatus: "closed", changedById: ctx.user.id });
    await db.createAuditLog({ userId: ctx.user.id, action: "close_ticket", entityType: "ticket", entityId: input.id });
    // Notify reporter and assigned technician
    if (ticket.reportedById) {
      await db.createNotification({ userId: ticket.reportedById, title: "🔒 تم إغلاق بلاغك", message: `تم إغلاق البلاغ ${ticket.ticketNumber} بنجاح. يرجى الدخول لتأكيد إتمام العمل وإرفاق صور الإصلاح`, type: "success", relatedTicketId: input.id });
    }
    if (ticket.assignedToId && ticket.assignedToId !== ticket.reportedById) {
      await db.createNotification({ userId: ticket.assignedToId, title: "🔒 تم إغلاق البلاغ", message: `تم إغلاق البلاغ ${ticket.ticketNumber} الذي كنت مسؤولاً عنه`, type: "success", relatedTicketId: input.id });
    }
    return { success: true };
  }),

  markReadyForClosure: protectedProcedure.input(z.object({
    id: z.number(),
    afterPhotoUrl: z.string().optional(),
    repairNotes: z.string().optional(),
  })).mutation(async ({ input, ctx }) => {
    const ticket = await db.getTicketById(input.id);
    if (!ticket) throw new TRPCError({ code: "NOT_FOUND" });
    if (ticket.maintenancePath !== "A") throw new TRPCError({ code: "BAD_REQUEST", message: "هذا الإجراء للمسار A فقط" });
    await db.updateTicket(input.id, { status: "ready_for_closure", afterPhotoUrl: input.afterPhotoUrl, repairNotes: input.repairNotes });
    await db.addTicketStatusHistory({ ticketId: input.id, fromStatus: ticket.status, toStatus: "ready_for_closure", changedById: ctx.user.id });
    // Notify supervisor to close
    const supervisors = await db.getUsersByRole("supervisor");
    for (const sup of supervisors) {
      await db.createNotification({ userId: sup.id, title: "بلاغ جاهز للإغلاق", message: `البلاغ ${ticket.ticketNumber} جاهز للإغلاق - المسار A`, type: "success", relatedTicketId: input.id });
    }
    return { success: true };
  }),

  closeBySupervisor: supervisorProcedure.input(z.object({ id: z.number() })).mutation(async ({ input, ctx }) => {
    const ticket = await db.getTicketById(input.id);
    if (!ticket) throw new TRPCError({ code: "NOT_FOUND" });
    if (ticket.status !== "ready_for_closure") throw new TRPCError({ code: "BAD_REQUEST", message: "البلاغ ليس جاهزاً للإغلاق" });
    await db.updateTicket(input.id, { status: "closed", closedAt: new Date() });
    await db.addTicketStatusHistory({ ticketId: input.id, fromStatus: ticket.status, toStatus: "closed", changedById: ctx.user.id });
    await db.createAuditLog({ userId: ctx.user.id, action: "close_ticket", entityType: "ticket", entityId: input.id });
    // Notify managers, reporter, and technician
    const managersSup = await db.getManagerUsers();
    for (const mgr of managersSup) {
      await db.createNotification({ userId: mgr.id, title: "🔒 تم إغلاق بلاغ", message: `أغلق المشرف البلاغ ${ticket.ticketNumber}`, type: "success", relatedTicketId: input.id });
    }
    if (ticket.reportedById) {
      await db.createNotification({ userId: ticket.reportedById, title: "🔒 تم إغلاق بلاغك", message: `تم إغلاق البلاغ ${ticket.ticketNumber} بنجاح. يرجى الدخول لتأكيد إتمام العمل وإرفاق صور الإصلاح`, type: "success", relatedTicketId: input.id });
    }
    if (ticket.assignedToId && ticket.assignedToId !== ticket.reportedById) {
      await db.createNotification({ userId: ticket.assignedToId, title: "🔒 تم إغلاق البلاغ", message: `تم إغلاق البلاغ ${ticket.ticketNumber}`, type: "success", relatedTicketId: input.id });
    }
    return { success: true };
  }),

  finalClose: supervisorProcedure.input(z.object({ id: z.number() })).mutation(async ({ input, ctx }) => {
    const ticket = await db.getTicketById(input.id);
    if (!ticket) throw new TRPCError({ code: "NOT_FOUND" });
    if (ticket.status !== "verified") throw new TRPCError({ code: "BAD_REQUEST", message: "البلاغ يجب أن يكون مُتحقق منه" });
    await db.updateTicket(input.id, { status: "closed", closedAt: new Date() });
    await db.addTicketStatusHistory({ ticketId: input.id, fromStatus: "verified", toStatus: "closed", changedById: ctx.user.id });
    await db.createAuditLog({ userId: ctx.user.id, action: "close_ticket", entityType: "ticket", entityId: input.id });
    // Notify ticket creator and assigned technician
    if (ticket.reportedById) {
      await db.createNotification({ userId: ticket.reportedById, title: "🔒 تم إغلاق بلاغك", message: `تم إغلاق البلاغ ${ticket.ticketNumber} بنجاح. يرجى الدخول لتأكيد إتمام العمل وإرفاق صور الإصلاح`, type: "success", relatedTicketId: input.id });
    }
    if (ticket.assignedToId && ticket.assignedToId !== ticket.reportedById) {
      await db.createNotification({ userId: ticket.assignedToId, title: "🔒 تم إغلاق البلاغ", message: `تم إغلاق البلاغ ${ticket.ticketNumber} الذي كنت مسؤولاً عنه`, type: "success", relatedTicketId: input.id });
    }
    return { success: true };
  }),

  completeWithParts: protectedProcedure.input(z.object({
    id: z.number(),
    afterPhotoUrl: z.string().optional(),
    repairNotes: z.string().optional(),
  })).mutation(async ({ input, ctx }) => {
    const ticket = await db.getTicketById(input.id);
    if (!ticket) throw new TRPCError({ code: "NOT_FOUND" });
    if (ticket.status !== "received_warehouse") throw new TRPCError({ code: "BAD_REQUEST", message: "البلاغ يجب أن يكون مستلماً من المستودع" });
    if (ticket.maintenancePath !== "B" && ticket.maintenancePath !== "C") throw new TRPCError({ code: "BAD_REQUEST", message: "هذا الإجراء للمسار B أو C فقط" });
    await db.updateTicket(input.id, { status: "ready_for_closure", afterPhotoUrl: input.afterPhotoUrl, repairNotes: input.repairNotes });
    await db.addTicketStatusHistory({ ticketId: input.id, fromStatus: "received_warehouse", toStatus: "ready_for_closure", changedById: ctx.user.id });
    return { success: true };
  }),

  // تأكيد منشئ البلاغ إتمام العمل فعلياً بعد إغلاق البلاغ
  // فقط منشئ البلاغ نفسه أو owner/admin يستطيع تنفيذ هذا الإجراء
  confirmCompletion: protectedProcedure.input(z.object({
    id: z.number(),
    note: z.string().min(1, "الملاحظة مطلوبة"),
    photoUrls: z.array(z.string()).min(1, "يجب إرفاق صورة واحدة على الأقل").max(4, "الحد الأقصى 4 صور"),
  })).mutation(async ({ input, ctx }) => {
    const ticket = await db.getTicketById(input.id);
    if (!ticket) throw new TRPCError({ code: "NOT_FOUND" });
    if (ticket.status !== "closed") throw new TRPCError({ code: "BAD_REQUEST", message: "البلاغ يجب أن يكون مغلقاً أولاً" });

    const isOwnerOrAdmin = ctx.user.role === "owner" || ctx.user.role === "admin";
    if (ticket.reportedById !== ctx.user.id && !isOwnerOrAdmin) {
      throw new TRPCError({ code: "FORBIDDEN", message: "فقط منشئ البلاغ يستطيع تأكيد إتمام العمل" });
    }

    await db.createTicketConfirmation({
      ticketId: input.id,
      confirmedById: ctx.user.id,
      note: input.note,
      photoUrls: input.photoUrls,
    });
    await db.updateTicket(input.id, { status: "requester_confirmed" });
    await db.addTicketStatusHistory({ ticketId: input.id, fromStatus: "closed", toStatus: "requester_confirmed", changedById: ctx.user.id });
    await db.createAuditLog({ userId: ctx.user.id, action: "confirm_ticket_completion", entityType: "ticket", entityId: input.id });

    // إشعار للمدير المسؤول والفني المكلّف بأن صاحب البلاغ أكّد إتمام العمل
    const managers = await db.getManagerUsers();
    for (const mgr of managers) {
      await db.createNotification({ userId: mgr.id, title: "✅ تأكيد إتمام العمل", message: `أكّد صاحب البلاغ ${ticket.ticketNumber} إتمام العمل فعلياً`, type: "success", relatedTicketId: input.id });
    }
    if (ticket.assignedToId) {
      await db.createNotification({ userId: ticket.assignedToId, title: "✅ تأكيد إتمام العمل", message: `أكّد صاحب البلاغ ${ticket.ticketNumber} إتمام العمل الذي قمت به`, type: "success", relatedTicketId: input.id });
    }

    return { success: true };
  }),
});

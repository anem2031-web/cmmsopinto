import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { router, protectedProcedure, managerProcedure, supervisorProcedure } from "../_shared/procedures";
import * as db from "../../db";

export const ticketsClosureRouter = router({
  close: managerProcedure.input(z.object({ id: z.number() })).mutation(async ({ input, ctx }) => {
    const ticket = await db.getTicketById(input.id);
    if (!ticket) throw new TRPCError({ code: "NOT_FOUND" });
    await db.updateTicket(input.id, { status: "closed", closedAt: new Date() });
    await db.addTicketStatusHistory({ ticketId: input.id, fromStatus: ticket.status, toStatus: "closed", changedById: ctx.user.id });
    await db.createAuditLog({ userId: ctx.user.id, action: "close_ticket", entityType: "ticket", entityId: input.id });
    // Notify reporter and assigned technician
    if (ticket.reportedById) {
      await db.createNotification({ userId: ticket.reportedById, title: "🔒 تم إغلاق بلاغك", message: `تم إغلاق البلاغ ${ticket.ticketNumber} بنجاح`, type: "success", relatedTicketId: input.id });
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
      await db.createNotification({ userId: ticket.reportedById, title: "🔒 تم إغلاق بلاغك", message: `تم إغلاق البلاغ ${ticket.ticketNumber} بنجاح`, type: "success", relatedTicketId: input.id });
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
      await db.createNotification({ userId: ticket.reportedById, title: "🔒 تم إغلاق بلاغك", message: `تم إغلاق البلاغ ${ticket.ticketNumber} بنجاح`, type: "success", relatedTicketId: input.id });
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
});

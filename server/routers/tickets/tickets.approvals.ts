import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { router, protectedProcedure, managerProcedure } from "../_shared/procedures";
import { translateFields, detectLanguage } from "../../services/translation/translation";
import * as db from "../../_core/db";

export const ticketsApprovalsRouter = router({
  approve: managerProcedure.input(z.object({ id: z.number() })).mutation(async ({ input, ctx }) => {
    const ticket = await db.getTicketById(input.id);
    if (!ticket) throw new TRPCError({ code: "NOT_FOUND" });
    await db.updateTicket(input.id, { status: "approved", approvedById: ctx.user.id });
    await db.addTicketStatusHistory({ ticketId: input.id, fromStatus: ticket.status, toStatus: "approved", changedById: ctx.user.id });
    // Notify supervisors that ticket is approved
    const supervisorsApprove = await db.getUsersByRole("supervisor");
    for (const sup of supervisorsApprove) {
      await db.createNotification({ userId: sup.id, title: "✅ تمت الموافقة على بلاغ", message: `تمت الموافقة على البلاغ ${ticket.ticketNumber} من قبل المدير`, type: "success", relatedTicketId: input.id });
    }
    return { success: true };
  }),

  assign: managerProcedure.input(z.object({
    id: z.number(),
    technicianId: z.number().optional(),           // System user technician
    externalTechnicianId: z.number().optional(),   // External technician (no account)
  })).mutation(async ({ input, ctx }) => {
    const ticket = await db.getTicketById(input.id);
    if (!ticket) throw new TRPCError({ code: "NOT_FOUND" });
    if (!input.technicianId && !input.externalTechnicianId) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "يجب تحديد فني لإعادة الإسناد" });
    }
    // Reassign is allowed from any post-triage status
    const reassignableStatuses = ["under_inspection", "work_approved", "assigned", "in_progress", "needs_purchase", "purchase_pending_estimate", "purchase_pending_accounting", "purchase_pending_management", "purchase_approved", "purchased", "received_warehouse"];
    if (!reassignableStatuses.includes(ticket.status)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: `لا يمكن إعادة الإسناد في الحالة: ${ticket.status}` });
    }
    const updateData: Record<string, any> = {
      assignedAt: new Date(),
    };
    // ── Phase 1: Disambiguation guard ───────────────────────────────────────
    // A ticket must not have both assignedToId (internal user) and
    // assignedTechnicianId (external technician) set simultaneously.
    // When assigning an internal user, clear the external technician slot.
    // When assigning an external technician, clear the internal user slot.
    // This is backward-compatible: existing single-assignment tickets are unaffected.
    if (input.technicianId) {
      updateData.assignedToId = input.technicianId;
      updateData.assignedTechnicianId = null; // clear external slot
    }
    if (input.externalTechnicianId) {
      updateData.assignedTechnicianId = input.externalTechnicianId;
      updateData.assignedToId = null; // clear internal slot
    }
    // ──────────────────────────────────────────────────────────────────
    await db.updateTicket(input.id, updateData);
    await db.addTicketStatusHistory({ ticketId: input.id, fromStatus: ticket.status, toStatus: ticket.status, changedById: ctx.user.id, notes: "إعادة إسناد الفني" });
    if (input.technicianId) {
      await db.createNotification({ userId: input.technicianId, title: "بلاغ مُسند إليك", message: `تم إسناد البلاغ ${ticket.ticketNumber} إليك`, type: "info", relatedTicketId: input.id });
    }
    return { success: true };
  }),

  assignForInspection: managerProcedure.input(z.object({
    id: z.number(),
    assignedToId: z.number(),
    triageNotes: z.string().optional(),
  })).mutation(async ({ input, ctx }) => {
    const ticket = await db.getTicketById(input.id);
    if (!ticket) throw new TRPCError({ code: "NOT_FOUND" });
    if (ticket.status !== "pending_triage") throw new TRPCError({ code: "BAD_REQUEST", message: "البلاغ يجب أن يكون في مرحلة الفحص الأولي" });
    await db.updateTicket(input.id, { status: "under_inspection", assignedToId: input.assignedToId, triageNotes: input.triageNotes });
    await db.addTicketStatusHistory({ ticketId: input.id, fromStatus: "pending_triage", toStatus: "under_inspection", changedById: ctx.user.id });
    return { success: true };
  }),

  startRepair: protectedProcedure.input(z.object({ id: z.number() })).mutation(async ({ input, ctx }) => {
    const ticket = await db.getTicketById(input.id);
    if (!ticket) throw new TRPCError({ code: "NOT_FOUND" });
    // Accept from assigned, in_progress, repaired, or received_warehouse (after materials delivered to technician)
    const validStatuses = ["assigned", "in_progress", "repaired", "purchase_approved", "purchased", "partial_purchase", "received_warehouse"];
    if (!validStatuses.includes(ticket.status)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: `لا يمكن بدء التنفيذ في الحالة الحالية: ${ticket.status}` });
    }
    await db.updateTicket(input.id, { status: "in_progress" });
    await db.addTicketStatusHistory({ ticketId: input.id, fromStatus: ticket.status, toStatus: "in_progress", changedById: ctx.user.id });
    // Notify managers that work has started
    const managers = await db.getManagerUsers();
    for (const mgr of managers) {
      await db.createNotification({ userId: mgr.id, title: "🔧 بدأ تنفيذ بلاغ", message: `بدأ الفني العمل على البلاغ ${ticket.ticketNumber}`, type: "info", relatedTicketId: input.id });
    }
    return { success: true };
  }),

  completeRepair: protectedProcedure.input(z.object({
    id: z.number(),
    afterPhotoUrl: z.string().min(1, "صورة بعد الإصلاح مطلوبة"),
    repairNotes: z.string().optional(),
    materialsUsed: z.string().optional(),
  })).mutation(async ({ input, ctx }) => {
    const ticket = await db.getTicketById(input.id);
    if (!ticket) throw new TRPCError({ code: "NOT_FOUND" });
    if (ticket.status !== "in_progress") {
      throw new TRPCError({ code: "BAD_REQUEST", message: "يجب أن يكون البلاغ قيد التنفيذ أولاً" });
    }
    // Auto-translate repairNotes
    let repairTranslation: Record<string, any> = {};
    if (input.repairNotes) {
      try {
        const lang = await detectLanguage(input.repairNotes);
        const translations = await translateFields({ repairNotes: input.repairNotes }, lang);
        if (translations.repairNotes) {
          repairTranslation.repairNotes_ar = translations.repairNotes.ar;
          repairTranslation.repairNotes_en = translations.repairNotes.en;
          repairTranslation.repairNotes_ur = translations.repairNotes.ur;
        }
      } catch (e) {
        console.error("[Ticket] RepairNotes translation failed:", e);
      }
    }
    await db.updateTicket(input.id, { status: "repaired", afterPhotoUrl: input.afterPhotoUrl, repairNotes: input.repairNotes, materialsUsed: input.materialsUsed, ...repairTranslation });
    await db.addTicketStatusHistory({ ticketId: input.id, fromStatus: ticket.status, toStatus: "repaired", changedById: ctx.user.id });
    const managers = await db.getManagerUsers();
    for (const mgr of managers) {
      await db.createNotification({ userId: mgr.id, title: "تم إصلاح بلاغ", message: `تم إصلاح البلاغ ${ticket.ticketNumber}`, type: "success", relatedTicketId: input.id });
    }
    return { success: true };
  }),
});

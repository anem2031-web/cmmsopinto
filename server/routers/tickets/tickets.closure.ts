import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { router, protectedProcedure, ticketProcedure, ticketManagerProcedure, supervisorProcedure } from "../_shared/procedures";
import * as db from "../../_core/db";
import { APP_ROLE } from "@shared/roles";
import { isPathARepairCompletionStage, isPathARepairEvidenceComplete, isPathBRepairEvidenceComplete } from "@shared/ticketUiRules";
import { assertPathBMaterialsDeliveredToTechnician } from "../purchase/ticket-purchase-workflow";
import { assertTicketReadable, assertTicketWorkflowManageable, canManageTicketWorkflow } from "./tickets.access";

const executionManagerRoles = new Set<string>([
  APP_ROLE.MAINTENANCE_MANAGER,
  APP_ROLE.GENERAL_MAINTENANCE_MANAGER,
  APP_ROLE.CONSTRUCTION_PROCUREMENT_MANAGER,
  APP_ROLE.ADMIN,
  APP_ROLE.OWNER,
]);

function assertAssignedTechnicianOrScopedManager(user: { id: number; role: string }, ticket: any) {
  if (user.role === APP_ROLE.TECHNICIAN) {
    if (ticket.assignedToId !== user.id) {
      throw new TRPCError({ code: "FORBIDDEN", message: "البلاغ غير مسند إليك" });
    }
    return;
  }
  if (executionManagerRoles.has(user.role) && canManageTicketWorkflow(user, ticket)) return;
  throw new TRPCError({ code: "FORBIDDEN", message: "ليس لديك صلاحية تنفيذ إجراء الفني على هذا البلاغ" });
}

export const ticketsClosureRouter = router({
  getConfirmation: protectedProcedure.input(z.object({ id: z.number() })).query(async ({ input, ctx }) => {
    const ticket = await db.getTicketById(input.id);
    if (!ticket) throw new TRPCError({ code: "NOT_FOUND", message: "البلاغ غير موجود" });
    await assertTicketReadable(ctx.user, ticket as any);
    const confirmation = await db.getTicketConfirmation(input.id);
    if (!confirmation) return null;
    const confirmedBy = await db.getUserById(confirmation.confirmedById);
    return {
      ...confirmation,
      confirmedByName: confirmedBy?.name || confirmedBy?.username || "غير معروف",
    };
  }),

  close: ticketManagerProcedure.input(z.object({ id: z.number() })).mutation(async ({ input, ctx }) => {
    const ticket = await db.getTicketById(input.id);
    if (!ticket) throw new TRPCError({ code: "NOT_FOUND" });
    assertTicketWorkflowManageable(ctx.user, ticket as any);
    const isLegacyRepairedTicket = ticket.status === "repaired" && !ticket.maintenancePath;
    const isReadyPathBOrC =
      ticket.status === "ready_for_closure" &&
      (ticket.maintenancePath === "B" || ticket.maintenancePath === "C");
    if (!isLegacyRepairedTicket && !isReadyPathBOrC) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "البلاغ ليس جاهزاً للإغلاق في مساره المعتمد" });
    }
    if (isReadyPathBOrC && !ticket.repairNotes?.trim()) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "لا يمكن إغلاق البلاغ دون ملاحظات الإصلاح" });
    }
    if (ticket.maintenancePath === "C") {
      const externalJob = await db.getExternalMaintenanceJobByTicketId(ticket.id);
      if (!externalJob || externalJob.status !== "ready_for_closure") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "لا يمكن إغلاق المسار C قبل توثيق الخروج والدخول واستلام المستودع وتسليم الأصل وإعادة تركيبه",
        });
      }
    }
    await db.updateTicket(input.id, { status: "closed", closedAt: new Date() });
    if (ticket.maintenancePath === "C") {
      await db.updateExternalMaintenanceJobByTicketId(ticket.id, { status: "closed" });
    }
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
    repairNotes: z.string().trim().min(1, "ملاحظات الإصلاح مطلوبة"),
  })).mutation(async ({ input, ctx }) => {
    const ticket = await db.getTicketById(input.id);
    if (!ticket) throw new TRPCError({ code: "NOT_FOUND" });
    assertAssignedTechnicianOrScopedManager(ctx.user, ticket);
    if (!isPathARepairCompletionStage(ticket.status, ticket.maintenancePath)) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: ticket.maintenancePath !== "A"
          ? "هذا الإجراء للمسار A فقط"
          : "يجب الضغط على بدء الإصلاح قبل رفع نتيجة الإصلاح وإرسال البلاغ للإغلاق",
      });
    }
    if (!isPathARepairEvidenceComplete(input.repairNotes, input.afterPhotoUrl)) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "يجب كتابة ملاحظات الإصلاح قبل إرسال البلاغ للإغلاق",
      });
    }
    await db.updateTicket(input.id, { status: "ready_for_closure", afterPhotoUrl: input.afterPhotoUrl, repairNotes: input.repairNotes });
    await db.addTicketStatusHistory({ ticketId: input.id, fromStatus: ticket.status, toStatus: "ready_for_closure", changedById: ctx.user.id });
    // Notify supervisors and the manager responsible for this route.
    const supervisors = await db.getUsersByRole("supervisor");
    const routeManagers = await db.getTicketWorkflowManagerUsers(ticket);
    const recipients = new Map<number, any>();
    for (const recipient of [...supervisors, ...routeManagers]) recipients.set(recipient.id, recipient);
    for (const recipient of recipients.values()) {
      if (recipient.id === ctx.user.id) continue;
      await db.createNotification({ userId: recipient.id, title: "بلاغ جاهز للإغلاق", message: `البلاغ ${ticket.ticketNumber} جاهز للإغلاق - المسار A`, type: "success", relatedTicketId: input.id });
    }
    return { success: true };
  }),

  closeBySupervisor: supervisorProcedure.input(z.object({ id: z.number() })).mutation(async ({ input, ctx }) => {
    const ticket = await db.getTicketById(input.id);
    if (!ticket) throw new TRPCError({ code: "NOT_FOUND" });
    assertTicketWorkflowManageable(ctx.user, ticket as any);
    if (ticket.status !== "ready_for_closure") throw new TRPCError({ code: "BAD_REQUEST", message: "البلاغ ليس جاهزاً للإغلاق" });
    if (ticket.maintenancePath !== "A") {
      throw new TRPCError({ code: "BAD_REQUEST", message: "إغلاق المشرف مخصص للمسار A فقط" });
    }
    await db.updateTicket(input.id, { status: "closed", closedAt: new Date() });
    await db.addTicketStatusHistory({ ticketId: input.id, fromStatus: ticket.status, toStatus: "closed", changedById: ctx.user.id });
    await db.createAuditLog({ userId: ctx.user.id, action: "close_ticket", entityType: "ticket", entityId: input.id });
    // Notify managers, reporter, and technician
    const managersSup = await db.getTicketWorkflowManagerUsers(ticket);
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
    assertTicketWorkflowManageable(ctx.user, ticket as any);
    if (ticket.maintenancePath) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "الإغلاق النهائي القديم غير متاح لمسارات الصيانة A/B/C" });
    }
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
    afterPhotoUrl: z.string().trim().optional(),
    repairNotes: z.string().trim().min(1, "ملاحظات الإصلاح مطلوبة"),
  })).mutation(async ({ input, ctx }) => {
    const ticket = await db.getTicketById(input.id);
    if (!ticket) throw new TRPCError({ code: "NOT_FOUND" });
    assertAssignedTechnicianOrScopedManager(ctx.user, ticket);
    if (ticket.maintenancePath !== "B" && ticket.maintenancePath !== "C") throw new TRPCError({ code: "BAD_REQUEST", message: "هذا الإجراء للمسار B أو C فقط" });
    const expectedStatus = "in_progress";
    if (ticket.status !== expectedStatus) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: ticket.maintenancePath === "B"
          ? "يجب الضغط على بدء الإصلاح بعد تسليم المواد وقبل إكمال العمل"
          : "يجب الضغط على بدء إعادة التركيب قبل إكمال المسار C",
      });
    }
    if (!isPathBRepairEvidenceComplete(input.repairNotes, input.afterPhotoUrl)) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "يجب كتابة ملاحظات الإصلاح قبل إرسال البلاغ للإغلاق",
      });
    }
    if (ticket.maintenancePath === "B") {
      await assertPathBMaterialsDeliveredToTechnician(ticket.id);
    }
    await db.updateTicket(input.id, { status: "ready_for_closure", afterPhotoUrl: input.afterPhotoUrl, repairNotes: input.repairNotes });
    if (ticket.maintenancePath === "C") {
      await db.updateExternalMaintenanceJobByTicketId(ticket.id, { status: "ready_for_closure" });
    }
    await db.addTicketStatusHistory({ ticketId: input.id, fromStatus: ticket.status, toStatus: "ready_for_closure", changedById: ctx.user.id });
    // إشعار المشرفين: كانت هذه الخطوة (خلافاً لـ markReadyForClosure الخاصة بالمسار A)
    // لا تنبّه أحداً، فتبقى البلاغات من المسار B/C جاهزة للإغلاق دون أن يعلم أحد.
    const supervisorsParts = await db.getUsersByRole("supervisor");
    const routeManagersParts = await db.getTicketWorkflowManagerUsers(ticket);
    const recipientsParts = new Map<number, any>();
    for (const recipient of [...supervisorsParts, ...routeManagersParts]) recipientsParts.set(recipient.id, recipient);
    for (const recipient of recipientsParts.values()) {
      if (recipient.id === ctx.user.id) continue;
      await db.createNotification({ userId: recipient.id, title: "بلاغ جاهز للإغلاق", message: ticket.maintenancePath === "C"
        ? `البلاغ ${ticket.ticketNumber} جاهز للإغلاق بعد إعادة تركيب الأصل العائد من الصيانة الخارجية`
        : `البلاغ ${ticket.ticketNumber} جاهز للإغلاق بعد استلام واستخدام المواد`, type: "success", relatedTicketId: input.id });
    }
    return { success: true };
  }),

  // تأكيد منشئ البلاغ إتمام العمل فعلياً بعد إغلاق البلاغ
  // فقط منشئ البلاغ نفسه أو owner/admin يستطيع تنفيذ هذا الإجراء
  confirmCompletion: ticketProcedure.input(z.object({
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
    const managers = await db.getTicketWorkflowManagerUsers(ticket);
    for (const mgr of managers) {
      await db.createNotification({ userId: mgr.id, title: "✅ تأكيد إتمام العمل", message: `أكّد صاحب البلاغ ${ticket.ticketNumber} إتمام العمل فعلياً`, type: "success", relatedTicketId: input.id });
    }
    if (ticket.assignedToId) {
      await db.createNotification({ userId: ticket.assignedToId, title: "✅ تأكيد إتمام العمل", message: `أكّد صاحب البلاغ ${ticket.ticketNumber} إتمام العمل الذي قمت به`, type: "success", relatedTicketId: input.id });
    }

    return { success: true };
  }),
});

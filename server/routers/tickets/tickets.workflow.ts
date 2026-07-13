import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { router, protectedProcedure, managerProcedure, supervisorProcedure,
  warehouseProcedure, accountantProcedure, managementProcedure } from "../_shared/procedures";
import * as db from "../../_core/db";

export const ticketsWorkflowRouter = router({
  submitForTriage: protectedProcedure.input(z.object({ id: z.number() })).mutation(async ({ input, ctx }) => {
    const ticket = await db.getTicketById(input.id);
    if (!ticket) throw new TRPCError({ code: "NOT_FOUND" });
    await db.updateTicket(input.id, { status: "pending_triage" });
    await db.addTicketStatusHistory({ ticketId: input.id, fromStatus: ticket.status, toStatus: "pending_triage", changedById: ctx.user.id });
    // Notify supervisors
    const supervisors = await db.getUsersByRole("supervisor");
    for (const sup of supervisors) {
      await db.createNotification({ userId: sup.id, title: "بلاغ بانتظار الفرز", message: `البلاغ ${ticket.ticketNumber} بانتظار الفرز والتصنيف`, type: "info", relatedTicketId: input.id });
    }
    return { success: true };
  }),

  triage: supervisorProcedure.input(z.object({
    id: z.number(),
    ticketType: z.enum(["internal", "external", "procurement"]),
    priority: z.string().optional(),
    triageNotes: z.string().optional(),
    assignedToId: z.number().optional(), // Assign inspection team
  })).mutation(async ({ input, ctx }) => {
    const ticket = await db.getTicketById(input.id);
    if (!ticket) throw new TRPCError({ code: "NOT_FOUND" });
    if (ticket.status !== "pending_triage") throw new TRPCError({ code: "BAD_REQUEST", message: "البلاغ ليس في مرحلة الفرز" });
    const updateData: any = {
      status: "under_inspection",
      ticketType: input.ticketType,
      supervisorId: ctx.user.id,
      triageNotes: input.triageNotes,
    };
    if (input.priority) updateData.priority = input.priority;
    if (input.assignedToId) updateData.assignedToId = input.assignedToId;
    await db.updateTicket(input.id, updateData);
    await db.addTicketStatusHistory({ ticketId: input.id, fromStatus: ticket.status, toStatus: "under_inspection", changedById: ctx.user.id, notes: input.triageNotes });
    // Notify maintenance manager
    const managers = await db.getManagerUsers();
    for (const mgr of managers) {
      await db.createNotification({ userId: mgr.id, title: "بلاغ قيد الفحص", message: `تم فرز البلاغ ${ticket.ticketNumber} وهو الآن قيد الفحص`, type: "info", relatedTicketId: input.id });
    }
    return { success: true };
  }),

  triageTicket: supervisorProcedure.input(z.object({
    id: z.number(),
    assignedToId: z.number().optional(),
  })).mutation(async ({ input, ctx }) => {
    const ticket = await db.getTicketById(input.id);
    if (!ticket) throw new TRPCError({ code: "NOT_FOUND" });
    if (ticket.status !== "pending_triage") throw new TRPCError({ code: "BAD_REQUEST", message: "البلاغ ليس في مرحلة الفرز" });
    const updateData: any = { status: "under_inspection", supervisorId: ctx.user.id };
    if (input.assignedToId) {
      updateData.assignedToId = input.assignedToId;
      updateData.assignedAt = new Date();
    }
    await db.updateTicket(input.id, updateData);
    await db.addTicketStatusHistory({ ticketId: input.id, fromStatus: ticket.status, toStatus: "under_inspection", changedById: ctx.user.id, notes: input.assignedToId ? `تم نقل البلاغ لمرحلة الفحص وتعيين الفني` : "تم نقل البلاغ لمرحلة الفحص" });
    // Notify maintenance manager
    const managers = await db.getManagerUsers();
    for (const mgr of managers) {
      await db.createNotification({ userId: mgr.id, title: "بلاغ قيد الفحص", message: `البلاغ ${ticket.ticketNumber} الآن قيد الفحص من قبل المشرف`, type: "info", relatedTicketId: input.id });
    }
    // Notify assigned technician if provided
    if (input.assignedToId) {
      await db.createNotification({ userId: input.assignedToId, title: "تم تعيينك لفحص بلاغ", message: `تم تعيينك للفحص الميداني للبلاغ ${ticket.ticketNumber}`, type: "warning", relatedTicketId: input.id });
    }
    return { success: true };
  }),

  inspectTicket: supervisorProcedure.input(z.object({
    id: z.number(),
    inspectionNotes: z.string(),
  })).mutation(async ({ input, ctx }) => {
    const ticket = await db.getTicketById(input.id);
    if (!ticket) throw new TRPCError({ code: "NOT_FOUND" });
    if (ticket.status !== "under_inspection") throw new TRPCError({ code: "BAD_REQUEST", message: "البلاغ ليس في مرحلة الفحص" });
    // Update inspection notes
    const _ddb = await db.getDb();
    await _ddb!.transaction(async () => {
      await db.updateTicket(input.id, { inspectionNotes: input.inspectionNotes });
      await db.createInspectionResult({ ticketId: input.id, assetId: ticket.assetId ?? undefined, inspectorId: ctx.user.id, inspectionType: "triage", severity: "medium", rootCause: input.inspectionNotes, findings: input.inspectionNotes, recommendedAction: input.inspectionNotes });
    });
    await db.addTicketStatusHistory({ ticketId: input.id, fromStatus: ticket.status, toStatus: "under_inspection", changedById: ctx.user.id, notes: `ملاحظات الفحص: ${input.inspectionNotes}` });
    // Notify maintenance manager to approve work
    const managers = await db.getManagerUsers();
     for (const mgr of managers) {
      await db.createNotification({ userId: mgr.id, title: "بلاغ جاهز للموافقة", message: `البلاغ ${ticket.ticketNumber} انتهى من الفحص وجاهز للموافقة على العمل`, type: "warning", relatedTicketId: input.id });
    }
    return { success: true };
  }),

  approveWork: managerProcedure.input(z.object({
    id: z.number(),
    maintenancePath: z.enum(["A", "B", "C"]),
    inspectionNotes: z.string().optional(),
    justification: z.string().optional(), // Required for Path C
  })).mutation(async ({ input, ctx }) => {
    const ticket = await db.getTicketById(input.id);
    if (!ticket) throw new TRPCError({ code: "NOT_FOUND" });
    if (ticket.status !== "under_inspection") throw new TRPCError({ code: "BAD_REQUEST", message: "البلاغ ليس في مرحلة الفحص" });
    if (input.maintenancePath === "C" && !input.justification) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "المسار C يتطلب مبرراً للصيانة الخارجية" });
    }
    const updateData: any = {
      status: "work_approved",
      maintenancePath: input.maintenancePath,
      approvedById: ctx.user.id,
      inspectionNotes: input.inspectionNotes,
      justification: input.justification,
    };
    await db.updateTicket(input.id, updateData);
    await db.addTicketStatusHistory({ ticketId: input.id, fromStatus: ticket.status, toStatus: "work_approved", changedById: ctx.user.id, notes: `المسار: ${input.maintenancePath}` });
    // Notify based on path
    if (input.maintenancePath === "C") {
      // Notify supervisor for external path approval
      const supervisors = await db.getUsersByRole("supervisor");
      for (const sup of supervisors) {
        await db.createNotification({ userId: sup.id, title: "بلاغ مسار خارجي", message: `البلاغ ${ticket.ticketNumber} يحتاج موافقة للصيانة الخارجية (المسار C)`, type: "warning", relatedTicketId: input.id });
      }
    } else if (input.maintenancePath === "A") {
      // Notify assigned technician
      if (ticket.assignedToId) {
        await db.createNotification({ userId: ticket.assignedToId, title: "اعتماد بدء العمل", message: `تم اعتماد البلاغ ${ticket.ticketNumber} للإصلاح المباشر`, type: "success", relatedTicketId: input.id });
      }
    } else if (input.maintenancePath === "B") {
      // Notify assigned technician for path B (purchase required)
      if (ticket.assignedToId) {
        await db.createNotification({ userId: ticket.assignedToId, title: "اعتماد بلاغ - مسار الشراء", message: `تم اعتماد البلاغ ${ticket.ticketNumber} - سيتم رفع طلب شراء المواد اللازمة`, type: "warning", relatedTicketId: input.id });
      }
    }
    return { success: true };
  }),

  assignTechnician: managerProcedure.input(z.object({
    id: z.number(),
    assignedToId: z.number(),
  })).mutation(async ({ input, ctx }) => {
    const ticket = await db.getTicketById(input.id);
    if (!ticket) throw new TRPCError({ code: "NOT_FOUND" });
    if (ticket.status !== "work_approved") throw new TRPCError({ code: "BAD_REQUEST", message: "البلاغ يجب أن يكون معتمداً" });
    if (ticket.maintenancePath !== "B") throw new TRPCError({ code: "BAD_REQUEST", message: "هذا الإجراء للمسار B فقط" });
    await db.updateTicket(input.id, { status: "assigned", assignedToId: input.assignedToId, assignedAt: new Date() });
    await db.addTicketStatusHistory({ ticketId: input.id, fromStatus: "work_approved", toStatus: "assigned", changedById: ctx.user.id });
    return { success: true };
  }),

  startWork: protectedProcedure.input(z.object({ id: z.number() })).mutation(async ({ input, ctx }) => {
    const ticket = await db.getTicketById(input.id);
    if (!ticket) throw new TRPCError({ code: "NOT_FOUND" });
    if (ticket.status !== "assigned" && ticket.status !== "work_approved") {
      throw new TRPCError({ code: "BAD_REQUEST", message: "البلاغ يجب أن يكون مسنداً أو معتمداً" });
    }
    if (ticket.maintenancePath !== "B") throw new TRPCError({ code: "BAD_REQUEST", message: "هذا الإجراء للمسار B فقط" });
    await db.updateTicket(input.id, { status: "in_progress" });
    await db.addTicketStatusHistory({ ticketId: input.id, fromStatus: ticket.status, toStatus: "in_progress", changedById: ctx.user.id });
    return { success: true };
  }),

  submitEstimate: managerProcedure.input(z.object({
    id: z.number(),
    estimatedCost: z.number(),
    estimateNotes: z.string().optional(),
  })).mutation(async ({ input, ctx }) => {
    const ticket = await db.getTicketById(input.id);
    if (!ticket) throw new TRPCError({ code: "NOT_FOUND" });
    if (ticket.status !== "needs_purchase") throw new TRPCError({ code: "BAD_REQUEST", message: "البلاغ يجب أن يكون بانتظار الشراء" });
    if (ticket.maintenancePath !== "B") throw new TRPCError({ code: "BAD_REQUEST", message: "هذا الإجراء للمسار B فقط" });
    await db.updateTicket(input.id, { status: "purchase_pending_estimate" });
    await db.addTicketStatusHistory({ ticketId: input.id, fromStatus: "needs_purchase", toStatus: "purchase_pending_estimate", changedById: ctx.user.id, notes: `التكلفة المقدرة: ${input.estimatedCost}` });
    return { success: true };
  }),

  submitToAccounting: accountantProcedure.input(z.object({ id: z.number() })).mutation(async ({ input, ctx }: any) => {
    const ticket = await db.getTicketById(input.id);
    if (!ticket) throw new TRPCError({ code: "NOT_FOUND" });
    if (ticket.status !== "purchase_pending_estimate") throw new TRPCError({ code: "BAD_REQUEST", message: "البلاغ يجب أن يكون بانتظار التقدير" });
    if (ticket.maintenancePath !== "B") throw new TRPCError({ code: "BAD_REQUEST", message: "هذا الإجراء للمسار B فقط" });
    await db.updateTicket(input.id, { status: "purchase_pending_accounting" });
    await db.addTicketStatusHistory({ ticketId: input.id, fromStatus: "purchase_pending_estimate", toStatus: "purchase_pending_accounting", changedById: ctx.user.id });
    return { success: true };
  }),

  submitToManagement: managementProcedure.input(z.object({ id: z.number() })).mutation(async ({ input, ctx }: any) => {
    const ticket = await db.getTicketById(input.id);
    if (!ticket) throw new TRPCError({ code: "NOT_FOUND" });
    if (ticket.status !== "purchase_pending_accounting") throw new TRPCError({ code: "BAD_REQUEST", message: "البلاغ يجب أن يكون بانتظار المحاسبة" });
    if (ticket.maintenancePath !== "B") throw new TRPCError({ code: "BAD_REQUEST", message: "هذا الإجراء للمسار B فقط" });
    await db.updateTicket(input.id, { status: "purchase_pending_management" });
    await db.addTicketStatusHistory({ ticketId: input.id, fromStatus: "purchase_pending_accounting", toStatus: "purchase_pending_management", changedById: ctx.user.id });
    return { success: true };
  }),

  approvePurchase: managementProcedure.input(z.object({ id: z.number() })).mutation(async ({ input, ctx }) => {
    const ticket = await db.getTicketById(input.id);
    if (!ticket) throw new TRPCError({ code: "NOT_FOUND" });
    if (ticket.status !== "purchase_pending_management") throw new TRPCError({ code: "BAD_REQUEST", message: "البلاغ يجب أن يكون بانتظار الموافقة الإدارية" });
    if (ticket.maintenancePath !== "B") throw new TRPCError({ code: "BAD_REQUEST", message: "هذا الإجراء للمسار B فقط" });
    await db.updateTicket(input.id, { status: "purchase_approved" });
    await db.addTicketStatusHistory({ ticketId: input.id, fromStatus: "purchase_pending_management", toStatus: "purchase_approved", changedById: ctx.user.id });
    return { success: true };
  }),

  executePurchase: managerProcedure.input(z.object({
    id: z.number(),
    isPartial: z.boolean().default(false),
  })).mutation(async ({ input, ctx }) => {
    const ticket = await db.getTicketById(input.id);
    if (!ticket) throw new TRPCError({ code: "NOT_FOUND" });
    if (ticket.status !== "purchase_approved") throw new TRPCError({ code: "BAD_REQUEST", message: "البلاغ يجب أن يكون معتمداً للشراء" });
    if (ticket.maintenancePath !== "B") throw new TRPCError({ code: "BAD_REQUEST", message: "هذا الإجراء للمسار B فقط" });
    const newStatus = input.isPartial ? "partial_purchase" : "purchased";
    await db.updateTicket(input.id, { status: newStatus });
    await db.addTicketStatusHistory({ ticketId: input.id, fromStatus: "purchase_approved", toStatus: newStatus, changedById: ctx.user.id });
    return { success: true };
  }),

  completePurchase: managerProcedure.input(z.object({ id: z.number() })).mutation(async ({ input, ctx }) => {
    const ticket = await db.getTicketById(input.id);
    if (!ticket) throw new TRPCError({ code: "NOT_FOUND" });
    if (ticket.status !== "partial_purchase") throw new TRPCError({ code: "BAD_REQUEST", message: "البلاغ يجب أن يكون بشراء جزئي" });
    if (ticket.maintenancePath !== "B") throw new TRPCError({ code: "BAD_REQUEST", message: "هذا الإجراء للمسار B فقط" });
    await db.updateTicket(input.id, { status: "purchased" });
    await db.addTicketStatusHistory({ ticketId: input.id, fromStatus: "partial_purchase", toStatus: "purchased", changedById: ctx.user.id });
    return { success: true };
  }),

  receiveInWarehouse: warehouseProcedure.input(z.object({ id: z.number() })).mutation(async ({ input, ctx }) => {
    const ticket = await db.getTicketById(input.id);
    if (!ticket) throw new TRPCError({ code: "NOT_FOUND" });
    if (ticket.status !== "purchased") throw new TRPCError({ code: "BAD_REQUEST", message: "البلاغ يجب أن يكون مشتراً" });
    if (ticket.maintenancePath !== "B") throw new TRPCError({ code: "BAD_REQUEST", message: "هذا الإجراء للمسار B فقط" });
    await db.updateTicket(input.id, { status: "received_warehouse" });
    await db.addTicketStatusHistory({ ticketId: input.id, fromStatus: "purchased", toStatus: "received_warehouse", changedById: ctx.user.id });
    return { success: true };
  }),

  markRepaired: managerProcedure.input(z.object({ id: z.number() })).mutation(async ({ input, ctx }) => {
    const ticket = await db.getTicketById(input.id);
    if (!ticket) throw new TRPCError({ code: "NOT_FOUND" });
    if (ticket.status !== "ready_for_closure") throw new TRPCError({ code: "BAD_REQUEST", message: "البلاغ يجب أن يكون جاهزاً للإغلاق" });
    await db.updateTicket(input.id, { status: "repaired" });
    await db.addTicketStatusHistory({ ticketId: input.id, fromStatus: "ready_for_closure", toStatus: "repaired", changedById: ctx.user.id });
    return { success: true };
  }),

  markVerified: supervisorProcedure.input(z.object({ id: z.number() })).mutation(async ({ input, ctx }) => {
    const ticket = await db.getTicketById(input.id);
    if (!ticket) throw new TRPCError({ code: "NOT_FOUND" });
    if (ticket.status !== "repaired") throw new TRPCError({ code: "BAD_REQUEST", message: "البلاغ يجب أن يكون مصلحاً" });
    await db.updateTicket(input.id, { status: "verified" });
    await db.addTicketStatusHistory({ ticketId: input.id, fromStatus: "repaired", toStatus: "verified", changedById: ctx.user.id });
    return { success: true };
  }),
});

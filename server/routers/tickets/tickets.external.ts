import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { router, gateSecurityProcedure, delegateProcedure } from "../_shared/procedures";
import * as db from "../../db";

export const ticketsExternalRouter = router({
  approveGateExit: gateSecurityProcedure.input(z.object({ id: z.number() })).mutation(async ({ input, ctx }) => {
    const ticket = await db.getTicketById(input.id);
    if (!ticket) throw new TRPCError({ code: "NOT_FOUND" });
    if (ticket.maintenancePath !== "C") throw new TRPCError({ code: "BAD_REQUEST", message: "هذا الإجراء للمسار C فقط" });
    await db.updateTicket(input.id, { status: "out_for_repair", gateExitApprovedById: ctx.user.id, gateExitApprovedAt: new Date() });
    await db.addTicketStatusHistory({ ticketId: input.id, fromStatus: ticket.status, toStatus: "out_for_repair", changedById: ctx.user.id, notes: "تمت الموافقة على خروج الأصل" });
    await db.createAuditLog({ userId: ctx.user.id, action: "gate_exit_approved", entityType: "ticket", entityId: input.id });
    return { success: true };
  }),

  markExternalRepairDone: delegateProcedure.input(z.object({
    id: z.number(),
    repairNotes: z.string().optional(),
  })).mutation(async ({ input, ctx }) => {
    const ticket = await db.getTicketById(input.id);
    if (!ticket) throw new TRPCError({ code: "NOT_FOUND" });
    if (ticket.status !== "out_for_repair") throw new TRPCError({ code: "BAD_REQUEST", message: "الأصل ليس خارجاً للإصلاح" });
    await db.updateTicket(input.id, { externalRepairCompletedAt: new Date(), externalRepairCompletedById: ctx.user.id, repairNotes: input.repairNotes });
    await db.addTicketStatusHistory({ ticketId: input.id, fromStatus: ticket.status, toStatus: "out_for_repair", changedById: ctx.user.id, notes: "تم الإصلاح الخارجي - بانتظار موافقة الدخول" });
    // Notify gate security
    const gateUsers = await db.getUsersByRole("gate_security");
    for (const g of gateUsers) {
      await db.createNotification({ userId: g.id, title: "أصل عائد للمنشأة", message: `الأصل المرتبط بالبلاغ ${ticket.ticketNumber} عائد بعد الإصلاح الخارجي`, type: "info", relatedTicketId: input.id });
    }
    return { success: true };
  }),

  approveGateEntry: gateSecurityProcedure.input(z.object({ id: z.number() })).mutation(async ({ input, ctx }) => {
    const ticket = await db.getTicketById(input.id);
    if (!ticket) throw new TRPCError({ code: "NOT_FOUND" });
    if (ticket.maintenancePath !== "C") throw new TRPCError({ code: "BAD_REQUEST", message: "هذا الإجراء للمسار C فقط" });
    // Path C: gate entry → received_warehouse so warehouse flow (Path B) takes over
    await db.updateTicket(input.id, { status: "received_warehouse", gateEntryApprovedById: ctx.user.id, gateEntryApprovedAt: new Date() });
    await db.addTicketStatusHistory({ ticketId: input.id, fromStatus: ticket.status, toStatus: "received_warehouse", changedById: ctx.user.id, notes: "تمت الموافقة على دخول الأصل - بانتظار استلام المستودع" });
    await db.createAuditLog({ userId: ctx.user.id, action: "gate_entry_approved", entityType: "ticket", entityId: input.id });
    // Notify warehouse users to receive the returned asset
    const warehouseUsersGE = await db.getUsersByRole("warehouse");
    for (const w of warehouseUsersGE) {
      await db.createNotification({ userId: w.id, title: "📦 أصل عاد من الإصلاح الخارجي", message: `البلاغ ${ticket.ticketNumber} - الأصل عاد ويحتاج استلام في المستودع`, type: "info", relatedTicketId: input.id });
    }
    // Also notify managers
    const managersGE = await db.getManagerUsers();
    for (const mgr of managersGE) {
      await db.createNotification({ userId: mgr.id, title: "📦 أصل عاد من الإصلاح الخارجي", message: `البلاغ ${ticket.ticketNumber} - الأصل عاد بعد الإصلاح وبانتظار استلام المستودع`, type: "info", relatedTicketId: input.id });
    }
    return { success: true };
  }),

  listForGate: gateSecurityProcedure.query(async () => {
    return db.getTickets({ status: "work_approved" });
  }),
});

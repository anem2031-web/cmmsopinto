import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { router, protectedProcedure } from "../_shared/procedures";
import { TeamTicketError } from "../../../shared/maintenance-team-tickets/model";
import type { TicketTeamAssignmentService } from "../../maintenance-team-tickets/assignment/service";

async function result<T>(work: () => Promise<T>) {
  try { return await work(); } catch (e) {
    if (e instanceof TeamTicketError) {
      const codes = { INVALID: "BAD_REQUEST", CONFLICT: "CONFLICT", FORBIDDEN: "FORBIDDEN", NOT_FOUND: "NOT_FOUND", UNAVAILABLE: "INTERNAL_SERVER_ERROR" } as const;
      throw new TRPCError({ code: codes[e.code], message: e.message });
    }
    throw e;
  }
}
const actor = (ctx: any) => ({ id: ctx.user.id, role: ctx.user.role, active: ctx.user.isActive === 1, ipAddress: ctx.req?.ip, userAgent: ctx.req?.get?.("user-agent") });
export function createTicketTeamAssignmentRouter(service: TicketTeamAssignmentService) {
  return router({
    candidates: protectedProcedure.query(({ ctx }) => result(() => service.candidates(actor(ctx)))),
    queue: protectedProcedure.query(({ ctx }) => result(() => service.queue(actor(ctx)))),
    warehouseRequests: protectedProcedure.input(z.object({ search: z.string().max(200).optional() }).optional()).query(({ ctx, input }) => result(() => service.warehouseRequests(actor(ctx), input?.search))),
    assign: protectedProcedure.input(z.object({ ticketId: z.number().int().positive(), taskId: z.number().int().positive(), teamId: z.number().int().positive(), inspectionMinutes: z.number().int().min(1).max(525600) }).strict())
      .mutation(({ ctx, input }) => result(() => service.assign(actor(ctx), input))),
  });
}

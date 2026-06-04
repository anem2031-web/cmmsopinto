import { z } from "zod";
import { router, protectedProcedure } from "../_shared/procedures";
import * as db from "../../db";

export const inspectionResultsRouter = router({
  create: protectedProcedure.input(z.object({
    ticketId: z.number(),
    assetId: z.number().optional(),
    inspectorId: z.number(),
    inspectionType: z.enum(["triage", "detailed"]),
    severity: z.enum(["low", "medium", "high", "critical"]).optional(),
    rootCause: z.string().optional(),
    findings: z.string().optional(),
    recommendedAction: z.string().optional(),
  })).mutation(async ({ input, ctx }) => {
    const result = await db.createInspectionResult({
      ...input,
      inspectorId: ctx.user.id, // always use authenticated user, ignore input.inspectorId
      severity: input.severity ?? "medium",
      rootCause: input.rootCause ?? "",
      findings: input.findings ?? "",
      recommendedAction: input.recommendedAction ?? "",
    });
    return result;
  }),

  listByTicket: protectedProcedure.input(z.object({
    ticketId: z.number(),
  })).query(async ({ input }) => {
    return db.getInspectionResultsByTicket(input.ticketId);
  }),

  listByAsset: protectedProcedure.input(z.object({
    assetId: z.number(),
  })).query(async ({ input }) => {
    return db.getInspectionResultsByAsset(input.assetId);
  }),

  dashboardStats: protectedProcedure.query(async () => {
    return db.getInspectionDashboardStats();
  }),
});

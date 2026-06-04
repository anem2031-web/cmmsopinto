import { z } from "zod";
import { router, protectedProcedure } from "../_shared/procedures";
import * as db from "../../db";

export const auditRouter = router({
  list: protectedProcedure.input(z.object({
    entityType: z.string().optional(),
    entityId: z.number().optional(),
    userId: z.number().optional(),
    action: z.string().optional(),
    dateFrom: z.string().optional(),
    dateTo: z.string().optional(),
    limit: z.number().optional(),
  }).optional()).query(async ({ input }) => {
    const filters: any = {};
    if (input?.entityType) filters.entityType = input.entityType;
    if (input?.entityId) filters.entityId = input.entityId;
    if (input?.userId) filters.userId = input.userId;
    if (input?.action) filters.action = input.action;
    if (input?.dateFrom) filters.dateFrom = new Date(input.dateFrom);
    if (input?.dateTo) { const d = new Date(input.dateTo); d.setHours(23, 59, 59, 999); filters.dateTo = d; }
    if (input?.limit) filters.limit = input.limit;
    return db.getAuditLogsEnhanced(filters);
  }),
});

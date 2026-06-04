import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { router, protectedProcedure, managerProcedure } from "../_shared/procedures";
import * as db from "../../db";
import { eq, and, gte, lte } from "drizzle-orm";

export const inventoryReportsRouter = router({
  externalTechnicianPerformance: protectedProcedure.input(z.object({
      period: z.enum(["week", "month", "quarter", "year", "all", "custom"]).default("all"),
      dateFrom: z.string().optional(),
      dateTo: z.string().optional(),
    }).optional()).query(async ({ input }) => {
      const period = input?.period || "all";
      let dateFrom: Date | undefined;
      let dateTo: Date | undefined;
      if (period === "custom" && input?.dateFrom && input?.dateTo) {
        dateFrom = new Date(input.dateFrom);
        dateTo = new Date(input.dateTo);
        dateTo.setHours(23, 59, 59, 999);
      } else if (period !== "all") {
        dateTo = new Date();
        dateFrom = new Date();
        switch (period) {
          case "week": dateFrom.setDate(dateFrom.getDate() - 7); break;
          case "month": dateFrom.setMonth(dateFrom.getMonth() - 1); break;
          case "quarter": dateFrom.setMonth(dateFrom.getMonth() - 3); break;
          case "year": dateFrom.setFullYear(dateFrom.getFullYear() - 1); break;
        }
      }
      return db.getExternalTechnicianPerformance(period === "all" ? undefined : { dateFrom, dateTo });
    }),
});

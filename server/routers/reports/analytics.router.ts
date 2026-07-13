import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { router, protectedProcedure, managerProcedure } from "../_shared/procedures";
import * as db from "../../_core/db";
import { eq, and, gte, lte } from "drizzle-orm";

export const analyticsRouter = router({
  ticketsByStatus: protectedProcedure.query(async () => {
      const allTickets = await db.getTickets();
      const statusCounts: Record<string, number> = {};
      allTickets.forEach(t => { statusCounts[t.status] = (statusCounts[t.status] || 0) + 1; });
      return Object.entries(statusCounts).map(([status, count]) => ({ status, count }));
    }),

  ticketsByCategory: protectedProcedure.query(async () => {
      const allTickets = await db.getTickets();
      const catCounts: Record<string, number> = {};
      allTickets.forEach(t => { catCounts[t.category] = (catCounts[t.category] || 0) + 1; });
      return Object.entries(catCounts).map(([category, count]) => ({ category, count }));
    }),

  ticketsByPriority: protectedProcedure.query(async () => {
      const allTickets = await db.getTickets();
      const priCounts: Record<string, number> = {};
      allTickets.forEach(t => { priCounts[t.priority] = (priCounts[t.priority] || 0) + 1; });
      return Object.entries(priCounts).map(([priority, count]) => ({ priority, count }));
    }),

  monthlySummary: protectedProcedure.query(async () => {
      const allTickets = await db.getTickets();
      const monthly: Record<string, { created: number; closed: number }> = {};
      allTickets.forEach(t => {
        const month = new Date(t.createdAt).toISOString().slice(0, 7);
        if (!monthly[month]) monthly[month] = { created: 0, closed: 0 };
        monthly[month].created++;
        if (t.status === "closed") monthly[month].closed++;
      });
      return Object.entries(monthly).map(([month, data]) => ({ month, ...data })).sort((a, b) => a.month.localeCompare(b.month));
    }),

  costComparison: protectedProcedure.query(async () => {
      const pos = await db.getPurchaseOrders();
      return pos.map(po => ({
        poNumber: po.poNumber,
        estimated: parseFloat(po.totalEstimatedCost || "0"),
        actual: parseFloat(po.totalActualCost || "0"),
      }));
    }),
});

import { z } from "zod";
import { eq, and, asc, gte, lte } from "drizzle-orm";
import { router, protectedProcedure } from "../_shared/procedures";
import * as db from "../../_core/db";

export const dashboardRouter = router({
  stats: protectedProcedure.query(async () => {
    return db.getDashboardStats();
  }),

  pmMonthlySummary: protectedProcedure.query(async () => {
    const ddb = await db.getDb();
    if (!ddb) return { activePlans: 0, completedThisMonth: 0, pendingThisMonth: 0, overdueCount: 0, completionRate: 0, totalWorkOrders: 0 };

    const { preventivePlans, pmWorkOrders } = await import("../../../drizzle/schema");

    // الخطط النشطة
    const activePlans = await ddb.select().from(preventivePlans).where(eq(preventivePlans.isActive, true));

    // أوامر العمل هذا الشهر
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

    const allWOs = await ddb.select().from(pmWorkOrders);

    const thisMonthWOs = allWOs.filter((wo: any) => {
      const d = new Date(wo.scheduledDate || wo.createdAt);
      return d >= monthStart && d <= monthEnd;
    });

    const completedThisMonth = thisMonthWOs.filter((wo: any) => wo.status === "completed").length;
    const pendingThisMonth = thisMonthWOs.filter((wo: any) => wo.status !== "completed" && wo.status !== "cancelled").length;

    // المتأخرة (scheduledDate < اليوم وليست مكتملة)
    const overdueCount = allWOs.filter((wo: any) => {
      if (wo.status === "completed" || wo.status === "cancelled") return false;
      const d = new Date(wo.scheduledDate || wo.createdAt);
      return d < now;
    }).length;

    const totalThisMonth = thisMonthWOs.length;
    const completionRate = totalThisMonth > 0 ? Math.round((completedThisMonth / totalThisMonth) * 100) : 0;

    return {
      activePlans: activePlans.length,
      completedThisMonth,
      pendingThisMonth,
      overdueCount,
      completionRate,
      totalWorkOrders: totalThisMonth,
    };
  }),
});

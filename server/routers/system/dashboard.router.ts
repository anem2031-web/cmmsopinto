import { z } from "zod";
import { eq, and, asc, gte, lte } from "drizzle-orm";
import { router, protectedProcedure, adminOwnerProcedure } from "../_shared/procedures";
import * as db from "../../_core/db";
import { dashboardSnapshots } from "../../services/dashboard/snapshots";
import { DASHBOARD_METRICS, dashboardPeriod, dashboardSummary, dashboardDetails, type DashboardFilters } from "../../../shared/dashboard-overview";

const defaultFilters: DashboardFilters = { period: "month", department: "all" };
const filterShape = z.object({
  period: z.enum(["month", "year", "all", "custom"]).default("month"),
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  siteId: z.number().int().positive().optional(),
  department: z.enum(["all", "general", "construction", "it", "unclassified"]).default("all"),
  search: z.string().trim().max(150).optional(),
  responsibleId: z.number().int().positive().optional(),
  workStatus: z.enum(["all", "overdue", "open", "completed"]).optional(),
  workType: z.enum(["all", "reports", "purchases"]).optional(),
});
const validatePeriod = (input: DashboardFilters, context: z.RefinementCtx) => {
  try { dashboardPeriod(input, Date.now()); }
  catch { context.addIssue({ code: "custom", message: "حدد فترة صحيحة وبداية لا تتجاوز النهاية" }); }
};

export const dashboardRouter = router({
  // These queries expose administrative data only; the observer central guard
  // grants the admin read projection for their explicitly registered paths.
  overview: adminOwnerProcedure.input(filterShape.superRefine(validatePeriod).optional()).query(async ({ ctx, input }) => {
    const actor = ctx.authenticatedUser ?? ctx.user;
    const snapshot = await dashboardSnapshots.create(actor, input ?? defaultFilters);
    return { ...dashboardSummary(snapshot.report), snapshotId: snapshot.id };
  }),
  details: adminOwnerProcedure.input(filterShape.extend({
    metric: z.enum(DASHBOARD_METRICS),
    page: z.number().int().min(1).max(100000).default(1),
    managerKey: z.string().regex(/^(general|construction|it|unclassified):(\d+|unassigned)$/).optional(),
    managerBucket: z.enum(["all", "waiting_elsewhere", "aged_inside", "unknown_wait"]).default("all"),
    snapshotId: z.string().uuid().optional(),
  }).superRefine(validatePeriod)).query(async ({ ctx, input }) => {
    const { metric, page, managerKey, managerBucket, snapshotId, ...filters } = input;
    const actor = ctx.authenticatedUser ?? ctx.user;
    const snapshot = await dashboardSnapshots.resolve(actor, filters, snapshotId);
    return { ...dashboardDetails(snapshot.report, metric, page, managerKey, managerBucket), snapshotId: snapshot.id };
  }),

  stats: adminOwnerProcedure.query(async () => {
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

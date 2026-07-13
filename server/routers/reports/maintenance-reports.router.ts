import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { router, protectedProcedure, managerProcedure } from "../_shared/procedures";
import * as db from "../../_core/db";
import { eq, and, gte, lte } from "drizzle-orm";

export const maintenanceReportsRouter = router({
  technicianPerformance: protectedProcedure.input(z.object({
      period: z.enum(["week", "month", "quarter", "year", "all", "custom"]).default("all"),
      dateFrom: z.string().optional(),
      dateTo: z.string().optional(),
      siteId: z.number().optional(),
      sectionId: z.number().optional(),
      technicianName: z.string().optional(),
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
          case "week":
            dateFrom.setDate(dateFrom.getDate() - 7);
            break;
          case "month":
            dateFrom.setMonth(dateFrom.getMonth() - 1);
            break;
          case "quarter":
            dateFrom.setMonth(dateFrom.getMonth() - 3);
            break;
          case "year":
            dateFrom.setFullYear(dateFrom.getFullYear() - 1);
            break;
        }
      }

      return db.getTechnicianPerformance({
        ...(period !== "all" ? { dateFrom, dateTo } : {}),
        siteId: input?.siteId,
        sectionId: input?.sectionId,
        technicianName: input?.technicianName,
      });
    }),

  sectionReport: protectedProcedure.input(z.object({
      siteId: z.number().optional(),
      dateFrom: z.string().optional(),
      dateTo: z.string().optional(),
    }).optional()).query(async ({ input }) => {
      const allSections = await db.getSections();
      const allTickets = await db.getTickets({});
      const allAssets = await db.listAssets({});
      const allPMWorkOrders = await db.listPMWorkOrders();
      const dateFrom = input?.dateFrom ? new Date(input.dateFrom) : null;
      const dateTo = input?.dateTo ? new Date(input.dateTo) : null;

      const filteredTickets = allTickets.filter((t: any) => {
        if (input?.siteId && t.siteId !== input.siteId) return false;
        if (dateFrom && new Date(t.createdAt) < dateFrom) return false;
        if (dateTo && new Date(t.createdAt) > dateTo) return false;
        return true;
      });

      // فلترة أوامر العمل الوقائية حسب التاريخ
      const filteredPMWOs = allPMWorkOrders.filter((wo: any) => {
        if (dateFrom && new Date(wo.scheduledDate) < dateFrom) return false;
        if (dateTo && new Date(wo.scheduledDate) > dateTo) return false;
        return true;
      });

      // بناء خريطة assetId → sectionId من الأصول
      const assetSectionMap = new Map<number, number | null>();
      allAssets.forEach((a: any) => assetSectionMap.set(a.id, a.sectionId ?? null));

      const sectionStats = allSections
        .filter((s: any) => !input?.siteId || s.siteId === input.siteId)
        .map((section: any) => {
          const sectionTickets = filteredTickets.filter((t: any) => t.sectionId === section.id);
          const sectionAssets = allAssets.filter((a: any) => a.sectionId === section.id);
          const openTickets = sectionTickets.filter((t: any) => t.status !== "closed").length;
          const closedTickets = sectionTickets.filter((t: any) => t.status === "closed").length;
          const urgentTickets = sectionTickets.filter((t: any) => t.priority === "critical" || t.priority === "high").length;
          const maintenanceCost = sectionTickets.reduce((sum: number, t: any) => {
            return sum + (parseFloat(t.estimatedCost || "0") || 0);
          }, 0);
          const avgCloseTime = (() => {
            const closed = sectionTickets.filter((t: any) => t.status === "closed" && t.closedAt && t.createdAt);
            if (!closed.length) return null;
            const totalHours = closed.reduce((sum: number, t: any) => {
              return sum + (new Date(t.closedAt).getTime() - new Date(t.createdAt).getTime()) / (1000 * 60 * 60);
            }, 0);
            return Math.round(totalHours / closed.length * 10) / 10;
          })();

          // عدد أوامر العمل الوقائية لهذا القسم
          // أولاً: من pmWorkOrders.siteId مباشرةً (plan مرتبط بالموقع)
          // ثانياً: من assetId → sectionId عبر خريطة الأصول
          const sectionPMWOs = filteredPMWOs.filter((wo: any) => {
            // مطابقة مباشرة عبر siteId إذا كان القسم مرتبط بالموقع
            if (wo.assetId && assetSectionMap.get(wo.assetId) === section.id) return true;
            return false;
          });
          const preventiveCount = sectionPMWOs.length;
          const preventiveCompleted = sectionPMWOs.filter((wo: any) => wo.status === "completed").length;

          return {
            sectionId: section.id, sectionName: section.name, siteId: section.siteId,
            totalTickets: sectionTickets.length, openTickets, closedTickets, urgentTickets,
            totalAssets: sectionAssets.length, maintenanceCost: Math.round(maintenanceCost * 100) / 100,
            avgCloseTimeHours: avgCloseTime,
            preventiveCount,
            preventiveCompleted,
            emergencyCount: sectionTickets.length, // البلاغات هي الصيانة الطارئة
          };
        })
        .sort((a: any, b: any) => b.totalTickets - a.totalTickets);
      const unassigned = filteredTickets.filter((t: any) => !t.sectionId);
      return { sections: sectionStats, unassignedTickets: unassigned.length, totalTickets: filteredTickets.length };
    }),

  technicianMonthlyReport: protectedProcedure.input(z.object({
      monthsBack: z.number().min(1).max(12).default(6),
    }).optional()).query(async () => {
      const ddb = await db.getDb();
      if (!ddb) return { technicians: [], months: [] };

      const { pmExecutionSessions: execSessions, pmExecutionResults: execResults } = await import("../../../drizzle/schema");

      const allUsers = await db.getAllUsers();
      const technicians = allUsers.filter((u: any) => u.role === "technician");

      const sessions = await ddb
        .select()
        .from(execSessions)
        .where(eq(execSessions.status, "completed"));

      const results = await ddb.select().from(execResults);

      const allTickets = await db.getTickets({});
      const pmSourceTickets = allTickets.filter((t: any) =>
        t.description && t.description.includes("صيانة دورية")
      );

      const months: string[] = [];
      const now = new Date();
      for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
      }

      const technicianData = technicians.map((tech: any) => {
        const techSessions = sessions.filter((s: any) => s.technicianId === tech.id);

        const monthlyData = months.map(month => {
          const [y, m] = month.split("-").map(Number);
          const monthSessions = techSessions.filter((s: any) => {
            const d = new Date(s.completedAt || s.startedAt);
            return d.getFullYear() === y && d.getMonth() + 1 === m;
          });
          const sessionIds = monthSessions.map((s: any) => s.id);
          const sessionResults = results.filter((r: any) => sessionIds.includes(r.sessionId));
          const defectCount = sessionResults.filter((r: any) => r.status === "defect").length;
          const totalItems = sessionResults.length;
          const monthTickets = pmSourceTickets.filter((t: any) => {
            const d = new Date(t.createdAt);
            return d.getFullYear() === y && d.getMonth() + 1 === m && t.assignedToId === tech.id;
          });
          return {
            month, inspections: monthSessions.length, defectsFound: defectCount,
            totalItems, ticketsFromPM: monthTickets.length,
            detectionRate: totalItems > 0 ? Math.round(defectCount / totalItems * 100) : 0,
          };
        });

        const totalInspections = techSessions.length;
        const totalDefects = results.filter((r: any) =>
          techSessions.some((s: any) => s.id === r.sessionId) && r.status === "defect"
        ).length;
        const totalItems = results.filter((r: any) =>
          techSessions.some((s: any) => s.id === r.sessionId)
        ).length;

        return {
          technicianId: tech.id, technicianName: tech.name, role: tech.role,
          totalInspections, totalDefects,
          overallDetectionRate: totalItems > 0 ? Math.round(totalDefects / totalItems * 100) : 0,
          monthlyData,
        };
      });

      return { technicians: technicianData, months };
    }),

  maintenanceCycleReport: protectedProcedure.input(z.object({
      dateFrom: z.string().optional(),
      dateTo: z.string().optional(),
      ticketId: z.number().optional(),
      status: z.string().optional(),
    }).optional()).query(async ({ input }) => {
      const [allTickets, allUsers, allSites] = await Promise.all([
        db.getTickets(),
        db.getAllUsers(),
        db.getAllSites(),
      ]);

      let tickets = allTickets;
      if (input?.dateFrom) { const from = new Date(input.dateFrom); tickets = tickets.filter(t => new Date(t.createdAt) >= from); }
      if (input?.dateTo) { const to = new Date(input.dateTo); to.setHours(23, 59, 59, 999); tickets = tickets.filter(t => new Date(t.createdAt) <= to); }
      if (input?.ticketId) { tickets = tickets.filter(t => t.id === input.ticketId); }
      if (input?.status) { tickets = tickets.filter(t => t.status === input.status); }

      const msToHours = (ms: number) => Math.round(ms / 3600000 * 10) / 10;

      const STAGE_LABELS: Record<string, string> = {
        "new": "إنشاء البلاغ", "pending_triage": "انتظار الفرز", "under_inspection": "قيد الفحص",
        "work_approved": "موافقة على العمل", "approved": "موافقة الإدارة", "assigned": "تعيين فني",
        "in_progress": "قيد التنفيذ", "needs_purchase": "يحتاج شراء", "purchase_pending_estimate": "انتظار تسعير",
        "purchase_pending_accounting": "انتظار الحسابات", "purchase_pending_management": "انتظار الإدارة",
        "purchase_approved": "شراء معتمد", "partial_purchase": "شراء جزئي", "purchased": "تم الشراء",
        "received_warehouse": "استلام مستودع", "repaired": "تم الإصلاح", "verified": "تم التحقق",
        "ready_for_closure": "جاهز للإغلاق", "out_for_repair": "خارج للإصلاح", "closed": "مغلق",
      };

      const ticketHistories = await Promise.all(tickets.map(t => db.getTicketHistory(t.id).then(h => ({ ticketId: t.id, history: h }))));
      const historyMap = new Map(ticketHistories.map(th => [th.ticketId, th.history]));

      const result = tickets.map(ticket => {
        const history = historyMap.get(ticket.id) || [];
        const sortedHistory = [...history].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

        const reportedBy = allUsers.find(u => u.id === ticket.reportedById)?.name || "غير معروف";
        const assignedTo = allUsers.find(u => u.id === ticket.assignedToId)?.name || "غير مسند";
        const site = allSites.find(s => s.id === ticket.siteId)?.name || "";

        const phases: Array<{ fromStatus: string; toStatus: string; label: string; startAt: Date; endAt: Date | null; durationHours: number | null; changedBy: string }> = [];

        for (let i = 0; i < sortedHistory.length; i++) {
          const entry = sortedHistory[i];
          const nextEntry = sortedHistory[i + 1];
          const startAt = new Date(entry.createdAt);
          const endAt = nextEntry ? new Date(nextEntry.createdAt) : (ticket.closedAt ? new Date(ticket.closedAt) : null);
          const durationHours = endAt ? msToHours(endAt.getTime() - startAt.getTime()) : null;
          phases.push({
            fromStatus: entry.fromStatus || "",
            toStatus: entry.toStatus,
            label: STAGE_LABELS[entry.toStatus] || entry.toStatus,
            startAt, endAt, durationHours,
            changedBy: allUsers.find(u => u.id === entry.changedById)?.name || "النظام",
          });
        }

        const createdAt = new Date(ticket.createdAt);
        const endTime = ticket.closedAt ? new Date(ticket.closedAt) : new Date();
        const totalHours = msToHours(endTime.getTime() - createdAt.getTime());
        const totalDays = Math.round(totalHours / 24 * 10) / 10;

        const maxPhase = phases.reduce((max, p) => {
          if (p.durationHours !== null && (max === null || p.durationHours > (max.durationHours || 0))) return p;
          return max;
        }, null as typeof phases[0] | null);

        return {
          ticketId: ticket.id, ticketNumber: ticket.ticketNumber, title: ticket.title,
          status: ticket.status, priority: ticket.priority, category: ticket.category,
          site, reportedBy, assignedTo, maintenancePath: ticket.maintenancePath,
          createdAt: new Date(ticket.createdAt), closedAt: ticket.closedAt ? new Date(ticket.closedAt) : null,
          totalHours, totalDays, phases,
          bottleneck: maxPhase ? { phase: maxPhase.label, hours: maxPhase.durationHours } : null,
          isClosed: ticket.status === "closed",
        };
      });

      const closedTickets = result.filter(r => r.isClosed);
      const avgTotalHours = closedTickets.length > 0
        ? Math.round(closedTickets.reduce((s, r) => s + r.totalHours, 0) / closedTickets.length * 10) / 10
        : null;

      const allPhaseLabelsSet = new Set(result.flatMap(r => r.phases.map(p => p.label)));
      const allPhaseLabels = Array.from(allPhaseLabelsSet);
      const phaseAvgs = allPhaseLabels.map(label => {
        const durations: number[] = result.flatMap(r => r.phases.filter(p => p.label === label && p.durationHours !== null).map(p => p.durationHours as number));
        return { phase: label, avgHours: durations.length > 0 ? Math.round(durations.reduce((s: number, d: number) => s + d, 0) / durations.length * 10) / 10 : null, count: durations.length };
      }).filter(p => p.avgHours !== null).sort((a, b) => (b.avgHours || 0) - (a.avgHours || 0));

      return { tickets: result, avgTotalHours, avgTotalDays: avgTotalHours ? Math.round(avgTotalHours / 24 * 10) / 10 : null, phaseAvgs, total: result.length, closedCount: closedTickets.length };
    }),
});

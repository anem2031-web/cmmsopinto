import { z } from "zod";
import { router, protectedProcedure, managerProcedure } from "../_shared/procedures";
import * as db from "../../db";

export const reportsRouter = router({
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

  costComparison: protectedProcedure.query(async () => {
    const pos = await db.getPurchaseOrders();
    return pos.map(po => ({
      poNumber: po.poNumber,
      estimated: parseFloat(po.totalEstimatedCost || "0"),
      actual: parseFloat(po.totalActualCost || "0"),
    }));
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

  purchaseCycleReport: protectedProcedure.input(z.object({
    dateFrom: z.string().optional(),
    dateTo: z.string().optional(),
    poId: z.number().optional(),
  }).optional()).query(async ({ input }) => {
    const [allPOs, allUsers, allItems, allTickets] = await Promise.all([
      db.getPurchaseOrders(),
      db.getAllUsers(),
      db.getAllPOItems(),
      db.getTickets(),
    ]);

    let pos = allPOs;
    if (input?.dateFrom) {
      const from = new Date(input.dateFrom);
      pos = pos.filter(p => new Date(p.createdAt) >= from);
    }
    if (input?.dateTo) {
      const to = new Date(input.dateTo);
      to.setHours(23, 59, 59, 999);
      pos = pos.filter(p => new Date(p.createdAt) <= to);
    }
    if (input?.poId) {
      pos = pos.filter(p => p.id === input.poId);
    }

    const msToHours = (ms: number) => Math.round(ms / 3600000 * 10) / 10;

    const result = pos.map(po => {
      const items = allItems.filter(i => i.purchaseOrderId === po.id);
      const ticket = po.ticketId ? allTickets.find(t => t.id === po.ticketId) : null;
      const requestedBy = allUsers.find(u => u.id === po.requestedById)?.name || "غير معروف";
      const accountingApprovedBy = allUsers.find(u => u.id === po.accountingApprovedById)?.name;
      const managementApprovedBy = allUsers.find(u => u.id === po.managementApprovedById)?.name;

      const t0 = new Date(po.createdAt).getTime();
      const t1 = po.accountingApprovedAt ? new Date(po.accountingApprovedAt).getTime() : null;
      const t2 = po.managementApprovedAt ? new Date(po.managementApprovedAt).getTime() : null;

      const poPhases = [
        { phase: "إنشاء الطلب", startAt: new Date(po.createdAt), endAt: po.accountingApprovedAt ? new Date(po.accountingApprovedAt) : null, durationHours: t1 ? msToHours(t1 - t0) : null, actor: requestedBy, status: "done" },
        { phase: "موافقة الحسابات", startAt: po.accountingApprovedAt ? new Date(po.accountingApprovedAt) : null, endAt: po.managementApprovedAt ? new Date(po.managementApprovedAt) : null, durationHours: t1 && t2 ? msToHours(t2 - t1) : null, actor: accountingApprovedBy || null, status: po.accountingApprovedAt ? "done" : "pending" },
        { phase: "موافقة الإدارة", startAt: po.managementApprovedAt ? new Date(po.managementApprovedAt) : null, endAt: null, durationHours: null, actor: managementApprovedBy || null, status: po.managementApprovedAt ? "done" : "pending" },
      ];

      const itemsReport = items.map(item => {
        const delegate = allUsers.find(u => u.id === item.delegateId)?.name || "غير مُعيَّن";
        const receivedBy = allUsers.find(u => u.id === item.receivedById)?.name;
        const deliveredBy = allUsers.find(u => u.id === item.deliveredById)?.name;
        const purchasedBy = allUsers.find(u => u.id === item.purchasedById)?.name;

        const tCreated = new Date(item.createdAt).getTime();
        const tPurchased = item.purchasedAt ? new Date(item.purchasedAt).getTime() : null;
        const tReceived = item.receivedAt ? new Date(item.receivedAt).getTime() : null;
        const tDelivered = item.deliveredAt ? new Date(item.deliveredAt).getTime() : null;

        const phases = [
          { phase: "انتظار التسعير", startAt: new Date(item.createdAt), endAt: item.estimatedUnitCost ? new Date(item.updatedAt) : null, durationHours: item.estimatedUnitCost && t2 ? msToHours(t2 - tCreated) : null, status: item.estimatedUnitCost ? "done" : "pending" },
          { phase: "اعتماد الشراء", startAt: po.managementApprovedAt ? new Date(po.managementApprovedAt) : null, endAt: item.purchasedAt ? new Date(item.purchasedAt) : null, durationHours: t2 && tPurchased ? msToHours(tPurchased - t2) : null, status: item.purchasedAt ? "done" : (po.managementApprovedAt ? "in_progress" : "pending") },
          { phase: "شراء المندوب", startAt: item.purchasedAt ? new Date(item.purchasedAt) : null, endAt: item.receivedAt ? new Date(item.receivedAt) : null, durationHours: tPurchased && tReceived ? msToHours(tReceived - tPurchased) : null, actor: purchasedBy || delegate, status: item.purchasedAt ? "done" : "pending" },
          { phase: "استلام المستودع", startAt: item.receivedAt ? new Date(item.receivedAt) : null, endAt: item.deliveredAt ? new Date(item.deliveredAt) : null, durationHours: tReceived && tDelivered ? msToHours(tDelivered - tReceived) : null, actor: receivedBy || null, status: item.receivedAt ? "done" : "pending" },
          { phase: "تسليم للفني", startAt: item.deliveredAt ? new Date(item.deliveredAt) : null, endAt: null, durationHours: null, actor: deliveredBy || null, status: item.deliveredAt ? "done" : "pending" },
        ];

        const totalHours = tDelivered ? msToHours(tDelivered - tCreated) : null;

        return {
          itemId: item.id, itemName: item.itemName, quantity: item.quantity, unit: item.unit,
          delegate, estimatedCost: item.estimatedTotalCost ? parseFloat(item.estimatedTotalCost) : null,
          actualCost: item.actualTotalCost ? parseFloat(item.actualTotalCost) : null,
          currentStatus: item.status, totalHours, phases,
        };
      });

      const completedItems = itemsReport.filter(i => i.totalHours !== null);
      const totalPOHours = completedItems.length > 0
        ? Math.round(completedItems.reduce((s, i) => s + (i.totalHours || 0), 0) / completedItems.length * 10) / 10
        : null;

      return {
        poId: po.id, poNumber: po.poNumber, status: po.status, requestedBy,
        createdAt: new Date(po.createdAt), ticketId: po.ticketId,
        ticketNumber: ticket?.ticketNumber || null,
        custodyAmount: po.custodyAmount ? parseFloat(po.custodyAmount) : null,
        poPhases, items: itemsReport, totalPOHours, itemCount: items.length,
      };
    });

    const completedPOs = result.filter(r => r.totalPOHours !== null);
    const avgTotalHours = completedPOs.length > 0
      ? Math.round(completedPOs.reduce((s, r) => s + (r.totalPOHours || 0), 0) / completedPOs.length * 10) / 10
      : null;

    const phaseNames = ["انتظار التسعير", "اعتماد الشراء", "شراء المندوب", "استلام المستودع", "تسليم للفني"];
    const phaseAvgs = phaseNames.map(phaseName => {
      const durations: number[] = result.flatMap(r => r.items.flatMap(i => i.phases.filter(p => p.phase === phaseName && p.durationHours !== null).map(p => p.durationHours as number)));
      return { phase: phaseName, avgHours: durations.length > 0 ? Math.round(durations.reduce((s: number, d: number) => s + d, 0) / durations.length * 10) / 10 : null, count: durations.length };
    });

    return { pos: result, avgTotalHours, phaseAvgs, total: result.length };
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

  costReport: protectedProcedure.input(z.object({
    groupBy: z.enum(["section", "site"]).default("site"),
    period: z.enum(["month", "quarter", "year", "all", "custom"]).default("all"),
    dateFrom: z.string().optional(),
    dateTo: z.string().optional(),
  }).optional()).query(async ({ input }) => {
    const groupBy = input?.groupBy ?? "site";
    const period = input?.period ?? "all";
    let dateFrom: Date | undefined;
    let dateTo: Date | undefined;
    if (period === "custom" && input?.dateFrom && input?.dateTo) {
      dateFrom = new Date(input.dateFrom);
      dateTo = new Date(input.dateTo);
      dateTo.setHours(23, 59, 59, 999);
    } else if (period !== "all") {
      dateTo = new Date();
      dateFrom = new Date();
      if (period === "month") dateFrom.setMonth(dateFrom.getMonth() - 1);
      else if (period === "quarter") dateFrom.setMonth(dateFrom.getMonth() - 3);
      else if (period === "year") dateFrom.setFullYear(dateFrom.getFullYear() - 1);
    }
    // جلب البيانات: البلاغات + أصناف الشراء المستلمة (المصدر الموحد) + المواقع + الأقسام
    const [allTickets, allSites, allSections, allPOs, allPOItems] = await Promise.all([
      db.getTickets({}),
      db.getAllSites(),
      db.getSections(),
      db.getPurchaseOrders(),
      db.getAllPOItems(),
    ]);
    // فلترة البلاغات حسب التاريخ
    const filteredTickets = allTickets.filter((t: any) => {
      if (dateFrom && new Date(t.createdAt) < dateFrom) return false;
      if (dateTo && new Date(t.createdAt) > dateTo) return false;
      return true;
    });
    // أصناف الشراء المستلمة فعلياً (delivered_to_warehouse أو delivered_to_requester)
    // هذا المصدر يطابق بطاقة لوحة التحكم تماماً
    const deliveredItems = allPOItems.filter((item: any) => {
      if (item.status !== "delivered_to_warehouse" && item.status !== "delivered_to_requester") return false;
      const dateRef = item.deliveredAt || item.receivedAt || item.createdAt;
      if (dateFrom && new Date(dateRef) < dateFrom) return false;
      if (dateTo && new Date(dateRef) > dateTo) return false;
      return true;
    });
    // بناء خريطة purchaseOrderId → siteId/sectionId من جدول purchaseOrders
    const poMap = new Map<number, { siteId: number | null; sectionId: number | null }>();
    allPOs.forEach((po: any) => poMap.set(po.id, { siteId: po.siteId ?? null, sectionId: po.sectionId ?? null }));
    // الاتجاه الشهري (آخر 12 شهر) - يستخدم المصدر الموحد
    const monthlyTrend: { month: string; label: string; ticketCost: number; purchaseCost: number; total: number }[] = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date();
      d.setDate(1);
      d.setMonth(d.getMonth() - i);
      const monthKey = d.toISOString().slice(0, 7);
      const monthStart = new Date(d.getFullYear(), d.getMonth(), 1);
      const monthEnd = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59);
      const monthNames = ["يناير","فبراير","مارس","أبريل","مايو","يونيو","يوليو","أغسطس","سبتمبر","أكتوبر","نوفمبر","ديسمبر"];
      const label = `${monthNames[d.getMonth()]} ${d.getFullYear()}`;
      const ticketCost = allTickets
        .filter((t: any) => { const c = new Date(t.createdAt); return c >= monthStart && c <= monthEnd; })
        .reduce((sum: number, t: any) => sum + parseFloat(t.actualCost || t.estimatedCost || "0"), 0);
      const purchaseCost = allPOItems
        .filter((item: any) => {
          if (item.status !== "delivered_to_warehouse" && item.status !== "delivered_to_requester") return false;
          const dateRef = item.deliveredAt || item.receivedAt || item.createdAt;
          const c = new Date(dateRef);
          return c >= monthStart && c <= monthEnd;
        })
        .reduce((sum: number, item: any) => sum + parseFloat(item.actualTotalCost || item.estimatedTotalCost || "0"), 0);
      monthlyTrend.push({ month: monthKey, label, ticketCost: Math.round(ticketCost * 100) / 100, purchaseCost: Math.round(purchaseCost * 100) / 100, total: Math.round((ticketCost + purchaseCost) * 100) / 100 });
    }
    type GroupItem = { id: number; name: string; siteName?: string; ticketCost: number; purchaseCost: number; totalCost: number; ticketCount: number; ticketsNoCost: number; percentage: number; isUnclassified?: boolean };
    let groups: GroupItem[] = [];
    if (groupBy === "site") {
      groups = allSites.map((site: any) => {
        const siteTickets = filteredTickets.filter((t: any) => t.siteId === site.id);
        const siteItems = deliveredItems.filter((item: any) => poMap.get(item.purchaseOrderId)?.siteId === site.id);
        const ticketCost = siteTickets.reduce((sum: number, t: any) => sum + parseFloat(t.actualCost || t.estimatedCost || "0"), 0);
        const purchaseCost = siteItems.reduce((sum: number, item: any) => sum + parseFloat(item.actualTotalCost || item.estimatedTotalCost || "0"), 0);
        const ticketsNoCost = siteTickets.filter((t: any) => !t.actualCost && !t.estimatedCost).length;
        return { id: site.id, name: site.name, ticketCost: Math.round(ticketCost * 100) / 100, purchaseCost: Math.round(purchaseCost * 100) / 100, totalCost: Math.round((ticketCost + purchaseCost) * 100) / 100, ticketCount: siteTickets.length, ticketsNoCost, percentage: 0 };
      });
      // التكاليف غير المرتبطة بأي موقع
      const unclassifiedTickets = filteredTickets.filter((t: any) => !t.siteId);
      const unclassifiedItems = deliveredItems.filter((item: any) => !poMap.get(item.purchaseOrderId)?.siteId);
      const unclassifiedTicketCost = unclassifiedTickets.reduce((sum: number, t: any) => sum + parseFloat(t.actualCost || t.estimatedCost || "0"), 0);
      const unclassifiedPurchaseCost = unclassifiedItems.reduce((sum: number, item: any) => sum + parseFloat(item.actualTotalCost || item.estimatedTotalCost || "0"), 0);
      const unclassifiedTotal = unclassifiedTicketCost + unclassifiedPurchaseCost;
      if (unclassifiedTotal > 0 || unclassifiedTickets.length > 0) {
        groups.push({ id: -1, name: "غير محدد", ticketCost: Math.round(unclassifiedTicketCost * 100) / 100, purchaseCost: Math.round(unclassifiedPurchaseCost * 100) / 100, totalCost: Math.round(unclassifiedTotal * 100) / 100, ticketCount: unclassifiedTickets.length, ticketsNoCost: unclassifiedTickets.filter((t: any) => !t.actualCost && !t.estimatedCost).length, percentage: 0, isUnclassified: true });
      }
    } else {
      groups = allSections.map((section: any) => {
        const secTickets = filteredTickets.filter((t: any) => t.sectionId === section.id);
        const secItems = deliveredItems.filter((item: any) => poMap.get(item.purchaseOrderId)?.sectionId === section.id);
        const ticketCost = secTickets.reduce((sum: number, t: any) => sum + parseFloat(t.actualCost || t.estimatedCost || "0"), 0);
        const purchaseCost = secItems.reduce((sum: number, item: any) => sum + parseFloat(item.actualTotalCost || item.estimatedTotalCost || "0"), 0);
        const siteName = allSites.find((s: any) => s.id === section.siteId)?.name ?? "";
        const ticketsNoCost = secTickets.filter((t: any) => !t.actualCost && !t.estimatedCost).length;
        return { id: section.id, name: section.name, siteName, ticketCost: Math.round(ticketCost * 100) / 100, purchaseCost: Math.round(purchaseCost * 100) / 100, totalCost: Math.round((ticketCost + purchaseCost) * 100) / 100, ticketCount: secTickets.length, ticketsNoCost, percentage: 0 };
      });
      // التكاليف غير المرتبطة بأي قسم
      const unclassifiedTickets = filteredTickets.filter((t: any) => !t.sectionId);
      const unclassifiedItems = deliveredItems.filter((item: any) => !poMap.get(item.purchaseOrderId)?.sectionId);
      const unclassifiedTicketCost = unclassifiedTickets.reduce((sum: number, t: any) => sum + parseFloat(t.actualCost || t.estimatedCost || "0"), 0);
      const unclassifiedPurchaseCost = unclassifiedItems.reduce((sum: number, item: any) => sum + parseFloat(item.actualTotalCost || item.estimatedTotalCost || "0"), 0);
      const unclassifiedTotal = unclassifiedTicketCost + unclassifiedPurchaseCost;
      if (unclassifiedTotal > 0 || unclassifiedTickets.length > 0) {
        groups.push({ id: -1, name: "غير محدد", ticketCost: Math.round(unclassifiedTicketCost * 100) / 100, purchaseCost: Math.round(unclassifiedPurchaseCost * 100) / 100, totalCost: Math.round(unclassifiedTotal * 100) / 100, ticketCount: unclassifiedTickets.length, ticketsNoCost: unclassifiedTickets.filter((t: any) => !t.actualCost && !t.estimatedCost).length, percentage: 0, isUnclassified: true });
      }
    }
    groups = groups.sort((a, b) => b.totalCost - a.totalCost);
    const grandTotal = groups.reduce((sum, g) => sum + g.totalCost, 0);
    groups = groups.map(g => ({ ...g, percentage: grandTotal > 0 ? Math.round((g.totalCost / grandTotal) * 1000) / 10 : 0 }));
    const totalTicketsNoCost = filteredTickets.filter((t: any) => !t.actualCost && !t.estimatedCost).length;
    return { groups, grandTotal: Math.round(grandTotal * 100) / 100, monthlyTrend, groupBy, totalTicketsNoCost };
  }),

  technicianMonthlyReport: protectedProcedure.input(z.object({
    monthsBack: z.number().min(1).max(12).default(6),
  }).optional()).query(async () => {
    const ddb = await db.getDb();
    if (!ddb) return { technicians: [], months: [] };

    const { pmExecutionSessions: execSessions, pmExecutionResults: execResults } = await import("../drizzle/schema");

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
});

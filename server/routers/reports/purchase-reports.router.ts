import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { router, protectedProcedure, managerProcedure } from "../_shared/procedures";
import * as db from "../../_core/db";
import { eq, and, gte, lte } from "drizzle-orm";

export const purchaseReportsRouter = router({
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
        const reviewedBy = allUsers.find(u => u.id === (po as any).reviewedById)?.name || null;
        const accountingApprovedBy = allUsers.find(u => u.id === po.accountingApprovedById)?.name;
        const managementApprovedBy = allUsers.find(u => u.id === po.managementApprovedById)?.name;

        const t0 = new Date(po.createdAt).getTime();
        const t1 = po.accountingApprovedAt ? new Date(po.accountingApprovedAt).getTime() : null;
        const t2 = po.managementApprovedAt ? new Date(po.managementApprovedAt).getTime() : null;

// جمع المنفذين على مستوى الطلب كله
const purchasedActors = items
  .filter(i => i.purchasedById)
  .map(i => ({ itemName: i.itemName, name: allUsers.find(u => u.id === i.purchasedById)?.name || "غير معروف" }));

const receivedActors = items
  .filter(i => i.receivedById)
  .map(i => ({ itemName: i.itemName, name: allUsers.find(u => u.id === i.receivedById)?.name || "غير معروف" }));

const deliveredActors = items
  .filter(i => i.deliveredById)
  .map(i => ({
    itemName: i.itemName,
    name: allUsers.find(u => u.id === i.deliveredById)?.name || "غير معروف",
    deliveredTo: allUsers.find(u => u.id === i.deliveredToId)?.name || null,
  }));

const poPhases = [
  { phase: "إنشاء الطلب", startAt: new Date(po.createdAt), endAt: (po as any).reviewedAt ? new Date((po as any).reviewedAt) : null, durationHours: null, actor: requestedBy, actors: [{ itemName: "", name: requestedBy }], status: "done" },
  { phase: "مراجعة الأصناف", startAt: (po as any).reviewedAt ? new Date((po as any).reviewedAt) : null, endAt: po.accountingApprovedAt ? new Date(po.accountingApprovedAt) : null, durationHours: null, actor: reviewedBy, actors: reviewedBy ? [{ itemName: "", name: reviewedBy }] : [], status: (po as any).reviewedAt ? "done" : "pending" },
  { phase: "موافقة الحسابات", startAt: po.accountingApprovedAt ? new Date(po.accountingApprovedAt) : null, endAt: po.managementApprovedAt ? new Date(po.managementApprovedAt) : null, durationHours: t1 && t2 ? msToHours(t2 - t1) : null, actor: accountingApprovedBy || null, actors: accountingApprovedBy ? [{ itemName: "", name: accountingApprovedBy }] : [], status: po.accountingApprovedAt ? "done" : "pending" },
  { phase: "موافقة الإدارة", startAt: po.managementApprovedAt ? new Date(po.managementApprovedAt) : null, endAt: null, durationHours: null, actor: managementApprovedBy || null, actors: managementApprovedBy ? [{ itemName: "", name: managementApprovedBy }] : [], status: po.managementApprovedAt ? "done" : "pending" },
  { phase: "شراء المندوب", startAt: null, endAt: null, durationHours: null, actor: null, actors: purchasedActors, status: purchasedActors.length > 0 ? "done" : "pending" },
  { phase: "استلام المستودع", startAt: null, endAt: null, durationHours: null, actor: null, actors: receivedActors, status: receivedActors.length > 0 ? "done" : "pending" },
  { phase: "تسليم للفني", startAt: null, endAt: null, durationHours: null, actor: null, actors: deliveredActors, status: deliveredActors.length > 0 ? "done" : "pending" },
];

        const itemsReport = items.map(item => {
          const delegate = allUsers.find(u => u.id === Number(item.estimatedById || item.delegateId))?.name || "غير مُعيَّن";
          const receivedBy = allUsers.find(u => u.id === item.receivedById)?.name;
          const deliveredBy = allUsers.find(u => u.id === item.deliveredById)?.name;
          const purchasedBy = allUsers.find(u => u.id === item.purchasedById)?.name;

          const tCreated = new Date(item.createdAt).getTime();
          const tPurchased = item.purchasedAt ? new Date(item.purchasedAt).getTime() : null;
          const tReceived = item.receivedAt ? new Date(item.receivedAt).getTime() : null;
          const tDelivered = item.deliveredAt ? new Date(item.deliveredAt).getTime() : null;

          const phases = [
            { phase: "انتظار التسعير", startAt: new Date(item.createdAt), endAt: item.estimatedUnitCost ? new Date(item.updatedAt) : null, durationHours: item.estimatedUnitCost && t2 ? msToHours(t2 - tCreated) : null, actor: purchasedBy || delegate || null, status: item.estimatedUnitCost ? "done" : "pending" },
            { phase: "اعتماد الشراء", startAt: po.managementApprovedAt ? new Date(po.managementApprovedAt) : null, endAt: item.purchasedAt ? new Date(item.purchasedAt) : null, durationHours: t2 && tPurchased ? msToHours(tPurchased - t2) : null, actor: reviewedBy || null, status: item.purchasedAt ? "done" : (po.managementApprovedAt ? "in_progress" : "pending") },
            { phase: "شراء المندوب", startAt: item.purchasedAt ? new Date(item.purchasedAt) : null, endAt: item.receivedAt ? new Date(item.receivedAt) : null, durationHours: tPurchased && tReceived ? msToHours(tReceived - tPurchased) : null, actor: purchasedBy || delegate, status: item.purchasedAt ? "done" : "pending" },
            { phase: "استلام المستودع", startAt: item.receivedAt ? new Date(item.receivedAt) : null, endAt: item.deliveredAt ? new Date(item.deliveredAt) : null, durationHours: tReceived && tDelivered ? msToHours(tDelivered - tReceived) : null, actor: receivedBy || null, status: item.receivedAt ? "done" : "pending" },
            { phase: "تسليم للفني", startAt: item.deliveredAt ? new Date(item.deliveredAt) : null, endAt: null, durationHours: null, actor: deliveredBy || null, deliveredTo: allUsers.find(u => u.id === item.deliveredToId)?.name || null, status: item.deliveredAt ? "done" : "pending" },
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
});

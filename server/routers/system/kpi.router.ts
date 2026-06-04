import { z } from "zod";
import { router, managerProcedure } from "../_shared/procedures";
import * as db from "../../db";

export const kpiRouter = router({
  getTicketTimelines: managerProcedure.query(async () => {
    const ddb = await db.getDb();
    if (!ddb) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available" });
    const { tickets } = await import("../drizzle/schema");
    const { desc: descOp } = await import("drizzle-orm");
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // آخر 7 أيام
    const rows = await ddb
      .select({
        id: tickets.id,
        ticketNumber: tickets.ticketNumber,
        title: tickets.title,
        status: tickets.status,
        priority: tickets.priority,
        createdAt: tickets.createdAt,
        assignedAt: tickets.assignedAt,
        closedAt: tickets.closedAt,
        assignedToId: tickets.assignedToId,
        updatedAt: tickets.updatedAt,
      })
      .from(tickets)
       .where(and(gte(tickets.createdAt, cutoff)))
      .orderBy(descOp(tickets.createdAt))
      .limit(20);
    // SLA thresholds (minutes)
    const SLA = {
      triage: 30,        // الفرز خلال 30 دقيقة
      assignment: 60,    // الإسناد خلال ساعة
      fieldWork: 240,    // بدء العمل خلال 4 ساعات
      closure: 2880,     // الإغلاق خلال 48 ساعة
    };

    const now = Date.now();

    return rows.map((t) => {
      const createdMs = new Date(t.createdAt).getTime();
      const assignedMs = t.assignedAt ? new Date(t.assignedAt).getTime() : null;
      const closedMs = t.closedAt ? new Date(t.closedAt).getTime() : null;
      const updatedMs = new Date(t.updatedAt).getTime();

      // Step 1: فتح البلاغ → الفرز (نعتبر أول تحديث = الفرز)
      const triageMs = updatedMs > createdMs ? updatedMs : null;
      const triageDuration = triageMs ? Math.round((triageMs - createdMs) / 60000) : null;
      const triageStatus: "ok" | "warning" | "overdue" | "pending" =
        triageMs
          ? triageDuration! <= SLA.triage ? "ok" : triageDuration! <= SLA.triage * 2 ? "warning" : "overdue"
          : (now - createdMs) / 60000 > SLA.triage ? "overdue" : "pending";

      // Step 2: الفرز → إسناد الفني
      const assignDuration = assignedMs && triageMs ? Math.round((assignedMs - triageMs) / 60000) : null;
      const assignStatus: "ok" | "warning" | "overdue" | "pending" =
        assignedMs
          ? assignDuration! <= SLA.assignment ? "ok" : assignDuration! <= SLA.assignment * 2 ? "warning" : "overdue"
          : t.assignedToId ? "ok"
          : (triageMs && (now - triageMs) / 60000 > SLA.assignment) ? "overdue" : "pending";

      // Step 3: الإسناد → بدء العمل الميداني
      const fieldStart = ["in_progress", "repaired", "verified", "closed"].includes(t.status) ? assignedMs : null;
      const fieldDuration = fieldStart && assignedMs ? Math.round((fieldStart - assignedMs) / 60000) : null;
      const fieldStatus: "ok" | "warning" | "overdue" | "pending" =
        fieldStart
          ? fieldDuration! <= SLA.fieldWork ? "ok" : fieldDuration! <= SLA.fieldWork * 1.5 ? "warning" : "overdue"
          : assignedMs ? (now - assignedMs) / 60000 > SLA.fieldWork ? "overdue" : "pending" : "pending";

      // Step 4: الإغلاق
      const closureDuration = closedMs ? Math.round((closedMs - createdMs) / 60000) : null;
      const closureStatus: "ok" | "warning" | "overdue" | "pending" | "done" =
        closedMs ? "done"
          : (now - createdMs) / 60000 > SLA.closure ? "overdue"
          : (now - createdMs) / 60000 > SLA.closure * 0.75 ? "warning" : "pending";

      // تحديد نقطة الاختناق
      let bottleneck = null;
      if (closureStatus === "overdue") bottleneck = "مرحلة الإغلاق";
      else if (fieldStatus === "overdue") bottleneck = "بدء العمل الميداني";
      else if (assignStatus === "overdue") bottleneck = "إسناد الفني";
      else if (triageStatus === "overdue") bottleneck = "مرحلة الفرز";

      const totalMin = Math.round((now - createdMs) / 60000);
      const overallStatus = bottleneck ? "overdue" : closedMs ? "done" : "ok";

      return {
        id: t.id,
        ticketNumber: t.ticketNumber,
        title: t.title,
        status: t.status,
        priority: t.priority,
        overallStatus,
        bottleneck,
        totalMinutes: totalMin,
        steps: [
          {
            label: "فتح البلاغ",
            icon: "create",
            completedAt: t.createdAt,
            durationMin: null,
            status: "done" as const,
            slaMin: null,
          },
          {
            label: "الفرز والتصنيف",
            icon: "triage",
            completedAt: triageMs ? new Date(triageMs) : null,
            durationMin: triageDuration,
            status: triageStatus,
            slaMin: SLA.triage,
          },
          {
            label: "إسناد الفني",
            icon: "assign",
            completedAt: t.assignedAt,
            durationMin: assignDuration,
            status: assignStatus,
            slaMin: SLA.assignment,
          },
          {
            label: "بدء العمل الميداني",
            icon: "field",
            completedAt: fieldStart ? new Date(fieldStart) : null,
            durationMin: fieldDuration,
            status: fieldStatus,
            slaMin: SLA.fieldWork,
          },
          {
            label: "إغلاق البلاغ",
            icon: "close",
            completedAt: t.closedAt,
            durationMin: closureDuration,
            status: closureStatus,
            slaMin: SLA.closure,
          },
        ],
      };
    });
  }),

  getPOTimelines: managerProcedure.query(async () => {
    const ddb = await db.getDb();
    if (!ddb) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available" });
    const { purchaseOrders } = await import("../drizzle/schema");
    const { desc: descOp2 } = await import("drizzle-orm");
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const rows = await ddb
      .select({
        id: purchaseOrders.id,
        poNumber: purchaseOrders.poNumber,
        status: purchaseOrders.status,
        createdAt: purchaseOrders.createdAt,
        accountingApprovedAt: purchaseOrders.accountingApprovedAt,
        managementApprovedAt: purchaseOrders.managementApprovedAt,
        rejectedAt: purchaseOrders.rejectedAt,
        updatedAt: purchaseOrders.updatedAt,
      })
      .from(purchaseOrders)
      .where(and(gte(purchaseOrders.createdAt, cutoff)))
      .orderBy(descOp2(purchaseOrders.createdAt))
      .limit(20);

    const SLA = {
      estimate: 240,    // التسعير 4 ساعات
      accounting: 480,  // المحاسبة 8 ساعات
      management: 240,  // الإدارة 4 ساعات
      purchase: 1440,   // الشراء 24 ساعة
    };
    const now = Date.now();

    return rows.map((po) => {
      const createdMs = new Date(po.createdAt).getTime();
      const accMs = po.accountingApprovedAt ? new Date(po.accountingApprovedAt).getTime() : null;
      const mgmtMs = po.managementApprovedAt ? new Date(po.managementApprovedAt).getTime() : null;
      const rejectedMs = po.rejectedAt ? new Date(po.rejectedAt).getTime() : null;
      const updatedMs = new Date(po.updatedAt).getTime();

      // Step 1: إنشاء → إضافة عروض الأسعار
      const estimateMs = ["pending_accounting", "pending_management", "approved", "partial_purchase", "purchased", "received", "closed"].includes(po.status) ? updatedMs : null;
      const estimateDuration = estimateMs ? Math.round((estimateMs - createdMs) / 60000) : null;
      const estimateStatus: "ok" | "warning" | "overdue" | "pending" =
        estimateMs
          ? estimateDuration! <= SLA.estimate ? "ok" : estimateDuration! <= SLA.estimate * 2 ? "warning" : "overdue"
          : (now - createdMs) / 60000 > SLA.estimate ? "overdue" : "pending";

      // Step 2: اعتماد المحاسبة
      const accDuration = accMs && estimateMs ? Math.round((accMs - estimateMs) / 60000) : null;
      const accStatus: "ok" | "warning" | "overdue" | "pending" | "done" =
        accMs ? "done"
          : estimateMs ? (now - estimateMs) / 60000 > SLA.accounting ? "overdue" : (now - estimateMs) / 60000 > SLA.accounting * 0.75 ? "warning" : "pending"
          : "pending";

      // Step 3: اعتماد الإدارة
      const mgmtDuration = mgmtMs && accMs ? Math.round((mgmtMs - accMs) / 60000) : null;
      const mgmtStatus: "ok" | "warning" | "overdue" | "pending" | "done" =
        mgmtMs ? "done"
          : accMs ? (now - accMs) / 60000 > SLA.management ? "overdue" : (now - accMs) / 60000 > SLA.management * 0.75 ? "warning" : "pending"
          : "pending";

      // Step 4: الشراء
      const purchaseStatus: "ok" | "warning" | "overdue" | "pending" | "done" =
        ["purchased", "received", "closed"].includes(po.status) ? "done"
          : rejectedMs ? "overdue"
          : mgmtMs ? (now - mgmtMs) / 60000 > SLA.purchase ? "overdue" : "pending"
          : "pending";

      let bottleneck = null;
      if (purchaseStatus === "overdue" && !rejectedMs) bottleneck = "مرحلة الشراء";
      else if (mgmtStatus === "overdue") bottleneck = "اعتماد الإدارة";
      else if (accStatus === "overdue") bottleneck = "اعتماد المحاسبة";
      else if (estimateStatus === "overdue") bottleneck = "مرحلة التسعير";

      const totalMin = Math.round((now - createdMs) / 60000);
      const overallStatus = rejectedMs ? "rejected" : bottleneck ? "overdue" : ["purchased", "received", "closed"].includes(po.status) ? "done" : "ok";

      return {
        id: po.id,
        poNumber: po.poNumber,
        status: po.status,
        overallStatus,
        bottleneck,
        totalMinutes: totalMin,
        steps: [
          { label: "إنشاء الطلب", icon: "create", completedAt: po.createdAt, durationMin: null, status: "done" as const, slaMin: null },
          { label: "إضافة عروض الأسعار", icon: "estimate", completedAt: estimateMs ? new Date(estimateMs) : null, durationMin: estimateDuration, status: estimateStatus, slaMin: SLA.estimate },
          { label: "اعتماد المحاسبة", icon: "accounting", completedAt: po.accountingApprovedAt, durationMin: accDuration, status: accStatus, slaMin: SLA.accounting },
          { label: "اعتماد الإدارة", icon: "management", completedAt: po.managementApprovedAt, durationMin: mgmtDuration, status: mgmtStatus, slaMin: SLA.management },
          { label: "الشراء والتسليم", icon: "purchase", completedAt: null, durationMin: null, status: purchaseStatus, slaMin: SLA.purchase },
        ],
      };
    });
  }),
});

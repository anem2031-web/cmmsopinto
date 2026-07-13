// ============================================================
// db/reports.ts — تقارير الأداء ولوحة التحكم
// (مُقسَّم من db.ts الأصلي حسب المجال الوظيفي)
// ============================================================
import { eq, desc, asc, and, sql, count, sum, inArray, notInArray, like, or, gte, lte, lt, isNull, isNotNull, ne } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { alias } from "drizzle-orm/mysql-core";
import mysql from "mysql2/promise";
import {
  InsertUser, users, tickets, purchaseOrders, purchaseOrderItems,
  inventory, inventoryTransactions, notifications, auditLogs,
  ticketStatusHistory, attachments, sites, backups,
  assets, preventivePlans, pmWorkOrders, assetSpareParts, pmJobs, assetMetrics,
  pmChecklistItems, pmWorkOrderBranches,
  twoFactorSecrets, twoFactorAuditLogs,
  pushSubscriptions, sections, technicians, inspectionResults,
  type InsertAsset, type InsertPreventivePlan, type PreventivePlan, type InsertPMWorkOrder,
  type InsertSection, type InsertInspectionResult,
  assetCategories,
  procurementComments,
  type InsertProcurementComment,
  warehouseReceipts,
  warehouseReturns,
  warehouseReceiptItems,
  ocrJobs,
  type InsertWarehouseReceipt,
  type InsertWarehouseReturn,
  ticketConfirmations,
  type InsertTicketConfirmation,
  deliveryDocuments,
  returnDocuments,
  deliveryNumberCounter,
  itemBarcodeCounter,
  disposalOperations,
  disposalItems,
  disposalNumberCounter,
  poPricingBatches,
  type InsertPOPricingBatch,
  inventoryCountOperations,
  inventoryCountItems,
  inventorySettlements,
  inventorySettlementItems,
  inventoryCountNumberCounter,
  inventorySettlementNumberCounter,
} from "../../../drizzle/schema";
import { ENV } from '../env';


import { getDb } from "./client";

// ============================================================
// TECHNICIAN PERFORMANCE REPORT
// ============================================================
export async function getTechnicianPerformance(filters?: { dateFrom?: Date; dateTo?: Date; siteId?: number; sectionId?: number; technicianName?: string }) {
  const db = await getDb();
  if (!db) return [];

  const dateFrom = filters?.dateFrom;
  const dateTo = filters?.dateTo;
  const siteId = filters?.siteId;
  const sectionId = filters?.sectionId;
  const technicianName = filters?.technicianName?.trim().toLowerCase();

  // Build date condition helper
  const withDateFilter = (baseConditions: any[], dateField: any) => {
    const conds = [...baseConditions];
    if (dateFrom) conds.push(gte(dateField, dateFrom));
    if (dateTo) conds.push(lte(dateField, dateTo));
    return conds;
  };

  // Build site/section condition for tickets
  const siteSecCond = () => {
    const c: any[] = [];
    if (siteId) c.push(eq(tickets.siteId, siteId));
    if (sectionId) c.push(eq(tickets.sectionId, sectionId));
    return c;
  };

  // Get all technicians (filtered by name if provided)
  let techs = await db.select().from(users).where(eq(users.role, "technician" as any));
  if (technicianName) {
    techs = techs.filter(t => (t.name || "").toLowerCase().includes(technicianName));
  }

  const results = [];
  for (const tech of techs) {
    const baseCond = [eq(tickets.assignedToId, tech.id), ...siteSecCond()];
    const dateFilteredCond = withDateFilter(baseCond, tickets.createdAt);

    // Total assigned tickets (within date range)
    const [totalAssigned] = await db.select({ cnt: count() }).from(tickets).where(and(...dateFilteredCond));

    // Completed tickets (repaired, verified, closed) within date range
    const [completed] = await db.select({ cnt: count() }).from(tickets).where(
      and(...dateFilteredCond, or(eq(tickets.status, "repaired"), eq(tickets.status, "verified"), eq(tickets.status, "closed")))
    );

    // In progress tickets within date range
    const [inProgress] = await db.select({ cnt: count() }).from(tickets).where(
      and(...dateFilteredCond, eq(tickets.status, "in_progress"))
    );

    // Closed tickets with resolution time within date range
    const closedCond = withDateFilter([eq(tickets.assignedToId, tech.id), eq(tickets.status, "closed"), ...siteSecCond()], tickets.closedAt);
    const closedTickets = await db.select({
      id: tickets.id,
      createdAt: tickets.createdAt,
      closedAt: tickets.closedAt,
      priority: tickets.priority,
      category: tickets.category,
    }).from(tickets).where(and(...closedCond));

    // Calculate avg resolution time in hours
    let totalHours = 0;
    let resolvedCount = 0;
    const resolutionTimes: number[] = [];
    for (const t of closedTickets) {
      if (t.closedAt && t.createdAt) {
        const hours = (new Date(t.closedAt).getTime() - new Date(t.createdAt).getTime()) / (1000 * 60 * 60);
        totalHours += hours;
        resolvedCount++;
        resolutionTimes.push(hours);
      }
    }
    const avgResolutionHours = resolvedCount > 0 ? totalHours / resolvedCount : 0;
    const minResolutionHours = resolutionTimes.length > 0 ? Math.min(...resolutionTimes) : 0;
    const maxResolutionHours = resolutionTimes.length > 0 ? Math.max(...resolutionTimes) : 0;

    // Tickets by priority (within date range)
    const priorityBreakdown: Record<string, number> = {};
    const allTechTickets = await db.select({ priority: tickets.priority, category: tickets.category }).from(tickets).where(and(...dateFilteredCond));
    allTechTickets.forEach(t => { priorityBreakdown[t.priority] = (priorityBreakdown[t.priority] || 0) + 1; });

    // Tickets by category (within date range)
    const catBreak: Record<string, number> = {};
    allTechTickets.forEach(t => { catBreak[t.category] = (catBreak[t.category] || 0) + 1; });

    // Monthly trend (last 6 months or within date range)
    const monthlyTrend: { month: string; completed: number; assigned: number }[] = [];
    const trendMonths = 6;
    for (let i = trendMonths - 1; i >= 0; i--) {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      const monthStr = d.toISOString().slice(0, 7);
      const monthStart = new Date(d.getFullYear(), d.getMonth(), 1);
      const monthEnd = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59);

      const [assigned] = await db.select({ cnt: count() }).from(tickets).where(
        and(eq(tickets.assignedToId, tech.id), gte(tickets.createdAt, monthStart), lte(tickets.createdAt, monthEnd), ...siteSecCond())
      );
      const [comp] = await db.select({ cnt: count() }).from(tickets).where(
        and(eq(tickets.assignedToId, tech.id), eq(tickets.status, "closed"), gte(tickets.closedAt, monthStart), lte(tickets.closedAt, monthEnd), ...siteSecCond())
      );
      monthlyTrend.push({ month: monthStr, assigned: assigned?.cnt || 0, completed: comp?.cnt || 0 });
    }

    // Completion rate
    const totalAssignedCount = totalAssigned?.cnt || 0;
    const completedCount = completed?.cnt || 0;
    const completionRate = totalAssignedCount > 0 ? Math.round((completedCount / totalAssignedCount) * 100) : 0;

    // Performance score (0-100)
    let score = 0;
    if (totalAssignedCount > 0) {
      const rateScore = completionRate * 0.4;
      const speedScore = avgResolutionHours > 0 ? Math.max(0, (1 - avgResolutionHours / (30 * 24)) * 100) * 0.3 : 0;
      const volumeScore = Math.min(100, totalAssignedCount * 5) * 0.3;
      score = Math.round(rateScore + speedScore + volumeScore);
    }

    results.push({
      technician: { id: tech.id, name: tech.name, email: tech.email, phone: (tech as any).phone, department: (tech as any).department },
      totalAssigned: totalAssignedCount,
      completed: completedCount,
      inProgress: inProgress?.cnt || 0,
      pending: totalAssignedCount - completedCount - (inProgress?.cnt || 0),
      completionRate,
      avgResolutionHours: Math.round(avgResolutionHours * 10) / 10,
      minResolutionHours: Math.round(minResolutionHours * 10) / 10,
      maxResolutionHours: Math.round(maxResolutionHours * 10) / 10,
      priorityBreakdown,
      categoryBreakdown: catBreak,
      monthlyTrend,
      performanceScore: score,
    });
  }

  return results.sort((a, b) => b.performanceScore - a.performanceScore);
}

// ============================================================
// EXTERNAL TECHNICIAN PERFORMANCE
// ============================================================
export async function getExternalTechnicianPerformance(filters?: { dateFrom?: Date; dateTo?: Date }) {
  const db = await getDb();
  if (!db) return [];
  const dateFrom = filters?.dateFrom;
  const dateTo = filters?.dateTo;
  const withDateFilter = (baseConditions: any[], dateField: any) => {
    const conds = [...baseConditions];
    if (dateFrom) conds.push(gte(dateField, dateFrom));
    if (dateTo) conds.push(lte(dateField, dateTo));
    return conds;
  };
  const techs = await db.select().from(technicians);
  const results = [];
  for (const tech of techs) {
    const baseCond = [eq(tickets.assignedTechnicianId, tech.id)];
    const dateFilteredCond = withDateFilter(baseCond, tickets.createdAt);
    const [totalAssigned] = await db.select({ cnt: count() }).from(tickets).where(and(...dateFilteredCond));
    const [completed] = await db.select({ cnt: count() }).from(tickets).where(
      and(...dateFilteredCond, or(eq(tickets.status, "repaired"), eq(tickets.status, "verified"), eq(tickets.status, "closed")))
    );
    const [inProgress] = await db.select({ cnt: count() }).from(tickets).where(
      and(...dateFilteredCond, eq(tickets.status, "in_progress"))
    );
    const closedCond = withDateFilter([eq(tickets.assignedTechnicianId, tech.id), eq(tickets.status, "closed")], tickets.closedAt);
    const closedTickets = await db.select({
      id: tickets.id,
      assignedAt: tickets.assignedAt,
      closedAt: tickets.closedAt,
      priority: tickets.priority,
      category: tickets.category,
    }).from(tickets).where(and(...closedCond));
    let totalHours = 0;
    let resolvedCount = 0;
    const resolutionTimes: number[] = [];
    for (const t of closedTickets) {
      if (t.closedAt && t.assignedAt) {
        const hours = (new Date(t.closedAt).getTime() - new Date(t.assignedAt).getTime()) / (1000 * 60 * 60);
        totalHours += hours;
        resolvedCount++;
        resolutionTimes.push(hours);
      }
    }
    const avgResolutionHours = resolvedCount > 0 ? totalHours / resolvedCount : 0;
    const minResolutionHours = resolutionTimes.length > 0 ? Math.min(...resolutionTimes) : 0;
    const maxResolutionHours = resolutionTimes.length > 0 ? Math.max(...resolutionTimes) : 0;
    const allTechTickets = await db.select({ priority: tickets.priority, category: tickets.category }).from(tickets).where(and(...dateFilteredCond));
    const priorityBreakdown: Record<string, number> = {};
    allTechTickets.forEach(t => { priorityBreakdown[t.priority] = (priorityBreakdown[t.priority] || 0) + 1; });
    const catBreak: Record<string, number> = {};
    allTechTickets.forEach(t => { catBreak[t.category] = (catBreak[t.category] || 0) + 1; });
    const totalAssignedCount = totalAssigned?.cnt || 0;
    const completedCount = completed?.cnt || 0;
    const completionRate = totalAssignedCount > 0 ? Math.round((completedCount / totalAssignedCount) * 100) : 0;
    let score = 0;
    if (totalAssignedCount > 0) {
      const rateScore = completionRate * 0.4;
      const speedScore = avgResolutionHours > 0 ? Math.max(0, (1 - avgResolutionHours / (30 * 24)) * 100) * 0.3 : 0;
      const volumeScore = Math.min(100, totalAssignedCount * 5) * 0.3;
      score = Math.round(rateScore + speedScore + volumeScore);
    }
    results.push({
      technician: { id: tech.id, name: tech.name, email: null, specialty: tech.specialty, status: tech.status, isExternal: true },
      totalAssigned: totalAssignedCount,
      completed: completedCount,
      inProgress: inProgress?.cnt || 0,
      pending: totalAssignedCount - completedCount - (inProgress?.cnt || 0),
      completionRate,
      avgResolutionHours: Math.round(avgResolutionHours * 10) / 10,
      minResolutionHours: Math.round(minResolutionHours * 10) / 10,
      maxResolutionHours: Math.round(maxResolutionHours * 10) / 10,
      priorityBreakdown,
      categoryBreakdown: catBreak,
      performanceScore: score,
    });
  }
  return results.sort((a, b) => b.performanceScore - a.performanceScore);
}
// ============================================================
// DASHBOARD STATS
// ============================================================
export async function getDashboardStats() {
  const db = await getDb();
  if (!db) return null;
  const [openTickets] = await db.select({ cnt: count() }).from(tickets).where(ne(tickets.status, "closed"));
  const [closedToday] = await db.select({ cnt: count() }).from(tickets).where(and(eq(tickets.status, "closed"), gte(tickets.closedAt, sql`CURDATE()`)));
  const [criticalTickets] = await db.select({ cnt: count() }).from(tickets).where(and(eq(tickets.priority, "critical"), ne(tickets.status, "closed")));
  const [pendingPOs] = await db.select({ cnt: count() }).from(purchaseOrders).where(or(eq(purchaseOrders.status, "pending_accounting"), eq(purchaseOrders.status, "pending_management")));
  const [totalCostResult] = await db.select({ total: sum(purchaseOrderItems.actualTotalCost) }).from(purchaseOrderItems).where(or(eq(purchaseOrderItems.status, "delivered_to_warehouse"), eq(purchaseOrderItems.status, "delivered_to_requester")));
  const [pendingItems] = await db.select({ cnt: count() }).from(purchaseOrderItems).where(ne(purchaseOrderItems.status, "purchased"));
  const [purchasedItems] = await db.select({ cnt: count() }).from(purchaseOrderItems).where(eq(purchaseOrderItems.status, "purchased"));
  // New workflow stats
  const [pendingTriageCount] = await db.select({ cnt: count() }).from(tickets).where(eq(tickets.status, "pending_triage"));
  const [underInspectionCount] = await db.select({ cnt: count() }).from(tickets).where(eq(tickets.status, "under_inspection"));
  // 7-day trend: tickets created per day for the last 7 days
  const trend7: number[] = [];
  for (let i = 6; i >= 0; i--) {
    const dayStart = sql`DATE_SUB(CURDATE(), INTERVAL ${i} DAY)`;
    const dayEnd = sql`DATE_SUB(CURDATE(), INTERVAL ${i - 1} DAY)`;
    const [row] = await db.select({ cnt: count() }).from(tickets).where(
      and(gte(tickets.createdAt, dayStart as any), lt(tickets.createdAt, dayEnd as any))
    );
    trend7.push(row?.cnt || 0);
  }
  // SLA breaches: tickets in non-closed status for > 48 hours
  const [slaBreaches] = await db.select({ cnt: count() }).from(tickets).where(
    and(ne(tickets.status, "closed"), lt(tickets.createdAt, sql`DATE_SUB(NOW(), INTERVAL 48 HOUR)` as any))
  );
  return {
    openTickets: openTickets?.cnt || 0,
    closedToday: closedToday?.cnt || 0,
    criticalTickets: criticalTickets?.cnt || 0,
    pendingApprovals: pendingPOs?.cnt || 0,
    totalMaintenanceCost: totalCostResult?.total || "0",
    pendingPurchaseItems: pendingItems?.cnt || 0,
    purchasedItems: purchasedItems?.cnt || 0,
    pendingTriage: pendingTriageCount?.cnt || 0,
    underInspection: underInspectionCount?.cnt || 0,
    trend7,
    slaBreaches: slaBreaches?.cnt || 0,
  };
}


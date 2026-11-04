import { pmv2ExecutionActor, pmv2ExecutionActorCondition, pmv2ExecutionTeamCondition } from "../security/execution-access";
import { and, asc, eq, inArray, or } from "drizzle-orm";
import {
  auditLogs,
  pmv2ItemActions,
  pmv2MaterialPurchaseLinks,
  pmv2MaterialRequestItems,
  pmv2MaterialRequests,
  pmv2TaskItems,
  pmv2TaskTicketLinks,
  pmv2Tasks,
  pmv2Visits,
  purchaseOrderItems,
  poPricingBatches,
  purchaseOrders,
  ticketStatusHistory,
  tickets,
  users,
} from "../../../drizzle/schema";
import { getDb } from "../../_core/db/client";
import { Pmv2TechnicianAccessError } from "../technician/read-service";

type TimelineKind = "work" | "waiting" | "transition" | "completed";

type TimelineEvent = {
  id: string;
  at: string;
  kind: TimelineKind;
  label: string;
  detail: string | null;
  taskItemId: number | null;
  taskItemTitle: string | null;
  roleKey: string | null;
  roleLabel: string | null;
  responsibleUserId: number | null;
  responsibleUserName: string | null;
  actorUserId: number | null;
  actorUserName: string | null;
  source: "pmv2" | "material" | "purchase" | "ticket";
};

type Responsibility = {
  taskItemId: number;
  taskItemTitle: string;
  reason: string;
  stageKey: string;
  stageLabel: string;
  roleKey: string;
  roleLabel: string;
  responsibleUserId: number | null;
  responsibleUserName: string | null;
  since: string | null;
  source: "pmv2" | "material" | "purchase" | "ticket";
  sourceId: number | null;
  sourceNumber: string | null;
};

type TimelineSegment = {
  id: string;
  taskItemId: number;
  taskItemTitle: string;
  stageKey: string;
  stageLabel: string;
  roleKey: string;
  roleLabel: string;
  responsibleUserId: number | null;
  responsibleUserName: string | null;
  startedAt: string;
  endedAt: string | null;
  durationMinutes: number;
  isOpen: boolean;
  source: "pmv2" | "material" | "purchase" | "ticket";
};

const ROLE_LABELS: Record<string, string> = {
  technician: "الفني / فريق الصيانة",
  warehouse: "المستودع",
  maintenance_manager: "مدير الصيانة",
  general_maintenance_manager: "الصيانة العامة والتشغيل",
  construction_procurement_manager: "الإنشاءات",
  purchase_manager: "إدارة المشتريات",
  purchase_requester: "منشئ طلب الشراء",
  delegate: "مندوب المشتريات",
  accountant: "الحسابات",
  senior_management: "الإدارة العليا",
  ticket_team: "قسم البلاغات / الصيانة",
  team: "فريق الصيانة",
};

function roleLabel(roleKey: string) {
  return ROLE_LABELS[roleKey] || roleKey;
}

function asIso(value: unknown): string | null {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toISOString();
}

function epoch(value: unknown): number | null {
  const iso = asIso(value);
  if (!iso) return null;
  const time = new Date(iso).getTime();
  return Number.isFinite(time) ? time : null;
}

function minutesBetween(start: unknown, end: unknown) {
  const a = epoch(start);
  const b = epoch(end);
  if (a == null || b == null || b < a) return 0;
  return Math.max(0, Math.round((b - a) / 60000));
}

function parseJson(value: unknown): any {
  if (value == null) return null;
  if (typeof value === "object") return value;
  if (typeof value !== "string") return null;
  try { return JSON.parse(value); } catch { return null; }
}

function purchaseResponsibility(po: any, item: any): Omit<Responsibility, "taskItemId" | "taskItemTitle" | "reason" | "since" | "source" | "sourceId" | "sourceNumber"> {
  const poStatus = String(po?.status || "");
  const itemStatus = String(item?.status || "");
  if (item?.reviewRole != null) {
    const initialReview = itemStatus === "pending_review" && item.reviewedById == null && item.reviewedAt == null;
    if ((initialReview || item?.delegateChangeRequestedAt) && !["draft", "revision_needed", "closed", "rejected"].includes(poStatus)) {
      const roleKey = String(item.reviewRole);
      return { stageKey: "purchase_review", stageLabel: initialReview ? "بانتظار مراجعة الصنف" : "بانتظار حسم تغيير المندوب", roleKey, roleLabel: roleLabel(roleKey), responsibleUserId: initialReview ? null : Number(item.reviewedById) || null, responsibleUserName: null };
    }
    if (["draft", "revision_needed"].includes(poStatus)) return { stageKey: "purchase_requester", stageLabel: poStatus === "draft" ? "طلب الشراء ما زال مسودة" : "بانتظار تعديل طلب الشراء", roleKey: "purchase_requester", roleLabel: roleLabel("purchase_requester"), responsibleUserId: Number(po?.requestedById) || null, responsibleUserName: null };
    const batchStatus = String(item.pricingBatchStatus || "");
    if (itemStatus === "estimated" && ["pending_accounting", "pending_management"].includes(batchStatus)) {
      const accounting = batchStatus === "pending_accounting", roleKey = accounting ? "accountant" : "senior_management";
      return { stageKey: accounting ? "purchase_accounting" : "purchase_management", stageLabel: accounting ? "بانتظار اعتماد الحسابات" : "بانتظار اعتماد الإدارة العليا", roleKey, roleLabel: roleLabel(roleKey), responsibleUserId: null, responsibleUserName: null };
    }
    if (itemStatus === "pending" || itemStatus === "estimated" && !item.batchId || ["approved", "funded"].includes(itemStatus)) return { stageKey: "purchase_delegate", stageLabel: ["approved", "funded"].includes(itemStatus) ? "بانتظار الشراء من المندوب" : "بانتظار التسعير من المندوب", roleKey: "delegate", roleLabel: roleLabel("delegate"), responsibleUserId: Number(item.delegateId) || null, responsibleUserName: null };
    if (["purchased", "delivered_to_warehouse"].includes(itemStatus)) return { stageKey: "purchase_warehouse_receipt", stageLabel: "تم الشراء — بانتظار استكمال المستودع", roleKey: "warehouse", roleLabel: roleLabel("warehouse"), responsibleUserId: null, responsibleUserName: null };
    return { stageKey: "purchase_workflow", stageLabel: "ضمن دورة المشتريات", roleKey: "purchase_manager", roleLabel: roleLabel("purchase_manager"), responsibleUserId: null, responsibleUserName: null };
  }
  if (poStatus === "pending_accounting") {
    return { stageKey: "purchase_accounting", stageLabel: "بانتظار اعتماد الحسابات", roleKey: "accountant", roleLabel: roleLabel("accountant"), responsibleUserId: null, responsibleUserName: null };
  }
  if (poStatus === "pending_management") {
    return { stageKey: "purchase_management", stageLabel: "بانتظار اعتماد الإدارة العليا", roleKey: "senior_management", roleLabel: roleLabel("senior_management"), responsibleUserId: null, responsibleUserName: null };
  }
  // A newly created PM V2 Purchase is pending_review while its item is still pending.
  // The PO-level review owns that stage; do not attribute it to the delegate early.
  if (poStatus === "pending_review") {
    return { stageKey: "purchase_review", stageLabel: "بانتظار مراجعة طلب الشراء", roleKey: "maintenance_manager", roleLabel: roleLabel("maintenance_manager"), responsibleUserId: null, responsibleUserName: null };
  }
  if (poStatus === "pending_estimate" || itemStatus === "pending" || itemStatus === "estimated" || itemStatus === "approved" || itemStatus === "funded") {
    return { stageKey: "purchase_delegate", stageLabel: itemStatus === "approved" || itemStatus === "funded" ? "بانتظار الشراء من المندوب" : "بانتظار التسعير من المندوب", roleKey: "delegate", roleLabel: roleLabel("delegate"), responsibleUserId: item?.delegateId == null ? null : Number(item.delegateId), responsibleUserName: null };
  }
  if (["purchased", "delivered_to_warehouse"].includes(itemStatus) || ["purchased", "received"].includes(poStatus)) {
    return { stageKey: "purchase_warehouse_receipt", stageLabel: "تم الشراء — بانتظار استكمال المستودع", roleKey: "warehouse", roleLabel: roleLabel("warehouse"), responsibleUserId: null, responsibleUserName: null };
  }
  if (poStatus === "draft" || poStatus === "revision_needed") {
    return { stageKey: "purchase_requester", stageLabel: poStatus === "revision_needed" ? "بانتظار تعديل طلب الشراء" : "طلب الشراء ما زال مسودة", roleKey: "purchase_requester", roleLabel: roleLabel("purchase_requester"), responsibleUserId: po?.requestedById == null ? null : Number(po.requestedById), responsibleUserName: null };
  }
  return { stageKey: "purchase_workflow", stageLabel: "ضمن دورة المشتريات", roleKey: "purchase_manager", roleLabel: roleLabel("purchase_manager"), responsibleUserId: null, responsibleUserName: null };
}

function ticketResponsibility(ticket: any) {
  const status = String(ticket?.status || "");
  if (status === "purchase_pending_accounting") return { stageKey: "ticket_purchase_accounting", stageLabel: "البلاغ بانتظار اعتماد الحسابات", roleKey: "accountant", userId: null as number | null };
  if (status === "purchase_pending_management") return { stageKey: "ticket_purchase_management", stageLabel: "البلاغ بانتظار اعتماد الإدارة العليا", roleKey: "senior_management", userId: null as number | null };
  if (["needs_purchase", "purchase_pending_estimate", "purchase_approved", "partial_purchase", "purchased"].includes(status)) {
    return { stageKey: "ticket_purchase", stageLabel: "البلاغ ضمن دورة المشتريات", roleKey: "purchase_manager", userId: null as number | null };
  }
  if (status === "received_warehouse") return { stageKey: "ticket_warehouse", stageLabel: "البلاغ بانتظار إجراء المستودع", roleKey: "warehouse", userId: null as number | null };
  if (["assigned", "in_progress", "out_for_repair"].includes(status)) {
    return { stageKey: "ticket_execution", stageLabel: "البلاغ لدى المنفذ", roleKey: "ticket_team", userId: ticket?.assignedToId == null ? null : Number(ticket.assignedToId) };
  }
  return { stageKey: "ticket_followup", stageLabel: "بانتظار معالجة البلاغ", roleKey: "ticket_team", userId: ticket?.assignedToId == null ? (ticket?.supervisorId == null ? null : Number(ticket.supervisorId)) : Number(ticket.assignedToId) };
}

function ticketStatusLabel(status: string) {
  const labels: Record<string, string> = {
    new: "جديد",
    pending_triage: "بانتظار الفرز",
    department_planning: "تخطيط الجهات والمهام",
    under_inspection: "تحت المعاينة",
    work_approved: "تم اعتماد العمل",
    ready_for_closure: "جاهز للإغلاق",
    approved: "معتمد",
    assigned: "مسند",
    in_progress: "قيد التنفيذ",
    needs_purchase: "يحتاج شراء",
    purchase_pending_estimate: "بانتظار التسعير",
    purchase_pending_accounting: "بانتظار اعتماد الحسابات",
    purchase_pending_management: "بانتظار اعتماد الإدارة",
    purchase_approved: "تم اعتماد الشراء",
    partial_purchase: "شراء جزئي",
    purchased: "تم الشراء",
    received_warehouse: "تم الاستلام بالمستودع",
    out_for_repair: "خارج للإصلاح",
    repaired: "تم الإصلاح",
    verified: "تم التحقق",
    closed: "مغلق",
    requester_confirmed: "تم تأكيد الإنهاء",
  };
  return labels[status] || status;
}

function stageForEvent(event: TimelineEvent) {
  if (!event.roleKey || event.kind === "completed") return null;
  if (event.source === "pmv2") {
    if (event.label.startsWith("بدأ تنفيذ") || event.label.startsWith("استكمال العمل")) {
      return { stageKey: "technician_execution", stageLabel: event.label };
    }
    return { stageKey: `pmv2_${event.roleKey}`, stageLabel: event.label };
  }
  if (event.source === "material") {
    if (event.label.includes("جاهزة لاستكمال")) return { stageKey: "technician_resume", stageLabel: "المواد جاهزة — بانتظار استكمال الفني" };
    return { stageKey: "warehouse_material", stageLabel: "بانتظار معالجة المواد" };
  }
  if (event.source === "purchase") {
    const byRole: Record<string, { stageKey: string; stageLabel: string }> = {
      maintenance_manager: { stageKey: "purchase_review", stageLabel: "بانتظار مراجعة طلب الشراء" },
      delegate: { stageKey: "purchase_delegate", stageLabel: event.label },
      accountant: { stageKey: "purchase_accounting", stageLabel: "بانتظار اعتماد الحسابات" },
      senior_management: { stageKey: "purchase_management", stageLabel: "بانتظار اعتماد الإدارة العليا" },
      warehouse: { stageKey: "purchase_warehouse", stageLabel: "بانتظار إجراء المستودع بعد الشراء" },
      purchase_requester: { stageKey: "purchase_requester", stageLabel: event.label },
      purchase_manager: { stageKey: "purchase_workflow", stageLabel: event.label },
    };
    return byRole[event.roleKey] || { stageKey: `purchase_${event.roleKey}`, stageLabel: event.label };
  }
  // Ticket statuses may move between several statuses while the same role owns the action.
  // Keep the visible status in the key so the task history preserves those distinct stages.
  const safe = event.label.replace(/[^\p{L}\p{N}]+/gu, "_").slice(0, 80);
  return { stageKey: `ticket_${event.roleKey}_${safe}`, stageLabel: event.label };
}

function purchaseResponsibilitySince(po: any, item: any, responsibility: { stageKey: string }) {
  switch (responsibility.stageKey) {
    case "purchase_review": return item?.reviewRole != null && item?.delegateChangeRequestedAt ? item.delegateChangeRequestedAt : po?.submittedAt || po?.createdAt || null;
    case "purchase_delegate":
      if (String(item?.status || "") === "purchased") return item?.purchasedAt || item?.updatedAt || null;
      return item?.reviewRole != null ? item.reviewedAt || item.updatedAt || po?.updatedAt || null : po?.reviewedAt || item?.updatedAt || po?.updatedAt || null;
    case "purchase_accounting": return item?.updatedAt || po?.updatedAt || null;
    case "purchase_management": return po?.accountingApprovedAt || po?.updatedAt || null;
    case "purchase_warehouse_receipt": return item?.purchasedAt || item?.receivedAt || item?.updatedAt || null;
    case "purchase_requester": return po?.updatedAt || po?.createdAt || null;
    default: return po?.updatedAt || item?.updatedAt || po?.createdAt || null;
  }
}

async function requireDb() {
  const db = await getDb();
  if (!db) throw new Error("تعذر الاتصال بقاعدة البيانات");
  return db;
}

export class Pmv2TaskTimelineService {
  private async buildTimeline(taskId: number, technicianUserId: number | null, enforceTechnicianMembership: boolean) {
    const db = await requireDb();
    const taskRows = enforceTechnicianMembership
      ? await db
          .select({ id: pmv2Tasks.id, taskNumber: pmv2Tasks.taskNumber, status: pmv2Tasks.status, dueDate: pmv2Tasks.dueDate, teamId: pmv2Tasks.teamId })
          .from(pmv2Tasks)
          .innerJoin(pmv2ExecutionActor, pmv2ExecutionActorCondition(Number(technicianUserId)))
          .where(and(pmv2ExecutionTeamCondition(Number(technicianUserId), pmv2Tasks.teamId), eq(pmv2Tasks.id, taskId)))
          .limit(1)
      : await db
          .select({ id: pmv2Tasks.id, taskNumber: pmv2Tasks.taskNumber, status: pmv2Tasks.status, dueDate: pmv2Tasks.dueDate, teamId: pmv2Tasks.teamId })
          .from(pmv2Tasks)
          .where(eq(pmv2Tasks.id, taskId))
          .limit(1);
    const task = taskRows[0];
    if (!task) {
      if (enforceTechnicianMembership) throw new Pmv2TechnicianAccessError();
      throw new Error("مهمة PM V2 غير موجودة");
    }

    const itemRows = await db.select({ id: pmv2TaskItems.id, title: pmv2TaskItems.titleSnapshot, status: pmv2TaskItems.status, result: pmv2TaskItems.result })
      .from(pmv2TaskItems).where(eq(pmv2TaskItems.taskId, taskId)).orderBy(asc(pmv2TaskItems.sortOrderSnapshot), asc(pmv2TaskItems.id));
    const itemIds = itemRows.map((row) => Number(row.id));
    const titleByItem = new Map(itemRows.map((row) => [Number(row.id), String(row.title)]));

    const [actions, visits, requestRows, ticketLinks] = await Promise.all([
      itemIds.length ? db.select({ id: pmv2ItemActions.id, taskItemId: pmv2ItemActions.taskItemId, visitId: pmv2ItemActions.visitId, action: pmv2ItemActions.action, result: pmv2ItemActions.result, note: pmv2ItemActions.note, performedById: pmv2ItemActions.performedById, createdAt: pmv2ItemActions.createdAt })
        .from(pmv2ItemActions).where(inArray(pmv2ItemActions.taskItemId, itemIds)).orderBy(asc(pmv2ItemActions.createdAt), asc(pmv2ItemActions.id)) : [],
      db.select({ id: pmv2Visits.id, startedAt: pmv2Visits.startedAt, endedAt: pmv2Visits.endedAt }).from(pmv2Visits).where(eq(pmv2Visits.taskId, taskId)).orderBy(asc(pmv2Visits.startedAt), asc(pmv2Visits.id)),
      itemIds.length ? db.select({ requestItemId: pmv2MaterialRequestItems.id, requestId: pmv2MaterialRequestItems.requestId, taskItemId: pmv2MaterialRequests.taskItemId, requestedById: pmv2MaterialRequests.requestedById, status: pmv2MaterialRequestItems.status, catalogItemId: pmv2MaterialRequestItems.catalogItemId, itemName: pmv2MaterialRequestItems.itemNameSnapshot, requestedQuantity: pmv2MaterialRequestItems.requestedQuantity, receivedWarehouseQuantity: pmv2MaterialRequestItems.receivedWarehouseQuantity, issuedToTeamQuantity: pmv2MaterialRequestItems.issuedToTeamQuantity, createdAt: pmv2MaterialRequestItems.createdAt, updatedAt: pmv2MaterialRequestItems.updatedAt })
        .from(pmv2MaterialRequestItems).innerJoin(pmv2MaterialRequests, eq(pmv2MaterialRequests.id, pmv2MaterialRequestItems.requestId)).where(inArray(pmv2MaterialRequests.taskItemId, itemIds)).orderBy(asc(pmv2MaterialRequestItems.createdAt), asc(pmv2MaterialRequestItems.id)) : [],
      itemIds.length ? db.select({ taskItemId: pmv2TaskTicketLinks.taskItemId, ticketId: pmv2TaskTicketLinks.ticketId, createdAt: pmv2TaskTicketLinks.createdAt }).from(pmv2TaskTicketLinks).where(inArray(pmv2TaskTicketLinks.taskItemId, itemIds)) : [],
    ]);

    const requestItemIds = requestRows.map((row) => Number(row.requestItemId));
    const purchaseLinks = requestItemIds.length
      ? await db.select({ requestItemId: pmv2MaterialPurchaseLinks.materialRequestItemId, purchaseOrderId: pmv2MaterialPurchaseLinks.purchaseOrderId, purchaseOrderItemId: pmv2MaterialPurchaseLinks.purchaseOrderItemId, createdAt: pmv2MaterialPurchaseLinks.createdAt }).from(pmv2MaterialPurchaseLinks).where(inArray(pmv2MaterialPurchaseLinks.materialRequestItemId, requestItemIds)).orderBy(asc(pmv2MaterialPurchaseLinks.createdAt), asc(pmv2MaterialPurchaseLinks.id))
      : [];
    const poIds = [...new Set(purchaseLinks.map((row) => Number(row.purchaseOrderId)))];
    const poItemIds = [...new Set(purchaseLinks.map((row) => Number(row.purchaseOrderItemId)))];
    const ticketIds = [...new Set(ticketLinks.map((row) => Number(row.ticketId)))];

    const [poRows, poItemRows, ticketRows, ticketHistoryRows, purchaseAuditRows] = await Promise.all([
      poIds.length ? db.select({ id: purchaseOrders.id, poNumber: purchaseOrders.poNumber, status: purchaseOrders.status, requestedById: purchaseOrders.requestedById, reviewedById: purchaseOrders.reviewedById, reviewedAt: purchaseOrders.reviewedAt, accountingApprovedById: purchaseOrders.accountingApprovedById, accountingApprovedAt: purchaseOrders.accountingApprovedAt, managementApprovedById: purchaseOrders.managementApprovedById, managementApprovedAt: purchaseOrders.managementApprovedAt, createdAt: purchaseOrders.createdAt, submittedAt: purchaseOrders.submittedAt, updatedAt: purchaseOrders.updatedAt }).from(purchaseOrders).where(inArray(purchaseOrders.id, poIds)) : [],
      poItemIds.length ? db.select({ id: purchaseOrderItems.id, purchaseOrderId: purchaseOrderItems.purchaseOrderId, itemName: purchaseOrderItems.itemName, status: purchaseOrderItems.status, delegateId: purchaseOrderItems.delegateId, estimatedById: purchaseOrderItems.estimatedById, purchasedById: purchaseOrderItems.purchasedById, createdAt: purchaseOrderItems.createdAt, updatedAt: purchaseOrderItems.updatedAt, purchasedAt: purchaseOrderItems.purchasedAt, receivedAt: purchaseOrderItems.receivedAt,
        reviewRole: purchaseOrderItems.reviewRole, reviewedById: purchaseOrderItems.reviewedById, reviewedAt: purchaseOrderItems.reviewedAt, delegateChangeRequestedAt: purchaseOrderItems.delegateChangeRequestedAt,
        batchId: purchaseOrderItems.batchId, pricingBatchStatus: poPricingBatches.status,
      }).from(purchaseOrderItems).leftJoin(poPricingBatches, eq(poPricingBatches.id, purchaseOrderItems.batchId)).where(inArray(purchaseOrderItems.id, poItemIds)) : [],
      ticketIds.length ? db.select({ id: tickets.id, ticketNumber: tickets.ticketNumber, status: tickets.status, assignedToId: tickets.assignedToId, supervisorId: tickets.supervisorId, createdAt: tickets.createdAt, updatedAt: tickets.updatedAt, closedAt: tickets.closedAt }).from(tickets).where(inArray(tickets.id, ticketIds)) : [],
      ticketIds.length ? db.select({ id: ticketStatusHistory.id, ticketId: ticketStatusHistory.ticketId, fromStatus: ticketStatusHistory.fromStatus, toStatus: ticketStatusHistory.toStatus, changedById: ticketStatusHistory.changedById, notes: ticketStatusHistory.notes, createdAt: ticketStatusHistory.createdAt }).from(ticketStatusHistory).where(inArray(ticketStatusHistory.ticketId, ticketIds)).orderBy(asc(ticketStatusHistory.createdAt), asc(ticketStatusHistory.id)) : [],
      poIds.length || poItemIds.length ? db.select({ id: auditLogs.id, userId: auditLogs.userId, action: auditLogs.action, entityType: auditLogs.entityType, entityId: auditLogs.entityId, oldValues: auditLogs.oldValues, newValues: auditLogs.newValues, createdAt: auditLogs.createdAt }).from(auditLogs).where(or(
        ...(poIds.length ? [and(eq(auditLogs.entityType, "purchase_order"), inArray(auditLogs.entityId, poIds))] : []),
        ...(poItemIds.length ? [and(inArray(auditLogs.entityType, ["po_item", "purchase_order_item"]), inArray(auditLogs.entityId, poItemIds))] : []),
      )).orderBy(asc(auditLogs.createdAt), asc(auditLogs.id)) : [],
    ]);

    const poById = new Map(poRows.map((row) => [Number(row.id), row]));
    const poItemById = new Map(poItemRows.map((row) => [Number(row.id), row]));
    const ticketById = new Map(ticketRows.map((row) => [Number(row.id), row]));
    const purchaseLinksByRequest = new Map<number, typeof purchaseLinks>();
    for (const row of purchaseLinks) {
      const key = Number(row.requestItemId);
      const group = purchaseLinksByRequest.get(key) ?? [];
      group.push(row);
      purchaseLinksByRequest.set(key, group);
    }

    const userIds = new Set<number>();
    if (technicianUserId != null) userIds.add(Number(technicianUserId));
    for (const action of actions) userIds.add(Number(action.performedById));
    for (const row of requestRows) userIds.add(Number(row.requestedById));
    for (const row of poRows) for (const id of [row.requestedById, row.reviewedById, row.accountingApprovedById, row.managementApprovedById]) if (id != null) userIds.add(Number(id));
    for (const row of poItemRows) for (const id of [row.delegateId, row.estimatedById, row.purchasedById, row.reviewedById]) if (id != null) userIds.add(Number(id));
    for (const row of ticketRows) for (const id of [row.assignedToId, row.supervisorId]) if (id != null) userIds.add(Number(id));
    for (const row of ticketHistoryRows) userIds.add(Number(row.changedById));
    for (const row of purchaseAuditRows) if (row.userId != null) userIds.add(Number(row.userId));
    for (const row of purchaseAuditRows) {
      const next = parseJson(row.newValues);
      if (next?.delegateId) userIds.add(Number(next.delegateId));
      if (next?.newDelegateId) userIds.add(Number(next.newDelegateId));
      if (Array.isArray(next?.decisions)) for (const decision of next.decisions) if (decision?.delegateId) userIds.add(Number(decision.delegateId));
    }
    const userRows = userIds.size ? await db.select({ id: users.id, name: users.name, role: users.role }).from(users).where(inArray(users.id, [...userIds])) : [];
    const userById = new Map(userRows.map((row) => [Number(row.id), row]));
    const nameOf = (id: number | null | undefined) => id == null ? null : (userById.get(Number(id))?.name || null);

    const events: TimelineEvent[] = [];
    for (const visit of visits) {
      const startedAt = asIso(visit.startedAt);
      if (startedAt) events.push({ id: `visit-start-${visit.id}`, at: startedAt, kind: "transition", label: "بدأت زيارة للمهمة", detail: `زيارة #${visit.id}`, taskItemId: null, taskItemTitle: null, roleKey: "technician", roleLabel: roleLabel("technician"), responsibleUserId: null, responsibleUserName: null, actorUserId: null, actorUserName: null, source: "pmv2" });
      const endedAt = asIso(visit.endedAt);
      if (endedAt) events.push({ id: `visit-end-${visit.id}`, at: endedAt, kind: "transition", label: "انتهت زيارة المهمة", detail: `زيارة #${visit.id}`, taskItemId: null, taskItemTitle: null, roleKey: null, roleLabel: null, responsibleUserId: null, responsibleUserName: null, actorUserId: null, actorUserName: null, source: "pmv2" });
    }

    for (const action of actions) {
      const at = asIso(action.createdAt); if (!at) continue;
      const itemId = Number(action.taskItemId); const title = titleByItem.get(itemId) || null;
      const actorId = Number(action.performedById); const actorName = nameOf(actorId);
      if (action.action === "start_execution") {
        events.push({ id: `action-${action.id}`, at, kind: "work", label: `بدأ تنفيذ البند: ${title || itemId}`, detail: null, taskItemId: itemId, taskItemTitle: title, roleKey: "technician", roleLabel: roleLabel("technician"), responsibleUserId: actorId, responsibleUserName: actorName, actorUserId: actorId, actorUserName: actorName, source: "pmv2" });
      } else if (action.action === "resume_execution") {
        events.push({ id: `action-${action.id}`, at, kind: "work", label: `استكمال العمل على البند: ${title || itemId}`, detail: "استكمال لنفس المهمة بعد زوال سبب التعليق", taskItemId: itemId, taskItemTitle: title, roleKey: "technician", roleLabel: roleLabel("technician"), responsibleUserId: actorId, responsibleUserName: actorName, actorUserId: actorId, actorUserName: actorName, source: "pmv2" });
      } else if (action.action === "submit_result" && action.result === "needs_material") {
        events.push({ id: `action-${action.id}`, at, kind: "waiting", label: `توقف البند لاحتياج مواد: ${title || itemId}`, detail: action.note || null, taskItemId: itemId, taskItemTitle: title, roleKey: "warehouse", roleLabel: roleLabel("warehouse"), responsibleUserId: null, responsibleUserName: null, actorUserId: actorId, actorUserName: actorName, source: "material" });
      } else if (action.action === "submit_result" && action.result === "needs_ticket") {
        events.push({ id: `action-${action.id}`, at, kind: "waiting", label: `توقف البند لاحتياج بلاغ: ${title || itemId}`, detail: action.note || null, taskItemId: itemId, taskItemTitle: title, roleKey: "ticket_team", roleLabel: roleLabel("ticket_team"), responsibleUserId: null, responsibleUserName: null, actorUserId: actorId, actorUserName: actorName, source: "ticket" });
      } else if (action.action === "submit_result" && (action.result === "fixed" || action.result === "ok")) {
        events.push({ id: `action-${action.id}`, at, kind: "completed", label: `اكتمل البند: ${title || itemId}`, detail: action.note || null, taskItemId: itemId, taskItemTitle: title, roleKey: null, roleLabel: null, responsibleUserId: null, responsibleUserName: null, actorUserId: actorId, actorUserName: actorName, source: "pmv2" });
      } else if (action.action === "ticket_closed_completion") {
        events.push({ id: `action-${action.id}`, at, kind: "completed", label: `اكتمل البند بعد إغلاق البلاغ: ${title || itemId}`, detail: action.note || null, taskItemId: itemId, taskItemTitle: title, roleKey: null, roleLabel: null, responsibleUserId: null, responsibleUserName: null, actorUserId: actorId, actorUserName: actorName, source: "ticket" });
      } else if (action.action === "material_issue_linked") {
        const note = parseJson(action.note);
        const recipientId = note?.recipientUserId == null ? null : Number(note.recipientUserId);
        events.push({ id: `action-${action.id}`, at, kind: "transition", label: `المواد أصبحت جاهزة لاستكمال البند: ${title || itemId}`, detail: note?.deliveryNumber ? `سند الصرف ${note.deliveryNumber}` : null, taskItemId: itemId, taskItemTitle: title, roleKey: "technician", roleLabel: roleLabel("technician"), responsibleUserId: recipientId, responsibleUserName: nameOf(recipientId), actorUserId: actorId, actorUserName: actorName, source: "material" });
      }
    }

    for (const request of requestRows) {
      const at = asIso(request.createdAt); if (!at) continue;
      const itemId = Number(request.taskItemId); const title = titleByItem.get(itemId) || null;
      events.push({ id: `material-request-${request.requestItemId}`, at, kind: "waiting", label: `تم إنشاء طلب مواد للبند: ${title || itemId}`, detail: `${request.itemName} — الكمية ${Number(request.requestedQuantity || 0)}`, taskItemId: itemId, taskItemTitle: title, roleKey: "warehouse", roleLabel: roleLabel("warehouse"), responsibleUserId: null, responsibleUserName: null, actorUserId: Number(request.requestedById), actorUserName: nameOf(Number(request.requestedById)), source: "material" });
    }

    const requestById = new Map(requestRows.map((row) => [Number(row.requestItemId), row]));
    for (const link of purchaseLinks) {
      const request = requestById.get(Number(link.requestItemId));
      const po = poById.get(Number(link.purchaseOrderId));
      const item = poItemById.get(Number(link.purchaseOrderItemId));
      const at = asIso(link.createdAt); if (!at || !request) continue;
      // Atomic PM V2 purchase creation always creates the PO as pending_review.
      // Historical timeline must therefore start at maintenance review rather than
      // projecting today's later PO status backwards onto the creation timestamp.
      const initialRole = item?.reviewRole || "maintenance_manager";
      events.push({ id: `purchase-link-${link.purchaseOrderItemId}`, at, kind: "waiting", label: `تم إنشاء طلب الشراء — بانتظار المراجعة`, detail: po?.poNumber ? `طلب الشراء ${po.poNumber} — ${item?.itemName || request.itemName}` : (item?.itemName || request.itemName), taskItemId: Number(request.taskItemId), taskItemTitle: titleByItem.get(Number(request.taskItemId)) || null, roleKey: initialRole, roleLabel: roleLabel(initialRole), responsibleUserId: null, responsibleUserName: null, actorUserId: null, actorUserName: null, source: "purchase" });
    }

    const auditToItem = new Map<number, number>();
    for (const link of purchaseLinks) {
      const request = requestById.get(Number(link.requestItemId));
      if (request) auditToItem.set(Number(link.purchaseOrderItemId), Number(request.taskItemId));
    }
    const auditToTaskItemByPo = new Map<number, number>();
    for (const link of purchaseLinks) {
      const request = requestById.get(Number(link.requestItemId));
      if (request && !auditToTaskItemByPo.has(Number(link.purchaseOrderId))) auditToTaskItemByPo.set(Number(link.purchaseOrderId), Number(request.taskItemId));
    }

    for (const log of purchaseAuditRows) {
      const at = asIso(log.createdAt); if (!at) continue;
      const entityId = Number(log.entityId || 0);
      const decisionLog = parseJson(log.newValues);
      if (log.action === "review_po_items" && decisionLog?.routedReview === true) {
        for (const decision of Array.isArray(decisionLog.decisions) ? decisionLog.decisions : []) {
          const reviewedItem = poItemById.get(Number(decision.id)), taskItemId = auditToItem.get(Number(decision.id));
          if (!reviewedItem || Number(reviewedItem.purchaseOrderId) !== entityId || !taskItemId) continue;
          const accepted = decision.action === "approve", roleKey = accepted ? "delegate" : String(reviewedItem.reviewRole || "maintenance_manager");
          const recipientId = accepted ? Number(decision.delegateId) || null : null;
          events.push({ id: `purchase-audit-${log.id}-item-${decision.id}`, at, kind: accepted ? "waiting" : "transition", label: accepted ? "تمت مراجعة الصنف — بانتظار المندوب" : "تم رفض الصنف أثناء المراجعة", detail: reviewedItem.itemName, taskItemId, taskItemTitle: titleByItem.get(taskItemId) || null,
            roleKey, roleLabel: roleLabel(roleKey), responsibleUserId: recipientId, responsibleUserName: nameOf(recipientId), actorUserId: log.userId == null ? null : Number(log.userId), actorUserName: nameOf(log.userId), source: "purchase" });
        }
        continue;
      }
      const itemId = log.entityType === "purchase_order" ? auditToTaskItemByPo.get(entityId) : auditToItem.get(entityId);
      if (!itemId) continue;
      const title = titleByItem.get(itemId) || null;
      const actorId = log.userId == null ? null : Number(log.userId);
      const actorName = nameOf(actorId);
      let stage: { label: string; roleKey: string; userId?: number | null } | null = null;
      if (log.action === "review_po_items") {
        // The audit row does not persist the assignee snapshot. Keep historical ownership
        // role-only rather than projecting today's delegate backwards in time.
        stage = { label: "تمت مراجعة طلب الشراء — بانتظار المندوب", roleKey: "delegate", userId: null };
      } else if (log.action === "submit_pricing_batch") stage = { label: "أرسل المندوب التسعير — بانتظار الحسابات", roleKey: "accountant" };
      else if (log.action === "approve_accounting") stage = { label: "اعتمدت الحسابات — بانتظار الإدارة العليا", roleKey: "senior_management" };
      else if (log.action === "approve_management") {
        stage = { label: "تم اعتماد الشراء — بانتظار المندوب", roleKey: "delegate", userId: null };
      } else if (log.action === "confirm_purchase") stage = { label: "أكد المندوب الشراء — بانتظار المستودع", roleKey: "warehouse" };
      else if (log.action === "deliver_to_warehouse") stage = { label: "تم تسجيل وصول الصنف للمستودع", roleKey: "warehouse" };
      else if (log.action === "request_po_item_delegate_change") {
        const sourceItem = poItemById.get(entityId);
        stage = sourceItem?.reviewRole != null ? { label: "طلب تغيير المندوب — بانتظار مراجع الصنف", roleKey: String(sourceItem.reviewRole), userId: sourceItem.reviewedById } : { label: "طلب تغيير المندوب — بانتظار مدير الصيانة", roleKey: "maintenance_manager" };
      }
      else if (log.action === "resolve_po_item_delegate_change") {
        const next = parseJson(log.newValues);
        stage = { label: "تم حسم تغيير المندوب", roleKey: "delegate", userId: next?.delegateId || next?.newDelegateId || null };
      }
      if (!stage) continue;
      const responsibleId = stage.userId == null ? null : Number(stage.userId);
      events.push({ id: `purchase-audit-${log.id}`, at, kind: "waiting", label: stage.label, detail: null, taskItemId: itemId, taskItemTitle: title, roleKey: stage.roleKey, roleLabel: roleLabel(stage.roleKey), responsibleUserId: responsibleId, responsibleUserName: nameOf(responsibleId), actorUserId: actorId, actorUserName: actorName, source: "purchase" });
    }

    const ticketLinkById = new Map(ticketLinks.map((row) => [Number(row.ticketId), row]));
    for (const history of ticketHistoryRows) {
      const link = ticketLinkById.get(Number(history.ticketId)); if (!link) continue;
      const ticket = ticketById.get(Number(history.ticketId));
      const at = asIso(history.createdAt); if (!at) continue;
      // ticket_status_history records the status transition and actor, but not an assignee
      // snapshot. Keep historical responsibility role-only; current responsibility below
      // uses the live Ticket assignee/supervisor as the source of truth.
      const resp = ticketResponsibility({ status: history.toStatus, assignedToId: null, supervisorId: null });
      const responsibleId = resp.userId == null ? null : Number(resp.userId);
      const actorId = Number(history.changedById);
      events.push({ id: `ticket-history-${history.id}`, at, kind: history.toStatus === "closed" || history.toStatus === "requester_confirmed" ? "transition" : "waiting", label: `البلاغ ${ticket?.ticketNumber || history.ticketId}: ${ticketStatusLabel(String(history.toStatus))}`, detail: history.notes || null, taskItemId: Number(link.taskItemId), taskItemTitle: titleByItem.get(Number(link.taskItemId)) || null, roleKey: resp.roleKey, roleLabel: roleLabel(resp.roleKey), responsibleUserId: responsibleId, responsibleUserName: nameOf(responsibleId), actorUserId: actorId, actorUserName: nameOf(actorId), source: "ticket" });
    }

    events.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime() || a.id.localeCompare(b.id));

    const now = new Date();
    const actionGroups = new Map<number, typeof actions>();
    for (const action of actions) {
      const key = Number(action.taskItemId); const group = actionGroups.get(key) ?? []; group.push(action); actionGroups.set(key, group);
    }
    let actualWorkMinutes = 0;
    let waitingMaterialMinutes = 0;
    let waitingTicketMinutes = 0;
    let waitingResumeMinutes = 0;
    for (const [itemId, group] of actionGroups) {
      let activeStart: any = null;
      let materialWaitStart: any = null;
      let materialReadyAt: any = null;
      let ticketWaitStart: any = null;
      for (const action of group) {
        if ((action.action === "start_execution" || action.action === "resume_execution") && !activeStart) {
          activeStart = action.createdAt;
          if (action.action === "resume_execution" && materialWaitStart && materialReadyAt) {
            waitingMaterialMinutes += minutesBetween(materialWaitStart, materialReadyAt);
            waitingResumeMinutes += minutesBetween(materialReadyAt, action.createdAt);
            materialWaitStart = null;
            materialReadyAt = null;
          }
        }
        if (action.action === "submit_result") {
          if (activeStart) { actualWorkMinutes += minutesBetween(activeStart, action.createdAt); activeStart = null; }
          if (action.result === "needs_material") materialWaitStart = action.createdAt;
          if (action.result === "needs_ticket") ticketWaitStart = action.createdAt;
          if ((action.result === "fixed" || action.result === "ok") && ticketWaitStart) {
            waitingTicketMinutes += minutesBetween(ticketWaitStart, action.createdAt); ticketWaitStart = null;
          }
          if ((action.result === "fixed" || action.result === "ok") && materialWaitStart && materialReadyAt) {
            waitingMaterialMinutes += minutesBetween(materialWaitStart, materialReadyAt);
            waitingResumeMinutes += minutesBetween(materialReadyAt, action.createdAt);
            materialWaitStart = null;
            materialReadyAt = null;
          }
        }
        if (action.action === "ticket_closed_completion" && ticketWaitStart) {
          waitingTicketMinutes += minutesBetween(ticketWaitStart, action.createdAt);
          ticketWaitStart = null;
        }
        if (action.action === "material_issue_linked" && materialWaitStart) {
          if (!materialReadyAt || Number(action.id) > 0) materialReadyAt = action.createdAt;
        }
      }
      const item = itemRows.find((row) => Number(row.id) === itemId);
      if (activeStart) actualWorkMinutes += minutesBetween(activeStart, now);
      if (materialWaitStart) {
        if (materialReadyAt) waitingMaterialMinutes += minutesBetween(materialWaitStart, materialReadyAt);
        else waitingMaterialMinutes += minutesBetween(materialWaitStart, now);
      }
      if (materialReadyAt && item?.status === "ready_to_complete") waitingResumeMinutes += minutesBetween(materialReadyAt, now);
      if (ticketWaitStart && item?.status === "waiting_ticket") waitingTicketMinutes += minutesBetween(ticketWaitStart, now);
    }

    const responsibilities: Responsibility[] = [];
    const latestActionByItem = new Map<number, any>();
    for (const action of actions) latestActionByItem.set(Number(action.taskItemId), action);
    const requestByTaskItem = new Map<number, typeof requestRows>();
    for (const request of requestRows) {
      const key = Number(request.taskItemId); const group = requestByTaskItem.get(key) ?? []; group.push(request); requestByTaskItem.set(key, group);
    }
    const ticketLinkByTaskItem = new Map(ticketLinks.map((row) => [Number(row.taskItemId), row]));

    for (const item of itemRows) {
      const itemId = Number(item.id); const title = String(item.title);
      if (item.status === "waiting_material") {
        const requests = requestByTaskItem.get(itemId) ?? [];
        const activeRequest = [...requests].reverse().find((row) => !["consumed", "cancelled", "issued_to_team"].includes(String(row.status))) || [...requests].reverse()[0];
        // Patch 115+ intentionally keeps the PM V2 material request as the shortage record
        // while Purchase owns its own workflow. Therefore the durable purchase link, not a
        // copied PM V2 request status, is the source of truth that the shortage entered Purchase.
        const links = activeRequest ? (purchaseLinksByRequest.get(Number(activeRequest.requestItemId)) ?? []) : [];
        const link = [...links].reverse()[0];
        if (link) {
          const po = poById.get(Number(link.purchaseOrderId));
          const poItem = poItemById.get(Number(link.purchaseOrderItemId));
          const resp = purchaseResponsibility(po, poItem);
          responsibilities.push({ taskItemId: itemId, taskItemTitle: title, reason: "بانتظار مواد", stageKey: resp.stageKey, stageLabel: resp.stageLabel, roleKey: resp.roleKey, roleLabel: resp.roleLabel, responsibleUserId: resp.responsibleUserId, responsibleUserName: nameOf(resp.responsibleUserId), since: asIso(purchaseResponsibilitySince(po, poItem, resp) || link.createdAt || activeRequest?.updatedAt || activeRequest?.createdAt), source: "purchase", sourceId: po ? Number(po.id) : null, sourceNumber: po?.poNumber ? String(po.poNumber) : null });
        } else {
          const stageLabel = activeRequest?.catalogItemId == null ? "بانتظار تعريف المادة ومعالجة المستودع" : activeRequest?.status === "received_warehouse" ? "المادة وصلت للرئيسي — بانتظار التحويل/الصرف" : "بانتظار معالجة المستودع";
          responsibilities.push({ taskItemId: itemId, taskItemTitle: title, reason: "بانتظار مواد", stageKey: "warehouse_material", stageLabel, roleKey: "warehouse", roleLabel: roleLabel("warehouse"), responsibleUserId: null, responsibleUserName: null, since: asIso(activeRequest?.updatedAt || activeRequest?.createdAt || latestActionByItem.get(itemId)?.createdAt), source: "material", sourceId: activeRequest ? Number(activeRequest.requestItemId) : null, sourceNumber: null });
        }
      } else if (item.status === "waiting_ticket") {
        const link = ticketLinkByTaskItem.get(itemId); const ticket = link ? ticketById.get(Number(link.ticketId)) : null;
        const resp = ticketResponsibility(ticket);
        const respId = resp.userId == null ? null : Number(resp.userId);
        responsibilities.push({ taskItemId: itemId, taskItemTitle: title, reason: "بانتظار البلاغ", stageKey: resp.stageKey, stageLabel: resp.stageLabel, roleKey: resp.roleKey, roleLabel: roleLabel(resp.roleKey), responsibleUserId: respId, responsibleUserName: nameOf(respId), since: asIso(ticket?.updatedAt || link?.createdAt || latestActionByItem.get(itemId)?.createdAt), source: "ticket", sourceId: ticket ? Number(ticket.id) : null, sourceNumber: ticket?.ticketNumber ? String(ticket.ticketNumber) : null });
      } else if (item.status === "ready_to_complete") {
        const latestMaterialIssue = [...actions].reverse().find((action) => Number(action.taskItemId) === itemId && action.action === "material_issue_linked");
        const requesterId = (requestByTaskItem.get(itemId) ?? [])[0]?.requestedById;
        responsibilities.push({ taskItemId: itemId, taskItemTitle: title, reason: "جاهز للاستكمال", stageKey: "technician_resume", stageLabel: "المواد جاهزة — بانتظار استكمال الفني", roleKey: "technician", roleLabel: roleLabel("technician"), responsibleUserId: requesterId == null ? null : Number(requesterId), responsibleUserName: nameOf(requesterId == null ? null : Number(requesterId)), since: asIso(latestMaterialIssue?.createdAt || latestActionByItem.get(itemId)?.createdAt), source: "pmv2", sourceId: itemId, sourceNumber: null });
      } else if (item.status === "in_progress") {
        const latest = latestActionByItem.get(itemId);
        const responsibleId = latest?.performedById == null ? null : Number(latest.performedById);
        responsibilities.push({ taskItemId: itemId, taskItemTitle: title, reason: "قيد التنفيذ", stageKey: "technician_execution", stageLabel: item.result === "needs_material" ? "استكمال العمل بعد وصول المواد" : "قيد تنفيذ الفني", roleKey: "technician", roleLabel: roleLabel("technician"), responsibleUserId: responsibleId, responsibleUserName: nameOf(responsibleId), since: asIso(latest?.createdAt), source: "pmv2", sourceId: itemId, sourceNumber: null });
      } else if (item.status === "pending") {
        responsibilities.push({ taskItemId: itemId, taskItemTitle: title, reason: "بانتظار البدء", stageKey: "team_pending", stageLabel: "بانتظار بدء فريق الصيانة", roleKey: "team", roleLabel: roleLabel("team"), responsibleUserId: null, responsibleUserName: null, since: null, source: "pmv2", sourceId: itemId, sourceNumber: null });
      }
    }

    responsibilities.sort((a, b) => (epoch(a.since) ?? Number.MAX_SAFE_INTEGER) - (epoch(b.since) ?? Number.MAX_SAFE_INTEGER));
    const firstStart = actions.find((row) => row.action === "start_execution" || row.action === "resume_execution")?.createdAt || visits[0]?.startedAt || null;
    const completedAt = task.status === "completed"
      ? [...actions].reverse().find((row) => (row.action === "submit_result" && (row.result === "fixed" || row.result === "ok")) || row.action === "ticket_closed_completion")?.createdAt || visits[visits.length - 1]?.endedAt || null
      : null;
    const endForAge = completedAt || now;

    // Build elapsed stage segments per Task Item from the same source-of-truth events.
    // No external workflow state is copied or mutated; this is a derived PM V2 view.
    const stageSegments: TimelineSegment[] = [];
    for (const item of itemRows) {
      const itemId = Number(item.id);
      const title = String(item.title);
      const itemEvents = events.filter((event) => event.taskItemId === itemId).sort((a, b) => epoch(a.at)! - epoch(b.at)!);
      const boundaries: Array<{ at: string; stageKey: string; stageLabel: string; roleKey: string; roleLabel: string; responsibleUserId: number | null; responsibleUserName: string | null; source: TimelineSegment["source"] }> = [];

      for (const event of itemEvents) {
        const stage = stageForEvent(event);
        if (!stage || !event.roleKey || !event.roleLabel) continue;
        const candidate = {
          at: event.at, stageKey: stage.stageKey, stageLabel: stage.stageLabel,
          roleKey: event.roleKey, roleLabel: event.roleLabel,
          responsibleUserId: event.responsibleUserId, responsibleUserName: event.responsibleUserName,
          source: event.source,
        };
        const previous = boundaries[boundaries.length - 1];
        if (previous && previous.stageKey === candidate.stageKey && previous.roleKey === candidate.roleKey && previous.responsibleUserId === candidate.responsibleUserId) {
          continue;
        }
        boundaries.push(candidate);
      }

      const current = responsibilities.find((row) => row.taskItemId === itemId);
      if (current?.since) {
        const currentAt = current.since;
        const latest = boundaries[boundaries.length - 1];
        if (!latest || latest.stageKey !== current.stageKey || latest.roleKey !== current.roleKey || latest.responsibleUserId !== current.responsibleUserId) {
          boundaries.push({
            at: currentAt, stageKey: current.stageKey, stageLabel: current.stageLabel,
            roleKey: current.roleKey, roleLabel: current.roleLabel, responsibleUserId: current.responsibleUserId,
            responsibleUserName: current.responsibleUserName, source: current.source,
          });
          boundaries.sort((a, b) => (epoch(a.at) ?? 0) - (epoch(b.at) ?? 0));
        }
      }

      const completedBoundary = [...itemEvents].reverse().find((event) => event.kind === "completed")?.at || null;
      for (let index = 0; index < boundaries.length; index += 1) {
        const boundary = boundaries[index];
        const next = boundaries[index + 1];
        let endedAt: string | null = next?.at || null;
        if (!endedAt && completedBoundary && (epoch(completedBoundary) ?? 0) >= (epoch(boundary.at) ?? 0)) endedAt = completedBoundary;
        const isOpen = !endedAt && current != null && current.stageKey === boundary.stageKey && current.roleKey === boundary.roleKey && current.responsibleUserId === boundary.responsibleUserId;
        const durationEnd = endedAt || (isOpen ? now : boundary.at);
        stageSegments.push({
          id: `segment-${itemId}-${index + 1}`, taskItemId: itemId, taskItemTitle: title,
          stageKey: boundary.stageKey, stageLabel: boundary.stageLabel, roleKey: boundary.roleKey, roleLabel: boundary.roleLabel,
          responsibleUserId: boundary.responsibleUserId, responsibleUserName: boundary.responsibleUserName,
          startedAt: boundary.at, endedAt, durationMinutes: minutesBetween(boundary.at, durationEnd), isOpen, source: boundary.source,
        });
      }
    }
    stageSegments.sort((a, b) => (epoch(a.startedAt) ?? 0) - (epoch(b.startedAt) ?? 0));

    const responsibilityDurations = [...stageSegments.reduce((map, segment) => {
      const key = `${segment.roleKey}:${segment.responsibleUserId ?? "role"}`;
      const existing = map.get(key) || { roleKey: segment.roleKey, roleLabel: segment.roleLabel, responsibleUserId: segment.responsibleUserId, responsibleUserName: segment.responsibleUserName, durationMinutes: 0 };
      existing.durationMinutes += segment.durationMinutes;
      map.set(key, existing);
      return map;
    }, new Map<string, { roleKey: string; roleLabel: string; responsibleUserId: number | null; responsibleUserName: string | null; durationMinutes: number }>()).values()]
      .sort((a, b) => b.durationMinutes - a.durationMinutes);

    return {
      task: { id: Number(task.id), taskNumber: String(task.taskNumber), status: String(task.status), dueDate: String(task.dueDate) },
      summary: {
        startedAt: asIso(firstStart),
        endedAt: asIso(completedAt),
        totalAgeMinutes: firstStart ? minutesBetween(firstStart, endForAge) : 0,
        actualWorkMinutes,
        waitingMaterialMinutes,
        waitingTicketMinutes,
        waitingResumeMinutes,
        currentResponsibility: responsibilities[0] ?? null,
        openResponsibilityCount: responsibilities.length,
      },
      responsibilities,
      stageSegments,
      responsibilityDurations,
      events,
    };
  }

  async getForTechnician(userId: number, taskId: number) {
    return this.buildTimeline(taskId, userId, true);
  }

  async getForManagement(taskId: number) {
    return this.buildTimeline(taskId, null, false);
  }
}

export const pmv2TaskTimelineService = new Pmv2TaskTimelineService();

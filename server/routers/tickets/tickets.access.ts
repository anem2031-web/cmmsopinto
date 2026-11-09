import { isItTeamRole, isTicketReporterRole } from "@shared/roles";
import { TRPCError } from "@trpc/server";
import {
  APP_ROLE,
  MAINTENANCE_INSPECTION_WORKFLOW_STATUS,
  MAINTENANCE_RESPONSIBLE_DEPARTMENT,
} from "@shared/roles";
import * as db from "../../_core/db";

const ROLES_DENIED_FROM_TICKETS = [
  APP_ROLE.GATE_SECURITY,
  APP_ROLE.ACCOUNTANT,
  APP_ROLE.PURCHASE_MANAGER,
  APP_ROLE.WAREHOUSE,
  APP_ROLE.FOOD_WAREHOUSE_MANAGER,
  APP_ROLE.FOOD_WAREHOUSE_ASSISTANT,
];

const ASSIGNEE_SCOPED_ROLES = [APP_ROLE.TECHNICIAN];

export interface TicketAccessUser {
  id: number;
  role: string;
}

/** A read-list can supply a preloaded scope; writes keep the fresh DB default. */
export interface TicketReadPort {
  getTicketItems(ticketId: number): Promise<any[]>;
  hasTicketDepartmentAssignment(ticketId: number, department: string, managerId?: number): Promise<boolean>;
  hasPurchaseOrderForTicket(ticketId: number): Promise<boolean>;
  isUserAssignedToTicketTasks(ticketId: number, sourceTaskId: number | null | undefined, userId: number): Promise<boolean>;
}

export interface TicketVisibilitySubject {
  id?: number;
  status?: string | null;
  reportedById: number | null;
  assignedToId: number | null;
  assignedTechnicianId?: number | null;
  maintenanceResponsibleDepartment?: string | null;
  maintenanceResponsibleManagerId?: number | null;
  inspectionWorkflowStatus?: string | null;
  workflowModel?: string | null;
  sourceTaskId?: number | null;
}

/**
 * بند من بنود البلاغ (ticket_items) — الحقول الأربعة اللازمة لفحص الرؤية فقط.
 * راجع القاعدة الحرجة #12 بـCLAUDE.md: بنود البلاغ مصدر حقيقة إضافي للرؤية،
 * لا بديل لعمود البلاغ (الذي يبقى يمثّل "الجهة الرئيسية" ويُفحص أولًا كمسار سريع).
 */
export interface TicketItemVisibilitySubject {
  responsibleDepartment?: string | null;
  responsibleManagerId?: number | null;
  assignedToId?: number | null;
  assignedTechnicianId?: number | null;
}

export function isRoleDeniedFromTickets(role: string): boolean {
  return ROLES_DENIED_FROM_TICKETS.includes(role as any);
}

export function isConstructionTicketAssignedToUser(
  user: TicketAccessUser,
  ticket: TicketVisibilitySubject,
  items?: TicketItemVisibilitySubject[],
): boolean {
  if (user.role !== APP_ROLE.CONSTRUCTION_PROCUREMENT_MANAGER) return false;

  const ticketLevelMatch =
    ticket.maintenanceResponsibleDepartment === MAINTENANCE_RESPONSIBLE_DEPARTMENT.CONSTRUCTION &&
    ticket.maintenanceResponsibleManagerId === user.id;
  if (ticketLevelMatch) return true;

  // بند ثانوي بالفرز المتعدد قد يوجّه هذا المستخدم دون أن يكون "الجهة الرئيسية"
  // المنعكسة بعمود البلاغ — يُفحص فقط إن مُرِّرت البنود (المسار البطيء).
  if (!items) return false;
  return items.some((i) =>
    i.responsibleDepartment === MAINTENANCE_RESPONSIBLE_DEPARTMENT.CONSTRUCTION &&
    i.responsibleManagerId === user.id
  );
}

/**
 * Visibility used by ticket lists and normal ticket detail access.
 * Construction/procurement managers see only construction tickets explicitly routed to them.
 * Their separate linked-purchase exception is handled by assertTicketReadable().
 *
 * ⚠️ 2026-08-08: يقبل `items` اختياريًا (بنود البلاغ). المسار السريع (بلا `items`) يفحص عمود
 * البلاغ فقط — يكفي لأي بلاغ أحادي البند (كل البلاغات القديمة + أي بلاغ فُرز جهة واحدة).
 * المسار الكامل (مع `items`) يُستدعى فقط عند فشل المسار السريع — راجع assertTicketReadable.
 */
export function isTicketVisible(
  user: TicketAccessUser,
  ticket: TicketVisibilitySubject,
  items?: TicketItemVisibilitySubject[],
): boolean {
  if (isRoleDeniedFromTickets(user.role)) return false;

  // ⚠️ 2026-08-13: مدير الإنشاءات والمشتريات يرى الآن كل البلاغات — قرار صريح
  // من صاحب المشروع (استعراض فقط لما هو خارج جهته). لم يعد لدوره فرع خاص هنا؛
  // يسقط إلى `return true` بنهاية الدالة كبقية الأدوار غير المقيَّدة.
  // **القراءة فقط لما هو خارج نطاقه مطبَّقة مسبقًا وبلا تغيير** عبر
  // isTicketReadOnlyForUser (تمنع أزرار التعديل بالواجهة) وعبر
  // canManageTicketWorkflow/canManageTicketItemWorkflow (يرفضان أي محاولة
  // تعديل فعلية بالسيرفر حتى لو استُدعي الإجراء مباشرة). لا تُعِد تضييق هذه
  // الرؤية بدون تحديث الحراس الثلاثة معًا — راجع
  // docs/CONSTRUCTION_MANAGER_TICKET_READ_ACCESS.md.

  if (isItTeamRole(user.role)) {
    if (ticket.maintenanceResponsibleDepartment === MAINTENANCE_RESPONSIBLE_DEPARTMENT.IT) return true;
    if (items?.some(i => i.responsibleDepartment === MAINTENANCE_RESPONSIBLE_DEPARTMENT.IT)) return true;
    if (ticket.reportedById === user.id) return true;
    if (ticket.assignedToId === user.id) return true;
    if (
      ticket.maintenanceResponsibleDepartment === MAINTENANCE_RESPONSIBLE_DEPARTMENT.IT &&
      ticket.maintenanceResponsibleManagerId === user.id
    ) return true;
    if (!items) return false;
    return items.some((i) =>
      i.assignedToId === user.id ||
      (i.responsibleDepartment === MAINTENANCE_RESPONSIBLE_DEPARTMENT.IT && i.responsibleManagerId === user.id)
    );
  }

  if (isTicketReporterRole(user.role)) {
    return ticket.reportedById === user.id;
  }
  if (ASSIGNEE_SCOPED_ROLES.includes(user.role as any)) {
    const ticketLevelMatch = ticket.assignedToId === user.id || ticket.assignedTechnicianId === user.id;
    if (ticketLevelMatch) return true;
    if (!items) return false;
    return items.some((i) => i.assignedToId === user.id || i.assignedTechnicianId === user.id);
  }
  return true;
}

export function assertTicketVisible(
  user: TicketAccessUser,
  ticket: TicketVisibilitySubject,
  message = "ليس لديك صلاحية للاطلاع على هذا البلاغ",
): void {
  if (!isTicketVisible(user, ticket)) {
    throw new TRPCError({ code: "FORBIDDEN", message });
  }
}

/**
 * Detail/history/attachment read guard.
 * A construction manager may additionally read a non-routed ticket when it is linked
 * to a purchase order, but that exception remains read-only.
 *
 * ⚠️ 2026-08-08 — القاعدة الحرجة #12: بعد الفشل على مستوى البلاغ (المسار السريع، بلا استعلام
 * إضافي)، تُجلب بنود البلاغ (ticket_items) ويُعاد الفحص عبرها — يغطي أي جهة/فني ثانوي بالفرز
 * المتعدد لا تعكسه أعمدة tickets. هذا استعلام إضافي واحد فقط، ويُنفَّذ فقط عند فشل المسار
 * السريع (الحالة الشائعة: بلاغ أحادي البند يطابق دائمًا من المسار السريع، صفر تكلفة إضافية).
 */
export async function assertTicketReadable(
  user: TicketAccessUser,
  ticket: TicketVisibilitySubject & { id: number },
  message = "ليس لديك صلاحية للاطلاع على هذا البلاغ",
  source: TicketReadPort = db,
): Promise<void> {
  if (isTicketVisible(user, ticket)) return;

  const items = await source.getTicketItems(ticket.id);
  if (isTicketVisible(user, ticket, items)) return;

  // النموذج الجديد: الجهة والفني قد يوجدان فقط في طبقة الخطة التنظيمية.
  if (user.role === APP_ROLE.CONSTRUCTION_PROCUREMENT_MANAGER) {
    const routedThroughDepartmentPlan = await source.hasTicketDepartmentAssignment(
      ticket.id, MAINTENANCE_RESPONSIBLE_DEPARTMENT.CONSTRUCTION, user.id,
    );
    if (routedThroughDepartmentPlan) return;
    const linked = await source.hasPurchaseOrderForTicket(ticket.id);
    if (linked) return;
  }
  if (user.role === APP_ROLE.TECHNICIAN) {
    const assignedThroughTask = await source.isUserAssignedToTicketTasks(ticket.id, ticket.sourceTaskId, user.id);
    if (assignedThroughTask) return;
  }
  if (isItTeamRole(user.role)) {
    const routedThroughDepartmentPlan = await source.hasTicketDepartmentAssignment(
      ticket.id, MAINTENANCE_RESPONSIBLE_DEPARTMENT.IT,
    );
    if (routedThroughDepartmentPlan) return;
    const assignedThroughTask = await source.isUserAssignedToTicketTasks(ticket.id, ticket.sourceTaskId, user.id);
    if (assignedThroughTask) return;
  }

  throw new TRPCError({ code: "FORBIDDEN", message });
}

/**
 * Manager/supervisor workflow scope after routing.
 * - legacy maintenance manager + owner/admin: unrestricted
 * - general manager: pending triage and general/unclassified tickets only
 * - construction manager: only construction tickets routed to that exact user
 * - supervisor: keeps existing inspection/closure scope, but cannot perform routing
 */
export function canManageTicketWorkflow(
  user: TicketAccessUser,
  ticket: TicketVisibilitySubject,
): boolean {
  if ([APP_ROLE.OWNER, APP_ROLE.ADMIN].includes(user.role as any)) return true;

  // IT is a separate, scoped workflow owner. Only the exact IT manager routed
  // on this ticket may act; maintenance/construction/supervisor roles stay read-only.
  if (ticket.maintenanceResponsibleDepartment === MAINTENANCE_RESPONSIBLE_DEPARTMENT.IT) {
    return isItTeamRole(user.role) && ticket.assignedToId === user.id;
  }

  if (user.role === APP_ROLE.MAINTENANCE_MANAGER) return true;

  if (user.role === APP_ROLE.GENERAL_MAINTENANCE_MANAGER) {
    return (
      ticket.status === "pending_triage" ||
      !ticket.maintenanceResponsibleDepartment ||
      ticket.maintenanceResponsibleDepartment === MAINTENANCE_RESPONSIBLE_DEPARTMENT.GENERAL
    );
  }

  if (user.role === APP_ROLE.CONSTRUCTION_PROCUREMENT_MANAGER) {
    return isConstructionTicketAssignedToUser(user, ticket);
  }

  if (user.role === APP_ROLE.SUPERVISOR) return true;

  return false;
}

export function assertTicketWorkflowManageable(
  user: TicketAccessUser,
  ticket: TicketVisibilitySubject,
  message = "ليس لديك صلاحية لتنفيذ إجراء على هذا البلاغ",
): void {
  if (!canManageTicketWorkflow(user, ticket)) {
    throw new TRPCError({ code: "FORBIDDEN", message });
  }
}

/**
 * إدارة سير عمل بند بعينه — الخطوة 3 من ميزة البلاغ متعدد الجهات (2026-08-08).
 * نظير `canManageTicketWorkflow` لكن على مستوى البند، للجهة/المسؤول الثانوي الذي
 * لا تعكسه أعمدة البلاغ. **لا تستبدل `canManageTicketWorkflow`** — تُستخدم معها
 * بشرط OR (راجع `approveWorkForItem`): الجهة الرئيسية تمر من الفحص القائم كالمعتاد
 * بلا استعلام إضافي، والجهة الثانوية تمر من هنا.
 */
export function canManageTicketItemWorkflow(
  user: TicketAccessUser,
  item: TicketItemVisibilitySubject,
): boolean {
  if ([APP_ROLE.OWNER, APP_ROLE.ADMIN].includes(user.role as any)) return true;
  if (item.responsibleDepartment === MAINTENANCE_RESPONSIBLE_DEPARTMENT.IT) {
    return isItTeamRole(user.role) && item.assignedToId === user.id;
  }
  if (user.role === APP_ROLE.MAINTENANCE_MANAGER) return true;
  if (user.role === APP_ROLE.GENERAL_MAINTENANCE_MANAGER) {
    return !item.responsibleDepartment || item.responsibleDepartment === MAINTENANCE_RESPONSIBLE_DEPARTMENT.GENERAL;
  }
  if (user.role === APP_ROLE.CONSTRUCTION_PROCUREMENT_MANAGER) {
    return item.responsibleDepartment === MAINTENANCE_RESPONSIBLE_DEPARTMENT.CONSTRUCTION &&
      item.responsibleManagerId === user.id;
  }
  if (user.role === APP_ROLE.SUPERVISOR) return true;
  return false;
}

export function assertTicketItemWorkflowManageable(
  user: TicketAccessUser,
  ticket: TicketVisibilitySubject,
  item: TicketItemVisibilitySubject,
  message = "ليس لديك صلاحية لتنفيذ إجراء على هذا البند",
): void {
  if (item.responsibleDepartment === MAINTENANCE_RESPONSIBLE_DEPARTMENT.IT) {
    if (canManageTicketItemWorkflow(user, item)) return;
    throw new TRPCError({ code: "FORBIDDEN", message: "هذه المهمة مسندة إلى عضو آخر" });
  }
  // الجهة الرئيسية تمر من الفحص القائم أولًا (بلا تغيير سلوك) — الثانوية من هنا.
  if (canManageTicketWorkflow(user, ticket)) return;
  if (canManageTicketItemWorkflow(user, item)) return;
  throw new TRPCError({ code: "FORBIDDEN", message });
}

export function isTicketReadOnlyForUser(
  user: TicketAccessUser,
  ticket: TicketVisibilitySubject,
): boolean {
  if (ticket.maintenanceResponsibleDepartment === MAINTENANCE_RESPONSIBLE_DEPARTMENT.IT) {
    if ([APP_ROLE.OWNER, APP_ROLE.ADMIN].includes(user.role as any)) return false;
    // IT manager owns the routed ticket structurally; workflow mutations themselves
    // remain denied by canManageTicketWorkflow until Phase 2.
    if (isItTeamRole(user.role) && ticket.assignedToId === user.id) return false;
    return true;
  }

  if (user.role === APP_ROLE.CONSTRUCTION_PROCUREMENT_MANAGER) {
    if (ticket.status === "pending_triage" && ticket.reportedById === user.id) return false;
    if (!isConstructionTicketAssignedToUser(user, ticket)) return true;
  }

  // After a ticket is routed to construction, the general maintenance manager
  // keeps follow-up visibility but may not mutate the construction workflow.
  return (
    user.role === APP_ROLE.GENERAL_MAINTENANCE_MANAGER &&
    ticket.maintenanceResponsibleDepartment === MAINTENANCE_RESPONSIBLE_DEPARTMENT.CONSTRUCTION
  );
}


const INSPECTION_MANAGER_ROLES = [
  APP_ROLE.MAINTENANCE_MANAGER,
  APP_ROLE.GENERAL_MAINTENANCE_MANAGER,
  APP_ROLE.CONSTRUCTION_PROCUREMENT_MANAGER,
  APP_ROLE.IT_MANAGER,
  APP_ROLE.IT_MEMBER,
  APP_ROLE.ADMIN,
  APP_ROLE.OWNER,
] as const;

/** Direct assignment is authoritative; no accept/start step is required. */
export function isAssignedInspectionTechnician(
  user: TicketAccessUser,
  ticket: TicketVisibilitySubject,
): boolean {
  return user.role === APP_ROLE.TECHNICIAN && ticket.assignedToId === user.id;
}

/** كل فنيي المهمة الأصلية يُعاملون كمكلّفين بالبلاغ الفرعي. */
export async function isAssignedTicketTechnicianForWorkflow(
  user: TicketAccessUser,
  ticket: TicketVisibilitySubject & { id: number },
): Promise<boolean> {
  if (user.role !== APP_ROLE.TECHNICIAN) return false;
  if (ticket.assignedToId === user.id || ticket.assignedTechnicianId === user.id) return true;
  if (!ticket.sourceTaskId) return false;
  return db.isUserAssignedToTicketTasks(ticket.id, ticket.sourceTaskId, user.id);
}

/**
 * Inspection recording is allowed to the directly assigned technician and to
 * the manager/supervisor who owns the ticket workflow scope.
 */
export function canRecordTicketInspection(
  user: TicketAccessUser,
  ticket: TicketVisibilitySubject,
): boolean {
  if (ticket.status !== "under_inspection") return false;
  if (isAssignedInspectionTechnician(user, ticket)) return true;
  if (user.role === APP_ROLE.SUPERVISOR) return canManageTicketWorkflow(user, ticket);
  if ((INSPECTION_MANAGER_ROLES as readonly string[]).includes(user.role)) {
    return canManageTicketWorkflow(user, ticket);
  }
  return false;
}

/** Manager-entered inspections are approved immediately; technician/supervisor entries require review. */
export function shouldAutoApproveRecordedInspection(user: TicketAccessUser): boolean {
  return (INSPECTION_MANAGER_ROLES as readonly string[]).includes(user.role);
}

export function canReviewTicketInspection(
  user: TicketAccessUser,
  ticket: TicketVisibilitySubject,
): boolean {
  return (
    ticket.status === "under_inspection" &&
    ticket.inspectionWorkflowStatus === MAINTENANCE_INSPECTION_WORKFLOW_STATUS.SUBMITTED_FOR_REVIEW &&
    (INSPECTION_MANAGER_ROLES as readonly string[]).includes(user.role) &&
    canManageTicketWorkflow(user, ticket)
  );
}

export function canSelectTicketMaintenancePath(
  user: TicketAccessUser,
  ticket: TicketVisibilitySubject,
): boolean {
  return (
    ticket.status === "under_inspection" &&
    ticket.inspectionWorkflowStatus === MAINTENANCE_INSPECTION_WORKFLOW_STATUS.APPROVED &&
    (INSPECTION_MANAGER_ROLES as readonly string[]).includes(user.role) &&
    canManageTicketWorkflow(user, ticket)
  );
}

/**
 * نظير `canSelectTicketMaintenancePath` على مستوى البند — الخطوة 3 (2026-08-08).
 * الفحص يبقى واحدًا على مستوى البلاغ (قرار سابق مؤكَّد)، لذا شرط اعتماد الفحص
 * (`inspectionWorkflowStatus === APPROVED`) يُفحص على `ticket` كما هو، بينما
 * "من يملك صلاحية اختيار المسار لهذا البند تحديدًا؟" يُفحص عبر
 * `canManageTicketWorkflow` (الجهة الرئيسية) OR `canManageTicketItemWorkflow`
 * (أي جهة أخرى). حالة البند نفسه (`item.status === "under_inspection"`) شرط
 * إضافي — قد يكون بند واحد معتمدًا بالفعل بينما آخر لا يزال ينتظر.
 */
export function canSelectTicketItemMaintenancePath(
  user: TicketAccessUser,
  ticket: TicketVisibilitySubject,
  item: TicketItemVisibilitySubject & { status: string },
): boolean {
  return (
    item.status === "under_inspection" &&
    ticket.inspectionWorkflowStatus === MAINTENANCE_INSPECTION_WORKFLOW_STATUS.APPROVED &&
    (INSPECTION_MANAGER_ROLES as readonly string[]).includes(user.role) &&
    (item.responsibleDepartment === MAINTENANCE_RESPONSIBLE_DEPARTMENT.IT
      ? canManageTicketItemWorkflow(user, item)
      : (canManageTicketWorkflow(user, ticket) || canManageTicketItemWorkflow(user, item)))
  );
}

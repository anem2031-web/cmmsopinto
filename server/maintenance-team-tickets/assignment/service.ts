import { TeamTicketError } from "../../../shared/maintenance-team-tickets/model";
import { canAssignTicketTeams, type TeamManagementActor } from "../../../shared/maintenance-team-tickets/team-management";
import { canReadTicketTeamExecution } from "../../../shared/maintenance-team-tickets/execution-permissions";
import type { TeamAssignmentRepository, TeamAssignmentInput, AssignmentContext } from "../../../shared/maintenance-team-tickets/assignment";

export class TicketTeamAssignmentService {
  constructor(private readonly repository: TeamAssignmentRepository) {}
  private manager(actor: TeamManagementActor) {
    if (!actor.active || !canAssignTicketTeams(actor.role)) throw new TeamTicketError("FORBIDDEN", "إسناد الفريق للمسؤول المخوّل فقط");
  }
  async candidates(actor: TeamManagementActor) {
    this.manager(actor);
    return (await this.repository.candidates()).filter(t => t.active && t.warehouseActive && t.warehouseType === "branch" && t.memberCount > 0);
  }
  async queue(actor: TeamManagementActor) {
    if (!actor.active || !canReadTicketTeamExecution(actor.role)) throw new TeamTicketError("FORBIDDEN", "ليس لديك صلاحية لعرض تذاكر الفريق");
    return this.repository.queue(actor);
  }
  async warehouseRequests(actor: TeamManagementActor, search = "") {
    if (!actor.active || !["warehouse", "owner", "admin", "senior_management"].includes(actor.role))
      throw new TeamTicketError("FORBIDDEN", "طلبات مواد التذاكر للمستودع فقط");
    return this.repository.queue(actor, { materialsOnly: true, ...(search.trim() ? { search } : {}) });
  }
  private context(actor: TeamManagementActor, c: AssignmentContext, input: TeamAssignmentInput) {
    if (c.parent.id !== input.ticketId || c.task.id !== input.taskId || c.task.ticketId !== input.ticketId || c.department.ticketId !== input.ticketId || c.task.ticketDepartmentId !== c.department.id)
      throw new TeamTicketError("INVALID", "المهمة أو الجهة لا تنتمي لهذا البلاغ");
    if (c.parent.workflowModel !== "department_tasks" || ["closed", "requester_confirmed"].includes(c.parent.status) || c.task.status === "cancelled")
      throw new TeamTicketError("CONFLICT", "لا يمكن إسناد مهمة ملغاة أو بلاغ مغلق أو خارج خطة الجهات");
    const general = c.department.department === "maintenance_report_department_general";
    const construction = c.department.department === "maintenance_report_department_construction";
    if (!general && !construction) throw new TeamTicketError("INVALID", "إسناد الفريق متاح لجهة الصيانة العامة أو الإنشاءات فقط");
    if (actor.role === "construction_procurement_manager" && (!construction || c.department.responsibleManagerId !== actor.id))
      throw new TeamTicketError("FORBIDDEN", "مهمة الإنشاءات خارج مسؤوليتك");
    if (construction && !["owner", "admin", "construction_procurement_manager"].includes(actor.role))
      throw new TeamTicketError("FORBIDDEN", "إسناد فريق الإنشاءات للمسؤول المخوّل فقط");
    if (general && actor.role === "construction_procurement_manager")
      throw new TeamTicketError("FORBIDDEN", "مدير الإنشاءات لا يدير مهام الصيانة العامة");
    if (actor.role === "general_maintenance_manager" && c.department.responsibleManagerId !== actor.id)
      throw new TeamTicketError("FORBIDDEN", "المهمة خارج مسؤوليتك");
    if (!Number.isInteger(c.department.responsibleManagerId) || c.department.responsibleManagerId <= 0) throw new TeamTicketError("INVALID", "يجب تحديد مسؤول الجهة أولًا");
  }
  async assign(actor: TeamManagementActor, input: TeamAssignmentInput) {
    this.manager(actor);
    if (![input.ticketId, input.taskId, input.teamId].every(n => Number.isSafeInteger(n) && n > 0)) throw new TeamTicketError("INVALID", "معرفات الإسناد غير صحيحة");
    if (!Number.isSafeInteger(input.inspectionMinutes) || input.inspectionMinutes < 1 || input.inspectionMinutes > 525600) throw new TeamTicketError("INVALID", "حدد مدة فحص صحيحة من دقيقة إلى سنة");
    return this.repository.transaction(async tx => {
      const c = await tx.lockContext(input);
      if (!c) throw new TeamTicketError("NOT_FOUND", "البلاغ أو المهمة أو الجهة غير موجودة");
      this.context(actor, c, input);
      if (c.task.convertedTicketId) {
        const previous = await tx.existing(c.task.convertedTicketId);
        if (!previous || previous.teamId !== input.teamId) throw new TeamTicketError("CONFLICT", "المهمة حُولت مسبقًا ولا يمكن تغيير إسنادها");
        return { ticketId: previous.ticketId, ticketNumber: previous.ticketNumber, assignmentId: previous.assignmentId, alreadyExisting: true };
      }
      if (c.task.status !== "pending_assignment" || await tx.namedAssigneeCount(c.task.id) > 0)
        throw new TeamTicketError("CONFLICT", "هذه المهمة موزعة بالاسم؛ يبقى مسارها الحالي كما هو");
      // Same parent-team lock as team management: disabling/removing the last member cannot race assignment.
      const team = await tx.lockTeam(input.teamId);
      if (!team || !team.active || !team.warehouseActive || team.warehouseType !== "branch" || team.memberCount < 1)
        throw new TeamTicketError("CONFLICT", "الفريق غير متاح؛ يلزم مستودع فرعي نشط وفني نشط واحد على الأقل");
      return tx.create(c, team, actor, input.inspectionMinutes);
    });
  }
}

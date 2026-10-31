import {
  TeamTicketError,
  integer,
  required,
  issued,
  deliveryOriginalEquivalent,
  remainingReturn,
  isRequiredNow,
  type Snapshot,
  type Assignment,
  type Command,
  type NeedInput,
  type CompletionInput,
  type Outcome,
} from "../../shared/maintenance-team-tickets/model";
import type { Store, MaterialGateway } from "./ports";
import type { TicketIdentityContext } from "../../shared/catalog-material-identity";
import { ticketExecutionSession } from "../../shared/maintenance-team-tickets/execution-session";
import {
  ticketPurchaseQuantities,
  ticketPurchaseBreakdown,
} from "../../shared/maintenance-team-tickets/purchase-quantities";
import {
  materialRouteNote,
  materialSupplyRemaining,
} from "../../shared/maintenance-team-tickets/material-routing";
import {
  canExecuteAllTicketTeams,
  canReviewTicketTeamExecution,
} from "../../shared/maintenance-team-tickets/execution-permissions";

const managerRoles = new Set([
  "owner",
  "admin",
  "maintenance_manager",
  "general_maintenance_manager",
]);
function user(s: Snapshot, id: number) {
  const u = s.users.find(u => u.id === id && u.active);
  if (!u)
    throw new TeamTicketError("FORBIDDEN", "المستخدم غير نشط أو غير موجود");
  return u;
}
function manager(s: Snapshot, id: number, a?: Assignment) {
  const u = user(s, id);
  if (
    !managerRoles.has(u.role) ||
    (a && !canReviewTicketTeamExecution(u.role, id, a.responsibleManagerId))
  )
    throw new TeamTicketError("FORBIDDEN", "الإجراء للمسؤول المخوّل فقط");
}
function warehouse(s: Snapshot, id: number) {
  if (!["warehouse", "owner", "admin"].includes(user(s, id).role))
    throw new TeamTicketError("FORBIDDEN", "الإجراء للمستودع فقط");
}
function member(s: Snapshot, id: number, a: Assignment) {
  const actor = user(s, id);
  const ticket = s.tickets.find(t => t.ticketId === a.ticketId);
  const namedItExecutor =
    ["it_manager", "it_member"].includes(actor.role) &&
    ticket?.responsibleDepartment === "maintenance_report_department_it" &&
    ticket.assignedToId === id;
  if (
    !(actor.role === "technician" || namedItExecutor) ||
    !s.teams.some(t => t.id === a.teamId && t.active) ||
    !s.memberships.some(
      m => m.teamId === a.teamId && m.userId === id && m.active
    )
  )
    throw new TeamTicketError("FORBIDDEN", "التذكرة غير مسندة إلى فريقك النشط");
}
function executor(s: Snapshot, id: number, a: Assignment) {
  const u = user(s, id);
  if (canExecuteAllTicketTeams(u.role)) {
    if (!s.teams.some(t => t.id === a.teamId && t.active))
      throw new TeamTicketError("FORBIDDEN", "فريق التذكرة غير نشط");
    return;
  }
  member(s, id, a);
}
function assignment(s: Snapshot, id: number) {
  const a = s.assignments.find(a => a.id === id);
  if (!a) throw new TeamTicketError("NOT_FOUND", "إسناد الفريق غير موجود");
  return a;
}
function noteAction(
  s: Snapshot,
  a: Assignment,
  actorId: number,
  kind: string,
  note: string,
  key: string
) {
  a.revision++;
  s.actions.push({
    id: s.nextId++,
    assignmentId: a.id,
    actorId,
    kind,
    note,
    revision: a.revision,
    at: new Date().toISOString(),
    operationKey: key,
  });
}
function allReceived(s: Snapshot, a: Assignment): boolean {
  const needs = currentNeeds(s, a);
  return (
    needs.length > 0 &&
    needs.every(
      n => n.catalogItemId !== null && issued(s, n.id) === n.requested
    )
  );
}
function currentNeeds(s: Snapshot, a: Assignment) {
  return s.needs.filter(
    n => n.assignmentId === a.id && n.round === a.materialRound
  );
}
/** Identity/quantity review cannot reinterpret any physical or procurement history. */
function materialIdentityReview(s: Snapshot, a: Assignment, needId: number) {
  const ticket = s.tickets.find(t => t.ticketItemId === a.ticketItemId && t.ticketId === a.ticketId);
  if (!ticket || ticket.closed)
    throw new TeamTicketError("CONFLICT", "انتهى البلاغ الأصلي أو لم يعد متاحًا؛ لا يمكن مراجعة المادة");
  const need = currentNeeds(s, a).find(n => n.id === needId);
  const catalog = s.catalog.find(item => item.id === need?.catalogItemId && item.active);
  if (!need || (need.catalogItemId !== null && (!catalog || catalog.unit === need.unit)))
    throw new TeamTicketError("CONFLICT", "الاحتياج غير موجود أو لا يحتاج مراجعة هويته ووحدته");
  if (need.used !== null || s.deliveries.some(d => d.needId === need.id) || s.supplies.some(source => source.needId === need.id))
    throw new TeamTicketError("CONFLICT", "لا يمكن تعديل وحدة أو كمية احتياج مرتبط بصرف أو توفير أو استخدام أو مرتجع سابق");
  return { need, catalog };
}
function allowStage(a: Assignment, stages: Assignment["stage"][]) {
  if (!stages.includes(a.stage))
    throw new TeamTicketError(
      "CONFLICT",
      "الإجراء غير متاح في المرحلة الحالية؛ حدّث الصفحة"
    );
}
function requireWork(s: Snapshot, a: Assignment, actorId: number) {
  const session = ticketExecutionSession(s, a);
  // Historical assignments retain their existing API until explicitly started in the new UI.
  if (session.enabled && (!session.openVisit || session.conflict || !session.working))
    throw new TeamTicketError("CONFLICT", "ابدأ التنفيذ أو استكمل العمل ضمن زيارة مفتوحة أولًا");
  if (session.enabled && !session.openVisit?.memberIds.includes(actorId))
    throw new TeamTicketError("FORBIDDEN", "انضم إلى زيارة التنفيذ أولًا");
}
/** Every dependency must be supplied explicitly. No DB adapter/default fallback. */
export class MaintenanceTeamTicketService {
  constructor(private readonly store: Store) {}
  async read(actorId: number): Promise<Snapshot> {
    const s = await this.store.read();
    const u = user(s, actorId);
    if (canExecuteAllTicketTeams(u.role) || u.role === "warehouse")
      return { ...s, operations: [] };
    const itExecutor = ["it_manager", "it_member"].includes(u.role);
    if (u.role !== "technician" && !itExecutor)
      throw new TeamTicketError("FORBIDDEN", "لا توجد صلاحية لهذه الطبقة");
    const teamIds = s.memberships
      .filter(
        m =>
          m.userId === actorId &&
          m.active &&
          s.teams.some(t => t.id === m.teamId && t.active)
      )
      .map(m => m.teamId);
    const scoped = this.scope(
      s,
      s.assignments
        .filter(a => {
          if (!teamIds.includes(a.teamId)) return false;
          if (!itExecutor) return true;
          const ticket = s.tickets.find(t => t.ticketId === a.ticketId);
          return (
            ticket?.responsibleDepartment ===
              "maintenance_report_department_it" &&
            ticket.assignedToId === actorId
          );
        })
        .map(a => a.id)
    );
    scoped.teams = s.teams.filter(t => teamIds.includes(t.id));
    scoped.memberships = s.memberships.filter(m => teamIds.includes(m.teamId));
    // Operation results are internal retry data, never client-visible.
    return scoped;
  }
  private scope(s: Snapshot, ids: number[]): Snapshot {
    const assignments = s.assignments.filter(a => ids.includes(a.id));
    const needs = s.needs.filter(n => ids.includes(n.assignmentId));
    const deliveries = s.deliveries.filter(d =>
      needs.some(n => n.id === d.needId)
    );
    return {
      ...s,
      tickets: s.tickets.filter(t =>
        assignments.some(a => a.ticketItemId === t.ticketItemId)
      ),
      assignments,
      needs,
      deliveries,
      actions: s.actions.filter(x => ids.includes(x.assignmentId)),
      supplies: s.supplies.filter(x => needs.some(n => n.id === x.needId)),
      returns: s.returns.filter(x =>
        deliveries.some(d => d.id === x.deliveryLinkId)
      ),
      operations: [],
    };
  }
  private async command<T>(
    actorId: number,
    c: Command,
    payload: unknown,
    authorize: (s: Snapshot, a: Assignment) => void,
    execute: (
      s: Snapshot,
      a: Assignment,
      effects: MaterialGateway
    ) => Promise<T>,
    allowClosed = false
  ): Promise<T> {
    integer(c.assignmentId, "الإسناد");
    integer(c.expectedRevision, "نسخة الإسناد", 0);
    const key = required(c.operationKey, "مرجع العملية", 120);
    const fingerprint = JSON.stringify({
      actorId,
      assignmentId: c.assignmentId,
      payload,
    });
    return this.store.transaction(async (s, effects) => {
      const a = assignment(s, c.assignmentId);
      authorize(s, a);
      const existing = s.operations.find(op => op.key === key);
      if (existing) {
        if (existing.fingerprint !== fingerprint)
          throw new TeamTicketError(
            "CONFLICT",
            "مرجع العملية مستخدم لإجراء آخر"
          );
        return structuredClone(existing.result) as T;
      }
      if (a.revision !== c.expectedRevision)
        throw new TeamTicketError(
          "CONFLICT",
          "نفّذ عضو آخر إجراءً أو تغيرت التذكرة؛ حدّث الصفحة"
        );
      if (a.stage === "closed" && !allowClosed)
        throw new TeamTicketError("CONFLICT", "اكتمل تنفيذ الفريق");
      const result = await execute(s, a, effects);
      s.operations.push({ key, fingerprint, result: structuredClone(result) });
      return result;
    });
  }
  async createTeam(
    actorId: number,
    input: { name: string; warehouseId: number }
  ) {
    return this.store.transaction(async s => {
      manager(s, actorId);
      const name = required(input.name, "اسم الفريق", 100);
      if (
        s.teams.some(
          t => t.name.toLocaleLowerCase() === name.toLocaleLowerCase()
        )
      )
        throw new TeamTicketError("CONFLICT", "اسم الفريق موجود");
      if (!s.warehouses.some(w => w.id === input.warehouseId && w.active))
        throw new TeamTicketError("INVALID", "اختر مستودعًا نشطًا");
      const team = {
        id: s.nextId++,
        name,
        warehouseId: input.warehouseId,
        active: true,
        createdById: actorId,
        updatedById: actorId,
      };
      s.teams.push(team);
      return team;
    });
  }
  async setMembership(
    actorId: number,
    teamId: number,
    userId: number,
    active: boolean
  ) {
    return this.store.transaction(async s => {
      manager(s, actorId);
      if (!s.teams.some(t => t.id === teamId && t.active))
        throw new TeamTicketError("INVALID", "الفريق غير نشط");
      if (user(s, userId).role !== "technician")
        throw new TeamTicketError("INVALID", "يمكن ربط الفنيين الداخليين فقط");
      const existing = s.memberships.find(
        m => m.teamId === teamId && m.userId === userId
      );
      if (
        !active &&
        s.assignments.some(a => a.teamId === teamId && a.stage !== "closed") &&
        !s.memberships.some(
          m =>
            m.teamId === teamId &&
            m.userId !== userId &&
            m.active &&
            s.users.some(u => u.id === m.userId && u.active)
        )
      )
        throw new TeamTicketError(
          "CONFLICT",
          "لا يمكن إزالة آخر فني نشط من فريق لديه تذاكر مفتوحة"
        );
      const now = new Date().toISOString();
      if (existing && existing.active !== active) {
        existing.active = active;
        existing.updatedById = actorId;
        existing.leftAt = active ? null : now;
        if (active) existing.joinedAt = now;
      } else if (!existing && active)
        s.memberships.push({
          teamId,
          userId,
          active,
          joinedAt: now,
          leftAt: null,
          updatedById: actorId,
        });
      return { success: true };
    });
  }
  async setTeamActive(actorId: number, teamId: number, active: boolean) {
    return this.store.transaction(async s => {
      manager(s, actorId);
      const t = s.teams.find(t => t.id === teamId);
      if (!t) throw new TeamTicketError("NOT_FOUND", "الفريق غير موجود");
      if (
        !active &&
        s.assignments.some(a => a.teamId === teamId && a.stage !== "closed")
      )
        throw new TeamTicketError(
          "CONFLICT",
          "أكمل التذاكر المفتوحة قبل تعطيل الفريق"
        );
      t.active = active;
      t.updatedById = actorId;
      return { success: true };
    });
  }
  /** Input ticket references must be verified by the future trusted ticket adapter. */
  async assign(
    actorId: number,
    input: Omit<
      Assignment,
      | "id"
      | "warehouseId"
      | "stage"
      | "revision"
      | "materialRound"
      | "assignedById"
      | "outcome"
    >
  ) {
    return this.store.transaction(async s => {
      manager(s, actorId);
      integer(input.ticketId, "التذكرة");
      integer(input.ticketItemId, "بند التذكرة");
      required(input.ticketNumber, "رقم التذكرة", 100);
      required(input.title, "عنوان التذكرة", 250);
      const ticket = s.tickets.find(
        t =>
          t.ticketItemId === input.ticketItemId && t.ticketId === input.ticketId
      );
      if (
        !ticket ||
        ticket.closed ||
        ticket.assignmentMode !== "unassigned" ||
        ticket.responsibleManagerId !== input.responsibleManagerId ||
        ticket.ticketNumber !== input.ticketNumber ||
        ticket.title !== input.title ||
        ticket.location.siteId !== input.location.siteId ||
        ticket.location.sectionId !== input.location.sectionId ||
        ticket.location.assetId !== input.location.assetId
      )
        throw new TeamTicketError(
          "INVALID",
          "مرجع التذكرة غير مطابق أو مغلق أو مسند مسبقًا"
        );
      manager(s, input.responsibleManagerId);
      if (
        !["owner", "admin"].includes(user(s, actorId).role) &&
        input.responsibleManagerId !== actorId
      )
        throw new TeamTicketError("FORBIDDEN", "الإسناد ضمن نطاق المسؤول فقط");
      const t = s.teams.find(t => t.id === input.teamId && t.active);
      if (!t || !s.warehouses.some(w => w.id === t.warehouseId && w.active))
        throw new TeamTicketError("INVALID", "الفريق أو مستودعه غير نشط");
      if (
        !s.memberships.some(
          m =>
            m.teamId === t.id &&
            m.active &&
            s.users.some(
              u => u.id === m.userId && u.active && u.role === "technician"
            )
        )
      )
        throw new TeamTicketError("INVALID", "اربط فنيًا نشطًا بالفريق أولًا");
      if (
        !s.locations.some(
          l =>
            l.siteId === input.location.siteId &&
            l.sectionId === input.location.sectionId &&
            (input.location.assetId == null ||
              l.assetId === input.location.assetId)
        )
      )
        throw new TeamTicketError(
          "INVALID",
          "الموقع والقسم والأصل غير متطابقين"
        );
      if (
        s.assignments.some(
          a => a.ticketItemId === input.ticketItemId && a.stage !== "closed"
        )
      )
        throw new TeamTicketError(
          "CONFLICT",
          "بند التذكرة مسند إلى فريق بالفعل"
        );
      const a: Assignment = {
        ...input,
        id: s.nextId++,
        warehouseId: t.warehouseId,
        stage: "action_required",
        revision: 0,
        materialRound: 1,
        assignedById: actorId,
      };
      ticket.assignmentMode = "team";
      s.assignments.push(a);
      noteAction(
        s,
        a,
        actorId,
        "assigned",
        `إسناد إلى ${t.name}`,
        `assignment:${a.id}`
      );
      return structuredClone(a);
    });
  }
  async startExecution(actorId: number, c: Command, resume = false) {
    return this.command(actorId, c, { kind: "start_execution", resume },
      (s, a) => executor(s, actorId, a), async (s, a) => {
        allowStage(a, resume ? ["ready_to_repair", "reinstall_required"] : ["action_required"]);
        const session = ticketExecutionSession(s, a);
        if (session.conflict) throw new TeamTicketError("CONFLICT", "توجد أكثر من زيارة مفتوحة؛ راجع الحالة");
        if (session.working && session.openVisit?.memberIds.includes(actorId))
          throw new TeamTicketError("CONFLICT", "أنت مشارك بالفعل في التنفيذ الحالي");
        const visitKey = session.openVisit?.key ?? c.operationKey;
        noteAction(s, a, actorId, !session.openVisit ? "execution_started" : session.working ? "execution_joined" : "execution_resumed",
          JSON.stringify({ version: 1, visitKey, materialRound: a.materialRound }), c.operationKey);
        return { revision: a.revision, visitKey, stage: a.stage };
      });
  }
  async endVisit(actorId: number, c: Command) {
    return this.command(actorId, c, { kind: "end_visit" },
      (s, a) => executor(s, actorId, a), async (s, a) => {
        const session = ticketExecutionSession(s, a);
        if (!session.openVisit || session.conflict) throw new TeamTicketError("CONFLICT", "لا توجد زيارة مفتوحة واحدة للمهمة");
        if (session.openVisit.leaderId !== actorId) throw new TeamTicketError("FORBIDDEN", "إنهاء الزيارة لقائد الزيارة فقط");
        if (session.working) throw new TeamTicketError("CONFLICT", "سجّل نتيجة البند قبل إنهاء الزيارة");
        noteAction(s, a, actorId, "visit_ended", JSON.stringify({ version: 1, visitKey: session.openVisit.key }), c.operationKey);
        return { revision: a.revision, stage: a.stage };
      }, true);
  }
  async submitOutcome(
    actorId: number,
    c: Command,
    outcome: Exclude<Outcome, "needs_material">,
    input: CompletionInput
  ) {
    return this.command(
      actorId,
      c,
      { kind: "outcome", outcome, input },
      (s, a) => executor(s, actorId, a),
      async (s, a) => {
        requireWork(s, a, actorId);
        if (!["ok", "fixed", "blocked", "external"].includes(outcome))
          throw new TeamTicketError("INVALID", "اختر نتيجة صحيحة");
        allowStage(a, [
          "action_required",
          "ready_to_repair",
          "reinstall_required",
        ]);
        const needs = currentNeeds(s, a);
        const links = s.deliveries.filter(d =>
          needs.some(n => n.id === d.needId)
        );
        if (outcome === "ok" && needs.length)
          throw new TeamTicketError(
            "CONFLICT",
            "بعد طلب المواد أكمل الإصلاح أو ارفع العائق"
          );
        if (outcome === "fixed") {
          if (needs.length && !allReceived(s, a))
            throw new TeamTicketError(
              "CONFLICT",
              "استلم جميع المواد المطلوبة قبل إكمال الإصلاح"
            );
          const ids = input.usages.map(x => x.catalogItemId);
          const substituted = needs.filter(n => links.some(d => d.needId === n.id && d.replacementPlanId != null));
          const ordinary = needs.filter(n => !substituted.includes(n));
          if (
            new Set(ids).size !== ids.length ||
            input.usages.length !== ordinary.length ||
            input.usages.some(
              x => !ordinary.some(n => n.catalogItemId === x.catalogItemId)
            )
          )
            throw new TeamTicketError(
              "INVALID",
              "حدد استخدام كل صنف مستلم مرة واحدة فقط"
            );
          const actualLinks = links.filter(d => substituted.some(n => n.id === d.needId));
          const physical = input.physicalUsages ?? [];
          if (physical.length !== actualLinks.length || new Set(physical.map(row => row.deliveryId)).size !== physical.length
            || physical.some(row => !actualLinks.some(d => d.deliveryId === row.deliveryId)))
            throw new TeamTicketError("INVALID", "حدد الاستخدام الفعلي لكل سند بديل مرة واحدة");
          for (const d of actualLinks) {
            const used = integer(physical.find(row => row.deliveryId === d.deliveryId)!.used, "الكمية الفعلية المستخدمة", 0);
            if (used > d.quantity - d.returned) throw new TeamTicketError("INVALID", "الاستخدام الفعلي يتجاوز المصروف المتبقي");
            d.used = used;
          }
          for (const n of substituted) n.used = null;
          for (const n of ordinary) {
            const used = integer(
              input.usages.find(x => x.catalogItemId === n.catalogItemId)!.used,
              "الكمية المستخدمة",
              0
            );
            const materialLinks = links.filter(d => d.needId === n.id);
            const returned = materialLinks.reduce(
              (sum, d) => sum + deliveryOriginalEquivalent(d, d.returned),
              0
            );
            if (used > issued(s, n.id) - returned)
              throw new TeamTicketError(
                "INVALID",
                "الاستخدام يتجاوز الكمية المصروفة المتبقية"
              );
            n.used = used;
            // Do not allocate consumption to lots before the warehouse chooses returns.
            if (remainingReturn(s, n.id) === 0)
              for (const d of materialLinks) d.used = d.quantity - d.returned;
          }
        } else if (input.usages.length || input.physicalUsages?.length || input.otherMaterials?.trim())
          throw new TeamTicketError(
            "INVALID",
            "تفاصيل الاستخدام تخص تم الإصلاح"
          );
        if (a.stage === "reinstall_required" && outcome === "ok")
          throw new TeamTicketError(
            "CONFLICT",
            "أكمل إعادة التركيب بتسجيل تم الإصلاح"
          );
        const note =
          outcome === "ok"
            ? input.note.trim() || "الفحص سليم ولا يحتاج إصلاحًا"
            : required(
                input.note,
                outcome === "fixed" ? "تفاصيل الإصلاح" : "السبب والتفاصيل"
              );
        if (input.otherMaterials && input.otherMaterials.length > 4000)
          throw new TeamTicketError("INVALID", "تفاصيل المواد طويلة جدًا");
        a.outcome = outcome;
        a.stage =
          outcome === "blocked"
            ? "blocked"
            : outcome === "external"
              ? "external_requested"
              : "awaiting_review";
        noteAction(
          s,
          a,
          actorId,
          outcome,
          note +
            (input.otherMaterials?.trim()
              ? `\nمواد أخرى مذكورة: ${input.otherMaterials.trim()}`
              : ""),
          c.operationKey
        );
        return { stage: a.stage, revision: a.revision };
      }
    );
  }
  async previewMaterials(
    actorId: number,
    assignmentId: number,
    inputs: NeedInput[]
  ) {
    return this.store.transaction(async (s, effects) => {
      const a = assignment(s, assignmentId);
      executor(s, actorId, a);
      allowStage(a, [
        "action_required",
        "reinstall_required",
        "waiting_material",
      ]);
      if (!inputs.length || inputs.length > 20)
        throw new TeamTicketError("INVALID", "أضف من 1 إلى 20 صنفًا");
      const rows = [];
      for (const input of inputs) {
        integer(input.quantity, "الكمية المطلوبة");
        const item =
          input.catalogItemId == null
            ? null
            : s.catalog.find(x => x.id === input.catalogItemId && x.active);
        if (input.catalogItemId != null && !item)
          throw new TeamTicketError("INVALID", "الصنف غير نشط أو غير موجود");
        const unit = item ? required(item.unit, "وحدة الصنف", 50) : "";
        const available = item
          ? await effects.availability(a.warehouseId, item.id)
          : null;
        rows.push({
          ...input,
          unit,
          name: item?.name ?? required(input.name ?? "", "وصف المادة", 250),
          available,
          shortage:
            available === null
              ? input.quantity
              : Math.max(0, input.quantity - available),
        });
      }
      return {
        revision: a.revision,
        warehouseName:
          s.warehouses.find(w => w.id === a.warehouseId)?.name ?? "",
        rows,
      };
    });
  }
  async beginMaterialNeed(actorId: number, c: Command) {
    return this.command(
      actorId,
      c,
      { kind: "begin_material_need" },
      (s, a) => executor(s, actorId, a),
      async (s, a) => {
        requireWork(s, a, actorId);
        allowStage(a, ["action_required"]);
        a.outcome = "needs_material";
        a.stage = "waiting_material";
        noteAction(
          s,
          a,
          actorId,
          "materials_started",
          "البند يحتاج مواد — تحديد الاحتياج",
          c.operationKey
        );
        return { stage: a.stage, revision: a.revision };
      }
    );
  }
  /** One material at a time, as in PMV2; keep the original batch API compatible. */
  async registerMaterialNeed(
    actorId: number,
    c: Command,
    input: NeedInput,
    confirmReceipt = false
  ) {
    if (confirmReceipt && input.catalogItemId == null)
      throw new TeamTicketError("INVALID", "حدد صنف الدليل قبل تأكيد الاستلام");
    return this.requestMaterials(
      actorId,
      c,
      [input],
      confirmReceipt && input.catalogItemId != null
        ? [input.catalogItemId]
        : [],
      true
    );
  }
  async requestMaterials(
    actorId: number,
    c: Command,
    inputs: NeedInput[],
    confirmedCatalogIds: number[] = [],
    incremental = false
  ) {
    return this.command(
      actorId,
      c,
      {
        kind: "request",
        inputs,
        confirmedCatalogIds,
        ...(incremental ? { incremental: true } : {}),
      },
      (s, a) => executor(s, actorId, a),
      async (s, a, effects) => {
        if (a.stage === "action_required" || a.stage === "reinstall_required") requireWork(s, a, actorId);
        allowStage(
          a,
          incremental
            ? ["action_required", "waiting_material"]
            : ["action_required", "reinstall_required"]
        );
        const existingNeeds = currentNeeds(s, a);
        if (incremental && inputs.length !== 1)
          throw new TeamTicketError(
            "INVALID",
            "سجّل احتياج مادة واحدة في كل إجراء"
          );
        if (
          !inputs.length ||
          inputs.length > 20 ||
          (incremental
            ? existingNeeds.length + inputs.length > 20
            : existingNeeds.length > 0)
        )
          throw new TeamTicketError(
            "INVALID",
            "أضف من 1 إلى 20 صنفًا دون تكرار احتياج المادة في هذه الدورة"
          );
        const identities = new Set<string>(
          existingNeeds.map(n =>
            n.catalogItemId != null
              ? `catalog:${n.catalogItemId}`
              : `unlisted:${n.originalName.trim().toLocaleLowerCase()}`
          )
        );
        const addedNeedIds: number[] = [];
        if (
          new Set(confirmedCatalogIds).size !== confirmedCatalogIds.length ||
          confirmedCatalogIds.some(
            id => !inputs.some(n => n.catalogItemId === id)
          )
        )
          throw new TeamTicketError(
            "INVALID",
            "تأكيد الاستلام لا يطابق أصناف الطلب"
          );
        for (const input of inputs) {
          integer(input.quantity, "الكمية المطلوبة");
          const item =
            input.catalogItemId == null
              ? null
              : s.catalog.find(x => x.id === input.catalogItemId && x.active);
          if (input.catalogItemId != null && !item)
            throw new TeamTicketError("INVALID", "الصنف غير نشط أو غير موجود");
          const unit = item ? required(item.unit, "وحدة الصنف", 50) : "";
          const name =
            item?.name ??
            required(input.name ?? "", "وصف المادة غير المدرجة", 250);
          const identity = item
            ? `catalog:${item.id}`
            : `unlisted:${name.toLocaleLowerCase()}`;
          if (identities.has(identity))
            throw new TeamTicketError("INVALID", "الصنف مكرر في الطلب");
          identities.add(identity);
          const needId = s.nextId++;
          addedNeedIds.push(needId);
          s.needs.push({
            id: needId,
            assignmentId: a.id,
            catalogItemId: item?.id ?? null,
            name,
            originalName: name,
            unit,
            requested: input.quantity,
            requestedById: actorId,
            warehouseId: a.warehouseId,
            round: a.materialRound,
            used: null,
          });
        }
        a.outcome = "needs_material";
        a.stage = "waiting_material";
        // Explicit confirmation only. Recheck full availability inside the transaction.
        const addedNeed = currentNeeds(s, a).find(n =>
          addedNeedIds.includes(n.id)
        )!;
        const shortage = incremental
          ? addedNeed.catalogItemId == null
            ? addedNeed.requested
            : Math.max(
                0,
                addedNeed.requested -
                  (await effects.availability(
                    a.warehouseId,
                    addedNeed.catalogItemId
                  ))
              )
          : 0;
        for (const n of currentNeeds(s, a).filter(
          n =>
            addedNeedIds.includes(n.id) &&
            n.catalogItemId !== null &&
            confirmedCatalogIds.includes(n.catalogItemId)
        )) {
          // A preview is never a receipt. If stock fell since confirmation,
          // the single-material flow records the need and waits for its shortage.
          if (
            incremental &&
            (await effects.availability(a.warehouseId, n.catalogItemId!)) <
              n.requested
          )
            continue;
          await this.issue(
            s,
            a,
            n.id,
            actorId,
            `${c.operationKey}:issue:${n.id}`,
            effects
          );
        }
        if (allReceived(s, a)) a.stage = "ready_to_repair";
        noteAction(
          s,
          a,
          actorId,
          "needs_material",
          incremental
            ? materialRouteNote(
                addedNeed,
                shortage,
                "تسجيل احتياج المادة وتحديد المتوفر والنقص"
              )
            : confirmedCatalogIds.length
              ? "تسجيل احتياج المواد وتأكيد استلام الأصناف المحددة"
              : "تسجيل احتياج المواد دون استلام",
          c.operationKey
        );
        return { stage: a.stage, revision: a.revision };
      }
    );
  }
  private async issue(
    s: Snapshot,
    a: Assignment,
    needId: number,
    actorId: number,
    key: string,
    effects: MaterialGateway
  ) {
    const n = currentNeeds(s, a).find(n => n.id === needId);
    if (!n || n.catalogItemId === null)
      throw new TeamTicketError("INVALID", "يجب تحديد الصنف أولًا");
    if ((materialSupplyRemaining(s, n) ?? 0) > 0)
      throw new TeamTicketError(
        "CONFLICT",
        "لم يصل كامل النقص المرتبط بهذا الاحتياج إلى مخزن الفريق"
      );
    if (
      !s.catalog.some(
        item =>
          item.id === n.catalogItemId && item.active && item.unit === n.unit
      )
    )
      throw new TeamTicketError(
        "CONFLICT",
        "الصنف أو الوحدة غير نشط أو تغير منذ طلب المواد"
      );
    const quantity = n.requested - issued(s, n.id);
    if (quantity <= 0)
      throw new TeamTicketError("CONFLICT", "المادة مستلمة بالكامل");
    if (!effects.issueNeed && (await effects.availability(a.warehouseId, n.catalogItemId)) < quantity)
      throw new TeamTicketError("CONFLICT", "الرصيد غير كافٍ لكامل الاحتياج");
    const issueInput = {
      operationKey: key,
      ticketId: a.ticketId,
      ticketNumber: a.ticketNumber,
      warehouseId: a.warehouseId,
      catalogItemId: n.catalogItemId,
      quantity,
      unit: n.unit,
      receiverId: actorId,
      location: a.location,
    };
    const deliveries = effects.issueNeed
      ? await effects.issueNeed(needId, issueInput)
      : await effects.issue(issueInput);
    if (
      !deliveries.length ||
      deliveries.reduce((v, d) => v + (d.originalEquivalent ?? d.quantity), 0) !== quantity ||
      new Set(deliveries.map(d => d.deliveryId)).size !== deliveries.length
    )
      throw new TeamTicketError(
        "INVALID",
        "نتيجة الصرف لا تطابق كامل الاحتياج"
      );
    for (const d of deliveries) {
      integer(d.deliveryId, "سند الصرف");
      integer(d.lotId, "الدفعة");
      integer(d.inventoryTransactionId, "حركة المخزون");
      integer(d.quantity, "الكمية المصروفة");
      if (
        (d.originalEquivalent != null && (!Number.isFinite(d.originalEquivalent) || d.originalEquivalent <= 0)) ||
        (d.catalogItemId !== n.catalogItemId && !(d.originalEquivalent != null && d.originalEquivalent > 0)) ||
        d.warehouseId !== a.warehouseId ||
        d.receivedById !== actorId ||
        (d.unit !== n.unit && d.originalEquivalent == null) ||
        s.deliveries.some(x => x.deliveryId === d.deliveryId)
      )
        throw new TeamTicketError(
          "INVALID",
          "سند الصرف غير مطابق للاحتياج أو مستخدم سابقًا"
        );
      s.deliveries.push({
        id: s.nextId++,
        needId: n.id,
        deliveryId: d.deliveryId,
        deliveryNumber: d.deliveryNumber,
        lotId: d.lotId,
        inventoryTransactionId: d.inventoryTransactionId,
        quantity: d.quantity,
        receivedById: actorId,
        used: null,
        returned: 0,
        ...(d.originalEquivalent != null ? { originalEquivalent: d.originalEquivalent } : {}),
        ...(d.replacementPlanId != null ? { replacementPlanId: d.replacementPlanId, replacementName: d.replacementName, physicalUnit: d.unit, physicalCatalogItemId: d.catalogItemId } : {}),
      });
    }
  }
  async receiveMaterial(actorId: number, c: Command, needId: number) {
    return this.command(
      actorId,
      c,
      { kind: "receive", needId },
      (s, a) => executor(s, actorId, a),
      async (s, a, effects) => {
        allowStage(a, ["waiting_material"]);
        // Self-receipt and warehouse issue share the same locked full-stock
        // writer. A PO receipt in the main warehouse alone cannot satisfy it.
        await this.issue(s, a, needId, actorId, c.operationKey, effects);
        if (allReceived(s, a)) a.stage = "ready_to_repair";
        noteAction(
          s,
          a,
          actorId,
          "material_received",
          "استلام المواد من مستودع الفريق",
          c.operationKey
        );
        return { stage: a.stage, revision: a.revision };
      }
    );
  }
  async issueByWarehouse(
    actorId: number,
    c: Command,
    needId: number,
    recipientId: number
  ) {
    return this.command(
      actorId,
      c,
      { kind: "warehouse_issue", needId, recipientId },
      s => warehouse(s, actorId),
      async (s, a, effects) => {
        allowStage(a, ["waiting_material"]);
        executor(s, recipientId, a);
        await this.issue(s, a, needId, recipientId, c.operationKey, effects);
        if (allReceived(s, a)) a.stage = "ready_to_repair";
        noteAction(
          s,
          a,
          actorId,
          "warehouse_issue",
          `صرف المواد إلى ${user(s, recipientId).name}`,
          c.operationKey
        );
        return { stage: a.stage, revision: a.revision };
      }
    );
  }
  /** Read-only preflight. The form submit repeats this under the assignment lock. */
  async prepareSupply(
    actorId: number,
    assignmentId: number,
    needId: number,
    kind: "purchase" | "transfer"
  ) {
    return this.store.transaction(async (s, effects) => {
      warehouse(s, actorId);
      return this.supplyHandoff(
        s,
        assignment(s, assignmentId),
        needId,
        kind,
        effects
      );
    });
  }
  private async supplyHandoff(
    s: Snapshot,
    a: Assignment,
    needId: number,
    kind: "purchase" | "transfer",
    effects: MaterialGateway
  ) {
    allowStage(a, ["waiting_material"]);
    const n = currentNeeds(s, a).find(
      n => n.id === needId && n.catalogItemId !== null
    );
    const item =
      n &&
      s.catalog.find(
        x => x.id === n.catalogItemId && x.active && x.unit === n.unit
      );
    if (!n || !item)
      throw new TeamTicketError(
        "INVALID",
        "حدد صنفًا نشطًا بوحدة مطابقة أولًا"
      );
    const main = await effects.mainWarehouseId();
    if (kind === "transfer" && await effects.replacementContext?.(needId)) {
      return { assignmentId: a.id, needId: n.id, revision: a.revision,
        ticketId: a.ticketId, ticketItemId: a.ticketItemId, ticketNumber: a.ticketNumber,
        catalogItemId: item.id, name: item.name, unit: n.unit,
        quantity: n.requested - issued(s, n.id), mainWarehouseId: main,
        warehouseId: a.warehouseId, branch: 0, availableMain: 0, location: a.location,
        inventoryId: undefined, replacementFulfillment: true };
    }
    const branch = await effects.availability(a.warehouseId, item.id);
    const availableMain = await effects.availability(main, item.id);
    const pending = s.supplies
      .filter(x => x.needId === n.id && x.status === "pending")
      .reduce((sum, x) => sum + x.quantity, 0);
    const shortage = Math.max(
      0,
      n.requested - issued(s, n.id) - branch,
      materialSupplyRemaining(s, n) ?? 0
    );
    const quantity =
      kind === "purchase"
        ? Math.max(0, shortage - availableMain - pending)
        : shortage;
    if (
      !quantity ||
      (kind === "transfer" && (pending > 0 || availableMain < quantity))
    )
      throw new TeamTicketError(
        "CONFLICT",
        "حدّث الطلب؛ النقص مغطى أو يحتاج استكمال الشراء والاستلام قبل التحويل الكامل"
      );
    return {
      assignmentId: a.id,
      needId: n.id,
      revision: a.revision,
      ticketId: a.ticketId,
      ticketItemId: a.ticketItemId,
      ticketNumber: a.ticketNumber,
      catalogItemId: item.id,
      name: item.name,
      unit: n.unit,
      quantity,
      mainWarehouseId: main,
      warehouseId: a.warehouseId,
      branch,
      availableMain,
      location: a.location,
      inventoryId:
        kind === "transfer" && effects.sourceInventoryId
          ? await effects.sourceInventoryId(main, item.id)
          : undefined,
      replacementFulfillment: false,
    };
  }
  async transferFromForm(
    actorId: number,
    c: Command,
    needId: number,
    form: {
      fromWarehouseId: number;
      toWarehouseId: number;
      notes?: string;
      items: Array<{
        fromInventoryId: number;
        quantity: number;
        lotTrackingToken?: string;
        notes?: string;
      }>;
    }
  ) {
    return this.command(
      actorId,
      c,
      { kind: "transfer_form", needId, form },
      s => warehouse(s, actorId),
      async (s, a, effects) => {
        const handoff = await this.supplyHandoff(
          s,
          a,
          needId,
          "transfer",
          effects
        );
        if (
          !effects.transferForm ||
          !handoff.inventoryId ||
          form.fromWarehouseId !== handoff.mainWarehouseId ||
          form.toWarehouseId !== handoff.warehouseId ||
          !form.items.length ||
          form.items.length > 20 ||
          form.items.some(
            x =>
              x.fromInventoryId !== handoff.inventoryId ||
              !Number.isSafeInteger(x.quantity) ||
              x.quantity <= 0 ||
              !x.lotTrackingToken?.trim()
          ) ||
          form.items.reduce((sum, x) => sum + x.quantity, 0) !==
            handoff.quantity
        )
          throw new TeamTicketError(
            "INVALID",
            "نموذج التحويل لا يطابق كامل النقص والصنف والمستودعات واللوت"
          );
        const result = await effects.transferForm(form);
        if (
          !result.sources.length ||
          result.sources.reduce((sum, x) => sum + x.quantity, 0) !==
            handoff.quantity ||
          result.results.some(x => !x.success)
        )
          throw new TeamTicketError(
            "CONFLICT",
            "التحويل لم يكتمل؛ تُلغى العملية كاملة"
          );
        for (const source of result.sources) {
          integer(source.sourceId, "سند التحويل");
          integer(source.quantity, "كمية التحويل");
          if (
            source.status !== "received" ||
            s.supplies.some(
              x => x.kind === "transfer" && x.sourceId === source.sourceId
            )
          )
            throw new TeamTicketError(
              "CONFLICT",
              "سند التحويل مكرر أو غير مؤكد"
            );
          s.supplies.push({
            id: s.nextId++,
            needId,
            kind: "transfer",
            ...source,
          });
        }
        noteAction(
          s,
          a,
          actorId,
          "transfer_confirmed",
          `تحويل ${result.batchNumber} إلى مستودع الفريق`,
          c.operationKey
        );
        const { sources: _sources, ...batch } = result;
        return batch;
      }
    );
  }
  async purchaseFromForm(
    actorId: number,
    c: Command,
    needId: number,
    form: unknown
  ) {
    return this.command(
      actorId,
      c,
      { kind: "purchase_form_create", needId, form },
      s => warehouse(s, actorId),
      async (s, a, effects) => {
        const handoff = await this.supplyHandoff(
          s,
          a,
          needId,
          "purchase",
          effects
        );
        if (!effects.purchaseForm)
          throw new TeamTicketError(
            "UNAVAILABLE",
            "خدمة نموذج الشراء غير متاحة"
          );
        const need = currentNeeds(s, a).find(n => n.id === needId)!;
        const extra =
          (form as { ticketTeam?: { warehouseExtraQuantity?: number } } | null)
            ?.ticketTeam?.warehouseExtraQuantity ?? 0;
        const quantities = ticketPurchaseQuantities(
          need.requested,
          handoff.quantity,
          extra
        );
        const result = await effects.purchaseForm({
          ...handoff,
          ...quantities,
        });
        integer(result.id, "طلب الشراء");
        integer(result.source.sourceId, "بند الشراء");
        if (!effects.verifySupply)
          throw new TeamTicketError(
            "UNAVAILABLE",
            "خدمة التحقق من الشراء غير متاحة"
          );
        const source = await effects.verifySupply(
          needId,
          "purchase",
          result.source.sourceId
        );
        if (
          source.quantity !== quantities.purchaseTotalQuantity ||
          source.status !== "pending" ||
          source.sourceNumber !== result.poNumber ||
          s.supplies.some(
            x => x.kind === "purchase" && x.sourceId === source.sourceId
          )
        )
          throw new TeamTicketError(
            "CONFLICT",
            "بند الشراء لا يطابق العجز المطلوب"
          );
        s.supplies.push({
          id: s.nextId++,
          needId,
          kind: "purchase",
          ...source,
          // The PO includes extra stock; only the ticket shortage is coverage for this need.
          quantity: handoff.quantity,
        });
        noteAction(
          s,
          a,
          actorId,
          "purchase_requested",
          `طلب شراء ${result.poNumber} — ${ticketPurchaseBreakdown(quantities, need.unit)}`,
          c.operationKey
        );
        return { id: result.id, poNumber: result.poNumber };
      }
    );
  }
  async materialUnitsContext(actorId: number, assignmentId: number) {
    const s = await this.store.read();
    const a = assignment(s, assignmentId);
    executor(s, actorId, a);
    allowStage(a, ["action_required", "waiting_material", "reinstall_required"]);
    const ticket = s.tickets.find(t => t.ticketItemId === a.ticketItemId && t.ticketId === a.ticketId);
    if (!ticket) throw new TeamTicketError("NOT_FOUND", "البلاغ الأصلي غير موجود");
    if (ticket.closed)
      throw new TeamTicketError("CONFLICT", "انتهى البلاغ الأصلي");
  }
  async materialIdentityContext(actorId: number, assignmentId: number, needId: number): Promise<TicketIdentityContext> {
    const s = await this.store.read();
    warehouse(s, actorId);
    const a = assignment(s, assignmentId);
    allowStage(a, ["waiting_material"]);
    const { need: n, catalog } = materialIdentityReview(s, a, needId);
    return { assignmentId: a.id, needId: n.id, ticketNumber: a.ticketNumber, itemTitle: a.title, originalName: n.originalName, requestedQuantity: n.requested, unit: n.unit, warehouseId: a.warehouseId,
      ...(catalog ? { catalogItemId: catalog.id, catalogUnit: catalog.unit } : {}) };
  }
  async resolveMaterial(
    actorId: number,
    c: Command,
    needId: number,
    catalogItemId: number,
    note: string,
    requestedQuantity?: number
  ) {
    return this.command(
      actorId,
      c,
      { kind: "resolve", needId, catalogItemId, note, ...(requestedQuantity == null ? {} : { requestedQuantity }) },
      s => warehouse(s, actorId),
      async (s, a, effects) => {
        allowStage(a, ["waiting_material"]);
        const { need: n } = materialIdentityReview(s, a, needId);
        const item = s.catalog.find(x => x.id === catalogItemId && x.active);
        if (!item)
          throw new TeamTicketError("INVALID", "الاحتياج أو الصنف غير صالح");
        if (n.catalogItemId !== null && n.catalogItemId !== catalogItemId)
          throw new TeamTicketError("CONFLICT", "مراجعة الاحتياج المرتبط تقتصر على الصنف نفسه");
        if (currentNeeds(s, a).some(x => x.id !== n.id && x.catalogItemId === catalogItemId))
          throw new TeamTicketError("CONFLICT", "الصنف موجود في طلب التذكرة");
        const quantity = integer(requestedQuantity ?? n.requested, "الكمية المعتمدة");
        const unit = required(item.unit, "وحدة الصنف", 50);
        const before = { catalogItemId: n.catalogItemId, name: n.name, originalName: n.originalName, unit: n.unit, requestedQuantity: n.requested };
        const tracked = materialSupplyRemaining(s, n) !== null;
        n.catalogItemId = item.id;
        n.name = item.name;
        n.unit = unit;
        n.requested = quantity;
        const identityReview = { before, after: { catalogItemId: n.catalogItemId, name: n.name, originalName: n.originalName, unit: n.unit, requestedQuantity: n.requested } };
        const resolutionNote = required(note, "سبب مطابقة الصنف") + ` — اعتماد ${quantity} ${unit} وفق وحدة الكتالوج دون تحويل تلقائي`;
        const shortage = tracked
          ? Math.max(
              0,
              n.requested - (await effects.availability(a.warehouseId, item.id))
            )
          : 0;
        noteAction(
          s,
          a,
          actorId,
          "material_resolved",
          tracked
            ? materialRouteNote(n, shortage, resolutionNote, identityReview)
            : JSON.stringify({ version: 1, type: "ticket_material_identity_review", message: resolutionNote, identityReview }),
          c.operationKey
        );
        return { revision: a.revision };
      }
    );
  }
  async provideMaterial(
    actorId: number,
    c: Command,
    needId: number,
    kind: "purchase" | "transfer",
    context?: { requiredDate: string }
  ) {
    return this.command(
      actorId,
      c,
      {
        kind: "provide",
        needId,
        source: kind,
        ...(context ? { context } : {}),
      },
      s => warehouse(s, actorId),
      async (s, a, effects) => {
        allowStage(a, ["waiting_material"]);
        if (!["purchase", "transfer"].includes(kind))
          throw new TeamTicketError("INVALID", "مصدر توفير المادة غير صحيح");
        const n = currentNeeds(s, a).find(
          n => n.id === needId && n.catalogItemId !== null
        );
        if (!n) throw new TeamTicketError("INVALID", "حدد هوية الصنف أولًا");
        const item = s.catalog.find(item => item.id === n.catalogItemId && item.active);
        if (!item || item.unit !== n.unit)
          throw new TeamTicketError("INVALID", "تم ربط الصنف؛ يلزم مراجعة وحدة وكمية الاحتياج قبل التوفير، ولا يوجد تحويل وحدات تلقائي");
        if (kind === "transfer" && effects.transferNeed && await effects.replacementContext?.(needId)) {
          const quantity = n.requested - issued(s, n.id);
          if (quantity <= 0) throw new TeamTicketError("CONFLICT", "تم استلام الاحتياج كاملًا");
          const sources = await effects.transferNeed(needId, { operationKey: c.operationKey,
            destinationWarehouseId: a.warehouseId, catalogItemId: n.catalogItemId!, quantity, unit: n.unit });
          const coverage = sources.reduce((sum, source) => sum + (source.originalEquivalent ?? source.quantity), 0);
          if (!sources.length || coverage <= 0 || coverage > quantity)
            throw new TeamTicketError("CONFLICT", "التحويل لا يغطي الاحتياج الأصلي كاملًا");
          for (const source of sources) {
            integer(source.sourceId, "سند التحويل"); integer(source.quantity, "الكمية الفعلية");
            if (source.status !== "received" || s.supplies.some(x => x.kind === "transfer" && x.sourceId === source.sourceId))
              throw new TeamTicketError("CONFLICT", "سند التحويل مكرر أو غير مؤكد");
            s.supplies.push({ id: s.nextId++, needId, kind, ...source });
          }
          noteAction(s, a, actorId, "transfer_confirmed", "تحويل مواد الاحتياج والبديل المعتمد إلى مستودع الفريق", c.operationKey);
          return { revision: a.revision, source: sources };
        }
        const pending = s.supplies
          .filter(x => x.needId === needId && x.status === "pending")
          .reduce((v, x) => v + x.quantity, 0);
        const available = await effects.availability(
          a.warehouseId,
          n.catalogItemId!
        );
        const teamShortage = Math.max(
          0,
          n.requested - issued(s, n.id) - available,
          materialSupplyRemaining(s, n) ?? 0
        );
        const mainWarehouseId = await effects.mainWarehouseId();
        const mainAvailable = await effects.availability(
          mainWarehouseId,
          n.catalogItemId!
        );
        // Same PMV2 boundary: transfer the full shortage; purchase only what main stock cannot cover.
        const shortage =
          kind === "purchase"
            ? Math.max(0, teamShortage - mainAvailable - pending)
            : teamShortage;
        if (!shortage)
          throw new TeamTicketError(
            "CONFLICT",
            kind === "purchase"
              ? "النقص مغطى بالمستودع الرئيسي أو بطلب شراء قائم؛ استخدم التحويل عند توفره"
              : "الاحتياج مغطى بمخزون الفريق"
          );
        if (kind === "transfer" && (mainAvailable < shortage || pending > 0))
          throw new TeamTicketError(
            "CONFLICT",
            "لا يبدأ تحويل جزئي؛ استكمل شراء العجز واستلامه في الرئيسي أولًا"
          );
        const payload = {
          operationKey: c.operationKey,
          destinationWarehouseId:
            kind === "purchase" ? mainWarehouseId : a.warehouseId,
          catalogItemId: n.catalogItemId!,
          quantity: shortage,
          unit: n.unit,
          location: a.location,
        };
        const result = await (kind === "purchase"
          ? effects.purchase(payload)
          : effects.transfer(payload));
        const sources = Array.isArray(result) ? result : [result];
        if (
          !sources.length ||
          sources.reduce((sum, x) => sum + x.quantity, 0) !== shortage ||
          new Set(sources.map(x => x.sourceId)).size !== sources.length ||
          sources.some(x => !["received", "pending"].includes(x.status))
        )
          throw new TeamTicketError("INVALID", "مصدر التوفير لا يطابق النقص");
        for (const source of sources) {
          integer(source.sourceId, "مصدر التوفير");
          integer(source.quantity, "كمية التوفير");
          s.supplies.push({ id: s.nextId++, needId, kind, ...source });
        }
        noteAction(
          s,
          a,
          actorId,
          kind === "purchase" ? "purchase_requested" : "transfer_confirmed",
          `توفير ${shortage} ${n.unit} — ${sources.map(x => x.sourceNumber).join("، ")}`,
          c.operationKey
        );
        return { revision: a.revision, source: result };
      }
    );
  }
  /** Simulation boundary; live PO receipt/approvals stay in the existing workflow. */
  async receivePurchase(actorId: number, c: Command, supplyId: number) {
    return this.command(
      actorId,
      c,
      { kind: "purchase_receipt", supplyId },
      s => warehouse(s, actorId),
      async (s, a, effects) => {
        allowStage(a, ["waiting_material"]);
        const supply = s.supplies.find(
          x =>
            x.id === supplyId &&
            x.kind === "purchase" &&
            x.status === "pending" &&
            s.needs.some(n => n.id === x.needId && n.assignmentId === a.id)
        );
        if (!supply)
          throw new TeamTicketError("INVALID", "طلب الشراء غير متاح للاستلام");
        const result = await effects.receivePurchase({
          operationKey: c.operationKey,
          sourceId: supply.sourceId,
        });
        if (
          result.sourceId !== supply.sourceId ||
          result.quantity !== supply.quantity ||
          result.status !== "received"
        )
          throw new TeamTicketError(
            "INVALID",
            "الاستلام لا يطابق مصدر التوفير"
          );
        supply.status = "received";
        noteAction(
          s,
          a,
          actorId,
          "purchase_received",
          `استلام ${result.sourceNumber} في المستودع؛ استلام الفني مستقل`,
          c.operationKey
        );
        return { revision: a.revision };
      }
    );
  }
  async confirmReturn(
    actorId: number,
    c: Command,
    needId: number,
    lotAllocations?: Array<{ lotId: number; quantity: number }>
  ) {
    return this.command(
      actorId,
      c,
      { kind: "return", needId, lotAllocations },
      s => warehouse(s, actorId),
      async (s, a, effects) => {
        const need = s.needs.find(
          n => n.id === needId && n.assignmentId === a.id
        );
        if (!need || remainingReturn(s, needId) <= 0)
          throw new TeamTicketError("INVALID", "لا يوجد مرتجع معلق لهذا الصنف");
        const links = s.deliveries.filter(d => d.needId === needId);
        const actualUsage = links.some(d => d.replacementPlanId != null) && links.every(d => d.used !== null);
        const lots = new Map<number, number>();
        for (const d of links)
          if (d.quantity > d.returned)
            lots.set(
              d.lotId,
              (lots.get(d.lotId) ?? 0) + d.quantity - d.returned
            );
        const allocations =
          lots.size === 1
            ? [
                {
                  lotId: Array.from(lots.keys())[0],
                  quantity: (() => {
                    const d = links.find(d => d.lotId === Array.from(lots.keys())[0] && d.quantity > d.returned)!;
                    return actualUsage ? links.filter(row => row.lotId === d.lotId).reduce((sum, row) => sum + row.quantity - row.used! - row.returned, 0)
                      : remainingReturn(s, needId) * d.quantity / (d.originalEquivalent ?? d.quantity);
                  })(),
                },
              ]
            : (lotAllocations ?? []);
        if (
          new Set(allocations.map(x => x.lotId)).size !== allocations.length ||
          allocations.reduce((sum, x) => {
            if (actualUsage) return sum + x.quantity;
            let left = x.quantity, equivalent = 0;
            for (const d of links.filter(d => d.lotId === x.lotId)) {
              const take = Math.min(left, d.quantity - d.returned);
              equivalent += deliveryOriginalEquivalent(d, take); left -= take;
            }
            return sum + equivalent;
          }, 0) !==
            remainingReturn(s, needId)
        )
          throw new TeamTicketError(
            "INVALID",
            "مجموع توزيع المرتجع يجب أن يساوي كامل المتبقي"
          );
        for (const x of allocations) {
          integer(x.lotId, "الدفعة");
          integer(x.quantity, "كمية المرتجع");
          if (!lots.has(x.lotId) || x.quantity > lots.get(x.lotId)!)
            throw new TeamTicketError(
              "INVALID",
              "كمية المرتجع تتجاوز المصروف من الدفعة الأصلية"
            );
          if (actualUsage && x.quantity !== links.filter(d => d.lotId === x.lotId).reduce((sum, d) => sum + d.quantity - d.used! - d.returned, 0))
            throw new TeamTicketError("INVALID", "مرتجع كل لوت يجب أن يطابق الكمية الفعلية غير المستخدمة");
        }
        const returnNumbers: string[] = [];
        for (const allocation of allocations) {
          let left = allocation.quantity;
          for (const d of links.filter(d => d.lotId === allocation.lotId)) {
            const quantity = Math.min(left, d.quantity - (actualUsage ? d.used! : 0) - d.returned);
            if (quantity <= 0) continue;
            const result = await effects.returnToWarehouse({
              operationKey: `${c.operationKey}:return:${d.id}`,
              sourceDeliveryId: d.deliveryId,
              quantity,
              actorId,
            });
            integer(result.returnId, "سند المرتجع");
            if (
              result.quantity !== quantity ||
              s.returns.some(r => r.returnId === result.returnId)
            )
              throw new TeamTicketError(
                "INVALID",
                "سند المرتجع غير مطابق أو مرتبط سابقًا"
              );
            d.returned += quantity;
            s.returns.push({
              id: s.nextId++,
              deliveryLinkId: d.id,
              sourceDeliveryId: d.deliveryId,
              ...result,
              actorId,
            });
            returnNumbers.push(result.returnNumber);
            left -= quantity;
          }
        }
        // Only after warehouse allocation can consumption be attributed to source documents.
        for (const d of links) d.used = d.quantity - d.returned;
        noteAction(
          s,
          a,
          actorId,
          "return_received",
          `تأكيد مرتجع فعلي: ${returnNumbers.join("، ")}`,
          c.operationKey
        );
        return { revision: a.revision, returnNumbers };
      },
      true
    );
  }
  async review(
    actorId: number,
    c: Command,
    decision:
      | "return_to_team"
      | "approve_external"
      | "external_handover"
      | "approve_result",
    note: string,
    recipientId?: number
  ) {
    return this.command(
      actorId,
      c,
      { kind: "review", decision, note, recipientId },
      (s, a) =>
        decision === "external_handover"
          ? warehouse(s, actorId)
          : manager(s, actorId, a),
      async (s, a) => {
        const reason = required(note, "ملاحظات المسؤول");
        const lastRouteReview = s.actions.filter(x => x.assignmentId === a.id && ["external_route_returned", "external_route_decided"].includes(x.kind)).sort((x, y) => y.revision - x.revision)[0];
        if (lastRouteReview?.kind === "external_route_returned") throw new TeamTicketError("CONFLICT", "استخدم مراجعة المسار A / B / C للطلب المعاد من المستودع");
        switch (decision) {
          case "return_to_team":
            allowStage(a, ["blocked", "external_requested", "awaiting_review"]);
            if (a.stage === "awaiting_review") a.materialRound++;
            a.stage = currentNeeds(s, a).length
              ? allReceived(s, a)
                ? "ready_to_repair"
                : "waiting_material"
              : "action_required";
            a.outcome = undefined;
            break;
          case "approve_external":
            allowStage(a, ["external_requested"]);
            a.stage = "external_in_progress";
            break;
          case "external_handover":
            allowStage(a, ["external_in_progress"]);
            member(s, recipientId ?? 0, a);
            a.stage = "reinstall_required";
            break;
          case "approve_result":
            allowStage(a, ["awaiting_review"]);
            // Completion and pending returns are independent, as in PMV2.
            // This closes the isolated execution only, never the actual maintenance ticket.
            a.stage = "closed";
            break;
          default:
            throw new TeamTicketError("INVALID", "قرار المسؤول غير صحيح");
        }
        noteAction(
          s,
          a,
          actorId,
          decision,
          reason + (recipientId ? ` — المستلم الفعلي #${recipientId}` : ""),
          c.operationKey
        );
        return { stage: a.stage, revision: a.revision };
      }
    );
  }
  async requiredNow(actorId: number) {
    return (await this.read(actorId)).assignments.filter(a =>
      isRequiredNow(a.stage)
    );
  }
}

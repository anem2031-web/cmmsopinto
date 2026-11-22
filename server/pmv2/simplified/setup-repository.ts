import { sql } from "drizzle-orm";
import { canManagePmv2Foundation } from "../security/policy";
import { planResumeOccurrences, type ResumeOccurrence } from "../scheduler/resume-plan";
import type { PausedScheduleItem, SimplifiedRecurrenceKind } from "../scheduler/pause-recovery";
import type { SetupActor, SetupAudit, SetupBase, SetupItem, SetupPlan, SimplifiedSetupRepository, SimplifiedSetupTx } from "./setup-service";
import type { buildSimplifiedSchedule } from "../checklists/simplified-recurrence";
import { addSimplifiedItemSql, createSimplifiedDraftSql, type SetupSqlTx } from "./setup-sql";
import { writeSimplifiedOccurrencesSql } from "./generate-sql";
import { createSimplifiedRevisionSql, disableSimplifiedItemSql, updateSimplifiedItemSql } from "./revision-sql";

type SetupDb = { transaction<T>(work: (tx: SetupSqlTx) => Promise<T>): Promise<T> };
function rows(result: unknown): any[] {
  if (!Array.isArray(result) || !Array.isArray(result[0])) throw new Error("تعذر قراءة بيانات الصيانة المجدولة");
  return result[0];
}

export class SimplifiedSqlTransaction implements SimplifiedSetupTx {
  constructor(private readonly tx: SetupSqlTx) {}
  private async select(query: Parameters<SetupSqlTx["execute"]>[0]) { return rows(await this.tx.execute(query)); }
  async validateActor(actor: SetupActor) {
    if (!canManagePmv2Foundation(actor.role)) return false;
    const data = await this.select(sql`SELECT id FROM users WHERE id=${actor.id} AND isActive=1 AND role=${actor.role} FOR UPDATE`);
    return !!data[0];
  }
  async validateSiteSection(siteId: number, sectionId: number) {
    const data = await this.select(sql`SELECT s.id FROM sections s INNER JOIN sites p ON p.id=s.siteId
      WHERE s.id=${sectionId} AND s.siteId=${siteId} AND s.isActive=1 AND p.isActive=1 FOR UPDATE`);
    return !!data[0];
  }
  async validateTeam(teamId: number) {
    const team = await this.select(sql`SELECT t.id FROM maintenance_teams t INNER JOIN warehouses w ON w.id=t.warehouseId
      WHERE t.id=${teamId} AND t.isActive=1 AND w.type='branch' AND w.isActive=1 FOR UPDATE`);
    if (!team[0]) return false;
    const members = await this.select(sql`SELECT m.userId FROM maintenance_team_members m INNER JOIN users u ON u.id=m.userId
      WHERE m.teamId=${teamId} AND m.isActive=1 AND u.isActive=1 AND u.role IN ('technician','it_manager','it_member') FOR UPDATE`);
    return members.length > 0;
  }
  async createDraft(input: SetupBase, actorId: number) { return createSimplifiedDraftSql(this.tx, input, actorId); }
  private async currentProgramId(planId: number) {
    const [revision] = await this.select(sql`SELECT programId FROM pmv2_simplified_plan_revisions
      WHERE planId=${planId} ORDER BY revisionNumber DESC LIMIT 1 FOR UPDATE`);
    return revision ? Number(revision.programId) : planId;
  }
  async lockPlan(planId: number, nextTeamId?: number): Promise<SetupPlan | null> {
    // Acquire the shared teams in ID order before locking the plan.
    const [identity] = await this.select(sql`SELECT l.maintenanceTeamId AS teamId
      FROM pmv2_simplified_plans s INNER JOIN pmv2_programs p ON p.id=COALESCE((
        SELECT r.programId FROM pmv2_simplified_plan_revisions r
        WHERE r.planId=s.programId ORDER BY r.revisionNumber DESC LIMIT 1
      ), s.programId)
      INNER JOIN pmv2_unified_team_links l ON l.pmv2TeamId=p.teamId WHERE s.programId=${planId}`);
    if (!identity) return null;
    const teamIds = Array.from(new Set([Number(identity.teamId), ...(nextTeamId ? [nextTeamId] : [])])).sort((a, b) => a - b);
    for (const teamId of teamIds) {
      await this.select(sql`SELECT id FROM maintenance_teams WHERE id=${teamId} FOR UPDATE`);
    }
    const [plan] = await this.select(sql`SELECT programId AS id,state,DATE_FORMAT(pausedOn,'%Y-%m-%d') AS pausedOn,siteId,sectionId
      FROM pmv2_simplified_plans WHERE programId=${planId} FOR UPDATE`);
    if (!plan) return null;
    const programId = await this.currentProgramId(planId);
    const [current] = await this.select(sql`SELECT l.maintenanceTeamId AS teamId FROM pmv2_programs p
      INNER JOIN pmv2_unified_team_links l ON l.pmv2TeamId=p.teamId WHERE p.id=${programId} FOR UPDATE`);
    if (!current || !teamIds.includes(Number(current.teamId))) throw new Error("تغير فريق المهمة. أعد فتح الخطة وحاول مجددًا");
    return {
      id: Number(plan.id), state: plan.state, pausedOn: plan.pausedOn ?? null,
      teamId: Number(current.teamId), siteId: Number(plan.siteId), sectionId: Number(plan.sectionId),
    };
  }
  async revisePlan(planId: number, input: SetupBase | null, effectiveOn: string, actorId: number) {
    const programId = await this.currentProgramId(planId);
    await createSimplifiedRevisionSql(this.tx, planId, programId, input, effectiveOn, actorId);
  }
  async addItem(planId: number, item: SetupItem, schedule: ReturnType<typeof buildSimplifiedSchedule>, actorId: number, effectiveOn?: string) {
    return addSimplifiedItemSql(this.tx, planId, item, schedule, actorId, effectiveOn ?? null);
  }
  async updateItem(planId: number, itemId: number, item: SetupItem, schedule: ReturnType<typeof buildSimplifiedSchedule>, effectiveOn: string, actorId: number) {
    return updateSimplifiedItemSql(this.tx, planId, itemId, item, schedule, effectiveOn, actorId);
  }
  async disableItem(planId: number, itemId: number) {
    return disableSimplifiedItemSql(this.tx, planId, itemId);
  }
  async listItems(planId: number, dates?: { from: string; to: string }): Promise<PausedScheduleItem[]> {
    const data = await this.select(sql`SELECT i.id,i.frequency,i.frequencyValue,i.weekday,i.monthDay,
      DATE_FORMAT(i.anchorDate,'%Y-%m-%d') AS anchorDate,i.scheduleConfigJson,i.isActive,m.kind,
      DATE_FORMAT(m.effectiveOn,'%Y-%m-%d') AS effectiveOn
      FROM pmv2_simplified_plans s INNER JOIN pmv2_programs p ON p.id=s.programId
      INNER JOIN pmv2_checklist_items i ON i.checklistId=p.checklistId
      INNER JOIN pmv2_simplified_item_modes m ON m.checklistItemId=i.id
      WHERE s.programId=${planId} ORDER BY i.sortOrder,i.id FOR UPDATE`);
    const generated = dates ? await this.select(sql`SELECT i.sourceChecklistItemId AS itemId,DATE_FORMAT(i.scheduledDate,'%Y-%m-%d') AS scheduledDate
      FROM pmv2_tasks t INNER JOIN pmv2_task_items i ON i.taskId=t.id
      WHERE (t.programId=${planId} OR t.programId IN (
        SELECT programId FROM pmv2_simplified_plan_revisions WHERE planId=${planId}
      )) AND i.scheduledDate>=${dates.from} AND i.scheduledDate<=${dates.to} FOR UPDATE`) : [];
    const grouped = new Map<number, string[]>();
    for (const row of generated) { const id = Number(row.itemId); const current = grouped.get(id) ?? []; current.push(String(row.scheduledDate)); grouped.set(id,current); }
    return data.map(row => ({ id: Number(row.id), kind: row.kind as SimplifiedRecurrenceKind, effectiveOn: row.effectiveOn ?? null, generatedDates: grouped.get(Number(row.id)) ?? [], schedule: {
      frequency: row.frequency, frequencyValue: row.frequencyValue == null ? null : Number(row.frequencyValue), weekday: row.weekday == null ? null : Number(row.weekday),
      monthDay: row.monthDay == null ? null : Number(row.monthDay), anchorDate: row.anchorDate ?? null, scheduleConfigJson: row.scheduleConfigJson ?? null, isActive: Number(row.isActive) === 1,
    } }));
  }
  async generate(planId: number, date: string, occurrences: readonly ResumeOccurrence[]) {
    await writeSimplifiedOccurrencesSql(this.tx, planId, date, occurrences);
  }
  // The legacy scheduler must never process these programs, including during rollback.
  // Their actual state lives in pmv2_simplified_plans.
  async activate(planId: number, date: string) {
    const items = await this.listItems(planId);
    await writeSimplifiedOccurrencesSql(this.tx, planId, date, planResumeOccurrences(items,date,date));
    await this.tx.execute(sql`UPDATE pmv2_simplified_plans SET state='active',pausedOn=NULL WHERE programId=${planId} AND state='draft'`);
  }
  async pause(planId: number, date: string) {
    await this.tx.execute(sql`UPDATE pmv2_programs SET isActive=0 WHERE id=${planId}`);
    await this.tx.execute(sql`UPDATE pmv2_simplified_plans SET state='paused',pausedOn=${date} WHERE programId=${planId} AND state='active'`);
  }
  async resume(planId: number, date: string, occurrences: readonly ResumeOccurrence[]) {
    await writeSimplifiedOccurrencesSql(this.tx, planId,date,occurrences);
    await this.tx.execute(sql`UPDATE pmv2_simplified_plans SET state='active',pausedOn=NULL WHERE programId=${planId} AND state='paused'`);
  }
  async audit(event: SetupAudit) {
    await this.tx.execute(sql`UPDATE pmv2_simplified_plans SET updatedById=${event.actorId} WHERE programId=${event.planId}`);
    await this.tx.execute(sql`INSERT INTO audit_logs (userId,action,entityType,entityId,newValues) VALUES
      (${event.actorId},${`pmv2.${event.action}`},'pmv2.program',${event.planId},${JSON.stringify(event.details ?? {})})`);
  }
}

export class SimplifiedSqlRepository implements SimplifiedSetupRepository {
  constructor(private readonly load: () => Promise<SetupDb>) {}
  transaction<T>(work: (tx: SimplifiedSetupTx) => Promise<T>): Promise<T> {
    return this.load().then(db => db.transaction(tx => work(new SimplifiedSqlTransaction(tx))));
  }
}

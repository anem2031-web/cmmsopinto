import { sql } from "drizzle-orm";
import { canManagePmv2Foundation } from "../security/policy";
import { planResumeOccurrences, type ResumeOccurrence } from "../scheduler/resume-plan";
import type { PausedScheduleItem, SimplifiedRecurrenceKind } from "../scheduler/pause-recovery";
import type { SetupActor, SetupAudit, SetupBase, SetupItem, SetupPlan, SimplifiedSetupRepository, SimplifiedSetupTx } from "./setup-service";
import type { buildSimplifiedSchedule } from "../checklists/simplified-recurrence";
import { addSimplifiedItemSql, createSimplifiedDraftSql, type SetupSqlTx } from "./setup-sql";
import { writeSimplifiedOccurrencesSql } from "./generate-sql";

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
  async lockPlan(planId: number): Promise<SetupPlan | null> {
    // Lock the authoritative team first, matching team-management lock order.
    const identity = await this.select(sql`SELECT l.maintenanceTeamId AS teamId FROM pmv2_simplified_plans s
      INNER JOIN pmv2_programs p ON p.id=s.programId INNER JOIN pmv2_unified_team_links l ON l.pmv2TeamId=p.teamId WHERE s.programId=${planId}`);
    if (!identity[0]) return null;
    await this.select(sql`SELECT id FROM maintenance_teams WHERE id=${Number(identity[0].teamId)} FOR UPDATE`);
    const data = await this.select(sql`SELECT s.programId AS id,s.state,DATE_FORMAT(s.pausedOn,'%Y-%m-%d') AS pausedOn,s.siteId,s.sectionId,
      l.maintenanceTeamId AS teamId FROM pmv2_simplified_plans s INNER JOIN pmv2_programs p ON p.id=s.programId
      INNER JOIN pmv2_unified_team_links l ON l.pmv2TeamId=p.teamId WHERE s.programId=${planId} FOR UPDATE`);
    return data[0] ? { id: Number(data[0].id), state: data[0].state, pausedOn: data[0].pausedOn ?? null, teamId: Number(data[0].teamId), siteId: Number(data[0].siteId), sectionId: Number(data[0].sectionId) } : null;
  }
  async addItem(planId: number, item: SetupItem, schedule: ReturnType<typeof buildSimplifiedSchedule>, actorId: number) {
    return addSimplifiedItemSql(this.tx, planId, item, schedule, actorId);
  }
  async listItems(planId: number, dates?: { from: string; to: string }): Promise<PausedScheduleItem[]> {
    const data = await this.select(sql`SELECT i.id,i.frequency,i.frequencyValue,i.weekday,i.monthDay,
      DATE_FORMAT(i.anchorDate,'%Y-%m-%d') AS anchorDate,i.scheduleConfigJson,i.isActive,m.kind
      FROM pmv2_simplified_plans s INNER JOIN pmv2_programs p ON p.id=s.programId
      INNER JOIN pmv2_checklist_items i ON i.checklistId=p.checklistId
      INNER JOIN pmv2_simplified_item_modes m ON m.checklistItemId=i.id
      WHERE s.programId=${planId} ORDER BY i.sortOrder,i.id`);
    const generated = dates ? await this.select(sql`SELECT i.sourceChecklistItemId AS itemId,DATE_FORMAT(i.scheduledDate,'%Y-%m-%d') AS scheduledDate
      FROM pmv2_tasks t INNER JOIN pmv2_task_items i ON i.taskId=t.id
      WHERE t.programId=${planId} AND i.scheduledDate>=${dates.from} AND i.scheduledDate<=${dates.to}`) : [];
    const grouped = new Map<number, string[]>();
    for (const row of generated) { const id = Number(row.itemId); const current = grouped.get(id) ?? []; current.push(String(row.scheduledDate)); grouped.set(id,current); }
    return data.map(row => ({ id: Number(row.id), kind: row.kind as SimplifiedRecurrenceKind, generatedDates: grouped.get(Number(row.id)) ?? [], schedule: {
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

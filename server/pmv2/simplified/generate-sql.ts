import { sql, type SQL } from "drizzle-orm";
import { formatPmv2ChecklistScheduleLabel } from "../checklists/schedule-config";
import { buildPmv2TaskNumber } from "../scheduler/utils";
import type { ResumeOccurrence } from "../scheduler/resume-plan";
import type { SetupSqlTx } from "./setup-sql";

function rows(result: unknown): any[] {
  if (!Array.isArray(result) || !Array.isArray(result[0])) throw new Error("تعذر قراءة بيانات الجدولة");
  return result[0];
}
function inserted(result: unknown): number {
  const id = Number(Array.isArray(result) ? (result[0] as any)?.insertId : undefined);
  if (!Number.isSafeInteger(id) || id < 1) throw new Error("تعذر إنشاء المهمة المجدولة");
  return id;
}
function ids(values: readonly number[]): SQL { return sql.join(values.map(value => sql`${value}`), sql`, `); }

/**
 * The caller must hold the program lock and include this entire operation in
 * the state-change/scheduler transaction. No network, global DB, or new tx.
 */
export async function writeSimplifiedOccurrencesSql(tx: SetupSqlTx, programId: number, taskDate: string, occurrences: readonly ResumeOccurrence[]) {
  if (!occurrences.length) return { taskId: null, createdItems: 0 };
  const planRows = rows(await tx.execute(sql`SELECT p.id,p.checklistId,t.id AS targetId,link.maintenanceTeamId,mt.warehouseId FROM pmv2_programs p
    INNER JOIN pmv2_simplified_plans s ON s.programId=p.id
    INNER JOIN pmv2_program_targets t ON t.programId=p.id AND t.sectionId=s.sectionId
    INNER JOIN pmv2_unified_team_links link ON link.pmv2TeamId=p.teamId
    INNER JOIN maintenance_teams mt ON mt.id=link.maintenanceTeamId
    WHERE p.id=${programId} FOR UPDATE`));
  if (planRows.length !== 1) throw new Error("بيانات المهمة الرئيسية غير مكتملة");
  const plan = planRows[0];
  const distinctIds = Array.from(new Set(occurrences.map(row => row.itemId)));
  if (distinctIds.some(id => !Number.isSafeInteger(id) || id <= 0)) throw new Error("معرف مهمة فرعية غير صالح");
  const itemRows = rows(await tx.execute(sql`SELECT i.*,m.kind FROM pmv2_checklist_items i
    INNER JOIN pmv2_simplified_item_modes m ON m.checklistItemId=i.id
    WHERE i.checklistId=${Number(plan.checklistId)} AND i.id IN (${ids(distinctIds)}) AND i.isActive=1`));
  const itemById = new Map(itemRows.map(item => [Number(item.id), item]));
  if (itemById.size !== distinctIds.length || occurrences.some(occurrence => itemById.get(occurrence.itemId)?.kind !== occurrence.kind)) {
    throw new Error("مهمة فرعية لا تنتمي للمهمة الرئيسية أو تغير جدولها");
  }
  const translationRows = rows(await tx.execute(sql`SELECT entityId,languageCode,translatedText FROM entity_translations
    WHERE entityType='PMV2_CHECKLIST_ITEM' AND fieldName='title' AND languageCode IN ('en','ur')
      AND translationStatus IN ('approved','completed') AND entityId IN (${ids(distinctIds)}) ORDER BY id DESC`));
  const translations = new Map<string, string>();
  for (const row of translationRows) {
    const key = `${Number(row.entityId)}:${String(row.languageCode)}`;
    if (!translations.has(key) && typeof row.translatedText === 'string' && row.translatedText.trim()) translations.set(key, row.translatedText.trim());
  }
  const taskRows = rows(await tx.execute(sql`SELECT id,status,teamId FROM pmv2_tasks WHERE programId=${programId}
    AND programTargetId=${Number(plan.targetId)} AND dueDate=${taskDate} FOR UPDATE`));
  let taskId = Number(taskRows[0]?.id ?? 0);
  const oldStatus = taskRows[0]?.status;
  if (oldStatus === 'cancelled') throw new Error("المهمة المجدولة لهذا اليوم ملغاة وتحتاج مراجعة");
  if (!taskId) {
    const current = rows(await tx.execute(sql`SELECT link.pmv2TeamId FROM pmv2_unified_team_links link
      INNER JOIN pmv2_teams team ON team.id=link.pmv2TeamId AND team.isActive=1
      WHERE link.maintenanceTeamId=${Number(plan.maintenanceTeamId)} AND team.warehouseId=${Number(plan.warehouseId)} FOR UPDATE`));
    if (current.length !== 1) throw new Error("مستودع فريق الصيانة يحتاج مراجعة قبل توليد المهام");
    const taskNumber = buildPmv2TaskNumber(taskDate, programId, Number(plan.targetId));
    taskId = inserted(await tx.execute(sql`INSERT INTO pmv2_tasks (programId,programTargetId,teamId,taskNumber,dueDate,status)
      VALUES (${programId},${Number(plan.targetId)},${Number(current[0].pmv2TeamId)},${taskNumber},${taskDate},'pending')`));
    await tx.execute(sql`INSERT INTO audit_logs (action,entityType,entityId,newValues)
      VALUES ('pmv2.task.generated','pmv2.task',${taskId},${JSON.stringify({ programId, dueDate: taskDate })})`);
  }
  let createdItems = 0;
  for (const occurrence of occurrences) {
    const item = itemById.get(occurrence.itemId)!;
    const existing = rows(await tx.execute(sql`SELECT id FROM pmv2_task_items WHERE taskId=${taskId}
      AND sourceChecklistItemId=${occurrence.itemId} AND scheduledDate=${occurrence.scheduledDate}`));
    if (existing.length) continue;
    const sort = occurrence.kind === 'daily' ? Number(item.sortOrder) : -1;
    const label = formatPmv2ChecklistScheduleLabel(item);
    const taskItemId = inserted(await tx.execute(sql`INSERT INTO pmv2_task_items
      (taskId,sourceChecklistItemId,titleSnapshot,sortOrderSnapshot,frequencySnapshot,frequencyValueSnapshot,weekdaySnapshot,monthDaySnapshot,anchorDateSnapshot,recurrenceLabelSnapshot,scheduledDate,status)
      VALUES (${taskId},${occurrence.itemId},${item.title},${sort},${item.frequency},${item.frequencyValue},${item.weekday},${item.monthDay},${item.anchorDate},${label},${occurrence.scheduledDate},'pending')`));
    for (const language of ['en', 'ur'] as const) {
      const text = translations.get(`${occurrence.itemId}:${language}`);
      if (!text) continue;
      const translationId = inserted(await tx.execute(sql`INSERT INTO entity_translations
        (entityType,entityId,fieldName,languageCode,translatedText,translationStatus,versionNumber)
        VALUES ('PMV2_TASK_ITEM',${taskItemId},'titleSnapshot',${language},${text},'approved',1)`));
      await tx.execute(sql`INSERT INTO translation_versions (entityTranslationId,versionNumber,translatedText,translationStatus,changeReason)
        VALUES (${translationId},1,${text},'approved','source_snapshot')`);
    }
    await tx.execute(sql`INSERT INTO audit_logs (action,entityType,entityId,newValues)
      VALUES ('pmv2.task_item.generated','pmv2.task_item',${taskItemId},${JSON.stringify({ programId, taskId, sourceChecklistItemId: occurrence.itemId, scheduledDate: occurrence.scheduledDate })})`);
    createdItems += 1;
  }
  if (createdItems && oldStatus === 'completed') {
    await tx.execute(sql`UPDATE pmv2_tasks SET status='in_progress' WHERE id=${taskId} AND status='completed'`);
  }
  return { taskId, createdItems };
}

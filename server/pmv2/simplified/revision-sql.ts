import { sql } from "drizzle-orm";
import type { SetupBase, SetupItem } from "./setup-service";
import type { buildSimplifiedSchedule } from "../checklists/simplified-recurrence";
import {
  resolveSimplifiedTeamSql,
  setupInsertId,
  setupRows,
  writeSimplifiedApprovedTitles,
  type SetupSqlTx,
} from "./setup-sql";

/** Seal the previous program and target for the execution rows that reference them. */
export async function createSimplifiedRevisionSql(
  tx: SetupSqlTx,
  planId: number,
  currentProgramId: number,
  input: SetupBase | null,
  effectiveOn: string,
  actorId: number,
): Promise<number> {
  let revisionNumber = 1;
  if (currentProgramId !== planId) {
    const [revision] = setupRows(await tx.execute(sql`
      SELECT revisionNumber FROM pmv2_simplified_plan_revisions
      WHERE planId=${planId} AND programId=${currentProgramId} FOR UPDATE`));
    if (!revision) throw new Error("المهمة الرئيسية غير موجودة");
    revisionNumber = Number(revision.revisionNumber) + 1;
  }
  const [plan] = setupRows(await tx.execute(sql`
    SELECT p.title, p.teamId, p.checklistId, s.sectionId
    FROM pmv2_simplified_plans s
    INNER JOIN pmv2_programs p ON p.id=${currentProgramId}
    WHERE s.programId=${planId} FOR UPDATE`));
  if (!plan) throw new Error("المهمة الرئيسية غير موجودة");

  const title = input?.title ?? plan.title;
  const teamId = input ? await resolveSimplifiedTeamSql(tx, input.teamId, actorId) : Number(plan.teamId);
  const sectionId = input?.sectionId ?? Number(plan.sectionId);
  const revisionId = setupInsertId(await tx.execute(sql`INSERT INTO pmv2_programs (title,teamId,checklistId,isActive,createdById)
    VALUES (${title},${teamId},${Number(plan.checklistId)},0,${actorId})`));
  await tx.execute(sql`INSERT INTO pmv2_program_targets (programId,sectionId) VALUES (${revisionId},${sectionId})`);
  await tx.execute(sql`INSERT INTO pmv2_simplified_plan_revisions (programId,planId,revisionNumber,effectiveOn)
    VALUES (${revisionId},${planId},${revisionNumber},${effectiveOn})`);
  if (input) {
    await tx.execute(sql`UPDATE pmv2_simplified_plans
      SET siteId=${input.siteId}, sectionId=${sectionId} WHERE programId=${planId}`);
    await writeSimplifiedApprovedTitles(tx, "PMV2_PROGRAM", revisionId, input.titleEn, input.titleUr, actorId);
  } else {
    const translations = setupRows(await tx.execute(sql`SELECT languageCode,translatedText FROM entity_translations
      WHERE entityType='PMV2_PROGRAM' AND entityId=${currentProgramId} AND fieldName='title'
        AND languageCode IN ('en','ur') AND translationStatus IN ('approved','completed')
      ORDER BY id DESC FOR UPDATE`));
    const saved = new Map<string, string>();
    for (const row of translations) {
      if (!saved.has(row.languageCode) && typeof row.translatedText === "string" && row.translatedText.trim()) {
        saved.set(row.languageCode, row.translatedText);
      }
    }
    await writeSimplifiedApprovedTitles(tx, "PMV2_PROGRAM", revisionId, saved.get("en"), saved.get("ur"), actorId);
  }
  return revisionId;
}

async function lockActiveSimplifiedItem(tx: SetupSqlTx, planId: number, itemId: number) {
  const [item] = setupRows(await tx.execute(sql`
    SELECT i.id FROM pmv2_simplified_plans s
    INNER JOIN pmv2_programs p ON p.id=s.programId
    INNER JOIN pmv2_checklist_items i ON i.checklistId=p.checklistId
    INNER JOIN pmv2_simplified_item_modes m ON m.checklistItemId=i.id
    WHERE s.programId=${planId} AND i.id=${itemId} AND i.isActive=1
    FOR UPDATE`));
  return Boolean(item);
}

export async function updateSimplifiedItemSql(
  tx: SetupSqlTx,
  planId: number,
  itemId: number,
  item: SetupItem,
  schedule: ReturnType<typeof buildSimplifiedSchedule>,
  effectiveOn: string,
  actorId: number,
): Promise<boolean> {
  if (!await lockActiveSimplifiedItem(tx, planId, itemId)) return false;
  await tx.execute(sql`UPDATE pmv2_checklist_items
    SET title=${item.titleAr}, frequency=${schedule.frequency}, frequencyValue=${schedule.frequencyValue},
        weekday=${schedule.weekday}, monthDay=${schedule.monthDay}, anchorDate=${schedule.anchorDate},
        scheduleConfigJson=${schedule.scheduleConfigJson}
    WHERE id=${itemId} AND isActive=1`);
  await tx.execute(sql`UPDATE pmv2_simplified_item_modes
    SET kind=${schedule.kind}, effectiveOn=${effectiveOn} WHERE checklistItemId=${itemId}`);
  await writeSimplifiedApprovedTitles(tx, "PMV2_CHECKLIST_ITEM", itemId, item.titleEn, item.titleUr, actorId, true);
  return true;
}

export async function disableSimplifiedItemSql(tx: SetupSqlTx, planId: number, itemId: number): Promise<boolean> {
  if (!await lockActiveSimplifiedItem(tx, planId, itemId)) return false;
  await tx.execute(sql`UPDATE pmv2_checklist_items SET isActive=0 WHERE id=${itemId} AND isActive=1`);
  return true;
}

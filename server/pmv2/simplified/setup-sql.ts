import { sql, type SQL } from "drizzle-orm";
import type { SetupBase, SetupItem } from "./setup-service";
import type { buildSimplifiedSchedule } from "../checklists/simplified-recurrence";

/** A caller owns the transaction and runs authorization at the RPC boundary. */
export interface SetupSqlTx { execute(query: SQL): Promise<unknown> }
export function setupRows(result: unknown): any[] {
  if (!Array.isArray(result) || !Array.isArray(result[0])) throw new Error("تعذر قراءة بيانات المهمة");
  return result[0];
}
export function setupInsertId(result: unknown): number {
  const id = Number(Array.isArray(result) ? (result[0] as any)?.insertId : undefined);
  if (!Number.isSafeInteger(id) || id < 1) throw new Error("تعذر حفظ بيانات المهمة");
  return id;
}

/**
 * Creates the existing PMV2 program/checklist/target and the simplified draft
 * metadata together. No nested transaction, no external calls, no backfill.
 * Requires the manual draft schema only after the complete feature is ready.
 */
export async function createSimplifiedDraftSql(tx: SetupSqlTx, input: SetupBase, actorId: number): Promise<number> {
  const selected = setupRows(await tx.execute(sql`SELECT s.id FROM sections s INNER JOIN sites p ON p.id=s.siteId
    WHERE s.id=${input.sectionId} AND s.siteId=${input.siteId} AND s.isActive=1 AND p.isActive=1 FOR UPDATE`));
  if (!selected[0]) throw new Error("القسم غير مرتبط بالموقع أو غير نشط");
  const pmv2TeamId = await resolveSimplifiedTeamSql(tx, input.teamId, actorId);
  const checklistId = setupInsertId(await tx.execute(sql`INSERT INTO pmv2_checklists (name,isActive,createdById)
    VALUES (${input.title},1,${actorId})`));
  const programId = setupInsertId(await tx.execute(sql`INSERT INTO pmv2_programs (title,teamId,checklistId,isActive,createdById)
    VALUES (${input.title},${pmv2TeamId},${checklistId},0,${actorId})`));
  await tx.execute(sql`INSERT INTO pmv2_program_targets (programId,sectionId) VALUES (${programId},${input.sectionId})`);
  await tx.execute(sql`INSERT INTO pmv2_simplified_plans (programId,siteId,sectionId,state,createdById,updatedById)
    VALUES (${programId},${input.siteId},${input.sectionId},'draft',${actorId},${actorId})`);
  await writeSimplifiedApprovedTitles(tx, 'PMV2_PROGRAM', programId, input.titleEn, input.titleUr, actorId);
  return programId;
}

export async function resolveSimplifiedTeamSql(tx: SetupSqlTx, teamId: number, actorId: number) {
  const teamRows = setupRows(await tx.execute(sql`SELECT t.id,t.name,t.warehouseId FROM maintenance_teams t
    INNER JOIN warehouses w ON w.id=t.warehouseId AND w.type='branch' AND w.isActive=1
    WHERE t.id=${teamId} AND t.isActive=1 FOR UPDATE`));
  const team = teamRows[0];
  if (!team) throw new Error("فريق الصيانة أو مستودعه غير متاح");
  const members = setupRows(await tx.execute(sql`SELECT m.userId FROM maintenance_team_members m INNER JOIN users u ON u.id=m.userId
    WHERE m.teamId=${teamId} AND m.isActive=1 AND u.isActive=1 AND u.role IN ('technician','it_manager','it_member') FOR UPDATE`));
  if (!members.length) throw new Error("لا يوجد عضو نشط صالح في فريق الصيانة");

  return ensurePmv2TeamWarehouseLinkSql(tx, teamId, Number(team.warehouseId), String(team.name), actorId);
}

/** Caller holds the maintenance-team lock and owns this transaction. */
export async function ensurePmv2TeamWarehouseLinkSql(tx: SetupSqlTx, maintenanceTeamId: number, warehouseId: number, teamName: string, actorId: number): Promise<number> {
  const links = setupRows(await tx.execute(sql`SELECT link.pmv2TeamId,p.isActive FROM pmv2_unified_team_links link
    INNER JOIN pmv2_teams p ON p.id=link.pmv2TeamId WHERE link.maintenanceTeamId=${maintenanceTeamId} AND p.warehouseId=${warehouseId} FOR UPDATE`));
  if (links.length > 1) throw new Error("توجد روابط مكررة للفريق والمستودع");
  if (links[0]) { if (Number(links[0].isActive) !== 1) throw new Error("رابط الفريق للمستودع غير نشط"); return Number(links[0].pmv2TeamId); }
  const specialtyCode = `MTEAM-${maintenanceTeamId}`;
  const specialties = setupRows(await tx.execute(sql`SELECT id,isActive FROM pmv2_specialties WHERE code=${specialtyCode} FOR UPDATE`));
  let specialtyId = Number(specialties[0]?.id ?? 0);
  if (specialtyId && Number(specialties[0].isActive) !== 1) throw new Error("تخصص فريق الصيانة غير نشط");
  if (!specialtyId) specialtyId = setupInsertId(await tx.execute(sql`INSERT INTO pmv2_specialties (code,name,isActive,createdById) VALUES (${specialtyCode},${teamName},1,${actorId})`));
  const teamCode = `MTEAM-${maintenanceTeamId}-W${warehouseId}`;
  const pmv2TeamId = setupInsertId(await tx.execute(sql`INSERT INTO pmv2_teams (specialtyId,code,warehouseId,isActive) VALUES (${specialtyId},${teamCode},${warehouseId},1)`));
  await tx.execute(sql`INSERT INTO pmv2_unified_team_links (pmv2TeamId,maintenanceTeamId,createdById) VALUES (${pmv2TeamId},${maintenanceTeamId},${actorId})`);
  return pmv2TeamId;
}

type ApprovedTitleEntity = "PMV2_PROGRAM" | "PMV2_CHECKLIST_ITEM";

/** Caller serializes writes to this plan. Only the source title is updated. */
export async function writeSimplifiedApprovedTitles(
  tx: SetupSqlTx,
  entityType: ApprovedTitleEntity,
  entityId: number,
  titleEn: string | undefined,
  titleUr: string | undefined,
  actorId: number,
  updateExisting = false,
) {
  for (const [language, title] of [["en", titleEn], ["ur", titleUr]] as const) {
    if (!title) continue;
    const existing = updateExisting ? setupRows(await tx.execute(sql`
      SELECT id, versionNumber, translatedText, translationStatus
      FROM entity_translations
      WHERE entityType=${entityType} AND entityId=${entityId} AND fieldName='title' AND languageCode=${language}
      ORDER BY id DESC LIMIT 1 FOR UPDATE`))[0] : undefined;
    if (existing?.translationStatus === "approved" && existing.translatedText === title) continue;

    const version = existing ? Number(existing.versionNumber) + 1 : 1;
    const translationId = existing
      ? Number(existing.id)
      : setupInsertId(await tx.execute(sql`
          INSERT INTO entity_translations
            (entityType,entityId,fieldName,languageCode,translatedText,translationStatus,versionNumber,approvedById,approvedAt)
          VALUES (${entityType},${entityId},'title',${language},${title},'approved',${version},${actorId},CURRENT_TIMESTAMP)`));
    if (existing) {
      await tx.execute(sql`UPDATE entity_translations
        SET translatedText=${title}, translationStatus='approved', versionNumber=${version},
            approvedById=${actorId}, approvedAt=CURRENT_TIMESTAMP
        WHERE id=${translationId}`);
    }
    await tx.execute(sql`INSERT INTO translation_versions
      (entityTranslationId,versionNumber,translatedText,translationStatus,changedById,changeReason)
      VALUES (${translationId},${version},${title},'approved',${actorId},'manual_edit')`);
  }
}

/** Add the validated titles and schedule in the caller's transaction. */
export async function addSimplifiedItemSql(
  tx: SetupSqlTx,
  planId: number,
  item: SetupItem,
  schedule: ReturnType<typeof buildSimplifiedSchedule>,
  actorId: number,
  effectiveOn: string | null = null,
): Promise<number> {
  const [plan] = setupRows(await tx.execute(sql`
    SELECT p.checklistId,s.state FROM pmv2_programs p
    INNER JOIN pmv2_simplified_plans s ON s.programId=p.id
    WHERE p.id=${planId} FOR UPDATE`));
  if (!plan || !["draft", "active", "paused"].includes(plan.state)) throw new Error("لا يمكن إضافة مهمة فرعية لهذه الحالة");
  const checklistId = Number(plan.checklistId);
  const [lastItem] = setupRows(await tx.execute(sql`
    SELECT sortOrder FROM pmv2_checklist_items WHERE checklistId=${checklistId}
    ORDER BY sortOrder DESC,id DESC LIMIT 1 FOR UPDATE`));
  const nextOrder = Number(lastItem?.sortOrder ?? 0) + 1;
  const itemId = setupInsertId(await tx.execute(sql`INSERT INTO pmv2_checklist_items
    (checklistId,title,sortOrder,isRequired,isActive,frequency,frequencyValue,weekday,monthDay,anchorDate,scheduleConfigJson)
    VALUES (${checklistId},${item.titleAr},${nextOrder},1,1,${schedule.frequency},${schedule.frequencyValue},${schedule.weekday},${schedule.monthDay},${schedule.anchorDate},${schedule.scheduleConfigJson})`));
  await tx.execute(sql`INSERT INTO pmv2_simplified_item_modes (checklistItemId,kind,effectiveOn) VALUES (${itemId},${schedule.kind},${effectiveOn})`);
  await writeSimplifiedApprovedTitles(tx, "PMV2_CHECKLIST_ITEM", itemId, item.titleEn, item.titleUr, actorId);
  return itemId;
}

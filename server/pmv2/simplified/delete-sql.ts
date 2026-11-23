import { sql, type SQL } from "drizzle-orm";
import { READ_SCOPE_CHUNK_SIZE, readScopeChunks } from "../../_core/authz/read-batch";
import type { DeleteSimplifiedPlanResult } from "./setup-service";
import { setupRows, type SetupSqlTx } from "./setup-sql";

const activityTables = [
  sql`pmv2_item_actions`,
  sql`pmv2_material_requests`,
  sql`pmv2_material_usages`,
  sql`pmv2_task_ticket_links`,
];

function idList(ids: number[]) {
  return sql.join(ids.map(id => sql`${id}`), sql`, `);
}

async function readRows(tx: SetupSqlTx, statement: SQL) {
  return setupRows(await tx.execute(statement));
}

async function writeBatches(tx: SetupSqlTx, ids: number[], build: (ids: SQL) => SQL) {
  for (let offset = 0; offset < ids.length; offset += READ_SCOPE_CHUNK_SIZE) {
    await tx.execute(build(idList(ids.slice(offset, offset + READ_SCOPE_CHUNK_SIZE))));
  }
}

type TranslationEntity = "PMV2_PROGRAM" | "PMV2_CHECKLIST" | "PMV2_CHECKLIST_ITEM" | "PMV2_TASK_ITEM";

async function deleteTranslations(tx: SetupSqlTx, entity: TranslationEntity, ids: number[]) {
  for (let offset = 0; offset < ids.length; offset += READ_SCOPE_CHUNK_SIZE) {
    const target = sql`entityType=${entity} AND entityId IN (${idList(ids.slice(offset, offset + READ_SCOPE_CHUNK_SIZE))})`;
    await tx.execute(sql`DELETE FROM translation_jobs WHERE ${target}`);
    await tx.execute(sql`DELETE FROM translation_versions WHERE entityTranslationId IN (
      SELECT id FROM entity_translations WHERE ${target}
    )`);
    await tx.execute(sql`DELETE FROM entity_translations WHERE ${target}`);
  }
}

/** The caller holds the same plan lock as the scheduler and owns this transaction. */
export async function deleteSimplifiedPlanSql(tx: SetupSqlTx, planId: number, today: string): Promise<DeleteSimplifiedPlanResult> {
  const [plan] = await readRows(tx, sql`SELECT p.checklistId
    FROM pmv2_simplified_plans s INNER JOIN pmv2_programs p ON p.id=s.programId
    WHERE s.programId=${planId} AND s.state<>'retired' FOR UPDATE`);
  if (!plan) throw new Error("المهمة الرئيسية غير موجودة");
  const checklistId = Number(plan.checklistId);
  const revisions = await readRows(tx, sql`SELECT programId FROM pmv2_simplified_plan_revisions
    WHERE planId=${planId} ORDER BY revisionNumber FOR UPDATE`);
  const programIds = [planId, ...revisions.map(row => Number(row.programId))].sort((a, b) => a - b);
  const programScope = new Set(programIds);

  // Match technician execution: lock every parent in scope before inspecting item state or references.
  const tasks = await readScopeChunks(programIds, chunk => readRows(tx, sql`SELECT id,status,
    DATE_FORMAT(dueDate,'%Y-%m-%d') AS dueDate FROM pmv2_tasks
    WHERE programId IN (${idList(chunk)}) ORDER BY id FOR UPDATE`));
  const taskIds = tasks.map(row => Number(row.id)).sort((a, b) => a - b);
  const items = await readScopeChunks(taskIds, chunk => readRows(tx, sql`SELECT id,taskId,status,result
    FROM pmv2_task_items WHERE taskId IN (${idList(chunk)}) ORDER BY id FOR UPDATE`));
  const itemToTask = new Map<number, number>(items.map(row => [Number(row.id), Number(row.taskId)]));
  const workedTasks = new Set(tasks.filter(row => row.status !== "pending").map(row => Number(row.id)));
  for (const item of items) {
    if (item.status !== "pending" || item.result != null) workedTasks.add(Number(item.taskId));
  }

  const remainingTasks = taskIds.filter(id => !workedTasks.has(id));
  const visits = await readScopeChunks(remainingTasks, chunk => readRows(tx, sql`SELECT taskId
    FROM pmv2_visits WHERE taskId IN (${idList(chunk)}) FOR UPDATE`));
  for (const row of visits) workedTasks.add(Number(row.taskId));

  for (const table of activityTables) {
    const remainingItems = items.filter(row => !workedTasks.has(Number(row.taskId))).map(row => Number(row.id));
    const references = await readScopeChunks(remainingItems, chunk => readRows(tx, sql`SELECT taskItemId
      FROM ${table} WHERE taskItemId IN (${idList(chunk)}) FOR UPDATE`));
    for (const row of references) workedTasks.add(itemToTask.get(Number(row.taskItemId))!);
  }

  const costTaskLinks = await readScopeChunks(remainingTasks.filter(id => !workedTasks.has(id)), chunk =>
    readRows(tx, sql`SELECT executionId FROM material_execution_cost_contexts
      WHERE executionSource='pmv2' AND executionId IN (${idList(chunk)}) FOR UPDATE`));
  for (const row of costTaskLinks) workedTasks.add(Number(row.executionId));

  const checklistPrograms = await readRows(tx, sql`SELECT p.id,s.programId AS rootPlanId
    FROM pmv2_programs p LEFT JOIN pmv2_simplified_plans s ON s.programId=p.id
    WHERE p.checklistId=${checklistId} ORDER BY p.id FOR UPDATE`);
  const ownedPrograms = checklistPrograms.filter(row => programScope.has(Number(row.id)));
  if (ownedPrograms.length !== programScope.size ||
      ownedPrograms.some(row => row.rootPlanId != null && Number(row.rootPlanId) !== planId)) {
    throw new Error("ارتباط سجلات المهمة الرئيسية غير صالح للحذف");
  }
  const sharedChecklist = checklistPrograms.length > ownedPrograms.length;

  if (workedTasks.size || sharedChecklist) {
    const future = tasks.filter(row => row.dueDate > today && !workedTasks.has(Number(row.id))).map(row => Number(row.id));
    await writeBatches(tx, future, ids => sql`UPDATE pmv2_tasks SET status='cancelled' WHERE id IN (${ids}) AND status='pending'`);
    await tx.execute(sql`UPDATE pmv2_simplified_plans SET state='retired',pausedOn=NULL WHERE programId=${planId}`);
    return { kind: "retired", cancelledFutureTasks: future.length };
  }

  const checklistItems = await readRows(tx, sql`SELECT id FROM pmv2_checklist_items
    WHERE checklistId=${checklistId} ORDER BY id FOR UPDATE`);
  const checklistItemIds = checklistItems.map(row => Number(row.id));

  // The existing alert sender does not record a notification ID. Delete the linked delivery records only.
  await writeBatches(tx, taskIds, ids => sql`DELETE FROM pmv2_alert_deliveries WHERE taskId IN (${ids})`);
  await deleteTranslations(tx, "PMV2_TASK_ITEM", Array.from(itemToTask.keys()));
  await deleteTranslations(tx, "PMV2_CHECKLIST_ITEM", checklistItemIds);
  await deleteTranslations(tx, "PMV2_CHECKLIST", [checklistId]);
  await deleteTranslations(tx, "PMV2_PROGRAM", programIds);
  await writeBatches(tx, taskIds, ids => sql`DELETE FROM pmv2_task_items WHERE taskId IN (${ids})`);
  await writeBatches(tx, taskIds, ids => sql`DELETE FROM pmv2_tasks WHERE id IN (${ids})`);
  await writeBatches(tx, programIds, ids => sql`DELETE FROM pmv2_program_targets WHERE programId IN (${ids})`);
  await tx.execute(sql`DELETE FROM pmv2_simplified_plan_revisions WHERE planId=${planId}`);
  await tx.execute(sql`DELETE FROM pmv2_simplified_plans WHERE programId=${planId}`);
  await writeBatches(tx, programIds, ids => sql`DELETE FROM pmv2_programs WHERE id IN (${ids})`);
  await writeBatches(tx, checklistItemIds, ids => sql`DELETE FROM pmv2_simplified_item_modes WHERE checklistItemId IN (${ids})`);
  await tx.execute(sql`DELETE FROM pmv2_checklist_items WHERE checklistId=${checklistId}`);
  await tx.execute(sql`DELETE FROM pmv2_checklists WHERE id=${checklistId}`);
  return { kind: "deleted", cancelledFutureTasks: 0 };
}

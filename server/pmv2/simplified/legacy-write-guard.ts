import { sql, type SQL } from "drizzle-orm";
import { isPmv2SimplifiedEnabled } from "./feature";

type Reader = { execute(query: SQL): Promise<unknown> };
function hasRows(result: unknown): boolean {
  if (!Array.isArray(result) || !Array.isArray(result[0])) throw new Error("تعذر التحقق من إعداد مهمة الصيانة");
  return result[0].length > 0;
}
/** Prevent legacy setup screens from changing simplified plans or their schedules. */
export async function isSimplifiedProgram(db: Reader, programId: number): Promise<boolean> {
  if (!isPmv2SimplifiedEnabled()) return false;
  return hasRows(await db.execute(sql`SELECT programId FROM pmv2_simplified_plans WHERE programId=${programId}
    UNION ALL SELECT programId FROM pmv2_simplified_plan_revisions WHERE programId=${programId} LIMIT 1`));
}
export async function isSimplifiedChecklist(db: Reader, checklistId: number): Promise<boolean> {
  if (!isPmv2SimplifiedEnabled()) return false;
  return hasRows(await db.execute(sql`SELECT s.programId FROM pmv2_simplified_plans s INNER JOIN pmv2_programs p ON p.id=s.programId WHERE p.checklistId=${checklistId} LIMIT 1`));
}

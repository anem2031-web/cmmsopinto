import { sql, type SQL } from "drizzle-orm";
import { isPmv2SimplifiedEnabled } from "../simplified/feature";
type Reader = { execute(query: SQL): Promise<unknown> };
function rows(value: unknown): any[] { if (!Array.isArray(value) || !Array.isArray(value[0])) throw new Error("تعذر التحقق من ربط فريق الصيانة"); return value[0]; }
/** Fail closed: linked identities must be managed through the real team. */
export async function isUnifiedTeam(db: Reader, pmv2TeamId: number) {
  if (!isPmv2SimplifiedEnabled()) return false;
  return rows(await db.execute(sql`SELECT pmv2TeamId FROM pmv2_unified_team_links WHERE pmv2TeamId=${pmv2TeamId} LIMIT 1`)).length > 0;
}
export async function isUnifiedSpecialty(db: Reader, specialtyId: number) {
  if (!isPmv2SimplifiedEnabled()) return false;
  return rows(await db.execute(sql`SELECT l.pmv2TeamId FROM pmv2_unified_team_links l INNER JOIN pmv2_teams t ON t.id=l.pmv2TeamId WHERE t.specialtyId=${specialtyId} LIMIT 1`)).length > 0;
}

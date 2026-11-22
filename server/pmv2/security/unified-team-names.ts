import { sql, type SQL } from "drizzle-orm";
import { isPmv2SimplifiedEnabled } from "../simplified/feature";
type Reader = { execute(query: SQL): Promise<unknown> };
/** Load names only for already-authorized task rows; never changes their scope. */
export async function loadUnifiedTeamNames(db: Reader, teamIds: readonly number[]): Promise<Map<number,string>> {
  const result = new Map<number,string>();
  if (!isPmv2SimplifiedEnabled()) return result;
  const ids = Array.from(new Set(teamIds));
  if (ids.some(id => !Number.isSafeInteger(id) || id < 1)) throw new Error("معرف الفريق غير صالح");
  for (let offset=0; offset<ids.length; offset+=500) {
    const chunk=ids.slice(offset,offset+500);
    const rows=await db.execute(sql`SELECT l.pmv2TeamId,t.name FROM pmv2_unified_team_links l
      INNER JOIN maintenance_teams t ON t.id=l.maintenanceTeamId WHERE l.pmv2TeamId IN (${sql.join(chunk.map(id=>sql`${id}`),sql`, `)})`);
    if (!Array.isArray(rows) || !Array.isArray(rows[0])) throw new Error("تعذر قراءة أسماء فرق الصيانة");
    for (const row of rows[0] as any[]) result.set(Number(row.pmv2TeamId),String(row.name));
  }
  return result;
}

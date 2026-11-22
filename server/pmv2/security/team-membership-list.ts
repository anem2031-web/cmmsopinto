import { sql, type SQL } from "drizzle-orm";

type SqlReader = { execute(query: SQL): Promise<unknown> };
export interface Pmv2MemberRow { teamId: number; userId: number; userName: string; teamCode: string }
export interface Pmv2MemberFilter { teamIds?: readonly number[]; userId?: number; roles?: readonly string[]; includeInactiveUsers?: boolean; includeInactiveTeams?: boolean }
function values(items: readonly (number | string)[]) { return sql.join(items.map(item => sql`${item}`), sql`, `); }

/** Current linked membership or the unlinked legacy membership, read in bounded batches. */
export async function listPmv2Members(db: SqlReader, filter: Pmv2MemberFilter = {}): Promise<Pmv2MemberRow[]> {
  const teamIds = filter.teamIds ? Array.from(new Set(filter.teamIds)) : null;
  if (teamIds?.some(id => !Number.isSafeInteger(id) || id < 1)) throw new Error("معرف الفريق غير صالح");
  if (filter.userId != null && (!Number.isSafeInteger(filter.userId) || filter.userId < 1)) throw new Error("معرف المستخدم غير صالح");
  if ((teamIds && !teamIds.length) || (filter.roles && !filter.roles.length)) return [];
  const chunks = teamIds ? Array.from({ length: Math.ceil(teamIds.length / 500) }, (_, i) => teamIds.slice(i * 500, (i + 1) * 500)) : [null];
  const output: Pmv2MemberRow[] = [];
  for (const chunk of chunks) {
    const teamLegacy = chunk ? sql`AND m.teamId IN (${values(chunk)})` : sql``;
    const teamLinked = chunk ? sql`AND l.pmv2TeamId IN (${values(chunk)})` : sql``;
    const user = filter.userId != null ? sql`AND u.id=${filter.userId}` : sql``;
    const roles = filter.roles ? sql`AND u.role IN (${values(filter.roles)})` : sql``;
    const userActive = filter.includeInactiveUsers ? sql`` : sql`AND u.isActive=1`;
    const teamActive = filter.includeInactiveTeams ? sql`` : sql`AND t.isActive=1`;
    const result = await db.execute(sql`
      SELECT m.teamId AS teamId,u.id AS userId,u.name AS userName,p.code AS teamCode
      FROM pmv2_team_members m INNER JOIN users u ON u.id=m.userId
      INNER JOIN pmv2_teams p ON p.id=m.teamId
      WHERE m.isActive=1 ${userActive} AND NOT EXISTS (SELECT 1 FROM pmv2_unified_team_links l WHERE l.pmv2TeamId=m.teamId)
      ${teamLegacy} ${user} ${roles}
      UNION ALL
      SELECT l.pmv2TeamId AS teamId,u.id AS userId,u.name AS userName,t.name AS teamCode
      FROM pmv2_unified_team_links l INNER JOIN maintenance_teams t ON t.id=l.maintenanceTeamId
      INNER JOIN maintenance_team_members m ON m.teamId=t.id AND m.isActive=1
      INNER JOIN users u ON u.id=m.userId
      WHERE 1=1 ${teamActive} ${userActive} ${teamLinked} ${user} ${roles}`);
    if (!Array.isArray(result) || !Array.isArray(result[0])) throw new Error("تعذر قراءة أعضاء فرق الصيانة");
    output.push(...result[0].map((row: any) => ({ teamId: Number(row.teamId), userId: Number(row.userId), userName: String(row.userName ?? ""), teamCode: String(row.teamCode ?? "") })));
  }
  return output;
}

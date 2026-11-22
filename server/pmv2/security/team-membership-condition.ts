import { sql, type SQL } from "drizzle-orm";
import type { AnyMySqlColumn } from "drizzle-orm/mysql-core";

/**
 * Only call after the manual unified-team migration is deployed.
 * Linked PMV2 teams use the current active membership of the original team.
 * Unlinked historical teams continue using their existing PMV2 memberships.
 * Account status and permitted execution role must be checked separately by
 * the existing authenticated actor guard, including at each write boundary.
 */
export function pmv2MembershipCondition(userId: number, teamId: number | AnyMySqlColumn): SQL {
  return sql`(
    EXISTS (
      SELECT 1 FROM pmv2_unified_team_links AS link
      INNER JOIN maintenance_teams AS team ON team.id = link.maintenanceTeamId AND team.isActive = 1
      INNER JOIN maintenance_team_members AS member ON member.teamId = team.id AND member.isActive = 1
      WHERE link.pmv2TeamId = ${teamId} AND member.userId = ${userId}
    )
    OR (
      NOT EXISTS (SELECT 1 FROM pmv2_unified_team_links AS link WHERE link.pmv2TeamId = ${teamId})
      AND EXISTS (SELECT 1 FROM pmv2_team_members AS member WHERE member.teamId = ${teamId} AND member.userId = ${userId} AND member.isActive = 1)
    )
  )`;
}

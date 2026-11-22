import { and, eq, inArray, or, sql } from "drizzle-orm";
import { alias, type AnyMySqlColumn } from "drizzle-orm/mysql-core";
import { pmv2TeamMembers, users } from "../../../drizzle/schema";
import { isPmv2SimplifiedEnabled } from "../simplified/feature";
import { pmv2MembershipCondition } from "./team-membership-condition";
import { isObserverReadScope, observerReadActorRole } from "../../_core/authz/observer-read-scope";
import {
  PMV2_ALL_TEAM_EXECUTION_ROLES,
  PMV2_TECHNICIAN_EXECUTION_ROLES,
  canRoleExecuteAllPmv2Teams,
} from "../../../shared/roles";

/** A singleton actor join avoids duplicating tasks and works for teams without members. */
export const pmv2ExecutionActor = alias(users, "pmv2ExecutionActor");

/** Safe JOIN ON predicate: TiDB does not support subqueries in ON. */
export function pmv2ExecutionActorCondition(userId: number) {
  return and(
    eq(pmv2ExecutionActor.id, userId),
    eq(pmv2ExecutionActor.isActive, 1),
  );
}

/** Use in WHERE only; rechecks the actual account and team scope, never a client-supplied role. */
export function pmv2ExecutionTeamCondition(userId: number, teamId: number | AnyMySqlColumn) {
  return and(
    pmv2ExecutionActorCondition(userId),
    or(
      inArray(pmv2ExecutionActor.role, [...PMV2_ALL_TEAM_EXECUTION_ROLES, ...(isObserverReadScope() ? ["observer" as const] : [])]),
      and(
        inArray(pmv2ExecutionActor.role, [...PMV2_TECHNICIAN_EXECUTION_ROLES]),
        isPmv2SimplifiedEnabled() ? pmv2MembershipCondition(userId, teamId) : sql`exists (select 1 from ${pmv2TeamMembers} where ${and(
          eq(pmv2TeamMembers.teamId, teamId),
          eq(pmv2TeamMembers.userId, userId),
          eq(pmv2TeamMembers.isActive, 1),
        )})`,
      ),
    ),
  );
}

export async function canUserExecuteAllPmv2Teams(db: any, userId: number): Promise<boolean> {
  const rows = await db.select({ role: pmv2ExecutionActor.role }).from(pmv2ExecutionActor)
    .where(and(eq(pmv2ExecutionActor.id, userId), eq(pmv2ExecutionActor.isActive, 1))).limit(1);
  return canRoleExecuteAllPmv2Teams(observerReadActorRole(userId, rows[0]?.role));
}

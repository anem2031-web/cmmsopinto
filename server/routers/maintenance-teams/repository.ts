import { sql, type SQL } from "drizzle-orm";
import { isPmv2SimplifiedEnabled } from "../../pmv2/simplified/feature";
import { ensurePmv2TeamWarehouseLinkSql } from "../../pmv2/simplified/setup-sql";
import {
  TeamTicketError,
  type Team,
  type UserRef,
  type Membership,
} from "../../../shared/maintenance-team-tickets/model";
import type {
  TeamManagementRepository,
  TeamManagementTransaction,
  TeamManagementActor,
  TeamManagementAudit,
  TeamWarehouse,
} from "../../../shared/maintenance-team-tickets/team-management";

export interface TeamDatabaseTransaction {
  execute(query: SQL): Promise<unknown>;
}
export interface TeamDatabase extends TeamDatabaseTransaction {
  transaction<T>(work: (tx: TeamDatabaseTransaction) => Promise<T>): Promise<T>;
}
type Row = Record<string, any>;
function rows(result: unknown): Row[] {
  if (!Array.isArray(result) || !Array.isArray(result[0]))
    throw new Error("نتيجة قراءة فرق الصيانة غير صحيحة");
  return result[0];
}
const team = (r: Row): Team => ({
  id: Number(r.id),
  name: r.name,
  warehouseId: Number(r.warehouseId),
  active: Number(r.isActive) === 1,
  createdById: Number(r.createdById),
  updatedById: Number(r.updatedById),
});
const user = (r: Row): UserRef => ({
  id: Number(r.id),
  name: r.name || `#${r.id}`,
  role: r.role,
  active: Number(r.isActive) === 1,
});
const warehouse = (r: Row): TeamWarehouse => ({
  id: Number(r.id),
  name: r.nameAr,
  nameEn: r.nameEn,
  type: r.type,
  active: Number(r.isActive) === 1,
});
const date = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v));
const membership = (r: Row): Membership => ({
  teamId: Number(r.teamId),
  userId: Number(r.userId),
  active: Number(r.isActive) === 1,
  joinedAt: date(r.joinedAt),
  leftAt: r.leftAt == null ? null : date(r.leftAt),
  updatedById: Number(r.updatedById),
});

/** Constructing/importing this repository never connects. Only an explicit API request invokes this provider. */
async function applicationDatabase(): Promise<TeamDatabase> {
  const { getDb } = await import("../../_core/db/client");
  const db = await getDb();
  if (!db) throw new TeamTicketError("UNAVAILABLE", "قاعدة البيانات غير متاحة");
  return db as unknown as TeamDatabase;
}
class Transaction implements TeamManagementTransaction {
  constructor(private readonly db: TeamDatabaseTransaction) {}
  private async select(query: SQL) {
    return rows(await this.db.execute(query));
  }
  async findTeam(id: number) {
    const [r] = await this.select(
      sql`SELECT id, name, warehouseId, isActive, createdById, updatedById FROM maintenance_teams WHERE id=${id} FOR UPDATE`
    );
    return r ? team(r) : null;
  }
  async findTeamByName(name: string) {
    const [r] = await this.select(
      sql`SELECT id, name, warehouseId, isActive, createdById, updatedById FROM maintenance_teams WHERE name=${name} LIMIT 1`
    );
    return r ? team(r) : null;
  }
  async findWarehouse(id: number) {
    const [r] = await this.select(
      sql`SELECT id, nameAr, nameEn, type, isActive FROM warehouses WHERE id=${id} FOR UPDATE`
    );
    return r ? warehouse(r) : null;
  }
  async findUser(id: number) {
    const [r] = await this.select(
      sql`SELECT id, name, role, isActive FROM users WHERE id=${id} FOR UPDATE`
    );
    return r ? user(r) : null;
  }
  async findMembership(teamId: number, userId: number) {
    const [r] = await this.select(
      sql`SELECT teamId, userId, isActive, joinedAt, leftAt, updatedById FROM maintenance_team_members WHERE teamId=${teamId} AND userId=${userId}`
    );
    return r ? membership(r) : null;
  }
  async membershipsForTeam(teamId: number) {
    return (
      await this.select(
        sql`SELECT teamId,userId,isActive,joinedAt,leftAt,updatedById FROM maintenance_team_members WHERE teamId=${teamId} ORDER BY userId FOR UPDATE`
      )
    ).map(membership);
  }
  async updateTeamProfile(
    teamId: number,
    name: string,
    warehouseId: number,
    actorId: number
  ) {
    if (isPmv2SimplifiedEnabled()) {
      const [current] = await this.select(sql`SELECT warehouseId FROM maintenance_teams WHERE id=${teamId} FOR UPDATE`);
      if (!current) throw new TeamTicketError("NOT_FOUND", "الفريق غير موجود");
      if (Number(current.warehouseId) !== warehouseId) {
        const linked = await this.select(sql`SELECT pmv2TeamId FROM pmv2_unified_team_links WHERE maintenanceTeamId=${teamId} LIMIT 1`);
        if (linked.length) await ensurePmv2TeamWarehouseLinkSql(this.db, teamId, warehouseId, name, actorId);
      }
    }
    await this.db.execute(
      sql`UPDATE maintenance_teams SET name=${name}, warehouseId=${warehouseId}, updatedById=${actorId} WHERE id=${teamId}`
    );
  }
  async remainingActiveMemberCount(teamId: number, excludedUserId: number) {
    const [r] = await this.select(
      sql`SELECT COUNT(*) AS total FROM maintenance_team_members m INNER JOIN users u ON u.id=m.userId WHERE m.teamId=${teamId} AND m.userId<>${excludedUserId} AND m.isActive=1 AND u.isActive=1 AND u.role IN ('technician','it_manager','it_member')`
    );
    return Number(r.total);
  }
  async hasOpenExecution(teamId: number) {
    const [r] = await this.select(
      sql`SELECT id FROM ticket_team_assignments WHERE teamId=${teamId} AND stage <> 'closed' LIMIT 1`
    );
    return !!r;
  }
  async createTeam(name: string, warehouseId: number, actorId: number) {
    const result = (await this.db.execute(
      sql`INSERT INTO maintenance_teams (name, warehouseId, createdById, updatedById) VALUES (${name},${warehouseId},${actorId},${actorId})`
    )) as [{ insertId: number }];
    return Number(result[0].insertId);
  }
  async setTeamActive(teamId: number, active: boolean, actorId: number) {
    await this.db.execute(
      sql`UPDATE maintenance_teams SET isActive=${active ? 1 : 0}, updatedById=${actorId} WHERE id=${teamId}`
    );
  }
  async setMembership(
    teamId: number,
    userId: number,
    active: boolean,
    actorId: number
  ) {
    if (active) {
      await this.db.execute(
        sql`INSERT INTO maintenance_team_members (teamId,userId,isActive,updatedById) VALUES (${teamId},${userId},1,${actorId}) ON DUPLICATE KEY UPDATE isActive=1, leftAt=NULL, updatedById=${actorId}`
      );
    } else {
      await this.db.execute(
        sql`UPDATE maintenance_team_members SET isActive=0, leftAt=CURRENT_TIMESTAMP, updatedById=${actorId} WHERE teamId=${teamId} AND userId=${userId}`
      );
    }
  }
  async audit(actor: TeamManagementActor, entry: TeamManagementAudit) {
    // Use the existing audit_logs within this transaction; no separate DB connection or new audit system.
    await this.db.execute(
      sql`INSERT INTO audit_logs (userId,action,entityType,entityId,oldValues,newValues,ipAddress,userAgent) VALUES (${actor.id},${entry.action},'TICKET_MAINTENANCE_TEAM',${entry.entityId},${entry.oldValues == null ? null : JSON.stringify(entry.oldValues)},${JSON.stringify(entry.newValues)},${actor.ipAddress ?? null},${actor.userAgent ?? null})`
    );
  }
}
export class SqlTeamManagementRepository implements TeamManagementRepository {
  constructor(
    private readonly database: () => Promise<TeamDatabase> = applicationDatabase
  ) {}
  async readData() {
    const db = await this.database();
    return db.transaction(async tx => {
      const teams = rows(
        await tx.execute(
          sql`SELECT id, name, warehouseId, isActive, createdById, updatedById FROM maintenance_teams ORDER BY name,id`
        )
      ).map(team);
      const memberships = rows(
        await tx.execute(
          sql`SELECT teamId,userId,isActive,joinedAt,leftAt,updatedById FROM maintenance_team_members ORDER BY teamId,userId`
        )
      ).map(membership);
      const technicians = rows(
        await tx.execute(
          sql`SELECT id,name,role,isActive FROM users WHERE (role IN ('technician','it_manager','it_member') AND isActive=1) OR id IN (SELECT userId FROM maintenance_team_members) ORDER BY name,id`
        )
      ).map(user);
      const warehouses = rows(
        await tx.execute(
          sql`SELECT id,nameAr,nameEn,type,isActive FROM warehouses WHERE (type='branch' AND isActive=1) OR id IN (SELECT warehouseId FROM maintenance_teams) ORDER BY nameAr,id`
        )
      ).map(warehouse);
      return { teams, memberships, technicians, warehouses };
    });
  }
  async transaction<T>(work: (tx: TeamManagementTransaction) => Promise<T>) {
    try {
      const db = await this.database();
      return await db.transaction(tx => work(new Transaction(tx)));
    } catch (error: any) {
      if (
        error?.code === "ER_DUP_ENTRY" ||
        error?.cause?.code === "ER_DUP_ENTRY" ||
        error?.errno === 1062 ||
        error?.cause?.errno === 1062
      )
        throw new TeamTicketError(
          "CONFLICT",
          "السجل موجود مسبقًا؛ حدّث الصفحة"
        );
      throw error;
    }
  }
}

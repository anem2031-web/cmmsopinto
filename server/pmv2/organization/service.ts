import { and, asc, eq, ne, sql } from "drizzle-orm";
import {
  pmv2Specialties,
  pmv2TeamMembers,
  pmv2Teams,
  users,
  warehouses,
} from "../../../drizzle/schema";
import { getDb } from "../../_core/db/client";
import type { UsersAdapter, WarehouseAdapter } from "../adapters/contracts";
import {
  currentUsersAdapter,
  currentWarehouseAdapter,
} from "../adapters/current-system";
import { writePmv2Audit } from "../audit/service";
import { APP_ROLE } from "../../../shared/roles";
import { queuePmv2Translation } from "../translation-queue";
import { isUnifiedSpecialty, isUnifiedTeam } from "../security/unified-team-management";

export class Pmv2OrganizationError extends Error {
  constructor(
    public readonly code: "NOT_FOUND" | "CONFLICT" | "INVALID_REFERENCE",
    message: string,
  ) {
    super(message);
    this.name = "Pmv2OrganizationError";
  }
}

export interface Pmv2MutationActor {
  userId: number;
  ipAddress?: string;
  userAgent?: string;
}

export interface CreateSpecialtyInput {
  code: string;
  name: string;
  nameEn?: string | null;
  nameUr?: string | null;
  description?: string | null;
  managerUserId?: number | null;
}

export interface UpdateSpecialtyInput extends Partial<CreateSpecialtyInput> {
  id: number;
  isActive?: boolean;
}

export interface CreateTeamInput {
  specialtyId: number;
  code: string;
  warehouseId: number;
  deviceUserId?: number | null;
}

export interface UpdateTeamInput extends Partial<CreateTeamInput> {
  id: number;
  isActive?: boolean;
}

async function requireDb() {
  const db = await getDb();
  if (!db) throw new Error("تعذر الاتصال بقاعدة البيانات");
  return db;
}

export class Pmv2OrganizationService {
  constructor(
    private readonly usersAdapter: UsersAdapter = currentUsersAdapter,
    private readonly warehouseAdapter: WarehouseAdapter = currentWarehouseAdapter,
  ) {}

  listActiveUsers() {
    return this.usersAdapter.listActiveUsers();
  }

  listActiveWarehouses() {
    return this.warehouseAdapter.listActiveWarehouses();
  }

  async listSpecialties() {
    const db = await requireDb();
    return db
      .select({
        id: pmv2Specialties.id,
        code: pmv2Specialties.code,
        name: pmv2Specialties.name,
        nameEn: pmv2Specialties.nameEn,
        nameUr: pmv2Specialties.nameUr,
        description: pmv2Specialties.description,
        managerUserId: pmv2Specialties.managerUserId,
        managerName: users.name,
        isActive: pmv2Specialties.isActive,
        createdById: pmv2Specialties.createdById,
        createdAt: pmv2Specialties.createdAt,
        updatedAt: pmv2Specialties.updatedAt,
      })
      .from(pmv2Specialties)
      .leftJoin(users, eq(users.id, pmv2Specialties.managerUserId))
      .orderBy(asc(pmv2Specialties.name));
  }

  async createSpecialty(input: CreateSpecialtyInput, actor: Pmv2MutationActor) {
    if (input.managerUserId != null) {
      await this.usersAdapter.requireActiveUser(input.managerUserId);
    }

    const db = await requireDb();
    const duplicate = await db
      .select({ id: pmv2Specialties.id })
      .from(pmv2Specialties)
      .where(eq(pmv2Specialties.code, input.code))
      .limit(1);
    if (duplicate.length > 0) {
      throw new Pmv2OrganizationError("CONFLICT", "رمز التخصص مستخدم مسبقًا");
    }

    const result = await db.insert(pmv2Specialties).values({
      code: input.code,
      name: input.name,
      nameEn: input.nameEn ?? null,
      nameUr: input.nameUr ?? null,
      description: input.description ?? null,
      managerUserId: input.managerUserId ?? null,
      createdById: actor.userId,
      isActive: 1,
    });
    const id = Number(result[0].insertId);

    await queuePmv2Translation("PMV2_SPECIALTY", id, [
      { fieldName: "name", text: input.name },
      { fieldName: "description", text: input.description },
    ], actor.userId);

    await writePmv2Audit({
      actorUserId: actor.userId,
      action: "specialty.created",
      entity: "specialty",
      entityId: id,
      newValues: input,
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });
    return { id };
  }

  async updateSpecialty(input: UpdateSpecialtyInput, actor: Pmv2MutationActor) {
    if (await isUnifiedSpecialty(await requireDb(), input.id)) throw new Pmv2OrganizationError("CONFLICT", "يُدار هذا التخصص من فريق الصيانة المرتبط");
    if (input.managerUserId != null) {
      await this.usersAdapter.requireActiveUser(input.managerUserId);
    }

    const db = await requireDb();
    const current = await db
      .select()
      .from(pmv2Specialties)
      .where(eq(pmv2Specialties.id, input.id))
      .limit(1);
    if (!current[0]) {
      throw new Pmv2OrganizationError("NOT_FOUND", "التخصص غير موجود");
    }

    if (input.code !== undefined) {
      const duplicate = await db
        .select({ id: pmv2Specialties.id })
        .from(pmv2Specialties)
        .where(
          and(
            eq(pmv2Specialties.code, input.code),
            ne(pmv2Specialties.id, input.id),
          ),
        )
        .limit(1);
      if (duplicate.length > 0) {
        throw new Pmv2OrganizationError("CONFLICT", "رمز التخصص مستخدم مسبقًا");
      }
    }

    const { id, isActive, ...rest } = input;
    await db
      .update(pmv2Specialties)
      .set({
        ...rest,
        ...(isActive !== undefined ? { isActive: isActive ? 1 : 0 } : {}),
      })
      .where(eq(pmv2Specialties.id, id));

    await queuePmv2Translation("PMV2_SPECIALTY", id, [
      { fieldName: "name", text: input.name },
      { fieldName: "description", text: input.description },
    ], actor.userId);

    await writePmv2Audit({
      actorUserId: actor.userId,
      action: "specialty.updated",
      entity: "specialty",
      entityId: id,
      oldValues: current[0],
      newValues: input,
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });
    return { success: true };
  }

  async listTeams() {
    const db = await requireDb();
    return db
      .select({
        id: pmv2Teams.id,
        specialtyId: pmv2Teams.specialtyId,
        specialtyCode: pmv2Specialties.code,
        specialtyName: pmv2Specialties.name,
        code: pmv2Teams.code,
        warehouseId: pmv2Teams.warehouseId,
        warehouseCode: warehouses.code,
        warehouseNameAr: warehouses.nameAr,
        warehouseNameEn: warehouses.nameEn,
        deviceUserId: pmv2Teams.deviceUserId,
        deviceUserName: users.name,
        isActive: pmv2Teams.isActive,
      })
      .from(pmv2Teams)
      .innerJoin(pmv2Specialties, eq(pmv2Specialties.id, pmv2Teams.specialtyId))
      .leftJoin(warehouses, eq(warehouses.id, pmv2Teams.warehouseId))
      .leftJoin(users, eq(users.id, pmv2Teams.deviceUserId))
      .orderBy(asc(pmv2Teams.code));
  }

  async createTeam(input: CreateTeamInput, actor: Pmv2MutationActor) {
    await this.requireActiveSpecialty(input.specialtyId);
    await this.warehouseAdapter.requireActiveWarehouse(input.warehouseId);
    if (input.deviceUserId != null) {
      await this.usersAdapter.requireActiveUser(input.deviceUserId);
    }

    const db = await requireDb();
    const duplicate = await db
      .select({ id: pmv2Teams.id })
      .from(pmv2Teams)
      .where(eq(pmv2Teams.code, input.code))
      .limit(1);
    if (duplicate.length > 0) {
      throw new Pmv2OrganizationError("CONFLICT", "رمز الفريق مستخدم مسبقًا");
    }

    const result = await db.insert(pmv2Teams).values({
      specialtyId: input.specialtyId,
      code: input.code,
      warehouseId: input.warehouseId,
      deviceUserId: input.deviceUserId ?? null,
      isActive: 1,
    });
    const id = Number(result[0].insertId);

    await writePmv2Audit({
      actorUserId: actor.userId,
      action: "team.created",
      entity: "team",
      entityId: id,
      newValues: input,
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });
    return { id };
  }

  async updateTeam(input: UpdateTeamInput, actor: Pmv2MutationActor) {
    if (await isUnifiedTeam(await requireDb(), input.id)) throw new Pmv2OrganizationError("CONFLICT", "يُدار هذا الفريق من فرق الصيانة");
    if (input.specialtyId !== undefined) {
      await this.requireActiveSpecialty(input.specialtyId);
    }
    if (input.warehouseId !== undefined) {
      await this.warehouseAdapter.requireActiveWarehouse(input.warehouseId);
    }
    if (input.deviceUserId != null) {
      await this.usersAdapter.requireActiveUser(input.deviceUserId);
    }

    const db = await requireDb();
    const current = await db
      .select()
      .from(pmv2Teams)
      .where(eq(pmv2Teams.id, input.id))
      .limit(1);
    if (!current[0]) {
      throw new Pmv2OrganizationError("NOT_FOUND", "الفريق غير موجود");
    }

    if (input.code !== undefined) {
      const duplicate = await db
        .select({ id: pmv2Teams.id })
        .from(pmv2Teams)
        .where(and(eq(pmv2Teams.code, input.code), ne(pmv2Teams.id, input.id)))
        .limit(1);
      if (duplicate.length > 0) {
        throw new Pmv2OrganizationError("CONFLICT", "رمز الفريق مستخدم مسبقًا");
      }
    }

    const { id, isActive, ...rest } = input;
    await db
      .update(pmv2Teams)
      .set({
        ...rest,
        ...(isActive !== undefined ? { isActive: isActive ? 1 : 0 } : {}),
      })
      .where(eq(pmv2Teams.id, id));

    await writePmv2Audit({
      actorUserId: actor.userId,
      action: "team.updated",
      entity: "team",
      entityId: id,
      oldValues: current[0],
      newValues: input,
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });
    return { success: true };
  }

  async listTeamMembers(teamId: number) {
    const db = await requireDb();
    return db
      .select({
        id: pmv2TeamMembers.id,
        teamId: pmv2TeamMembers.teamId,
        userId: pmv2TeamMembers.userId,
        userName: users.name,
        userRole: users.role,
        userIsActive: users.isActive,
        isActive: pmv2TeamMembers.isActive,
        joinedAt: pmv2TeamMembers.joinedAt,
        leftAt: pmv2TeamMembers.leftAt,
      })
      .from(pmv2TeamMembers)
      .leftJoin(users, eq(users.id, pmv2TeamMembers.userId))
      .where(eq(pmv2TeamMembers.teamId, teamId))
      .orderBy(asc(users.name));
  }

  async addTeamMember(teamId: number, userId: number, actor: Pmv2MutationActor) {
    if (await isUnifiedTeam(await requireDb(), teamId)) throw new Pmv2OrganizationError("CONFLICT", "تُدار عضوية هذا الفريق من فرق الصيانة");
    await this.requireActiveTeam(teamId);
    const memberUser = await this.usersAdapter.requireActiveUser(userId);

    const db = await requireDb();
    if (memberUser.role === APP_ROLE.IT_MANAGER) {
      const itTeamScope = await db
        .select({ specialtyManagerUserId: pmv2Specialties.managerUserId })
        .from(pmv2Teams)
        .innerJoin(pmv2Specialties, eq(pmv2Specialties.id, pmv2Teams.specialtyId))
        .where(and(eq(pmv2Teams.id, teamId), eq(pmv2Specialties.isActive, 1)))
        .limit(1);
      if (Number(itTeamScope[0]?.specialtyManagerUserId ?? 0) !== Number(userId)) {
        throw new Pmv2OrganizationError(
          "INVALID_REFERENCE",
          "مدير تقنية المعلومات يمكن إضافته فقط إلى فريق تابع للتخصص الذي يديره",
        );
      }
    }

    const existing = await db
      .select()
      .from(pmv2TeamMembers)
      .where(
        and(
          eq(pmv2TeamMembers.teamId, teamId),
          eq(pmv2TeamMembers.userId, userId),
        ),
      )
      .limit(1);

    let id: number;
    let action: "team_member.created" | "team_member.reactivated";
    if (existing[0]) {
      id = existing[0].id;
      action = "team_member.reactivated";
      await db
        .update(pmv2TeamMembers)
        .set({ isActive: 1, joinedAt: sql`CURRENT_TIMESTAMP`, leftAt: null })
        .where(eq(pmv2TeamMembers.id, id));
    } else {
      const result = await db.insert(pmv2TeamMembers).values({
        teamId,
        userId,
        isActive: 1,
      });
      id = Number(result[0].insertId);
      action = "team_member.created";
    }

    await writePmv2Audit({
      actorUserId: actor.userId,
      action,
      entity: "team_member",
      entityId: id,
      oldValues: existing[0],
      newValues: { teamId, userId, isActive: true },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });
    return { id, reactivated: !!existing[0] };
  }

  async deactivateTeamMember(id: number, actor: Pmv2MutationActor) {
    const db = await requireDb();
    const current = await db
      .select()
      .from(pmv2TeamMembers)
      .where(eq(pmv2TeamMembers.id, id))
      .limit(1);
    if (!current[0]) {
      throw new Pmv2OrganizationError("NOT_FOUND", "عضوية الفريق غير موجودة");
    }
    if (await isUnifiedTeam(db, Number(current[0].teamId))) throw new Pmv2OrganizationError("CONFLICT", "تُدار عضوية هذا الفريق من فرق الصيانة");

    await db
      .update(pmv2TeamMembers)
      .set({ isActive: 0, leftAt: sql`CURRENT_TIMESTAMP` })
      .where(eq(pmv2TeamMembers.id, id));

    await writePmv2Audit({
      actorUserId: actor.userId,
      action: "team_member.deactivated",
      entity: "team_member",
      entityId: id,
      oldValues: current[0],
      newValues: { isActive: false },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });
    return { success: true };
  }

  private async requireActiveSpecialty(id: number) {
    const db = await requireDb();
    const rows = await db
      .select({ id: pmv2Specialties.id, isActive: pmv2Specialties.isActive })
      .from(pmv2Specialties)
      .where(eq(pmv2Specialties.id, id))
      .limit(1);
    if (!rows[0]) {
      throw new Pmv2OrganizationError("INVALID_REFERENCE", "التخصص المحدد غير موجود");
    }
    if (rows[0].isActive !== 1) {
      throw new Pmv2OrganizationError("INVALID_REFERENCE", "التخصص المحدد غير فعال");
    }
    return rows[0];
  }

  private async requireActiveTeam(id: number) {
    const db = await requireDb();
    const rows = await db
      .select({ id: pmv2Teams.id, isActive: pmv2Teams.isActive })
      .from(pmv2Teams)
      .where(eq(pmv2Teams.id, id))
      .limit(1);
    if (!rows[0]) {
      throw new Pmv2OrganizationError("NOT_FOUND", "الفريق غير موجود");
    }
    if (rows[0].isActive !== 1) {
      throw new Pmv2OrganizationError("INVALID_REFERENCE", "الفريق غير فعال");
    }
    return rows[0];
  }
}

export const pmv2OrganizationService = new Pmv2OrganizationService();

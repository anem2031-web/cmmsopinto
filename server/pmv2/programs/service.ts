import { and, asc, eq } from "drizzle-orm";
import {
  assets,
  pmv2Checklists,
  pmv2Programs,
  pmv2ProgramTargets,
  pmv2Tasks,
  pmv2Teams,
  sections,
  sites,
} from "../../../drizzle/schema";
import { getDb } from "../../_core/db/client";
import type { MaintenanceTargetAdapter } from "../adapters/contracts";
import { currentMaintenanceTargetAdapter } from "../adapters/current-system";
import { writePmv2Audit } from "../audit/service";
import { queuePmv2Translation } from "../translation-queue";
import { isSimplifiedChecklist, isSimplifiedProgram } from "../simplified/legacy-write-guard";
import {
  Pmv2ProgramTargetValidationError,
  validatePmv2ProgramTargetWrite,
} from "./target-validation";

export class Pmv2ProgramServiceError extends Error {
  constructor(
    public readonly code: "NOT_FOUND" | "INVALID_STATE" | "INVALID_REFERENCE" | "CONFLICT",
    message: string,
  ) {
    super(message);
    this.name = "Pmv2ProgramServiceError";
  }
}

export interface Pmv2ProgramActor {
  userId: number;
  ipAddress?: string;
  userAgent?: string;
}

export interface CreateProgramInput {
  title?: string | null;
  teamId: number;
  checklistId: number;
  estimatedDurationMinutes?: number | null;
}

export interface UpdateProgramInput {
  id: number;
  title?: string | null;
  teamId?: number;
  checklistId?: number;
  estimatedDurationMinutes?: number | null;
  isActive?: boolean;
}

export type AddProgramTargetInput =
  | { programId: number; type: "site"; siteId: number }
  | { programId: number; type: "section"; sectionId: number }
  | { programId: number; type: "asset"; assetId: number };

async function requireDb() {
  const db = await getDb();
  if (!db) throw new Error("تعذر الاتصال بقاعدة البيانات");
  return db;
}

export class Pmv2ProgramService {
  constructor(
    private readonly targetAdapter: MaintenanceTargetAdapter = currentMaintenanceTargetAdapter,
  ) {}

  async listPrograms(includeInactive = false) {
    const db = await requireDb();
    return db
      .select({
        id: pmv2Programs.id,
        title: pmv2Programs.title,
        teamId: pmv2Programs.teamId,
        teamCode: pmv2Teams.code,
        checklistId: pmv2Programs.checklistId,
        checklistName: pmv2Checklists.name,
        estimatedDurationMinutes: pmv2Programs.estimatedDurationMinutes,
        isActive: pmv2Programs.isActive,
        createdById: pmv2Programs.createdById,
        createdAt: pmv2Programs.createdAt,
        updatedAt: pmv2Programs.updatedAt,
      })
      .from(pmv2Programs)
      .innerJoin(pmv2Teams, eq(pmv2Teams.id, pmv2Programs.teamId))
      .innerJoin(pmv2Checklists, eq(pmv2Checklists.id, pmv2Programs.checklistId))
      .where(includeInactive ? undefined : eq(pmv2Programs.isActive, 1))
      .orderBy(asc(pmv2Programs.id));
  }

  async getProgram(id: number) {
    const db = await requireDb();
    const rows = await db
      .select()
      .from(pmv2Programs)
      .where(eq(pmv2Programs.id, id))
      .limit(1);
    if (!rows[0]) {
      throw new Pmv2ProgramServiceError("NOT_FOUND", "برنامج الصيانة غير موجود");
    }
    return rows[0];
  }

  private async requireActiveTeam(teamId: number) {
    const db = await requireDb();
    const rows = await db
      .select({ id: pmv2Teams.id })
      .from(pmv2Teams)
      .where(and(eq(pmv2Teams.id, teamId), eq(pmv2Teams.isActive, 1)))
      .limit(1);
    if (!rows[0]) {
      throw new Pmv2ProgramServiceError("INVALID_REFERENCE", "الفريق المحدد غير موجود أو غير فعال");
    }
  }

  private async requireActiveChecklist(checklistId: number) {
    const db = await requireDb();
    if (await isSimplifiedChecklist(db, checklistId)) {
      throw new Pmv2ProgramServiceError("INVALID_STATE", "تُدار قائمة هذه المهمة من شاشة إعداد المهام المجدولة");
    }
    const rows = await db
      .select({ id: pmv2Checklists.id })
      .from(pmv2Checklists)
      .where(and(eq(pmv2Checklists.id, checklistId), eq(pmv2Checklists.isActive, 1)))
      .limit(1);
    if (!rows[0]) {
      throw new Pmv2ProgramServiceError("INVALID_REFERENCE", "قائمة الصيانة المحددة غير موجودة أو غير فعالة");
    }
  }

  async createProgram(input: CreateProgramInput, actor: Pmv2ProgramActor) {
    await this.requireActiveTeam(input.teamId);
    await this.requireActiveChecklist(input.checklistId);

    const db = await requireDb();
    const result = await db.insert(pmv2Programs).values({
      title: input.title?.trim() || null,
      teamId: input.teamId,
      checklistId: input.checklistId,
      estimatedDurationMinutes: input.estimatedDurationMinutes ?? null,
      isActive: 1,
      createdById: actor.userId,
    });
    const id = Number(result[0].insertId);

    await queuePmv2Translation("PMV2_PROGRAM", id, [
      { fieldName: "title", text: input.title },
    ], actor.userId);

    await writePmv2Audit({
      actorUserId: actor.userId,
      action: "program.created",
      entity: "program",
      entityId: id,
      newValues: input,
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });
    return { id };
  }

  async updateProgram(input: UpdateProgramInput, actor: Pmv2ProgramActor) {
    const current = await this.getProgram(input.id);
    if (await isSimplifiedProgram(await requireDb(), input.id)) {
      throw new Pmv2ProgramServiceError("INVALID_STATE", "تُدار هذه المهمة من شاشة إعداد المهام المجدولة");
    }
    const teamChanged = input.teamId !== undefined && input.teamId !== current.teamId;
    const checklistChanged =
      input.checklistId !== undefined && input.checklistId !== current.checklistId;

    if (teamChanged) await this.requireActiveTeam(input.teamId!);
    if (checklistChanged) await this.requireActiveChecklist(input.checklistId!);

    if (teamChanged || checklistChanged) {
      const db = await requireDb();
      const task = await db
        .select({ id: pmv2Tasks.id })
        .from(pmv2Tasks)
        .where(eq(pmv2Tasks.programId, input.id))
        .limit(1);
      if (task[0]) {
        throw new Pmv2ProgramServiceError(
          "INVALID_STATE",
          "لا يمكن تغيير فريق أو قائمة برنامج بدأ بتوليد مهام؛ أنشئ برنامجًا جديدًا وحافظ على التاريخ",
        );
      }
    }

    const patch: Record<string, unknown> = {};
    if (input.title !== undefined) patch.title = input.title?.trim() || null;
    if (input.teamId !== undefined) patch.teamId = input.teamId;
    if (input.checklistId !== undefined) patch.checklistId = input.checklistId;
    if (input.estimatedDurationMinutes !== undefined) patch.estimatedDurationMinutes = input.estimatedDurationMinutes;
    if (input.isActive !== undefined) patch.isActive = input.isActive ? 1 : 0;
    if (Object.keys(patch).length === 0) return { success: true };

    const db = await requireDb();
    await db.update(pmv2Programs).set(patch).where(eq(pmv2Programs.id, input.id));

    await queuePmv2Translation("PMV2_PROGRAM", input.id, [
      { fieldName: "title", text: input.title },
    ], actor.userId);

    await writePmv2Audit({
      actorUserId: actor.userId,
      action: "program.updated",
      entity: "program",
      entityId: input.id,
      oldValues: current,
      newValues: input,
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });
    return { success: true };
  }

  async listTargets(programId: number) {
    await this.getProgram(programId);
    const db = await requireDb();
    return db
      .select({
        id: pmv2ProgramTargets.id,
        programId: pmv2ProgramTargets.programId,
        siteId: pmv2ProgramTargets.siteId,
        siteName: sites.name,
        sectionId: pmv2ProgramTargets.sectionId,
        sectionName: sections.name,
        assetId: pmv2ProgramTargets.assetId,
        assetName: assets.name,
      })
      .from(pmv2ProgramTargets)
      .leftJoin(sites, eq(sites.id, pmv2ProgramTargets.siteId))
      .leftJoin(sections, eq(sections.id, pmv2ProgramTargets.sectionId))
      .leftJoin(assets, eq(assets.id, pmv2ProgramTargets.assetId))
      .where(eq(pmv2ProgramTargets.programId, programId))
      .orderBy(asc(pmv2ProgramTargets.id));
  }

  async addTarget(input: AddProgramTargetInput, actor: Pmv2ProgramActor) {
    const program = await this.getProgram(input.programId);
    if (Number(program.isActive) !== 1) {
      throw new Pmv2ProgramServiceError("INVALID_STATE", "لا يمكن إضافة هدف إلى برنامج معطل");
    }

    const write = validatePmv2ProgramTargetWrite({
      programId: input.programId,
      siteId: input.type === "site" ? input.siteId : null,
      sectionId: input.type === "section" ? input.sectionId : null,
      assetId: input.type === "asset" ? input.assetId : null,
    });

    const valid = await this.targetAdapter.validateTarget(
      input.type === "site"
        ? { type: "site", siteId: input.siteId }
        : input.type === "section"
          ? { type: "section", sectionId: input.sectionId }
          : { type: "asset", assetId: input.assetId },
    );
    if (!valid) {
      throw new Pmv2ProgramServiceError("INVALID_REFERENCE", "هدف الصيانة غير موجود أو غير صالح تشغيليًا");
    }

    const db = await requireDb();
    const duplicateCondition =
      input.type === "site"
        ? eq(pmv2ProgramTargets.siteId, input.siteId)
        : input.type === "section"
          ? eq(pmv2ProgramTargets.sectionId, input.sectionId)
          : eq(pmv2ProgramTargets.assetId, input.assetId);
    const duplicate = await db
      .select({ id: pmv2ProgramTargets.id })
      .from(pmv2ProgramTargets)
      .where(and(eq(pmv2ProgramTargets.programId, input.programId), duplicateCondition))
      .limit(1);
    if (duplicate[0]) {
      throw new Pmv2ProgramServiceError("CONFLICT", "هدف الصيانة مضاف مسبقًا إلى هذا البرنامج");
    }

    const result = await db.insert(pmv2ProgramTargets).values(write);
    const id = Number(result[0].insertId);

    await writePmv2Audit({
      actorUserId: actor.userId,
      action: "program_target.created",
      entity: "program_target",
      entityId: id,
      newValues: { ...input, ...write },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });
    return { id };
  }
}

export const pmv2ProgramService = new Pmv2ProgramService();

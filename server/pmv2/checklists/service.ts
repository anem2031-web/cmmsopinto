import { and, asc, eq, ne } from "drizzle-orm";
import {
  pmv2ChecklistItems,
  pmv2Checklists,
} from "../../../drizzle/schema";
import { getDb } from "../../_core/db/client";
import { writePmv2Audit } from "../audit/service";
import {
  type Pmv2ChecklistFrequency,
  type Pmv2ChecklistItemWrite,
  assertPmv2ChecklistItemLogicalUniqueness,
  validatePmv2ChecklistItemWrite,
} from "./validation";
import { nextPmv2ChecklistItemSortOrder } from "./order";
import { queuePmv2Translation } from "../translation-queue";
import { isSimplifiedChecklist } from "../simplified/legacy-write-guard";

export class Pmv2ChecklistServiceError extends Error {
  constructor(
    public readonly code: "NOT_FOUND" | "INVALID_STATE",
    message: string,
  ) {
    super(message);
    this.name = "Pmv2ChecklistServiceError";
  }
}

export interface Pmv2ChecklistActor {
  userId: number;
  ipAddress?: string;
  userAgent?: string;
}

export interface CreateChecklistInput {
  name: string;
  description?: string | null;
}

export interface UpdateChecklistInput {
  id: number;
  name?: string;
  description?: string | null;
  isActive?: boolean;
}

export interface CreateChecklistItemInput {
  checklistId: number;
  title: string;
  sortOrder?: number;
  isRequired?: boolean;
  isActive?: boolean;
  frequency: Pmv2ChecklistFrequency;
  frequencyValue?: number | null;
  weekday?: number | null;
  monthDay?: number | null;
  anchorDate?: string | null;
  scheduleConfigJson?: string | null;
}

export interface UpdateChecklistItemInput {
  id: number;
  title?: string;
  sortOrder?: number;
  isRequired?: boolean;
  isActive?: boolean;
  frequency?: Pmv2ChecklistFrequency;
  frequencyValue?: number | null;
  weekday?: number | null;
  monthDay?: number | null;
  anchorDate?: string | null;
  scheduleConfigJson?: string | null;
}

async function requireDb() {
  const db = await getDb();
  if (!db) throw new Error("تعذر الاتصال بقاعدة البيانات");
  return db;
}

function normalizeChecklistName(name: unknown): string {
  const value = typeof name === "string" ? name.trim() : "";
  if (!value || value.length > 200) {
    throw new Pmv2ChecklistServiceError(
      "INVALID_STATE",
      "اسم قائمة الصيانة مطلوب ويجب ألا يتجاوز 200 حرف",
    );
  }
  return value;
}

function normalizeDescription(value: string | null | undefined) {
  if (value == null) return null;
  return value.trim() || null;
}

function dbItemToWrite(row: typeof pmv2ChecklistItems.$inferSelect): Pmv2ChecklistItemWrite {
  return {
    checklistId: row.checklistId,
    title: row.title,
    sortOrder: row.sortOrder,
    isRequired: Number(row.isRequired) === 1,
    isActive: Number(row.isActive) === 1,
    frequency: row.frequency,
    frequencyValue: row.frequencyValue,
    weekday: row.weekday,
    monthDay: row.monthDay,
    anchorDate: row.anchorDate,
    scheduleConfigJson: row.scheduleConfigJson,
  };
}

export class Pmv2ChecklistService {
  async listChecklists(includeInactive = false) {
    const db = await requireDb();
    const where = includeInactive ? undefined : eq(pmv2Checklists.isActive, 1);
    return db
      .select()
      .from(pmv2Checklists)
      .where(where)
      .orderBy(asc(pmv2Checklists.name));
  }

  async getChecklist(id: number) {
    const db = await requireDb();
    const rows = await db
      .select()
      .from(pmv2Checklists)
      .where(eq(pmv2Checklists.id, id))
      .limit(1);
    if (!rows[0]) {
      throw new Pmv2ChecklistServiceError("NOT_FOUND", "قائمة الصيانة غير موجودة");
    }
    return rows[0];
  }

  async createChecklist(input: CreateChecklistInput, actor: Pmv2ChecklistActor) {
    const db = await requireDb();
    const values = {
      name: normalizeChecklistName(input.name),
      description: normalizeDescription(input.description),
      isActive: 1,
      createdById: actor.userId,
    };
    const result = await db.insert(pmv2Checklists).values(values);
    const id = Number(result[0].insertId);

    await queuePmv2Translation("PMV2_CHECKLIST", id, [
      { fieldName: "name", text: values.name },
      { fieldName: "description", text: values.description },
    ], actor.userId);

    await writePmv2Audit({
      actorUserId: actor.userId,
      action: "checklist.created",
      entity: "checklist",
      entityId: id,
      newValues: values,
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });
    return { id };
  }

  async updateChecklist(input: UpdateChecklistInput, actor: Pmv2ChecklistActor) {
    const current = await this.getChecklist(input.id);
    if (await isSimplifiedChecklist(await requireDb(), input.id)) {
      throw new Pmv2ChecklistServiceError("INVALID_STATE", "تُدار قائمة هذه المهمة من شاشة إعداد المهام المجدولة");
    }
    const patch: Record<string, unknown> = {};

    if (input.name !== undefined) patch.name = normalizeChecklistName(input.name);
    if (input.description !== undefined) {
      patch.description = normalizeDescription(input.description);
    }
    if (input.isActive !== undefined) patch.isActive = input.isActive ? 1 : 0;

    if (Object.keys(patch).length === 0) return { success: true };

    const db = await requireDb();
    await db
      .update(pmv2Checklists)
      .set(patch)
      .where(eq(pmv2Checklists.id, input.id));

    await queuePmv2Translation("PMV2_CHECKLIST", input.id, [
      { fieldName: "name", text: (patch.name as string | undefined) },
      { fieldName: "description", text: (patch.description as string | null | undefined) },
    ], actor.userId);

    await writePmv2Audit({
      actorUserId: actor.userId,
      action: "checklist.updated",
      entity: "checklist",
      entityId: input.id,
      oldValues: current,
      newValues: input,
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });
    return { success: true };
  }

  async listItems(checklistId: number, includeInactive = false) {
    await this.getChecklist(checklistId);
    const db = await requireDb();
    return db
      .select()
      .from(pmv2ChecklistItems)
      .where(
        includeInactive
          ? eq(pmv2ChecklistItems.checklistId, checklistId)
          : and(
              eq(pmv2ChecklistItems.checklistId, checklistId),
              eq(pmv2ChecklistItems.isActive, 1),
            ),
      )
      .orderBy(asc(pmv2ChecklistItems.sortOrder), asc(pmv2ChecklistItems.id));
  }

  async getItem(id: number) {
    const db = await requireDb();
    const rows = await db
      .select()
      .from(pmv2ChecklistItems)
      .where(eq(pmv2ChecklistItems.id, id))
      .limit(1);
    if (!rows[0]) {
      throw new Pmv2ChecklistServiceError("NOT_FOUND", "بند قائمة الصيانة غير موجود");
    }
    return rows[0];
  }

  private async assertActiveItemUniqueness(
    values: Pmv2ChecklistItemWrite,
    excludeItemId?: number,
  ) {
    if (!values.isActive) return;

    const db = await requireDb();
    const filters = [
      eq(pmv2ChecklistItems.checklistId, values.checklistId),
      eq(pmv2ChecklistItems.isActive, 1),
    ];
    if (excludeItemId) filters.push(ne(pmv2ChecklistItems.id, excludeItemId));

    const existing = await db
      .select()
      .from(pmv2ChecklistItems)
      .where(and(...filters));

    assertPmv2ChecklistItemLogicalUniqueness(
      values,
      existing.map((row) => ({ id: row.id, ...dbItemToWrite(row) })),
      excludeItemId,
    );
  }

  async createItem(input: CreateChecklistItemInput, actor: Pmv2ChecklistActor) {
    const checklist = await this.getChecklist(input.checklistId);
    if (await isSimplifiedChecklist(await requireDb(), input.checklistId)) {
      throw new Pmv2ChecklistServiceError("INVALID_STATE", "تُدار قائمة هذه المهمة من شاشة إعداد المهام المجدولة");
    }
    if (Number(checklist.isActive) !== 1) {
      throw new Pmv2ChecklistServiceError(
        "INVALID_STATE",
        "لا يمكن إضافة بند جديد إلى قائمة صيانة معطلة",
      );
    }

    const db = await requireDb();
    let sortOrder = input.sortOrder;
    if (sortOrder === undefined) {
      const existingItems = await db
        .select({ sortOrder: pmv2ChecklistItems.sortOrder })
        .from(pmv2ChecklistItems)
        .where(eq(pmv2ChecklistItems.checklistId, input.checklistId));
      sortOrder = nextPmv2ChecklistItemSortOrder(existingItems);
    }

    const values = validatePmv2ChecklistItemWrite({
      ...input,
      sortOrder,
      isRequired: input.isRequired ?? true,
      isActive: input.isActive ?? true,
      frequencyValue: input.frequencyValue ?? null,
      weekday: input.weekday ?? null,
      monthDay: input.monthDay ?? null,
      anchorDate: input.anchorDate ?? null,
      scheduleConfigJson: input.scheduleConfigJson ?? null,
    });

    await this.assertActiveItemUniqueness(values);

    const result = await db.insert(pmv2ChecklistItems).values({
      ...values,
      isRequired: values.isRequired ? 1 : 0,
      isActive: values.isActive ? 1 : 0,
    });
    const id = Number(result[0].insertId);

    await queuePmv2Translation("PMV2_CHECKLIST_ITEM", id, [
      { fieldName: "title", text: values.title },
    ], actor.userId);

    await writePmv2Audit({
      actorUserId: actor.userId,
      action: "checklist_item.created",
      entity: "checklist_item",
      entityId: id,
      newValues: values,
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });
    return { id };
  }

  async updateItem(input: UpdateChecklistItemInput, actor: Pmv2ChecklistActor) {
    const current = await this.getItem(input.id);
    if (await isSimplifiedChecklist(await requireDb(), current.checklistId)) {
      throw new Pmv2ChecklistServiceError("INVALID_STATE", "تُدار قائمة هذه المهمة من شاشة إعداد المهام المجدولة");
    }
    const merged = validatePmv2ChecklistItemWrite({
      ...dbItemToWrite(current),
      ...input,
      checklistId: current.checklistId,
    });

    await this.assertActiveItemUniqueness(merged, input.id);

    const db = await requireDb();
    await db
      .update(pmv2ChecklistItems)
      .set({
        title: merged.title,
        sortOrder: merged.sortOrder,
        isRequired: merged.isRequired ? 1 : 0,
        isActive: merged.isActive ? 1 : 0,
        frequency: merged.frequency,
        frequencyValue: merged.frequencyValue,
        weekday: merged.weekday,
        monthDay: merged.monthDay,
        anchorDate: merged.anchorDate,
        scheduleConfigJson: merged.scheduleConfigJson,
      })
      .where(eq(pmv2ChecklistItems.id, input.id));

    await queuePmv2Translation("PMV2_CHECKLIST_ITEM", input.id, [
      { fieldName: "title", text: merged.title },
    ], actor.userId);

    await writePmv2Audit({
      actorUserId: actor.userId,
      action: "checklist_item.updated",
      entity: "checklist_item",
      entityId: input.id,
      oldValues: current,
      newValues: merged,
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });
    return { success: true };
  }
}

export const pmv2ChecklistService = new Pmv2ChecklistService();

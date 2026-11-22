import { canManagePmv2Foundation } from "../security/policy";
import { buildSimplifiedSchedule, type SimplifiedScheduleInput } from "../checklists/simplified-recurrence";
import { planResumeOccurrences, type ResumeOccurrence } from "../scheduler/resume-plan";
import type { PausedScheduleItem } from "../scheduler/pause-recovery";

export type SetupActor = { id: number; role: string; isActive: number };
export type SetupPlan = { id: number; state: "draft" | "active" | "paused"; pausedOn: string | null; teamId: number; siteId: number; sectionId: number };
export type SetupBase = { title: string; siteId: number; sectionId: number; teamId: number };
export type SetupItem = { titleAr: string; titleEn: string; titleUr: string; recurrence: SimplifiedScheduleInput };
export type SetupAudit = { action: string; planId: number; actorId: number; details?: unknown };

/** Every method receives the SAME transactional repository instance. */
export interface SimplifiedSetupTx {
  validateActor(actor: SetupActor): Promise<boolean>;
  validateSiteSection(siteId: number, sectionId: number): Promise<boolean>;
  validateTeam(teamId: number): Promise<boolean>;
  createDraft(input: SetupBase, actorId: number): Promise<number>;
  lockPlan(planId: number): Promise<SetupPlan | null>;
  addItem(planId: number, item: SetupItem, schedule: ReturnType<typeof buildSimplifiedSchedule>, actorId: number): Promise<number>;
  listItems(planId: number, dates?: { from: string; to: string }): Promise<PausedScheduleItem[]>;
  /** State and generated work must be persisted atomically within this transaction. */
  generate(planId: number, date: string, occurrences: readonly ResumeOccurrence[]): Promise<void>;
  activate(planId: number, date: string): Promise<void>;
  pause(planId: number, date: string): Promise<void>;
  resume(planId: number, date: string, occurrences: readonly ResumeOccurrence[]): Promise<void>;
  audit(event: SetupAudit): Promise<void>;
}
export interface SimplifiedSetupRepository { transaction<T>(work: (tx: SimplifiedSetupTx) => Promise<T>): Promise<T> }

function requireActor(actor: SetupActor) {
  if (!Number.isSafeInteger(actor.id) || actor.id < 1 || actor.isActive !== 1 || !canManagePmv2Foundation(actor.role)) throw new Error("ليس لديك صلاحية لإدارة الصيانة المجدولة");
}
function requireId(id: number) { if (!Number.isSafeInteger(id) || id < 1) throw new Error("البيانات المحددة غير صالحة"); }
function validateDate(date: string) {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) throw new Error("تاريخ العملية غير صالح");
}
function requiredTitle(value: string, label: string, max: number) {
  if (typeof value !== "string") throw new Error(`${label} غير صالح`);
  const result = value.trim();
  if (!result || result.length > max) throw new Error(`${label} غير صالح`);
  return result;
}

export class SimplifiedSetupService {
  constructor(private readonly repository: SimplifiedSetupRepository, private readonly today: () => string) {}
  async create(actor: SetupActor, input: SetupBase) {
    requireActor(actor);
    const data = { ...input, title: requiredTitle(input.title, "عنوان المهمة الرئيسية", 200) };
    requireId(data.siteId); requireId(data.sectionId); requireId(data.teamId);
    return this.repository.transaction(async tx => {
      if (!await tx.validateActor(actor)) throw new Error("ليس لديك صلاحية لإدارة الصيانة المجدولة");
      // Lock the shared team before the location, matching activation/scheduler ordering.
      if (!await tx.validateTeam(data.teamId)) throw new Error("فريق الصيانة غير متاح أو لا يملك أعضاء ومستودعًا صالحين");
      if (!await tx.validateSiteSection(data.siteId, data.sectionId)) throw new Error("القسم غير مرتبط بالموقع أو غير نشط");
      const id = await tx.createDraft(data, actor.id); requireId(id);
      await tx.audit({ action: "simplified_plan_created", planId: id, actorId: actor.id, details: data });
      return { id };
    });
  }
  async addItem(actor: SetupActor, planId: number, input: SetupItem) {
    requireActor(actor); requireId(planId);
    const item = {
      ...input,
      titleAr: requiredTitle(input.titleAr, "عنوان المهمة بالعربية", 300),
      titleEn: requiredTitle(input.titleEn, "عنوان المهمة بالإنجليزية", 300),
      titleUr: requiredTitle(input.titleUr, "عنوان المهمة بالأوردو", 300),
    };
    const schedule = buildSimplifiedSchedule(item.recurrence);
    return this.repository.transaction(async tx => {
      if (!await tx.validateActor(actor)) throw new Error("ليس لديك صلاحية لإدارة الصيانة المجدولة");
      const plan = await tx.lockPlan(planId);
      if (!plan || plan.state !== "draft") throw new Error("لا يمكن إضافة مهمة فرعية لهذه الحالة");
      const id = await tx.addItem(planId, item, schedule, actor.id); requireId(id);
      await tx.audit({ action: "simplified_item_created", planId, actorId: actor.id, details: { id, ...item } });
      return { id };
    });
  }
  async activate(actor: SetupActor, planId: number) {
    requireActor(actor); requireId(planId); const date = this.today(); validateDate(date);
    return this.repository.transaction(async tx => {
      if (!await tx.validateActor(actor)) throw new Error("ليس لديك صلاحية لإدارة الصيانة المجدولة");
      const plan = await tx.lockPlan(planId);
      if (!plan || plan.state !== "draft") throw new Error("المهمة ليست مسودة قابلة للتفعيل");
      if (!(await tx.listItems(planId)).length) throw new Error("أضف مهمة فرعية قبل التفعيل");
      if (!await tx.validateSiteSection(plan.siteId, plan.sectionId)) throw new Error("الموقع أو القسم لم يعد متاحًا");
      if (!await tx.validateTeam(plan.teamId)) throw new Error("فريق الصيانة لم يعد متاحًا");
      await tx.activate(planId, date);
      await tx.audit({ action: "simplified_plan_activated", planId, actorId: actor.id, details: { date } });
    });
  }
  async pause(actor: SetupActor, planId: number) {
    requireActor(actor); requireId(planId); const date = this.today(); validateDate(date);
    return this.repository.transaction(async tx => {
      if (!await tx.validateActor(actor)) throw new Error("ليس لديك صلاحية لإدارة الصيانة المجدولة");
      const plan = await tx.lockPlan(planId);
      if (!plan || plan.state !== "active") throw new Error("المهمة غير فعالة أو متوقفة بالفعل");
      await tx.pause(planId, date);
      await tx.audit({ action: "simplified_plan_paused", planId, actorId: actor.id, details: { date } });
    });
  }
  async resume(actor: SetupActor, planId: number) {
    requireActor(actor); requireId(planId); const date = this.today(); validateDate(date);
    return this.repository.transaction(async tx => {
      if (!await tx.validateActor(actor)) throw new Error("ليس لديك صلاحية لإدارة الصيانة المجدولة");
      const plan = await tx.lockPlan(planId);
      if (!plan || plan.state !== "paused" || !plan.pausedOn) throw new Error("المهمة ليست متوقفة مؤقتًا");
      if (!await tx.validateSiteSection(plan.siteId, plan.sectionId)) throw new Error("الموقع أو القسم لم يعد متاحًا");
      if (!await tx.validateTeam(plan.teamId)) throw new Error("فريق الصيانة لم يعد متاحًا");
      const items = await tx.listItems(planId, { from: plan.pausedOn, to: date });
      const occurrences = planResumeOccurrences(items, plan.pausedOn, date);
      await tx.resume(planId, date, occurrences);
      await tx.audit({ action: "simplified_plan_resumed", planId, actorId: actor.id, details: { date, occurrences } });
      return { occurrences };
    });
  }
}

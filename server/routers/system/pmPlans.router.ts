import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { router, protectedProcedure, managerProcedure } from "../_shared/procedures";
import * as db from "../../_core/db";

// ============================================================
// توليد عنوان الخطة الفرعية تلقائياً: "التكرار + قسم الصيانة"
// مثال: "الصيانة الوقائية الأسبوعية - الكهرباء"
// ============================================================
const FREQ_ADJ_AR: Record<string, string> = {
  daily: "اليومية",
  weekly: "الأسبوعية",
  monthly: "الشهرية",
  quarterly: "ربع السنوية",
  biannual: "نصف السنوية",
  annual: "السنوية",
};
const FREQ_ADJ_EN: Record<string, string> = {
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
  quarterly: "Quarterly",
  biannual: "Semi-Annual",
  annual: "Annual",
};
const FREQ_ADJ_UR: Record<string, string> = {
  daily: "روزانہ",
  weekly: "ہفتہ وار",
  monthly: "ماہانہ",
  quarterly: "سہ ماہی",
  biannual: "ششماہی",
  annual: "سالانہ",
};

function buildSubPlanTitles(frequency: string, section: { title: string; title_ar?: string | null; title_en?: string | null; title_ur?: string | null }) {
  const sectionAr = section.title_ar || section.title;
  const sectionEn = section.title_en || section.title;
  const sectionUr = section.title_ur || section.title;
  return {
    title: `الصيانة الوقائية ${FREQ_ADJ_AR[frequency] ?? frequency} - ${sectionAr}`,
    title_ar: `الصيانة الوقائية ${FREQ_ADJ_AR[frequency] ?? frequency} - ${sectionAr}`,
    title_en: `${FREQ_ADJ_EN[frequency] ?? frequency} Preventive Maintenance - ${sectionEn}`,
    title_ur: `${FREQ_ADJ_UR[frequency] ?? frequency} احتیاطی دیکھ بھال - ${sectionUr}`,
  };
}

const checklistItemInput = z.object({
  text: z.string().min(1),
  isRequired: z.boolean().optional(),
});

export const pmPlansRouter = router({
  // ─── Main Plans (البطاقة الرئيسية) ────────────────────────────────────
  listMainPlans: protectedProcedure.query(async () => {
    return db.listMainPlans();
  }),

  listOperationalBranchesWithoutMainPlan: protectedProcedure.query(async () => {
    return db.listOperationalBranchesWithoutMainPlan();
  }),

  createMainPlan: managerProcedure.input(z.object({
    branchId: z.number(),
  })).mutation(async ({ input, ctx }) => {
    const branch = await db.getPreventivePlanById(input.branchId);
    if (!branch) throw new TRPCError({ code: "NOT_FOUND", message: "القسم التشغيلي غير موجود في الشجرة" });
    if (branch.parentId != null) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "يجب اختيار فرع تشغيلي جذري (قسم تشغيلي) وليس قسم صيانة فرعي" });
    }
    const result = await db.createMainPlan({ branchId: input.branchId, createdById: ctx.user.id });
    return result;
  }),

  deleteMainPlan: managerProcedure.input(z.object({ id: z.number() })).mutation(async ({ input }) => {
    return db.deleteMainPlan(input.id);
  }),

  // ─── Sub Plans (الخطة الفرعية) ─────────────────────────────────────────
  listSubPlans: protectedProcedure.input(z.object({ mainPlanId: z.number() })).query(async ({ input }) => {
    return db.listSubPlans(input.mainPlanId);
  }),

  listSectionOptionsForMainPlan: protectedProcedure.input(z.object({ mainPlanId: z.number() })).query(async ({ input }) => {
    return db.listSectionOptionsForMainPlan(input.mainPlanId);
  }),

  getSubPlanDetail: protectedProcedure.input(z.object({ id: z.number() })).query(async ({ input }) => {
    const subPlan = await db.getSubPlanById(input.id);
    if (!subPlan) throw new TRPCError({ code: "NOT_FOUND", message: "الخطة الفرعية غير موجودة" });
    const checklist = await db.getSubPlanChecklist(input.id);
    return { ...subPlan, checklist };
  }),

  createSubPlan: managerProcedure.input(z.object({
    mainPlanId: z.number(),
    sectionBranchId: z.number(),
    frequency: z.enum(["daily", "weekly", "monthly", "quarterly", "biannual", "annual"]),
    frequencyValue: z.number().default(1),
    estimatedDurationMinutes: z.number().optional(),
    assignedToId: z.number().optional(),
    description: z.string().optional(),
    nextDueDate: z.string().optional(),
    checklist: z.array(checklistItemInput).default([]),
  })).mutation(async ({ input, ctx }) => {
    const mainPlan = await db.getMainPlanById(input.mainPlanId);
    if (!mainPlan) throw new TRPCError({ code: "NOT_FOUND", message: "البطاقة الرئيسية غير موجودة" });

    const section = await db.getPreventivePlanById(input.sectionBranchId);
    if (!section) throw new TRPCError({ code: "NOT_FOUND", message: "قسم الصيانة غير موجود في الشجرة" });
    if (section.parentId !== mainPlan.branchId) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "قسم الصيانة المختار لا ينتمي لهذا القسم التشغيلي" });
    }

    const titles = buildSubPlanTitles(input.frequency, section);
    const nextDue = input.nextDueDate ? new Date(input.nextDueDate) : db.calcNextDueDate(new Date(), input.frequency, input.frequencyValue);

    const result = await db.createSubPlan(
      {
        mainPlanId: input.mainPlanId,
        sectionBranchId: input.sectionBranchId,
        ...titles,
        originalLanguage: "ar",
        frequency: input.frequency,
        frequencyValue: input.frequencyValue,
        estimatedDurationMinutes: input.estimatedDurationMinutes,
        assignedToId: input.assignedToId,
        description: input.description,
        isActive: true,
        nextDueDate: nextDue,
        createdById: ctx.user.id,
      } as any,
      input.checklist
    );
    return result;
  }),

  updateSubPlan: managerProcedure.input(z.object({
    id: z.number(),
    frequency: z.enum(["daily", "weekly", "monthly", "quarterly", "biannual", "annual"]).optional(),
    frequencyValue: z.number().optional(),
    estimatedDurationMinutes: z.number().optional(),
    assignedToId: z.number().optional(),
    description: z.string().optional(),
    isActive: z.boolean().optional(),
    nextDueDate: z.string().optional(),
    checklist: z.array(checklistItemInput).optional(),
  })).mutation(async ({ input, ctx }) => {
    const existing = await db.getSubPlanById(input.id);
    if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "الخطة الفرعية غير موجودة" });

    const newFrequency = input.frequency ?? existing.frequency;
    let titles = {};
    if (input.frequency && input.frequency !== existing.frequency) {
      const section = await db.getPreventivePlanById(existing.sectionBranchId);
      if (section) titles = buildSubPlanTitles(newFrequency, section);
    }

    await db.updateSubPlan(input.id, {
      frequency: input.frequency,
      frequencyValue: input.frequencyValue,
      estimatedDurationMinutes: input.estimatedDurationMinutes,
      assignedToId: input.assignedToId,
      description: input.description,
      isActive: input.isActive,
      nextDueDate: input.nextDueDate ? new Date(input.nextDueDate) : undefined,
      ...titles,
    } as any);

    if (input.checklist) {
      await db.replaceSubPlanChecklist(input.id, input.checklist);
    }
    return { success: true };
  }),

  deleteSubPlan: managerProcedure.input(z.object({ id: z.number() })).mutation(async ({ input }) => {
    return db.deleteSubPlan(input.id);
  }),

  // ─── Work Orders من خطة فرعية ──────────────────────────────────────────
  createWorkOrderFromSubPlan: managerProcedure.input(z.object({
    subPlanId: z.number(),
    scheduledDate: z.string().optional(),
  })).mutation(async ({ input, ctx }) => {
    const scheduledDate = input.scheduledDate ? new Date(input.scheduledDate) : new Date();
    return db.createWorkOrderFromSubPlan({ subPlanId: input.subPlanId, scheduledDate, createdById: ctx.user.id });
  }),
});

// ============================================================
// db/pmPlans.ts — خطط الصيانة الدورية (التصميم الجديد، مستقل عن الشجرة)
// ============================================================
// المبدأ: preventivePlans (الشجرة) هيكل تنظيمي بحت (موقع ← قسم تشغيلي ←
// أقسام صيانة) ولا يتأثر أبداً بإنشاء/تعديل/حذف أي خطة هنا. هذا الملف يتعامل
// مع جداول pm_main_plans / pm_sub_plans / pm_sub_plan_checklist_items
// المستقلة تماماً، وتُشير لعقد الشجرة بحقول عادية (بدون FK فعلي بالقاعدة)
// للقراءة فقط.
import { eq, and, count, asc, desc, isNull } from "drizzle-orm";
import {
  pmMainPlans, pmSubPlans, pmSubPlanChecklistItems, preventivePlans, pmWorkOrders, sites,
  type InsertPMMainPlan, type InsertPMSubPlan, type InsertPMSubPlanChecklistItem,
} from "../../../drizzle/schema";
import { getDb } from "./client";
import { generateWorkOrderNumber, calcNextDueDate } from "./preventive";

// ============================================================
// PM MAIN PLANS — البطاقة الرئيسية (واحدة فقط لكل قسم تشغيلي)
// ============================================================

export async function listMainPlans() {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select({
      id: pmMainPlans.id,
      branchId: pmMainPlans.branchId,
      createdById: pmMainPlans.createdById,
      createdAt: pmMainPlans.createdAt,
      branchTitle: preventivePlans.title,
      branchTitle_ar: preventivePlans.title_ar,
      branchTitle_en: preventivePlans.title_en,
      branchTitle_ur: preventivePlans.title_ur,
      siteId: preventivePlans.siteId,
      siteName: sites.name,
      siteNameEn: sites.nameEn,
      siteNameUr: sites.nameUr,
    })
    .from(pmMainPlans)
    .innerJoin(preventivePlans, eq(pmMainPlans.branchId, preventivePlans.id))
    .leftJoin(sites, eq(preventivePlans.siteId, sites.id))
    .orderBy(asc(pmMainPlans.id));

  // عدد الخطط الفرعية لكل بطاقة (استعلام واحد إضافي بدل N+1 على كل صف)
  const subCounts = await db
    .select({ mainPlanId: pmSubPlans.mainPlanId, cnt: count() })
    .from(pmSubPlans)
    .groupBy(pmSubPlans.mainPlanId);
  const countMap = new Map(subCounts.map((r: any) => [r.mainPlanId, r.cnt]));

  return rows.map((r: any) => ({ ...r, subPlansCount: countMap.get(r.id) ?? 0 }));
}

export async function getMainPlanByBranchId(branchId: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(pmMainPlans).where(eq(pmMainPlans.branchId, branchId)).limit(1);
  return rows[0] ?? null;
}

export async function getMainPlanById(id: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(pmMainPlans).where(eq(pmMainPlans.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function createMainPlan(data: InsertPMMainPlan) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const existing = await getMainPlanByBranchId(data.branchId);
  if (existing) throw new Error("يوجد بطاقة رئيسية بالفعل لهذا القسم التشغيلي");
  const result = await db.insert(pmMainPlans).values(data);
  const id = (result as any)[0]?.insertId ?? null;
  return { id };
}

export async function deleteMainPlan(id: number) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const subCount = await db.select({ cnt: count() }).from(pmSubPlans).where(eq(pmSubPlans.mainPlanId, id));
  if ((subCount[0]?.cnt ?? 0) > 0) {
    throw new Error(`لا يمكن حذف هذه البطاقة الرئيسية لوجود ${subCount[0].cnt} خطة فرعية تابعة لها — احذفها أولاً`);
  }
  await db.delete(pmMainPlans).where(eq(pmMainPlans.id, id));
  return { success: true };
}

// أقسام الصيانة المتاحة للاختيار كـ"قسم مسؤول" لخطة فرعية تحت بطاقة رئيسية
// معيّنة — هي أبناء الفرع التشغيلي (branchId) في الشجرة فقط.
export async function listSectionOptionsForMainPlan(mainPlanId: number) {
  const db = await getDb();
  if (!db) return [];
  const main = await getMainPlanById(mainPlanId);
  if (!main) return [];
  return db.select().from(preventivePlans).where(eq(preventivePlans.parentId, main.branchId)).orderBy(asc(preventivePlans.id));
}

// الفروع التشغيلية (فروع جذرية بالشجرة) التي ما عندها بطاقة رئيسية بعد —
// تُستخدم بنافذة "إضافة خطة رئيسية" (اختيار الموقع ثم القسم التشغيلي).
export async function listOperationalBranchesWithoutMainPlan() {
  const db = await getDb();
  if (!db) return [];
  const roots = await db
    .select({
      id: preventivePlans.id,
      parentId: preventivePlans.parentId,
      title: preventivePlans.title,
      title_ar: preventivePlans.title_ar,
      title_en: preventivePlans.title_en,
      title_ur: preventivePlans.title_ur,
      siteId: preventivePlans.siteId,
      siteName: sites.name,
      siteNameEn: sites.nameEn,
      siteNameUr: sites.nameUr,
    })
    .from(preventivePlans)
    .leftJoin(sites, eq(preventivePlans.siteId, sites.id))
    .where(and(eq(preventivePlans.isGroupOnly, true), isNull(preventivePlans.parentId)));
  const existing = await db.select({ branchId: pmMainPlans.branchId }).from(pmMainPlans);
  const existingIds = new Set(existing.map((e: any) => e.branchId));
  return roots.filter((r: any) => !existingIds.has(r.id));
}

// ============================================================
// PM SUB PLANS — الخطة الفرعية
// ============================================================

export async function listSubPlans(mainPlanId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select({
      id: pmSubPlans.id,
      mainPlanId: pmSubPlans.mainPlanId,
      sectionBranchId: pmSubPlans.sectionBranchId,
      title: pmSubPlans.title,
      title_ar: pmSubPlans.title_ar,
      title_en: pmSubPlans.title_en,
      title_ur: pmSubPlans.title_ur,
      frequency: pmSubPlans.frequency,
      frequencyValue: pmSubPlans.frequencyValue,
      estimatedDurationMinutes: pmSubPlans.estimatedDurationMinutes,
      assignedToId: pmSubPlans.assignedToId,
      description: pmSubPlans.description,
      description_ar: pmSubPlans.description_ar,
      description_en: pmSubPlans.description_en,
      description_ur: pmSubPlans.description_ur,
      isActive: pmSubPlans.isActive,
      nextDueDate: pmSubPlans.nextDueDate,
      lastGeneratedAt: pmSubPlans.lastGeneratedAt,
      createdAt: pmSubPlans.createdAt,
      sectionTitle: preventivePlans.title,
      sectionTitle_ar: preventivePlans.title_ar,
      sectionTitle_en: preventivePlans.title_en,
      sectionTitle_ur: preventivePlans.title_ur,
    })
    .from(pmSubPlans)
    .leftJoin(preventivePlans, eq(pmSubPlans.sectionBranchId, preventivePlans.id))
    .where(eq(pmSubPlans.mainPlanId, mainPlanId))
    .orderBy(asc(pmSubPlans.id));
}

export async function getSubPlanById(id: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(pmSubPlans).where(eq(pmSubPlans.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function createSubPlan(
  data: InsertPMSubPlan,
  checklist: { text: string; text_ar?: string; text_en?: string; text_ur?: string; isRequired?: boolean }[]
) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const result = await db.insert(pmSubPlans).values(data);
  const id = (result as any)[0]?.insertId ?? null;
  if (id && checklist.length > 0) {
    await db.insert(pmSubPlanChecklistItems).values(
      checklist.map((c, idx) => ({
        subPlanId: id,
        orderIndex: idx,
        text: c.text,
        text_ar: c.text_ar,
        text_en: c.text_en,
        text_ur: c.text_ur,
        isRequired: c.isRequired ?? true,
      }))
    );
  }
  return { id };
}

export async function updateSubPlan(id: number, data: Partial<InsertPMSubPlan>) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.update(pmSubPlans).set(data).where(eq(pmSubPlans.id, id));
  return { success: true };
}

export async function deleteSubPlan(id: number) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const woCount = await db.select({ cnt: count() }).from(pmWorkOrders).where(eq(pmWorkOrders.subPlanId, id));
  if ((woCount[0]?.cnt ?? 0) > 0) {
    throw new Error(`لا يمكن حذف هذه الخطة الفرعية لوجود ${woCount[0].cnt} أمر عمل مرتبط بها`);
  }
  await db.delete(pmSubPlanChecklistItems).where(eq(pmSubPlanChecklistItems.subPlanId, id));
  await db.delete(pmSubPlans).where(eq(pmSubPlans.id, id));
  return { success: true };
}

export async function getSubPlanChecklist(subPlanId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(pmSubPlanChecklistItems)
    .where(eq(pmSubPlanChecklistItems.subPlanId, subPlanId))
    .orderBy(asc(pmSubPlanChecklistItems.orderIndex));
}

export async function replaceSubPlanChecklist(
  subPlanId: number,
  checklist: { text: string; text_ar?: string; text_en?: string; text_ur?: string; isRequired?: boolean }[]
) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.delete(pmSubPlanChecklistItems).where(eq(pmSubPlanChecklistItems.subPlanId, subPlanId));
  if (checklist.length > 0) {
    await db.insert(pmSubPlanChecklistItems).values(
      checklist.map((c, idx) => ({
        subPlanId,
        orderIndex: idx,
        text: c.text,
        text_ar: c.text_ar,
        text_en: c.text_en,
        text_ur: c.text_ur,
        isRequired: c.isRequired ?? true,
      }))
    );
  }
  return { success: true };
}

// هل يوجد أي خطة فرعية ترتبط بهذا الفرع (قسم صيانة) في الشجرة؟ — تُستخدم لمنع
// حذف/تعديل اسم قسم الصيانة إن كان مرتبطاً بخطة فرعية (طلب صاحب المشروع).
export async function countSubPlansLinkedToBranch(branchId: number): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const rows = await db.select({ cnt: count() }).from(pmSubPlans).where(eq(pmSubPlans.sectionBranchId, branchId));
  return rows[0]?.cnt ?? 0;
}

// ============================================================
// PM WORK ORDERS (مرتبطة بالخطة الفرعية) — التصميم الجديد
// ============================================================

export async function createWorkOrderFromSubPlan(params: { subPlanId: number; scheduledDate: Date; createdById?: number }) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const subPlan = await getSubPlanById(params.subPlanId);
  if (!subPlan) throw new Error("الخطة الفرعية غير موجودة");

  const woNumber = await generateWorkOrderNumber();
  const result = await db.insert(pmWorkOrders).values({
    workOrderNumber: woNumber,
    subPlanId: subPlan.id,
    title: subPlan.title,
    scheduledDate: params.scheduledDate,
    status: "scheduled",
    assignedToId: subPlan.assignedToId ?? undefined,
    checklistResults: [],
  } as any);
  const woId = (result as any)[0]?.insertId ?? null;

  const nextDue = calcNextDueDate(params.scheduledDate, subPlan.frequency, subPlan.frequencyValue ?? 1);
  await updateSubPlan(subPlan.id, { lastGeneratedAt: new Date(), nextDueDate: nextDue });

  if (subPlan.assignedToId) {
    try {
      const { sendPushToUser } = await import("../../services/notifications/webPush");
      const scheduledDateStr = params.scheduledDate.toLocaleDateString("ar-SA");
      await sendPushToUser(subPlan.assignedToId, {
        title: "تكليف جديد: صيانة وقائية 🔧",
        body: `مهمة: ${subPlan.title}\nرقم الأمر: ${woNumber}\nالتاريخ: ${scheduledDateStr}`,
        tag: `pm-wo-${woId}`,
      });
    } catch (e) {
      console.error("[createWorkOrderFromSubPlan] Push notification failed:", e);
    }
  }

  return { id: woId, workOrderNumber: woNumber };
}

// بنود الفحص لأمر عمل مبني على خطة فرعية جديدة — تُنسخ من pm_sub_plan_checklist_items
// الخاصة بالخطة الفرعية وقت إنشاء أمر العمل (نسخة ثابتة لا تتغير لو عُدّلت الخطة لاحقاً).
export async function getChecklistItemsForSubPlan(subPlanId: number) {
  return getSubPlanChecklist(subPlanId);
}

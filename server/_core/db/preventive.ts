// ============================================================
// db/preventive.ts — الصيانة الوقائية: الخطط والشجرة وأوامر العمل
// (مُقسَّم من db.ts الأصلي حسب المجال الوظيفي)
// ============================================================
import { eq, desc, asc, and, sql, count, sum, inArray, notInArray, like, or, gte, lte, lt, isNull, isNotNull, ne } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { alias } from "drizzle-orm/mysql-core";
import mysql from "mysql2/promise";
import {
  InsertUser, users, tickets, purchaseOrders, purchaseOrderItems,
  inventory, inventoryTransactions, notifications, auditLogs,
  ticketStatusHistory, attachments, sites, backups,
  assets, preventivePlans, pmWorkOrders, assetSpareParts, pmJobs, assetMetrics,
  pmChecklistItems, pmWorkOrderBranches,
  twoFactorSecrets, twoFactorAuditLogs,
  pushSubscriptions, sections, technicians, inspectionResults,
  type InsertAsset, type InsertPreventivePlan, type PreventivePlan, type InsertPMWorkOrder,
  type InsertSection, type InsertInspectionResult,
  assetCategories,
  procurementComments,
  type InsertProcurementComment,
  warehouseReceipts,
  warehouseReturns,
  warehouseReceiptItems,
  ocrJobs,
  type InsertWarehouseReceipt,
  type InsertWarehouseReturn,
  ticketConfirmations,
  type InsertTicketConfirmation,
  deliveryDocuments,
  returnDocuments,
  deliveryNumberCounter,
  itemBarcodeCounter,
  disposalOperations,
  disposalItems,
  disposalNumberCounter,
  poPricingBatches,
  type InsertPOPricingBatch,
  inventoryCountOperations,
  inventoryCountItems,
  inventorySettlements,
  inventorySettlementItems,
  inventoryCountNumberCounter,
  inventorySettlementNumberCounter,
} from "../../../drizzle/schema";
import { ENV } from '../env';


import { getDb } from "./client";

// ============================================================
// PREVENTIVE PLANS - خطط الصيانة الوقائية
// ============================================================
export async function listPreventivePlans(filters?: { assetId?: number; siteId?: number; isActive?: boolean }) {
  const db = await getDb();
  if (!db) return [];
  const conditions = [];
  if (filters?.assetId) conditions.push(eq(preventivePlans.assetId, filters.assetId));
  if (filters?.siteId) conditions.push(eq(preventivePlans.siteId, filters.siteId));
  if (filters?.isActive !== undefined) conditions.push(eq(preventivePlans.isActive, filters.isActive));
  let query = db.select().from(preventivePlans);
  if (conditions.length > 0) return await (query as any).where(and(...conditions)).orderBy(desc(preventivePlans.createdAt));
  return await query.orderBy(desc(preventivePlans.createdAt));
}

export async function getPreventivePlanById(id: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(preventivePlans).where(eq(preventivePlans.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function createPreventivePlan(data: InsertPreventivePlan) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const result = await db.insert(preventivePlans).values(data);
  const id = (result as any)[0]?.insertId ?? null;
  return { id };
}

export async function updatePreventivePlan(id: number, data: Partial<InsertPreventivePlan>) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.update(preventivePlans).set(data).where(eq(preventivePlans.id, id));
  return { success: true };
}

export async function deletePreventivePlan(id: number) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.delete(preventivePlans).where(eq(preventivePlans.id, id));
  return { success: true };
}

export async function generatePlanNumber() {
  const db = await getDb();
  if (!db) return `PM-${Date.now()}`;
  const rows = await db.select({ cnt: count() }).from(preventivePlans);
  const n = (rows[0]?.cnt ?? 0) + 1;
  return `PM-${String(n).padStart(5, "0")}`;
}

// ============================================================
// PM BRANCH TREE - شجرة فروع الصيانة الدورية
// ============================================================
// كل صف في preventivePlans هو "فرع" في الشجرة. الفرع بدون parentId هو فرع
// جذر. الفروع التجميعية البحتة (isGroupOnly = true) لا يُنشأ منها أمر عمل
// ولا تدخل الأتمتة الدورية — انظر التحقق في createBranch/pm-automation.

export type PMBranchNode = PreventivePlan & { children: PMBranchNode[] };

// جلب الشجرة كاملة مبنية هرمياً (جاهزة للعرض مباشرة بدون بناء يدوي بالواجهة)
export async function listBranchTree(): Promise<PMBranchNode[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(preventivePlans).orderBy(asc(preventivePlans.id));
  const byId = new Map<number, PMBranchNode>();
  for (const row of rows) byId.set(row.id, { ...row, children: [] });
  const roots: PMBranchNode[] = [];
  for (const row of rows) {
    const node = byId.get(row.id)!;
    if (row.parentId && byId.has(row.parentId)) {
      byId.get(row.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

// جلب فرع واحد فقط + قائمة أبنائه المباشرين (تفيد شاشة "إدارة فرع" بدون تحميل الشجرة كاملة)
export async function getBranchWithChildren(id: number) {
  const db = await getDb();
  if (!db) return null;
  const branch = await getPreventivePlanById(id);
  if (!branch) return null;
  const children = await db.select().from(preventivePlans).where(eq(preventivePlans.parentId, id)).orderBy(asc(preventivePlans.id));
  return { ...branch, children };
}

// المسار الكامل من الجذر إلى هذا الفرع — مثال: [مطعم البيتزاليا, الكهرباء, اللوحات الكهربائية]
// يُستخدم في العرض والطباعة لاحقاً. يحمي من الحلقات اللانهائية (maxDepth احترازي).
export async function getBranchPath(id: number): Promise<PreventivePlan[]> {
  const db = await getDb();
  if (!db) return [];
  const path: PreventivePlan[] = [];
  let currentId: number | null = id;
  const maxDepth = 20; // احتراز فقط — لا يوجد حد صارم فعلي على العمق
  for (let i = 0; i < maxDepth && currentId; i++) {
    const branch = await getPreventivePlanById(currentId);
    if (!branch) break;
    path.unshift(branch);
    currentId = branch.parentId ?? null;
  }
  return path;
}

export async function createBranch(data: InsertPreventivePlan & { parentId?: number | null; isGroupOnly?: boolean }) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  // فرع تجميعي بحت: يُسمح بدون frequency. فرع تنفيذي: frequency إلزامي منطقياً (يُتحقق بالـ router).
  const result = await db.insert(preventivePlans).values(data);
  const id = (result as any)[0]?.insertId ?? null;
  return { id };
}

export async function updateBranch(id: number, data: Partial<InsertPreventivePlan>) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  // منع جعل الفرع أباً لنفسه (self-parenting) بشكل مباشر
  if (data.parentId !== undefined && data.parentId === id) {
    throw new Error("لا يمكن أن يكون الفرع أباً لنفسه");
  }
  // منع تعديل اسم "قسم الصيانة" إذا كان مرتبطاً بأي خطة فرعية (التصميم الجديد المستقل عن الشجرة)
  const titleFieldsChanged = ["title", "title_ar", "title_en", "title_ur"].some(
    (f) => (data as any)[f] !== undefined
  );
  if (titleFieldsChanged) {
    const { countSubPlansLinkedToBranch } = await import("./pmPlans");
    const linkedCount = await countSubPlansLinkedToBranch(id);
    if (linkedCount > 0) {
      throw new Error(`لا يمكن تعديل اسم هذا القسم لارتباطه بـ ${linkedCount} خطة صيانة — عدّل الخطط أو انقلها أولاً`);
    }
  }
  await db.update(preventivePlans).set(data).where(eq(preventivePlans.id, id));
  return { success: true };
}

// تحقق قبل الحذف: هل عند الفرع أبناء؟ هل عنده أوامر عمل مرتبطة (مباشرة أو عبر الحل الهجين)؟
export async function getBranchDeletionBlockers(id: number): Promise<{ childrenCount: number; workOrdersCount: number; linkedSubPlansCount: number }> {
  const db = await getDb();
  if (!db) return { childrenCount: 0, workOrdersCount: 0, linkedSubPlansCount: 0 };
  const children = await db.select({ cnt: count() }).from(preventivePlans).where(eq(preventivePlans.parentId, id));
  const directWOs = await db.select({ cnt: count() }).from(pmWorkOrders).where(eq(pmWorkOrders.planId, id));
  const branchWOs = await db.select({ cnt: count() }).from(pmWorkOrderBranches).where(eq(pmWorkOrderBranches.planId, id));
  const { countSubPlansLinkedToBranch } = await import("./pmPlans");
  const linkedSubPlansCount = await countSubPlansLinkedToBranch(id);
  return {
    childrenCount: children[0]?.cnt ?? 0,
    workOrdersCount: (directWOs[0]?.cnt ?? 0) + (branchWOs[0]?.cnt ?? 0),
    linkedSubPlansCount,
  };
}

export async function deleteBranch(id: number) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const blockers = await getBranchDeletionBlockers(id);
  if (blockers.childrenCount > 0) {
    throw new Error(`لا يمكن حذف هذا الفرع لأنه يحتوي على ${blockers.childrenCount} فرع فرعي — احذف الأبناء أولاً`);
  }
  if (blockers.workOrdersCount > 0) {
    throw new Error(`لا يمكن حذف هذا الفرع لوجود ${blockers.workOrdersCount} أمر عمل مرتبط به`);
  }
  if (blockers.linkedSubPlansCount > 0) {
    throw new Error(`لا يمكن حذف هذا القسم لارتباطه بـ ${blockers.linkedSubPlansCount} خطة صيانة — احذف الخطط أولاً`);
  }
  // بنود الفحص الخاصة بالفرع تُحذف معه (لا فائدة من بقائها يتيمة)
  await db.delete(pmChecklistItems).where(eq(pmChecklistItems.planId, id));
  await db.delete(preventivePlans).where(eq(preventivePlans.id, id));
  return { success: true };
}

// ============================================================
// PM WORK ORDERS - أوامر العمل الوقائية
// ============================================================

// يجمع كل الفروع التنفيذية (isGroupOnly = false) تحت فرع معيّن — يشمل الفرع نفسه
// إن كان تنفيذياً، وكل أحفاده التنفيذيين على أي عمق (يتجاهل الفروع التجميعية
// الوسيطة، فهي مجرد عناوين تنظيمية). تُستخدم لبناء نافذة "إنشاء أمر عمل" الهجينة.
export async function getExecutableDescendants(rootId: number): Promise<PreventivePlan[]> {
  const db = await getDb();
  if (!db) return [];
  const root = await getPreventivePlanById(rootId);
  if (!root) return [];
  const result: PreventivePlan[] = [];
  if (!root.isGroupOnly) result.push(root);
  const queue: number[] = [rootId];
  let guard = 0;
  while (queue.length > 0 && guard < 500) {
    const currentId = queue.shift()!;
    const children = await db.select().from(preventivePlans).where(eq(preventivePlans.parentId, currentId));
    for (const child of children) {
      if (!child.isGroupOnly) result.push(child);
      queue.push(child.id);
      guard++;
    }
  }
  return result;
}

// ينشئ أمر عمل واحد قد يضم فرعاً تنفيذياً واحداً أو عدة فروع (الحل الهجين).
// يربط كل فرع مُختار عبر pmWorkOrderBranches، ويحدّث nextDueDate لكل فرع بحسب
// تكراره الخاص، ويحافظ على planId (أول فرع) كـ"مرجع سريع" للتوافق مع الكود القديم.
export async function createHybridWorkOrder(params: {
  planIds: number[];
  scheduledDate: Date;
  createdById?: number;
}) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  if (params.planIds.length === 0) throw new Error("يجب اختيار فرع واحد على الأقل");

  const plans: PreventivePlan[] = [];
  for (const id of params.planIds) {
    const p = await getPreventivePlanById(id);
    if (!p) throw new Error(`الفرع رقم ${id} غير موجود`);
    if (p.isGroupOnly) throw new Error(`"${p.title}" فرع تجميعي ولا يمكن إنشاء أمر عمل منه مباشرة`);
    plans.push(p);
  }

  const primary = plans[0];
  const title = plans.length === 1
    ? primary.title
    : `${primary.title} (+${plans.length - 1} ${plans.length - 1 === 1 ? "فرع آخر" : "فروع أخرى"})`;

  const woNumber = await generateWorkOrderNumber();
  const created = await createPMWorkOrder({
    workOrderNumber: woNumber,
    planId: primary.id,
    assetId: primary.assetId ?? undefined,
    siteId: primary.siteId ?? undefined,
    title,
    scheduledDate: params.scheduledDate,
    status: "scheduled",
    assignedToId: primary.assignedToId ?? undefined,
    checklistResults: [],
  } as any);

  const woId = created.id as number;
  for (const p of plans) {
    await db.insert(pmWorkOrderBranches).values({ workOrderId: woId, planId: p.id });
    if (p.frequency) {
      const nextDue = calcNextDueDate(params.scheduledDate, p.frequency, p.frequencyValue ?? 1);
      await updatePreventivePlan(p.id, { lastGeneratedAt: new Date(), nextDueDate: nextDue });
    }
  }

  // إشعار push لكل فني مسؤول مختلف ضمن الفروع المُختارة (بدون تكرار نفس الفني)
  const uniqueTechnicianIds = Array.from(new Set(plans.map(p => p.assignedToId).filter((v): v is number => !!v)));
  for (const techId of uniqueTechnicianIds) {
    try {
      const { sendPushToUser } = await import("../../services/notifications/webPush");
      const scheduledDateStr = params.scheduledDate.toLocaleDateString("ar-SA");
      await sendPushToUser(techId, {
        title: "تكليف جديد: صيانة وقائية 🔧",
        body: `مهمة: ${title}\nرقم الأمر: ${woNumber}\nالتاريخ: ${scheduledDateStr}`,
        tag: `pm-wo-${woId}`,
      });
    } catch (e) {
      console.error("[createHybridWorkOrder] Push notification failed:", e);
    }
  }

  return { id: woId, workOrderNumber: woNumber };
}

export async function listPMWorkOrders(filters?: { planId?: number; assetId?: number; status?: string; assignedToId?: number }) {
  const db = await getDb();
  if (!db) return [];
  const conditions = [];
  if (filters?.planId) conditions.push(eq(pmWorkOrders.planId, filters.planId));
  if (filters?.assetId) conditions.push(eq(pmWorkOrders.assetId, filters.assetId));
  if (filters?.status) conditions.push(eq(pmWorkOrders.status, filters.status as any));
  if (filters?.assignedToId) conditions.push(eq(pmWorkOrders.assignedToId, filters.assignedToId));
  let query = db.select().from(pmWorkOrders);
  const rows = conditions.length > 0
    ? await (query as any).where(and(...conditions)).orderBy(desc(pmWorkOrders.scheduledDate))
    : await query.orderBy(desc(pmWorkOrders.scheduledDate));
  // Normalize: ensure checklistResults is always an array (never null)
  return rows.map((r: any) => ({ ...r, checklistResults: Array.isArray(r.checklistResults) ? r.checklistResults : [] }));
}

export async function getPMWorkOrderById(id: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(pmWorkOrders).where(eq(pmWorkOrders.id, id)).limit(1);
  const r = rows[0] ?? null;
  if (!r) return null;
  // Normalize: ensure checklistResults is always an array (never null)
  return { ...r, checklistResults: Array.isArray(r.checklistResults) ? r.checklistResults : [] };
}

export async function createPMWorkOrder(data: InsertPMWorkOrder) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const result = await db.insert(pmWorkOrders).values(data);
  const id = (result as any)[0]?.insertId ?? null;
  return { id };
}

export async function updatePMWorkOrder(id: number, data: Partial<InsertPMWorkOrder>) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.update(pmWorkOrders).set(data).where(eq(pmWorkOrders.id, id));
  return { success: true };
}

export async function generateWorkOrderNumber() {
  const db = await getDb();
  if (!db) return `WO-${Date.now()}`;
  const rows = await db.select({ cnt: count() }).from(pmWorkOrders);
  const n = (rows[0]?.cnt ?? 0) + 1;
  return `WO-${String(n).padStart(5, "0")}`;
}

// يجيب كل بنود الفحص الخاصة بأمر عمل، عبر كل الفروع المرتبطة به (الحل الهجين)
// مع اسم الفرع (planTitle) مرفق بكل بند لتُستخدم بتجميع العرض في شاشة التنفيذ.
// للتوافق مع أوامر العمل القديمة (قبل الشجرة الهرمية) بدون صفوف بـ
// pm_work_order_branches، يرجع تلقائياً لاستخدام wo.planId المفرد.
// دالة مشتركة: تجيب بنود الفحص لمجموعة فروع (planIds) مرتّبة حسب نفس ترتيب
// المصفوفة المُمرَّرة (كل فرع كتلة متتالية) ثم orderIndex داخل كل فرع. تُستخدم
// من مكانين: بعد إنشاء أمر العمل (getWorkOrderChecklistItems) ومن معاينة
// "توليد أمر عمل" قبل الإنشاء الفعلي (previewChecklistItems بالراوتر).
export async function getChecklistItemsForPlanIds(planIds: number[]) {
  const db = await getDb();
  if (!db || planIds.length === 0) return [];
  const items = await db.select().from(pmChecklistItems).where(inArray(pmChecklistItems.planId, planIds));
  const planOrder = new Map<number, number>(planIds.map((id, idx) => [id, idx]));
  items.sort((a, b) => {
    const branchDiff = (planOrder.get(a.planId) ?? 0) - (planOrder.get(b.planId) ?? 0);
    if (branchDiff !== 0) return branchDiff;
    return a.orderIndex - b.orderIndex;
  });
  const plansById = new Map<number, PreventivePlan>();
  for (const pid of planIds) {
    const p = await getPreventivePlanById(pid);
    if (p) plansById.set(pid, p);
  }
  return items.map(it => ({ ...it, planTitle: plansById.get(it.planId)?.title ?? "" }));
}

export async function getWorkOrderChecklistItems(workOrderId: number) {
  const db = await getDb();
  if (!db) return [];
  const wo = await getPMWorkOrderById(workOrderId);
  if (!wo) return [];
  // التصميم الجديد أولاً: أمر عمل مرتبط بخطة فرعية مستقلة (pm_sub_plans) —
  // بنوده من pm_sub_plan_checklist_items، بنفس شكل البنود القديمة تماماً
  // (نفس الأعمدة id/orderIndex/text/isRequired) مع planTitle = عنوان الخطة الفرعية.
  if ((wo as any).subPlanId) {
    const { getSubPlanChecklist, getSubPlanById } = await import("./pmPlans");
    const subPlan = await getSubPlanById((wo as any).subPlanId);
    const items = await getSubPlanChecklist((wo as any).subPlanId);
    return items.map((it: any) => ({ ...it, planTitle: subPlan?.title ?? "" }));
  }
  // التصميم القديم: عبر pm_work_order_branches أو planId المفرد
  const branchRows = await db.select().from(pmWorkOrderBranches).where(eq(pmWorkOrderBranches.workOrderId, workOrderId));
  const planIds = branchRows.length > 0 ? branchRows.map(b => b.planId) : (wo.planId ? [wo.planId] : []);
  return getChecklistItemsForPlanIds(planIds);
}

// حذف أمر عمل — مسموح فقط طالما لم يبدأ الفحص فعلياً (لا توجد جلسة تنفيذ، والحالة لا تزال "scheduled").
export async function deletePMWorkOrder(id: number) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const wo = await getPMWorkOrderById(id);
  if (!wo) throw new Error("أمر العمل غير موجود");
  if (wo.status !== "scheduled") {
    throw new Error("لا يمكن حذف أمر عمل بدأ تنفيذه بالفعل");
  }
  const { pmExecutionSessions, pmWorkOrderBranches: branchesTable } = await import("../../../drizzle/schema");
  const existingSession = await db.select().from(pmExecutionSessions).where(eq(pmExecutionSessions.workOrderId, id)).limit(1);
  if (existingSession.length > 0) {
    throw new Error("لا يمكن حذف أمر عمل بدأ تنفيذه بالفعل");
  }
  await db.delete(branchesTable).where(eq(branchesTable.workOrderId, id));
  await db.delete(pmWorkOrders).where(eq(pmWorkOrders.id, id));
  return { success: true };
}

// Calculate next due date based on frequency
export function calcNextDueDate(from: Date, frequency: string, frequencyValue: number = 1): Date {
  const d = new Date(from);
  switch (frequency) {
    case "daily": d.setDate(d.getDate() + frequencyValue); break;
    case "weekly": d.setDate(d.getDate() + 7 * frequencyValue); break;
    case "monthly": d.setMonth(d.getMonth() + frequencyValue); break;
    case "quarterly": d.setMonth(d.getMonth() + 3 * frequencyValue); break;
    case "biannual": d.setMonth(d.getMonth() + 6 * frequencyValue); break;
    case "annual": d.setFullYear(d.getFullYear() + frequencyValue); break;
  }
  return d;
}


// ============================================================
// PM JOBS - وظائف الصيانة الوقائية التلقائية
// ============================================================
export async function createPMJob(data: any) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const result = await db.insert(pmJobs).values(data);
  const id = (result as any)[0]?.insertId ?? null;
  return { id };
}

export async function getPendingPMJobs() {
  const db = await getDb();
  if (!db) return [];
  const now = new Date();
  return await db
    .select()
    .from(pmJobs)
    .where(and(eq(pmJobs.status, "pending"), lte(pmJobs.dueDate, now)))
    .orderBy(asc(pmJobs.dueDate));
}

export async function updatePMJob(id: number, data: Partial<any>) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.update(pmJobs).set(data).where(eq(pmJobs.id, id));
  return { success: true };
}


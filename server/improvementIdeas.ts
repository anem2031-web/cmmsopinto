// ============================================================
// مركز التحسين والتطوير — وصول قاعدة البيانات
// ملف منفصل عن db.ts (نفس نمط translationEngine.ts) لسهولة المراجعة والصيانة
// ============================================================
import { eq, desc, and, count, like, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/mysql-core";
import { getDb } from "./db";
import { improvementIdeas, users, sites, sections, tickets, purchaseOrders } from "../drizzle/schema";

// ─── توليد رقم الطلب التالي (مثال: IMP-2026-00001) ────────────────────────
export async function getNextImprovementIdeaNumber() {
  const db = await getDb();
  if (!db) return "IMP-2026-00001";

  const year = new Date().getFullYear();
  const prefix = `IMP-${year}-`;

  const last = await db
    .select({ requestNumber: improvementIdeas.requestNumber })
    .from(improvementIdeas)
    .where(like(improvementIdeas.requestNumber, `${prefix}%`))
    .orderBy(desc(improvementIdeas.requestNumber))
    .limit(1);

  let nextNum = 1;
  if (last && last.length > 0) {
    const parts = last[0].requestNumber.split("-");
    const lastNumStr = parts[parts.length - 1];
    const lastNum = parseInt(lastNumStr || "0", 10);
    if (!isNaN(lastNum)) nextNum = lastNum + 1;
  }
  return `${prefix}${String(nextNum).padStart(5, "0")}`;
}

// ─── إنشاء فكرة جديدة ──────────────────────────────────────────────────
export async function createImprovementIdea(data: any) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.insert(improvementIdeas).values(data);
  return result[0].insertId;
}

type IdeaFilters = {
  status?: string;
  priority?: string;
  category?: string;
  groupCategory?: string;
  siteId?: number;
  sectionId?: number;
  submittedById?: number;
  search?: string;
};

function buildIdeaWhere(filters?: IdeaFilters) {
  const conditions: any[] = [];
  if (filters?.status) conditions.push(eq(improvementIdeas.status, filters.status as any));
  if (filters?.priority) conditions.push(eq(improvementIdeas.priority, filters.priority as any));
  if (filters?.category) conditions.push(eq(improvementIdeas.category, filters.category as any));
  if (filters?.groupCategory) conditions.push(eq(improvementIdeas.groupCategory, filters.groupCategory));
  if (filters?.siteId) conditions.push(eq(improvementIdeas.siteId, filters.siteId));
  if (filters?.sectionId) conditions.push(eq(improvementIdeas.sectionId, filters.sectionId));
  if (filters?.submittedById) conditions.push(eq(improvementIdeas.submittedById, filters.submittedById));
  if (filters?.search) conditions.push(or(
    like(improvementIdeas.title, `%${filters.search}%`),
    like(improvementIdeas.requestNumber, `%${filters.search}%`),
  ));
  return conditions.length > 0 ? and(...conditions) : undefined;
}

// ترتيب حسب الأولوية (حرجة ← منخفضة) ثم الأقدم أولاً — لاستخدامه بقوائم الفرز/التصنيف
const PRIORITY_ORDER_SQL = sql`CASE ${improvementIdeas.priority}
  WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 WHEN 'low' THEN 4 ELSE 5 END`;

// ─── قائمة مرقّمة بصفحات (تُستخدم لتبويب "الكل" ولقائمة "أفكاري" الشخصية) ──
export async function getImprovementIdeasPaginated(filters: IdeaFilters | undefined, page: number = 1, pageSize: number = 10) {
  const db = await getDb();
  if (!db) return { ideas: [] as any[], total: 0, page: 1, pageSize, totalPages: 1 };

  const where = buildIdeaWhere(filters);
  const [{ cnt }] = await db.select({ cnt: count() }).from(improvementIdeas).where(where);
  const total = Number(cnt) || 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const offset = (safePage - 1) * pageSize;

  const submitter = alias(users, "submitter");

  const rows = await db
    .select({
      idea: improvementIdeas,
      submitterName: submitter.name,
      siteName: sites.name,
      sectionName: sections.name,
    })
    .from(improvementIdeas)
    .leftJoin(submitter, eq(improvementIdeas.submittedById, submitter.id))
    .leftJoin(sites, eq(improvementIdeas.siteId, sites.id))
    .leftJoin(sections, eq(improvementIdeas.sectionId, sections.id))
    .where(where)
    .orderBy(desc(improvementIdeas.createdAt))
    .limit(pageSize)
    .offset(offset);

  return {
    ideas: rows.map(r => ({ ...r.idea, submitterName: r.submitterName ?? null, siteName: r.siteName ?? null, sectionName: r.sectionName ?? null })),
    total,
    page: safePage,
    pageSize,
    totalPages,
  };
}

// ─── عدّادات المجموعات للأفكار "المصنّفة" (بانتظار قرار الإدارة) — لعرض المجلدات ──
export async function getGroupedClassifiedCounts() {
  const db = await getDb();
  if (!db) return [] as { groupCategory: string; count: number }[];

  const rows = await db
    .select({ groupCategory: improvementIdeas.groupCategory, cnt: count() })
    .from(improvementIdeas)
    .where(eq(improvementIdeas.status, "classified"))
    .groupBy(improvementIdeas.groupCategory);

  return rows
    .filter(r => !!r.groupCategory)
    .map(r => ({ groupCategory: r.groupCategory as string, count: Number(r.cnt) || 0 }));
}

// ─── الأفكار المصنّفة ضمن مجموعة معيّنة، مرتبة حسب الأولوية ──────────────
export async function getClassifiedIdeasByGroup(groupCategory: string) {
  const db = await getDb();
  if (!db) return [] as any[];

  const submitter = alias(users, "submitter");

  const rows = await db
    .select({ idea: improvementIdeas, submitterName: submitter.name, siteName: sites.name })
    .from(improvementIdeas)
    .leftJoin(submitter, eq(improvementIdeas.submittedById, submitter.id))
    .leftJoin(sites, eq(improvementIdeas.siteId, sites.id))
    .where(and(eq(improvementIdeas.status, "classified"), eq(improvementIdeas.groupCategory, groupCategory)))
    .orderBy(PRIORITY_ORDER_SQL, desc(improvementIdeas.createdAt));

  return rows.map(r => ({ ...r.idea, submitterName: r.submitterName ?? null, siteName: r.siteName ?? null }));
}

// ─── الأفكار المعتمدة + قيد التنفيذ (تبويب "المقترحات المعتمدة" — تحويل وتتبّع) ──
export async function getApprovedIdeas() {
  const db = await getDb();
  if (!db) return [] as any[];

  const submitter = alias(users, "submitter");

  const rows = await db
    .select({
      idea: improvementIdeas,
      submitterName: submitter.name,
      linkedTicketNumber: tickets.ticketNumber,
      linkedTicketStatus: tickets.status,
      linkedPONumber: purchaseOrders.poNumber,
      linkedPOStatus: purchaseOrders.status,
    })
    .from(improvementIdeas)
    .leftJoin(submitter, eq(improvementIdeas.submittedById, submitter.id))
    .leftJoin(tickets, eq(improvementIdeas.linkedTicketId, tickets.id))
    .leftJoin(purchaseOrders, eq(improvementIdeas.linkedPurchaseOrderId, purchaseOrders.id))
    .where(or(eq(improvementIdeas.status, "approved"), eq(improvementIdeas.status, "in_progress")))
    .orderBy(PRIORITY_ORDER_SQL, desc(improvementIdeas.createdAt));

  return rows.map(r => ({
    ...r.idea,
    submitterName: r.submitterName ?? null,
    linkedTicketNumber: r.linkedTicketNumber ?? null,
    linkedTicketStatus: r.linkedTicketStatus ?? null,
    linkedPONumber: r.linkedPONumber ?? null,
    linkedPOStatus: r.linkedPOStatus ?? null,
  }));
}

// ─── فكرة واحدة بالتفصيل الكامل + الحالة الحيّة للبلاغ/طلب الشراء المرتبط ──
export async function getImprovementIdeaById(id: number) {
  const db = await getDb();
  if (!db) return null;

  const submitter = alias(users, "submitter");
  const triager = alias(users, "triager");
  const decider = alias(users, "decider");

  const rows = await db
    .select({
      idea: improvementIdeas,
      submitterName: submitter.name,
      triagerName: triager.name,
      deciderName: decider.name,
      siteName: sites.name,
      sectionName: sections.name,
      linkedTicketNumber: tickets.ticketNumber,
      linkedTicketStatus: tickets.status,
      linkedPONumber: purchaseOrders.poNumber,
      linkedPOStatus: purchaseOrders.status,
    })
    .from(improvementIdeas)
    .leftJoin(submitter, eq(improvementIdeas.submittedById, submitter.id))
    .leftJoin(triager, eq(improvementIdeas.triagedById, triager.id))
    .leftJoin(decider, eq(improvementIdeas.decidedById, decider.id))
    .leftJoin(sites, eq(improvementIdeas.siteId, sites.id))
    .leftJoin(sections, eq(improvementIdeas.sectionId, sections.id))
    .leftJoin(tickets, eq(improvementIdeas.linkedTicketId, tickets.id))
    .leftJoin(purchaseOrders, eq(improvementIdeas.linkedPurchaseOrderId, purchaseOrders.id))
    .where(eq(improvementIdeas.id, id))
    .limit(1);

  if (!rows.length) return null;
  const r = rows[0];
  return {
    ...r.idea,
    submitterName: r.submitterName ?? null,
    triagerName: r.triagerName ?? null,
    deciderName: r.deciderName ?? null,
    siteName: r.siteName ?? null,
    sectionName: r.sectionName ?? null,
    linkedTicketNumber: r.linkedTicketNumber ?? null,
    linkedTicketStatus: r.linkedTicketStatus ?? null,
    linkedPONumber: r.linkedPONumber ?? null,
    linkedPOStatus: r.linkedPOStatus ?? null,
  };
}

// ─── الفرز والتصنيف: "جديدة" ← "تم الفرز والتصنيف" ────────────────────
// يصحّح التصنيف، يحدد المجموعة/الملف، ويحدد الأولوية — كل ذلك بإجراء واحد
type ClassifyInput = {
  classifiedById: number;
  category: string;
  groupCategory: string;
  priority: string;
};

export async function classifyImprovementIdea(id: number, input: ClassifyInput) {
  const db = await getDb();
  if (!db) return;
  await db.update(improvementIdeas).set({
    status: "classified",
    category: input.category as any,
    groupCategory: input.groupCategory,
    priority: input.priority as any,
    triagedById: input.classifiedById,
    triagedAt: new Date(),
  }).where(eq(improvementIdeas.id, id));
}

// ─── قرار الإدارة العليا: موافقة / تأجيل (+تاريخ) / إلغاء (+سبب) ──────────
type DecisionInput = {
  decision: "approved" | "postponed" | "cancelled";
  decidedById: number;
  decisionNotes?: string;
  postponedUntil?: Date;
  cancelReason?: string;
};

export async function decideImprovementIdea(id: number, input: DecisionInput) {
  const db = await getDb();
  if (!db) return;

  const updateData: any = {
    status: input.decision,
    decidedById: input.decidedById,
    decidedAt: new Date(),
    decisionNotes: input.decisionNotes,
  };
  if (input.decision === "postponed") updateData.postponedUntil = input.postponedUntil;
  if (input.decision === "cancelled") updateData.cancelReason = input.cancelReason;

  await db.update(improvementIdeas).set(updateData).where(eq(improvementIdeas.id, id));
}

// ─── تحويل الفكرة المعتمدة إلى تذكرة/طلب شراء (تربط فقط — الإنشاء يتم بالنوافذ الأصلية) ──
export async function linkIdeaToTicket(id: number, ticketId: number) {
  const db = await getDb();
  if (!db) return;
  await db.update(improvementIdeas).set({ linkedTicketId: ticketId, status: "in_progress" }).where(eq(improvementIdeas.id, id));
}

export async function linkIdeaToPurchaseOrder(id: number, purchaseOrderId: number) {
  const db = await getDb();
  if (!db) return;
  await db.update(improvementIdeas).set({ linkedPurchaseOrderId: purchaseOrderId, status: "in_progress" }).where(eq(improvementIdeas.id, id));
}

// ─── إكمال التنفيذ: "قيد التنفيذ" ← "مكتملة" (تأكيد يدوي، متاح بأي وقت) ──
export async function completeImprovementIdea(id: number, completionNotes?: string) {
  const db = await getDb();
  if (!db) return;
  await db.update(improvementIdeas).set({
    status: "completed",
    completedAt: new Date(),
    completionNotes,
  }).where(eq(improvementIdeas.id, id));
}

// ─── حذف فكرة (لمقدّمها فقط وبحالة "جديدة"، أو admin/owner — يُحدَّد بالراوتر) ──
export async function deleteImprovementIdea(id: number) {
  const db = await getDb();
  if (!db) return;
  await db.delete(improvementIdeas).where(eq(improvementIdeas.id, id));
}

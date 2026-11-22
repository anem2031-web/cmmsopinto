import { sql, type SQL } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { router } from "../_shared/procedures";
import { pmv2ManagementProcedure } from "../../pmv2/security/procedures";
import { canManagePmv2Foundation } from "../../pmv2/security/policy";
import { isPmv2SimplifiedEnabled } from "../../pmv2/simplified/feature";
import { SimplifiedSetupService, type SetupActor } from "../../pmv2/simplified/setup-service";
import { SimplifiedSqlRepository } from "../../pmv2/simplified/setup-repository";
import { getRiyadhDateOnly } from "../../pmv2/scheduler/utils";

type Db = { execute(query: SQL): Promise<unknown>; transaction<T>(work: (tx: any) => Promise<T>): Promise<T> };
type Deps = { enabled: () => boolean; db: () => Promise<Db>; service: SimplifiedSetupService };
function resultRows(result: unknown): any[] {
  if (!Array.isArray(result) || !Array.isArray(result[0])) throw new Error("تعذر قراءة بيانات المهام المجدولة");
  return result[0];
}
function auth(ctx: any): SetupActor {
  const user = ctx.authenticatedUser ?? ctx.user;
  if (!user || user.isActive !== 1 || !canManagePmv2Foundation(user.role)) throw new TRPCError({ code: "FORBIDDEN", message: "ليس لديك صلاحية إدارة الصيانة المجدولة" });
  return { id: Number(user.id), role: user.role, isActive: user.isActive };
}
async function liveDb(deps: Deps, actor: SetupActor): Promise<Db> {
  if (!deps.enabled()) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "إعداد المهام المبسط غير مفعل" });
  const db = await deps.db();
  const active = resultRows(await db.execute(sql`SELECT id FROM users WHERE id=${actor.id} AND role=${actor.role} AND isActive=1 LIMIT 1`));
  if (!active.length) throw new TRPCError({ code: "FORBIDDEN", message: "ليس لديك صلاحية إدارة الصيانة المجدولة" });
  return db;
}
function taskRecurrence(row: any) {
  const kind = String(row.kind), startDate = String(row.anchorDate ?? "");
  if (kind === "daily") return { kind, startDate };
  if (kind === "weekly") return { kind, startDate, weekday: Number(row.weekday) };
  if (kind === "monthly") return { kind, startDate, monthDay: Number(row.monthDay) };
  const unit = row.frequency === "daily" ? "day" : row.frequency === "weekly" ? "week" : "month";
  return { kind: "custom", startDate, unit, interval: Number(row.frequencyValue ?? 1) };
}
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const recurrence = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("daily"), startDate: date }).strict(),
  z.object({ kind: z.literal("weekly"), startDate: date, weekday: z.number().int().min(0).max(6) }).strict(),
  z.object({ kind: z.literal("monthly"), startDate: date, monthDay: z.number().int().min(1).max(31) }).strict(),
  z.object({ kind: z.literal("custom"), startDate: date, interval: z.number().int().min(1).max(3650), unit: z.enum(["day","week","month"]) }).strict(),
]);

export function createPmv2SimplifiedRouter(deps: Deps) {
  const enabled = () => { if (!deps.enabled()) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "إعداد المهام المبسط غير مفعل" }); };
  const mutationError = () => new TRPCError({ code: "BAD_REQUEST", message: "تعذر حفظ المهمة. تحقق من البيانات وحالة الفريق ثم حاول مجددًا" });
  return router({
    status: pmv2ManagementProcedure.query(async ({ ctx }) => {
      const actor=auth(ctx);
      if (!deps.enabled()) return { enabled: false, legacyExists: false };
      const db=await liveDb(deps,actor);
      const found=resultRows(await db.execute(sql`SELECT (
        EXISTS(SELECT 1 FROM pmv2_programs p WHERE NOT EXISTS (SELECT 1 FROM pmv2_simplified_plans s WHERE s.programId=p.id))
        OR EXISTS(SELECT 1 FROM pmv2_teams t WHERE NOT EXISTS (SELECT 1 FROM pmv2_unified_team_links l WHERE l.pmv2TeamId=t.id))
        OR EXISTS(SELECT 1 FROM pmv2_specialties sp WHERE NOT EXISTS (SELECT 1 FROM pmv2_teams t INNER JOIN pmv2_unified_team_links l ON l.pmv2TeamId=t.id WHERE t.specialtyId=sp.id))
        OR EXISTS(SELECT 1 FROM pmv2_checklists c WHERE NOT EXISTS (SELECT 1 FROM pmv2_programs p INNER JOIN pmv2_simplified_plans s ON s.programId=p.id WHERE p.checklistId=c.id))
      ) AS legacyExists`));
      return { enabled: true, legacyExists: Number(found[0]?.legacyExists ?? 0) === 1 };
    }),
    teams: pmv2ManagementProcedure.query(async ({ ctx }) => {
      const db = await liveDb(deps, auth(ctx));
      return resultRows(await db.execute(sql`SELECT t.id,t.name FROM maintenance_teams t INNER JOIN warehouses w ON w.id=t.warehouseId
        WHERE t.isActive=1 AND w.type='branch' AND w.isActive=1 AND EXISTS (
          SELECT 1 FROM maintenance_team_members m INNER JOIN users u ON u.id=m.userId
          WHERE m.teamId=t.id AND m.isActive=1 AND u.isActive=1 AND u.role IN ('technician','it_manager','it_member')
        ) ORDER BY t.name,t.id`)).map(row => ({ id: Number(row.id), name: String(row.name) }));
    }),
    list: pmv2ManagementProcedure.input(z.object({ beforeId: z.number().int().positive().optional() }).optional()).query(async ({ ctx, input }) => {
      const db = await liveDb(deps, auth(ctx));
      const before = input?.beforeId ? sql`AND s.programId < ${input.beforeId}` : sql``;
      const data = resultRows(await db.execute(sql`SELECT s.programId AS id,p.title,s.state,si.name AS siteName,se.name AS sectionName,t.name AS teamName
        FROM pmv2_simplified_plans s INNER JOIN pmv2_programs p ON p.id=s.programId
        INNER JOIN pmv2_unified_team_links l ON l.pmv2TeamId=p.teamId INNER JOIN maintenance_teams t ON t.id=l.maintenanceTeamId
        LEFT JOIN sites si ON si.id=s.siteId LEFT JOIN sections se ON se.id=s.sectionId WHERE 1=1 ${before}
        ORDER BY s.programId DESC LIMIT 51`));
      const page = data.slice(0,50).map(row => ({ id: Number(row.id), title: String(row.title ?? ""), state: String(row.state), siteName: row.siteName, sectionName: row.sectionName, teamName: row.teamName }));
      return { items: page, nextId: data.length > 50 ? page[page.length - 1].id : null };
    }),
    get: pmv2ManagementProcedure.input(z.object({ id: z.number().int().positive() })).query(async ({ ctx, input }) => {
      const db = await liveDb(deps, auth(ctx));
      const plans = resultRows(await db.execute(sql`SELECT s.programId AS id,p.title,s.state,s.siteId,s.sectionId,l.maintenanceTeamId AS teamId,p.checklistId
        FROM pmv2_simplified_plans s INNER JOIN pmv2_programs p ON p.id=s.programId
        INNER JOIN pmv2_unified_team_links l ON l.pmv2TeamId=p.teamId WHERE s.programId=${input.id} LIMIT 1`));
      if (!plans[0]) throw new TRPCError({ code: "NOT_FOUND", message: "المهمة الرئيسية غير موجودة" });
      const plan = plans[0];
      const items = resultRows(await db.execute(sql`SELECT i.id,i.title,m.kind,i.frequency,i.frequencyValue,i.weekday,i.monthDay,DATE_FORMAT(i.anchorDate,'%Y-%m-%d') AS anchorDate
        FROM pmv2_checklist_items i INNER JOIN pmv2_simplified_item_modes m ON m.checklistItemId=i.id
        WHERE i.checklistId=${Number(plan.checklistId)} AND i.isActive=1 ORDER BY i.sortOrder,i.id`));
      const ids = items.map(row => Number(row.id));
      const translations: any[] = [];
      for (let offset = 0; offset < ids.length; offset += 500) {
        const chunk = ids.slice(offset, offset + 500);
        translations.push(...resultRows(await db.execute(sql`SELECT entityId,languageCode,translatedText FROM entity_translations
          WHERE entityType='PMV2_CHECKLIST_ITEM' AND fieldName='title' AND languageCode IN ('en','ur')
          AND translationStatus IN ('approved','completed') AND entityId IN (${sql.join(chunk.map(id => sql`${id}`), sql`, `)}) ORDER BY id DESC`)));
      }
      const byItem = new Map<string,string>();
      for (const row of translations) { const key = `${Number(row.entityId)}:${row.languageCode}`; if (!byItem.has(key)) byItem.set(key, String(row.translatedText ?? "")); }
      return { id: Number(plan.id), title: String(plan.title ?? ""), state: plan.state as "draft" | "active" | "paused", siteId: Number(plan.siteId), sectionId: Number(plan.sectionId), teamId: Number(plan.teamId), items: items.map(row => ({ titleAr: String(row.title), titleEn: byItem.get(`${row.id}:en`) ?? "", titleUr: byItem.get(`${row.id}:ur`) ?? "", recurrence: taskRecurrence(row) })) };
    }),
    create: pmv2ManagementProcedure.input(z.object({ title: z.string().trim().min(1).max(200), siteId: z.number().int().positive(), sectionId: z.number().int().positive(), teamId: z.number().int().positive() }).strict()).mutation(async ({ ctx, input }) => {
      const actor=auth(ctx); enabled(); try { return await deps.service.create(actor,input); } catch { throw mutationError(); }
    }),
    addItem: pmv2ManagementProcedure
      .input(z.object({
        planId: z.number().int().positive(),
        titleAr: z.string().trim().min(1).max(300),
        titleEn: z.string().trim().min(1, "أدخل عنوان المهمة بالإنجليزية").max(300),
        titleUr: z.string().trim().min(1, "أدخل عنوان المهمة بالأوردو").max(300),
        recurrence,
      }).strict())
      .mutation(async ({ ctx, input }) => {
        const actor = auth(ctx);
        enabled();
        const { planId, ...item } = input;
        try {
          return await deps.service.addItem(actor, planId, item);
        } catch {
          throw mutationError();
        }
      }),
    activate: pmv2ManagementProcedure.input(z.object({ planId:z.number().int().positive() }).strict()).mutation(async ({ ctx,input }) => { const actor=auth(ctx);enabled();try{return await deps.service.activate(actor,input.planId)}catch{throw mutationError()} }),
    pause: pmv2ManagementProcedure.input(z.object({ planId:z.number().int().positive() }).strict()).mutation(async ({ ctx,input }) => { const actor=auth(ctx);enabled();try{return await deps.service.pause(actor,input.planId)}catch{throw mutationError()} }),
    resume: pmv2ManagementProcedure.input(z.object({ planId:z.number().int().positive() }).strict()).mutation(async ({ ctx,input }) => { const actor=auth(ctx);enabled();try{return await deps.service.resume(actor,input.planId)}catch{throw mutationError()} }),
  });
}

async function database(): Promise<Db> {
  const { getDb } = await import("../../_core/db/client"); const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "قاعدة البيانات غير متاحة" });
  return db as unknown as Db;
}
export const pmv2SimplifiedRouter = createPmv2SimplifiedRouter({ enabled: isPmv2SimplifiedEnabled, db: database, service: new SimplifiedSetupService(new SimplifiedSqlRepository(database), getRiyadhDateOnly) });

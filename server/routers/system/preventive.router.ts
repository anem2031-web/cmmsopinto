import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { router, protectedProcedure, managerProcedure } from "../_shared/procedures";
import * as db from "../../db";
import { invokeLLM } from "../../_core/llm";
import { translateFields, detectLanguage, type SupportedLanguage } from "../../services/translation";

export const preventiveRouter = router({
  listPlans: protectedProcedure.input(z.object({
    assetId: z.number().optional(),
    siteId: z.number().optional(),
    isActive: z.boolean().optional(),
  }).optional()).query(async ({ input }) => {
    return db.listPreventivePlans(input ?? {});
  }),

  getPlanById: protectedProcedure.input(z.object({ id: z.number() })).query(async ({ input }) => {
    const plan = await db.getPreventivePlanById(input.id);
    if (!plan) throw new TRPCError({ code: "NOT_FOUND", message: "الخطة غير موجودة" });
    return plan;
  }),

  createPlan: managerProcedure.input(z.object({
    title: z.string().min(1),
    description: z.string().optional(),
    assetId: z.number().optional(),
    siteId: z.number().optional(),
    frequency: z.enum(["daily", "weekly", "monthly", "quarterly", "biannual", "annual"]),
    frequencyValue: z.number().default(1),
    estimatedDurationMinutes: z.number().optional(),
    assignedToId: z.number().optional(),
    checklist: z.array(z.object({ id: z.string(), text: z.string(), required: z.boolean().optional() })).optional(),
    nextDueDate: z.string().optional(),
  })).mutation(async ({ input, ctx }) => {
    const planNumber = await db.generatePlanNumber();
    const nextDue = input.nextDueDate ? new Date(input.nextDueDate) : db.calcNextDueDate(new Date(), input.frequency, input.frequencyValue);
    const result = await db.createPreventivePlan({
      ...input,
      planNumber,
      checklist: input.checklist ?? [],
      nextDueDate: nextDue,
      createdById: ctx.user.id,
    });
    return result;
  }),

  updatePlan: managerProcedure.input(z.object({
    id: z.number(),
    title: z.string().optional(),
    description: z.string().optional(),
    assetId: z.number().optional(),
    siteId: z.number().optional(),
    frequency: z.enum(["daily", "weekly", "monthly", "quarterly", "biannual", "annual"]).optional(),
    frequencyValue: z.number().optional(),
    estimatedDurationMinutes: z.number().optional(),
    assignedToId: z.number().optional(),
    checklist: z.array(z.object({ id: z.string(), text: z.string(), required: z.boolean().optional() })).optional(),
    isActive: z.boolean().optional(),
    nextDueDate: z.string().optional(),
  })).mutation(async ({ input }) => {
    const { id, ...data } = input;
    return db.updatePreventivePlan(id, {
      ...data,
      nextDueDate: data.nextDueDate ? new Date(data.nextDueDate) : undefined,
    });
  }),

  deletePlan: managerProcedure.input(z.object({ id: z.number() })).mutation(async ({ input }) => {
    return db.deletePreventivePlan(input.id);
  }),

  // Work Orders
  listWorkOrders: protectedProcedure.input(z.object({
    planId: z.number().optional(),
    assetId: z.number().optional(),
    status: z.string().optional(),
    assignedToId: z.number().optional(),
  }).optional()).query(async ({ input }) => {
    return db.listPMWorkOrders(input ?? {});
  }),

  getWorkOrderById: protectedProcedure.input(z.object({ id: z.number() })).query(async ({ input }) => {
    const wo = await db.getPMWorkOrderById(input.id);
    if (!wo) throw new TRPCError({ code: "NOT_FOUND", message: "أمر العمل غير موجود" });
    return wo;
  }),

  generateWorkOrder: managerProcedure.input(z.object({
    planId: z.number(),
    scheduledDate: z.string(),
  })).mutation(async ({ input }) => {
    const plan = await db.getPreventivePlanById(input.planId);
    if (!plan) throw new TRPCError({ code: "NOT_FOUND", message: "الخطة غير موجودة" });
    const woNumber = await db.generateWorkOrderNumber();
    const result = await db.createPMWorkOrder({
      workOrderNumber: woNumber,
      planId: input.planId,
      assetId: plan.assetId ?? undefined,
      siteId: plan.siteId ?? undefined,
      title: plan.title,
      scheduledDate: new Date(input.scheduledDate),
      status: "scheduled",
      assignedToId: plan.assignedToId ?? undefined,
      checklistResults: plan.checklist,
    });
    // Update plan's lastGeneratedAt and nextDueDate
    const nextDue = db.calcNextDueDate(new Date(input.scheduledDate), plan.frequency, plan.frequencyValue ?? 1);
    await db.updatePreventivePlan(input.planId, { lastGeneratedAt: new Date(), nextDueDate: nextDue });
    // ─── إشعار push للفني المعيّن ───
    if (plan.assignedToId) {
      try {
        const { sendPushToUser } = await import("./webPush");
        const scheduledDateStr = new Date(input.scheduledDate).toLocaleDateString("ar-SA");
        await sendPushToUser(plan.assignedToId, {
          title: "تكليف جديد: صيانة وقائية 🔧",
          body: `مهمة: ${plan.title}\nرقم الأمر: ${woNumber}\nالتاريخ: ${scheduledDateStr}`,
          tag: `pm-wo-${result.id}`,
        });
      } catch (e) {
        console.error("[generateWorkOrder] Push notification failed:", e);
      }
    }
    return result;
  }),

  updateWorkOrder: protectedProcedure.input(z.object({
    id: z.number(),
    status: z.enum(["scheduled", "in_progress", "completed", "overdue", "cancelled"]).optional(),
    // Accept null (from DB) and normalize to [] to prevent validation errors
    checklistResults: z.array(z.object({ id: z.string(), text: z.string(), done: z.boolean(), notes: z.string().optional() })).nullish().transform(v => v ?? []),
    technicianNotes: z.string().nullish().transform(v => v ?? undefined),
    completionPhotoUrl: z.string().nullish().transform(v => v ?? undefined),
    completedDate: z.string().nullish().transform(v => v ?? undefined),
  })).mutation(async ({ input }) => {
    const { id, ...data } = input;
    // Auto-translate technicianNotes to all 3 languages
    let woTranslation: Record<string, any> = {};
    if (data.technicianNotes && data.technicianNotes.trim().length > 0) {
      try {
        const detectedLang = await detectLanguage(data.technicianNotes) as SupportedLanguage;
        const translations = await translateFields({ technicianNotes: data.technicianNotes }, detectedLang);
        if (translations.technicianNotes) {
          woTranslation.technicianNotes_ar = translations.technicianNotes.ar;
          woTranslation.technicianNotes_en = translations.technicianNotes.en;
          woTranslation.technicianNotes_ur = translations.technicianNotes.ur;
        }
      } catch (e) {
        console.error("[WorkOrder] technicianNotes translation failed:", e);
      }
    }
    return db.updatePMWorkOrder(id, {
      ...data,
      ...woTranslation,
      completedDate: data.completedDate ? new Date(data.completedDate) : undefined,
    });
  }),

  // ─── AI Predictive Analysis ──────────────────────────────────────────
  // Analyze a fault image and return diagnosis + recommendations
  analyzeFaultImage: protectedProcedure.input(z.object({
    imageUrl: z.string().url(),
    assetName: z.string().optional(),
    assetCategory: z.string().optional(),
    description: z.string().optional(),
  })).mutation(async ({ input }) => {
    const systemPrompt = `أنت خبير هندسي متخصص في تشخيص أعطال المعدات والأصول. 
عند تحليل صورة العطل، قدم:
1. تشخيص العطل المحتمل
2. مستوى الخطورة (منخفض/متوسط/عالٍ/حرج)
3. الأسباب المحتملة
4. الإجراءات التصحيحية الموصى بها
5. هل يحتاج إلى إيقاف تشغيل فوري؟
أجب بصيغة JSON منظمة.`;

    const userMessage = `الأصل: ${input.assetName ?? "غير محدد"} | الفئة: ${input.assetCategory ?? "غير محدد"}\nالوصف: ${input.description ?? "لا يوجد وصف"}\nرابط الصورة: ${input.imageUrl}\n\nحلل صورة العطل وقدم تشخيصاً مفصلاً.`;
    const result = await invokeLLM({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "fault_analysis",
          strict: true,
          schema: {
            type: "object",
            properties: {
              diagnosis: { type: "string", description: "تشخيص العطل" },
              severity: { type: "string", enum: ["low", "medium", "high", "critical"], description: "مستوى الخطورة" },
              causes: { type: "array", items: { type: "string" }, description: "الأسباب المحتملة" },
              recommendations: { type: "array", items: { type: "string" }, description: "الإجراءات الموصى بها" },
              requiresImmediateShutdown: { type: "boolean", description: "هل يحتاج إيقاف تشغيل فوري" },
              estimatedRepairTime: { type: "string", description: "الوقت التقديري للإصلاح" },
              confidence: { type: "number", description: "مستوى الثقة 0-100" },
            },
            required: ["diagnosis", "severity", "causes", "recommendations", "requiresImmediateShutdown", "estimatedRepairTime", "confidence"],
            additionalProperties: false,
          },
        },
      },
    });

    const content = result.choices?.[0]?.message?.content;
    if (!content) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "فشل تحليل الصورة" });
    return JSON.parse(content as string);
  }),

  // Predict assets at risk based on maintenance history
  predictAtRiskAssets: protectedProcedure.mutation(async () => {
    const assets = await db.listAssets({});
    const tickets = await db.getTickets();

    if (assets.length === 0) {
      return { atRiskAssets: [], summary: "لا توجد أصول مسجلة بعد" };
    }

    // Build asset maintenance history summary
    const assetSummaries = assets.slice(0, 20).map((asset: any) => {
      const assetTickets = tickets.filter((t: any) => t.assetId === asset.id);
      const recentTickets = assetTickets.filter((t: any) => {
        const days = (Date.now() - new Date(t.createdAt).getTime()) / (1000 * 60 * 60 * 24);
        return days <= 90;
      });
      return {
        id: asset.id,
        name: asset.name,
        category: asset.category,
        status: asset.status,
        warrantyExpiry: asset.warrantyExpiry,
        totalTickets: assetTickets.length,
        recentTickets: recentTickets.length,
        lastTicketDate: assetTickets.length > 0 ? assetTickets[assetTickets.length - 1].createdAt : null,
      };
    });

    const result = await invokeLLM({
      messages: [
        { role: "system", content: "أنت محلل بيانات صيانة متخصص. بناءً على بيانات الأصول وتاريخ الأعطال، حدد الأصول الأكثر عرضة للأعطال وقدم توصيات وقائية." },
        { role: "user", content: `بيانات الأصول:\n${JSON.stringify(assetSummaries, null, 2)}\n\nحدد الأصول الأكثر خطورة وقدم توصيات.` as string },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "risk_prediction",
          strict: true,
          schema: {
            type: "object",
            properties: {
              atRiskAssets: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    assetId: { type: "number" },
                    assetName: { type: "string" },
                    riskLevel: { type: "string", enum: ["low", "medium", "high", "critical"] },
                    reason: { type: "string" },
                    recommendation: { type: "string" },
                  },
                  required: ["assetId", "assetName", "riskLevel", "reason", "recommendation"],
                  additionalProperties: false,
                },
              },
              summary: { type: "string", description: "ملخص التحليل" },
            },
            required: ["atRiskAssets", "summary"],
            additionalProperties: false,
          },
        },
      },
    });

    const content = result.choices?.[0]?.message?.content;
    if (!content) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "فشل التحليل" });
    return JSON.parse(content as string);
  }),
  // ─── Checklist Items (New Structured System) ──────────────────────────
  addChecklistItem: managerProcedure.input(z.object({
    planId: z.number(),
    text: z.string().min(1),
    orderIndex: z.number().optional(),
    isRequired: z.boolean().default(true),
  })).mutation(async ({ input }) => {
    const ddb = await db.getDb();
    if (!ddb) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "خطأ في قاعدة البيانات" });
    const { pmChecklistItems } = await import("../drizzle/schema");
    const result = await ddb.insert(pmChecklistItems).values({
      planId: input.planId,
      text: input.text,
      orderIndex: input.orderIndex ?? 0,
      isRequired: input.isRequired,
    });
    return { id: Number(result[0].insertId), ...input };
  }),

  updateChecklistItem: managerProcedure.input(z.object({
    id: z.number(),
    text: z.string().optional(),
    orderIndex: z.number().optional(),
    isRequired: z.boolean().optional(),
  })).mutation(async ({ input }) => {
    const ddb = await db.getDb();
    if (!ddb) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "خطأ في قاعدة البيانات" });
    const { pmChecklistItems } = await import("../drizzle/schema");
    const { id, ...data } = input;
    await ddb.update(pmChecklistItems).set(data).where(eq(pmChecklistItems.id, id));
    return { success: true };
  }),

  deleteChecklistItem: managerProcedure.input(z.object({ id: z.number() })).mutation(async ({ input }) => {
    const ddb = await db.getDb();
    if (!ddb) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "خطأ في قاعدة البيانات" });
    const { pmChecklistItems } = await import("../drizzle/schema");
    await ddb.delete(pmChecklistItems).where(eq(pmChecklistItems.id, input.id));
    return { success: true };
  }),

  getChecklistItems: protectedProcedure.input(z.object({ planId: z.number() })).query(async ({ input }) => {
    const ddb = await db.getDb();
    if (!ddb) return [];
    const { pmChecklistItems } = await import("../drizzle/schema");
    return ddb.select().from(pmChecklistItems)
      .where(eq(pmChecklistItems.planId, input.planId))
      .orderBy(asc(pmChecklistItems.orderIndex));
  }),

  reorderChecklistItems: managerProcedure.input(z.object({
    items: z.array(z.object({ id: z.number(), orderIndex: z.number() })),
  })).mutation(async ({ input }) => {
    const ddb = await db.getDb();
    if (!ddb) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "خطأ في قاعدة البيانات" });
    const { pmChecklistItems } = await import("../drizzle/schema");
    for (const item of input.items) {
      await ddb.update(pmChecklistItems).set({ orderIndex: item.orderIndex }).where(eq(pmChecklistItems.id, item.id));
    }
    return { success: true };
  }),

  // ─── Execution Session ────────────────────────────────────────────────
  startExecution: protectedProcedure.input(z.object({
    workOrderId: z.number(),
  })).mutation(async ({ input, ctx }) => {
    const ddb = await db.getDb();
    if (!ddb) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "خطأ في قاعدة البيانات" });
    const { pmExecutionSessions, pmWorkOrders, pmChecklistItems } = await import("../drizzle/schema");
    // Get work order
    const wo = await db.getPMWorkOrderById(input.workOrderId);
    if (!wo) throw new TRPCError({ code: "NOT_FOUND", message: "أمر العمل غير موجود" });
    // Get checklist items from the plan
    const items = await ddb.select().from(pmChecklistItems)
      .where(eq(pmChecklistItems.planId, wo.planId))
      .orderBy();
    // Check if session already exists
    const existing = await ddb.select().from(pmExecutionSessions)
      .where(eq(pmExecutionSessions.workOrderId, input.workOrderId));
    if (existing.length > 0) {
      return { session: existing[0], items, workOrder: wo };
    }
    // Create new session
    const result = await ddb.insert(pmExecutionSessions).values({
      workOrderId: input.workOrderId,
      technicianId: ctx.user.id,
      totalItems: items.length,
    });
    // Update work order status to in_progress
    await ddb.update(pmWorkOrders).set({ status: "in_progress" }).where(eq(pmWorkOrders.id, input.workOrderId));
    const session = await ddb.select().from(pmExecutionSessions)
      .where(eq(pmExecutionSessions.workOrderId, input.workOrderId));
    return { session: session[0], items, workOrder: wo };
  }),

  submitItemResult: protectedProcedure.input(z.object({
    workOrderId: z.number(),
    checklistItemId: z.number(),
    status: z.enum(["ok", "fixed", "issue"]),
    fixNotes: z.string().optional(),
    photoUrl: z.string().optional(),
  })).mutation(async ({ input, ctx }) => {
    const ddb = await db.getDb();
    if (!ddb) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "خطأ في قاعدة البيانات" });
    const { pmExecutionResults, pmExecutionSessions } = await import("../drizzle/schema");
    const { eq, and } = await import("drizzle-orm");
    // Upsert result
    const existing = await ddb.select().from(pmExecutionResults)
      .where(and(
        eq(pmExecutionResults.workOrderId, input.workOrderId),
        eq(pmExecutionResults.checklistItemId, input.checklistItemId)
      ));
    if (existing.length > 0) {
      await ddb.update(pmExecutionResults)
        .set({ status: input.status, fixNotes: input.fixNotes, photoUrl: input.photoUrl })
        .where(eq(pmExecutionResults.id, existing[0].id));
    } else {
      await ddb.insert(pmExecutionResults).values({
        workOrderId: input.workOrderId,
        checklistItemId: input.checklistItemId,
        status: input.status,
        fixNotes: input.fixNotes,
        photoUrl: input.photoUrl,
      });
    }
    // Update session counts
    const allResults = await ddb.select().from(pmExecutionResults)
      .where(eq(pmExecutionResults.workOrderId, input.workOrderId));
    const okCount = allResults.filter((r: any) => r.status === "ok").length;
    const fixedCount = allResults.filter((r: any) => r.status === "fixed").length;
    const issueCount = allResults.filter((r: any) => r.status === "issue").length;
    await ddb.update(pmExecutionSessions)
      .set({ okCount, fixedCount, issueCount })
      .where(eq(pmExecutionSessions.workOrderId, input.workOrderId));
    return { success: true, completedCount: allResults.length };
  }),

  getExecutionProgress: protectedProcedure.input(z.object({ workOrderId: z.number() })).query(async ({ input }) => {
    const ddb = await db.getDb();
    if (!ddb) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "خطأ في قاعدة البيانات" });
    const { pmExecutionResults, pmExecutionSessions, pmChecklistItems, pmWorkOrders } = await import("../drizzle/schema");
    const { eq } = await import("drizzle-orm");
    const wo = await db.getPMWorkOrderById(input.workOrderId);
    if (!wo) throw new TRPCError({ code: "NOT_FOUND", message: "أمر العمل غير موجود" });
    const items = await ddb.select().from(pmChecklistItems)
      .where(eq(pmChecklistItems.planId, wo.planId))
      .orderBy();
    const results = await ddb.select().from(pmExecutionResults)
      .where(eq(pmExecutionResults.workOrderId, input.workOrderId));
    const sessions = await ddb.select().from(pmExecutionSessions)
      .where(eq(pmExecutionSessions.workOrderId, input.workOrderId));
    return {
      workOrder: wo,
      items,
      results,
      session: sessions[0] ?? null,
      totalItems: items.length,
      completedItems: results.length,
    };
  }),

  completeExecution: protectedProcedure.input(z.object({
    workOrderId: z.number(),
    generalNotes: z.string().optional(),
  })).mutation(async ({ input, ctx }) => {
    const ddb = await db.getDb();
    if (!ddb) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "خطأ في قاعدة البيانات" });
    const { pmExecutionSessions, pmWorkOrders, pmExecutionResults } = await import("../drizzle/schema");
    const { eq } = await import("drizzle-orm");
    const now = new Date();
    // Get session
    const sessions = await ddb.select().from(pmExecutionSessions)
      .where(eq(pmExecutionSessions.workOrderId, input.workOrderId));
    if (sessions.length > 0) {
      const startedAt = new Date(sessions[0].startedAt);
      const durationSeconds = Math.floor((now.getTime() - startedAt.getTime()) / 1000);
      await ddb.update(pmExecutionSessions).set({
        status: "completed",
        completedAt: now,
        durationSeconds,
        generalNotes: input.generalNotes,
      }).where(eq(pmExecutionSessions.workOrderId, input.workOrderId));
    }
    // Get results for notification
    const results = await ddb.select().from(pmExecutionResults)
      .where(eq(pmExecutionResults.workOrderId, input.workOrderId));
    const issueCount = results.filter((r: any) => r.status === "issue").length;
    const fixedCount = results.filter((r: any) => r.status === "fixed").length;
    const okCount = results.filter((r: any) => r.status === "ok").length;
    // Update work order to completed
    await ddb.update(pmWorkOrders).set({
      status: "completed",
      completedDate: now,
      technicianNotes: input.generalNotes,
    }).where(eq(pmWorkOrders.id, input.workOrderId));
    // Send notification to manager
    const wo = await db.getPMWorkOrderById(input.workOrderId);
    const techUser = await db.getUserById(ctx.user.id);
    const techName = techUser?.name ?? ctx.user.name ?? "الفني";
    let notifTitle = "";
    let notifContent = "";
    if (issueCount > 0) {
      notifTitle = `⚠️ تنبيه: تم اكتشاف ${issueCount} خلل في الفحص الدوري`;
      notifContent = `الفني ${techName} أنهى الفحص الدوري لـ "${wo?.title ?? ''}" - اكتشف ${issueCount} خلل، أصلح ${fixedCount} بند، سليم ${okCount} بند.`;
    } else if (fixedCount > 0) {
      notifTitle = `🔧 تم إصلاح فوري أثناء الفحص الدوري`;
      notifContent = `الفني ${techName} أنهى الفحص الدوري لـ "${wo?.title ?? ''}" - أصلح ${fixedCount} بند، جميع البنود الأخرى سليمة.`;
    } else {
      notifTitle = `✅ اكتمل الفحص الدوري - جميع البنود سليمة`;
      notifContent = `الفني ${techName} أنهى الفحص الدوري لـ "${wo?.title ?? ''}" - جميع ${okCount} بند سليمة.`;
    }
    await notifyOwner({ title: notifTitle, content: notifContent });
    // Send colored in-app notifications to all managers
    const managerUsers = await db.getManagerUsers();
    const notifType = issueCount > 0 ? "critical" : fixedCount > 0 ? "warning" : "success";
    for (const manager of managerUsers) {
      await db.createNotification({
        userId: manager.id,
        title: notifTitle,
        message: notifContent,
        type: notifType,
        relatedTicketId: undefined,
        relatedPOId: undefined,
      });
    }
    return { success: true, issueCount, fixedCount, okCount };
  }),

  createIssueTicket: protectedProcedure.input(z.object({
    workOrderId: z.number(),
    checklistItemId: z.number(),
    assetId: z.number().optional(),
    siteId: z.number().optional(),
    description: z.string(),
  })).mutation(async ({ input, ctx }) => {
    const ddb = await db.getDb();
    if (!ddb) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "خطأ في قاعدة البيانات" });
    const { pmExecutionResults, pmWorkOrders } = await import("../drizzle/schema");
    const { eq, and } = await import("drizzle-orm");
    // Get work order info
    const wo = await db.getPMWorkOrderById(input.workOrderId);
    if (!wo) throw new TRPCError({ code: "NOT_FOUND", message: "أمر العمل غير موجود" });
    // Create ticket
    const ticketNumber = await db.getNextTicketNumber();
    const ticketId = await db.createTicket({
      ticketNumber,
      title: `خلل مكتشف أثناء الفحص الدوري: ${wo.title}`,
      description: `${input.description}\n\n📋 المصدر: صيانة دورية رقم ${wo.workOrderNumber}`,
      priority: "high",
      status: "open",
      assetId: input.assetId ?? wo.assetId ?? undefined,
      siteId: input.siteId ?? wo.siteId ?? undefined,
      reportedById: ctx.user.id,
      category: "corrective",
    });
    // Link ticket to execution result
    await ddb.update(pmExecutionResults)
      .set({ linkedTicketId: ticketId as number, status: "issue" })
      .where(and(
        eq(pmExecutionResults.workOrderId, input.workOrderId),
        eq(pmExecutionResults.checklistItemId, input.checklistItemId)
      ));
    return { ticketId, ticketNumber };
  }),

  // ─── Detection Rate Report ────────────────────────────────────────────
  getDetectionRateReport: protectedProcedure.input(z.object({
    dateFrom: z.string().optional(),
    dateTo: z.string().optional(),
  }).optional()).query(async ({ input }) => {
    const ddb = await db.getDb();
    if (!ddb) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "خطأ في قاعدة البيانات" });
    const { pmExecutionResults, pmExecutionSessions, pmWorkOrders } = await import("../drizzle/schema");
    const { gte, lte, and, eq } = await import("drizzle-orm");
    const from = input?.dateFrom ? new Date(input.dateFrom) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const to = input?.dateTo ? new Date(input.dateTo) : new Date();
    // Get all completed work orders in range
    const workOrders = await db.listPMWorkOrders({ status: "completed" });
    const filteredWOs = workOrders.filter((wo: any) => {
      const d = new Date(wo.completedDate ?? wo.scheduledDate);
      return d >= from && d <= to;
    });
    // Get all execution results for these WOs
    const woIds = filteredWOs.map((wo: any) => wo.id);
    let allResults: any[] = [];
    for (const woId of woIds) {
      const results = await ddb.select().from(pmExecutionResults)
        .where(eq(pmExecutionResults.workOrderId, woId));
      allResults = allResults.concat(results);
    }
    const totalItems = allResults.length;
    const okItems = allResults.filter((r: any) => r.status === "ok").length;
    const fixedItems = allResults.filter((r: any) => r.status === "fixed").length;
    const issueItems = allResults.filter((r: any) => r.status === "issue").length;
    const issueWithTicket = allResults.filter((r: any) => r.status === "issue" && r.linkedTicketId).length;
    // All tickets in range
    const allTickets = await db.getTickets();
    const rangeTickets = allTickets.filter((t: any) => {
      const d = new Date(t.createdAt);
      return d >= from && d <= to;
    });
    const pmSourceTickets = rangeTickets.filter((t: any) =>
      t.description?.includes("المصدر: صيانة دورية")
    );
    const detectionRate = rangeTickets.length > 0
      ? Math.round((pmSourceTickets.length / rangeTickets.length) * 100)
      : 0;
    return {
      period: { from: from.toISOString(), to: to.toISOString() },
      completedInspections: filteredWOs.length,
      totalItems,
      okItems,
      fixedItems,
      issueItems,
      issueWithTicket,
      totalTicketsInPeriod: rangeTickets.length,
      pmDetectedTickets: pmSourceTickets.length,
      detectionRate,
      summary: `تم اكتشاف ${pmSourceTickets.length} عطل من أصل ${rangeTickets.length} بلاغ (${detectionRate}%) عن طريق الصيانة الدورية`,
    };
  }),

  // ─── Asset Inspection History ─────────────────────────────────────────
  getAssetInspectionHistory: protectedProcedure.input(z.object({
    assetId: z.number(),
    limit: z.number().optional().default(10),
  })).query(async ({ input }) => {
    const ddb = await db.getDb();
    if (!ddb) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "خطأ في قاعدة البيانات" });
    const { pmExecutionSessions, pmWorkOrders, pmExecutionResults } = await import("../drizzle/schema");
    const { eq, desc, and } = await import("drizzle-orm");
    // Get work orders for this asset
    const workOrders = await db.listPMWorkOrders({ assetId: input.assetId, status: "completed" });
    const woIds = workOrders.map((wo: any) => wo.id);
    if (woIds.length === 0) return [];
    // Get sessions for these work orders
    const sessions: any[] = [];
    for (const woId of woIds.slice(0, input.limit)) {
      const sess = await ddb.select().from(pmExecutionSessions)
        .where(and(eq(pmExecutionSessions.workOrderId, woId), eq(pmExecutionSessions.status, "completed")))
        .limit(1);
      if (sess.length > 0) {
        const wo = workOrders.find((w: any) => w.id === woId);
        const results = await ddb.select().from(pmExecutionResults)
          .where(eq(pmExecutionResults.workOrderId, woId));
        sessions.push({
          ...sess[0],
          workOrderTitle: wo?.title ?? "",
          workOrderNumber: wo?.workOrderNumber ?? "",
          okCount: results.filter((r: any) => r.status === "ok").length,
          fixedCount: results.filter((r: any) => r.status === "fixed").length,
          issueCount: results.filter((r: any) => r.status === "issue").length,
          totalItems: results.length,
        });
      }
    }
    sessions.sort((a, b) => new Date(b.completedAt ?? b.startedAt).getTime() - new Date(a.completedAt ?? a.startedAt).getTime());
    return sessions;
  }),

  // ─── PM Report ────────────────────────────────────────────────────────
  getReport: protectedProcedure.input(z.object({
    dateFrom: z.string().optional(),
    dateTo: z.string().optional(),
  }).optional()).query(async ({ input }) => {
    const plans = await db.listPreventivePlans();
    const workOrders = await db.listPMWorkOrders();
    const now = new Date();
    const from = input?.dateFrom ? new Date(input.dateFrom) : null;
    const to = input?.dateTo ? new Date(input.dateTo) : null;
    const filteredWOs = workOrders.filter((wo: any) => {
      if (from && new Date(wo.scheduledDate) < from) return false;
      if (to && new Date(wo.scheduledDate) > to) return false;
      return true;
    });
    const totalPlans = plans.length;
    const activePlans = plans.filter((p: any) => p.isActive !== false).length;
    const inactivePlans = totalPlans - activePlans;
    const overduePlans = plans.filter((p: any) => {
      if (!p.nextDueDate || p.isActive === false) return false;
      return new Date(p.nextDueDate) < now;
    }).length;
    const totalWOs = filteredWOs.length;
    const completedWOs = filteredWOs.filter((wo: any) => wo.status === 'completed').length;
    const inProgressWOs = filteredWOs.filter((wo: any) => wo.status === 'in_progress').length;
    const scheduledWOs = filteredWOs.filter((wo: any) => wo.status === 'scheduled').length;
    const overdueWOs = filteredWOs.filter((wo: any) => wo.status === 'overdue').length;
    const cancelledWOs = filteredWOs.filter((wo: any) => wo.status === 'cancelled').length;
    const completionRate = totalWOs > 0 ? Math.round((completedWOs / totalWOs) * 100) : 0;
    let totalChecklistItems = 0;
    let doneChecklistItems = 0;
    filteredWOs.forEach((wo: any) => {
      if (Array.isArray(wo.checklistResults)) {
        totalChecklistItems += wo.checklistResults.length;
        doneChecklistItems += wo.checklistResults.filter((c: any) => c.done).length;
      }
    });
    const checklistCompletionRate = totalChecklistItems > 0 ? Math.round((doneChecklistItems / totalChecklistItems) * 100) : 0;
    const byFrequency: Record<string, number> = {};
    plans.forEach((p: any) => {
      byFrequency[p.frequency] = (byFrequency[p.frequency] || 0) + 1;
    });
    const recentWorkOrders = filteredWOs.slice(0, 10).map((wo: any) => ({
      id: wo.id,
      workOrderNumber: wo.workOrderNumber,
      title: wo.title,
      status: wo.status,
      scheduledDate: wo.scheduledDate,
      completedDate: wo.completedDate,
      completionPhotoUrl: wo.completionPhotoUrl,
    }));
    return {
      summary: { totalPlans, activePlans, inactivePlans, overduePlans },
      workOrders: { total: totalWOs, completed: completedWOs, inProgress: inProgressWOs, scheduled: scheduledWOs, overdue: overdueWOs, cancelled: cancelledWOs, completionRate },
      checklist: { total: totalChecklistItems, done: doneChecklistItems, completionRate: checklistCompletionRate },
      byFrequency,
      recentWorkOrders,
    };
  }),
});

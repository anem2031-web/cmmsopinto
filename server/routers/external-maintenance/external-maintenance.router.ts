import { isItTeamRole, isDelegateRole } from "@shared/roles";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { APP_ROLE, MAINTENANCE_RESPONSIBLE_DEPARTMENT } from "@shared/roles";
import {
  canGateApproveExternalEntry,
  canGateApproveExternalExit,
  canWarehouseHandOverExternalAsset,
  canWarehouseReceiveExternalAsset,
  hasCurrentExternalDelegateReceipt,
} from "@shared/externalMaintenanceWorkflow";
import {
  gateSecurityProcedure,
  protectedProcedure,
  router,
  warehouseProcedure,
} from "../_shared/procedures";
import * as db from "../../_core/db";
import { assertTicketReadable } from "../tickets/tickets.access";
import { queueTranslation } from "../../services/translation/translationEngine";
import { detectLanguage } from "../../services/translation/translation";
import { returnExternalRoute, readExternalRouteReviews, decideExternalRoute } from "../../services/external-route-review";
import { isExternalDelegateJob, loadExternalDelegateScopes, requireExternalDelegateJobs } from "../../_core/authz/external-delegate-access";
import { externalFollowupDetailInput, externalFollowupListInput } from "../../../shared/external-maintenance-followup";
import { listExternalMaintenanceFollowup, externalMaintenanceFollowupDetail } from "../../services/external-maintenance-followup";

function translateExternalDbError(error: unknown): never {
  const code = error instanceof Error ? error.message : String(error);
  const messages: Record<string, string> = {
    EXTERNAL_JOB_EXISTS: "تم تجهيز الأصل لهذا البلاغ مسبقًا",
    EXTERNAL_JOB_NOT_FOUND: "سجل الصيانة الخارجية غير موجود",
    EXTERNAL_JOB_INVALID_EXIT_STAGE: "لا يمكن اعتماد الخروج في المرحلة الحالية",
    EXTERNAL_JOB_INVALID_ENTRY_STAGE: "لا يمكن اعتماد الدخول قبل اكتمال دورة الصيانة الخارجية",
    EXTERNAL_JOB_INVALID_RECEIPT_STAGE: "لا يمكن للمستودع استلام الأصل قبل موافقة الحراسة على الدخول",
    EXTERNAL_JOB_INVALID_HANDOVER_STAGE: "لا يمكن تسليم الأصل للفني قبل تسجيل استلامه في المستودع",
    EXTERNAL_JOB_DELEGATE_REQUIRED: "يجب تحديد المندوب المسؤول قبل خروج الأصل",
    EXTERNAL_PURCHASE_TITLE_REQUIRED: "عنوان طلب الشراء مطلوب",
    EXTERNAL_PREPARATION_INVALID: "أكمل بيانات تجهيز الأصل",
    EXTERNAL_PREPARATION_CONFLICT: "تغير تجهيز الأصل؛ حدّث الصفحة قبل إعادة الإرسال",
    EXTERNAL_ACTOR_FORBIDDEN: "الحساب غير نشط أو لا يملك صلاحية الإجراء",
    EXTERNAL_DELEGATE_RECEIPT_FORBIDDEN: "المهمة الخارجية مسندة إلى مندوب آخر",
    EXTERNAL_DELEGATE_RECEIPT_CONFLICT: "تغيرت المهمة أو سبق اتخاذ القرار؛ حدّث الصفحة",
    EXTERNAL_DELEGATE_REJECTION_REASON_REQUIRED: "سبب رفض استلام الأصل إلزامي",
    EXTERNAL_DELEGATE_RECEIPT_REQUIRED: "يلزم تأكيد المندوب استلام أحدث تجهيز قبل موافقة الخروج",
    EXTERNAL_TICKET_INVALID_EXIT_STAGE: "البلاغ ليس جاهزًا لخروج الأصل في المسار C",
    EXTERNAL_TICKET_ASSIGNED_TECHNICIAN_REQUIRED: "يجب وجود فني مسند للبلاغ قبل تسليم الأصل لإعادة التركيب",
  };
  throw new TRPCError({
    code: code.includes("FORBIDDEN") ? "FORBIDDEN" : code.includes("EXISTS") || code.includes("CONFLICT") ? "CONFLICT" : "BAD_REQUEST",
    message: messages[code] || "تعذر تنفيذ إجراء الصيانة الخارجية",
  });
}


async function queueExternalJobTranslation(
  jobId: number,
  fields: Array<{ fieldName: string; text?: string | null }>,
  userId?: number,
) {
  const normalized = fields
    .map(field => ({ fieldName: field.fieldName, text: (field.text || "").trim() }))
    .filter(field => field.text.length > 0);
  if (!normalized.length) return;
  const sourceLanguage = await detectLanguage(normalized[0].text).catch(() => "ar" as const);
  await queueTranslation({
    entityType: "EXTERNAL_MAINTENANCE_JOB",
    entityId: jobId,
    fields: normalized,
    sourceLanguage,
    userId,
  });
}

async function assertActiveUserWithRole(userId: number, allowedRoles: string[], message: string) {
  const user = await db.getUserById(userId);
  if (!user || user.isActive === 0 || (!allowedRoles.includes(user.role)&&!(allowedRoles.includes(APP_ROLE.DELEGATE)&&isDelegateRole(user.role)))) {
    throw new TRPCError({ code: "BAD_REQUEST", message });
  }
  return user;
}

async function currentExternalActor(context: {user:any;authenticatedUser?:any}, roles: string[]) {
  const identity=context.authenticatedUser??context.user;
  if(!identity || identity.isActive!==1 || (!roles.includes(identity.role)&&!(roles.includes(APP_ROLE.DELEGATE)&&isDelegateRole(identity.role)))) throw new TRPCError({code:"FORBIDDEN",message:"ليس لديك صلاحية لهذا الإجراء"});
  const actor=await db.getUserById(identity.id);
  if(!actor || actor.role!==identity.role || actor.isActive!==1) throw new TRPCError({code:"FORBIDDEN",message:"الحساب غير متاح"});
  return actor;
}

export const externalMaintenanceRouter = router({
  listFollowup: protectedProcedure.input(externalFollowupListInput).query(async ({ ctx, input }) => {
    const database = await db.getDb();
    if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "تعذر الاتصال بقاعدة البيانات" });
    return listExternalMaintenanceFollowup(database, ctx.authenticatedUser ?? ctx.user, input);
  }),
  followupDetail: protectedProcedure.input(externalFollowupDetailInput).query(async ({ ctx, input }) => {
    const database = await db.getDb();
    if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "تعذر الاتصال بقاعدة البيانات" });
    return externalMaintenanceFollowupDetail(database, ctx.authenticatedUser ?? ctx.user, input);
  }),
  returnForRouteReview: warehouseProcedure.input(z.object({ ticketId: z.number().int().positive(), ticketItemId: z.number().int().positive(), reason: z.string().trim().min(1).max(4000) }).strict())
    .mutation(({ ctx, input }) => returnExternalRoute(ctx.user, input)),
  routeReviews: protectedProcedure.input(z.object({ ticketId: z.number().int().positive() }).strict())
    .query(({ ctx, input }) => readExternalRouteReviews(ctx.user, input.ticketId)),
  decideRouteReview: protectedProcedure.input(z.object({ ticketId: z.number().int().positive(), ticketItemId: z.number().int().positive(), returnId: z.number().int().positive(), path: z.enum(["A", "B", "C"]), reason: z.string().trim().min(1).max(4000) }).strict())
    .mutation(({ ctx, input }) => decideExternalRoute(ctx.user, input)),
  getByTicket: protectedProcedure.input(z.object({ ticketId: z.number() })).query(async ({ input, ctx }) => {
    const ticket = await db.getTicketById(input.ticketId);
    if (!ticket) throw new TRPCError({ code: "NOT_FOUND", message: "البلاغ غير موجود" });
    await assertTicketReadable(ctx.user, ticket as any);
    return db.getExternalMaintenanceJobByTicketId(input.ticketId);
  }),

  listForWarehouse: warehouseProcedure.query(async () => {
    const [waitingPreparation, jobs] = await Promise.all([
      db.listPathCTicketsWaitingWarehousePreparation(),
      db.listExternalMaintenanceJobs([
        "waiting_delegate_receipt",
        "waiting_warehouse_preparation",
        "waiting_gate_exit",
        "purchase_cycle",
        "waiting_gate_entry",
        "waiting_warehouse_receipt",
        "waiting_technician_handover",
        "delivered_for_reinstall",
        "reinstall_in_progress",
        "ready_for_closure",
        "closed",
      ]),
    ]);
    return { waitingPreparation, jobs };
  }),

  listForDelegate: protectedProcedure.query(async ({ctx}) => {
    const actor=await currentExternalActor(ctx,[APP_ROLE.DELEGATE]);
    const rows=await db.listExternalMaintenanceJobsForDelegate(actor.id);
    const scope=await loadExternalDelegateScopes(Array.from(new Set(rows.map(row=>Number(row.job.id)))));
    return rows.filter(row=>{
      const job=scope.get(Number(row.job.id));
      return job && Number(row.job.delegateId)===actor.id && isExternalDelegateJob(actor,job);
    });
  }),

  decideDelegateReceipt: protectedProcedure.input(z.object({
    jobId:z.number().int().positive(),expectedRevision:z.number().int().positive(),decision:z.enum(["accept","reject"]),reason:z.string().trim().max(4000).optional(),
  }).strict().superRefine((input,context)=>{
    if(input.decision==="reject"&&!input.reason?.trim()) context.addIssue({code:"custom",path:["reason"],message:"سبب رفض استلام الأصل إلزامي"});
  })).mutation(async ({ctx,input})=>{
    const actor=await currentExternalActor(ctx,[APP_ROLE.DELEGATE]);
    await requireExternalDelegateJobs(actor,[input.jobId]);
    try {
      const result=await db.decideExternalMaintenanceDelegateReceipt({...input,delegateId:actor.id});
      // Core has committed the current preparation decision before any alert.
      const recipients=input.decision==="accept" ? await db.getUsersByRole(APP_ROLE.GATE_SECURITY) : await db.getUsersByRole(APP_ROLE.WAREHOUSE);
      const targetIds=new Set<number>(recipients.filter(user=>user.isActive===1).map(user=>user.id));
      if(input.decision==="reject"&&result.warehousePreparedById) targetIds.add(result.warehousePreparedById);
      for(const userId of Array.from(targetIds)) await db.createNotification({userId,
        title:input.decision==="accept"?"🚪 أصل بانتظار موافقة الخروج":"رفض المندوب استلام الأصل",
        message:input.decision==="accept"?`أكد المندوب استلام الأصل. وثيقة الخروج ${result.exitDocumentNumber} بانتظار موافقة الحراسة.`:`لم يستلم المندوب الأصل: ${input.reason}`,
        type:input.decision==="accept"?"warning":"info",relatedTicketId:result.ticketId});
      await db.createAuditLog({userId:actor.id,action:"external_delegate_receipt_decided",entityType:"external_maintenance_job",entityId:input.jobId,
        newValues:{decision:input.decision,reason:input.reason,preparationRevision:result.preparationRevision}});
      return result;
    } catch(error) {
      if(error instanceof TRPCError) throw error;
      if(error instanceof Error&&error.message.startsWith("EXTERNAL_")) translateExternalDbError(error);
      throw error;
    }
  }),

  listForGate: gateSecurityProcedure.query(async () => {
    const rows=await db.listExternalMaintenanceJobs([
      "waiting_gate_exit",
      "purchase_cycle",
      "waiting_gate_entry",
      "waiting_warehouse_receipt",
      "waiting_technician_handover",
      "delivered_for_reinstall",
      "reinstall_in_progress",
      "ready_for_closure",
      "closed",
    ]);
    return rows.filter(row=>row.job.status!=="waiting_gate_exit" || (row.job.purchaseOrderId==null&&!row.job.gateExitApprovedAt&&hasCurrentExternalDelegateReceipt(row.job)));
  }),

  prepareByWarehouse: warehouseProcedure.input(z.object({
    ticketId: z.number(),
    jobId:z.number().int().positive().optional(),
    expectedRevision:z.number().int().nonnegative().optional(),
    // بند البلاغ المستهدف — الخطوة 5 (2026-08-08). اختياري: إن أُغفل، يُستخدم
    // البند الأول تلقائيًا (البلاغ أحادي البند — الأغلبية الساحقة — لا يحتاج
    // الواجهة القديمة تمرير هذا الحقل إطلاقًا، فيسلك نفس السلوك القديم حرفيًا).
    ticketItemId: z.number().optional(),
    assetName: z.string().trim().min(1, "اسم الأصل مطلوب"),
    purchaseTitle:z.string().trim().min(1,"عنوان طلب الشراء مطلوب").max(300),
    assetBeforePhotoUrl: z.string().trim().min(1, "صورة الأصل قبل الخروج مطلوبة"),
    assetBeforeCondition: z.string().trim().min(1, "وصف حالة الأصل قبل الخروج مطلوب"),
    delegateId: z.number(),
    warehouseNotes: z.string().trim().optional(),
  })).mutation(async ({ input, ctx }) => {
    const actor=await currentExternalActor(ctx,[APP_ROLE.WAREHOUSE,APP_ROLE.ADMIN,APP_ROLE.OWNER]);
    const ticket = await db.getTicketById(input.ticketId);
    if (!ticket) throw new TRPCError({ code: "NOT_FOUND", message: "البلاغ غير موجود" });

    let ticketItemId = input.ticketItemId;
    if (!ticketItemId) {
      const items = await db.getTicketItems(input.ticketId);
      const primary = items.find((i: any) => i.itemNumber === 1) ?? items[0];
      if (!primary) throw new TRPCError({ code: "BAD_REQUEST", message: "لا يوجد بند لهذا البلاغ" });
      ticketItemId = primary.id;
    }
    const item = await db.getTicketItemById(ticketItemId);
    if (!item || item.ticketId !== input.ticketId) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "بند البلاغ غير مطابق لهذا البلاغ" });
    }
    if (item.maintenancePath !== "C" || item.status !== "work_approved") {
      throw new TRPCError({ code: "BAD_REQUEST", message: "البند ليس في مرحلة تجهيز أصل المسار C" });
    }
    const selectedDelegate=await assertActiveUserWithRole(input.delegateId, [APP_ROLE.DELEGATE], "يجب اختيار مندوب صالح");
    if(selectedDelegate.isActive!==1) throw new TRPCError({code:"BAD_REQUEST",message:"يجب اختيار مندوب نشط"});

    try {
      const result = await db.prepareExternalMaintenanceJob({
        ticketId: input.ticketId,
        ticketItemId,
        assetName: input.assetName,
        purchaseTitle:input.purchaseTitle,
        jobId:input.jobId,
        expectedRevision:input.expectedRevision,
        assetBeforePhotoUrl: input.assetBeforePhotoUrl,
        assetBeforeCondition: input.assetBeforeCondition,
        delegateId: input.delegateId,
        warehouseNotes: input.warehouseNotes,
        warehousePreparedById: actor.id,
      });
      await queueExternalJobTranslation(result.jobId, [
        { fieldName: "assetName", text: input.assetName },
        { fieldName: "assetBeforeCondition", text: input.assetBeforeCondition },
        { fieldName: "warehouseNotes", text: input.warehouseNotes },
      ], ctx.user.id);
      await db.createNotification({
        userId: input.delegateId,
        title: "تم اختيارك لمهمة صيانة خارجية",
        message: `تم تجهيز الأصل للبلاغ ${ticket.ticketNumber}. راجع مهمة الصيانة الخارجية وأكد استلام الأصل أو ارفضه مع السبب.`,
        type: "info",
        relatedTicketId: ticket.id,
      });
      await db.createAuditLog({
        userId: actor.id,
        action: "prepare_external_maintenance_asset",
        entityType: "ticket",
        entityId: ticket.id,
        newValues: { delegateId: input.delegateId, exitDocumentNumber: result.exitDocumentNumber,purchaseTitle:input.purchaseTitle,preparationRevision:result.preparationRevision },
      });
      return result;
    } catch (error) {
      translateExternalDbError(error);
    }
  }),

  approveGateExit: gateSecurityProcedure.input(z.object({
    jobId: z.number(),
    carrierName: z.string().trim().min(2, "اسم الشخص الذي أخرج الأصل مطلوب"),
    notes: z.string().trim().optional(),
  })).mutation(async ({ input, ctx }) => {
    const job = await db.getExternalMaintenanceJobById(input.jobId);
    if (!job) throw new TRPCError({ code: "NOT_FOUND", message: "سجل الصيانة الخارجية غير موجود" });
    if (!canGateApproveExternalExit(job.status) || !hasCurrentExternalDelegateReceipt(job) || job.purchaseOrderId!=null || job.gateExitApprovedAt) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "لا يمكن اعتماد الخروج في المرحلة الحالية" });
    }
    try {
      const result = await db.approveExternalMaintenanceGateExit({
        jobId: input.jobId,
        gateUserId: ctx.user.id,
        carrierName: input.carrierName,
        notes: input.notes,
      });
      await queueExternalJobTranslation(input.jobId, [
        { fieldName: "gateExitNotes", text: input.notes },
      ], ctx.user.id);
      if (result.job.delegateId) {
        await db.createNotification({
          userId: result.job.delegateId,
          title: "🔧 مهمة صيانة خارجية جاهزة للتسعير",
          message: `وافقت الحراسة على خروج الأصل للبلاغ ${result.ticket.ticketNumber}. الطلب ${result.poNumber} جاهز للتسعير بنفس دورة طلب الشراء.`,
          type: "success",
          relatedTicketId: result.ticket.id,
          relatedPoId: result.purchaseOrderId,
        });
      }
      await db.createAuditLog({
        userId: ctx.user.id,
        action: "external_gate_exit_approved",
        entityType: "external_maintenance_job",
        entityId: input.jobId,
        newValues: { carrierName: input.carrierName, purchaseOrderId: result.purchaseOrderId },
      });
      return { success: true, purchaseOrderId: result.purchaseOrderId, poNumber: result.poNumber };
    } catch (error) {
      translateExternalDbError(error);
    }
  }),

  approveGateEntry: gateSecurityProcedure.input(z.object({
    jobId: z.number(),
    carrierName: z.string().trim().min(2, "اسم الشخص الذي أعاد الأصل مطلوب"),
    notes: z.string().trim().optional(),
  })).mutation(async ({ input, ctx }) => {
    const job = await db.getExternalMaintenanceJobById(input.jobId);
    if (!job) throw new TRPCError({ code: "NOT_FOUND", message: "سجل الصيانة الخارجية غير موجود" });
    if (!canGateApproveExternalEntry(job.status)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "لا يمكن اعتماد الدخول قبل اكتمال الصيانة الخارجية" });
    }
    try {
      const result = await db.approveExternalMaintenanceGateEntry({
        jobId: input.jobId,
        gateUserId: ctx.user.id,
        carrierName: input.carrierName,
        notes: input.notes,
      });
      await queueExternalJobTranslation(input.jobId, [
        { fieldName: "gateEntryNotes", text: input.notes },
      ], ctx.user.id);
      const ticket = await db.getTicketById(result.ticketId);
      const warehouseUsers = await db.getUsersByRole(APP_ROLE.WAREHOUSE);
      for (const warehouseUser of warehouseUsers) {
        await db.createNotification({
          userId: warehouseUser.id,
          title: "📦 أصل عائد بانتظار استلام المستودع",
          message: `وافقت الحراسة على دخول الأصل المرتبط بالبلاغ ${ticket?.ticketNumber || result.ticketId}.`,
          type: "info",
          relatedTicketId: result.ticketId,
        });
      }
      await db.createAuditLog({
        userId: ctx.user.id,
        action: "external_gate_entry_approved",
        entityType: "external_maintenance_job",
        entityId: input.jobId,
        newValues: { carrierName: input.carrierName },
      });
      return { success: true };
    } catch (error) {
      translateExternalDbError(error);
    }
  }),

  receiveByWarehouse: warehouseProcedure.input(z.object({
    jobId: z.number(),
    assetAfterReturnPhotoUrl: z.string().trim().min(1, "صورة الأصل بعد العودة مطلوبة"),
    returnCondition: z.string().trim().min(1, "حالة الأصل عند العودة مطلوبة"),
    workshopReportUrl: z.string().trim().optional(),
    notes: z.string().trim().optional(),
  })).mutation(async ({ input, ctx }) => {
    const job = await db.getExternalMaintenanceJobById(input.jobId);
    if (!job) throw new TRPCError({ code: "NOT_FOUND", message: "سجل الصيانة الخارجية غير موجود" });
    if (!canWarehouseReceiveExternalAsset(job.status)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "لا يمكن استلام الأصل قبل موافقة الحراسة على الدخول" });
    }
    try {
      const result = await db.receiveExternalMaintenanceAsset({
        ...input,
        warehouseUserId: ctx.user.id,
      });
      await queueExternalJobTranslation(input.jobId, [
        { fieldName: "returnCondition", text: input.returnCondition },
        { fieldName: "warehouseReturnNotes", text: input.notes },
      ], ctx.user.id);
      await db.createAuditLog({
        userId: ctx.user.id,
        action: "receive_external_asset_by_warehouse",
        entityType: "external_maintenance_job",
        entityId: input.jobId,
        newValues: { returnDocumentNumber: result.returnDocumentNumber },
      });
      return { success: true, returnDocumentNumber: result.returnDocumentNumber };
    } catch (error) {
      translateExternalDbError(error);
    }
  }),

  handoverByWarehouse: warehouseProcedure.input(z.object({
    jobId: z.number(),
    actualRecipientId: z.number(),
    notes: z.string().trim().optional(),
  })).mutation(async ({ input, ctx }) => {
    const job = await db.getExternalMaintenanceJobById(input.jobId);
    if (!job) throw new TRPCError({ code: "NOT_FOUND", message: "سجل الصيانة الخارجية غير موجود" });
    if (!canWarehouseHandOverExternalAsset(job.status)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "الأصل غير جاهز للتسليم للفني" });
    }
    const recipient = await assertActiveUserWithRole(
      input.actualRecipientId,
      [
        APP_ROLE.TECHNICIAN,
        APP_ROLE.SUPERVISOR,
        APP_ROLE.MAINTENANCE_MANAGER,
        APP_ROLE.GENERAL_MAINTENANCE_MANAGER,
        APP_ROLE.CONSTRUCTION_PROCUREMENT_MANAGER,
        APP_ROLE.IT_MANAGER,
        APP_ROLE.IT_MEMBER,
        APP_ROLE.ADMIN,
        APP_ROLE.OWNER,
      ],
      "يجب اختيار فني أو مسؤول صالح لاستلام الأصل",
    );
    if (isItTeamRole(recipient.role)) {
      const ticket = await db.getTicketById(job.ticketId);
      if (
        !ticket ||
        ticket.maintenanceResponsibleDepartment !== MAINTENANCE_RESPONSIBLE_DEPARTMENT.IT
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "عضو فريق تقنية المعلومات يمكنه استلام الأصل فقط لبلاغ IT المسند إليه",
        });
      }
    }
    try {
      const result = await db.handoverExternalMaintenanceAsset({
        ...input,
        warehouseUserId: ctx.user.id,
      });
      await queueExternalJobTranslation(input.jobId, [
        { fieldName: "handoverNotes", text: input.notes },
      ], ctx.user.id);
      const recipients = new Set<number>(
        [result.ticket.assignedToId, input.actualRecipientId].filter(
          (recipientId): recipientId is number => typeof recipientId === "number" && recipientId > 0,
        ),
      );
      for (const recipientId of Array.from(recipients)) {
        await db.createNotification({
          userId: recipientId,
          title: "🔧 أصل جاهز لإعادة التركيب",
          message: `تم تسليم الأصل المرتبط بالبلاغ ${result.ticket.ticketNumber} إلى ${recipient.name || "المستلم"}. يمكن الآن بدء إعادة التركيب.`,
          type: "success",
          relatedTicketId: result.ticket.id,
        });
      }
      await db.createAuditLog({
        userId: ctx.user.id,
        action: "handover_external_asset_for_reinstall",
        entityType: "external_maintenance_job",
        entityId: input.jobId,
        newValues: {
          assignedTechnicianId: result.ticket.assignedToId,
          actualRecipientId: input.actualRecipientId,
          handoverDocumentNumber: result.handoverDocumentNumber,
        },
      });
      return { success: true, handoverDocumentNumber: result.handoverDocumentNumber };
    } catch (error) {
      translateExternalDbError(error);
    }
  }),
});

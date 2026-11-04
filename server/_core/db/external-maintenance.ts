import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/mysql-core";
import {
  assets,
  auditLogs,
  externalMaintenanceJobs,
  purchaseOrderItems,
  purchaseOrders,
  ticketStatusHistory,
  tickets,
  ticketItems,
  users,
} from "../../../drizzle/schema";
import { getDb, withTransaction } from "./client";
import { getNextPONumber } from "./purchase";
import { APP_ROLE, isDelegateRole } from "../../../shared/roles";
import { canWarehouseReprepareExternalAsset, hasCurrentExternalDelegateReceipt } from "../../../shared/externalMaintenanceWorkflow";

export type ExternalMaintenanceJobStatus =
  | "waiting_warehouse_preparation"
  | "waiting_delegate_receipt"
  | "waiting_gate_exit"
  | "purchase_cycle"
  | "waiting_gate_entry"
  | "waiting_warehouse_receipt"
  | "waiting_technician_handover"
  | "delivered_for_reinstall"
  | "reinstall_in_progress"
  | "ready_for_closure"
  | "closed";

function documentNumber(prefix: "OUT" | "RET" | "HND", jobId: number) {
  const year = new Date().getFullYear();
  return `EXT-${prefix}-${year}-${String(jobId).padStart(5, "0")}`;
}

export async function getExternalMaintenanceJobById(id: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(externalMaintenanceJobs)
    .where(eq(externalMaintenanceJobs.id, id)).limit(1);
  return rows[0] || null;
}

export async function getExternalMaintenanceJobByTicketId(ticketId: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(externalMaintenanceJobs)
    .where(eq(externalMaintenanceJobs.ticketId, ticketId)).limit(1);
  return rows[0] || null;
}

/**
 * سجل الصيانة الخارجية الخاص ببند بلاغ بعينه — الخطوة 5 من ميزة البلاغ متعدد
 * الجهات (2026-08-08). بعد استبدال الفهرس الفريد ليكون على `ticketItemId` لا
 * `ticketId`، أصبح البلاغ الواحد قادرًا على امتلاك أكثر من سجل صيانة خارجية
 * (بند لكل سجل) — هذه الدالة تجلب سجل بند بعينه تحديدًا.
 */
export async function getExternalMaintenanceJobByTicketItemId(ticketItemId: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(externalMaintenanceJobs)
    .where(eq(externalMaintenanceJobs.ticketItemId, ticketItemId)).limit(1);
  return rows[0] || null;
}

export async function getExternalMaintenanceJobByPurchaseOrderId(purchaseOrderId: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(externalMaintenanceJobs)
    .where(eq(externalMaintenanceJobs.purchaseOrderId, purchaseOrderId)).limit(1);
  return rows[0] || null;
}

export async function updateExternalMaintenanceJob(id: number, data: Record<string, any>, tx?: any) {
  const db = tx || await getDb();
  if (!db) return;
  await db.update(externalMaintenanceJobs).set(data as any)
    .where(eq(externalMaintenanceJobs.id, id));
}

export async function updateExternalMaintenanceJobByTicketId(ticketId: number, data: Record<string, any>, tx?: any) {
  const db = tx || await getDb();
  if (!db) return;
  await db.update(externalMaintenanceJobs).set(data as any)
    .where(eq(externalMaintenanceJobs.ticketId, ticketId));
}

function externalMaintenanceJobRows(db: NonNullable<Awaited<ReturnType<typeof getDb>>>, statuses?: ExternalMaintenanceJobStatus[], delegateId?: number) {
  const assigned = alias(users, "externalAssignedTechnician");
  const delegate = alias(users, "externalDelegate");
  const actualRecipient = alias(users, "externalActualRecipient");
  const preparedBy = alias(users, "externalPreparedBy");
  const gateExitBy = alias(users, "externalGateExitBy");
  const gateEntryBy = alias(users, "externalGateEntryBy");
  const warehouseReceivedBy = alias(users, "externalWarehouseReceivedBy");
  const handoverBy = alias(users, "externalHandoverBy");

  const currentItem = alias(ticketItems, "externalCurrentItem");
  const where = and(
    statuses?.length ? inArray(externalMaintenanceJobs.status, statuses as any[]) : undefined,
    delegateId == null ? undefined : and(
      eq(externalMaintenanceJobs.delegateId, delegateId), eq(delegate.id, delegateId), inArray(delegate.role,[APP_ROLE.DELEGATE,APP_ROLE.DELEGATE_MANAGER]), eq(delegate.isActive, 1),
      isNull(externalMaintenanceJobs.purchaseOrderId), isNull(externalMaintenanceJobs.gateExitApprovedAt),
      or(and(isNull(externalMaintenanceJobs.ticketItemId), eq(tickets.maintenancePath, "C"), eq(tickets.status, "work_approved")),
        and(eq(currentItem.id, externalMaintenanceJobs.ticketItemId), eq(currentItem.ticketId, tickets.id), eq(currentItem.maintenancePath, "C"), eq(currentItem.status, "work_approved"))),
    ),
  );

  return db.select({
    job: externalMaintenanceJobs,
    ticketNumber: tickets.ticketNumber,
    ticketTitle: tickets.title,
    ticketDescription: sql<string | null>`CASE WHEN TRIM(COALESCE(${currentItem.description},''))<>'' THEN ${currentItem.description} ELSE ${tickets.description} END`,
    ticketStatus: tickets.status,
    ticketAssignedToId: tickets.assignedToId,
    ticketAssetId: tickets.assetId,
    assetRegisteredName: assets.name,
    assignedTechnicianName: assigned.name,
    delegateName: delegate.name,
    actualRecipientName: actualRecipient.name,
    warehousePreparedByName: preparedBy.name,
    gateExitApprovedByName: gateExitBy.name,
    gateEntryApprovedByName: gateEntryBy.name,
    warehouseReceivedByName: warehouseReceivedBy.name,
    handoverByName: handoverBy.name,
    poNumber: purchaseOrders.poNumber,
    purchaseOrderStatus: purchaseOrders.status,
  })
    .from(externalMaintenanceJobs)
    .innerJoin(tickets, eq(externalMaintenanceJobs.ticketId, tickets.id))
    .leftJoin(currentItem, and(eq(externalMaintenanceJobs.ticketItemId, currentItem.id), eq(currentItem.ticketId, tickets.id)))
    .leftJoin(assets, eq(tickets.assetId, assets.id))
    .leftJoin(assigned, eq(tickets.assignedToId, assigned.id))
    .leftJoin(delegate, eq(externalMaintenanceJobs.delegateId, delegate.id))
    .leftJoin(actualRecipient, eq(externalMaintenanceJobs.actualRecipientId, actualRecipient.id))
    .leftJoin(preparedBy, eq(externalMaintenanceJobs.warehousePreparedById, preparedBy.id))
    .leftJoin(gateExitBy, eq(externalMaintenanceJobs.gateExitApprovedById, gateExitBy.id))
    .leftJoin(gateEntryBy, eq(externalMaintenanceJobs.gateEntryApprovedById, gateEntryBy.id))
    .leftJoin(warehouseReceivedBy, eq(externalMaintenanceJobs.warehouseReceivedById, warehouseReceivedBy.id))
    .leftJoin(handoverBy, eq(externalMaintenanceJobs.handoverById, handoverBy.id))
    .leftJoin(purchaseOrders, eq(externalMaintenanceJobs.purchaseOrderId, purchaseOrders.id))
    .where(where)
    .orderBy(desc(externalMaintenanceJobs.updatedAt));
}

export async function listExternalMaintenanceJobs(statuses?: ExternalMaintenanceJobStatus[]) {
  const db = await getDb();
  if (!db) return [];
  return externalMaintenanceJobRows(db, statuses);
}

/** One scoped join: no per-record ticket reader or cached assignment. */
export async function listExternalMaintenanceJobsForDelegate(delegateId: number) {
  if (!Number.isSafeInteger(delegateId) || delegateId <= 0) throw new Error("EXTERNAL_DELEGATE_INVALID");
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  return externalMaintenanceJobRows(db, ["waiting_delegate_receipt", "waiting_gate_exit", "waiting_warehouse_preparation"], delegateId);
}

/**
 * البنود بانتظار تجهيز المستودع للصيانة الخارجية — الخطوة 5 من ميزة البلاغ
 * متعدد الجهات (2026-08-08). أُعيدت كتابتها لتُبنى من `ticket_items` بدل
 * `tickets` مباشرة: البند (لا البلاغ) هو مصدر الحقيقة لمسار C وحالته الآن.
 *
 * ✅ توافق رجعي كامل: كل بلاغ أحادي البند (كل البلاغات القديمة) له بند واحد
 * تُنسخ إليه بيانات البلاغ حرفيًا (راجع الخطوة 1) — نفس النتيجة تمامًا كانت
 * تُنتجها النسخة القديمة المبنية على `tickets` مباشرة.
 */
export async function listPathCTicketsWaitingWarehousePreparation() {
  const db = await getDb();
  if (!db) return [];
  const assigned = alias(users, "pathCAssignedTechnician");
  return db.select({
    ticketId: tickets.id,
    ticketItemId: ticketItems.id,
    ticketItemNumber: ticketItems.itemNumber,
    ticketNumber: tickets.ticketNumber,
    ticketTitle: tickets.title,
    ticketStatus: tickets.status,
    ticketBeforePhotoUrl: tickets.beforePhotoUrl,
    itemDescription: ticketItems.description,
    assetId: tickets.assetId,
    assetName: assets.name,
    assetPhotoUrl: assets.photoUrl,
    assignedTechnicianId: ticketItems.assignedToId,
    assignedTechnicianName: assigned.name,
    createdAt: tickets.createdAt,
  })
    .from(ticketItems)
    .innerJoin(tickets, eq(ticketItems.ticketId, tickets.id))
    .leftJoin(assets, eq(tickets.assetId, assets.id))
    .leftJoin(assigned, eq(ticketItems.assignedToId, assigned.id))
    .leftJoin(externalMaintenanceJobs, or(eq(externalMaintenanceJobs.ticketItemId, ticketItems.id),
      and(isNull(externalMaintenanceJobs.ticketItemId), eq(externalMaintenanceJobs.ticketId, tickets.id), eq(ticketItems.itemNumber, 1))))
    .where(and(
      eq(ticketItems.maintenancePath, "C"),
      eq(ticketItems.status, "work_approved"),
      isNull(externalMaintenanceJobs.id),
    ))
    .orderBy(desc(tickets.updatedAt));
}

async function assertExternalActor(tx: any, id: number, roles: string[]) {
  const [actor] = await tx.select().from(users).where(eq(users.id, id)).for("update");
  if (!actor || Number(actor.isActive) !== 1 || (!roles.includes(actor.role)&&!(roles.includes(APP_ROLE.DELEGATE)&&isDelegateRole(actor.role)))) throw new Error("EXTERNAL_ACTOR_FORBIDDEN");
  return actor;
}

/** Parent locks serialize route changes, preparation and gate approval. */
async function lockExternalSource(tx: any, ticketId: number, ticketItemId?: number | null) {
  const [ticket] = await tx.select().from(tickets).where(eq(tickets.id, ticketId)).for("update");
  const [item] = ticketItemId == null ? [] : await tx.select().from(ticketItems)
    .where(and(eq(ticketItems.id, ticketItemId), eq(ticketItems.ticketId, ticketId))).for("update");
  if (!ticket || (ticketItemId != null && !item) || (item?.maintenancePath ?? ticket.maintenancePath) !== "C"
    || (item?.status ?? ticket.status) !== "work_approved") throw new Error("EXTERNAL_TICKET_INVALID_EXIT_STAGE");
  return { ticket, item };
}

async function auditExternalPreparation(tx: any, actorId: number, jobId: number, action: string, before: unknown, after: unknown) {
  await tx.execute(sql`INSERT INTO audit_logs (userId,action,entityType,entityId,oldValues,newValues)
    VALUES (${actorId},${action},'external_maintenance_job',${jobId},${before == null ? null : JSON.stringify(before)},${JSON.stringify(after)})`);
}

export async function prepareExternalMaintenanceJob(input: {
  ticketId: number;
  ticketItemId: number;
  assetName: string;
  purchaseTitle: string;
  assetBeforePhotoUrl: string;
  assetBeforeCondition: string;
  delegateId: number;
  warehousePreparedById: number;
  warehouseNotes?: string;
  jobId?: number;
  expectedRevision?: number;
}) {
  const purchaseTitle = input.purchaseTitle?.trim(), assetName = input.assetName?.trim();
  if (!purchaseTitle || purchaseTitle.length > 300) throw new Error("EXTERNAL_PURCHASE_TITLE_REQUIRED");
  if (!assetName || assetName.length > 300 || !input.assetBeforePhotoUrl?.trim() || !input.assetBeforeCondition?.trim()) throw new Error("EXTERNAL_PREPARATION_INVALID");
  return withTransaction(async (tx) => {
    // Serialize with a warehouse return / manager route decision. The router's
    // earlier read is not authorization for a later write after the path changed.
    await assertExternalActor(tx, input.warehousePreparedById, ["warehouse", "admin", "owner"]);
    await assertExternalActor(tx, input.delegateId, ["delegate"]);
    const { ticket: freshTicket, item: freshItem } = await lockExternalSource(tx, input.ticketId, input.ticketItemId);
    const existingRows = await tx.select()
      .from(externalMaintenanceJobs)
      .where(input.jobId != null ? eq(externalMaintenanceJobs.id, input.jobId) : or(eq(externalMaintenanceJobs.ticketItemId, input.ticketItemId),
        Number(freshItem?.itemNumber) === 1 ? and(isNull(externalMaintenanceJobs.ticketItemId), eq(externalMaintenanceJobs.ticketId, input.ticketId)) : undefined))
      .limit(2).for("update");
    if (existingRows.length > 1) throw new Error("EXTERNAL_PREPARATION_CONFLICT");
    const existing = existingRows[0];
    if (input.jobId != null && !existing) throw new Error("EXTERNAL_JOB_NOT_FOUND");
    if (existing && input.jobId == null) throw new Error("EXTERNAL_JOB_EXISTS");
    if (existing && (Number(existing.ticketId) !== input.ticketId || (existing.ticketItemId != null && Number(existing.ticketItemId) !== input.ticketItemId)
      || (existing.ticketItemId == null && (freshItem?.itemNumber !== 1 || freshTicket.maintenancePath !== "C" || freshTicket.status !== "work_approved")))) throw new Error("EXTERNAL_TICKET_INVALID_EXIT_STAGE");
    if (existing && (!canWarehouseReprepareExternalAsset(existing) || !Number.isSafeInteger(input.expectedRevision)
      || Number(existing.preparationRevision) !== input.expectedRevision)) throw new Error("EXTERNAL_PREPARATION_CONFLICT");
    if (!existing && input.expectedRevision != null && input.expectedRevision !== 0) throw new Error("EXTERNAL_PREPARATION_CONFLICT");
    const preparationRevision = existing ? Number(existing.preparationRevision) + 1 : 1;
    if (!Number.isSafeInteger(preparationRevision) || preparationRevision <= 0) throw new Error("EXTERNAL_PREPARATION_CONFLICT");
    const prepared = {
      status: "waiting_delegate_receipt",
      purchaseTitle,
      assetName,
      assetBeforePhotoUrl: input.assetBeforePhotoUrl.trim(),
      assetBeforeCondition: input.assetBeforeCondition.trim(),
      delegateId: input.delegateId,
      delegateReceiptStatus: "pending", delegateReceiptById: null, delegateReceiptAt: null, delegateReceiptReason: null,
      preparationRevision,
      warehousePreparedById: input.warehousePreparedById, warehousePreparedAt: new Date(), warehouseNotes: input.warehouseNotes?.trim() ?? null,
    };
    let jobId: number, exitDocumentNumber: string;
    if (existing) {
      jobId = Number(existing.id);
      exitDocumentNumber = existing.exitDocumentNumber || documentNumber("OUT", jobId);
      const [written] = await tx.update(externalMaintenanceJobs).set({ ...prepared, exitDocumentNumber } as any)
        .where(and(eq(externalMaintenanceJobs.id, jobId), eq(externalMaintenanceJobs.preparationRevision, Number(input.expectedRevision)),
          eq(externalMaintenanceJobs.status, existing.status), isNull(externalMaintenanceJobs.purchaseOrderId), isNull(externalMaintenanceJobs.gateExitApprovedAt)));
      if (Number(written?.affectedRows) !== 1) throw new Error("EXTERNAL_PREPARATION_CONFLICT");
    } else {
      const result = await tx.insert(externalMaintenanceJobs).values({
        ticketId: input.ticketId,
        ticketItemId: input.ticketItemId,
        ...prepared,
      } as any);
      jobId = Number(result[0].insertId);
      if (!Number.isSafeInteger(jobId) || jobId <= 0) throw new Error("EXTERNAL_PREPARATION_CONFLICT");
      exitDocumentNumber = documentNumber("OUT", jobId);
      await tx.update(externalMaintenanceJobs)
        .set({ exitDocumentNumber } as any)
        .where(eq(externalMaintenanceJobs.id, jobId));
    }
    // Preserve the previous rejected decision and revision before resetting it.
    await auditExternalPreparation(tx, input.warehousePreparedById, jobId, existing ? "external_preparation_revised" : "external_preparation_created", existing ?? null,
      { ...prepared, exitDocumentNumber });
    await tx.insert(ticketStatusHistory).values({
      ticketId: input.ticketId,
      fromStatus: "work_approved",
      toStatus: "work_approved",
      changedById: input.warehousePreparedById,
      notes: `جهز المستودع الأصل للصيانة الخارجية وأصدر وثيقة الخروج ${exitDocumentNumber}`,
    } as any);
    return { jobId, exitDocumentNumber, preparationRevision, delegateId: input.delegateId, ticketId: input.ticketId,
      ticketItemId: existing ? existing.ticketItemId == null ? null : Number(existing.ticketItemId) : input.ticketItemId };
  });
}

export async function decideExternalMaintenanceDelegateReceipt(input: {
  jobId: number; delegateId: number; expectedRevision: number; decision: "accept" | "reject"; reason?: string;
}) {
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1 || !["accept", "reject"].includes(input.decision)) throw new Error("EXTERNAL_DELEGATE_RECEIPT_CONFLICT");
  const reason = input.reason?.trim() || null;
  if (input.decision === "reject" && (!reason || reason.length > 4000)) throw new Error("EXTERNAL_DELEGATE_REJECTION_REASON_REQUIRED");
  return withTransaction(async tx => {
    await assertExternalActor(tx, input.delegateId, ["delegate"]);
    const [observed] = await tx.select().from(externalMaintenanceJobs).where(eq(externalMaintenanceJobs.id, input.jobId)).limit(1);
    if (!observed || Number(observed.delegateId) !== input.delegateId) throw new Error("EXTERNAL_DELEGATE_RECEIPT_FORBIDDEN");
    await lockExternalSource(tx, Number(observed.ticketId), observed.ticketItemId == null ? null : Number(observed.ticketItemId));
    const [job] = await tx.select().from(externalMaintenanceJobs).where(eq(externalMaintenanceJobs.id, input.jobId)).limit(1).for("update");
    if (!job || Number(job.delegateId) !== input.delegateId || job.ticketId !== observed.ticketId || job.ticketItemId !== observed.ticketItemId) throw new Error("EXTERNAL_DELEGATE_RECEIPT_FORBIDDEN");
    if (job.status !== "waiting_delegate_receipt" || job.delegateReceiptStatus !== "pending" || !String(job.purchaseTitle ?? "").trim()
      || Number(job.preparationRevision) !== input.expectedRevision || job.purchaseOrderId != null || job.gateExitApprovedAt) throw new Error("EXTERNAL_DELEGATE_RECEIPT_CONFLICT");
    const status = input.decision === "accept" ? "waiting_gate_exit" : "waiting_warehouse_preparation";
    const data = { status, delegateReceiptStatus: input.decision === "accept" ? "accepted" : "rejected", delegateReceiptById: input.delegateId,
      delegateReceiptAt: new Date(), delegateReceiptReason: input.decision === "reject" ? reason : null };
    const [written] = await tx.update(externalMaintenanceJobs).set(data as any).where(and(eq(externalMaintenanceJobs.id, input.jobId),
      eq(externalMaintenanceJobs.delegateId, input.delegateId), eq(externalMaintenanceJobs.preparationRevision, input.expectedRevision),
      eq(externalMaintenanceJobs.status, "waiting_delegate_receipt"), eq(externalMaintenanceJobs.delegateReceiptStatus, "pending"),
      isNull(externalMaintenanceJobs.purchaseOrderId), isNull(externalMaintenanceJobs.gateExitApprovedAt)));
    if (Number(written?.affectedRows) !== 1) throw new Error("EXTERNAL_DELEGATE_RECEIPT_CONFLICT");
    await auditExternalPreparation(tx, input.delegateId, input.jobId, `external_delegate_receipt_${input.decision}`, job, { ...data, preparationRevision: input.expectedRevision });
    await tx.insert(ticketStatusHistory).values({ ticketId: job.ticketId, fromStatus: "work_approved", toStatus: "work_approved", changedById: input.delegateId,
      notes: input.decision === "accept" ? `أكد المندوب استلام الأصل بوثيقة ${job.exitDocumentNumber}` : `رفض المندوب استلام الأصل بوثيقة ${job.exitDocumentNumber}: ${reason}` } as any);
    return { jobId: Number(job.id), ticketId: Number(job.ticketId), ticketItemId: job.ticketItemId == null ? null : Number(job.ticketItemId),
      delegateId: input.delegateId, status, preparationRevision: input.expectedRevision, exitDocumentNumber: job.exitDocumentNumber, warehousePreparedById: job.warehousePreparedById };
  });
}

// ✅ 2026-08-10 — المرحلة 6 التكميلية (كانت معلَّقة من الخطوة 5): الدالتان
// approveExternalMaintenanceGateExit وhandoverExternalMaintenanceAsset — وهما
// الوحيدتان اللتان تكتبان قيمة *جديدة* على tickets.status (مصدر التعارض
// الفعلي عند تعدد سجلات نشطة معًا) — أصبحتا تحدّثان حالة ticket_items
// تحديدًا عند توفر ticketItemId، مع توافق رجعي (البند الأول يعكس على tickets
// أيضًا). handoverExternalMaintenanceAsset أيضًا تستخدم الآن فني *البند*
// (item.assignedToId) بدل فني رأس البلاغ فقط.
//
// ⚠️ تبقى نقطة صغيرة موثَّقة وليست خطر تعارض حقيقي: أعمدة معلوماتية إضافية
// مثل gateExitApprovedById/At تُكتب على tickets دائمًا (لا مقابل لها بجدول
// ticket_items)، فقد تُستبدَل بمعلومات آخر بند اعتُمد له خروج إن نشط أكثر من
// سجل معًا — لا تتضرر البيانات (كل سجل يحمل نفس الحقول على نفسه أصلًا بجدول
// external_maintenance_jobs، وهو المصدر الموثوق)، فقط عرض ثانوي بمستوى البلاغ.
//
// approveExternalMaintenanceGateEntry وreceiveExternalMaintenanceAsset لا
// تكتبان قيمة جديدة على tickets.status أصلًا (الحالة تبقى out_for_repair
// بلا تغيير بالمرحلتين) — فلا تعارض حقيقي هناك يستدعي تعميمًا مماثلًا.
export async function approveExternalMaintenanceGateExit(input: {
  jobId: number;
  gateUserId: number;
  carrierName: string;
  notes?: string;
}) {
  return withTransaction(async (tx) => {
    await assertExternalActor(tx, input.gateUserId, ["gate_security", "admin", "owner"]);
    const [observed] = await tx.select().from(externalMaintenanceJobs)
      .where(eq(externalMaintenanceJobs.id, input.jobId)).limit(1);
    if (!observed) throw new Error("EXTERNAL_JOB_NOT_FOUND");
    if (!observed.delegateId) throw new Error("EXTERNAL_JOB_DELEGATE_REQUIRED");
    await assertExternalActor(tx, Number(observed.delegateId), ["delegate"]);
    const { ticket, item } = await lockExternalSource(tx, Number(observed.ticketId), observed.ticketItemId == null ? null : Number(observed.ticketItemId));
    const [job] = await tx.select().from(externalMaintenanceJobs)
      .where(eq(externalMaintenanceJobs.id, input.jobId)).limit(1).for("update");
    if (!job) throw new Error("EXTERNAL_JOB_NOT_FOUND");
    if (job.ticketId !== observed.ticketId || job.ticketItemId !== observed.ticketItemId || job.delegateId !== observed.delegateId
      || job.status !== "waiting_gate_exit" || job.purchaseOrderId != null || job.gateExitApprovedAt) throw new Error("EXTERNAL_JOB_INVALID_EXIT_STAGE");
    if (!hasCurrentExternalDelegateReceipt(job)) throw new Error("EXTERNAL_DELEGATE_RECEIPT_REQUIRED");

    // ⚠️ المرحلة 6 التكميلية (2026-08-10): يفحص حالة *البند* لا البلاغ عند
    // توفر ticketItemId — يسمح بتعدد سجلات صيانة خارجية نشطة معًا بنفس البلاغ
    // (بند لكل سجل) دون أن يتعارض فحص المسار/الحالة بينها. راجع القاعدة
    // الحرجة #12 بـCLAUDE.md.
    const relevantPath = item ? item.maintenancePath : ticket.maintenancePath;
    const relevantStatus = item ? item.status : ticket.status;
    if (relevantPath !== "C" || relevantStatus !== "work_approved") {
      throw new Error("EXTERNAL_TICKET_INVALID_EXIT_STAGE");
    }

    // Do not reserve a PR number for an unaccepted/stale preparation. The job
    // and parent locks make a concurrent/repeated gate approval a single PO.
    const poNumber = await getNextPONumber();

    const poResult = await tx.insert(purchaseOrders).values({
      poNumber,
      ticketId: ticket.id,
      ticketItemId: job.ticketItemId ?? undefined,
      requestedById: job.warehousePreparedById || input.gateUserId,
      status: "pending_estimate",
      notes: `صيانة خارجية للأصل: ${job.assetName || ticket.title}`,
      submittedAt: new Date(),
    } as any);
    const purchaseOrderId = Number(poResult[0].insertId);

    await tx.insert(purchaseOrderItems).values({
      purchaseOrderId,
      itemName: job.purchaseTitle,
      description: job.assetBeforeCondition || ticket.description || undefined,
      quantity: 1,
      unit: "خدمة",
      photoUrl: job.assetBeforePhotoUrl || ticket.beforePhotoUrl || undefined,
      notes: job.warehouseNotes || undefined,
      delegateId: job.delegateId,
      status: "pending",
    } as any);

    const now = new Date();
    const [written] = await tx.update(externalMaintenanceJobs).set({
      status: "purchase_cycle",
      gateExitApprovedById: input.gateUserId,
      gateExitApprovedAt: now,
      gateExitCarrierName: input.carrierName,
      gateExitNotes: input.notes,
      purchaseOrderId,
    } as any).where(and(eq(externalMaintenanceJobs.id, job.id), eq(externalMaintenanceJobs.status, "waiting_gate_exit"),
      eq(externalMaintenanceJobs.delegateId, Number(job.delegateId)), eq(externalMaintenanceJobs.preparationRevision, Number(job.preparationRevision)),
      eq(externalMaintenanceJobs.delegateReceiptStatus, "accepted"), isNull(externalMaintenanceJobs.purchaseOrderId), isNull(externalMaintenanceJobs.gateExitApprovedAt)));
    if (Number(written?.affectedRows) !== 1) throw new Error("EXTERNAL_JOB_INVALID_EXIT_STAGE");

    // ⚠️ المرحلة 6 التكميلية: تحديث حالة البند تحديدًا. توافق رجعي — البند
    // الأول (أو غياب item، أي بلاغ قديم بلا بنود) يعكس التحديث على tickets
    // أيضًا، نفس مبدأ approveWorkForItem (الخطوة 3).
    if (item && item.itemNumber !== 1) {
      await tx.update(ticketItems).set({ status: "out_for_repair" } as any)
        .where(eq(ticketItems.id, item.id));
    } else {
      if (item) {
        await tx.update(ticketItems).set({ status: "out_for_repair" } as any)
          .where(eq(ticketItems.id, item.id));
      }
      await tx.update(tickets).set({
        status: "out_for_repair",
        gateExitApprovedById: input.gateUserId,
        gateExitApprovedAt: now,
      } as any).where(eq(tickets.id, ticket.id));
    }

    await tx.insert(ticketStatusHistory).values({
      ticketId: ticket.id,
      fromStatus: relevantStatus,
      toStatus: "out_for_repair",
      changedById: input.gateUserId,
      notes: `وافقت الحراسة على خروج الأصل${item ? ` (بند ${item.itemNumber})` : ""}. حامل الأصل: ${input.carrierName}. تم إنشاء دورة الصيانة الخارجية ${poNumber}`,
    } as any);

    return { job, ticket, purchaseOrderId, poNumber };
  });
}

export async function approveExternalMaintenanceGateEntry(input: {
  jobId: number;
  gateUserId: number;
  carrierName: string;
  notes?: string;
}) {
  return withTransaction(async (tx) => {
    const rows = await tx.select().from(externalMaintenanceJobs)
      .where(eq(externalMaintenanceJobs.id, input.jobId)).limit(1);
    const job = rows[0];
    if (!job) throw new Error("EXTERNAL_JOB_NOT_FOUND");
    if (job.status !== "waiting_gate_entry") throw new Error("EXTERNAL_JOB_INVALID_ENTRY_STAGE");

    const now = new Date();
    await tx.update(externalMaintenanceJobs).set({
      status: "waiting_warehouse_receipt",
      gateEntryApprovedById: input.gateUserId,
      gateEntryApprovedAt: now,
      gateEntryCarrierName: input.carrierName,
      gateEntryNotes: input.notes,
    } as any).where(eq(externalMaintenanceJobs.id, job.id));

    await tx.update(tickets).set({
      gateEntryApprovedById: input.gateUserId,
      gateEntryApprovedAt: now,
    } as any).where(eq(tickets.id, job.ticketId));

    await tx.insert(ticketStatusHistory).values({
      ticketId: job.ticketId,
      fromStatus: "out_for_repair",
      toStatus: "out_for_repair",
      changedById: input.gateUserId,
      notes: `وافقت الحراسة على دخول الأصل بعد الصيانة الخارجية. معيد الأصل: ${input.carrierName}`,
    } as any);

    return job;
  });
}

export async function receiveExternalMaintenanceAsset(input: {
  jobId: number;
  warehouseUserId: number;
  assetAfterReturnPhotoUrl: string;
  returnCondition: string;
  workshopReportUrl?: string;
  notes?: string;
}) {
  return withTransaction(async (tx) => {
    const rows = await tx.select().from(externalMaintenanceJobs)
      .where(eq(externalMaintenanceJobs.id, input.jobId)).limit(1);
    const job = rows[0];
    if (!job) throw new Error("EXTERNAL_JOB_NOT_FOUND");
    if (job.status !== "waiting_warehouse_receipt") throw new Error("EXTERNAL_JOB_INVALID_RECEIPT_STAGE");
    const returnDocumentNumber = documentNumber("RET", job.id);
    const now = new Date();
    await tx.update(externalMaintenanceJobs).set({
      status: "waiting_technician_handover",
      warehouseReceivedById: input.warehouseUserId,
      warehouseReceivedAt: now,
      assetAfterReturnPhotoUrl: input.assetAfterReturnPhotoUrl,
      returnCondition: input.returnCondition,
      workshopReportUrl: input.workshopReportUrl,
      warehouseReturnNotes: input.notes,
      returnDocumentNumber,
    } as any).where(eq(externalMaintenanceJobs.id, job.id));

    // الصيانة الخارجية تستخدم نفس دلالة دورة B بعد العودة: استلام المستودع
    // ثم تسليم الأصل للمسؤول. لا يظهر بند الخدمة في شاشة استلام البضائع العامة.
    if (job.purchaseOrderId) {
      await tx.update(purchaseOrderItems).set({
        status: "delivered_to_warehouse",
        receivedAt: now,
        receivedById: input.warehouseUserId,
        receivedQuantity: 1,
        warehousePhotoUrl: input.assetAfterReturnPhotoUrl,
      } as any).where(eq(purchaseOrderItems.purchaseOrderId, job.purchaseOrderId));
      await tx.update(purchaseOrders).set({ status: "received" } as any)
        .where(eq(purchaseOrders.id, job.purchaseOrderId));
    }

    await tx.insert(ticketStatusHistory).values({
      ticketId: job.ticketId,
      fromStatus: "out_for_repair",
      toStatus: "out_for_repair",
      changedById: input.warehouseUserId,
      notes: `استلم المستودع الأصل العائد من الصيانة الخارجية وأصدر الوثيقة ${returnDocumentNumber}`,
    } as any);
    return { job, returnDocumentNumber };
  });
}

export async function handoverExternalMaintenanceAsset(input: {
  jobId: number;
  warehouseUserId: number;
  actualRecipientId: number;
  notes?: string;
}, existingTx?: any) {
  const executeHandover = async (tx: any) => {
    await tx.execute(sql`SELECT id FROM external_maintenance_jobs WHERE id=${input.jobId} FOR UPDATE`);
    const rows = await tx.select().from(externalMaintenanceJobs)
      .where(eq(externalMaintenanceJobs.id, input.jobId)).limit(1);
    const job = rows[0];
    if (!job) throw new Error("EXTERNAL_JOB_NOT_FOUND");
    if (job.status !== "waiting_technician_handover") throw new Error("EXTERNAL_JOB_INVALID_HANDOVER_STAGE");

    const ticketRows = await tx.select().from(tickets)
      .where(eq(tickets.id, job.ticketId)).limit(1);
    const ticket = ticketRows[0];

    // ⚠️ المرحلة 6 التكميلية (2026-08-10): فني *البند* تحديدًا لا فني رأس
    // البلاغ (قد يختلفان بالفرز المتعدد — بند ثانوي بمسؤول مختلف عن الجهة
    // الرئيسية). كانت هذه الثغرة موثَّقة عند الخطوة 5 ولم تُعالَج حينها.
    const itemRows = job.ticketItemId
      ? await tx.select().from(ticketItems).where(eq(ticketItems.id, job.ticketItemId)).limit(1)
      : [];
    const item = itemRows[0];
    let assignedTechnicianId = item?.assignedToId ?? ticket?.assignedToId;
    // Team tickets keep their independent assignment. A real recipient must be an active team technician.
    if (ticket?.workflowModel === "sub_ticket" && item) {
      const [teamRows] = await tx.execute(sql`SELECT a.id,a.teamId FROM ticket_team_assignments a WHERE a.ticketId=${ticket.id} AND a.ticketItemId=${item.id} FOR UPDATE`);
      if (teamRows.length) {
        const [members] = await tx.execute(sql`SELECT u.id FROM maintenance_team_members m INNER JOIN maintenance_teams t ON t.id=m.teamId INNER JOIN users u ON u.id=m.userId WHERE m.teamId=${Number(teamRows[0].teamId)} AND m.userId=${input.actualRecipientId} AND m.isActive=1 AND t.isActive=1 AND u.isActive=1 AND u.role='technician' FOR UPDATE`);
        if (!members.length) throw new Error("المستلم الفعلي يجب أن يكون فنيًا نشطًا في فريق البلاغ");
        assignedTechnicianId = input.actualRecipientId;
      }
    }
    if (!assignedTechnicianId) throw new Error("EXTERNAL_TICKET_ASSIGNED_TECHNICIAN_REQUIRED");

    const handoverDocumentNumber = documentNumber("HND", job.id);
    const now = new Date();
    await tx.update(externalMaintenanceJobs).set({
      status: "delivered_for_reinstall",
      assignedTechnicianId,
      actualRecipientId: input.actualRecipientId,
      handoverById: input.warehouseUserId,
      handoverAt: now,
      handoverNotes: input.notes,
      handoverDocumentNumber,
    } as any).where(eq(externalMaintenanceJobs.id, job.id));

    if (job.purchaseOrderId) {
      await tx.update(purchaseOrderItems).set({
        status: "delivered_to_requester",
        deliveredAt: now,
        deliveredById: input.warehouseUserId,
        deliveredToId: input.actualRecipientId,
        deliveredQuantity: 1,
      } as any).where(eq(purchaseOrderItems.purchaseOrderId, job.purchaseOrderId));
    }

    // ⚠️ نفس مبدأ approveExternalMaintenanceGateExit: تحديث حالة البند
    // تحديدًا، مع توافق رجعي (البند الأول يعكس على tickets أيضًا).
    if (item && item.itemNumber !== 1) {
      await tx.update(ticketItems).set({ status: "received_warehouse" } as any)
        .where(eq(ticketItems.id, item.id));
    } else {
      if (item) {
        await tx.update(ticketItems).set({ status: "received_warehouse" } as any)
          .where(eq(ticketItems.id, item.id));
      }
      if (ticket) {
        await tx.update(tickets).set({ status: "received_warehouse" } as any)
          .where(eq(tickets.id, ticket.id));
      }
    }

    await tx.insert(ticketStatusHistory).values({
      ticketId: job.ticketId,
      fromStatus: ticket?.status,
      toStatus: "received_warehouse",
      changedById: input.warehouseUserId,
      notes: `استلم المستودع الأصل العائد ثم سلّمه للمسؤول لإعادة تركيبه في موقعه${item ? ` (بند ${item.itemNumber})` : ""}`,
    } as any);

    return { job, ticket, handoverDocumentNumber };
  };
  return existingTx ? executeHandover(existingTx) : withTransaction(executeHandover);
}

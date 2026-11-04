import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { router, protectedProcedure } from "../_shared/procedures";
import * as db from "../../_core/db";
import { assertCanAccessAttachments } from "./attachments.access";
import { APP_ROLE, isDelegateRole } from "@shared/roles";
import { catalogAuditRequestMeta } from "../../_core/catalog-audit";
import { documentListPageInput } from "@shared/document-list";
import { decorateDocumentRows } from "../../_core/authz/document-list";
import { getAttachmentDocumentPage, loadDocumentListPort } from "../../_core/db/document-list";

async function documentRows(user: { id: number; role: string }, rows: any[]) {
  if (!rows.length) return [];
  return decorateDocumentRows(user, rows, await loadDocumentListPort(rows, undefined, { actor: user }));
}

export const attachmentsRouter = router({
  /**
   * قائمة مجمَّعة لكل مرفقات نوع بعينه — لعرض "الوثائق المالية المعتمدة"
   * بمركز المستندات (2026-08-10). **مقيَّد صراحةً** بأدوار مالية (لا يستخدم
   * assertCanAccessAttachments العام لأن هذا استعلام مجمَّع بلا entityId
   * واحد يمكن فحص ملكيته — القيد هنا على مستوى الدور مباشرة).
   */
  listByType: protectedProcedure.input(z.object({
    entityType: z.enum(["po_financial_batch", "delegate_pricing_documents"]),
    pagination: documentListPageInput.optional(),
  })).query(async ({ input, ctx }) => {
    if (input.entityType === "delegate_pricing_documents") {
      // المندوب يرى مستنداته فقط؛ الحسابات والإدارة تراجعان البيانات هنا،
      // ولا تعاد مفاتيح/PDF إلا بعد اعتماد المستخدم نفسه للنطاق المحدد.
      const allowedRoles = [APP_ROLE.DELEGATE, APP_ROLE.DELEGATE_MANAGER, APP_ROLE.OWNER, APP_ROLE.ADMIN, APP_ROLE.ACCOUNTANT, APP_ROLE.SENIOR_MANAGEMENT];
      if (!allowedRoles.includes(ctx.user.role as any)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "ليس لديك صلاحية للاطلاع على وثائق تسعير المندوبين" });
      }

      if (input.pagination) {
        const result = await getAttachmentDocumentPage(input.entityType, input.pagination,
          isDelegateRole(ctx.user.role) ? ctx.user.id : undefined);
        return { ...result, rows: await documentRows(ctx.user, result.rows) };
      }

      const rows = await db.getDelegatePricingAttachmentsWithDelegate();
      if (isDelegateRole(ctx.user.role)) {
        return documentRows(ctx.user, rows.filter((row: any) => Number(row.delegateId) === Number(ctx.user.id)));
      }
      return documentRows(ctx.user, rows);
    }

    // نطاق الأدوار المالية باقٍ، وإتاحة الملف تخضع لاعتماد كل مستخدم لدوره.
    const financialRoles = [APP_ROLE.ACCOUNTANT, APP_ROLE.SENIOR_MANAGEMENT, APP_ROLE.OWNER, APP_ROLE.ADMIN];
    if (!financialRoles.includes(ctx.user.role as any)) {
      throw new TRPCError({ code: "FORBIDDEN", message: "ليس لديك صلاحية للاطلاع على الوثائق المالية" });
    }
    if (input.pagination) {
      const result = await getAttachmentDocumentPage(input.entityType, input.pagination, undefined, undefined, ctx.user.role);
      return { ...result, rows: await documentRows(ctx.user, result.rows) };
    }
    return documentRows(ctx.user, await db.getFinancialBatchAttachmentsWithDelegate(ctx.user.role));
  }),

  list: protectedProcedure.input(z.object({
    entityType: z.string(),
    entityId: z.number(),
  })).query(async ({ input, ctx }) => {
    // ✅ إصلاح IDOR: كان أي مستخدم مسجّل دخول يقدر يستعرض مرفقات أي كيان
    // بتخمين الرقم، بدون أي تحقق من علاقته به.
    await assertCanAccessAttachments(ctx.user, input.entityType, input.entityId);
    return db.getAttachments(input.entityType, input.entityId);
  }),

  add: protectedProcedure.input(z.object({
    entityType: z.string(),
    entityId: z.number(),
    fileName: z.string(),
    fileUrl: z.string(),
    fileKey: z.string(),
    mimeType: z.string().optional(),
    fileSize: z.number().optional(),
  })).mutation(async ({ input, ctx }) => {
    // ✅ إصلاح IDOR: نفس الفحص المطبَّق بـlist — يمنع رفع مرفقات لكيان لا
    // يملك المستخدم صلاحية الوصول إليه، أو لنوع كيان غير مدعوم أصلًا.
    await assertCanAccessAttachments(ctx.user, input.entityType, input.entityId, "write");
    if (input.entityType === "pmv2_item_action") {
      const imageName = /\.(jpe?g|png|webp|gif|heic|heif|bmp|tiff?)$/i.test(input.fileName);
      const imageMime = Boolean(input.mimeType?.toLowerCase().startsWith("image/"));
      if (!imageName && !imageMime) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "دليل PM V2 في هذه الخطوة يجب أن يكون صورة" });
      }
    }
    const id = await db.createAttachment({
      entityType: input.entityType,
      entityId: input.entityId,
      fileName: input.fileName,
      fileUrl: input.fileUrl,
      fileKey: input.fileKey,
      mimeType: input.mimeType || null,
      fileSize: input.fileSize || null,
      uploadedById: ctx.user.id,
    });
    await db.createAuditLog({
      userId: ctx.user.id,
      action: "add_attachment",
      entityType: input.entityType,
      entityId: input.entityId,
      newValues: {
        attachmentId: id,
        fileName: input.fileName,
        fileKey: input.fileKey,
        mimeType: input.mimeType || null,
        fileSize: input.fileSize || null,
      },
      ...(input.entityType === "catalog_item" ? catalogAuditRequestMeta(ctx) : {}),
    });
    return { id };
  }),

  delete: protectedProcedure.input(z.object({ id: z.number() })).mutation(async ({ input, ctx }) => {
    const attachment = await db.getAttachmentById(input.id);
    if (!attachment) throw new TRPCError({ code: "NOT_FOUND", message: "المرفق غير موجود" });
    // Verify entity access first, then allow the matching manager role or uploader.
    await assertCanAccessAttachments(ctx.user, attachment.entityType, attachment.entityId, "write");
    const managerRoles = attachment.entityType === "catalog_item"
      ? ["owner", "admin", "maintenance_manager", "general_maintenance_manager", "construction_procurement_manager", "warehouse"]
      : ["owner", "admin", "maintenance_manager", "general_maintenance_manager", "construction_procurement_manager"];
    const canDelete = managerRoles.includes(ctx.user.role) || attachment.uploadedById === ctx.user.id;
    if (!canDelete) throw new TRPCError({ code: "FORBIDDEN", message: "ليس لديك صلاحية لحذف هذا المرفق" });
    await db.deleteAttachment(input.id);
    await db.createAuditLog({
      userId: ctx.user.id,
      action: "delete_attachment",
      entityType: attachment.entityType,
      entityId: attachment.entityId,
      oldValues: {
        attachmentId: attachment.id,
        fileName: attachment.fileName,
        fileKey: attachment.fileKey,
        mimeType: attachment.mimeType,
        fileSize: attachment.fileSize,
      },
      ...(attachment.entityType === "catalog_item" ? catalogAuditRequestMeta(ctx) : {}),
    });
    return { success: true };
  }),
});

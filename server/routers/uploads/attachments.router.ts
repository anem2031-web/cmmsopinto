import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { router, protectedProcedure } from "../_shared/procedures";
import * as db from "../../_core/db";

export const attachmentsRouter = router({
  list: protectedProcedure.input(z.object({
    entityType: z.string(),
    entityId: z.number(),
  })).query(async ({ input }) => {
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
      newValues: { fileName: input.fileName, mimeType: input.mimeType },
    });
    return { id };
  }),

  delete: protectedProcedure.input(z.object({ id: z.number() })).mutation(async ({ input, ctx }) => {
    const attachment = await db.getAttachmentById(input.id);
    if (!attachment) throw new TRPCError({ code: "NOT_FOUND", message: "المرفق غير موجود" });
    // Only owner/admin/manager or the uploader can delete
    const canDelete = ["owner", "admin", "maintenance_manager"].includes(ctx.user.role) || attachment.uploadedById === ctx.user.id;
    if (!canDelete) throw new TRPCError({ code: "FORBIDDEN", message: "ليس لديك صلاحية لحذف هذا المرفق" });
    await db.deleteAttachment(input.id);
    await db.createAuditLog({
      userId: ctx.user.id,
      action: "delete_attachment",
      entityType: attachment.entityType,
      entityId: attachment.entityId,
      oldValues: { fileName: attachment.fileName, mimeType: attachment.mimeType },
    });
    return { success: true };
  }),
});

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { router, protectedProcedure, managerProcedure } from "../_shared/procedures";
import * as db from "../../_core/db";

export const backupsRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    if (!["owner", "admin"].includes(ctx.user.role)) throw new TRPCError({ code: "FORBIDDEN", message: "ليس لديك صلاحية" });
    return db.getBackups();
  }),

  create: protectedProcedure.input(z.object({
    description: z.string().optional(),
  }).optional()).mutation(async ({ input, ctx }) => {
    if (!["owner", "admin"].includes(ctx.user.role)) throw new TRPCError({ code: "FORBIDDEN", message: "ليس لديك صلاحية" });
    
    // Export all data
    const exportResult = await db.exportAllTablesData();
    if (!exportResult) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "فشل تصدير البيانات" });

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupName = `backup-${timestamp}`;
    const jsonData = JSON.stringify(exportResult.data, null, 2);
    const buffer = Buffer.from(jsonData, "utf-8");
    
    // Upload to S3
    const fileKey = `cmms/backups/${backupName}.json`;
    const { url } = await storagePut(fileKey, buffer, "application/json");

    // Save backup record
    const id = await db.createBackup({
      name: backupName,
      description: input?.description || `نسخة احتياطية - ${new Date().toLocaleDateString("ar-SA")}`,
      fileUrl: url,
      fileKey,
      fileSize: buffer.length,
      tablesCount: exportResult.tablesCount,
      recordsCount: exportResult.recordsCount,
      createdById: ctx.user.id,
    });

    await db.createAuditLog({
      userId: ctx.user.id,
      action: "create_backup",
      entityType: "backup",
      entityId: id!,
      newValues: { name: backupName, tablesCount: exportResult.tablesCount, recordsCount: exportResult.recordsCount },
    });

    return { id, name: backupName, tablesCount: exportResult.tablesCount, recordsCount: exportResult.recordsCount, fileUrl: url };
  }),

  restore: protectedProcedure.input(z.object({
    id: z.number(),
  })).mutation(async ({ input, ctx }) => {
    if (!["owner", "admin"].includes(ctx.user.role)) throw new TRPCError({ code: "FORBIDDEN", message: "ليس لديك صلاحية" });
    
    const backup = await db.getBackupById(input.id);
    if (!backup) throw new TRPCError({ code: "NOT_FOUND", message: "النسخة الاحتياطية غير موجودة" });

    // Download backup file
    const response = await fetch(backup.fileUrl);
    if (!response.ok) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "فشل تحميل ملف النسخة الاحتياطية" });
    const backupData = await response.json();

    // Restore data
    await db.restoreFromBackup(backupData);

    await db.createAuditLog({
      userId: ctx.user.id,
      action: "restore_backup",
      entityType: "backup",
      entityId: input.id,
      newValues: { name: backup.name, restoredAt: new Date().toISOString() },
    });

    return { success: true, name: backup.name };
  }),

  delete: protectedProcedure.input(z.object({ id: z.number() })).mutation(async ({ input, ctx }) => {
    if (!["owner", "admin"].includes(ctx.user.role)) throw new TRPCError({ code: "FORBIDDEN", message: "ليس لديك صلاحية" });
    const backup = await db.getBackupById(input.id);
    if (!backup) throw new TRPCError({ code: "NOT_FOUND", message: "النسخة الاحتياطية غير موجودة" });
    await db.deleteBackup(input.id);
    await db.createAuditLog({
      userId: ctx.user.id,
      action: "delete_backup",
      entityType: "backup",
      entityId: input.id,
      oldValues: { name: backup.name },
    });
    return { success: true };
  }),
});

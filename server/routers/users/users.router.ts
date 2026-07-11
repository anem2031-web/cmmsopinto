import { TRPCError } from "@trpc/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { router, protectedProcedure } from "../_shared/procedures";
import * as db from "../../db";
import { cacheManager, cacheKeys, invalidateCache } from "../../_core/cache";

export const usersRouter = router({
  list: protectedProcedure.query(async () => {
    return cacheManager.getOrCompute(
      cacheKeys.users(),
      () => db.getAllUsers(),
      600 // 10 minutes
    );
  }),

  byRole: protectedProcedure.input(z.object({ role: z.string() })).query(async ({ input }) => {
    return cacheManager.getOrCompute(
      cacheKeys.usersByRole(input.role),
      () => db.getUsersByRole(input.role),
      600 // 10 minutes
    );
  }),

  updateRole: protectedProcedure.input(z.object({ userId: z.number(), role: z.string() })).mutation(async ({ input, ctx }) => {
    if (ctx.user.role !== "owner" && ctx.user.role !== "admin") {
      throw new TRPCError({ code: "FORBIDDEN", message: "فقط المالك يمكنه تغيير الأدوار" });
    }
    const oldUser = await db.getUserById(input.userId);
    await db.updateUserRole(input.userId, input.role);
    await db.createAuditLog({ userId: ctx.user.id, action: "update_role", entityType: "user", entityId: input.userId, oldValues: { role: oldUser?.role }, newValues: { role: input.role } });
    // Invalidate user cache
    invalidateCache.users();
    return { success: true };
  }),

  update: protectedProcedure.input(z.object({
    id: z.number(),
    name: z.string().optional(),
    email: z.string().optional(),
    role: z.string().optional(),
    phone: z.string().optional(),
    department: z.string().optional(),
  })).mutation(async ({ input, ctx }) => {
    if (ctx.user.role !== "owner" && ctx.user.role !== "admin") {
      throw new TRPCError({ code: "FORBIDDEN", message: "فقط المالك يمكنه تعديل المستخدمين" });
    }
    const oldUser = await db.getUserById(input.id);
    if (!oldUser) throw new TRPCError({ code: "NOT_FOUND", message: "المستخدم غير موجود" });
    const { id, ...updateData } = input;
    await db.updateUser(id, updateData);
    await db.createAuditLog({ userId: ctx.user.id, action: "update_user", entityType: "user", entityId: id, oldValues: { name: oldUser.name, email: oldUser.email, role: oldUser.role }, newValues: updateData });
    invalidateCache.users();
    return { success: true };
  }),

  create: protectedProcedure.input(z.object({
    username: z.string().min(2),
    password: z.string().min(8, "كلمة المرور يجب أن تكون 8 أحرف على الأقل").regex(/(?=.*[A-Z])(?=.*\d)/, "يجب أن تحتوي على حرف كبير ورقم واد على الأقل"),
    name: z.string().min(1),
    role: z.string(),
    email: z.string().optional(),
    phone: z.string().optional(),
    department: z.string().optional(),
  })).mutation(async ({ input, ctx }) => {
    // دور "مستودع" مسموح له بالإضافة فقط (بدون تعديل/حذف/تغيير أدوار — مقيّدة بباقي الدوال أدناه)
    if (ctx.user.role !== "owner" && ctx.user.role !== "admin" && ctx.user.role !== "warehouse") {
      throw new TRPCError({ code: "FORBIDDEN", message: "ليس لديك صلاحية إنشاء مستخدمين" });
    }
    const existing = await db.getUserByUsername(input.username);
    if (existing) throw new TRPCError({ code: "CONFLICT", message: "اسم المستخدم موجود مسبقاً" });
    const hash = await bcrypt.hash(input.password, 10);
    const id = await db.createLocalUser({ ...input, passwordHash: hash });
    await db.createAuditLog({ userId: ctx.user.id, action: "create_user", entityType: "user", entityId: id!, newValues: { username: input.username, name: input.name, role: input.role } });
    invalidateCache.users();
    return { success: true, id };
  }),

  resetPassword: protectedProcedure.input(z.object({
    userId: z.number(),
    newPassword: z.string().min(8, "كلمة المرور يجب أن تكون 8 أحرف على الأقل").regex(/(?=.*[A-Z])(?=.*\d)/, "يجب أن تحتوي على حرف كبير ورقم واحد على الأقل"),
  })).mutation(async ({ input, ctx }) => {
    if (ctx.user.role !== "owner" && ctx.user.role !== "admin") {
      throw new TRPCError({ code: "FORBIDDEN", message: "ليس لديك صلاحية" });
    }
    const hash = await bcrypt.hash(input.newPassword, 10);
    await db.updateUserPassword(input.userId, hash);
    await db.createAuditLog({ userId: ctx.user.id, action: "reset_password", entityType: "user", entityId: input.userId });
    return { success: true };
  }),

  delete: protectedProcedure.input(z.object({
    id: z.number(),
    confirmPassword: z.string().min(1, "كلمة المرور مطلوبة للتأكيد"),
  })).mutation(async ({ input, ctx }) => {
    if (ctx.user.role !== "owner" && ctx.user.role !== "admin") {
      throw new TRPCError({ code: "FORBIDDEN", message: "فقط المالك يمكنه حذف المستخدمين" });
    }
    // التحقق من كلمة مرور المدير
    if (!ctx.user.passwordHash) {
      throw new TRPCError({ code: "FORBIDDEN", message: "لا يمكن التحقق من هويتك (حساب OAuth)" });
    }
    const validPassword = await bcrypt.compare(input.confirmPassword, ctx.user.passwordHash);
    if (!validPassword) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: "كلمة المرور غير صحيحة" });
    }
    const user = await db.getUserById(input.id);
    if (!user) throw new TRPCError({ code: "NOT_FOUND", message: "المستخدم غير موجود" });
    if (user.role === "owner") throw new TRPCError({ code: "FORBIDDEN", message: "لا يمكن حذف المالك" });
    await db.deleteUser(input.id);
    await db.createAuditLog({ userId: ctx.user.id, action: "delete_user", entityType: "user", entityId: input.id, oldValues: { name: user.name, email: user.email, role: user.role } });
    invalidateCache.users();
    return { success: true };
  }),

  toggleActive: protectedProcedure.input(z.object({
    id: z.number(),
    isActive: z.boolean(),
  })).mutation(async ({ input, ctx }) => {
    if (ctx.user.role !== "owner" && ctx.user.role !== "admin") {
      throw new TRPCError({ code: "FORBIDDEN", message: "فقط المالك يمكنه تعطيل/تفعيل المستخدمين" });
    }
    const user = await db.getUserById(input.id);
    if (!user) throw new TRPCError({ code: "NOT_FOUND", message: "المستخدم غير موجود" });
    if (user.role === "owner") throw new TRPCError({ code: "FORBIDDEN", message: "لا يمكن تعطيل المالك" });
    await db.toggleUserActive(input.id, input.isActive);
    await db.createAuditLog({ userId: ctx.user.id, action: input.isActive ? "activate_user" : "deactivate_user", entityType: "user", entityId: input.id });
    invalidateCache.users();
    return { success: true };
  }),

  listTechnicians: protectedProcedure.query(async () => {
    return cacheManager.getOrCompute(
      cacheKeys.usersByRole("technician"),
      () => db.getUsersByRole("technician"),
      600 // 10 minutes
    );
  }),

  updateSpecialty: protectedProcedure.input(z.object({
    userId: z.number(),
    specialty: z.string().optional(),
    specialtyEn: z.string().optional(),
    specialtyUr: z.string().optional(),
  })).mutation(async ({ input, ctx }) => {
    if (ctx.user.role !== "owner" && ctx.user.role !== "admin") {
      throw new TRPCError({ code: "FORBIDDEN", message: "فقط المالك يمكنه تعديل التخصص" });
    }
    const { userId, ...specialtyData } = input;
    await db.updateUser(userId, specialtyData);
    invalidateCache.users();
    return { success: true };
  }),
});

import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "../../server/_core/cookies";
import { systemRouter } from "../../server/_core/systemRouter";
import { publicProcedure, protectedProcedure, router } from "../../server/_core/trpc";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import * as db from "../../server/_core/db";
import { eq, and, asc, gte, lte } from "drizzle-orm";
import { storagePut, storageRename } from "../../server/_core/storage";
import { notifyOwner } from "../../server/_core/notification";
import { invokeLLM } from "../../server/_core/llm";
import { nanoid } from "nanoid";
import { translationRouter } from "../../server/routers/translation/translation";
import { translateFields, detectLanguage, type SupportedLanguage } from "../../server/services/translation/translation";
import bcrypt from "bcryptjs";
import { cacheManager, cacheKeys, invalidateCache } from "../../server/_core/cache";
import { generateTwoFactorSecret, verifyTwoFactorToken, verifyBackupCode, hashBackupCodes, removeUsedBackupCode, getRemainingBackupCodesCount } from "../../server/_core/twoFactor";
import { rateLimiters } from "../../server/_core/rateLimiter";

// Role-based middleware
const roleMiddleware = (allowedRoles: string[]) => {
  return protectedProcedure.use(({ ctx, next }) => {
    if (!allowedRoles.includes(ctx.user.role) && ctx.user.role !== "admin" && ctx.user.role !== "owner") {
      throw new TRPCError({ code: "FORBIDDEN", message: "ليس لديك صلاحية لهذا الإجراء" });
    }
    return next({ ctx });
  });
};

const managerProcedure = roleMiddleware(["maintenance_manager", "purchase_manager", "owner", "admin"]);
const supervisorProcedure = roleMiddleware(["supervisor", "maintenance_manager", "owner", "admin"]);
const gateSecurityProcedure = roleMiddleware(["gate_security", "owner", "admin"]);
const accountantProcedure = roleMiddleware(["accountant", "owner", "admin"]);
const managementProcedure = roleMiddleware(["senior_management", "owner", "admin"]);
const warehouseProcedure = roleMiddleware(["warehouse", "owner", "admin"]);
const delegateProcedure = roleMiddleware(["delegate", "owner", "admin"]);

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
    login: publicProcedure.input(z.object({
      username: z.string().min(1),
      password: z.string().min(8, "كلمة المرور يجب أن تكون 8 أحرف على الأقل"),
    })).mutation(async ({ input, ctx }) => {
      const user = await db.getUserByUsername(input.username);
      if (!user || !user.passwordHash) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "اسم المستخدم أو كلمة المرور غير صحيحة" });
      }
      if (!user.isActive) {
        throw new TRPCError({ code: "FORBIDDEN", message: "الحساب معطل" });
      }
      const valid = await bcrypt.compare(input.password, user.passwordHash);
      if (!valid) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "اسم المستخدم أو كلمة المرور غير صحيحة" });
      }
      // Create session
      const { sdk } = await import("../../server/_core/sdk");
      const sessionToken = await sdk.createSessionToken(user.openId, { name: user.name || user.username || "", expiresInMs: 1000 * 60 * 60 * 24 * 365 });
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: 1000 * 60 * 60 * 24 * 365 });
      // Update last signed in
      await db.upsertUser({ openId: user.openId, lastSignedIn: new Date() });
      // Get 2FA enforcement status
      const twoFactorSecret = await db.getTwoFactorSecret(user.id);
      const { getTwoFactorEnforcementStatus } = await import("../../server/_core/twoFactorEnforcement");
      const twoFactorEnforcementStatus = getTwoFactorEnforcementStatus(user, twoFactorSecret?.isEnabled || false);
      
      return {
        success: true,
        user: { id: user.id, name: user.name, role: user.role, username: user.username },
        twoFactorEnforcementStatus
      };
    }),
    changePassword: protectedProcedure.input(z.object({
      currentPassword: z.string().optional(),
      newPassword: z.string().min(8, "كلمة المرور يجب أن تكون 8 أحرف على الأقل").regex(/(?=.*[A-Z])(?=.*\d)/, "يجب أن تحتوي على حرف كبير ورقم واحد على الأقل"),
    })).mutation(async ({ input, ctx }) => {
      // Admin can change any user's password without current password
      if (ctx.user.passwordHash && input.currentPassword) {
        const valid = await bcrypt.compare(input.currentPassword, ctx.user.passwordHash);
        if (!valid) throw new TRPCError({ code: "UNAUTHORIZED", message: "كلمة المرور الحالية غير صحيحة" });
      }
      const hash = await bcrypt.hash(input.newPassword, 10);
      await db.updateUserPassword(ctx.user.id, hash);
      return { success: true };
    }),
  }),

  // ============================================================
  // USERS
  // ============================================================
  users: router({
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
      if (ctx.user.role !== "owner" && ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "فقط المالك يمكنه إنشاء مستخدمين" });
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

    // ── Phase 1: Unified technician query (preparation layer) ────────────────
    // Returns users with role='technician' including specialty fields.
    // ADDITIVE — legacy technicians.list endpoint is NOT removed.
    // Future phases can switch dropdowns to use this endpoint instead.
    listTechnicians: protectedProcedure.query(async () => {
      return cacheManager.getOrCompute(
        cacheKeys.usersByRole("technician"),
        () => db.getUsersByRole("technician"),
        600 // 10 minutes
      );
    }),

    // ── Phase 1: Update specialty fields on a user ───────────────────────
    // Allows setting specialty/trade on users with role='technician'.
    // ADDITIVE — does not affect any existing update logic.
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
  }),

  // ============================================================
  // SITES
  // ============================================================
  sites: router({
    list: protectedProcedure.query(async () => {
      return cacheManager.getOrCompute(
        cacheKeys.sites(),
        () => db.getAllSites(),
        600 // 10 minutes
      );
    }),
    create: protectedProcedure.input(z.object({ name: z.string().min(1), address: z.string().optional(), description: z.string().optional() })).mutation(async ({ input, ctx }) => {
      // Auto-translate name
      let nameEn: string | undefined;
      let nameUr: string | undefined;
      try {
        const translations = await translateFields({ name: input.name });
        nameEn = translations.name?.en;
        nameUr = translations.name?.ur;
      } catch (e) { /* fallback */ }
      const id = await db.createSite({ ...input, nameEn, nameUr });
      await db.createAuditLog({ userId: ctx.user.id, action: "create_site", entityType: "site", entityId: id!, newValues: input });
      // Invalidate sites cache
      invalidateCache.sites();
      return { id };
    }),

    update: protectedProcedure.input(z.object({
      id: z.number(),
      name: z.string().min(1).optional(),
      address: z.string().optional(),
      description: z.string().optional(),
    })).mutation(async ({ input, ctx }) => {
      const oldSite = await db.getSiteById(input.id);
      if (!oldSite) throw new TRPCError({ code: "NOT_FOUND", message: "الموقع غير موجود" });
      const { id, ...updateData } = input;
      // Auto-translate name if changed
      let siteExtraFields: { nameEn?: string; nameUr?: string } = {};
      if (updateData.name) {
        try {
          const translations = await translateFields({ name: updateData.name });
          siteExtraFields.nameEn = translations.name?.en;
          siteExtraFields.nameUr = translations.name?.ur;
        } catch (e) { /* fallback */ }
      }
      await db.updateSite(id, { ...updateData, ...siteExtraFields });
      await db.createAuditLog({ userId: ctx.user.id, action: "update_site", entityType: "site", entityId: id, oldValues: { name: oldSite.name, address: oldSite.address, description: oldSite.description }, newValues: updateData });
      // Invalidate sites cache
      invalidateCache.sites();
      return { success: true };
    }),

    delete: protectedProcedure.input(z.object({ id: z.number() })).mutation(async ({ input, ctx }) => {
      const site = await db.getSiteById(input.id);
      if (!site) throw new TRPCError({ code: "NOT_FOUND", message: "الموقع غير موجود" });
      await db.deleteSite(input.id);
      await db.createAuditLog({ userId: ctx.user.id, action: "delete_site", entityType: "site", entityId: input.id, oldValues: { name: site.name, address: site.address } });
      // Invalidate sites cache
      invalidateCache.sites();
      return { success: true };
    }),
  }),

  // ============================================================
  // SECTIONS
  // ============================================================
  sections: router({
    list: protectedProcedure.input(z.object({ siteId: z.number().optional() }).optional()).query(async ({ input }) => {
      return db.getSections(input?.siteId);
    }),
    create: protectedProcedure.input(z.object({
      name: z.string().min(1),
      siteId: z.number(),
      description: z.string().optional(),
    })).mutation(async ({ input, ctx }) => {
      // Auto-translate name
      let sectionNameEn: string | undefined;
      let sectionNameUr: string | undefined;
      try {
        const translations = await translateFields({ name: input.name });
        sectionNameEn = translations.name?.en;
        sectionNameUr = translations.name?.ur;
      } catch (e) { /* fallback */ }
      const id = await db.createSection({ ...input, nameEn: sectionNameEn, nameUr: sectionNameUr, isActive: true });
      await db.createAuditLog({ userId: ctx.user.id, action: "create_section", entityType: "section", entityId: id!, newValues: input });
      return { id };
    }),
    update: protectedProcedure.input(z.object({
      id: z.number(),
      name: z.string().min(1).optional(),
      description: z.string().optional(),
      isActive: z.boolean().optional(),
    })).mutation(async ({ input, ctx }) => {
      const { id, ...updateData } = input;
      let sectionExtraFields: { nameEn?: string; nameUr?: string } = {};
      if (updateData.name) {
        try {
          const translations = await translateFields({ name: updateData.name });
          sectionExtraFields.nameEn = translations.name?.en;
          sectionExtraFields.nameUr = translations.name?.ur;
        } catch (e) { /* fallback */ }
      }
      await db.updateSection(id, { ...updateData, ...sectionExtraFields });
      await db.createAuditLog({ userId: ctx.user.id, action: "update_section", entityType: "section", entityId: id, newValues: updateData });
      return { success: true };
    }),
    delete: protectedProcedure.input(z.object({ id: z.number() })).mutation(async ({ input, ctx }) => {
      await db.deleteSection(input.id);
      await db.createAuditLog({ userId: ctx.user.id, action: "delete_section", entityType: "section", entityId: input.id });
      return { success: true };
    }),
  }),
  // ============================================================
  // TECHNICIANS
  // ============================================================
  technicians: router({
    list: protectedProcedure.input(z.object({ activeOnly: z.boolean().optional() }).optional()).query(async ({ input }) => {
      return db.getAllTechnicians(input?.activeOnly ?? false);
    }),
    create: protectedProcedure.input(z.object({
      name: z.string().min(1),
      specialty: z.string().optional(),
    })).mutation(async ({ input, ctx }) => {
      // Auto-translate name and specialty
      let techNameEn: string | undefined;
      let techNameUr: string | undefined;
      let techSpecialtyEn: string | undefined;
      let techSpecialtyUr: string | undefined;
      try {
        const fieldsToTranslate: Record<string, string> = { name: input.name };
        if (input.specialty) fieldsToTranslate.specialty = input.specialty;
        const translations = await translateFields(fieldsToTranslate);
        techNameEn = translations.name?.en;
        techNameUr = translations.name?.ur;
        techSpecialtyEn = translations.specialty?.en;
        techSpecialtyUr = translations.specialty?.ur;
      } catch (e) { /* fallback */ }
      const id = await db.createTechnician({ ...input, nameEn: techNameEn, nameUr: techNameUr, specialtyEn: techSpecialtyEn, specialtyUr: techSpecialtyUr });
      await db.createAuditLog({ userId: ctx.user.id, action: "create_technician", entityType: "technician", entityId: id!, newValues: input });
      return { id };
    }),
    update: protectedProcedure.input(z.object({
      id: z.number(),
      name: z.string().min(1).optional(),
      specialty: z.string().optional(),
      status: z.enum(["active", "inactive"]).optional(),
    })).mutation(async ({ input, ctx }) => {
      const { id, ...updateData } = input;
      let techExtraFields: { nameEn?: string; nameUr?: string; specialtyEn?: string; specialtyUr?: string } = {};
      if (updateData.name || updateData.specialty) {
        try {
          const fieldsToTranslate: Record<string, string> = {};
          if (updateData.name) fieldsToTranslate.name = updateData.name;
          if (updateData.specialty) fieldsToTranslate.specialty = updateData.specialty;
          const translations = await translateFields(fieldsToTranslate);
          if (updateData.name) { techExtraFields.nameEn = translations.name?.en; techExtraFields.nameUr = translations.name?.ur; }
          if (updateData.specialty) { techExtraFields.specialtyEn = translations.specialty?.en; techExtraFields.specialtyUr = translations.specialty?.ur; }
        } catch (e) { /* fallback */ }
      }
      await db.updateTechnician(id, { ...updateData, ...techExtraFields });
      await db.createAuditLog({ userId: ctx.user.id, action: "update_technician", entityType: "technician", entityId: id, newValues: updateData });
      return { success: true };
    }),
    delete: protectedProcedure.input(z.object({ id: z.number() })).mutation(async ({ input, ctx }) => {
      await db.deleteTechnician(input.id);
      await db.createAuditLog({ userId: ctx.user.id, action: "delete_technician", entityType: "technician", entityId: input.id });
      return { success: true };
    }),
    getOpenTicketCounts: protectedProcedure.query(async () => {
      return db.getTechnicianOpenTicketCounts();
    }),
  }),
  // ============================================================
  // TICKETS
  // ============================================================
  tickets: router({
    list: protectedProcedure.input(z.object({
      status: z.string().optional(),
      priority: z.string().optional(),
      siteId: z.number().optional(),
      sectionId: z.number().optional(),
      assetId: z.number().optional(),
      search: z.string().optional(),
      category: z.string().optional(),
      assignedTechnicianId: z.number().optional(),
      assignedToId: z.number().optional(), // Phase 2: filter by user-based assignment
    }).optional()).query(async ({ input, ctx }) => {
      const role = ctx.user.role;
      let filters: any = input || {};
      if (role === "operator") filters.reportedById = ctx.user.id;
      else if (role === "technician") filters.assignedToId = ctx.user.id;
      return db.getTickets(filters);
    }),

    getById: protectedProcedure.input(z.object({ id: z.number() })).query(async ({ input }) => {
      const ticket = await db.getTicketById(input.id);
      if (!ticket) throw new TRPCError({ code: "NOT_FOUND", message: "البلاغ غير موجود" });
      return ticket;
    }),

    create: protectedProcedure.input(z.object({
      title: z.string().min(1),
      description: z.string().optional(),
      priority: z.string().default("medium"),
      category: z.string().default("general"),
      siteId: z.number().optional(),
      sectionId: z.number().optional(),
      assetId: z.number().optional(),
      locationDetail: z.string().optional(),
      beforePhotoUrl: z.string().optional(),
    })).mutation(async ({ input, ctx }) => {
      const ticketNumber = await db.getNextTicketNumber();
      // Auto-translate fields
      const fieldsToTranslate: Record<string, string> = {};
      if (input.title) fieldsToTranslate.title = input.title;
      if (input.description) fieldsToTranslate.description = input.description;
      let translationData: Record<string, any> = {};
      let detectedLang: SupportedLanguage = "ar";
      if (Object.keys(fieldsToTranslate).length > 0) {
        try {
          detectedLang = await detectLanguage(input.title);
          const translations = await translateFields(fieldsToTranslate, detectedLang);
          if (translations.title) {
            translationData.title_ar = translations.title.ar;
            translationData.title_en = translations.title.en;
            translationData.title_ur = translations.title.ur;
          }
          if (translations.description) {
            translationData.description_ar = translations.description.ar;
            translationData.description_en = translations.description.en;
            translationData.description_ur = translations.description.ur;
          }
        } catch (e) {
          console.error("[Ticket] Translation failed:", e);
        }
      }
      // New workflow: tickets start as pending_triage and go to supervisor
      const id = await db.createTicket({ ...input, ...translationData, originalLanguage: detectedLang, ticketNumber, reportedById: ctx.user.id, status: "pending_triage" });
      await db.addTicketStatusHistory({ ticketId: id!, fromStatus: undefined, toStatus: "pending_triage", changedById: ctx.user.id });
      await db.createAuditLog({ userId: ctx.user.id, action: "create_ticket", entityType: "ticket", entityId: id! });
      // Notify supervisors first (new workflow)
      const supervisors = await db.getUsersByRole("supervisor");
      for (const sup of supervisors) {
        await db.createNotification({ userId: sup.id, title: "بلاغ جديد بانتظار الفرز", message: `البلاغ ${ticketNumber} - ${input.title} بانتظار الفرز والتصنيف`, type: "info", relatedTicketId: id! });
      }
      // Also notify maintenance managers
      const managers = await db.getManagerUsers();
      for (const mgr of managers) {
        await db.createNotification({ userId: mgr.id, title: "بلاغ جديد", message: `تم إنشاء بلاغ جديد: ${ticketNumber} - ${input.title}`, type: "info", relatedTicketId: id! });
      }
      return { id, ticketNumber };
    }),

    approve: managerProcedure.input(z.object({ id: z.number() })).mutation(async ({ input, ctx }) => {
      const ticket = await db.getTicketById(input.id);
      if (!ticket) throw new TRPCError({ code: "NOT_FOUND" });
      await db.updateTicket(input.id, { status: "approved", approvedById: ctx.user.id });
      await db.addTicketStatusHistory({ ticketId: input.id, fromStatus: ticket.status, toStatus: "approved", changedById: ctx.user.id });
      // Notify supervisors that ticket is approved
      const supervisorsApprove = await db.getUsersByRole("supervisor");
      for (const sup of supervisorsApprove) {
        await db.createNotification({ userId: sup.id, title: "✅ تمت الموافقة على بلاغ", message: `تمت الموافقة على البلاغ ${ticket.ticketNumber} من قبل المدير`, type: "success", relatedTicketId: input.id });
      }
      return { success: true };
    }),

    // Reassign Technician (fallback for manager to reassign at any point after triage)
    assign: managerProcedure.input(z.object({
      id: z.number(),
      technicianId: z.number().optional(),           // System user technician
      externalTechnicianId: z.number().optional(),   // External technician (no account)
    })).mutation(async ({ input, ctx }) => {
      const ticket = await db.getTicketById(input.id);
      if (!ticket) throw new TRPCError({ code: "NOT_FOUND" });
      if (!input.technicianId && !input.externalTechnicianId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "يجب تحديد فني لإعادة الإسناد" });
      }
      // Reassign is allowed from any post-triage status
      const reassignableStatuses = ["under_inspection", "work_approved", "assigned", "in_progress", "needs_purchase", "purchase_pending_estimate", "purchase_pending_accounting", "purchase_pending_management", "purchase_approved", "purchased", "received_warehouse"];
      if (!reassignableStatuses.includes(ticket.status)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `لا يمكن إعادة الإسناد في الحالة: ${ticket.status}` });
      }
      const updateData: Record<string, any> = {
        assignedAt: new Date(),
      };
      // ── Phase 1: Disambiguation guard ───────────────────────────────────────
      // A ticket must not have both assignedToId (internal user) and
      // assignedTechnicianId (external technician) set simultaneously.
      // When assigning an internal user, clear the external technician slot.
      // When assigning an external technician, clear the internal user slot.
      // This is backward-compatible: existing single-assignment tickets are unaffected.
      if (input.technicianId) {
        updateData.assignedToId = input.technicianId;
        updateData.assignedTechnicianId = null; // clear external slot
      }
      if (input.externalTechnicianId) {
        updateData.assignedTechnicianId = input.externalTechnicianId;
        updateData.assignedToId = null; // clear internal slot
      }
      // ──────────────────────────────────────────────────────────────────
      await db.updateTicket(input.id, updateData);
      await db.addTicketStatusHistory({ ticketId: input.id, fromStatus: ticket.status, toStatus: ticket.status, changedById: ctx.user.id, notes: "إعادة إسناد الفني" });
      if (input.technicianId) {
        await db.createNotification({ userId: input.technicianId, title: "بلاغ مُسند إليك", message: `تم إسناد البلاغ ${ticket.ticketNumber} إليك`, type: "info", relatedTicketId: input.id });
      }
      return { success: true };
    }),

    startRepair: protectedProcedure.input(z.object({ id: z.number() })).mutation(async ({ input, ctx }) => {
      const ticket = await db.getTicketById(input.id);
      if (!ticket) throw new TRPCError({ code: "NOT_FOUND" });
      // Accept from assigned, in_progress, repaired, or received_warehouse (after materials delivered to technician)
      const validStatuses = ["assigned", "in_progress", "repaired", "purchase_approved", "purchased", "partial_purchase", "received_warehouse"];
      if (!validStatuses.includes(ticket.status)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `لا يمكن بدء التنفيذ في الحالة الحالية: ${ticket.status}` });
      }
      await db.updateTicket(input.id, { status: "in_progress" });
      await db.addTicketStatusHistory({ ticketId: input.id, fromStatus: ticket.status, toStatus: "in_progress", changedById: ctx.user.id });
      // Notify managers that work has started
      const managers = await db.getManagerUsers();
      for (const mgr of managers) {
        await db.createNotification({ userId: mgr.id, title: "🔧 بدأ تنفيذ بلاغ", message: `بدأ الفني العمل على البلاغ ${ticket.ticketNumber}`, type: "info", relatedTicketId: input.id });
      }
      return { success: true };
    }),

    completeRepair: protectedProcedure.input(z.object({
      id: z.number(),
      afterPhotoUrl: z.string().min(1, "صورة بعد الإصلاح مطلوبة"),
      repairNotes: z.string().optional(),
      materialsUsed: z.string().optional(),
    })).mutation(async ({ input, ctx }) => {
      const ticket = await db.getTicketById(input.id);
      if (!ticket) throw new TRPCError({ code: "NOT_FOUND" });
      if (ticket.status !== "in_progress") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "يجب أن يكون البلاغ قيد التنفيذ أولاً" });
      }
      // Auto-translate repairNotes
      let repairTranslation: Record<string, any> = {};
      if (input.repairNotes) {
        try {
          const lang = await detectLanguage(input.repairNotes);
          const translations = await translateFields({ repairNotes: input.repairNotes }, lang);
          if (translations.repairNotes) {
            repairTranslation.repairNotes_ar = translations.repairNotes.ar;
            repairTranslation.repairNotes_en = translations.repairNotes.en;
            repairTranslation.repairNotes_ur = translations.repairNotes.ur;
          }
        } catch (e) {
          console.error("[Ticket] RepairNotes translation failed:", e);
        }
      }
      await db.updateTicket(input.id, { status: "repaired", afterPhotoUrl: input.afterPhotoUrl, repairNotes: input.repairNotes, materialsUsed: input.materialsUsed, ...repairTranslation });
      await db.addTicketStatusHistory({ ticketId: input.id, fromStatus: ticket.status, toStatus: "repaired", changedById: ctx.user.id });
      const managers = await db.getManagerUsers();
      for (const mgr of managers) {
        await db.createNotification({ userId: mgr.id, title: "تم إصلاح بلاغ", message: `تم إصلاح البلاغ ${ticket.ticketNumber}`, type: "success", relatedTicketId: input.id });
      }
      return { success: true };
    }),

    close: managerProcedure.input(z.object({ id: z.number() })).mutation(async ({ input, ctx }) => {
      const ticket = await db.getTicketById(input.id);
      if (!ticket) throw new TRPCError({ code: "NOT_FOUND" });
      await db.updateTicket(input.id, { status: "closed", closedAt: new Date() });
      await db.addTicketStatusHistory({ ticketId: input.id, fromStatus: ticket.status, toStatus: "closed", changedById: ctx.user.id });
      await db.createAuditLog({ userId: ctx.user.id, action: "close_ticket", entityType: "ticket", entityId: input.id });
      // Notify reporter and assigned technician
      if (ticket.reportedById) {
        await db.createNotification({ userId: ticket.reportedById, title: "🔒 تم إغلاق بلاغك", message: `تم إغلاق البلاغ ${ticket.ticketNumber} بنجاح`, type: "success", relatedTicketId: input.id });
      }
      if (ticket.assignedToId && ticket.assignedToId !== ticket.reportedById) {
        await db.createNotification({ userId: ticket.assignedToId, title: "🔒 تم إغلاق البلاغ", message: `تم إغلاق البلاغ ${ticket.ticketNumber} الذي كنت مسؤولاً عنه`, type: "success", relatedTicketId: input.id });
      }
      return { success: true };
    }),

    // ❌ REMOVED: updateStatus (was allowing any status without validation)
    // ✅ REPLACED WITH: Specific procedures for each valid transition

    // Transition: new → pending_triage (Operator creates ticket)
    createTicket: protectedProcedure.input(z.object({
      title: z.string(),
      description: z.string().optional(),
      priority: z.enum(["low", "medium", "high", "critical"]),
      category: z.enum(["electrical", "plumbing", "hvac", "structural", "mechanical", "general", "safety", "cleaning"]),
      siteId: z.number().optional(),
      assetId: z.number().optional(),
      locationDetail: z.string().optional(),
    })).mutation(async ({ input, ctx }) => {
      const ticketNumber = `TK-${Date.now()}`;
      const ticket = await db.createTicket({
        ticketNumber,
        title: input.title,
        description: input.description,
        priority: input.priority as any,
        category: input.category as any,
        siteId: input.siteId,
        assetId: input.assetId,
        locationDetail: input.locationDetail,
        reportedById: ctx.user.id,
        status: "pending_triage",
      });
      if (!ticket) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db.addTicketStatusHistory({ ticketId: typeof ticket === 'number' ? ticket : (ticket as any).id, fromStatus: "new", toStatus: "pending_triage", changedById: ctx.user.id });
      return ticket;
    }),

    // Transition: pending_triage → under_inspection (Manager assigns for inspection)
    assignForInspection: managerProcedure.input(z.object({
      id: z.number(),
      assignedToId: z.number(),
      triageNotes: z.string().optional(),
    })).mutation(async ({ input, ctx }) => {
      const ticket = await db.getTicketById(input.id);
      if (!ticket) throw new TRPCError({ code: "NOT_FOUND" });
      if (ticket.status !== "pending_triage") throw new TRPCError({ code: "BAD_REQUEST", message: "البلاغ يجب أن يكون في مرحلة الفحص الأولي" });
      await db.updateTicket(input.id, { status: "under_inspection", assignedToId: input.assignedToId, triageNotes: input.triageNotes });
      await db.addTicketStatusHistory({ ticketId: input.id, fromStatus: "pending_triage", toStatus: "under_inspection", changedById: ctx.user.id });
      return { success: true };
    }),

    // Transition: under_inspection → work_approved (Manager approves + chooses path)
    // Already exists as approveWork - no change needed

    // ========== PATH A TRANSITIONS ==========
    // Transition: work_approved → ready_for_closure (Technician completes)
    // Already exists as markReadyForClosure - no change needed

    // Transition: ready_for_closure → closed (Supervisor closes)
    // Already exists as closeBySupervisor - no change needed

    // ========== PATH B TRANSITIONS ==========
    // Transition: work_approved → assigned (Manager assigns technician - or auto-advances if already assigned at triage)
    assignTechnician: managerProcedure.input(z.object({
      id: z.number(),
      assignedToId: z.number(),
    })).mutation(async ({ input, ctx }) => {
      const ticket = await db.getTicketById(input.id);
      if (!ticket) throw new TRPCError({ code: "NOT_FOUND" });
      if (ticket.status !== "work_approved") throw new TRPCError({ code: "BAD_REQUEST", message: "البلاغ يجب أن يكون معتمداً" });
      if (ticket.maintenancePath !== "B") throw new TRPCError({ code: "BAD_REQUEST", message: "هذا الإجراء للمسار B فقط" });
      await db.updateTicket(input.id, { status: "assigned", assignedToId: input.assignedToId, assignedAt: new Date() });
      await db.addTicketStatusHistory({ ticketId: input.id, fromStatus: "work_approved", toStatus: "assigned", changedById: ctx.user.id });
      return { success: true };
    }),

    // Transition: assigned/work_approved → in_progress (Technician starts work)
    // Accepts work_approved when technician was pre-assigned at triage
    startWork: protectedProcedure.input(z.object({ id: z.number() })).mutation(async ({ input, ctx }) => {
      const ticket = await db.getTicketById(input.id);
      if (!ticket) throw new TRPCError({ code: "NOT_FOUND" });
      if (ticket.status !== "assigned" && ticket.status !== "work_approved") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "البلاغ يجب أن يكون مسنداً أو معتمداً" });
      }
      if (ticket.maintenancePath !== "B") throw new TRPCError({ code: "BAD_REQUEST", message: "هذا الإجراء للمسار B فقط" });
      await db.updateTicket(input.id, { status: "in_progress" });
      await db.addTicketStatusHistory({ ticketId: input.id, fromStatus: ticket.status, toStatus: "in_progress", changedById: ctx.user.id });
      return { success: true };
    }),

    // Transition: in_progress → needs_purchase (Technician identifies need)
    requestPurchase: protectedProcedure.input(z.object({
      id: z.number(),
      materialsNeeded: z.string(),
    })).mutation(async ({ input, ctx }) => {
      const ticket = await db.getTicketById(input.id);
      if (!ticket) throw new TRPCError({ code: "NOT_FOUND" });
      if (ticket.status !== "in_progress") throw new TRPCError({ code: "BAD_REQUEST", message: "البلاغ يجب أن يكون قيد التنفيذ" });
      if (ticket.maintenancePath !== "B") throw new TRPCError({ code: "BAD_REQUEST", message: "هذا الإجراء للمسار B فقط" });
      await db.updateTicket(input.id, { status: "needs_purchase", materialsUsed: input.materialsNeeded });
      await db.addTicketStatusHistory({ ticketId: input.id, fromStatus: "in_progress", toStatus: "needs_purchase", changedById: ctx.user.id });
      return { success: true };
    }),

    // Transition: needs_purchase → purchase_pending_estimate (Purchase manager gets estimate)
    submitEstimate: managerProcedure.input(z.object({
      id: z.number(),
      estimatedCost: z.number(),
      estimateNotes: z.string().optional(),
    })).mutation(async ({ input, ctx }) => {
      const ticket = await db.getTicketById(input.id);
      if (!ticket) throw new TRPCError({ code: "NOT_FOUND" });
      if (ticket.status !== "needs_purchase") throw new TRPCError({ code: "BAD_REQUEST", message: "البلاغ يجب أن يكون بانتظار الشراء" });
      if (ticket.maintenancePath !== "B") throw new TRPCError({ code: "BAD_REQUEST", message: "هذا الإجراء للمسار B فقط" });
      await db.updateTicket(input.id, { status: "purchase_pending_estimate" });
      await db.addTicketStatusHistory({ ticketId: input.id, fromStatus: "needs_purchase", toStatus: "purchase_pending_estimate", changedById: ctx.user.id, notes: `التكلفة المقدرة: ${input.estimatedCost}` });
      return { success: true };
    }),

    // Transition: purchase_pending_estimate → purchase_pending_accounting (Accountant reviews)
    submitToAccounting: accountantProcedure.input(z.object({ id: z.number() })).mutation(async ({ input, ctx }: any) => {
      const ticket = await db.getTicketById(input.id);
      if (!ticket) throw new TRPCError({ code: "NOT_FOUND" });
      if (ticket.status !== "purchase_pending_estimate") throw new TRPCError({ code: "BAD_REQUEST", message: "البلاغ يجب أن يكون بانتظار التقدير" });
      if (ticket.maintenancePath !== "B") throw new TRPCError({ code: "BAD_REQUEST", message: "هذا الإجراء للمسار B فقط" });
      await db.updateTicket(input.id, { status: "purchase_pending_accounting" });
      await db.addTicketStatusHistory({ ticketId: input.id, fromStatus: "purchase_pending_estimate", toStatus: "purchase_pending_accounting", changedById: ctx.user.id });
      return { success: true };
    }),

    // Transition: purchase_pending_accounting → purchase_pending_management (Senior management approval)
    submitToManagement: managementProcedure.input(z.object({ id: z.number() })).mutation(async ({ input, ctx }: any) => {
      const ticket = await db.getTicketById(input.id);
      if (!ticket) throw new TRPCError({ code: "NOT_FOUND" });
      if (ticket.status !== "purchase_pending_accounting") throw new TRPCError({ code: "BAD_REQUEST", message: "البلاغ يجب أن يكون بانتظار المحاسبة" });
      if (ticket.maintenancePath !== "B") throw new TRPCError({ code: "BAD_REQUEST", message: "هذا الإجراء للمسار B فقط" });
      await db.updateTicket(input.id, { status: "purchase_pending_management" });
      await db.addTicketStatusHistory({ ticketId: input.id, fromStatus: "purchase_pending_accounting", toStatus: "purchase_pending_management", changedById: ctx.user.id });
      return { success: true };
    }),

    // Transition: purchase_pending_management → purchase_approved (Management approves)
    approvePurchase: managementProcedure.input(z.object({ id: z.number() })).mutation(async ({ input, ctx }) => {
      const ticket = await db.getTicketById(input.id);
      if (!ticket) throw new TRPCError({ code: "NOT_FOUND" });
      if (ticket.status !== "purchase_pending_management") throw new TRPCError({ code: "BAD_REQUEST", message: "البلاغ يجب أن يكون بانتظار الموافقة الإدارية" });
      if (ticket.maintenancePath !== "B") throw new TRPCError({ code: "BAD_REQUEST", message: "هذا الإجراء للمسار B فقط" });
      await db.updateTicket(input.id, { status: "purchase_approved" });
      await db.addTicketStatusHistory({ ticketId: input.id, fromStatus: "purchase_pending_management", toStatus: "purchase_approved", changedById: ctx.user.id });
      return { success: true };
    }),

    // Transition: purchase_approved → partial_purchase or purchased (Purchase manager executes)
    executePurchase: managerProcedure.input(z.object({
      id: z.number(),
      isPartial: z.boolean().default(false),
    })).mutation(async ({ input, ctx }) => {
      const ticket = await db.getTicketById(input.id);
      if (!ticket) throw new TRPCError({ code: "NOT_FOUND" });
      if (ticket.status !== "purchase_approved") throw new TRPCError({ code: "BAD_REQUEST", message: "البلاغ يجب أن يكون معتمداً للشراء" });
      if (ticket.maintenancePath !== "B") throw new TRPCError({ code: "BAD_REQUEST", message: "هذا الإجراء للمسار B فقط" });
      const newStatus = input.isPartial ? "partial_purchase" : "purchased";
      await db.updateTicket(input.id, { status: newStatus });
      await db.addTicketStatusHistory({ ticketId: input.id, fromStatus: "purchase_approved", toStatus: newStatus, changedById: ctx.user.id });
      return { success: true };
    }),

    // Transition: partial_purchase → purchased (Final purchase)
    completePurchase: managerProcedure.input(z.object({ id: z.number() })).mutation(async ({ input, ctx }) => {
      const ticket = await db.getTicketById(input.id);
      if (!ticket) throw new TRPCError({ code: "NOT_FOUND" });
      if (ticket.status !== "partial_purchase") throw new TRPCError({ code: "BAD_REQUEST", message: "البلاغ يجب أن يكون بشراء جزئي" });
      if (ticket.maintenancePath !== "B") throw new TRPCError({ code: "BAD_REQUEST", message: "هذا الإجراء للمسار B فقط" });
      await db.updateTicket(input.id, { status: "purchased" });
      await db.addTicketStatusHistory({ ticketId: input.id, fromStatus: "partial_purchase", toStatus: "purchased", changedById: ctx.user.id });
      return { success: true };
    }),

    // Transition: purchased → received_warehouse (Warehouse receives)
    receiveInWarehouse: warehouseProcedure.input(z.object({ id: z.number() })).mutation(async ({ input, ctx }) => {
      const ticket = await db.getTicketById(input.id);
      if (!ticket) throw new TRPCError({ code: "NOT_FOUND" });
      if (ticket.status !== "purchased") throw new TRPCError({ code: "BAD_REQUEST", message: "البلاغ يجب أن يكون مشتراً" });
      if (ticket.maintenancePath !== "B") throw new TRPCError({ code: "BAD_REQUEST", message: "هذا الإجراء للمسار B فقط" });
      await db.updateTicket(input.id, { status: "received_warehouse" });
      await db.addTicketStatusHistory({ ticketId: input.id, fromStatus: "purchased", toStatus: "received_warehouse", changedById: ctx.user.id });
      return { success: true };
    }),

    // Transition: received_warehouse → ready_for_closure (Technician completes with parts)
    completeWithParts: protectedProcedure.input(z.object({
      id: z.number(),
      afterPhotoUrl: z.string().optional(),
      repairNotes: z.string().optional(),
    })).mutation(async ({ input, ctx }) => {
      const ticket = await db.getTicketById(input.id);
      if (!ticket) throw new TRPCError({ code: "NOT_FOUND" });
      if (ticket.status !== "received_warehouse") throw new TRPCError({ code: "BAD_REQUEST", message: "البلاغ يجب أن يكون مستلماً من المستودع" });
      if (ticket.maintenancePath !== "B" && ticket.maintenancePath !== "C") throw new TRPCError({ code: "BAD_REQUEST", message: "هذا الإجراء للمسار B أو C فقط" });
      await db.updateTicket(input.id, { status: "ready_for_closure", afterPhotoUrl: input.afterPhotoUrl, repairNotes: input.repairNotes });
      await db.addTicketStatusHistory({ ticketId: input.id, fromStatus: "received_warehouse", toStatus: "ready_for_closure", changedById: ctx.user.id });
      return { success: true };
    }),

    // ========== PATH C TRANSITIONS ==========
    // Transitions already exist: approveGateExit, markExternalRepairDone, approveGateEntry

    // ========== FINAL TRANSITIONS (All Paths) ==========
    // Transition: ready_for_closure → repaired (Verification)
    markRepaired: managerProcedure.input(z.object({ id: z.number() })).mutation(async ({ input, ctx }) => {
      const ticket = await db.getTicketById(input.id);
      if (!ticket) throw new TRPCError({ code: "NOT_FOUND" });
      if (ticket.status !== "ready_for_closure") throw new TRPCError({ code: "BAD_REQUEST", message: "البلاغ يجب أن يكون جاهزاً للإغلاق" });
      await db.updateTicket(input.id, { status: "repaired" });
      await db.addTicketStatusHistory({ ticketId: input.id, fromStatus: "ready_for_closure", toStatus: "repaired", changedById: ctx.user.id });
      return { success: true };
    }),

    // Transition: repaired → verified (Final verification)
    markVerified: supervisorProcedure.input(z.object({ id: z.number() })).mutation(async ({ input, ctx }) => {
      const ticket = await db.getTicketById(input.id);
      if (!ticket) throw new TRPCError({ code: "NOT_FOUND" });
      if (ticket.status !== "repaired") throw new TRPCError({ code: "BAD_REQUEST", message: "البلاغ يجب أن يكون مصلحاً" });
      await db.updateTicket(input.id, { status: "verified" });
      await db.addTicketStatusHistory({ ticketId: input.id, fromStatus: "repaired", toStatus: "verified", changedById: ctx.user.id });
      return { success: true };
    }),

    // Transition: verified → closed (Final closure)
    finalClose: supervisorProcedure.input(z.object({ id: z.number() })).mutation(async ({ input, ctx }) => {
      const ticket = await db.getTicketById(input.id);
      if (!ticket) throw new TRPCError({ code: "NOT_FOUND" });
      if (ticket.status !== "verified") throw new TRPCError({ code: "BAD_REQUEST", message: "البلاغ يجب أن يكون مُتحقق منه" });
      await db.updateTicket(input.id, { status: "closed", closedAt: new Date() });
      await db.addTicketStatusHistory({ ticketId: input.id, fromStatus: "verified", toStatus: "closed", changedById: ctx.user.id });
      await db.createAuditLog({ userId: ctx.user.id, action: "close_ticket", entityType: "ticket", entityId: input.id });
      // Notify ticket creator and assigned technician
      if (ticket.reportedById) {
        await db.createNotification({ userId: ticket.reportedById, title: "🔒 تم إغلاق بلاغك", message: `تم إغلاق البلاغ ${ticket.ticketNumber} بنجاح`, type: "success", relatedTicketId: input.id });
      }
      if (ticket.assignedToId && ticket.assignedToId !== ticket.reportedById) {
        await db.createNotification({ userId: ticket.assignedToId, title: "🔒 تم إغلاق البلاغ", message: `تم إغلاق البلاغ ${ticket.ticketNumber} الذي كنت مسؤولاً عنه`, type: "success", relatedTicketId: input.id });
      }
      return { success: true };
    }),
    update: protectedProcedure.input(z.object({
      id: z.number(),
      title: z.string().optional(),
      description: z.string().optional(),
      priority: z.string().optional(),
      category: z.string().optional(),
      siteId: z.number().optional(),
      locationDetail: z.string().optional(),
    })).mutation(async ({ input, ctx }) => {
      const ticket = await db.getTicketById(input.id);
      if (!ticket) throw new TRPCError({ code: "NOT_FOUND", message: "البلاغ غير موجود" });
      // Only owner/admin/manager or the reporter can edit
      const canEdit = ["owner", "admin", "maintenance_manager"].includes(ctx.user.role) || ticket.reportedById === ctx.user.id;
      if (!canEdit) throw new TRPCError({ code: "FORBIDDEN", message: "ليس لديك صلاحية لتعديل هذا البلاغ" });
      if (ticket.status === "closed") throw new TRPCError({ code: "BAD_REQUEST", message: "لا يمكن تعديل بلاغ مغلق" });
      const { id, ...updateData } = input;
      const oldValues: any = {};
      const newValues: any = {};
      if (input.title && input.title !== ticket.title) { oldValues.title = ticket.title; newValues.title = input.title; }
      if (input.description && input.description !== ticket.description) { oldValues.description = ticket.description; newValues.description = input.description; }
      if (input.priority && input.priority !== ticket.priority) { oldValues.priority = ticket.priority; newValues.priority = input.priority; }
      if (input.category && input.category !== ticket.category) { oldValues.category = ticket.category; newValues.category = input.category; }
      if (input.siteId && input.siteId !== ticket.siteId) { oldValues.siteId = ticket.siteId; newValues.siteId = input.siteId; }
      // Auto-translate updated text fields to all 3 languages
      let translationUpdate: Record<string, any> = {};
      const fieldsToTranslate: Record<string, string> = {};
      if (input.title && input.title !== ticket.title) fieldsToTranslate.title = input.title;
      if (input.description && input.description !== ticket.description) fieldsToTranslate.description = input.description;
      if (Object.keys(fieldsToTranslate).length > 0) {
        try {
          const textForDetection = Object.values(fieldsToTranslate)[0];
          const detectedLang = await detectLanguage(textForDetection) as SupportedLanguage;
          const translations = await translateFields(fieldsToTranslate, detectedLang);
          if (translations.title) {
            translationUpdate.title_ar = translations.title.ar;
            translationUpdate.title_en = translations.title.en;
            translationUpdate.title_ur = translations.title.ur;
          }
          if (translations.description) {
            translationUpdate.description_ar = translations.description.ar;
            translationUpdate.description_en = translations.description.en;
            translationUpdate.description_ur = translations.description.ur;
          }
        } catch (e) {
          console.error("[Ticket] Update translation failed:", e);
        }
      }
      await db.updateTicket(id, { ...updateData, ...translationUpdate });
      await db.createAuditLog({ userId: ctx.user.id, action: "update_ticket", entityType: "ticket", entityId: id, oldValues, newValues });
      // Notify managers about ticket edit
      if (Object.keys(newValues).length > 0) {
        const managers = await db.getManagerUsers();
        const changedFields = Object.keys(newValues).join(", ");
        for (const mgr of managers) {
          if (mgr.id !== ctx.user.id) {
            await db.createNotification({ userId: mgr.id, title: `تعديل بلاغ #${ticket.ticketNumber}`, message: `قام ${ctx.user.name} بتعديل البلاغ "${ticket.title}" - الحقول: ${changedFields}`, type: "ticket_updated", relatedTicketId: id });
          }
        }
      }
      return { success: true };
    }),

    delete: protectedProcedure.input(z.object({ id: z.number() })).mutation(async ({ input, ctx }) => {
      const ticket = await db.getTicketById(input.id);
      if (!ticket) throw new TRPCError({ code: "NOT_FOUND", message: "البلاغ غير موجود" });
      // Only owner/admin/manager can delete
      if (!["owner", "admin", "maintenance_manager"].includes(ctx.user.role)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "ليس لديك صلاحية لحذف البلاغات" });
      }
      await db.deleteTicket(input.id);
      await db.createAuditLog({ userId: ctx.user.id, action: "delete_ticket", entityType: "ticket", entityId: input.id, oldValues: { ticketNumber: ticket.ticketNumber, title: ticket.title, status: ticket.status } });
      // Notify managers about ticket deletion
      const managers = await db.getManagerUsers();
      for (const mgr of managers) {
        if (mgr.id !== ctx.user.id) {
          await db.createNotification({ userId: mgr.id, title: `حذف بلاغ #${ticket.ticketNumber}`, message: `قام ${ctx.user.name} بحذف البلاغ "${ticket.title}"`, type: "ticket_deleted", relatedTicketId: input.id });
        }
      }
      return { success: true };
    }),

    history: protectedProcedure.input(z.object({ ticketId: z.number() })).query(async ({ input }) => {
      return db.getTicketHistory(input.ticketId);
    }),

    // =============================================
    // NEW WORKFLOW PROCEDURES
    // =============================================

    // 1. Submit for Triage (after creation, ticket goes to supervisor)
    submitForTriage: protectedProcedure.input(z.object({ id: z.number() })).mutation(async ({ input, ctx }) => {
      const ticket = await db.getTicketById(input.id);
      if (!ticket) throw new TRPCError({ code: "NOT_FOUND" });
      await db.updateTicket(input.id, { status: "pending_triage" });
      await db.addTicketStatusHistory({ ticketId: input.id, fromStatus: ticket.status, toStatus: "pending_triage", changedById: ctx.user.id });
      // Notify supervisors
      const supervisors = await db.getUsersByRole("supervisor");
      for (const sup of supervisors) {
        await db.createNotification({ userId: sup.id, title: "بلاغ بانتظار الفرز", message: `البلاغ ${ticket.ticketNumber} بانتظار الفرز والتصنيف`, type: "info", relatedTicketId: input.id });
      }
      return { success: true };
    }),

    // 2. Triage by Supervisor (Eng. Khaled)
    triage: supervisorProcedure.input(z.object({
      id: z.number(),
      ticketType: z.enum(["internal", "external", "procurement"]),
      priority: z.string().optional(),
      triageNotes: z.string().optional(),
      assignedToId: z.number().optional(), // Assign inspection team
    })).mutation(async ({ input, ctx }) => {
      const ticket = await db.getTicketById(input.id);
      if (!ticket) throw new TRPCError({ code: "NOT_FOUND" });
      if (ticket.status !== "pending_triage") throw new TRPCError({ code: "BAD_REQUEST", message: "البلاغ ليس في مرحلة الفرز" });
      const updateData: any = {
        status: "under_inspection",
        ticketType: input.ticketType,
        supervisorId: ctx.user.id,
        triageNotes: input.triageNotes,
      };
      if (input.priority) updateData.priority = input.priority;
      if (input.assignedToId) updateData.assignedToId = input.assignedToId;
      await db.updateTicket(input.id, updateData);
      await db.addTicketStatusHistory({ ticketId: input.id, fromStatus: ticket.status, toStatus: "under_inspection", changedById: ctx.user.id, notes: input.triageNotes });
      // Notify maintenance manager
      const managers = await db.getManagerUsers();
      for (const mgr of managers) {
        await db.createNotification({ userId: mgr.id, title: "بلاغ قيد الفحص", message: `تم فرز البلاغ ${ticket.ticketNumber} وهو الآن قيد الفحص`, type: "info", relatedTicketId: input.id });
      }
      return { success: true };
    }),

    // 2b. Triage Ticket (Supervisor moves ticket from pending_triage to under_inspection)
    triageTicket: supervisorProcedure.input(z.object({
      id: z.number(),
      assignedToId: z.number().optional(),
    })).mutation(async ({ input, ctx }) => {
      const ticket = await db.getTicketById(input.id);
      if (!ticket) throw new TRPCError({ code: "NOT_FOUND" });
      if (ticket.status !== "pending_triage") throw new TRPCError({ code: "BAD_REQUEST", message: "البلاغ ليس في مرحلة الفرز" });
      const updateData: any = { status: "under_inspection", supervisorId: ctx.user.id };
      if (input.assignedToId) {
        updateData.assignedToId = input.assignedToId;
        updateData.assignedAt = new Date();
      }
      await db.updateTicket(input.id, updateData);
      await db.addTicketStatusHistory({ ticketId: input.id, fromStatus: ticket.status, toStatus: "under_inspection", changedById: ctx.user.id, notes: input.assignedToId ? `تم نقل البلاغ لمرحلة الفحص وتعيين الفني` : "تم نقل البلاغ لمرحلة الفحص" });
      // Notify maintenance manager
      const managers = await db.getManagerUsers();
      for (const mgr of managers) {
        await db.createNotification({ userId: mgr.id, title: "بلاغ قيد الفحص", message: `البلاغ ${ticket.ticketNumber} الآن قيد الفحص من قبل المشرف`, type: "info", relatedTicketId: input.id });
      }
      // Notify assigned technician if provided
      if (input.assignedToId) {
        await db.createNotification({ userId: input.assignedToId, title: "تم تعيينك لفحص بلاغ", message: `تم تعيينك للفحص الميداني للبلاغ ${ticket.ticketNumber}`, type: "warning", relatedTicketId: input.id });
      }
      return { success: true };
    }),

    // 2c. Inspect Ticket (Supervisor completes inspection and prepares for approval)
    inspectTicket: supervisorProcedure.input(z.object({
      id: z.number(),
      inspectionNotes: z.string(),
    })).mutation(async ({ input, ctx }) => {
      const ticket = await db.getTicketById(input.id);
      if (!ticket) throw new TRPCError({ code: "NOT_FOUND" });
      if (ticket.status !== "under_inspection") throw new TRPCError({ code: "BAD_REQUEST", message: "البلاغ ليس في مرحلة الفحص" });
      // Update inspection notes
      const _ddb = await db.getDb();
      await _ddb!.transaction(async () => {
        await db.updateTicket(input.id, { inspectionNotes: input.inspectionNotes });
        await db.createInspectionResult({ ticketId: input.id, assetId: ticket.assetId ?? undefined, inspectorId: ctx.user.id, inspectionType: "triage", severity: "medium", rootCause: input.inspectionNotes, findings: input.inspectionNotes, recommendedAction: input.inspectionNotes });
      });
      await db.addTicketStatusHistory({ ticketId: input.id, fromStatus: ticket.status, toStatus: "under_inspection", changedById: ctx.user.id, notes: `ملاحظات الفحص: ${input.inspectionNotes}` });
      // Notify maintenance manager to approve work
      const managers = await db.getManagerUsers();
       for (const mgr of managers) {
        await db.createNotification({ userId: mgr.id, title: "بلاغ جاهز للموافقة", message: `البلاغ ${ticket.ticketNumber} انتهى من الفحص وجاهز للموافقة على العمل`, type: "warning", relatedTicketId: input.id });
      }
      return { success: true };
    }),
    // 3. Work Approval by Maintenance Manager (Abdel Fattah) + Path Selection
    approveWork: managerProcedure.input(z.object({
      id: z.number(),
      maintenancePath: z.enum(["A", "B", "C"]),
      inspectionNotes: z.string().optional(),
      justification: z.string().optional(), // Required for Path C
    })).mutation(async ({ input, ctx }) => {
      const ticket = await db.getTicketById(input.id);
      if (!ticket) throw new TRPCError({ code: "NOT_FOUND" });
      if (ticket.status !== "under_inspection") throw new TRPCError({ code: "BAD_REQUEST", message: "البلاغ ليس في مرحلة الفحص" });
      if (input.maintenancePath === "C" && !input.justification) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "المسار C يتطلب مبرراً للصيانة الخارجية" });
      }
      const updateData: any = {
        status: "work_approved",
        maintenancePath: input.maintenancePath,
        approvedById: ctx.user.id,
        inspectionNotes: input.inspectionNotes,
        justification: input.justification,
      };
      await db.updateTicket(input.id, updateData);
      await db.addTicketStatusHistory({ ticketId: input.id, fromStatus: ticket.status, toStatus: "work_approved", changedById: ctx.user.id, notes: `المسار: ${input.maintenancePath}` });
      // Notify based on path
      if (input.maintenancePath === "C") {
        // Notify supervisor for external path approval
        const supervisors = await db.getUsersByRole("supervisor");
        for (const sup of supervisors) {
          await db.createNotification({ userId: sup.id, title: "بلاغ مسار خارجي", message: `البلاغ ${ticket.ticketNumber} يحتاج موافقة للصيانة الخارجية (المسار C)`, type: "warning", relatedTicketId: input.id });
        }
      } else if (input.maintenancePath === "A") {
        // Notify assigned technician
        if (ticket.assignedToId) {
          await db.createNotification({ userId: ticket.assignedToId, title: "اعتماد بدء العمل", message: `تم اعتماد البلاغ ${ticket.ticketNumber} للإصلاح المباشر`, type: "success", relatedTicketId: input.id });
        }
      } else if (input.maintenancePath === "B") {
        // Notify assigned technician for path B (purchase required)
        if (ticket.assignedToId) {
          await db.createNotification({ userId: ticket.assignedToId, title: "اعتماد بلاغ - مسار الشراء", message: `تم اعتماد البلاغ ${ticket.ticketNumber} - سيتم رفع طلب شراء المواد اللازمة`, type: "warning", relatedTicketId: input.id });
        }
      }
      return { success: true };
    }),

    // 4. Mark Ready for Closure (Path A - after technician completes repair)
    markReadyForClosure: protectedProcedure.input(z.object({
      id: z.number(),
      afterPhotoUrl: z.string().optional(),
      repairNotes: z.string().optional(),
    })).mutation(async ({ input, ctx }) => {
      const ticket = await db.getTicketById(input.id);
      if (!ticket) throw new TRPCError({ code: "NOT_FOUND" });
      if (ticket.maintenancePath !== "A") throw new TRPCError({ code: "BAD_REQUEST", message: "هذا الإجراء للمسار A فقط" });
      await db.updateTicket(input.id, { status: "ready_for_closure", afterPhotoUrl: input.afterPhotoUrl, repairNotes: input.repairNotes });
      await db.addTicketStatusHistory({ ticketId: input.id, fromStatus: ticket.status, toStatus: "ready_for_closure", changedById: ctx.user.id });
      // Notify supervisor to close
      const supervisors = await db.getUsersByRole("supervisor");
      for (const sup of supervisors) {
        await db.createNotification({ userId: sup.id, title: "بلاغ جاهز للإغلاق", message: `البلاغ ${ticket.ticketNumber} جاهز للإغلاق - المسار A`, type: "success", relatedTicketId: input.id });
      }
      return { success: true };
    }),

    // 5. Supervisor closes ticket (Path A)
    closeBySupervisor: supervisorProcedure.input(z.object({ id: z.number() })).mutation(async ({ input, ctx }) => {
      const ticket = await db.getTicketById(input.id);
      if (!ticket) throw new TRPCError({ code: "NOT_FOUND" });
      if (ticket.status !== "ready_for_closure") throw new TRPCError({ code: "BAD_REQUEST", message: "البلاغ ليس جاهزاً للإغلاق" });
      await db.updateTicket(input.id, { status: "closed", closedAt: new Date() });
      await db.addTicketStatusHistory({ ticketId: input.id, fromStatus: ticket.status, toStatus: "closed", changedById: ctx.user.id });
      await db.createAuditLog({ userId: ctx.user.id, action: "close_ticket", entityType: "ticket", entityId: input.id });
      // Notify managers, reporter, and technician
      const managersSup = await db.getManagerUsers();
      for (const mgr of managersSup) {
        await db.createNotification({ userId: mgr.id, title: "🔒 تم إغلاق بلاغ", message: `أغلق المشرف البلاغ ${ticket.ticketNumber}`, type: "success", relatedTicketId: input.id });
      }
      if (ticket.reportedById) {
        await db.createNotification({ userId: ticket.reportedById, title: "🔒 تم إغلاق بلاغك", message: `تم إغلاق البلاغ ${ticket.ticketNumber} بنجاح`, type: "success", relatedTicketId: input.id });
      }
      if (ticket.assignedToId && ticket.assignedToId !== ticket.reportedById) {
        await db.createNotification({ userId: ticket.assignedToId, title: "🔒 تم إغلاق البلاغ", message: `تم إغلاق البلاغ ${ticket.ticketNumber}`, type: "success", relatedTicketId: input.id });
      }
      return { success: true };
    }),

    // 6. Gate Exit Approval (Path C - asset leaves for external repair)
    approveGateExit: gateSecurityProcedure.input(z.object({ id: z.number() })).mutation(async ({ input, ctx }) => {
      const ticket = await db.getTicketById(input.id);
      if (!ticket) throw new TRPCError({ code: "NOT_FOUND" });
      if (ticket.maintenancePath !== "C") throw new TRPCError({ code: "BAD_REQUEST", message: "هذا الإجراء للمسار C فقط" });
      await db.updateTicket(input.id, { status: "out_for_repair", gateExitApprovedById: ctx.user.id, gateExitApprovedAt: new Date() });
      await db.addTicketStatusHistory({ ticketId: input.id, fromStatus: ticket.status, toStatus: "out_for_repair", changedById: ctx.user.id, notes: "تمت الموافقة على خروج الأصل" });
      await db.createAuditLog({ userId: ctx.user.id, action: "gate_exit_approved", entityType: "ticket", entityId: input.id });
      return { success: true };
    }),

    // 7. Mark External Repair Completed (Delegate)
    markExternalRepairDone: delegateProcedure.input(z.object({
      id: z.number(),
      repairNotes: z.string().optional(),
    })).mutation(async ({ input, ctx }) => {
      const ticket = await db.getTicketById(input.id);
      if (!ticket) throw new TRPCError({ code: "NOT_FOUND" });
      if (ticket.status !== "out_for_repair") throw new TRPCError({ code: "BAD_REQUEST", message: "الأصل ليس خارجاً للإصلاح" });
      await db.updateTicket(input.id, { externalRepairCompletedAt: new Date(), externalRepairCompletedById: ctx.user.id, repairNotes: input.repairNotes });
      await db.addTicketStatusHistory({ ticketId: input.id, fromStatus: ticket.status, toStatus: "out_for_repair", changedById: ctx.user.id, notes: "تم الإصلاح الخارجي - بانتظار موافقة الدخول" });
      // Notify gate security
      const gateUsers = await db.getUsersByRole("gate_security");
      for (const g of gateUsers) {
        await db.createNotification({ userId: g.id, title: "أصل عائد للمنشأة", message: `الأصل المرتبط بالبلاغ ${ticket.ticketNumber} عائد بعد الإصلاح الخارجي`, type: "info", relatedTicketId: input.id });
      }
      return { success: true };
    }),

    // 8. Gate Entry Approval (Path C - asset returns after external repair)
    approveGateEntry: gateSecurityProcedure.input(z.object({ id: z.number() })).mutation(async ({ input, ctx }) => {
      const ticket = await db.getTicketById(input.id);
      if (!ticket) throw new TRPCError({ code: "NOT_FOUND" });
      if (ticket.maintenancePath !== "C") throw new TRPCError({ code: "BAD_REQUEST", message: "هذا الإجراء للمسار C فقط" });
      // Path C: gate entry → received_warehouse so warehouse flow (Path B) takes over
      await db.updateTicket(input.id, { status: "received_warehouse", gateEntryApprovedById: ctx.user.id, gateEntryApprovedAt: new Date() });
      await db.addTicketStatusHistory({ ticketId: input.id, fromStatus: ticket.status, toStatus: "received_warehouse", changedById: ctx.user.id, notes: "تمت الموافقة على دخول الأصل - بانتظار استلام المستودع" });
      await db.createAuditLog({ userId: ctx.user.id, action: "gate_entry_approved", entityType: "ticket", entityId: input.id });
      // Notify warehouse users to receive the returned asset
      const warehouseUsersGE = await db.getUsersByRole("warehouse");
      for (const w of warehouseUsersGE) {
        await db.createNotification({ userId: w.id, title: "📦 أصل عاد من الإصلاح الخارجي", message: `البلاغ ${ticket.ticketNumber} - الأصل عاد ويحتاج استلام في المستودع`, type: "info", relatedTicketId: input.id });
      }
      // Also notify managers
      const managersGE = await db.getManagerUsers();
      for (const mgr of managersGE) {
        await db.createNotification({ userId: mgr.id, title: "📦 أصل عاد من الإصلاح الخارجي", message: `البلاغ ${ticket.ticketNumber} - الأصل عاد بعد الإصلاح وبانتظار استلام المستودع`, type: "info", relatedTicketId: input.id });
      }
      return { success: true };
    }),

    // 9. Get tickets for gate security
    listForGate: gateSecurityProcedure.query(async () => {
      return db.getTickets({ status: "work_approved" });
    }),
  }),

  // ============================================================
  // NFC / RFID SCANNING
  // ============================================================
  nfc: router({
    // Scan an NFC/RFID tag and return asset + location info
    scanTag: protectedProcedure.input(z.object({
      rfidTag: z.string().min(1, "يجب توفير رقم الرقاقة"),
    })).mutation(async ({ input }) => {
      // ✅ Find asset by RFID tag
      const asset = await db.getAssetByRfidTag(input.rfidTag);
      if (!asset) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "الأصل غير موجود. يرجى تسجيل الرقاقة أولاً.",
        });
      }
      // ✅ Get site/location associated with the asset
      const site = asset.siteId ? await db.getSiteById(asset.siteId) : null;
      // ✅ Get section associated with the asset
      let section: { id: number; name: string } | null = null;
      if (asset.sectionId) {
        const sectionsList = await db.getSections();
        const found = sectionsList.find((s: any) => s.id === asset.sectionId);
        if (found) section = { id: found.id, name: found.name };
      }
      return {
        success: true,
        asset: {
          id: asset.id,
          assetNumber: asset.assetNumber,
          name: asset.name,
          description: asset.description,
          category: asset.category,
          brand: asset.brand,
          model: asset.model,
          serialNumber: asset.serialNumber,
          siteId: asset.siteId,
          sectionId: asset.sectionId,
          locationDetail: asset.locationDetail,
          photoUrl: asset.photoUrl,
          rfidTag: asset.rfidTag,
        },
        site: site ? { id: site.id, name: site.name, address: site.address } : null,
        section: section,
      };
    }),

    // Lookup asset by tag without mutation (for QR code or manual entry)
    lookupTag: protectedProcedure.input(z.object({
      rfidTag: z.string().min(1),
    })).query(async ({ input }) => {
      const asset = await db.getAssetByRfidTag(input.rfidTag);
      if (!asset) return null;
      const site = asset.siteId ? await db.getSiteById(asset.siteId) : null;
      return {
        asset: {
          id: asset.id,
          assetNumber: asset.assetNumber,
          name: asset.name,
          siteId: asset.siteId,
          locationDetail: asset.locationDetail,
          photoUrl: asset.photoUrl,
        },
        site: site ? { id: site.id, name: site.name } : null,
      };
    }),
  }),

  // ============================================================
  // PURCHASE ORDERS
  // ============================================================
  purchaseOrders: router({
    list: protectedProcedure.input(z.object({ status: z.string().optional() }).optional()).query(async ({ input, ctx }) => {
      const role = ctx.user.role;
      let filters: any = input || {};
      
      if (role === "purchase_requester") {
        // Purchase requesters only see their own requests
        filters.requestedById = ctx.user.id;
        return db.getPurchaseOrders(filters);
      }
      
      if (role === "delegate") {
        // Delegates see POs that have items assigned to them
        const items = await db.getPOItemsByDelegate(ctx.user.id);
        const poIds = Array.from(new Set(items.map(i => i.purchaseOrderId)));
        if (poIds.length === 0) return [];
        const allPOs = await db.getPurchaseOrders(filters);
        return allPOs.filter(po => poIds.includes(po.id));
      }
      return db.getPurchaseOrders(filters);
    }),

    getById: protectedProcedure.input(z.object({ id: z.number() })).query(async ({ input }) => {
      const po = await db.getPurchaseOrderById(input.id);
      if (!po) throw new TRPCError({ code: "NOT_FOUND", message: "طلب الشراء غير موجود" });
      const items = await db.getPOItems(input.id);
      const comments = await db.getProcurementComments(input.id);
      return { ...po, items, comments };
    }),

    requestRevision: delegateProcedure.input(z.object({
      id: z.number(),
      note: z.string().min(5, "يجب كتابة سبب طلب المراجعة (بحد أدنى 5 أحرف)"),
    })).mutation(async ({ input, ctx }) => {
      const po = await db.getPurchaseOrderById(input.id);
      if (!po) throw new TRPCError({ code: "NOT_FOUND" });

      // Reset all approvals and set to revision_needed
      await db.updatePurchaseOrder(input.id, {
        status: "revision_needed",
        accountingApprovedById: null,
        accountingApprovedAt: null,
        managementApprovedById: null,
        managementApprovedAt: null,
        totalEstimatedCost: null,
      });

      // Reset all items status to pending
      const items = await db.getPOItems(input.id);
      for (const item of items) {
        await db.updatePOItem(item.id, { status: "pending", estimatedUnitCost: null, estimatedTotalCost: null });
      }

      // Add immutable comment
      await db.createProcurementComment({
        purchaseOrderId: input.id,
        userId: ctx.user.id,
        userName: ctx.user.name || "User",
        userRole: ctx.user.role,
        actionType: "return_for_revision",
        note: input.note,
      });

      // Notify the creator
      await db.createNotification({
        userId: po.requestedById,
        title: "⚠️ طلب مراجعة لطلب شراء",
        message: `قام المندوب ${ctx.user.name} بإعادة طلب الشراء #${po.poNumber} للمراجعة: ${input.note}`,
        type: "warning",
        relatedPOId: input.id
      });

      await db.createAuditLog({ userId: ctx.user.id, action: "request_revision", entityType: "purchase_order", entityId: input.id, newValues: { status: "revision_needed", note: input.note } });
      return { success: true };
    }),

    resubmit: protectedProcedure.input(z.object({
      id: z.number(),
      note: z.string().optional(),
    })).mutation(async ({ input, ctx }) => {
      const po = await db.getPurchaseOrderById(input.id);
      if (!po) throw new TRPCError({ code: "NOT_FOUND" });
      if (po.requestedById !== ctx.user.id) throw new TRPCError({ code: "FORBIDDEN", message: "فقط منشئ الطلب يمكنه إعادة التقديم" });
      if (po.status !== "revision_needed") throw new TRPCError({ code: "BAD_REQUEST", message: "الطلب ليس في حالة مراجعة" });

      await db.updatePurchaseOrder(input.id, { status: "pending_review" });

      await db.createProcurementComment({
        purchaseOrderId: input.id,
        userId: ctx.user.id,
        userName: ctx.user.name || "User",
        userRole: ctx.user.role,
        actionType: "resubmitted",
        note: input.note || "تم تعديل الطلب وإعادة التقديم",
      });

      await db.createAuditLog({ userId: ctx.user.id, action: "resubmit_po", entityType: "purchase_order", entityId: input.id });
      return { success: true };
    }),

    close: protectedProcedure.input(z.object({
      id: z.number(),
      note: z.string().optional(),
    })).mutation(async ({ input, ctx }) => {
      const po = await db.getPurchaseOrderById(input.id);
      if (!po) throw new TRPCError({ code: "NOT_FOUND" });
      if (po.requestedById !== ctx.user.id && !["admin", "owner"].includes(ctx.user.role)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "ليس لديك صلاحية لإغلاق هذا الطلب" });
      }

      await db.updatePurchaseOrder(input.id, { status: "closed" });

      if (input.note) {
        await db.createProcurementComment({
          purchaseOrderId: input.id,
          userId: ctx.user.id,
          userName: ctx.user.name || "User",
          userRole: ctx.user.role,
          actionType: "closed",
          note: `إغلاق الطلب: ${input.note}`,
        });
      }

      await db.createAuditLog({ userId: ctx.user.id, action: "close_po", entityType: "purchase_order", entityId: input.id });
      return { success: true };
    }),

    create: protectedProcedure.input(z.object({
      ticketId: z.number().optional(),
      notes: z.string().optional(),
      items: z.array(z.object({
        itemName: z.string().min(1),
        description: z.string().optional(),
        quantity: z.number().min(1),
        unit: z.string().optional(),
        photoUrl: z.string().optional(),
        notes: z.string().optional(),
        delegateId: z.number().optional(),
      })),
    })).mutation(async ({ input, ctx }) => {
      // ✅ Batching Limit: Max 15 items per PO
      if (input.items.length === 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "يجب إضافة صنف واحد على الأقل" });
      }
      if (input.items.length > 15) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `الحد الأقصى 15 صنف لكل طلب شراء. لديك ${input.items.length} صنف` });
      }
      const poNumber = await db.getNextPONumber();
      const poId = await db.createPurchaseOrder({
        poNumber,
        ticketId: input.ticketId,
        requestedById: ctx.user.id,
        status: "pending_review",
        notes: input.notes,
      });
      // delegateId is optional at creation — assigned during reviewItems step
      const itemsData = input.items.map(item => ({ ...item, purchaseOrderId: poId!, status: "pending" }));
      await db.createPOItems(itemsData);
      // Update ticket status if linked (Path C: keep at work_approved — gate security controls status)
      if (input.ticketId) {
        const ticket = await db.getTicketById(input.ticketId);
        if (ticket && ticket.maintenancePath !== "C") {
          await db.updateTicket(input.ticketId, { status: "needs_purchase" });
          await db.addTicketStatusHistory({ ticketId: input.ticketId, fromStatus: ticket.status, toStatus: "needs_purchase", changedById: ctx.user.id });
        }
      }
      // Notify maintenance managers, owners, and admins about the new PO
      const managers = await db.getManagerUsers();
      for (const mgr of managers) {
        if (mgr.id !== ctx.user.id) {
          await db.createNotification({
            userId: mgr.id,
            title: `🛒 طلب شراء جديد #${poNumber}`,
            message: `قام ${ctx.user.name} بإنشاء طلب شراء جديد يحتوي على ${input.items.length} صنف. بانتظار المراجعة.`,
            type: "warning",
            relatedPOId: poId!,
          });
        }
      }
      // Delegate notifications are sent in reviewItems after delegates are assigned
      await db.createAuditLog({ userId: ctx.user.id, action: "create_po", entityType: "purchase_order", entityId: poId! });
      return { id: poId, poNumber };
    }),

    update: protectedProcedure.input(z.object({
      id: z.number(),
      notes: z.string().optional(),
    })).mutation(async ({ input, ctx }) => {
      const po = await db.getPurchaseOrderById(input.id);
      if (!po) throw new TRPCError({ code: "NOT_FOUND", message: "طلب الشراء غير موجود" });
      if (!["pending_estimate", "pending_accounting"].includes(po.status)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "لا يمكن تعديل طلب شراء معتمد" });
      }
      const oldValues = { notes: po.notes };
      await db.updatePurchaseOrder(input.id, { notes: input.notes });
      await db.createAuditLog({ userId: ctx.user.id, action: "update_po", entityType: "purchase_order", entityId: input.id, oldValues, newValues: { notes: input.notes } });
      // Notify managers about PO edit
      const poManagers = await db.getManagerUsers();
      for (const mgr of poManagers) {
        if (mgr.id !== ctx.user.id) {
          await db.createNotification({ userId: mgr.id, title: `تعديل طلب شراء #${po.poNumber}`, message: `قام ${ctx.user.name} بتعديل طلب الشراء`, type: "po_updated", relatedPOId: input.id });
        }
      }
      return { success: true };
    }),

    delete: protectedProcedure.input(z.object({ id: z.number() })).mutation(async ({ input, ctx }) => {
      const po = await db.getPurchaseOrderById(input.id);
      if (!po) throw new TRPCError({ code: "NOT_FOUND", message: "طلب الشراء غير موجود" });
      if (!["owner", "admin", "maintenance_manager", "purchase_manager"].includes(ctx.user.role)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "ليس لديك صلاحية لحذف طلبات الشراء" });
      }
      if (["funded", "partially_purchased", "completed"].includes(po.status)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "لا يمكن حذف طلب شراء مموّل أو مكتمل" });
      }
      await db.deletePurchaseOrder(input.id);
      await db.createAuditLog({ userId: ctx.user.id, action: "delete_po", entityType: "purchase_order", entityId: input.id, oldValues: { poNumber: po.poNumber, status: po.status, notes: po.notes } });
      // Notify managers about PO deletion
      const poDelManagers = await db.getManagerUsers();
      for (const mgr of poDelManagers) {
        if (mgr.id !== ctx.user.id) {
          await db.createNotification({ userId: mgr.id, title: `حذف طلب شراء #${po.poNumber}`, message: `قام ${ctx.user.name} بحذف طلب الشراء`, type: "po_deleted", relatedPOId: input.id });
        }
      }
      return { success: true };
    }),

    editItem: protectedProcedure.input(z.object({
      id: z.number(),
      purchaseOrderId: z.number(),
      itemName: z.string().optional(),
      description: z.string().optional(),
      quantity: z.number().optional(),
      unit: z.string().optional(),
      photoUrl: z.string().optional(),
      notes: z.string().optional(),
      estimatedUnitCost: z.string().optional(),
    })).mutation(async ({ input, ctx }) => {
      const po = await db.getPurchaseOrderById(input.purchaseOrderId);
      if (!po) throw new TRPCError({ code: "NOT_FOUND" });
      if (!['pending_estimate', 'pending_accounting', 'draft', 'revision_needed'].includes(po.status)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "لا يمكن تعديل صنف في طلب معتمد أو ممول" });
      }

      // Enforce creator-only editing when status is 'revision_needed'
      if (po.status === 'revision_needed' && po.requestedById !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "فقط منشئ الطلب يمكنه تعديل الأصناف عند طلب المراجعة" });
      }
      const oldItem = await db.getPOItemById(input.id);
      if (!oldItem) throw new TRPCError({ code: "NOT_FOUND" });
      const updates: any = {};
      if (input.itemName !== undefined) updates.itemName = input.itemName;
      if (input.description !== undefined) updates.description = input.description;
      if (input.quantity !== undefined) updates.quantity = input.quantity;
      if (input.unit !== undefined) updates.unit = input.unit;
      if (input.photoUrl !== undefined) updates.photoUrl = input.photoUrl;
      if (input.notes !== undefined) updates.notes = input.notes;
      if (input.estimatedUnitCost !== undefined) {
        updates.estimatedUnitCost = input.estimatedUnitCost;
        updates.estimatedTotalCost = String(parseFloat(input.estimatedUnitCost) * (input.quantity || oldItem.quantity));
      } else if (input.quantity !== undefined && oldItem.estimatedUnitCost) {
        updates.estimatedTotalCost = String(parseFloat(oldItem.estimatedUnitCost) * input.quantity);
      }
      await db.updatePOItem(input.id, updates);
      await db.createAuditLog({
        userId: ctx.user.id, action: "update", entityType: "purchase_order_item", entityId: input.id,
        oldValues: { itemName: oldItem.itemName, description: oldItem.description, quantity: oldItem.quantity, unit: oldItem.unit, estimatedUnitCost: oldItem.estimatedUnitCost, photoUrl: oldItem.photoUrl, notes: oldItem.notes },
        newValues: updates,

      });
      return { success: true };
    }),

    deleteItem: protectedProcedure.input(z.object({ id: z.number(), purchaseOrderId: z.number() })).mutation(async ({ input, ctx }) => {
      const po = await db.getPurchaseOrderById(input.purchaseOrderId);
      if (!po) throw new TRPCError({ code: "NOT_FOUND" });
      if (!["pending_estimate", "pending_accounting"].includes(po.status)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "لا يمكن حذف صنف من طلب معتمد" });
      }
      const item = await db.getPOItemById(input.id);
      await db.deletePOItem(input.id);
      await db.createAuditLog({ userId: ctx.user.id, action: "delete_po_item", entityType: "purchase_order_item", entityId: input.id, oldValues: { itemName: item?.itemName, quantity: item?.quantity } });
      return { success: true };
    }),

    // Delegate estimates cost
    estimateCost: delegateProcedure.input(z.object({
      purchaseOrderId: z.number(),
      items: z.array(z.object({
        id: z.number(),
        estimatedUnitCost: z.string(),
      })),
    })).mutation(async ({ input, ctx }) => {
      let totalEstimated = 0;
      for (const item of input.items) {
        const cost = parseFloat(item.estimatedUnitCost);
        const poItem = (await db.getPOItems(input.purchaseOrderId)).find(i => i.id === item.id);
        // Guard: item must have a delegateId assigned before it can be estimated
        if (!poItem?.delegateId) {
          throw new TRPCError({ code: "BAD_REQUEST", message: `الصنف "${poItem?.itemName || item.id}" لا يمكن تسعيره قبل تعيين مندوب له` });
        }
        const totalCost = cost * (poItem?.quantity || 1);
        totalEstimated += totalCost;
        await db.updatePOItem(item.id, { estimatedUnitCost: item.estimatedUnitCost, estimatedTotalCost: String(totalCost), status: "estimated" });
      }
      // Check if all items are estimated (excluding rejected/cancelled items)
      const allItems = await db.getPOItems(input.purchaseOrderId);
      const allEstimated = allItems.every(i => i.status === "estimated" || i.status === "rejected" || i.status === "cancelled");
      if (allEstimated) {
        // Recalculate total estimated cost to ensure we only sum non-rejected/non-cancelled items
        const finalTotalEstimated = allItems.filter(i => i.status !== "rejected" && i.status !== "cancelled").reduce((sum, i) => sum + parseFloat(i.estimatedTotalCost || "0"), 0);
        await db.updatePurchaseOrder(input.purchaseOrderId, { status: "pending_accounting", totalEstimatedCost: String(finalTotalEstimated) });
        // Notify accountants
        const accountants = await db.getUsersByRole("accountant");
        for (const acc of accountants) {
          await db.createNotification({ userId: acc.id, title: "طلب شراء بانتظار الاعتماد", message: `طلب شراء بانتظار اعتماد الحسابات`, type: "warning", relatedPOId: input.purchaseOrderId });
        }
      }
      return { success: true };
    }),

    // Accounting approval
    approveAccounting: accountantProcedure.input(z.object({
      id: z.number(),
      notes: z.string().optional(),
      custodyAmount: z.string().optional(),
      rejectedItemIds: z.array(z.number()).optional(),
      rejectionReason: z.string().optional(),
    })).mutation(async ({ input, ctx }) => {
      const items = await db.getPOItems(input.id);
      
      // Process item rejections if any
      if (input.rejectedItemIds && input.rejectedItemIds.length > 0) {
        for (const itemId of input.rejectedItemIds) {
          // Verify item belongs to PO
          const item = items.find(i => i.id === itemId);
          if (item) {
            await db.updatePOItem(itemId, { 
              status: "rejected", 
              managementRejectionReason: input.rejectionReason || "مرفوض من قبل الحسابات"
            });
            await db.createAuditLog({ 
              userId: ctx.user.id, 
              action: "reject_po_item", 
              entityType: "purchase_order_item", 
              entityId: itemId,
              newValues: { reason: input.rejectionReason || "مرفوض من قبل الحسابات" }
            });
          }
        }
      }

            // Check if all items are now rejected or cancelled
      const updatedItems = await db.getPOItems(input.id);
      const allRejected = updatedItems.every(i => i.status === "rejected" || i.status === "cancelled");
      if (allRejected) {
        // If all items are rejected/cancelled, reject the entire PO
        await db.updatePurchaseOrder(input.id, { 
          status: "rejected", 
          rejectedById: ctx.user.id, 
          rejectedAt: new Date(), 
          rejectionReason: "تم رفض جميع الأصناف من قبل الحسابات" 
        });
        
        // Notify PO creator
        const po = await db.getPurchaseOrderById(input.id);
        if (po) {
          await db.createNotification({ userId: po.requestedById, title: "❌ طلب شراء مرفوض", message: `تم رفض جميع أصناف طلب الشراء رقم ${po.poNumber || input.id} من قبل الحسابات.`, type: "error", relatedPOId: input.id });
        }
      } else {
        // Normal flow: PO goes to management
        await db.updatePurchaseOrder(input.id, { status: "pending_management", accountingApprovedById: ctx.user.id, accountingApprovedAt: new Date(), accountingNotes: input.notes, custodyAmount: input.custodyAmount || null });
        
        // Notify senior management
        const mgmt = await db.getUsersByRole("senior_management");
        const po = await db.getPurchaseOrderById(input.id);
        const custodyMsg = input.custodyAmount ? ` مبلغ العهدة: ${Number(input.custodyAmount).toLocaleString("ar-SA")} ر.س.` : "";
        for (const m of mgmt) {
          await db.createNotification({ userId: m.id, title: "طلب شراء بانتظار اعتمادك", message: `طلب شراء رقم ${po?.poNumber || input.id} بانتظار اعتماد الإدارة العليا.${custodyMsg}`, type: "warning", relatedPOId: input.id });
        }
      }
      
      await db.createAuditLog({ userId: ctx.user.id, action: "approve_accounting", entityType: "purchase_order", entityId: input.id });
      return { success: true };
    }),

    // Management approval
    approveManagement: managementProcedure.input(z.object({
      id: z.number(),
      notes: z.string().optional(),
      rejectedItemIds: z.array(z.number()).optional(),
      rejectionReason: z.string().optional(),
    })).mutation(async ({ input, ctx }) => {
      const po = await db.getPurchaseOrderById(input.id);
      const items = await db.getPOItems(input.id);

      // Process item rejections if any
      if (input.rejectedItemIds && input.rejectedItemIds.length > 0) {
        for (const itemId of input.rejectedItemIds) {
          // Verify item belongs to PO
          const item = items.find(i => i.id === itemId);
          if (item) {
            await db.updatePOItem(itemId, { 
              status: "rejected", 
              managementRejectionReason: input.rejectionReason || "مرفوض من قبل الإدارة"
            });
            await db.createAuditLog({ 
              userId: ctx.user.id, 
              action: "reject_po_item", 
              entityType: "purchase_order_item", 
              entityId: itemId,
              newValues: { reason: input.rejectionReason || "مرفوض من قبل الإدارة" }
            });
          }
        }
      }

      // Check if all items are now rejected or cancelled
      const updatedItems = await db.getPOItems(input.id);
      const allRejected = updatedItems.every(i => i.status === "rejected" || i.status === "cancelled");

      if (allRejected) {
        // If all items are rejected/cancelled, reject the entire PO
        await db.updatePurchaseOrder(input.id, { 
          status: "rejected", 
          rejectedById: ctx.user.id, 
          rejectedAt: new Date(), 
          rejectionReason: "تم رفض جميع الأصناف من قبل الإدارة" 
        });
        
        // Notify PO creator
        if (po) {
          await db.createNotification({ userId: po.requestedById, title: "❌ طلب شراء مرفوض", message: `تم رفض جميع أصناف طلب الشراء رقم ${po.poNumber || input.id} من قبل الإدارة.`, type: "error", relatedPOId: input.id });
        }
        
        await db.createAuditLog({ userId: ctx.user.id, action: "approve_management", entityType: "purchase_order", entityId: input.id, newValues: { status: "rejected_all_items" } });
        return { success: true };
      }

      // Normal flow: PO is approved (partially or fully)
      await db.updatePurchaseOrder(input.id, { status: "approved", managementApprovedById: ctx.user.id, managementApprovedAt: new Date(), managementNotes: input.notes });
      
      // Update non-rejected/non-cancelled items to approved
      for (const item of updatedItems) {
        if (item.status !== "rejected" && item.status !== "cancelled") {
          await db.updatePOItem(item.id, { status: "approved" });
        }
      }
      
      // Notify delegates — only for non-rejected/non-cancelled items
      const approvedItemsForNotif = updatedItems.filter(i => i.status !== "rejected" && i.status !== "cancelled");
      const delegateIds = Array.from(new Set(approvedItemsForNotif.filter(i => i.delegateId).map(i => i.delegateId!)));
      for (const dId of delegateIds) {
        const delegateItems = items.filter(i => i.delegateId === dId);
        const itemNames = delegateItems.map(i => i.itemName).join("، ");
        const custodyInfo = po?.custodyAmount ? ` مبلغ العهدة المُصرف لك: ${Number(po.custodyAmount).toLocaleString("ar-SA")} ر.س.` : "";
        await db.createNotification({
          userId: dId,
          title: "✅ تم اعتماد طلب الشراء - ابدأ الشراء الآن",
          message: `تم اعتماد طلب الشراء رقم ${po?.poNumber || input.id} من قِبل الإدارة. الأصناف المطلوبة منك: ${itemNames}.${custodyInfo} يمكنك البدء بالشراء فوراً.`,
          type: "success",
          relatedPOId: input.id
        });
      }
      // If no delegates assigned, notify managers
      if (delegateIds.length === 0) {
        const managers = await db.getManagerUsers();
        for (const mgr of managers) {
          await db.createNotification({
            userId: mgr.id,
            title: "✅ تم اعتماد طلب الشراء",
            message: `تم اعتماد طلب الشراء رقم ${po?.poNumber || input.id}. لا يوجد مندوب مُعيَّن للأصناف.`,
            type: "warning",
            relatedPOId: input.id
          });
        }
      }
      // Update ticket (Path C: keep at work_approved, notify gate security)
      if (po?.ticketId) {
        const ticketForPath = await db.getTicketById(po.ticketId);
        if (ticketForPath?.maintenancePath === "C") {
          // Path C: do NOT change ticket status — gate security must approve exit first
          const gateUsers = await db.getUsersByRole("gate_security");
          for (const g of gateUsers) {
            await db.createNotification({
              userId: g.id,
              title: "🚪 أصل بانتظار الموافقة على الخروج",
              message: `البلاغ ${ticketForPath.ticketNumber} - تمت الموافقة على تكلفة الإصلاح، الأصل جاهز للخروج`,
              type: "info",
              relatedTicketId: po.ticketId
            });
          }
        } else {
          // Path A or B: normal behavior
          await db.updateTicket(po.ticketId, { status: "purchase_approved" });
          await db.addTicketStatusHistory({ ticketId: po.ticketId, fromStatus: "purchase_pending_management", toStatus: "purchase_approved", changedById: ctx.user.id });
        }
      }
      await db.createAuditLog({ userId: ctx.user.id, action: "approve_management", entityType: "purchase_order", entityId: input.id });
      return { success: true };
    }),

    // Reject PO
    reject: protectedProcedure.input(z.object({
      id: z.number(),
      reason: z.string().min(1),
    })).mutation(async ({ input, ctx }) => {
      const poReject = await db.getPurchaseOrderById(input.id);
      await db.updatePurchaseOrder(input.id, { status: "rejected", rejectedById: ctx.user.id, rejectedAt: new Date(), rejectionReason: input.reason });
      // Notify PO creator and managers
      if (poReject?.requestedById && poReject.requestedById !== ctx.user.id) {
        await db.createNotification({ userId: poReject.requestedById, title: "❌ تم رفض طلب الشراء", message: `تم رفض طلب الشراء رقم ${poReject.poNumber}. السبب: ${input.reason}`, type: "critical", relatedPOId: input.id });
      }
      const managersReject = await db.getManagerUsers();
      for (const mgr of managersReject) {
        if (mgr.id !== ctx.user.id) {
          await db.createNotification({ userId: mgr.id, title: "❌ رفض طلب شراء", message: `تم رفض طلب الشراء رقم ${poReject?.poNumber || input.id}. السبب: ${input.reason}`, type: "critical", relatedPOId: input.id });
        }
      }
      return { success: true };
    }),

    // ============ مرحلة المراجعة: اعتماد/رفض الأصناف وتعيين المندوبين ============
    reviewItems: managerProcedure.input(z.object({
      poId: z.number(),
      items: z.array(z.object({
        id: z.number(),
        action: z.enum(["approve", "reject"]),
        delegateId: z.number().optional(),
        rejectionReason: z.string().optional(),
      })),
    })).mutation(async ({ input, ctx }) => {
      const po = await db.getPurchaseOrderById(input.poId);
      if (!po) throw new TRPCError({ code: "NOT_FOUND", message: "طلب الشراء غير موجود" });
      if (po.status !== "pending_review") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "طلب الشراء ليس في مرحلة المراجعة" });
      }
      // ── Atomic validation: fetch all DB items for this PO before any updates ──
      const dbItems = await db.getPOItems(input.poId);
      // A) Count check: submitted items must equal DB items (no partial submission)
      if (input.items.length !== dbItems.length) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `يجب مراجعة جميع الأصناف (${dbItems.length} صنف). تم إرسال ${input.items.length} فقط` });
      }
      // B) Ownership check: every submitted item.id must belong to this PO
      const dbItemIds = new Set(dbItems.map((i: any) => i.id));
      for (const reviewItem of input.items) {
        if (!dbItemIds.has(reviewItem.id)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: `الصنف رقم ${reviewItem.id} لا ينتمي لطلب الشراء هذا` });
        }
      }
      // ── Validate each item action ──
      for (const reviewItem of input.items) {
        if (reviewItem.action === "approve" && !reviewItem.delegateId) {
          throw new TRPCError({ code: "BAD_REQUEST", message: `الصنف رقم ${reviewItem.id}: يجب تعيين مندوب للأصناف المعتمدة` });
        }
        if (reviewItem.action === "reject" && !reviewItem.rejectionReason) {
          throw new TRPCError({ code: "BAD_REQUEST", message: `الصنف رقم ${reviewItem.id}: يجب إدخال سبب رفض الأصناف المرفوضة` });
        }
      }
      // Apply per-item decisions
      for (const reviewItem of input.items) {
        if (reviewItem.action === "approve") {
          await db.updatePOItem(reviewItem.id, {
            status: "pending",
            delegateId: reviewItem.delegateId,
            rejectionReason: null,
          });
        } else {
          await db.updatePOItem(reviewItem.id, {
            status: "rejected",
            rejectionReason: reviewItem.rejectionReason,
          });
        }
      }
      // Determine new PO status
      const allItems = await db.getPOItems(input.poId);
      const hasApproved = allItems.some(i => i.status === "pending");
      const allRejected = allItems.every(i => i.status === "rejected" || i.status === "cancelled");
      if (allRejected) {
        await db.updatePurchaseOrder(input.poId, { status: "rejected", rejectedById: ctx.user.id, rejectedAt: new Date(), rejectionReason: "تم رفض جميع الأصناف" });
        // Notify PO creator
        if (po.requestedById && po.requestedById !== ctx.user.id) {
          await db.createNotification({ userId: po.requestedById, title: "❌ تم رفض جميع أصناف طلب الشراء", message: `تم رفض جميع أصناف طلب الشراء رقم ${po.poNumber}.`, type: "critical", relatedPOId: input.poId });
        }
      } else if (hasApproved) {
        await db.updatePurchaseOrder(input.poId, { status: "pending_estimate" });
        // Notify assigned delegates
        const approvedItems = allItems.filter(i => i.status === "pending" && i.delegateId);
        const delegateIds = Array.from(new Set(approvedItems.map(i => i.delegateId!)));
        for (const dId of delegateIds) {
          const delegateItems = approvedItems.filter(i => i.delegateId === dId);
          const itemNames = delegateItems.map(i => i.itemName).join("، ");
          await db.createNotification({ userId: dId, title: "طلب شراء جديد — ابدأ التسعير", message: `تم تخصيص الأصناف التالية لك في طلب الشراء ${po.poNumber}: ${itemNames}`, type: "info", relatedPOId: input.poId });
        }
        // Notify PO creator if some items were rejected
        const rejectedItems = allItems.filter(i => i.status === "rejected");
        if (rejectedItems.length > 0 && po.requestedById && po.requestedById !== ctx.user.id) {
          const rejectedNames = rejectedItems.map(i => i.itemName).join("، ");
          await db.createNotification({ userId: po.requestedById, title: "⚠️ بعض أصناف طلب الشراء مرفوضة", message: `تم رفض الأصناف التالية من طلب الشراء ${po.poNumber}: ${rejectedNames}`, type: "warning", relatedPOId: input.poId });
        }
      }
      await db.createAuditLog({ userId: ctx.user.id, action: "review_po_items", entityType: "purchase_order", entityId: input.poId });
      return { success: true };
    }),

    // ============ المرحلة 1: المندوب يؤكد شراء صنف ============
    confirmItemPurchase: delegateProcedure.input(z.object({
      itemId: z.number(),
      purchasedPhotoUrl: z.string().min(1, "صورة الصنف المشترى مطلوبة"),
      invoicePhotoUrl: z.string().min(1, "صورة الفاتورة مطلوبة"),
    })).mutation(async ({ input, ctx }) => {
      // Admin/owner can confirm purchase for any item; delegate only for their own
      const isAdminOrOwner = ctx.user.role === "admin" || ctx.user.role === "owner";
      let item: any;
      if (isAdminOrOwner) {
        item = await db.getPOItemById(input.itemId);
      } else {
        const allItems = await db.getPOItemsByDelegate(ctx.user.id);
        item = allItems.find(i => i.id === input.itemId);
      }
      if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "الصنف غير موجود أو غير مخصص لك" });
      if (item.status !== "approved" && item.status !== "funded") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "لا يمكن تأكيد شراء هذا الصنف في حالته الحالية" });
      }
      await db.updatePOItem(input.itemId, {
        status: "purchased",
        purchasedAt: new Date(),
        purchasedById: ctx.user.id,
        purchasedPhotoUrl: input.purchasedPhotoUrl,
        invoicePhotoUrl: input.invoicePhotoUrl,
      });
      // Update PO status (Path C: do not change ticket status — gate security controls it)
      const poItems = await db.getPOItems(item.purchaseOrderId);
      const activeItemsPurch = poItems.filter(i => i.status !== "rejected" && i.status !== "cancelled");
      const purchasedOrLater = activeItemsPurch.filter(i => ["purchased", "delivered_to_warehouse", "delivered_to_requester"].includes(i.status));
      const poForPath = await db.getPurchaseOrderById(item.purchaseOrderId);
      const ticketForPath = poForPath?.ticketId ? await db.getTicketById(poForPath.ticketId) : null;
      const isPathC = ticketForPath?.maintenancePath === "C";
      if (activeItemsPurch.length > 0 && purchasedOrLater.length === activeItemsPurch.length) {
        await db.updatePurchaseOrder(item.purchaseOrderId, { status: "purchased" });
        if (poForPath?.ticketId && !isPathC) {
          await db.updateTicket(poForPath.ticketId, { status: "purchased" });
        }
      } else if (purchasedOrLater.length > 0) {
        await db.updatePurchaseOrder(item.purchaseOrderId, { status: "partial_purchase" });
        if (poForPath?.ticketId && !isPathC) {
          await db.updateTicket(poForPath.ticketId, { status: "partial_purchase" });
        }
      }
      // Notify warehouse with detailed message
      const warehouseUsers = await db.getUsersByRole("warehouse");
      const po = await db.getPurchaseOrderById(item.purchaseOrderId);
      const buyer = ctx.user;
      for (const w of warehouseUsers) {
        await db.createNotification({
          userId: w.id,
          title: "📦 صنف تم شراؤه - بانتظار الاستلام",
          message: `تم شراء الصنف: "${item.itemName}" (الكمية: ${item.quantity} ${item.unit || ''}). طلب الشراء رقم: ${po?.poNumber || item.purchaseOrderId}. المندوب: ${buyer.name}. يرجى تسجيل استلام البضاعة عند وصولها.`,
          type: "info",
          relatedPOId: item.purchaseOrderId
        });
      }
      // Also notify managers/owner
      const managers = await db.getManagerUsers();
      for (const mgr of managers) {
        await db.createNotification({
          userId: mgr.id,
          title: "🛒 تم شراء صنف",
          message: `قام ${buyer.name} بشراء صنف "${item.itemName}" من طلب الشراء رقم ${po?.poNumber || item.purchaseOrderId}.`,
          type: "info",
          relatedPOId: item.purchaseOrderId
        });
      }
      await db.createAuditLog({ userId: ctx.user.id, action: "confirm_purchase", entityType: "po_item", entityId: input.itemId });
      return { success: true };
    }),

    // ============ المرحلة 2: المستودع يؤكد التوريد ============
    confirmDeliveryToWarehouse: warehouseProcedure.input(z.object({
      itemId: z.number(),
      supplierName: z.string().min(1, "اسم المورد مطلوب"),
      supplierItemName: z.string().optional(),
      actualUnitCost: z.string().min(1, "تكلفة الصنف مطلوبة"),
      warehousePhotoUrl: z.string().min(1, "صورة الصنف مطلوبة"),
    })).mutation(async ({ input, ctx }) => {
      // Get the item
      const item = await db.getPOItemById(input.itemId);
      if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "الصنف غير موجود" });
      if (item.status !== "purchased") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "هذا الصنف ليس في حالة \"تم الشراء\" بعد" });
      }
      const actualTotal = parseFloat(input.actualUnitCost) * item.quantity;
      await db.updatePOItem(input.itemId, {
        status: "delivered_to_warehouse",
        receivedAt: new Date(),
        receivedById: ctx.user.id,
        supplierName: input.supplierName,
        supplierItemName: input.supplierItemName || item.itemName,
        actualUnitCost: input.actualUnitCost,
        actualTotalCost: String(actualTotal),
        warehousePhotoUrl: input.warehousePhotoUrl,
      });
      // Update PO status (Path C: do not change ticket status — gate security controls it)
      const allItems = await db.getPOItems(item.purchaseOrderId);
      const activeItemsWH = allItems.filter(i => i.status !== "rejected" && i.status !== "cancelled");
      const allInWarehouse = activeItemsWH.length > 0 && activeItemsWH.every(i => ["delivered_to_warehouse", "delivered_to_requester"].includes(i.status));
      if (allInWarehouse) {
        const totalActual = activeItemsWH.reduce((sum, i) => sum + parseFloat(i.actualTotalCost || "0"), 0);
        await db.updatePurchaseOrder(item.purchaseOrderId, { status: "received", totalActualCost: String(totalActual) });
        const poWH = await db.getPurchaseOrderById(item.purchaseOrderId);
        if (poWH?.ticketId) {
          const ticketWH = await db.getTicketById(poWH.ticketId);
          if (ticketWH && ticketWH.maintenancePath !== "C") {
            await db.updateTicket(poWH.ticketId, { status: "received_warehouse" });
          }
        }
      }
      // Notify assigned technician and managers that item arrived at warehouse
      const poForNotif = await db.getPurchaseOrderById(item.purchaseOrderId);
      if (poForNotif?.ticketId) {
        const ticketForNotif = await db.getTicketById(poForNotif.ticketId);
        if (ticketForNotif?.assignedToId) {
          await db.createNotification({ userId: ticketForNotif.assignedToId, title: "📦 وصلت موادك للمستودع", message: `تم استلام الصنف "${item.itemName}" في المستودع. سيتم تسليمه لك قريباً.`, type: "info", relatedTicketId: poForNotif.ticketId });
        }
      }
      const managersWH = await db.getManagerUsers();
      for (const mgr of managersWH) {
        await db.createNotification({ userId: mgr.id, title: "📦 وصلت بضاعة للمستودع", message: `استلم المستودع الصنف "${item.itemName}" بتكلفة فعلية ${input.actualUnitCost} ر.س من المورد ${input.supplierName}`, type: "info", relatedPOId: item.purchaseOrderId });
      }
      await db.createAuditLog({ userId: ctx.user.id, action: "deliver_to_warehouse", entityType: "po_item", entityId: input.itemId, newValues: { supplierName: input.supplierName, actualUnitCost: input.actualUnitCost } });
      return { success: true };
    }),

    // ============ المرحلة 3: المستودع يسلم الصنف للفني/المسؤول ============
    confirmDeliveryToRequester: warehouseProcedure.input(z.object({
      itemId: z.number(),
      deliveredToId: z.number().optional(),
    })).mutation(async ({ input, ctx }) => {
      const item = await db.getPOItemById(input.itemId);
      if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "الصنف غير موجود" });
      if (item.status !== "delivered_to_warehouse") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "هذا الصنف لم يتم توريده للمستودع بعد" });
      }
      await db.updatePOItem(input.itemId, {
        status: "delivered_to_requester",
        deliveredAt: new Date(),
        deliveredById: ctx.user.id,
        deliveredToId: input.deliveredToId || null,
      });
      // Check if all items delivered to requester (Path C: do not change ticket status)
      const allItems = await db.getPOItems(item.purchaseOrderId);
      // Exclude rejected items from auto-close check
      const activeItems = allItems.filter(i => i.status !== "rejected" && i.status !== "cancelled");
      const allDelivered = activeItems.length > 0 && activeItems.every(i => i.status === "delivered_to_requester");
      if (allDelivered) {
        await db.updatePurchaseOrder(item.purchaseOrderId, { status: "received" });
        // Advance ticket to received_warehouse so technician can complete work via completeWithParts
        const po = await db.getPurchaseOrderById(item.purchaseOrderId);
        if (po?.ticketId) {
          const ticket = await db.getTicketById(po.ticketId);
          // Path C: gate security controls ticket status, do not advance here
          if (ticket && ticket.maintenancePath !== "C" && !["received_warehouse", "ready_for_closure", "repaired", "verified", "closed"].includes(ticket.status)) {
            await db.updateTicket(po.ticketId, { status: "received_warehouse" });
            await db.addTicketStatusHistory({ ticketId: po.ticketId, fromStatus: ticket.status, toStatus: "received_warehouse", changedById: ctx.user.id, notes: "تم تسليم جميع المواد للفني - بانتظار إتمام العمل" });
            // Notify assigned technician to complete the work
            if (ticket.assignedToId) {
              await db.createNotification({ userId: ticket.assignedToId, title: "📦 تم تسليم المواد - أكمل العمل", message: `تم تسليم جميع مواد البلاغ ${ticket.ticketNumber} إليك. يرجى إتمام العمل وإرساله للإغلاق.`, type: "info", relatedTicketId: po.ticketId });
            }
            // Notify managers
            const managers = await db.getManagerUsers();
            for (const mgr of managers) {
              await db.createNotification({ userId: mgr.id, title: "📦 مواد بلاغ جاهزة للفني", message: `تم تسليم جميع مواد البلاغ ${ticket.ticketNumber}. بانتظار إتمام الفني للعمل.`, type: "info", relatedTicketId: po.ticketId });
            }
          }
        }
      }
      await db.createAuditLog({ userId: ctx.user.id, action: "deliver_to_requester", entityType: "po_item", entityId: input.itemId });
      return { success: true };
    }),

    // Get items pending purchase (for delegate)
    pendingPurchaseItems: protectedProcedure.query(async ({ ctx }) => {
      const isAdminOrOwner = ctx.user.role === "admin" || ctx.user.role === "owner";
      if (isAdminOrOwner) {
        // Admin/owner see all approved/funded items
        const approved = await db.getPOItemsByStatus("approved");
        const funded = await db.getPOItemsByStatus("funded");
        return [...approved, ...funded];
      }
      if (ctx.user.role !== "delegate") return [];
      const items = await db.getPOItemsByDelegate(ctx.user.id);
      return items.filter(i => i.status === "approved" || i.status === "funded");
    }),

    // Get items pending warehouse receiving
    pendingWarehouseItems: protectedProcedure.query(async ({ ctx }) => {
      const isAdminOrOwner = ctx.user.role === "admin" || ctx.user.role === "owner";
      if (isAdminOrOwner || ctx.user.role === "warehouse") {
        return db.getPOItemsByStatus("purchased");
      }
      return [];
    }),

    // Get items pending delivery to technician
    pendingDeliveryItems: protectedProcedure.query(async ({ ctx }) => {
      const isAdminOrOwner = ctx.user.role === "admin" || ctx.user.role === "owner";
      if (isAdminOrOwner || ctx.user.role === "warehouse") {
        const items = await db.getPOItemsByStatus("delivered_to_warehouse");
        // Enrich each item with the assignedToId from the linked ticket
        const enriched = await Promise.all(items.map(async (item: any) => {
          const po = await db.getPurchaseOrderById(item.purchaseOrderId);
          if (po?.ticketId) {
            const ticket = await db.getTicketById(po.ticketId);
            return { ...item, ticketAssignedToId: ticket?.assignedToId ?? null };
          }
          return { ...item, ticketAssignedToId: null };
        }));
        return enriched;
      }
      return [];
    }),

    myItems: protectedProcedure.query(async ({ ctx }) => {
      const isAdminOrOwner = ctx.user.role === "admin" || ctx.user.role === "owner";
      if (isAdminOrOwner) {
        // Admin/owner see all items
        return db.getAllPOItems();
      }
      if (ctx.user.role !== "delegate") return [];
      return db.getPOItemsByDelegate(ctx.user.id);
    }),
    // ============ إلغاء صنف (soft-cancel) ============
    cancelItem: protectedProcedure.input(z.object({
      itemId: z.number(),
      reason: z.string().optional(),
    })).mutation(async ({ input, ctx }) => {
      // Only senior_management, owner, admin, maintenance_manager can cancel items
      const canCancel = ["senior_management", "owner", "admin", "maintenance_manager"].includes(ctx.user.role);
      if (!canCancel) {
        throw new TRPCError({ code: "FORBIDDEN", message: "ليس لديك صلاحية إلغاء هذا الصنف" });
      }
      const item = await db.getPOItemById(input.itemId);
      if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "الصنف غير موجود" });
      // Cannot cancel already delivered items
      if (item.status === "delivered_to_requester") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "لا يمكن إلغاء صنف تم تسليمه بالفعل" });
      }
      if (item.status === "cancelled") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "الصنف ملغى بالفعل" });
      }
      await db.updatePOItem(input.itemId, {
        status: "cancelled",
        managementRejectionReason: input.reason || "تم الإلغاء من قبل الإدارة",
      });
      // Check if all items are now terminal (rejected or cancelled) — auto-close PO if so
      const allItems = await db.getPOItems(item.purchaseOrderId);
      const allTerminal = allItems.every(i => i.status === "rejected" || i.status === "cancelled");
      if (allTerminal) {
        const po = await db.getPurchaseOrderById(item.purchaseOrderId);
        await db.updatePurchaseOrder(item.purchaseOrderId, {
          status: "rejected",
          rejectedById: ctx.user.id,
          rejectedAt: new Date(),
          rejectionReason: "تم إلغاء جميع أصناف طلب الشراء",
        });
        if (po) {
          await db.createNotification({ userId: po.requestedById, title: "⚠️ تم إلغاء جميع أصناف طلب الشراء", message: `تم إلغاء جميع أصناف طلب الشراء رقم ${po.poNumber}.`, type: "warning", relatedPOId: item.purchaseOrderId });
        }
      }
      await db.createAuditLog({ userId: ctx.user.id, action: "cancel_po_item", entityType: "purchase_order_item", entityId: input.itemId, newValues: { reason: input.reason } });
      return { success: true };
    }),
  }),

  // ============================================================
  // INVENTORY
  // ============================================================
  inventory: router({
    list: protectedProcedure.query(async () => {
      return db.getInventoryItems();
    }),
    create: warehouseProcedure.input(z.object({
      itemName: z.string().min(1),
      description: z.string().optional(),
      quantity: z.number().default(0),
      unit: z.string().optional(),
      minQuantity: z.number().optional(),
      location: z.string().optional(),
      siteId: z.number().optional(),
    })).mutation(async ({ input, ctx }) => {
      const id = await db.createInventoryItem(input);
      await db.createAuditLog({ userId: ctx.user.id, action: "create_inventory", entityType: "inventory", entityId: id! });
      return { id };
    }),
    update: warehouseProcedure.input(z.object({
      id: z.number(),
      itemName: z.string().optional(),
      description: z.string().optional(),
      unit: z.string().optional(),
      minQuantity: z.number().optional(),
      location: z.string().optional(),
      siteId: z.number().optional(),
    })).mutation(async ({ input, ctx }) => {
      const item = await db.getInventoryItemById(input.id);
      if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "الصنف غير موجود" });
      const { id, ...updateData } = input;
      const oldValues = { itemName: item.itemName, description: item.description, unit: item.unit, minQuantity: item.minQuantity, location: item.location };
      await db.updateInventoryItem(id, updateData);
      await db.createAuditLog({ userId: ctx.user.id, action: "update_inventory", entityType: "inventory", entityId: id, oldValues, newValues: updateData });
      return { success: true };
    }),

    delete: warehouseProcedure.input(z.object({ id: z.number() })).mutation(async ({ input, ctx }) => {
      const item = await db.getInventoryItemById(input.id);
      if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "الصنف غير موجود" });
      await db.deleteInventoryItem(input.id);
      await db.createAuditLog({ userId: ctx.user.id, action: "delete_inventory", entityType: "inventory", entityId: input.id, oldValues: { itemName: item.itemName, quantity: item.quantity } });
      return { success: true };
    }),

    addTransaction: protectedProcedure.input(z.object({
      inventoryId: z.number(),
      type: z.enum(["in", "out"]),
      quantity: z.number().min(1),
      reason: z.string().optional(),
      ticketId: z.number().optional(),
    })).mutation(async ({ input, ctx }) => {
      await db.addInventoryTransaction({ ...input, performedById: ctx.user.id });
      return { success: true };
    }),
  }),

  // ============================================================
  // NOTIFICATIONS
  // ============================================================
  notifications: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      return db.getUserNotifications(ctx.user.id);
    }),
    unreadCount: protectedProcedure.query(async ({ ctx }) => {
      return db.getUnreadNotificationCount(ctx.user.id);
    }),
    markRead: protectedProcedure.input(z.object({ id: z.number() })).mutation(async ({ input, ctx }) => {
      await db.markNotificationRead(input.id, ctx.user.id);
      return { success: true };
    }),
    markAllRead: protectedProcedure.mutation(async ({ ctx }) => {
      await db.markAllNotificationsRead(ctx.user.id);
      return { success: true };
    }),
  }),

  // ============================================================
  // FILE UPLOAD
  // ============================================================
  upload: router({
    getPresignedUrl: protectedProcedure.input(z.object({
      fileName: z.string(),
      contentType: z.string(),
      entityType: z.string(),
      entityId: z.number().optional(),
    })).mutation(async ({ input, ctx }) => {
      const fileKey = `cmms/${input.entityType}/${Date.now()}-${nanoid(8)}-${input.fileName}`;
      return { fileKey, uploadUrl: `/api/upload` };
    }),
  }),

  // ============================================================
  // ATTACHMENTS
  // ============================================================
  attachments: router({
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
  }),

  // ============================================================
  // DASHBOARD
  // ============================================================
  dashboard: router({
    stats: protectedProcedure.query(async () => {
      return db.getDashboardStats();
    }),
    pmMonthlySummary: protectedProcedure.query(async () => {
      const ddb = await db.getDb();
      if (!ddb) return { activePlans: 0, completedThisMonth: 0, pendingThisMonth: 0, overdueCount: 0, completionRate: 0, totalWorkOrders: 0 };

      const { preventivePlans, pmWorkOrders } = await import("../../drizzle/schema");

      // الخطط النشطة
      const activePlans = await ddb.select().from(preventivePlans).where(eq(preventivePlans.isActive, true));

      // أوامر العمل هذا الشهر
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

      const allWOs = await ddb.select().from(pmWorkOrders);

      const thisMonthWOs = allWOs.filter((wo: any) => {
        const d = new Date(wo.scheduledDate || wo.createdAt);
        return d >= monthStart && d <= monthEnd;
      });

      const completedThisMonth = thisMonthWOs.filter((wo: any) => wo.status === "completed").length;
      const pendingThisMonth = thisMonthWOs.filter((wo: any) => wo.status !== "completed" && wo.status !== "cancelled").length;

      // المتأخرة (scheduledDate < اليوم وليست مكتملة)
      const overdueCount = allWOs.filter((wo: any) => {
        if (wo.status === "completed" || wo.status === "cancelled") return false;
        const d = new Date(wo.scheduledDate || wo.createdAt);
        return d < now;
      }).length;

      const totalThisMonth = thisMonthWOs.length;
      const completionRate = totalThisMonth > 0 ? Math.round((completedThisMonth / totalThisMonth) * 100) : 0;

      return {
        activePlans: activePlans.length,
        completedThisMonth,
        pendingThisMonth,
        overdueCount,
        completionRate,
        totalWorkOrders: totalThisMonth,
      };
    }),
  }),

  // ============================================================
  // REPORTS
  // ============================================================
  reports: router({
    ticketsByStatus: protectedProcedure.query(async () => {
      const allTickets = await db.getTickets();
      const statusCounts: Record<string, number> = {};
      allTickets.forEach(t => { statusCounts[t.status] = (statusCounts[t.status] || 0) + 1; });
      return Object.entries(statusCounts).map(([status, count]) => ({ status, count }));
    }),
    ticketsByCategory: protectedProcedure.query(async () => {
      const allTickets = await db.getTickets();
      const catCounts: Record<string, number> = {};
      allTickets.forEach(t => { catCounts[t.category] = (catCounts[t.category] || 0) + 1; });
      return Object.entries(catCounts).map(([category, count]) => ({ category, count }));
    }),
    ticketsByPriority: protectedProcedure.query(async () => {
      const allTickets = await db.getTickets();
      const priCounts: Record<string, number> = {};
      allTickets.forEach(t => { priCounts[t.priority] = (priCounts[t.priority] || 0) + 1; });
      return Object.entries(priCounts).map(([priority, count]) => ({ priority, count }));
    }),
    costComparison: protectedProcedure.query(async () => {
      const pos = await db.getPurchaseOrders();
      return pos.map(po => ({
        poNumber: po.poNumber,
        estimated: parseFloat(po.totalEstimatedCost || "0"),
        actual: parseFloat(po.totalActualCost || "0"),
      }));
    }),
    monthlySummary: protectedProcedure.query(async () => {
      const allTickets = await db.getTickets();
      const monthly: Record<string, { created: number; closed: number }> = {};
      allTickets.forEach(t => {
        const month = new Date(t.createdAt).toISOString().slice(0, 7);
        if (!monthly[month]) monthly[month] = { created: 0, closed: 0 };
        monthly[month].created++;
        if (t.status === "closed") monthly[month].closed++;
      });
      return Object.entries(monthly).map(([month, data]) => ({ month, ...data })).sort((a, b) => a.month.localeCompare(b.month));
    }),
    technicianPerformance: protectedProcedure.input(z.object({
      period: z.enum(["week", "month", "quarter", "year", "all", "custom"]).default("all"),
      dateFrom: z.string().optional(),
      dateTo: z.string().optional(),
      siteId: z.number().optional(),
      sectionId: z.number().optional(),
      technicianName: z.string().optional(),
    }).optional()).query(async ({ input }) => {
      const period = input?.period || "all";
      let dateFrom: Date | undefined;
      let dateTo: Date | undefined;

      if (period === "custom" && input?.dateFrom && input?.dateTo) {
        dateFrom = new Date(input.dateFrom);
        dateTo = new Date(input.dateTo);
        dateTo.setHours(23, 59, 59, 999);
      } else if (period !== "all") {
        dateTo = new Date();
        dateFrom = new Date();
        switch (period) {
          case "week":
            dateFrom.setDate(dateFrom.getDate() - 7);
            break;
          case "month":
            dateFrom.setMonth(dateFrom.getMonth() - 1);
            break;
          case "quarter":
            dateFrom.setMonth(dateFrom.getMonth() - 3);
            break;
          case "year":
            dateFrom.setFullYear(dateFrom.getFullYear() - 1);
            break;
        }
      }

      return db.getTechnicianPerformance({
        ...(period !== "all" ? { dateFrom, dateTo } : {}),
        siteId: input?.siteId,
        sectionId: input?.sectionId,
        technicianName: input?.technicianName,
      });
    }),

    externalTechnicianPerformance: protectedProcedure.input(z.object({
      period: z.enum(["week", "month", "quarter", "year", "all", "custom"]).default("all"),
      dateFrom: z.string().optional(),
      dateTo: z.string().optional(),
    }).optional()).query(async ({ input }) => {
      const period = input?.period || "all";
      let dateFrom: Date | undefined;
      let dateTo: Date | undefined;
      if (period === "custom" && input?.dateFrom && input?.dateTo) {
        dateFrom = new Date(input.dateFrom);
        dateTo = new Date(input.dateTo);
        dateTo.setHours(23, 59, 59, 999);
      } else if (period !== "all") {
        dateTo = new Date();
        dateFrom = new Date();
        switch (period) {
          case "week": dateFrom.setDate(dateFrom.getDate() - 7); break;
          case "month": dateFrom.setMonth(dateFrom.getMonth() - 1); break;
          case "quarter": dateFrom.setMonth(dateFrom.getMonth() - 3); break;
          case "year": dateFrom.setFullYear(dateFrom.getFullYear() - 1); break;
        }
      }
      return db.getExternalTechnicianPerformance(period === "all" ? undefined : { dateFrom, dateTo });
    }),

    // ── تقرير دورة الشراء ─────────────────────────────────────────────────────
    purchaseCycleReport: protectedProcedure.input(z.object({
      dateFrom: z.string().optional(),
      dateTo: z.string().optional(),
      poId: z.number().optional(),
    }).optional()).query(async ({ input }) => {
      const [allPOs, allUsers, allItems, allTickets] = await Promise.all([
        db.getPurchaseOrders(),
        db.getAllUsers(),
        db.getAllPOItems(),
        db.getTickets(),
      ]);

      let pos = allPOs;
      if (input?.dateFrom) {
        const from = new Date(input.dateFrom);
        pos = pos.filter(p => new Date(p.createdAt) >= from);
      }
      if (input?.dateTo) {
        const to = new Date(input.dateTo);
        to.setHours(23, 59, 59, 999);
        pos = pos.filter(p => new Date(p.createdAt) <= to);
      }
      if (input?.poId) {
        pos = pos.filter(p => p.id === input.poId);
      }

      const msToHours = (ms: number) => Math.round(ms / 3600000 * 10) / 10;

      const result = pos.map(po => {
        const items = allItems.filter(i => i.purchaseOrderId === po.id);
        const ticket = po.ticketId ? allTickets.find(t => t.id === po.ticketId) : null;
        const requestedBy = allUsers.find(u => u.id === po.requestedById)?.name || "غير معروف";
        const accountingApprovedBy = allUsers.find(u => u.id === po.accountingApprovedById)?.name;
        const managementApprovedBy = allUsers.find(u => u.id === po.managementApprovedById)?.name;

        const t0 = new Date(po.createdAt).getTime();
        const t1 = po.accountingApprovedAt ? new Date(po.accountingApprovedAt).getTime() : null;
        const t2 = po.managementApprovedAt ? new Date(po.managementApprovedAt).getTime() : null;

        const poPhases = [
          { phase: "إنشاء الطلب", startAt: new Date(po.createdAt), endAt: po.accountingApprovedAt ? new Date(po.accountingApprovedAt) : null, durationHours: t1 ? msToHours(t1 - t0) : null, actor: requestedBy, status: "done" },
          { phase: "موافقة الحسابات", startAt: po.accountingApprovedAt ? new Date(po.accountingApprovedAt) : null, endAt: po.managementApprovedAt ? new Date(po.managementApprovedAt) : null, durationHours: t1 && t2 ? msToHours(t2 - t1) : null, actor: accountingApprovedBy || null, status: po.accountingApprovedAt ? "done" : "pending" },
          { phase: "موافقة الإدارة", startAt: po.managementApprovedAt ? new Date(po.managementApprovedAt) : null, endAt: null, durationHours: null, actor: managementApprovedBy || null, status: po.managementApprovedAt ? "done" : "pending" },
        ];

        const itemsReport = items.map(item => {
          const delegate = allUsers.find(u => u.id === item.delegateId)?.name || "غير مُعيَّن";
          const receivedBy = allUsers.find(u => u.id === item.receivedById)?.name;
          const deliveredBy = allUsers.find(u => u.id === item.deliveredById)?.name;
          const purchasedBy = allUsers.find(u => u.id === item.purchasedById)?.name;

          const tCreated = new Date(item.createdAt).getTime();
          const tPurchased = item.purchasedAt ? new Date(item.purchasedAt).getTime() : null;
          const tReceived = item.receivedAt ? new Date(item.receivedAt).getTime() : null;
          const tDelivered = item.deliveredAt ? new Date(item.deliveredAt).getTime() : null;

          const phases = [
            { phase: "انتظار التسعير", startAt: new Date(item.createdAt), endAt: item.estimatedUnitCost ? new Date(item.updatedAt) : null, durationHours: item.estimatedUnitCost && t2 ? msToHours(t2 - tCreated) : null, status: item.estimatedUnitCost ? "done" : "pending" },
            { phase: "اعتماد الشراء", startAt: po.managementApprovedAt ? new Date(po.managementApprovedAt) : null, endAt: item.purchasedAt ? new Date(item.purchasedAt) : null, durationHours: t2 && tPurchased ? msToHours(tPurchased - t2) : null, status: item.purchasedAt ? "done" : (po.managementApprovedAt ? "in_progress" : "pending") },
            { phase: "شراء المندوب", startAt: item.purchasedAt ? new Date(item.purchasedAt) : null, endAt: item.receivedAt ? new Date(item.receivedAt) : null, durationHours: tPurchased && tReceived ? msToHours(tReceived - tPurchased) : null, actor: purchasedBy || delegate, status: item.purchasedAt ? "done" : "pending" },
            { phase: "استلام المستودع", startAt: item.receivedAt ? new Date(item.receivedAt) : null, endAt: item.deliveredAt ? new Date(item.deliveredAt) : null, durationHours: tReceived && tDelivered ? msToHours(tDelivered - tReceived) : null, actor: receivedBy || null, status: item.receivedAt ? "done" : "pending" },
            { phase: "تسليم للفني", startAt: item.deliveredAt ? new Date(item.deliveredAt) : null, endAt: null, durationHours: null, actor: deliveredBy || null, status: item.deliveredAt ? "done" : "pending" },
          ];

          const totalHours = tDelivered ? msToHours(tDelivered - tCreated) : null;

          return {
            itemId: item.id, itemName: item.itemName, quantity: item.quantity, unit: item.unit,
            delegate, estimatedCost: item.estimatedTotalCost ? parseFloat(item.estimatedTotalCost) : null,
            actualCost: item.actualTotalCost ? parseFloat(item.actualTotalCost) : null,
            currentStatus: item.status, totalHours, phases,
          };
        });

        const completedItems = itemsReport.filter(i => i.totalHours !== null);
        const totalPOHours = completedItems.length > 0
          ? Math.round(completedItems.reduce((s, i) => s + (i.totalHours || 0), 0) / completedItems.length * 10) / 10
          : null;

        return {
          poId: po.id, poNumber: po.poNumber, status: po.status, requestedBy,
          createdAt: new Date(po.createdAt), ticketId: po.ticketId,
          ticketNumber: ticket?.ticketNumber || null,
          custodyAmount: po.custodyAmount ? parseFloat(po.custodyAmount) : null,
          poPhases, items: itemsReport, totalPOHours, itemCount: items.length,
        };
      });

      const completedPOs = result.filter(r => r.totalPOHours !== null);
      const avgTotalHours = completedPOs.length > 0
        ? Math.round(completedPOs.reduce((s, r) => s + (r.totalPOHours || 0), 0) / completedPOs.length * 10) / 10
        : null;

      const phaseNames = ["انتظار التسعير", "اعتماد الشراء", "شراء المندوب", "استلام المستودع", "تسليم للفني"];
      const phaseAvgs = phaseNames.map(phaseName => {
        const durations: number[] = result.flatMap(r => r.items.flatMap(i => i.phases.filter(p => p.phase === phaseName && p.durationHours !== null).map(p => p.durationHours as number)));
        return { phase: phaseName, avgHours: durations.length > 0 ? Math.round(durations.reduce((s: number, d: number) => s + d, 0) / durations.length * 10) / 10 : null, count: durations.length };
      });

      return { pos: result, avgTotalHours, phaseAvgs, total: result.length };
    }),

    // ── تقرير دورة الصيانة ────────────────────────────────────────────────────
    maintenanceCycleReport: protectedProcedure.input(z.object({
      dateFrom: z.string().optional(),
      dateTo: z.string().optional(),
      ticketId: z.number().optional(),
      status: z.string().optional(),
    }).optional()).query(async ({ input }) => {
      const [allTickets, allUsers, allSites] = await Promise.all([
        db.getTickets(),
        db.getAllUsers(),
        db.getAllSites(),
      ]);

      let tickets = allTickets;
      if (input?.dateFrom) { const from = new Date(input.dateFrom); tickets = tickets.filter(t => new Date(t.createdAt) >= from); }
      if (input?.dateTo) { const to = new Date(input.dateTo); to.setHours(23, 59, 59, 999); tickets = tickets.filter(t => new Date(t.createdAt) <= to); }
      if (input?.ticketId) { tickets = tickets.filter(t => t.id === input.ticketId); }
      if (input?.status) { tickets = tickets.filter(t => t.status === input.status); }

      const msToHours = (ms: number) => Math.round(ms / 3600000 * 10) / 10;

      const STAGE_LABELS: Record<string, string> = {
        "new": "إنشاء البلاغ", "pending_triage": "انتظار الفرز", "under_inspection": "قيد الفحص",
        "work_approved": "موافقة على العمل", "approved": "موافقة الإدارة", "assigned": "تعيين فني",
        "in_progress": "قيد التنفيذ", "needs_purchase": "يحتاج شراء", "purchase_pending_estimate": "انتظار تسعير",
        "purchase_pending_accounting": "انتظار الحسابات", "purchase_pending_management": "انتظار الإدارة",
        "purchase_approved": "شراء معتمد", "partial_purchase": "شراء جزئي", "purchased": "تم الشراء",
        "received_warehouse": "استلام مستودع", "repaired": "تم الإصلاح", "verified": "تم التحقق",
        "ready_for_closure": "جاهز للإغلاق", "out_for_repair": "خارج للإصلاح", "closed": "مغلق",
      };

      const ticketHistories = await Promise.all(tickets.map(t => db.getTicketHistory(t.id).then(h => ({ ticketId: t.id, history: h }))));
      const historyMap = new Map(ticketHistories.map(th => [th.ticketId, th.history]));

      const result = tickets.map(ticket => {
        const history = historyMap.get(ticket.id) || [];
        const sortedHistory = [...history].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

        const reportedBy = allUsers.find(u => u.id === ticket.reportedById)?.name || "غير معروف";
        const assignedTo = allUsers.find(u => u.id === ticket.assignedToId)?.name || "غير مسند";
        const site = allSites.find(s => s.id === ticket.siteId)?.name || "";

        const phases: Array<{ fromStatus: string; toStatus: string; label: string; startAt: Date; endAt: Date | null; durationHours: number | null; changedBy: string }> = [];

        for (let i = 0; i < sortedHistory.length; i++) {
          const entry = sortedHistory[i];
          const nextEntry = sortedHistory[i + 1];
          const startAt = new Date(entry.createdAt);
          const endAt = nextEntry ? new Date(nextEntry.createdAt) : (ticket.closedAt ? new Date(ticket.closedAt) : null);
          const durationHours = endAt ? msToHours(endAt.getTime() - startAt.getTime()) : null;
          phases.push({
            fromStatus: entry.fromStatus || "",
            toStatus: entry.toStatus,
            label: STAGE_LABELS[entry.toStatus] || entry.toStatus,
            startAt, endAt, durationHours,
            changedBy: allUsers.find(u => u.id === entry.changedById)?.name || "النظام",
          });
        }

        const createdAt = new Date(ticket.createdAt);
        const endTime = ticket.closedAt ? new Date(ticket.closedAt) : new Date();
        const totalHours = msToHours(endTime.getTime() - createdAt.getTime());
        const totalDays = Math.round(totalHours / 24 * 10) / 10;

        const maxPhase = phases.reduce((max, p) => {
          if (p.durationHours !== null && (max === null || p.durationHours > (max.durationHours || 0))) return p;
          return max;
        }, null as typeof phases[0] | null);

        return {
          ticketId: ticket.id, ticketNumber: ticket.ticketNumber, title: ticket.title,
          status: ticket.status, priority: ticket.priority, category: ticket.category,
          site, reportedBy, assignedTo, maintenancePath: ticket.maintenancePath,
          createdAt: new Date(ticket.createdAt), closedAt: ticket.closedAt ? new Date(ticket.closedAt) : null,
          totalHours, totalDays, phases,
          bottleneck: maxPhase ? { phase: maxPhase.label, hours: maxPhase.durationHours } : null,
          isClosed: ticket.status === "closed",
        };
      });

      const closedTickets = result.filter(r => r.isClosed);
      const avgTotalHours = closedTickets.length > 0
        ? Math.round(closedTickets.reduce((s, r) => s + r.totalHours, 0) / closedTickets.length * 10) / 10
        : null;

      const allPhaseLabelsSet = new Set(result.flatMap(r => r.phases.map(p => p.label)));
      const allPhaseLabels = Array.from(allPhaseLabelsSet);
      const phaseAvgs = allPhaseLabels.map(label => {
        const durations: number[] = result.flatMap(r => r.phases.filter(p => p.label === label && p.durationHours !== null).map(p => p.durationHours as number));
        return { phase: label, avgHours: durations.length > 0 ? Math.round(durations.reduce((s: number, d: number) => s + d, 0) / durations.length * 10) / 10 : null, count: durations.length };
      }).filter(p => p.avgHours !== null).sort((a, b) => (b.avgHours || 0) - (a.avgHours || 0));

      return { tickets: result, avgTotalHours, avgTotalDays: avgTotalHours ? Math.round(avgTotalHours / 24 * 10) / 10 : null, phaseAvgs, total: result.length, closedCount: closedTickets.length };
    }),

    sectionReport: protectedProcedure.input(z.object({
      siteId: z.number().optional(),
      dateFrom: z.string().optional(),
      dateTo: z.string().optional(),
    }).optional()).query(async ({ input }) => {
      const allSections = await db.getSections();
      const allTickets = await db.getTickets({});
      const allAssets = await db.listAssets({});
      const allPMWorkOrders = await db.listPMWorkOrders();
      const dateFrom = input?.dateFrom ? new Date(input.dateFrom) : null;
      const dateTo = input?.dateTo ? new Date(input.dateTo) : null;

      const filteredTickets = allTickets.filter((t: any) => {
        if (input?.siteId && t.siteId !== input.siteId) return false;
        if (dateFrom && new Date(t.createdAt) < dateFrom) return false;
        if (dateTo && new Date(t.createdAt) > dateTo) return false;
        return true;
      });

      // فلترة أوامر العمل الوقائية حسب التاريخ
      const filteredPMWOs = allPMWorkOrders.filter((wo: any) => {
        if (dateFrom && new Date(wo.scheduledDate) < dateFrom) return false;
        if (dateTo && new Date(wo.scheduledDate) > dateTo) return false;
        return true;
      });

      // بناء خريطة assetId → sectionId من الأصول
      const assetSectionMap = new Map<number, number | null>();
      allAssets.forEach((a: any) => assetSectionMap.set(a.id, a.sectionId ?? null));

      const sectionStats = allSections
        .filter((s: any) => !input?.siteId || s.siteId === input.siteId)
        .map((section: any) => {
          const sectionTickets = filteredTickets.filter((t: any) => t.sectionId === section.id);
          const sectionAssets = allAssets.filter((a: any) => a.sectionId === section.id);
          const openTickets = sectionTickets.filter((t: any) => t.status !== "closed").length;
          const closedTickets = sectionTickets.filter((t: any) => t.status === "closed").length;
          const urgentTickets = sectionTickets.filter((t: any) => t.priority === "critical" || t.priority === "high").length;
          const maintenanceCost = sectionTickets.reduce((sum: number, t: any) => {
            return sum + (parseFloat(t.estimatedCost || "0") || 0);
          }, 0);
          const avgCloseTime = (() => {
            const closed = sectionTickets.filter((t: any) => t.status === "closed" && t.closedAt && t.createdAt);
            if (!closed.length) return null;
            const totalHours = closed.reduce((sum: number, t: any) => {
              return sum + (new Date(t.closedAt).getTime() - new Date(t.createdAt).getTime()) / (1000 * 60 * 60);
            }, 0);
            return Math.round(totalHours / closed.length * 10) / 10;
          })();

          // عدد أوامر العمل الوقائية لهذا القسم
          // أولاً: من pmWorkOrders.siteId مباشرةً (plan مرتبط بالموقع)
          // ثانياً: من assetId → sectionId عبر خريطة الأصول
          const sectionPMWOs = filteredPMWOs.filter((wo: any) => {
            // مطابقة مباشرة عبر siteId إذا كان القسم مرتبط بالموقع
            if (wo.assetId && assetSectionMap.get(wo.assetId) === section.id) return true;
            return false;
          });
          const preventiveCount = sectionPMWOs.length;
          const preventiveCompleted = sectionPMWOs.filter((wo: any) => wo.status === "completed").length;

          return {
            sectionId: section.id, sectionName: section.name, siteId: section.siteId,
            totalTickets: sectionTickets.length, openTickets, closedTickets, urgentTickets,
            totalAssets: sectionAssets.length, maintenanceCost: Math.round(maintenanceCost * 100) / 100,
            avgCloseTimeHours: avgCloseTime,
            preventiveCount,
            preventiveCompleted,
            emergencyCount: sectionTickets.length, // البلاغات هي الصيانة الطارئة
          };
        })
        .sort((a: any, b: any) => b.totalTickets - a.totalTickets);
      const unassigned = filteredTickets.filter((t: any) => !t.sectionId);
      return { sections: sectionStats, unassignedTickets: unassigned.length, totalTickets: filteredTickets.length };
    }),

    // تقرير التكاليف البصري: حسب القسم والموقع مع فلاتر زمنية
    costReport: protectedProcedure.input(z.object({
      groupBy: z.enum(["section", "site"]).default("site"),
      period: z.enum(["month", "quarter", "year", "all", "custom"]).default("all"),
      dateFrom: z.string().optional(),
      dateTo: z.string().optional(),
    }).optional()).query(async ({ input }) => {
      const groupBy = input?.groupBy ?? "site";
      const period = input?.period ?? "all";
      let dateFrom: Date | undefined;
      let dateTo: Date | undefined;
      if (period === "custom" && input?.dateFrom && input?.dateTo) {
        dateFrom = new Date(input.dateFrom);
        dateTo = new Date(input.dateTo);
        dateTo.setHours(23, 59, 59, 999);
      } else if (period !== "all") {
        dateTo = new Date();
        dateFrom = new Date();
        if (period === "month") dateFrom.setMonth(dateFrom.getMonth() - 1);
        else if (period === "quarter") dateFrom.setMonth(dateFrom.getMonth() - 3);
        else if (period === "year") dateFrom.setFullYear(dateFrom.getFullYear() - 1);
      }
      // جلب البيانات: البلاغات + أصناف الشراء المستلمة (المصدر الموحد) + المواقع + الأقسام
      const [allTickets, allSites, allSections, allPOs, allPOItems] = await Promise.all([
        db.getTickets({}),
        db.getAllSites(),
        db.getSections(),
        db.getPurchaseOrders(),
        db.getAllPOItems(),
      ]);
      // فلترة البلاغات حسب التاريخ
      const filteredTickets = allTickets.filter((t: any) => {
        if (dateFrom && new Date(t.createdAt) < dateFrom) return false;
        if (dateTo && new Date(t.createdAt) > dateTo) return false;
        return true;
      });
      // أصناف الشراء المستلمة فعلياً (delivered_to_warehouse أو delivered_to_requester)
      // هذا المصدر يطابق بطاقة لوحة التحكم تماماً
      const deliveredItems = allPOItems.filter((item: any) => {
        if (item.status !== "delivered_to_warehouse" && item.status !== "delivered_to_requester") return false;
        const dateRef = item.deliveredAt || item.receivedAt || item.createdAt;
        if (dateFrom && new Date(dateRef) < dateFrom) return false;
        if (dateTo && new Date(dateRef) > dateTo) return false;
        return true;
      });
      // بناء خريطة purchaseOrderId → siteId/sectionId من جدول purchaseOrders
      const poMap = new Map<number, { siteId: number | null; sectionId: number | null }>();
      allPOs.forEach((po: any) => poMap.set(po.id, { siteId: po.siteId ?? null, sectionId: po.sectionId ?? null }));
      // الاتجاه الشهري (آخر 12 شهر) - يستخدم المصدر الموحد
      const monthlyTrend: { month: string; label: string; ticketCost: number; purchaseCost: number; total: number }[] = [];
      for (let i = 11; i >= 0; i--) {
        const d = new Date();
        d.setDate(1);
        d.setMonth(d.getMonth() - i);
        const monthKey = d.toISOString().slice(0, 7);
        const monthStart = new Date(d.getFullYear(), d.getMonth(), 1);
        const monthEnd = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59);
        const monthNames = ["يناير","فبراير","مارس","أبريل","مايو","يونيو","يوليو","أغسطس","سبتمبر","أكتوبر","نوفمبر","ديسمبر"];
        const label = `${monthNames[d.getMonth()]} ${d.getFullYear()}`;
        const ticketCost = allTickets
          .filter((t: any) => { const c = new Date(t.createdAt); return c >= monthStart && c <= monthEnd; })
          .reduce((sum: number, t: any) => sum + parseFloat(t.actualCost || t.estimatedCost || "0"), 0);
        const purchaseCost = allPOItems
          .filter((item: any) => {
            if (item.status !== "delivered_to_warehouse" && item.status !== "delivered_to_requester") return false;
            const dateRef = item.deliveredAt || item.receivedAt || item.createdAt;
            const c = new Date(dateRef);
            return c >= monthStart && c <= monthEnd;
          })
          .reduce((sum: number, item: any) => sum + parseFloat(item.actualTotalCost || item.estimatedTotalCost || "0"), 0);
        monthlyTrend.push({ month: monthKey, label, ticketCost: Math.round(ticketCost * 100) / 100, purchaseCost: Math.round(purchaseCost * 100) / 100, total: Math.round((ticketCost + purchaseCost) * 100) / 100 });
      }
      type GroupItem = { id: number; name: string; siteName?: string; ticketCost: number; purchaseCost: number; totalCost: number; ticketCount: number; ticketsNoCost: number; percentage: number; isUnclassified?: boolean };
      let groups: GroupItem[] = [];
      if (groupBy === "site") {
        groups = allSites.map((site: any) => {
          const siteTickets = filteredTickets.filter((t: any) => t.siteId === site.id);
          const siteItems = deliveredItems.filter((item: any) => poMap.get(item.purchaseOrderId)?.siteId === site.id);
          const ticketCost = siteTickets.reduce((sum: number, t: any) => sum + parseFloat(t.actualCost || t.estimatedCost || "0"), 0);
          const purchaseCost = siteItems.reduce((sum: number, item: any) => sum + parseFloat(item.actualTotalCost || item.estimatedTotalCost || "0"), 0);
          const ticketsNoCost = siteTickets.filter((t: any) => !t.actualCost && !t.estimatedCost).length;
          return { id: site.id, name: site.name, ticketCost: Math.round(ticketCost * 100) / 100, purchaseCost: Math.round(purchaseCost * 100) / 100, totalCost: Math.round((ticketCost + purchaseCost) * 100) / 100, ticketCount: siteTickets.length, ticketsNoCost, percentage: 0 };
        });
        // التكاليف غير المرتبطة بأي موقع
        const unclassifiedTickets = filteredTickets.filter((t: any) => !t.siteId);
        const unclassifiedItems = deliveredItems.filter((item: any) => !poMap.get(item.purchaseOrderId)?.siteId);
        const unclassifiedTicketCost = unclassifiedTickets.reduce((sum: number, t: any) => sum + parseFloat(t.actualCost || t.estimatedCost || "0"), 0);
        const unclassifiedPurchaseCost = unclassifiedItems.reduce((sum: number, item: any) => sum + parseFloat(item.actualTotalCost || item.estimatedTotalCost || "0"), 0);
        const unclassifiedTotal = unclassifiedTicketCost + unclassifiedPurchaseCost;
        if (unclassifiedTotal > 0 || unclassifiedTickets.length > 0) {
          groups.push({ id: -1, name: "غير محدد", ticketCost: Math.round(unclassifiedTicketCost * 100) / 100, purchaseCost: Math.round(unclassifiedPurchaseCost * 100) / 100, totalCost: Math.round(unclassifiedTotal * 100) / 100, ticketCount: unclassifiedTickets.length, ticketsNoCost: unclassifiedTickets.filter((t: any) => !t.actualCost && !t.estimatedCost).length, percentage: 0, isUnclassified: true });
        }
      } else {
        groups = allSections.map((section: any) => {
          const secTickets = filteredTickets.filter((t: any) => t.sectionId === section.id);
          const secItems = deliveredItems.filter((item: any) => poMap.get(item.purchaseOrderId)?.sectionId === section.id);
          const ticketCost = secTickets.reduce((sum: number, t: any) => sum + parseFloat(t.actualCost || t.estimatedCost || "0"), 0);
          const purchaseCost = secItems.reduce((sum: number, item: any) => sum + parseFloat(item.actualTotalCost || item.estimatedTotalCost || "0"), 0);
          const siteName = allSites.find((s: any) => s.id === section.siteId)?.name ?? "";
          const ticketsNoCost = secTickets.filter((t: any) => !t.actualCost && !t.estimatedCost).length;
          return { id: section.id, name: section.name, siteName, ticketCost: Math.round(ticketCost * 100) / 100, purchaseCost: Math.round(purchaseCost * 100) / 100, totalCost: Math.round((ticketCost + purchaseCost) * 100) / 100, ticketCount: secTickets.length, ticketsNoCost, percentage: 0 };
        });
        // التكاليف غير المرتبطة بأي قسم
        const unclassifiedTickets = filteredTickets.filter((t: any) => !t.sectionId);
        const unclassifiedItems = deliveredItems.filter((item: any) => !poMap.get(item.purchaseOrderId)?.sectionId);
        const unclassifiedTicketCost = unclassifiedTickets.reduce((sum: number, t: any) => sum + parseFloat(t.actualCost || t.estimatedCost || "0"), 0);
        const unclassifiedPurchaseCost = unclassifiedItems.reduce((sum: number, item: any) => sum + parseFloat(item.actualTotalCost || item.estimatedTotalCost || "0"), 0);
        const unclassifiedTotal = unclassifiedTicketCost + unclassifiedPurchaseCost;
        if (unclassifiedTotal > 0 || unclassifiedTickets.length > 0) {
          groups.push({ id: -1, name: "غير محدد", ticketCost: Math.round(unclassifiedTicketCost * 100) / 100, purchaseCost: Math.round(unclassifiedPurchaseCost * 100) / 100, totalCost: Math.round(unclassifiedTotal * 100) / 100, ticketCount: unclassifiedTickets.length, ticketsNoCost: unclassifiedTickets.filter((t: any) => !t.actualCost && !t.estimatedCost).length, percentage: 0, isUnclassified: true });
        }
      }
      groups = groups.sort((a, b) => b.totalCost - a.totalCost);
      const grandTotal = groups.reduce((sum, g) => sum + g.totalCost, 0);
      groups = groups.map(g => ({ ...g, percentage: grandTotal > 0 ? Math.round((g.totalCost / grandTotal) * 1000) / 10 : 0 }));
      const totalTicketsNoCost = filteredTickets.filter((t: any) => !t.actualCost && !t.estimatedCost).length;
      return { groups, grandTotal: Math.round(grandTotal * 100) / 100, monthlyTrend, groupBy, totalTicketsNoCost };
    }),

    // تقرير أداء الفني الشهري: فحوصات + معدل اكتشاف الأعطال
    technicianMonthlyReport: protectedProcedure.input(z.object({
      monthsBack: z.number().min(1).max(12).default(6),
    }).optional()).query(async () => {
      const ddb = await db.getDb();
      if (!ddb) return { technicians: [], months: [] };

      const { pmExecutionSessions: execSessions, pmExecutionResults: execResults } = await import("../../drizzle/schema");

      const allUsers = await db.getAllUsers();
      const technicians = allUsers.filter((u: any) => u.role === "technician");

      const sessions = await ddb
        .select()
        .from(execSessions)
        .where(eq(execSessions.status, "completed"));

      const results = await ddb.select().from(execResults);

      const allTickets = await db.getTickets({});
      const pmSourceTickets = allTickets.filter((t: any) =>
        t.description && t.description.includes("صيانة دورية")
      );

      const months: string[] = [];
      const now = new Date();
      for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
      }

      const technicianData = technicians.map((tech: any) => {
        const techSessions = sessions.filter((s: any) => s.technicianId === tech.id);

        const monthlyData = months.map(month => {
          const [y, m] = month.split("-").map(Number);
          const monthSessions = techSessions.filter((s: any) => {
            const d = new Date(s.completedAt || s.startedAt);
            return d.getFullYear() === y && d.getMonth() + 1 === m;
          });
          const sessionIds = monthSessions.map((s: any) => s.id);
          const sessionResults = results.filter((r: any) => sessionIds.includes(r.sessionId));
          const defectCount = sessionResults.filter((r: any) => r.status === "defect").length;
          const totalItems = sessionResults.length;
          const monthTickets = pmSourceTickets.filter((t: any) => {
            const d = new Date(t.createdAt);
            return d.getFullYear() === y && d.getMonth() + 1 === m && t.assignedToId === tech.id;
          });
          return {
            month, inspections: monthSessions.length, defectsFound: defectCount,
            totalItems, ticketsFromPM: monthTickets.length,
            detectionRate: totalItems > 0 ? Math.round(defectCount / totalItems * 100) : 0,
          };
        });

        const totalInspections = techSessions.length;
        const totalDefects = results.filter((r: any) =>
          techSessions.some((s: any) => s.id === r.sessionId) && r.status === "defect"
        ).length;
        const totalItems = results.filter((r: any) =>
          techSessions.some((s: any) => s.id === r.sessionId)
        ).length;

        return {
          technicianId: tech.id, technicianName: tech.name, role: tech.role,
          totalInspections, totalDefects,
          overallDetectionRate: totalItems > 0 ? Math.round(totalDefects / totalItems * 100) : 0,
          monthlyData,
        };
      });

      return { technicians: technicianData, months };
    }),
  }),

  // ============================================================
  // AI INSIGHTS
  // ============================================================
  ai: router({
    analyze: protectedProcedure.input(z.object({
      question: z.string(),
      conversationHistory: z.array(z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string(),
      })).optional(),
    })).mutation(async ({ input, ctx }) => {
      // جمع بيانات شاملة من قاعدة البيانات
      const [tickets, pos, inventoryItems, allUsers, allSites, stats, recentAudit] = await Promise.all([
        db.getTickets(),
        db.getPurchaseOrders(),
        db.getInventoryItems(),
        db.getAllUsers(),
        db.getAllSites(),
        db.getDashboardStats(),
        db.getAuditLogsEnhanced({ limit: 50 }),
      ]);

      // تحليل البلاغات
      const ticketsByStatus = tickets.reduce((acc: any, t) => { acc[t.status] = (acc[t.status] || 0) + 1; return acc; }, {});
      const ticketsByPriority = tickets.reduce((acc: any, t) => { acc[t.priority] = (acc[t.priority] || 0) + 1; return acc; }, {});
      const ticketsByCategory = tickets.reduce((acc: any, t) => { acc[t.category] = (acc[t.category] || 0) + 1; return acc; }, {});
      const ticketsBySite = tickets.reduce((acc: any, t) => { const site = allSites.find(s => s.id === t.siteId); acc[site?.name || `موقع #${t.siteId}`] = (acc[site?.name || `موقع #${t.siteId}`] || 0) + 1; return acc; }, {});

      // تحليل طلبات الشراء
      const posByStatus = pos.reduce((acc: any, p) => { acc[p.status] = (acc[p.status] || 0) + 1; return acc; }, {});
      const totalPOCost = pos.reduce((sum, p) => sum + parseFloat(p.totalEstimatedCost || "0"), 0);
      const totalActualCost = pos.reduce((sum, p) => sum + parseFloat(p.totalActualCost || "0"), 0);

      // تحليل المخزون
      const lowStockItems = inventoryItems.filter((i: any) => i.quantity <= i.minQuantity);

      // تفاصيل البلاغات (آخر 20)
      const recentTickets = tickets.slice(0, 20).map(t => ({
        id: t.id, ticketNumber: t.ticketNumber, title: t.title, description: t.description,
        status: t.status, priority: t.priority, category: t.category,
        assignedTo: allUsers.find(u => u.id === t.assignedToId)?.name || "غير مسند",
        reportedBy: allUsers.find(u => u.id === t.reportedById)?.name || "غير معروف",
        site: allSites.find(s => s.id === t.siteId)?.name || "",
        createdAt: new Date(t.createdAt).toLocaleDateString("ar-SA"),
      }));

      // تفاصيل طلبات الشراء (آخر 20)
      const recentPOs = pos.slice(0, 20).map(p => ({
        id: p.id, poNumber: p.poNumber, status: p.status,
        estimatedCost: p.totalEstimatedCost, actualCost: p.totalActualCost,
        requestedBy: allUsers.find(u => u.id === p.requestedById)?.name || "",
        createdAt: new Date(p.createdAt).toLocaleDateString("ar-SA"),
      }));

      const dbContext = `
=== بيانات نظام إدارة الصيانة (CMMS) - محدثة الآن ===

ـــ إحصائيات عامة ـــ
• إجمالي البلاغات: ${tickets.length}
• البلاغات المفتوحة: ${stats?.openTickets || 0}
• المغلقة اليوم: ${stats?.closedToday || 0}
• الحرجة: ${stats?.criticalTickets || 0}
• طلبات شراء بانتظار الاعتماد: ${stats?.pendingApprovals || 0}
• إجمالي تكلفة الصيانة: ${stats?.totalMaintenanceCost || 0} ر.س

ـــ توزيع البلاغات ـــ
حسب الحالة: ${JSON.stringify(ticketsByStatus)}
حسب الأولوية: ${JSON.stringify(ticketsByPriority)}
حسب الفئة: ${JSON.stringify(ticketsByCategory)}
حسب الموقع: ${JSON.stringify(ticketsBySite)}

ـــ طلبات الشراء ـــ
إجمالي طلبات الشراء: ${pos.length}
حسب الحالة: ${JSON.stringify(posByStatus)}
إجمالي التكلفة المقدرة: ${totalPOCost.toFixed(2)} ر.س
إجمالي التكلفة الفعلية: ${totalActualCost.toFixed(2)} ر.س

ـــ المخزون ـــ
إجمالي الأصناف: ${inventoryItems.length}
أصناف منخفضة المخزون: ${lowStockItems.length}
${lowStockItems.length > 0 ? `الأصناف المنخفضة: ${lowStockItems.map((i: any) => `${i.itemName} (الكمية: ${i.quantity}, الحد الأدنى: ${i.minQuantity})`).join(" | ")}` : ""}
قائمة المخزون: ${JSON.stringify(inventoryItems.map((i: any) => ({ name: i.itemName, qty: i.quantity, min: i.minQuantity, unit: i.unit, location: i.location })))}

ـــ المستخدمون ـــ
إجمالي: ${allUsers.length}
القائمة: ${allUsers.map(u => `${u.name} (الدور: ${u.role}, القسم: ${u.department || "-"})`).join(" | ")}

ـــ المواقع ـــ
${allSites.map(s => `${s.name}: ${s.address || "-"}`).join(" | ")}

ـــ آخر 20 بلاغ ـــ
${JSON.stringify(recentTickets, null, 0)}

ـــ آخر 20 طلب شراء ـــ
${JSON.stringify(recentPOs, null, 0)}

ـــ آخر 50 عملية تدقيق ـــ
${JSON.stringify(recentAudit.map((a: any) => ({ action: a.action, entity: a.entityType, id: a.entityId, desc: a.description, date: new Date(a.createdAt).toLocaleDateString("ar-SA") })), null, 0)}
`;

      const systemPrompt = `أنت "مساعد الصيانة الذكي" - مساعد AI متخصص في نظام إدارة الصيانة المتكامل (CMMS).

قواعدك الأساسية:
1. أجب بنفس لغة المستخدم تماماً:
   - إذا كتب بالعربية الفصحى → أجب بالفصحى
   - إذا كتب باللهجة السعودية (مثل: "وش البلاغات اليوم؟", "كم عندنا طلب شراء؟", "وشلون المخزون؟", "ايش السالفة؟", "وين المشكلة؟") → أجب باللهجة السعودية
   - إذا كتب باللهجة المصرية (مثل: "ايه البلاغات دي؟", "عايز اعرف", "فين المشكلة؟") → أجب باللهجة المصرية
   - If user writes in English → Reply in English
   - اگر صارف اردو میں لکھے → اردو میں جواب دیں

2. لديك وصول كامل لقاعدة بيانات النظام. استخدم البيانات المرفقة للإجابة بدقة.

3. يمكنك الإجابة عن:
   - البلاغات: عددها، حالاتها، أولوياتها، فئاتها، من أنشأها، من مسند إليه، الموقع، التاريخ
   - طلبات الشراء: عددها، حالاتها، تكاليفها، من طلبها
   - المخزون: الأصناف، الكميات، الأصناف المنخفضة
   - المستخدمين: أسماؤهم، أدوارهم، أقسامهم
   - المواقع: أسماؤها، عناوينها
   - سجل التدقيق: آخر العمليات
   - التكاليف والإحصائيات المالية
   - تحليل الأداء والتوصيات
   - خطط الصيانة الوقائية

4. كن مفيداً وعملياً. استخدم الأرقام الفعلية من البيانات. لا تخترع بيانات.

5. استخدم تنسيق Markdown للردود (عناوين، جداول، قوائم) لتكون واضحة ومنظمة.

6. إذا سأل المستخدم عن شيء غير موجود في البيانات، أخبره بذلك بوضوح.

7. المستخدم الحالي: ${ctx.user?.name || "غير معروف"} (الدور: ${ctx.user?.role || "غير محدد"})`;

      // بناء سجل المحادثة
      const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
        { role: "system", content: systemPrompt },
        { role: "user", content: `هذه بيانات النظام المحدثة:\n${dbContext}` },
        { role: "assistant", content: "تم تحميل بيانات النظام بنجاح. أنا جاهز للإجابة على أي سؤال." },
      ];

      // إضافة سجل المحادثة السابق
      if (input.conversationHistory?.length) {
        for (const msg of input.conversationHistory) {
          messages.push({ role: msg.role, content: msg.content });
        }
      }

      // إضافة السؤال الحالي
      messages.push({ role: "user", content: input.question });

      const response = await invokeLLM({ messages });
      return { answer: response.choices[0]?.message?.content || "لم أتمكن من الإجابة" };
    }),

  }),
  // ============================================================
  // DATABASE BACKUPSS
  // ============================================================
  backups: router({
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
  }),

  // ============================================================
  // AUDIT LOGS
  // ============================================================
  audit: router({
    list: protectedProcedure.input(z.object({
      entityType: z.string().optional(),
      entityId: z.number().optional(),
      userId: z.number().optional(),
      action: z.string().optional(),
      dateFrom: z.string().optional(),
      dateTo: z.string().optional(),
      limit: z.number().optional(),
    }).optional()).query(async ({ input }) => {
      const filters: any = {};
      if (input?.entityType) filters.entityType = input.entityType;
      if (input?.entityId) filters.entityId = input.entityId;
      if (input?.userId) filters.userId = input.userId;
      if (input?.action) filters.action = input.action;
      if (input?.dateFrom) filters.dateFrom = new Date(input.dateFrom);
      if (input?.dateTo) { const d = new Date(input.dateTo); d.setHours(23, 59, 59, 999); filters.dateTo = d; }
      if (input?.limit) filters.limit = input.limit;
      return db.getAuditLogsEnhanced(filters);
    }),
  }),

   // ============================================================
  // TRANSLATION ENGINE
  // ============================================================
  translation: translationRouter,

  // ============================================================
  // ASSETS - إدارة الأصول
  // ============================================================
  assets: router({
    list: protectedProcedure.input(z.object({
      siteId: z.number().optional(),
      sectionId: z.number().optional(),
      status: z.string().optional(),
      search: z.string().optional(),
    }).optional()).query(async ({ input }) => {
      return db.listAssets(input ?? {});
    }),

    getById: protectedProcedure.input(z.object({ id: z.number() })).query(async ({ input }) => {
      const asset = await db.getAssetById(input.id);
      if (!asset) throw new TRPCError({ code: "NOT_FOUND", message: "الأصل غير موجود" });
      return asset;
    }),

    create: managerProcedure.input(z.object({
      name: z.string().min(1),
      description: z.string().optional(),
      category: z.string().optional(),
      brand: z.string().optional(),
      model: z.string().optional(),
      serialNumber: z.string().optional(),
      siteId: z.number().optional(),
      sectionId: z.number().optional(),
      locationDetail: z.string().optional(),
      status: z.enum(["active", "inactive", "under_maintenance", "disposed"]).optional(),
      purchaseDate: z.string().optional(),
      purchaseCost: z.string().optional(),
      warrantyExpiry: z.string().optional(),
      warrantyNotes: z.string().optional(),
      photoUrl: z.string().optional(),
      notes: z.string().optional(),
      rfidTag: z.string().optional(),
      categoryId: z.number().optional(),
    })).mutation(async ({ input, ctx }) => {
      const assetNumber = await db.generateAssetNumber();
      // Auto-translate description and notes
      let assetTranslation: Record<string, any> = {};
      const fieldsToTranslate: Record<string, string> = {};
      if (input.description) fieldsToTranslate.description = input.description;
      if (input.notes) fieldsToTranslate.notes = input.notes;
      if (Object.keys(fieldsToTranslate).length > 0) {
        try {
          const lang = await detectLanguage(Object.values(fieldsToTranslate)[0]);
          const translations = await translateFields(fieldsToTranslate, lang);
          if (translations.description) {
            assetTranslation.description_ar = translations.description.ar;
            assetTranslation.description_en = translations.description.en;
            assetTranslation.description_ur = translations.description.ur;
          }
          if (translations.notes) {
            assetTranslation.notes_ar = translations.notes.ar;
            assetTranslation.notes_en = translations.notes.en;
            assetTranslation.notes_ur = translations.notes.ur;
          }
          assetTranslation.originalLanguage = lang;
        } catch (e) {
          console.error("[Asset] Translation failed:", e);
        }
      }
      const result = await db.createAsset({
        ...input,
        ...assetTranslation,
        assetNumber,
        purchaseDate: input.purchaseDate ? new Date(input.purchaseDate) : undefined,
        warrantyExpiry: input.warrantyExpiry ? new Date(input.warrantyExpiry) : undefined,
        status: input.status ?? "active",
        createdById: ctx.user.id,
      });
      // ── إعادة تسمية صورة الأصل بقيمة RFID إذا توفر كلاهما ──────────────
      if (result && input.rfidTag && input.photoUrl) {
        try {
          const oldKey = input.photoUrl.includes("/api/media?key=")
            ? decodeURIComponent(input.photoUrl.split("key=")[1])
            : input.photoUrl.replace(/^.*\/cmms\//, "cmms/");
          const safeRfid = input.rfidTag.replace(/[^a-zA-Z0-9_\-]/g, "_");
          const newKey = `cmms/assets/${safeRfid}.webp`;
          if (oldKey !== newKey) {
            const { url: newUrl } = await storageRename(oldKey, newKey);
            const proxyUrl = `/api/media?key=${encodeURIComponent(newKey)}`;
            await db.updateAsset(result.id, { photoUrl: proxyUrl });
            (result as any).photoUrl = proxyUrl;
          }
        } catch (e) {
          console.error("[Asset] RFID photo rename failed (create):", e);
        }
      }
      return result;
    }),

    update: managerProcedure.input(z.object({
      id: z.number(),
      name: z.string().optional(),
      description: z.string().optional(),
      category: z.string().optional(),
      brand: z.string().optional(),
      model: z.string().optional(),
      serialNumber: z.string().optional(),
      siteId: z.number().optional(),
      sectionId: z.number().optional(),
      locationDetail: z.string().optional(),
      status: z.enum(["active", "inactive", "under_maintenance", "disposed"]).optional(),
      purchaseDate: z.string().optional(),
      purchaseCost: z.string().optional(),
      warrantyExpiry: z.string().optional(),
      warrantyNotes: z.string().optional(),
      photoUrl: z.string().optional(),
      notes: z.string().optional(),
      rfidTag: z.string().optional(),
      categoryId: z.number().optional(),
    })).mutation(async ({ input }) => {
      const { id, ...data } = input;
      // Auto-translate updated text fields to all 3 languages
      let assetTranslation: Record<string, any> = {};
      const assetFieldsToTranslate: Record<string, string> = {};
      if (data.description) assetFieldsToTranslate.description = data.description;
      if (data.notes) assetFieldsToTranslate.notes = data.notes;
      if (Object.keys(assetFieldsToTranslate).length > 0) {
        try {
          const textForDetection = Object.values(assetFieldsToTranslate)[0];
          const detectedLang = await detectLanguage(textForDetection) as SupportedLanguage;
          const translations = await translateFields(assetFieldsToTranslate, detectedLang);
          if (translations.description) {
            assetTranslation.description_ar = translations.description.ar;
            assetTranslation.description_en = translations.description.en;
            assetTranslation.description_ur = translations.description.ur;
          }
          if (translations.notes) {
            assetTranslation.notes_ar = translations.notes.ar;
            assetTranslation.notes_en = translations.notes.en;
            assetTranslation.notes_ur = translations.notes.ur;
          }
        } catch (e) {
          console.error("[Asset] Update translation failed:", e);
        }
      }
      // ── إعادة تسمية صورة الأصل بقيمة RFID عند التعديل ─────────────────────
      let finalPhotoUrl = data.photoUrl;
      const effectiveRfid = data.rfidTag;
      if (effectiveRfid && data.photoUrl) {
        // صورة جديدة + RFID: إعادة تسمية الصورة المرفوعة
        try {
          const oldKey = data.photoUrl.includes("/api/media?key=")
            ? decodeURIComponent(data.photoUrl.split("key=")[1])
            : data.photoUrl.replace(/^.*\/cmms\//, "cmms/");
          const safeRfid = effectiveRfid.replace(/[^a-zA-Z0-9_\-]/g, "_");
          const newKey = `cmms/assets/${safeRfid}.webp`;
          if (!oldKey.endsWith(`${safeRfid}.webp`)) {
            await storageRename(oldKey, newKey);
            finalPhotoUrl = `/api/media?key=${encodeURIComponent(newKey)}`;
          }
        } catch (e) {
          console.error("[Asset] RFID photo rename failed (update+photo):", e);
        }
      } else if (effectiveRfid && !data.photoUrl) {
        // تغيير RFID فقط: إعادة تسمية الصورة الموجودة في قاعدة البيانات
        try {
          const existing = await db.getAssetById(id);
          if (existing?.photoUrl) {
            const oldKey = existing.photoUrl.includes("/api/media?key=")
              ? decodeURIComponent(existing.photoUrl.split("key=")[1])
              : existing.photoUrl.replace(/^.*\/cmms\//, "cmms/");
            const safeRfid = effectiveRfid.replace(/[^a-zA-Z0-9_\-]/g, "_");
            const newKey = `cmms/assets/${safeRfid}.webp`;
            if (!oldKey.endsWith(`${safeRfid}.webp`)) {
              await storageRename(oldKey, newKey);
              finalPhotoUrl = `/api/media?key=${encodeURIComponent(newKey)}`;
            }
          }
        } catch (e) {
          console.error("[Asset] RFID rename on rfid-change failed:", e);
        }
      }
      return db.updateAsset(id, {
        ...data,
        ...assetTranslation,
        photoUrl: finalPhotoUrl,
        purchaseDate: data.purchaseDate ? new Date(data.purchaseDate) : undefined,
        warrantyExpiry: data.warrantyExpiry ? new Date(data.warrantyExpiry) : undefined,
      });
    }),

    delete: managerProcedure.input(z.object({ id: z.number() })).mutation(async ({ input }) => {
      return db.deleteAsset(input.id);
    }),

    // ============================================================
    // RFID - تقنية تحديد الموقع بالترددات الراديوية
    // ============================================================
    getByRfid: protectedProcedure.input(z.object({
      rfidTag: z.string().min(1),
    })).query(async ({ input }) => {
      const asset = await db.getAssetByRfidTag(input.rfidTag);
      if (!asset) throw new TRPCError({ code: "NOT_FOUND", message: "الأصل بهذا الـ RFID غير موجود" });
      return asset;
    }),

    updateRfid: managerProcedure.input(z.object({
      id: z.number(),
      rfidTag: z.string().min(1),
    })).mutation(async ({ input }) => {
      return db.updateAssetRfidTag(input.id, input.rfidTag);
    }),

    linkRfidTag: protectedProcedure.input(z.object({
      assetId: z.number(),
      rfidTag: z.string().min(1),
    })).mutation(async ({ input }) => {
      const asset = await db.getAssetById(input.assetId);
      if (!asset) throw new TRPCError({ code: "NOT_FOUND", message: "الأصل غير موجود" });
      return db.updateAssetRfidTag(input.assetId, input.rfidTag);
    }),

    getMaintenanceHistory: protectedProcedure.input(z.object({
      id: z.number(),
    })).query(async ({ input }) => {
      const asset = await db.getAssetById(input.id);
      if (!asset) throw new TRPCError({ code: "NOT_FOUND", message: "الأصل غير موجود" });
      return db.getAssetMaintenanceHistory(input.id);
    }),

    getMaintenanceStats: protectedProcedure.input(z.object({
      id: z.number(),
    })).query(async ({ input }) => {
      const asset = await db.getAssetById(input.id);
      if (!asset) throw new TRPCError({ code: "NOT_FOUND", message: "الأصل غير موجود" });
      return db.getAssetMaintenanceStats(input.id);
    }),

    addSparePart: managerProcedure.input(z.object({
      assetId: z.number(),
      inventoryItemId: z.number(),
      minStockLevel: z.number().optional(),
      preferredQuantity: z.number().optional(),
      notes: z.string().optional(),
    })).mutation(async ({ input }) => {
      return db.addAssetSparePart(input);
    }),

    getSpareParts: protectedProcedure.input(z.object({
      assetId: z.number(),
    })).query(async ({ input }) => {
      return db.getAssetSpareParts(input.assetId);
    }),

    removeSparePart: managerProcedure.input(z.object({
      id: z.number(),
    })).mutation(async ({ input }) => {
      return db.removeAssetSparePart(input.id);
    }),

    getMetrics: protectedProcedure.input(z.object({
      assetId: z.number(),
    })).query(async ({ input }) => {
      return db.getAssetMetricsById(input.assetId);
    }),

    calculateMetrics: managerProcedure.input(z.object({
      assetId: z.number(),
    })).mutation(async ({ input }) => {
      return db.calculateAssetMetrics(input.assetId);
    }),

    getAllMetrics: protectedProcedure.query(async () => {
      return db.getAllAssetMetrics();
    }),

    getLowStockAlerts: managerProcedure.query(async () => {
      return db.getInventoryAlerts();
    }),

    getAssetSparePartsWithLowStock: protectedProcedure.input(z.object({
      assetId: z.number(),
    })).query(async ({ input }) => {
      return db.getAssetSparePartsWithLowStock(input.assetId);
    }),
  }),

  // ============================================================
  // PREVENTIVE MAINTENANCE - الصيانة الوقائية
  // ============================================================
  preventive: router({
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
          const { sendPushToUser } = await import("../../server/services/notifications/webPush");
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
      const { pmChecklistItems } = await import("../../drizzle/schema");
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
      const { pmChecklistItems } = await import("../../drizzle/schema");
      const { id, ...data } = input;
      await ddb.update(pmChecklistItems).set(data).where(eq(pmChecklistItems.id, id));
      return { success: true };
    }),

    deleteChecklistItem: managerProcedure.input(z.object({ id: z.number() })).mutation(async ({ input }) => {
      const ddb = await db.getDb();
      if (!ddb) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "خطأ في قاعدة البيانات" });
      const { pmChecklistItems } = await import("../../drizzle/schema");
      await ddb.delete(pmChecklistItems).where(eq(pmChecklistItems.id, input.id));
      return { success: true };
    }),

    getChecklistItems: protectedProcedure.input(z.object({ planId: z.number() })).query(async ({ input }) => {
      const ddb = await db.getDb();
      if (!ddb) return [];
      const { pmChecklistItems } = await import("../../drizzle/schema");
      return ddb.select().from(pmChecklistItems)
        .where(eq(pmChecklistItems.planId, input.planId))
        .orderBy(asc(pmChecklistItems.orderIndex));
    }),

    reorderChecklistItems: managerProcedure.input(z.object({
      items: z.array(z.object({ id: z.number(), orderIndex: z.number() })),
    })).mutation(async ({ input }) => {
      const ddb = await db.getDb();
      if (!ddb) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "خطأ في قاعدة البيانات" });
      const { pmChecklistItems } = await import("../../drizzle/schema");
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
      const { pmExecutionSessions, pmWorkOrders, pmChecklistItems } = await import("../../drizzle/schema");
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
      const { pmExecutionResults, pmExecutionSessions } = await import("../../drizzle/schema");
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
      const { pmExecutionResults, pmExecutionSessions, pmChecklistItems, pmWorkOrders } = await import("../../drizzle/schema");
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
      const { pmExecutionSessions, pmWorkOrders, pmExecutionResults } = await import("../../drizzle/schema");
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
      const { pmExecutionResults, pmWorkOrders } = await import("../../drizzle/schema");
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
      const { pmExecutionResults, pmExecutionSessions, pmWorkOrders } = await import("../../drizzle/schema");
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
      const { pmExecutionSessions, pmWorkOrders, pmExecutionResults } = await import("../../drizzle/schema");
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
  }),

  // ============================================================
  // KPI LIVE TRACKING
  // ============================================================
  kpi: router({
    // جلب بيانات Timeline للبلاغات النشطة (24 ساعة الأخيرة)
    getTicketTimelines: managerProcedure.query(async () => {
      const ddb = await db.getDb();
      if (!ddb) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available" });
      const { tickets } = await import("../../drizzle/schema");
      const { desc: descOp } = await import("drizzle-orm");
      const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // آخر 7 أيام
      const rows = await ddb
        .select({
          id: tickets.id,
          ticketNumber: tickets.ticketNumber,
          title: tickets.title,
          status: tickets.status,
          priority: tickets.priority,
          createdAt: tickets.createdAt,
          assignedAt: tickets.assignedAt,
          closedAt: tickets.closedAt,
          assignedToId: tickets.assignedToId,
          updatedAt: tickets.updatedAt,
        })
        .from(tickets)
         .where(and(gte(tickets.createdAt, cutoff)))
        .orderBy(descOp(tickets.createdAt))
        .limit(20);
      // SLA thresholds (minutes)
      const SLA = {
        triage: 30,        // الفرز خلال 30 دقيقة
        assignment: 60,    // الإسناد خلال ساعة
        fieldWork: 240,    // بدء العمل خلال 4 ساعات
        closure: 2880,     // الإغلاق خلال 48 ساعة
      };

      const now = Date.now();

      return rows.map((t) => {
        const createdMs = new Date(t.createdAt).getTime();
        const assignedMs = t.assignedAt ? new Date(t.assignedAt).getTime() : null;
        const closedMs = t.closedAt ? new Date(t.closedAt).getTime() : null;
        const updatedMs = new Date(t.updatedAt).getTime();

        // Step 1: فتح البلاغ → الفرز (نعتبر أول تحديث = الفرز)
        const triageMs = updatedMs > createdMs ? updatedMs : null;
        const triageDuration = triageMs ? Math.round((triageMs - createdMs) / 60000) : null;
        const triageStatus: "ok" | "warning" | "overdue" | "pending" =
          triageMs
            ? triageDuration! <= SLA.triage ? "ok" : triageDuration! <= SLA.triage * 2 ? "warning" : "overdue"
            : (now - createdMs) / 60000 > SLA.triage ? "overdue" : "pending";

        // Step 2: الفرز → إسناد الفني
        const assignDuration = assignedMs && triageMs ? Math.round((assignedMs - triageMs) / 60000) : null;
        const assignStatus: "ok" | "warning" | "overdue" | "pending" =
          assignedMs
            ? assignDuration! <= SLA.assignment ? "ok" : assignDuration! <= SLA.assignment * 2 ? "warning" : "overdue"
            : t.assignedToId ? "ok"
            : (triageMs && (now - triageMs) / 60000 > SLA.assignment) ? "overdue" : "pending";

        // Step 3: الإسناد → بدء العمل الميداني
        const fieldStart = ["in_progress", "repaired", "verified", "closed"].includes(t.status) ? assignedMs : null;
        const fieldDuration = fieldStart && assignedMs ? Math.round((fieldStart - assignedMs) / 60000) : null;
        const fieldStatus: "ok" | "warning" | "overdue" | "pending" =
          fieldStart
            ? fieldDuration! <= SLA.fieldWork ? "ok" : fieldDuration! <= SLA.fieldWork * 1.5 ? "warning" : "overdue"
            : assignedMs ? (now - assignedMs) / 60000 > SLA.fieldWork ? "overdue" : "pending" : "pending";

        // Step 4: الإغلاق
        const closureDuration = closedMs ? Math.round((closedMs - createdMs) / 60000) : null;
        const closureStatus: "ok" | "warning" | "overdue" | "pending" | "done" =
          closedMs ? "done"
            : (now - createdMs) / 60000 > SLA.closure ? "overdue"
            : (now - createdMs) / 60000 > SLA.closure * 0.75 ? "warning" : "pending";

        // تحديد نقطة الاختناق
        let bottleneck = null;
        if (closureStatus === "overdue") bottleneck = "مرحلة الإغلاق";
        else if (fieldStatus === "overdue") bottleneck = "بدء العمل الميداني";
        else if (assignStatus === "overdue") bottleneck = "إسناد الفني";
        else if (triageStatus === "overdue") bottleneck = "مرحلة الفرز";

        const totalMin = Math.round((now - createdMs) / 60000);
        const overallStatus = bottleneck ? "overdue" : closedMs ? "done" : "ok";

        return {
          id: t.id,
          ticketNumber: t.ticketNumber,
          title: t.title,
          status: t.status,
          priority: t.priority,
          overallStatus,
          bottleneck,
          totalMinutes: totalMin,
          steps: [
            {
              label: "فتح البلاغ",
              icon: "create",
              completedAt: t.createdAt,
              durationMin: null,
              status: "done" as const,
              slaMin: null,
            },
            {
              label: "الفرز والتصنيف",
              icon: "triage",
              completedAt: triageMs ? new Date(triageMs) : null,
              durationMin: triageDuration,
              status: triageStatus,
              slaMin: SLA.triage,
            },
            {
              label: "إسناد الفني",
              icon: "assign",
              completedAt: t.assignedAt,
              durationMin: assignDuration,
              status: assignStatus,
              slaMin: SLA.assignment,
            },
            {
              label: "بدء العمل الميداني",
              icon: "field",
              completedAt: fieldStart ? new Date(fieldStart) : null,
              durationMin: fieldDuration,
              status: fieldStatus,
              slaMin: SLA.fieldWork,
            },
            {
              label: "إغلاق البلاغ",
              icon: "close",
              completedAt: t.closedAt,
              durationMin: closureDuration,
              status: closureStatus,
              slaMin: SLA.closure,
            },
          ],
        };
      });
    }),

    // جلب بيانات Timeline لطلبات الشراء
    getPOTimelines: managerProcedure.query(async () => {
      const ddb = await db.getDb();
      if (!ddb) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available" });
      const { purchaseOrders } = await import("../../drizzle/schema");
      const { desc: descOp2 } = await import("drizzle-orm");
      const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const rows = await ddb
        .select({
          id: purchaseOrders.id,
          poNumber: purchaseOrders.poNumber,
          status: purchaseOrders.status,
          createdAt: purchaseOrders.createdAt,
          accountingApprovedAt: purchaseOrders.accountingApprovedAt,
          managementApprovedAt: purchaseOrders.managementApprovedAt,
          rejectedAt: purchaseOrders.rejectedAt,
          updatedAt: purchaseOrders.updatedAt,
        })
        .from(purchaseOrders)
        .where(and(gte(purchaseOrders.createdAt, cutoff)))
        .orderBy(descOp2(purchaseOrders.createdAt))
        .limit(20);

      const SLA = {
        estimate: 240,    // التسعير 4 ساعات
        accounting: 480,  // المحاسبة 8 ساعات
        management: 240,  // الإدارة 4 ساعات
        purchase: 1440,   // الشراء 24 ساعة
      };
      const now = Date.now();

      return rows.map((po) => {
        const createdMs = new Date(po.createdAt).getTime();
        const accMs = po.accountingApprovedAt ? new Date(po.accountingApprovedAt).getTime() : null;
        const mgmtMs = po.managementApprovedAt ? new Date(po.managementApprovedAt).getTime() : null;
        const rejectedMs = po.rejectedAt ? new Date(po.rejectedAt).getTime() : null;
        const updatedMs = new Date(po.updatedAt).getTime();

        // Step 1: إنشاء → إضافة عروض الأسعار
        const estimateMs = ["pending_accounting", "pending_management", "approved", "partial_purchase", "purchased", "received", "closed"].includes(po.status) ? updatedMs : null;
        const estimateDuration = estimateMs ? Math.round((estimateMs - createdMs) / 60000) : null;
        const estimateStatus: "ok" | "warning" | "overdue" | "pending" =
          estimateMs
            ? estimateDuration! <= SLA.estimate ? "ok" : estimateDuration! <= SLA.estimate * 2 ? "warning" : "overdue"
            : (now - createdMs) / 60000 > SLA.estimate ? "overdue" : "pending";

        // Step 2: اعتماد المحاسبة
        const accDuration = accMs && estimateMs ? Math.round((accMs - estimateMs) / 60000) : null;
        const accStatus: "ok" | "warning" | "overdue" | "pending" | "done" =
          accMs ? "done"
            : estimateMs ? (now - estimateMs) / 60000 > SLA.accounting ? "overdue" : (now - estimateMs) / 60000 > SLA.accounting * 0.75 ? "warning" : "pending"
            : "pending";

        // Step 3: اعتماد الإدارة
        const mgmtDuration = mgmtMs && accMs ? Math.round((mgmtMs - accMs) / 60000) : null;
        const mgmtStatus: "ok" | "warning" | "overdue" | "pending" | "done" =
          mgmtMs ? "done"
            : accMs ? (now - accMs) / 60000 > SLA.management ? "overdue" : (now - accMs) / 60000 > SLA.management * 0.75 ? "warning" : "pending"
            : "pending";

        // Step 4: الشراء
        const purchaseStatus: "ok" | "warning" | "overdue" | "pending" | "done" =
          ["purchased", "received", "closed"].includes(po.status) ? "done"
            : rejectedMs ? "overdue"
            : mgmtMs ? (now - mgmtMs) / 60000 > SLA.purchase ? "overdue" : "pending"
            : "pending";

        let bottleneck = null;
        if (purchaseStatus === "overdue" && !rejectedMs) bottleneck = "مرحلة الشراء";
        else if (mgmtStatus === "overdue") bottleneck = "اعتماد الإدارة";
        else if (accStatus === "overdue") bottleneck = "اعتماد المحاسبة";
        else if (estimateStatus === "overdue") bottleneck = "مرحلة التسعير";

        const totalMin = Math.round((now - createdMs) / 60000);
        const overallStatus = rejectedMs ? "rejected" : bottleneck ? "overdue" : ["purchased", "received", "closed"].includes(po.status) ? "done" : "ok";

        return {
          id: po.id,
          poNumber: po.poNumber,
          status: po.status,
          overallStatus,
          bottleneck,
          totalMinutes: totalMin,
          steps: [
            { label: "إنشاء الطلب", icon: "create", completedAt: po.createdAt, durationMin: null, status: "done" as const, slaMin: null },
            { label: "إضافة عروض الأسعار", icon: "estimate", completedAt: estimateMs ? new Date(estimateMs) : null, durationMin: estimateDuration, status: estimateStatus, slaMin: SLA.estimate },
            { label: "اعتماد المحاسبة", icon: "accounting", completedAt: po.accountingApprovedAt, durationMin: accDuration, status: accStatus, slaMin: SLA.accounting },
            { label: "اعتماد الإدارة", icon: "management", completedAt: po.managementApprovedAt, durationMin: mgmtDuration, status: mgmtStatus, slaMin: SLA.management },
            { label: "الشراء والتسليم", icon: "purchase", completedAt: null, durationMin: null, status: purchaseStatus, slaMin: SLA.purchase },
          ],
        };
      });
    }),
  }),

  // ============================================================
  // PUSH NOTIFICATIONS
  // ============================================================
  push: router({
    getVapidPublicKey: publicProcedure.query(() => {
      return { publicKey: process.env.VAPID_PUBLIC_KEY || "" };
    }),

    subscribe: protectedProcedure.input(z.object({
      endpoint: z.string().url(),
      p256dh: z.string(),
      auth: z.string(),
      userAgent: z.string().optional(),
    })).mutation(async ({ input, ctx }) => {
      await db.savePushSubscription({
        userId: ctx.user.id,
        endpoint: input.endpoint,
        p256dh: input.p256dh,
        auth: input.auth,
        userAgent: input.userAgent,
      });
      return { success: true };
    }),

    unsubscribe: protectedProcedure.input(z.object({
      endpoint: z.string(),
    })).mutation(async ({ input }) => {
      await db.deletePushSubscription(input.endpoint);
      return { success: true };
    }),

    getStatus: protectedProcedure.query(async ({ ctx }) => {
      const subs = await db.getPushSubscriptionsByUser(ctx.user.id);
      return { subscribed: subs.length > 0, count: subs.length };
    }),
  }),

  // ============================================================
  // INSPECTION RESULTS
  // ============================================================
  inspectionResults: router({
    create: protectedProcedure.input(z.object({
      ticketId: z.number(),
      assetId: z.number().optional(),
      inspectorId: z.number(),
      inspectionType: z.enum(["triage", "detailed"]),
      severity: z.enum(["low", "medium", "high", "critical"]).optional(),
      rootCause: z.string().optional(),
      findings: z.string().optional(),
      recommendedAction: z.string().optional(),
    })).mutation(async ({ input, ctx }) => {
      const result = await db.createInspectionResult({
        ...input,
        inspectorId: ctx.user.id, // always use authenticated user, ignore input.inspectorId
        severity: input.severity ?? "medium",
        rootCause: input.rootCause ?? "",
        findings: input.findings ?? "",
        recommendedAction: input.recommendedAction ?? "",
      });
      return result;
    }),
    listByTicket: protectedProcedure.input(z.object({
      ticketId: z.number(),
    })).query(async ({ input }) => {
      return db.getInspectionResultsByTicket(input.ticketId);
    }),
    listByAsset: protectedProcedure.input(z.object({
      assetId: z.number(),
    })).query(async ({ input }) => {
      return db.getInspectionResultsByAsset(input.assetId);
    }),
    dashboardStats: protectedProcedure.query(async () => {
      return db.getInspectionDashboardStats();
    }),
  }),
  assetCategories: router({
    list: protectedProcedure.query(async () => {
      return db.listAssetCategories();
    }),
    create: protectedProcedure.input(z.object({ name: z.string().min(1) })).mutation(async ({ input }) => {
      return db.createAssetCategory(input.name);
    }),
    update: protectedProcedure.input(z.object({ id: z.number(), name: z.string().min(1) })).mutation(async ({ input }) => {
      return db.updateAssetCategory(input.id, input.name);
    }),
    delete: protectedProcedure.input(z.object({ id: z.number() })).mutation(async ({ input }) => {
      return db.deleteAssetCategory(input.id);
    }),
  }),
});
export type AppRouter = typeof appRouter;

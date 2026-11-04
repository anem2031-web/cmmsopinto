import { publicProcedure, protectedProcedure, router } from "../../_core/trpc";
import { TRPCError } from "@trpc/server";
import { APP_ROLE } from "@shared/roles";

export { publicProcedure, protectedProcedure, router };

const roleMiddleware = (allowedRoles: string[]) => {
  return protectedProcedure.use(({ ctx, next }) => {
    if (
      !allowedRoles.includes(ctx.user.role) &&
      ctx.user.role !== APP_ROLE.ADMIN &&
      ctx.user.role !== APP_ROLE.OWNER
    ) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "ليس لديك صلاحية لهذا الإجراء",
      });
    }
    return next({ ctx });
  });
};

const denyRolesMiddleware = (deniedRoles: string[]) => {
  return protectedProcedure.use(({ ctx, next }) => {
    if (deniedRoles.includes(ctx.user.role)) {
      throw new TRPCError({ code: "FORBIDDEN", message: "ليس لديك صلاحية للوصول إلى هذا القسم" });
    }
    return next({ ctx });
  });
};

/** Shared manager capabilities outside ticket-specific modules. */
export const managerProcedure = roleMiddleware([
  APP_ROLE.MAINTENANCE_MANAGER,
  APP_ROLE.GENERAL_MAINTENANCE_MANAGER,
  APP_ROLE.CONSTRUCTION_PROCUREMENT_MANAGER,
  APP_ROLE.PURCHASE_MANAGER,
  APP_ROLE.OWNER,
  APP_ROLE.ADMIN,
]);

/**
 * Generic ticket actions remain unavailable to the construction role unless a
 * router explicitly loads the ticket and applies the per-ticket routing guard.
 */
export const ticketProcedure = denyRolesMiddleware([
  APP_ROLE.CONSTRUCTION_PROCUREMENT_MANAGER,
]);

/**
 * ⚠️ 2026-08-13: مدير الإنشاءات والمشتريات أُضيف هنا ليستطيع تصنيف بلاغه
 * الشخصي فقط — بنفس آلية الفرز المستخدَمة مع مدير الصيانة العامة حرفيًا (نفس
 * `triage`/`triageMulti`/`triageTicket`). هذا الإجراء فحص **دور** فقط ولا
 * يميّز بين بلاغه وبلاغ غيره، لذلك القيد الفعلي (بلاغه فقط) مطبَّق **داخل كل
 * إجراء على حدة** عبر assertConstructionManagerOwnTicketForTriage في
 * tickets.workflow.ts — لا تعتمد على هذه القائمة وحدها لفرض الملكية.
 * راجع docs/CONSTRUCTION_MANAGER_OWN_TICKET_TRIAGE.md.
 */
export const ticketTriageProcedure = roleMiddleware([
  APP_ROLE.MAINTENANCE_MANAGER,
  APP_ROLE.GENERAL_MAINTENANCE_MANAGER,
  APP_ROLE.CONSTRUCTION_PROCUREMENT_MANAGER,
  APP_ROLE.OWNER,
  APP_ROLE.ADMIN,
]);

/** Ticket workflow is retained by the legacy and general-maintenance roles only. */
export const ticketManagerProcedure = roleMiddleware([
  APP_ROLE.MAINTENANCE_MANAGER,
  APP_ROLE.GENERAL_MAINTENANCE_MANAGER,
  APP_ROLE.CONSTRUCTION_PROCUREMENT_MANAGER,
  APP_ROLE.OWNER,
  APP_ROLE.ADMIN,
]);

/**
 * Scoped ticket workflow decisions. IT Manager is admitted here only so the
 * ticket routers can apply per-ticket IT ownership guards; this does NOT make
 * the role a general maintenance manager. Keep generic manager procedures
 * unchanged.
 */
export const ticketScopedWorkflowManagerProcedure = roleMiddleware([
  APP_ROLE.MAINTENANCE_MANAGER,
  APP_ROLE.GENERAL_MAINTENANCE_MANAGER,
  APP_ROLE.CONSTRUCTION_PROCUREMENT_MANAGER,
  APP_ROLE.IT_MANAGER,
  APP_ROLE.IT_MEMBER,
  APP_ROLE.OWNER,
  APP_ROLE.ADMIN,
]);

/** Closure-capable ticket roles, with IT still constrained by ticket scope. */
export const ticketScopedClosureProcedure = roleMiddleware([
  APP_ROLE.SUPERVISOR,
  APP_ROLE.MAINTENANCE_MANAGER,
  APP_ROLE.GENERAL_MAINTENANCE_MANAGER,
  APP_ROLE.CONSTRUCTION_PROCUREMENT_MANAGER,
  APP_ROLE.IT_MANAGER,
  APP_ROLE.IT_MEMBER,
  APP_ROLE.OWNER,
  APP_ROLE.ADMIN,
]);

export const supervisorProcedure = roleMiddleware([
  APP_ROLE.SUPERVISOR,
  APP_ROLE.MAINTENANCE_MANAGER,
  APP_ROLE.GENERAL_MAINTENANCE_MANAGER,
  APP_ROLE.CONSTRUCTION_PROCUREMENT_MANAGER,
  APP_ROLE.OWNER,
  APP_ROLE.ADMIN,
]);

export const gateSecurityProcedure = roleMiddleware([
  APP_ROLE.GATE_SECURITY,
  APP_ROLE.OWNER,
  APP_ROLE.ADMIN,
]);

export const accountantProcedure = roleMiddleware([
  APP_ROLE.ACCOUNTANT,
  APP_ROLE.OWNER,
  APP_ROLE.ADMIN,
]);

export const managementProcedure = roleMiddleware([
  APP_ROLE.SENIOR_MANAGEMENT,
  APP_ROLE.EXECUTIVE_DIRECTOR,
  APP_ROLE.OWNER,
  APP_ROLE.ADMIN,
]);

// صلاحية الفرز والتصنيف بمركز التحسين والتطوير: عائلة مدير الصيانة فقط.
export const ideaTriageProcedure = roleMiddleware([
  APP_ROLE.MAINTENANCE_MANAGER,
  APP_ROLE.GENERAL_MAINTENANCE_MANAGER,
  APP_ROLE.CONSTRUCTION_PROCUREMENT_MANAGER,
]);

export const warehouseProcedure = roleMiddleware([
  APP_ROLE.WAREHOUSE,
  APP_ROLE.OWNER,
  APP_ROLE.ADMIN,
]);

/**
 * قائمة فارغة تعني عمليًا "أدمن ومالك فقط" — roleMiddleware يسمح بهما دائمًا
 * بغض النظر عن القائمة الممرَّرة (راجع أعلى الملف). تُستخدم لعمليات حسّاسة
 * لا يجب أن يصل إليها حتى دور warehouse العادي، مثل تعديل مسمى مخزن فرعي.
 */
export const adminOwnerProcedure = roleMiddleware([]);

/** Preparing stock adjustments never grants posting; review is a separate capability. */
export const settlementReviewReadProcedure = roleMiddleware([
  APP_ROLE.WAREHOUSE,
  APP_ROLE.SENIOR_MANAGEMENT,
]);
export const settlementReviewProcedure = roleMiddleware([
  APP_ROLE.SENIOR_MANAGEMENT,
]);

export const delegateProcedure = roleMiddleware([
  APP_ROLE.DELEGATE,
  APP_ROLE.OWNER,
  APP_ROLE.ADMIN,
]);

/**
 * Read-only catalog data is still available to the general-maintenance role
 * because purchase-order creation uses catalog nodes/items/units internally.
 * The standalone catalog module and all catalog mutations remain excluded.
 */
const CATALOG_READ_ROLES = [
  APP_ROLE.MAINTENANCE_MANAGER,
  APP_ROLE.GENERAL_MAINTENANCE_MANAGER,
  APP_ROLE.CONSTRUCTION_PROCUREMENT_MANAGER,
  APP_ROLE.PURCHASE_MANAGER,
  APP_ROLE.PURCHASE_REQUESTER,
  APP_ROLE.IT_MANAGER,
  APP_ROLE.WAREHOUSE,
  APP_ROLE.FOOD_WAREHOUSE_MANAGER,
  APP_ROLE.FOOD_WAREHOUSE_ASSISTANT,
  APP_ROLE.SENIOR_MANAGEMENT,
  APP_ROLE.OWNER,
  APP_ROLE.ADMIN,
];

export const catalogReadProcedure = roleMiddleware(CATALOG_READ_ROLES).use(({ ctx, next }) => {
  if (ctx.user.role === APP_ROLE.SENIOR_MANAGEMENT && ctx.user.isActive !== 1) {
    throw new TRPCError({ code: "FORBIDDEN", message: "الحساب غير نشط" });
  }
  return next({ ctx });
});

/** Purchase forms consume reference lists without granting supplier matching or Catalog management. */
export const catalogReferenceReadProcedure = roleMiddleware([
  ...CATALOG_READ_ROLES,
  APP_ROLE.DELEGATE,
  APP_ROLE.ACCOUNTANT,
  APP_ROLE.SENIOR_MANAGEMENT,
  APP_ROLE.EXECUTIVE_DIRECTOR,
]);

/**
 * Standalone Catalog management policy (2B-10):
 * - owner/admin: always allowed by roleMiddleware
 * - senior management: granted Catalog operations; settings remain owner/admin only
 * - maintenance manager / general maintenance manager / construction-procurement manager:
 *   day-to-day Catalog management
 * - remaining roles: no Catalog management mutations
 *
 * Broad catalogReadProcedure remains intentionally unchanged because purchase,
 * receipt, warehouse and inventory workflows consume Catalog as shared reference
 * data. That operational read access is not access to the standalone Catalog UI.
 */
export const catalogProcedure = roleMiddleware([
  APP_ROLE.MAINTENANCE_MANAGER,
  APP_ROLE.GENERAL_MAINTENANCE_MANAGER,
  APP_ROLE.CONSTRUCTION_PROCUREMENT_MANAGER,
  APP_ROLE.WAREHOUSE,
  APP_ROLE.SENIOR_MANAGEMENT,
]).use(({ ctx, next }) => {
  if (ctx.user.role === APP_ROLE.SENIOR_MANAGEMENT && ctx.user.isActive !== 1) {
    throw new TRPCError({ code: "FORBIDDEN", message: "الحساب غير نشط" });
  }
  return next({ ctx });
});

/** Reference details needed to view/edit items; no Catalog management mutations. */
export const catalogViewProcedure = roleMiddleware([
  APP_ROLE.MAINTENANCE_MANAGER,
  APP_ROLE.GENERAL_MAINTENANCE_MANAGER,
  APP_ROLE.CONSTRUCTION_PROCUREMENT_MANAGER,
  APP_ROLE.WAREHOUSE,
  APP_ROLE.SENIOR_MANAGEMENT,
]).use(({ ctx, next }) => {
  if (ctx.user.role === APP_ROLE.SENIOR_MANAGEMENT && ctx.user.isActive !== 1) {
    throw new TRPCError({ code: "FORBIDDEN", message: "الحساب غير نشط" });
  }
  return next({ ctx });
});

/** Item CRUD grants, including IT item-only access and full senior Catalog access. */
export const catalogItemManagerProcedure = roleMiddleware([
  APP_ROLE.MAINTENANCE_MANAGER,
  APP_ROLE.GENERAL_MAINTENANCE_MANAGER,
  APP_ROLE.CONSTRUCTION_PROCUREMENT_MANAGER,
  APP_ROLE.WAREHOUSE,
  APP_ROLE.IT_MANAGER,
  APP_ROLE.SENIOR_MANAGEMENT,
]).use(({ ctx, next }) => {
  if ([APP_ROLE.IT_MANAGER, APP_ROLE.SENIOR_MANAGEMENT].includes(ctx.user.role as any) && ctx.user.isActive !== 1) {
    throw new TRPCError({ code: "FORBIDDEN", message: "الحساب غير نشط" });
  }
  return next({ ctx });
});

/** Existing item readers and the explicitly granted senior Catalog role. */
export const catalogItemReadProcedure = roleMiddleware([
  APP_ROLE.MAINTENANCE_MANAGER,
  APP_ROLE.GENERAL_MAINTENANCE_MANAGER,
  APP_ROLE.CONSTRUCTION_PROCUREMENT_MANAGER,
  APP_ROLE.WAREHOUSE,
  APP_ROLE.IT_MANAGER,
  APP_ROLE.SENIOR_MANAGEMENT,
]).use(({ ctx, next }) => {
  if ([APP_ROLE.IT_MANAGER, APP_ROLE.SENIOR_MANAGEMENT].includes(ctx.user.role as any) && ctx.user.isActive !== 1) {
    throw new TRPCError({ code: "FORBIDDEN", message: "الحساب غير نشط" });
  }
  return next({ ctx });
});

export const catalogItemUpdateProcedure = catalogItemReadProcedure;

/**
 * تعطيل/إعادة تفعيل أصناف الكتالوج تحديداً (isActive toggle فقط).
 * أوسع من catalogProcedure بإضافة مدير الصيانة والمستودع لهذه الميزة تحديداً،
 * بقية صلاحيات الكتالوج مستقلة؛ منحة الإدارة العليا الكاملة لا توسع دور المستودع أو مدير الصيانة.
 */
export const catalogItemLifecycleProcedure = roleMiddleware([
  APP_ROLE.MAINTENANCE_MANAGER,
  APP_ROLE.WAREHOUSE,
  APP_ROLE.SENIOR_MANAGEMENT,
]).use(({ ctx, next }) => {
  if (ctx.user.role === APP_ROLE.SENIOR_MANAGEMENT && ctx.user.isActive !== 1) {
    throw new TRPCError({ code: "FORBIDDEN", message: "الحساب غير نشط" });
  }
  return next({ ctx });
});

/** Item deactivation only; reactivation retains the existing lifecycle grant. */
export const catalogItemDeactivateProcedure = roleMiddleware([
  APP_ROLE.MAINTENANCE_MANAGER,
  APP_ROLE.WAREHOUSE,
  APP_ROLE.IT_MANAGER,
  APP_ROLE.CONSTRUCTION_PROCUREMENT_MANAGER,
  APP_ROLE.SENIOR_MANAGEMENT,
]).use(({ ctx, next }) => {
  if ([APP_ROLE.IT_MANAGER, APP_ROLE.CONSTRUCTION_PROCUREMENT_MANAGER, APP_ROLE.SENIOR_MANAGEMENT].includes(ctx.user.role as any) && ctx.user.isActive !== 1) {
    throw new TRPCError({ code: "FORBIDDEN", message: "الحساب غير نشط" });
  }
  return next({ ctx });
});

/** Existing import/export pipeline; it does not grant other Catalog administration. */
export const catalogImportExportProcedure = roleMiddleware([
  APP_ROLE.SENIOR_MANAGEMENT,
]).use(({ ctx, next }) => {
  if (ctx.user.role === APP_ROLE.SENIOR_MANAGEMENT && ctx.user.isActive !== 1) {
    throw new TRPCError({ code: "FORBIDDEN", message: "الحساب غير نشط" });
  }
  return next({ ctx });
});

/** Full Catalog administration only; no global owner/admin capability is inherited. */
export const catalogAdminProcedure = roleMiddleware([
  APP_ROLE.SENIOR_MANAGEMENT,
]).use(({ ctx, next }) => {
  if (ctx.user.role === APP_ROLE.SENIOR_MANAGEMENT && ctx.user.isActive !== 1) {
    throw new TRPCError({ code: "FORBIDDEN", message: "الحساب غير نشط" });
  }
  return next({ ctx });
});

/** Standalone Construction module is restricted to owner/admin. */
export const constructionProcedure = roleMiddleware([]);

/** Both derived roles explicitly exclude warehouse/inventory modules. */
export const inventoryReadProcedure = denyRolesMiddleware([
  APP_ROLE.GENERAL_MAINTENANCE_MANAGER,
  APP_ROLE.CONSTRUCTION_PROCUREMENT_MANAGER,
]);

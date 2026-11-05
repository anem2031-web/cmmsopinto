import {
  AUTH_TEMPORARILY_UNAVAILABLE_ERR_MSG,
  NOT_ADMIN_ERR_MSG,
  UNAUTHED_ERR_MSG,
} from "@shared/const";
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";
import { assertObserverRpc } from "./authz/observer-guard";
import { isObserver, redactObserverValue } from "../../shared/observer-policy";
import { runObserverRead } from "./authz/observer-read-scope";
import { assertTechnicianRpc } from "./authz/technician-guard";
import { assertBusinessRpc } from "./authz/business-guard";
import { isBusinessGuardedRole } from "../../shared/business-role-policy";
import { redactUserSecrets } from "../../shared/user-response";
import { assertDelegateDirectoryRpc } from "./authz/delegate-directory-guard";
import { assertGateSecurityRpc, assertGateSecurityResourceAccess } from "./authz/gate-security-guard";
import { isOwnerAdminOnlyRpc, isOwnerOrAdminRole } from "../../shared/restricted-module-policy";
import { approvedPricingDocumentRpcAllowed } from "../../shared/approved-pricing-documents";
import { externalDelegateRpcAllowed } from "../../shared/external-delegate-access";
import { isDelegateRole, delegateManagerAssignmentRpcAllowed } from "../../shared/delegate-role";
import { externalFollowupRpcAllowed } from "../../shared/external-maintenance-followup";

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
});

export const router = t.router;
const roleScopeGuard = t.middleware(async opts => {
  const user = opts.ctx.authenticatedUser ?? opts.ctx.user;
  if (!externalFollowupRpcAllowed(user, opts.type, opts.path)) throw new TRPCError({ code: "FORBIDDEN", message: "ليس لديك صلاحية لمتابعة الصيانة الخارجية" });
  if (!delegateManagerAssignmentRpcAllowed(user, opts.type, opts.path)) throw new TRPCError({ code: "FORBIDDEN", message: "تعيين الصنف لمسئول المناديب فقط" });
  if (!externalDelegateRpcAllowed(user, opts.type, opts.path)) throw new TRPCError({ code: "FORBIDDEN", message: "الإجراء للمندوب المسند إليه الأصل فقط" });
  if (isDelegateRole(user?.role)) {
    assertDelegateDirectoryRpc(user, opts.path, await opts.getRawInput());
    return opts.next({ ctx: { ...opts.ctx, user: user! } });
  }
  if (user?.role === "gate_security") {
    assertGateSecurityRpc(user, opts.type, opts.path);
    await assertGateSecurityResourceAccess(user, opts.type, opts.path, await opts.getRawInput());
    return opts.next({ ctx: { ...opts.ctx, user } });
  }
  return opts.next();
});
const restrictedModuleGuard = t.middleware(async opts => {
  const user = opts.ctx.authenticatedUser ?? opts.ctx.user;
  if (isOwnerAdminOnlyRpc(opts.path) && !isOwnerOrAdminRole(user?.role)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "هذه الوحدة متاحة للمالك ومدير النظام فقط",
    });
  }
  return opts.next();
});
const responseGuard = t.middleware(async opts => {
  const result = await opts.next();
  return result.ok ? { ...result, data: redactUserSecrets(result.data) } : result;
});
const mediaInputGuard = t.middleware(async opts => {
  const user = opts.ctx.authenticatedUser ?? opts.ctx.user;
  if (user && opts.type === "mutation") {
    const { assertMediaMutationAccess } = await import("./authz/media-access");
    await assertMediaMutationAccess(user, opts.path, await opts.getRawInput());
  }
  return opts.next();
});
const businessGuard = t.middleware(async opts => {
  const user = opts.ctx.authenticatedUser ?? opts.ctx.user;
  if (!isBusinessGuardedRole(user?.role)) return opts.next();
  assertBusinessRpc(user, opts.type, opts.path, await opts.getRawInput());
  let businessProjectIds: number[] | undefined;
  if (opts.path.startsWith("construction.")) {
    const { assertBusinessProjectAccess } = await import("./authz/business-projects");
    businessProjectIds = await assertBusinessProjectAccess(user!, opts.type, opts.path, await opts.getRawInput());
  }
  if (opts.path === "translation.getEntityTranslations" || opts.path === "translation.getBatchTranslations") {
    const { assertBusinessTranslationAccess } = await import("./authz/business-resources");
    await assertBusinessTranslationAccess(user!, await opts.getRawInput(), opts.path === "translation.getBatchTranslations" ? "batch" : "single");
  }
  return opts.next({ ctx: { ...opts.ctx, user: user!, businessProjectIds } });
});
const observerGuard = t.middleware(async opts => {
  const originalUser = opts.ctx.authenticatedUser ?? opts.ctx.user;
  assertObserverRpc(originalUser, opts.type, opts.path);
  if (!isObserver(originalUser?.role)) return opts.next();
  const authenticatedUser = originalUser!;
  const work = () => opts.next({ ctx: {
    ...opts.ctx,
    authenticatedUser,
    // Existing read guards/UI scopes get admin visibility only after the
    // actual role, active status, type and explicit path pass the outer gate.
    user: opts.path === "auth.me" || opts.path === "auth.logout"
      ? authenticatedUser : { ...authenticatedUser, role: "admin" as const },
  } });
  const result = await runObserverRead(authenticatedUser.id, work);
  if (result.ok) return { ...result, data: redactObserverValue(result.data, 0, opts.path === "backups.list") };
  return result;
});
const technicianGuard = t.middleware(async opts => {
  const user = opts.ctx.authenticatedUser ?? opts.ctx.user;
  if (user?.role === "technician") {
    // Reject the capability before parsing or loading any resource data.
    assertTechnicianRpc(user, opts.type, opts.path, await opts.getRawInput());
    if (opts.path === "translation.getEntityTranslations" || opts.path === "translation.getBatchTranslations") {
      const { assertTechnicianTranslationAccess } = await import("./authz/technician-resources");
      await assertTechnicianTranslationAccess(user, await opts.getRawInput(), opts.path === "translation.getBatchTranslations" ? "batch" : "single");
    }
    return opts.next({ ctx: { ...opts.ctx, user } });
  }
  return opts.next();
});
const baseProcedure = t.procedure.use(responseGuard).use(restrictedModuleGuard).use(roleScopeGuard).use(businessGuard).use(technicianGuard).use(observerGuard).use(mediaInputGuard);
export const publicProcedure = baseProcedure;

const requireUser = t.middleware(async opts => {
  const { ctx, next } = opts;

  if (!ctx.user) {
    if (ctx.authFailure === "dependency") {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: AUTH_TEMPORARILY_UNAVAILABLE_ERR_MSG,
      });
    }
    throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }

  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
    },
  });
});

export const protectedProcedure = baseProcedure.use(requireUser);

/** Separate closed capability for the two named accounts and owner/admin.
 * It grants only the final-document reader, never a purchasing role/projection.
 * The document service rechecks the current account and full approval scope. */
export const approvedPricingDocumentProcedure = t.procedure.use(responseGuard).use(requireUser).use(t.middleware(opts => {
  const actor = opts.ctx.authenticatedUser ?? opts.ctx.user;
  if (!approvedPricingDocumentRpcAllowed(actor, opts.type, opts.path)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "ليس لديك صلاحية حزم التسعير المعتمدة" });
  }
  return opts.next({ ctx: { ...opts.ctx, user: actor! } });
}));

export const adminProcedure = baseProcedure.use(
  t.middleware(async opts => {
    const { ctx, next } = opts;

    if (!ctx.user) {
      if (ctx.authFailure === "dependency") {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: AUTH_TEMPORARILY_UNAVAILABLE_ERR_MSG,
        });
      }
      throw new TRPCError({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
    }
    if (ctx.user.role !== "admin") {
      throw new TRPCError({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
    }

    return next({
      ctx: {
        ...ctx,
        user: ctx.user,
      },
    });
  })
);

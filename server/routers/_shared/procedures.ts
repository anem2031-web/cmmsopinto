import { publicProcedure, protectedProcedure, router } from "../../_core/trpc";
import { TRPCError } from "@trpc/server";

export { publicProcedure, protectedProcedure, router };

const roleMiddleware = (allowedRoles: string[]) => {
  return protectedProcedure.use(({ ctx, next }) => {
    if (
      !allowedRoles.includes(ctx.user.role) &&
      ctx.user.role !== "admin" &&
      ctx.user.role !== "owner"
    ) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "ليس لديك صلاحية لهذا الإجراء",
      });
    }
    return next({ ctx });
  });
};

export const managerProcedure = roleMiddleware([
  "maintenance_manager",
  "purchase_manager",
  "owner",
  "admin",
]);

export const supervisorProcedure = roleMiddleware([
  "supervisor",
  "maintenance_manager",
  "owner",
  "admin",
]);

export const gateSecurityProcedure = roleMiddleware([
  "gate_security",
  "owner",
  "admin",
]);

export const accountantProcedure = roleMiddleware([
  "accountant",
  "owner",
  "admin",
]);

export const managementProcedure = roleMiddleware([
  "senior_management",
  "owner",
  "admin",
]);

export const warehouseProcedure = roleMiddleware([
  "warehouse",
  "owner",
  "admin",
]);

export const delegateProcedure = roleMiddleware([
  "delegate",
  "owner",
  "admin",
]);
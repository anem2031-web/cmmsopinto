import { TRPCError } from "@trpc/server";

export const ADMIN_ROLES = ["owner", "admin"] as const;
export const MANAGER_ROLES = ["maintenance_manager", "purchase_manager", "owner", "admin"] as const;
export const SUPERVISOR_ROLES = ["supervisor", "maintenance_manager", "owner", "admin"] as const;

export function requireAdminRole(role: string, message = "فقط المالك يمكنه تنفيذ هذا الإجراء") {
  if (!ADMIN_ROLES.includes(role as any)) {
    throw new TRPCError({ code: "FORBIDDEN", message });
  }
}

export function requireManagerRole(role: string, message = "ليس لديك صلاحية لهذا الإجراء") {
  if (!MANAGER_ROLES.includes(role as any)) {
    throw new TRPCError({ code: "FORBIDDEN", message });
  }
}

export function isAdmin(role: string): boolean {
  return ADMIN_ROLES.includes(role as any);
}

export function isManager(role: string): boolean {
  return MANAGER_ROLES.includes(role as any);
}

export function isSupervisor(role: string): boolean {
  return SUPERVISOR_ROLES.includes(role as any);
}

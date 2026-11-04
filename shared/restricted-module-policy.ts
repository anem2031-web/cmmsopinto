/**
 * Owner/admin-only modules and independent invoice receipt.
 *
 * This policy intentionally does not include PM V2 (/scheduled-maintenance or
 * pmv2.*). The independent receipt entry is distinct from purchase-order
 * receiving, which retains its existing warehouse permissions.
 */
export function isOwnerOrAdminRole(role?: string | null): boolean {
  return role === "owner" || role === "admin";
}

export function isOwnerAdminOnlyPage(rawPath: string): boolean {
  const path = rawPath.split(/[?#]/, 1)[0] || "/";
  return path === "/construction" || path.startsWith("/construction/")
    || path === "/preventive" || path.startsWith("/preventive/")
    || path === "/predictive" || path.startsWith("/predictive/")
    || path === "/reports/preventive" || path.startsWith("/reports/preventive/")
    || path === "/inventory/receive" || path === "/inventory/receive/";
}

export function isOwnerAdminOnlyRpc(path: string): boolean {
  return path === "warehouseReceiptsV2.receiveStandaloneV2"
    || path === "construction" || path.startsWith("construction.")
    || path === "preventive" || path.startsWith("preventive.");
}

export function isOwnerAdminOnlyHttpPath(rawPath: string): boolean {
  const path = rawPath.split(/[?#]/, 1)[0] || "/";
  return path === "/api/export/preventive-plans"
    || path === "/api/export/pm-work-orders"
    || /^\/api\/export\/pm-work-order\/[1-9]\d*$/.test(path);
}

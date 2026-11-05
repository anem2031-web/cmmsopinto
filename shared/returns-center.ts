/** Navigation/presentation only. Existing RPC and record guards remain authoritative. */
export const RETURNS_CENTER_PATH = "/returns-center";
export const RETURNS_CENTER_PANELS = ["suppliers", "materials", "specifications", "documents"] as const;
export type ReturnsCenterPanel = (typeof RETURNS_CENTER_PANELS)[number];
export const RETURNS_MATERIAL_SOURCES = ["tickets", "pmv2", "operational"] as const;
export type ReturnsMaterialSource = (typeof RETURNS_MATERIAL_SOURCES)[number];

// Intersection of the existing supplier page and RPC capabilities. This list
// deliberately excludes technician, IT member, observer and gate security.
export const RETURNS_CENTER_SUPPLIER_ROLES = [
  "owner", "admin", "warehouse", "delegate", "delegate_manager",
  "maintenance_manager", "general_maintenance_manager", "construction_procurement_manager",
  "it_manager", "purchase_manager", "accountant", "senior_management", "executive_director",
  "user", "operator", "supervisor", "purchase_requester", "food_warehouse_manager", "food_warehouse_assistant",
] as const;
const warehouseRoles = new Set(["owner", "admin", "warehouse"]);
const documentRoles = new Set(["owner", "admin", "warehouse", "senior_management"]);

export function getReturnsCenterPanels(role: string | null | undefined): ReturnsCenterPanel[] {
  if (!role) return [];
  const result: ReturnsCenterPanel[] = [];
  if ((RETURNS_CENTER_SUPPLIER_ROLES as readonly string[]).includes(role)) result.push("suppliers");
  if (warehouseRoles.has(role)) result.push("materials", "specifications");
  if (documentRoles.has(role)) result.push("documents");
  return result;
}

export function canAccessReturnsCenter(role: string | null | undefined): boolean {
  return getReturnsCenterPanels(role).length > 0;
}

export function canCreateReturn(role: string | null | undefined): boolean {
  return !!role && warehouseRoles.has(role);
}

export function returnsCenterLink(tab: ReturnsCenterPanel = "suppliers", source?: ReturnsMaterialSource): string {
  const params = new URLSearchParams({ tab });
  if (tab === "materials" && source) params.set("source", source);
  return `${RETURNS_CENTER_PATH}?${params.toString()}`;
}

/** Keep the old wizard's default destination; only an explicit center entry
 * returns to the center. Never accept an arbitrary return URL from the query. */
export function warehouseReturnBackLink(search: string): string {
  const params = new URLSearchParams(search);
  if (params.get("returnTo") !== "returns-center") return "/warehouse/returns";
  const selected = params.get("returnTab");
  const tab = (RETURNS_CENTER_PANELS as readonly string[]).includes(selected || "")
    ? selected as ReturnsCenterPanel : "suppliers";
  return returnsCenterLink(tab);
}

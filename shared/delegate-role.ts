/** Capability family only. Never replace an authenticated actor's real role. */
export const DELEGATE_ROLES = ["delegate", "delegate_manager"] as const;
export function isDelegateRole(role?: string | null): role is typeof DELEGATE_ROLES[number] {
  return role === "delegate" || role === "delegate_manager";
}

/** Document-center lists are not part of the delegate pricing archive. */
export function delegateDocumentCenterRpcAllowed(role: string | null | undefined, path: string): boolean {
  return !isDelegateRole(role) || !["attachments.listByType", "delegatePricingBundles.listPage"].includes(path);
}

/** Recipient names for direct reassignment are scoped to one current owned item. */
export type DelegateChangeOptionsInput = { forDelegateChange: true; itemId: number };
export function isDelegateChangeOptionsInput(input: unknown): input is DelegateChangeOptionsInput {
  if (!input || typeof input !== "object" || Array.isArray(input)) return false;
  const value = input as Record<string, unknown>;
  return Object.keys(value).length === 2 && value.forDelegateChange === true
    && typeof value.itemId === "number" && Number.isSafeInteger(value.itemId) && value.itemId > 0;
}

/** The old manager assignment remains closed; only the named query mode adds delegate access. */
export function delegateManagerAssignmentRpcAllowed(user: { id: number; role: string; isActive?: number } | null | undefined, type: string, path: string, raw?: unknown): boolean {
  if (!["purchaseOrders.assignOwnDelegateItem", "purchaseOrders.delegateAssignmentOptions"].includes(path)) return true;
  if (!user || user.isActive !== 1 || !Number.isSafeInteger(user.id) || user.id <= 0) return false;
  if (path === "purchaseOrders.assignOwnDelegateItem") return type === "mutation" && user.role === "delegate_manager";
  if (type !== "query") return false;
  return raw === undefined ? user.role === "delegate_manager"
    : isDelegateRole(user.role) && isDelegateChangeOptionsInput(raw);
}

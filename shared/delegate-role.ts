/** Capability family only. Never replace an authenticated actor's real role. */
export const DELEGATE_ROLES = ["delegate", "delegate_manager"] as const;
export function isDelegateRole(role?: string | null): role is typeof DELEGATE_ROLES[number] {
  return role === "delegate" || role === "delegate_manager";
}

/** The manager's sole additional capability is this explicitly reviewed pair. */
export function delegateManagerAssignmentRpcAllowed(user: { id: number; role: string; isActive?: number } | null | undefined, type: string, path: string): boolean {
  if (!["purchaseOrders.assignOwnDelegateItem", "purchaseOrders.delegateAssignmentOptions"].includes(path)) return true;
  return !!user && user.role === "delegate_manager" && user.isActive === 1 && Number.isSafeInteger(user.id) && user.id > 0
    && (path === "purchaseOrders.assignOwnDelegateItem" ? type === "mutation" : type === "query");
}

/** Explicit account-scoped, read/print-only grant. Login names come from the
 * authenticated user record, never a display name or client-supplied input. */
export type ApprovedPricingDocumentActor = {
  id: number; role: string; isActive?: number; username?: string | null;
};
export const APPROVED_PRICING_DOCUMENT_TITLE = "حزم التسعير المعتمدة";
export function canReadApprovedPricingDocuments(actor: ApprovedPricingDocumentActor | null | undefined): boolean {
  if (!actor || actor.isActive !== 1 || !Number.isSafeInteger(actor.id) || actor.id <= 0) return false;
  return ["admin", "owner"].includes(actor.role)
    || ["anis", "ahmed1"].includes((actor.username || "").toLowerCase());
}
export function approvedPricingDocumentRpcAllowed(actor: ApprovedPricingDocumentActor | null | undefined, type: string, path: string): boolean {
  return canReadApprovedPricingDocuments(actor)
    && (type === "query" && path === "approvedPricingDocuments.listPage"
      || type === "mutation" && path === "approvedPricingDocuments.pdf");
}
export function approvedPricingDocumentPageAllowed(actor: ApprovedPricingDocumentActor | null | undefined, path: string): boolean {
  return canReadApprovedPricingDocuments(actor) && path.split(/[?#]/,1)[0] === "/documents";
}
/** Mirrors the existing document-center navigation, without granting other APIs. */
export const EXISTING_DOCUMENT_CENTER_ROLES = ["delegate", "warehouse", "accountant", "senior_management", "executive_director", "maintenance_manager", "purchase_requester", "food_warehouse_manager", "food_warehouse_assistant", "owner", "admin", "observer"];

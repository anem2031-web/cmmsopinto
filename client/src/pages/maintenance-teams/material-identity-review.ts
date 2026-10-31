import type { MaterialNeed, Snapshot } from "@shared/maintenance-team-tickets/model";
import { materialUnitMismatch } from "@shared/maintenance-team-tickets/material-routing";

/** Presentation eligibility only; the resolve RPC rechecks current history and identity. */
export function canReviewTicketMaterialQuantity(state: Snapshot, need: MaterialNeed): boolean {
  if (need.catalogItemId == null) return true;
  return materialUnitMismatch(state, need) && need.used === null &&
    !state.deliveries.some(delivery => delivery.needId === need.id) &&
    !state.supplies.some(supply => supply.needId === need.id);
}

import type { MaterialNeed, Snapshot } from "./model";

/** Identity linking does not establish a conversion between requested and stock units. */
export function materialUnitMismatch(state: Pick<Snapshot, "catalog">, need: MaterialNeed): boolean {
  const item = state.catalog.find(item => item.id === need.catalogItemId);
  return !!item && item.unit !== need.unit;
}

export function materialRouteNote(
  need: MaterialNeed,
  shortage: number,
  message: string,
  identityReview?: { before: unknown; after: unknown }
): string {
  return JSON.stringify({
    version: 1,
    type: "ticket_material_need",
    round: need.round,
    originalName: need.originalName,
    catalogItemId: need.catalogItemId,
    shortage,
    message,
    ...(identityReview ? { identityReview } : {}),
  });
}
function parse(note: string) {
  try {
    const value = JSON.parse(note);
    return value?.type === "ticket_material_need" &&
      value.version === 1 &&
      Number.isSafeInteger(value.round) &&
      typeof value.originalName === "string" &&
      Number.isSafeInteger(value.shortage) &&
      value.shortage >= 0 &&
      typeof value.message === "string"
      ? (value as {
          round: number;
          originalName: string;
          catalogItemId: number | null;
          shortage: number;
          message: string;
        })
      : null;
  } catch {
    return null;
  }
}
/** null preserves old needs that predate individual routing; no backfill is required. */
export function materialSupplyRemaining(
  state: Pick<Snapshot, "actions" | "supplies">,
  need: MaterialNeed
): number | null {
  const actions = state.actions
    .filter(
      a =>
        a.assignmentId === need.assignmentId &&
        (a.kind === "needs_material" || a.kind === "material_resolved")
    )
    .sort((a, b) => b.revision - a.revision);
  for (const action of actions) {
    const route = parse(action.note);
    if (
      !route ||
      route.round !== need.round ||
      route.originalName !== need.originalName ||
      (route.catalogItemId !== null &&
        route.catalogItemId !== need.catalogItemId)
    )
      continue;
    const transferred = state.supplies
      .filter(
        s =>
          s.needId === need.id &&
          s.kind === "transfer" &&
          s.status === "received"
      )
      .reduce((sum, s) => sum + (s.originalEquivalent ?? s.quantity), 0);
    return Math.max(0, route.shortage - transferred);
  }
  return null;
}
export const materialActionMessage = (note: string): string => {
  const route = parse(note);
  if (route) return route.message;
  try {
    const review = JSON.parse(note);
    if (review?.type === "ticket_material_identity_review" && review.version === 1 && typeof review.message === "string") return review.message;
  } catch { /* Ordinary historical notes remain plain text. */ }
  return note;
};

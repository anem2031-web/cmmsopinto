/** Physically received construction stock awaiting inspection (or native return)
 * remains covered by its linked purchase, but is never available for issue. */
export function pendingPurchaseCoverageQuantity(
  linkedQuantity: number,
  orderStatus: string | null | undefined,
  itemStatus: string | null | undefined,
  inventoryReceivedQuantity: number | null | undefined,
  specificationHeldQuantity: number | null | undefined = 0,
): number {
  const linked = Math.max(0, Number(linkedQuantity || 0));
  const held = Math.min(linked, Math.max(0, Number(specificationHeldQuantity || 0)));
  const terminal = ["rejected", "received", "closed"].includes(String(orderStatus || ""))
    || ["rejected", "cancelled", "purchase_cancelled", "delivered_to_requester"].includes(String(itemStatus || ""));
  const unreceived = terminal ? 0 : Math.max(0, linked - Number(inventoryReceivedQuantity || 0));
  return Number(Math.min(linked, unreceived + held).toFixed(3));
}

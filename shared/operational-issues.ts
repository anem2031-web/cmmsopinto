import type { WarehouseLotOption } from "./warehouse-lot-selection";
export type OperationalActor = { id: number; role: string; isActive?: number };
export const OPERATIONAL_CREATE_ROLES = ["maintenance_manager", "general_maintenance_manager", "construction_procurement_manager", "it_manager", "owner", "admin", "warehouse"];
export const OPERATIONAL_WAREHOUSE_ROLES = ["warehouse", "owner", "admin"];
export function canCreateOperationalIssue(role?: string | null) { return OPERATIONAL_CREATE_ROLES.includes(role || ""); }
export function canProcessOperationalIssue(role?: string | null) { return OPERATIONAL_WAREHOUSE_ROLES.includes(role || ""); }
export function canReadOperationalIssue(role?: string | null) { return canCreateOperationalIssue(role) || canProcessOperationalIssue(role) || role === "observer"; }
export type OperationalOrder = {
  id: number; orderNumber: string; createdById: number; creatorName: string; collectorId: number; collectorName: string;
  siteId: number; siteName: string; sectionId: number; sectionName: string; reason: string;
  status: "pending" | "approved" | "completed"; revision: number; createdAt: string;
};
export type OperationalLine = {
  dispatchContext?: unknown;
  id: number; orderId: number; catalogItemId: number; itemName: string; unit: string;
  quantity: number; issuedQuantity: number;
};
export type OperationalDelivery = {
  id: number; orderItemId: number; deliveryDocumentId: number; deliveryNumber: string; quantity: number;
  lotUnitCost: number; cost: number; returnedQuantity: number; lotCode: string; createdAt: string;
};
export type OperationalLotChoice = WarehouseLotOption & {
  replacementName?: string;
  receivedAt?: string;
  inventoryId: number; warehouseId: number; warehouseNameAr: string; warehouseNameEn: string | null;
  lotId: number; lotCode: string; trackingToken: string; quantity: number; unit: string; unitCost: number;
};
export type OperationalPurchaseLink = {
  orderItemId: number; purchaseOrderId: number; purchaseOrderItemId: number; poNumber: string;
  status: string; itemStatus: string; quantity: number; unit: string; changed: boolean;
};
export type OperationalStock = {
  fulfillment?: { remainingOriginalQuantity: number; ready: boolean; allocations: OperationalLotChoice[];
    replacements: Array<{ planId: number; purchaseOrderId: number; itemName: string; quantity: number; unit: string }> };
  itemId: number; totalQuantity: number; unit: string; lots: OperationalLotChoice[];
  needsReview: boolean; purchase: OperationalPurchaseLink | null;
};
export function operationalNetCost(deliveries: OperationalDelivery[]) {
  const cents = (value: number) => Math.round(value * 100);
  let issued = 0, returned = 0;
  for (const row of deliveries) {
    issued += cents(Number(row.cost));
    const quantity = Math.min(Number(row.quantity), Math.max(0, Number(row.returnedQuantity)));
    returned += quantity === Number(row.quantity) ? cents(Number(row.cost)) : cents(quantity * Number(row.lotUnitCost));
  }
  return { issued: issued / 100, returned: returned / 100, net: (issued - returned) / 100 };
}

/** Presentation contract shared by catalog identity matching; no task or ticket service coupling. */
export interface IdentityAvailability {
  catalogItemId: number;
  warehouseId: number;
  inventoryId: number | null;
  availableQuantity: number;
  unit: string | null;
  ambiguous: boolean;
  lotsRequired?: boolean;
}
export interface MaterialIdentityCandidate {
  id: number;
  nameAr: string | null;
  nameEn?: string | null;
  code: string | null;
  unit: string | null;
  teamAvailability: IdentityAvailability;
  mainWarehouseAvailability: IdentityAvailability;
  measurementStatus?: "compatible" | "conflict" | "unknown";
}
export interface TicketIdentityContext {
  assignmentId: number;
  needId: number;
  ticketNumber: string;
  itemTitle: string;
  originalName: string;
  requestedQuantity: number;
  unit: string;
  warehouseId: number;
  /** Present for a linked need whose unit requires warehouse review. */
  catalogItemId?: number;
  catalogUnit?: string;
}

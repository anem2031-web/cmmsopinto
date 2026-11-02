import type {
  Snapshot,
  LocationRef,
} from "../../shared/maintenance-team-tickets/model";
import type { WarehouseLotOption, WarehouseLotSelection } from "../../shared/warehouse-lot-selection";

/** Persistence is injected; the pure domain never imports a database provider. */
export interface Store {
  read(): Promise<Snapshot>;
  /** Must serialize writes and atomically persist the aggregate plus operation record. */
  transaction<T>(
    work: (state: Snapshot, effects: MaterialGateway) => Promise<T>
  ): Promise<T>;
}
export interface PhysicalDelivery {
  deliveryId: number;
  deliveryNumber: string;
  lotId: number;
  inventoryTransactionId: number;
  catalogItemId: number;
  warehouseId: number;
  quantity: number;
  unit: string;
  receivedById: number;
  originalEquivalent?: number;
  replacementName?: string;
  replacementPlanId?: number;
}
export interface SupplyResult {
  sourceId: number;
  sourceNumber: string;
  quantity: number;
  status: "pending" | "received";
  originalEquivalent?: number;
  physicalUnit?: string;
  replacementName?: string;
}
/**
 * Production uses existing inventory writers inside the aggregate transaction.
 * Operation keys recover committed results before any retry. In-memory tests
 * do not establish live database atomicity.
 */
export interface MaterialGateway {
  issueLots?(needId: number, warehouseId: number): Promise<WarehouseLotOption[]>;
  replacementContext?(needId: number): Promise<boolean>;
  issueNeed?(needId: number, input: Parameters<MaterialGateway["issue"]>[0]): Promise<PhysicalDelivery[]>;
  transferNeed?(needId: number, input: Parameters<MaterialGateway["transfer"]>[0]): Promise<SupplyResult[]>;
  sourceInventoryId?(
    warehouseId: number,
    catalogItemId: number
  ): Promise<number>;
  transferForm?(input: {
    fromWarehouseId: number;
    toWarehouseId: number;
    notes?: string;
    items: Array<{
      fromInventoryId: number;
      quantity: number;
      lotTrackingToken?: string;
      notes?: string;
    }>;
  }): Promise<{
    batchNumber: string;
    batchId: number;
    results: any[];
    sources: SupplyResult[];
  }>;
  verifySupply?(
    needId: number,
    kind: "purchase",
    sourceId: number
  ): Promise<SupplyResult>;
  purchaseForm?(handoff: {
    quantity: number;
    technicianQuantity: number;
    ticketPurchaseQuantity: number;
    warehouseExtraQuantity: number;
    purchaseTotalQuantity: number;
    catalogItemId: number;
    unit: string;
    location: LocationRef;
    ticketId: number;
    ticketItemId: number;
  }): Promise<{ id: number; poNumber: string; source: SupplyResult }>;
  mainWarehouseId(): Promise<number>;
  availability(warehouseId: number, catalogItemId: number): Promise<number>;
  issue(input: {
    operationKey: string;
    ticketId: number;
    ticketNumber: string;
    warehouseId: number;
    catalogItemId: number;
    quantity: number;
    unit: string;
    receiverId: number;
    location: LocationRef;
    lotIds?: number[];
    selection?: WarehouseLotSelection;
  }): Promise<PhysicalDelivery[]>;
  transfer(input: {
    operationKey: string;
    destinationWarehouseId: number;
    catalogItemId: number;
    quantity: number;
    unit: string;
    lotIds?: number[];
  }): Promise<SupplyResult | SupplyResult[]>;
  purchase(input: {
    operationKey: string;
    destinationWarehouseId: number;
    catalogItemId: number;
    quantity: number;
    unit: string;
    location: LocationRef;
  }): Promise<SupplyResult>;
  receivePurchase(input: {
    operationKey: string;
    sourceId: number;
  }): Promise<SupplyResult>;
  returnToWarehouse(input: {
    operationKey: string;
    sourceDeliveryId: number;
    quantity: number;
    actorId: number;
  }): Promise<{ returnId: number; returnNumber: string; quantity: number }>;
}

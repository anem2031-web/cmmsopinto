/**
 * PM V2 external adapter contracts.
 *
 * PM V2 owns only its bounded-module data. Existing CMMS master/workflow data
 * is consumed through these contracts so the module does not duplicate or
 * physically FK itself to external ownership boundaries.
 */

export type Pmv2ExternalId = number;

export interface Pmv2UserRef {
  id: Pmv2ExternalId;
  name: string | null;
  role: string;
  isActive: boolean;
}

export interface Pmv2WarehouseRef {
  id: Pmv2ExternalId;
  code: string;
  nameAr: string;
  nameEn: string | null;
  isActive: boolean;
}


export interface Pmv2CatalogItemRef {
  id: Pmv2ExternalId;
  code: string | null;
  nameAr: string;
  nameEn: string;
  unit: string | null;
  isActive: boolean;
  /** Operator-facing taxonomy path from current Catalog Master Data. */
  categoryPathAr: string | null;
  categoryPathEn: string | null;
}

export interface Pmv2InventoryItemRef {
  id: Pmv2ExternalId;
  warehouseId: Pmv2ExternalId | null;
  catalogItemId: Pmv2ExternalId | null;
  quantity: number;
  unit: string | null;
}


export interface Pmv2InventoryLotRef {
  id: Pmv2ExternalId;
  inventoryId: Pmv2ExternalId;
  lotCode: string;
  trackingToken: string;
  quantity: number;
  expiryDate: string | null;
  createdAt: string;
}

export interface Pmv2IssueCostTarget {
  beneficiarySiteId: Pmv2ExternalId;
  beneficiarySectionId: Pmv2ExternalId;
  beneficiaryAssetId?: Pmv2ExternalId | null;
}

export interface Pmv2InventoryIssueResult {
  deliveryNumber: string;
  deliveryDocumentId: Pmv2ExternalId | null;
  inventoryTransactionId: Pmv2ExternalId;
  lotId: Pmv2ExternalId | null;
  lotCode: string | null;
  lotTrackingToken: string | null;
  quantity: number;
  unit: string;
}

export interface Pmv2RecipientReturnResult {
  returnId: Pmv2ExternalId;
  returnNumber: string;
  sourceDeliveryDocumentId?: Pmv2ExternalId;
  lotId: Pmv2ExternalId;
  lotCode: string | null;
  returnedQuantity: number;
}
export interface Pmv2InventoryAvailabilityRef {
  catalogItemId: Pmv2ExternalId;
  warehouseId: Pmv2ExternalId;
  inventoryId: Pmv2ExternalId | null;
  availableQuantity: number;
  unit: string | null;
  lotsRequired: boolean;
  ambiguous: boolean;
}

/**
 * Read-only view of a confirmed Delivery Document created by the current
 * Inventory/Delivery workflow. PM V2 never creates these rows; it only
 * validates and links them after the existing workflow succeeds.
 */
export interface Pmv2DeliveryRef {
  executionSource?: string | null;
  executionId?: number | null;
  executionItemId?: number | null;
  id: Pmv2ExternalId;
  deliveryNumber: string;
  inventoryId: Pmv2ExternalId;
  warehouseId: Pmv2ExternalId | null;
  catalogItemId: Pmv2ExternalId | null;
  inventoryTransactionId: Pmv2ExternalId;
  inventoryLotId: Pmv2ExternalId | null;
  lotCode: string | null;
  purchaseOrderItemId: Pmv2ExternalId | null;
  deliveredToId: Pmv2ExternalId | null;
  quantity: number;
  unit: string | null;
  createdAt: string;
}

export interface Pmv2WarehouseTransferRef {
  id: Pmv2ExternalId;
  transferNumber: string;
  batchId: Pmv2ExternalId | null;
  fromWarehouseId: Pmv2ExternalId;
  toWarehouseId: Pmv2ExternalId;
  fromInventoryId: Pmv2ExternalId;
  catalogItemId: Pmv2ExternalId | null;
  inventoryLotId?: Pmv2ExternalId | null;
  quantity: number;
  unit: string | null;
  createdById: Pmv2ExternalId;
  createdAt: string;
}


export interface Pmv2TicketRef {
  id: Pmv2ExternalId;
  ticketNumber: string;
  status: string;
  maintenancePath: string | null;
}

export interface Pmv2PurchaseOrderRef {
  id: Pmv2ExternalId;
  poNumber: string;
  status: string;
}

export interface Pmv2PurchaseOrderItemRef {
  id: Pmv2ExternalId;
  purchaseOrderId: Pmv2ExternalId;
  catalogItemId: Pmv2ExternalId | null;
  itemName: string;
  quantity: number;
  unit: string | null;
  status: string;
  inventoryReceivedQuantity: number;
}

export type Pmv2MaintenanceTargetRef =
  | { type: "site"; siteId: Pmv2ExternalId }
  | { type: "section"; sectionId: Pmv2ExternalId }
  | { type: "asset"; assetId: Pmv2ExternalId };

export interface Pmv2SiteRef {
  id: Pmv2ExternalId;
  name: string;
  isActive: boolean;
}

export interface Pmv2SectionRef {
  id: Pmv2ExternalId;
  siteId: Pmv2ExternalId;
  name: string;
  isActive: boolean;
}

export interface Pmv2AssetRef {
  id: Pmv2ExternalId;
  siteId: Pmv2ExternalId | null;
  sectionId: Pmv2ExternalId | null;
  name: string;
  status: string;
}

export interface UsersAdapter {
  listActiveUsers(): Promise<Pmv2UserRef[]>;
  getUserById(id: Pmv2ExternalId): Promise<Pmv2UserRef | null>;
  requireActiveUser(id: Pmv2ExternalId): Promise<Pmv2UserRef>;
}

export interface WarehouseAdapter {
  listActiveWarehouses(): Promise<Pmv2WarehouseRef[]>;
  getWarehouseById(id: Pmv2ExternalId): Promise<Pmv2WarehouseRef | null>;
  requireActiveWarehouse(id: Pmv2ExternalId): Promise<Pmv2WarehouseRef>;
  requireSingleActiveMainWarehouse(): Promise<Pmv2WarehouseRef>;
}

export interface MaintenanceTargetAdapter {
  listSites(): Promise<Pmv2SiteRef[]>;
  listSections(siteId?: Pmv2ExternalId): Promise<Pmv2SectionRef[]>;
  listAssets(filters?: {
    siteId?: Pmv2ExternalId;
    sectionId?: Pmv2ExternalId;
  }): Promise<Pmv2AssetRef[]>;
  validateTarget(target: Pmv2MaintenanceTargetRef): Promise<boolean>;
}

export interface CatalogAdapter {
  searchActiveItems(query?: string, limit?: number): Promise<Pmv2CatalogItemRef[]>;
  getItemById(id: Pmv2ExternalId): Promise<Pmv2CatalogItemRef | null>;
  getItemsByIds(ids: Pmv2ExternalId[]): Promise<Pmv2CatalogItemRef[]>;
  requireActiveItem(id: Pmv2ExternalId): Promise<Pmv2CatalogItemRef>;
}

export interface InventoryAdapter {
  /** Read-only Catalog identities that currently have usable stock in a Warehouse. */
  listAvailableCatalogItemIds(
    warehouseId: Pmv2ExternalId,
    limit?: number,
  ): Promise<Pmv2ExternalId[]>;
  getInventoryItemById(
    inventoryId: Pmv2ExternalId,
  ): Promise<Pmv2InventoryItemRef | null>;
  getCatalogAvailability(
    catalogItemId: Pmv2ExternalId,
    warehouseId: Pmv2ExternalId,
  ): Promise<Pmv2InventoryAvailabilityRef>;
  getCatalogAvailabilities(
    catalogItemIds: Pmv2ExternalId[],
    warehouseId: Pmv2ExternalId,
  ): Promise<Pmv2InventoryAvailabilityRef[]>;
  listAvailableLots(inventoryId: Pmv2ExternalId): Promise<Pmv2InventoryLotRef[]>;
}

export interface InventoryIssueAdapter {
  issueDelivery(input: {
    taskItemId?: Pmv2ExternalId;
    inventoryId: Pmv2ExternalId;
    quantity: number;
    unit?: string;
    performedById: Pmv2ExternalId;
    deliveredToId: Pmv2ExternalId;
    lotTrackingToken: string;
    notes?: string;
    costTarget: Pmv2IssueCostTarget;
  }): Promise<Pmv2InventoryIssueResult>;
}

export interface RecipientReturnAdapter {
  createReturn(input: {
    sourceDeliveryDocumentId: Pmv2ExternalId;
    returnedQuantity: number;
    reason: string;
    returnedById: Pmv2ExternalId;
  }): Promise<Pmv2RecipientReturnResult>;
}

export interface DeliveryAdapter {
  getDeliveryByNumber(deliveryNumber: string): Promise<Pmv2DeliveryRef | null>;
}

export interface WarehouseTransferAdapter {
  /**
   * Resolve already-created Warehouse Transfer rows by their authoritative
   * transfer numbers. Missing numbers are intentionally not synthesized.
   */
  getTransfersByNumbers(
    transferNumbers: string[],
  ): Promise<Pmv2WarehouseTransferRef[]>;
}

export interface TicketAdapter {
  getTicketsByIds(ids: Pmv2ExternalId[]): Promise<Pmv2TicketRef[]>;
}

export interface PurchaseAdapter {
  getOrdersByIds(ids: Pmv2ExternalId[]): Promise<Pmv2PurchaseOrderRef[]>;
  getItemsByIds(ids: Pmv2ExternalId[]): Promise<Pmv2PurchaseOrderItemRef[]>;
  getOrderWithItems(purchaseOrderId: Pmv2ExternalId): Promise<{
    order: Pmv2PurchaseOrderRef;
    items: Pmv2PurchaseOrderItemRef[];
  } | null>;
}


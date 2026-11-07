export const WAREHOUSE_DOCUMENT_SOURCES = ["pmv2", "tickets", "operational"] as const;
export type WarehouseDocumentSource = typeof WAREHOUSE_DOCUMENT_SOURCES[number];
export type WarehouseRequestDocumentKind = "delivery" | "warehouse_issue" | "return";
export type WarehouseRequestDocumentRow = {
  id: number; kind: WarehouseRequestDocumentKind; number: string; createdAt: string;
  itemName: string; quantity: number | string | null; unit: string | null; itemCount: number;
  recipientName: string; issuerName: string; warehouseName: string; lotCode: string;
  referenceNumber: string; referenceTitle: string; source: WarehouseDocumentSource;
  mixedSources?: number | boolean;
};
export function canReadWarehouseRequestDocuments(actor: { id: number; role: string; isActive?: number } | null | undefined) {
  return !!actor && Number.isSafeInteger(actor.id) && actor.id > 0 && actor.isActive === 1
    && ["warehouse", "owner", "admin"].includes(actor.role);
}

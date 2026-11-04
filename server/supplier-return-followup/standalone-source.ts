import { sql } from "drizzle-orm";
import type { FollowupTx } from "./commands";
import { ReturnFollowupError } from "./policy";
import { readRows } from "./runtime";

const nullableId = (value: unknown) => value == null ? null : Number(value);
const positiveId = (value: unknown) => Number.isSafeInteger(Number(value)) && Number(value) > 0;
const conflict = (): never => { throw new ReturnFollowupError("CONFLICT", "مصدر الاستلام المستقل أو مسؤول المرتجع غير متطابق"); };

/** No historical PO is invented. The existing return/receipt/lot identifies the
 * standalone source; its warehouse creator is the responsible requester. */
export async function verifyStandaloneReturnSource(tx: FollowupTx, record: any) {
  if (record.purchaseOrderId != null || record.purchaseOrderItemId != null || !positiveId(record.createdById)) conflict();
  const [source] = await readRows(tx, sql`SELECT r.id,r.inventoryId,r.purchaseOrderId,r.purchaseOrderItemId,
      r.receiptId,r.lotId,r.sourceDeliveryDocumentId,r.returnedQuantity,
      l.receiptId AS lotReceiptId,l.receiptItemId,l.purchaseOrderId AS lotOrderId,l.purchaseOrderItemId AS lotOrderItemId,
      l.sourceType,l.catalogItemId,l.issueUnit,
      ri.receiptId AS lineReceiptId,ri.purchaseOrderItemId AS lineOrderItemId,ri.catalogItemId AS lineCatalogItemId,
      receipt.purchaseOrderId AS receiptOrderId,receipt.status AS receiptStatus,
      v.linkedItemId AS inventoryCatalogItemId,v.warehouseId
    FROM warehouse_returns r INNER JOIN inventory_lots l ON l.id=r.lotId
    INNER JOIN warehouse_receipt_items ri ON ri.id=l.receiptItemId AND ri.receiptId=l.receiptId
    INNER JOIN warehouse_receipts receipt ON receipt.id=ri.receiptId
    INNER JOIN inventory v ON v.id=r.inventoryId
    INNER JOIN inventory_lot_balances balance ON balance.lotId=l.id AND balance.inventoryId=v.id
    WHERE r.id=${Number(record.returnId)} FOR UPDATE`);
  if (!source || source.sourceType !== "receipt" || source.receiptStatus !== "confirmed"
    || source.sourceDeliveryDocumentId != null || source.purchaseOrderId != null || source.purchaseOrderItemId != null
    || source.lotOrderId != null || source.lotOrderItemId != null || source.lineOrderItemId != null || source.receiptOrderId != null
    || Number(source.inventoryId) !== Number(record.inventoryId) || Number(source.lotId) !== Number(record.lotId)
    || Number(source.receiptId) !== Number(record.receiptId) || Number(source.lotReceiptId) !== Number(record.receiptId)
    || Number(source.lineReceiptId) !== Number(record.receiptId) || Number(source.receiptItemId) !== Number(record.receiptItemId)
    || !(Number(source.returnedQuantity) > 0) || Number(source.returnedQuantity) !== Number(record.returnedQuantity)
    || new Set([source.catalogItemId, source.lineCatalogItemId, source.inventoryCatalogItemId].filter(value => value != null).map(Number)).size > 1
    || !String(source.issueUnit || "").trim() || String(source.issueUnit).trim() !== String(record.returnedUnit || "").trim()) conflict();
  const creatorId = Number(record.creatorId ?? record.createdById);
  if (!positiveId(creatorId) || creatorId !== Number(record.createdById)) conflict();
  return { creatorId, receiptId: Number(source.receiptId), receiptItemId: Number(source.receiptItemId),
    lotId: Number(source.lotId), warehouseId: Number(source.warehouseId),
    originalCatalogItemId: nullableId(source.catalogItemId ?? source.lineCatalogItemId ?? source.inventoryCatalogItemId) };
}

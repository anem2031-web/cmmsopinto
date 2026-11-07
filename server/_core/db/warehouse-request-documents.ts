import { sql } from "drizzle-orm";
import { getDb } from "./client";
import { getDeliveryDocumentById, incrementDeliveryDocPrintCount, incrementReturnDocPrintCount } from "./warehouse-returns";
import { getWarehouseIssueBatchById, incrementWarehouseIssueBatchPrintCount } from "./warehouse-issues";
import { getWarehouseSignatureForPrint } from "../../services/pdf/warehouseSignature";
import { createWarehouseRequestDocumentService } from "../../services/warehouse-request-documents";

export const warehouseRequestDocumentService = createWarehouseRequestDocumentService({
  database: getDb,
  async readDocument(kind, id) {
    if (kind === "delivery") {
      const row = await getDeliveryDocumentById(id);
      if (!row) return null;
      const { deliveredBySignatureSnapshot, ...document } = row;
      const db = await getDb();
      if (!db) throw new Error("قاعدة البيانات غير متاحة");
      const result = await db.execute(sql`SELECT COALESCE(SUM(returnedQuantity),0) AS returnedQuantity FROM warehouse_returns WHERE sourceDeliveryDocumentId=${id}`);
      return { ...document, returnedQuantity: (result[0] as unknown as any[])[0]?.returnedQuantity ?? 0,
        deliveredBySignature: await getWarehouseSignatureForPrint(deliveredBySignatureSnapshot) };
    }
    if (kind === "warehouse_issue") {
      const row = await getWarehouseIssueBatchById(id);
      if (!row) return null;
      const { issuedBySignatureSnapshot, ...document } = row as any;
      return { ...document, issuedBySignature: await getWarehouseSignatureForPrint(issuedBySignatureSnapshot, row.issuedById) };
    }
    const db = await getDb();
    if (!db) throw new Error("قاعدة البيانات غير متاحة");
    const result = await db.execute(sql`SELECT r.*,l.lotCode,d.deliveryNumber AS sourceDeliveryNumber
      FROM return_documents r INNER JOIN warehouse_returns wr ON wr.id=r.returnId
      INNER JOIN delivery_documents d ON d.id=wr.sourceDeliveryDocumentId
      LEFT JOIN inventory_lots l ON l.id=wr.lotId WHERE r.id=${id}`);
    return (result[0] as unknown as any[])[0] ?? null;
  },
  async incrementPrint(kind, id) {
    if (kind === "delivery") return incrementDeliveryDocPrintCount(id);
    if (kind === "warehouse_issue") return incrementWarehouseIssueBatchPrintCount(id);
    return incrementReturnDocPrintCount(id);
  },
});

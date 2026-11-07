import { sql, type SQL } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { canReadWarehouseRequestDocuments, type WarehouseDocumentSource, type WarehouseRequestDocumentKind, type WarehouseRequestDocumentRow } from "../../shared/warehouse-request-documents";

type Actor = { id: number; role: string; isActive?: number };
type Database = { execute(query: SQL): Promise<any> };
type Selection = { source: WarehouseDocumentSource; id: number; kind: WarehouseRequestDocumentKind };
export type WarehouseDocumentPageInput = { source: WarehouseDocumentSource; search: string; sort: "newest" | "oldest"; page: number; pageSize: number };
const rows = async (db: Database, query: SQL): Promise<any[]> => (await db.execute(query))[0];
const denied = () => new TRPCError({ code: "FORBIDDEN", message: "مستندات طلبات المستودع للمستودع والمالك والأدمن فقط" });

/** Each branch joins the real parent. A document number/name is never provenance.
 * PMV2's issue action is required before consumption, so usage rows alone are insufficient.
 * UNION removes duplicate issue/usage/context links before document pagination.
 */
export function warehouseDocumentLinks(source: WarehouseDocumentSource): SQL {
  if (source === "operational") return sql`
    SELECT x.deliveryDocumentId AS deliveryId,o.orderNumber AS referenceNumber,o.reason AS referenceTitle
    FROM operational_issue_deliveries x
    INNER JOIN operational_issue_items i ON i.id=x.orderItemId
    INNER JOIN operational_issue_orders o ON o.id=i.orderId`;
  if (source === "tickets") return sql`
    SELECT d.id AS deliveryId,t.ticketNumber AS referenceNumber,t.title AS referenceTitle
    FROM delivery_documents d INNER JOIN tickets t ON t.id=d.ticketId
    UNION
    SELECT x.deliveryDocumentId,t.ticketNumber,t.title
    FROM ticket_team_delivery_links x
    INNER JOIN ticket_team_material_needs n ON n.id=x.needId
    INNER JOIN ticket_team_assignments a ON a.id=n.assignmentId
    INNER JOIN tickets t ON t.id=a.ticketId`;
  return sql`
    SELECT d.id AS deliveryId,t.taskNumber AS referenceNumber,i.titleSnapshot AS referenceTitle
    FROM material_execution_cost_contexts c
    INNER JOIN delivery_documents d ON d.inventoryTransactionId=c.inventoryTransactionId
    INNER JOIN pmv2_task_items i ON i.id=c.executionItemId AND i.taskId=c.executionId
    INNER JOIN pmv2_tasks t ON t.id=i.taskId WHERE c.executionSource='pmv2'
    UNION
    SELECT CAST(JSON_UNQUOTE(JSON_EXTRACT(CASE WHEN JSON_VALID(a.note) THEN a.note ELSE '{}' END,'$.deliveryDocumentId')) AS UNSIGNED),t.taskNumber,i.titleSnapshot
    FROM pmv2_item_actions a
    INNER JOIN pmv2_task_items i ON i.id=a.taskItemId
    INNER JOIN pmv2_tasks t ON t.id=i.taskId
    WHERE a.action IN ('material_issue_linked','material_issue_link_pending')
    UNION
    SELECT u.deliveryDocumentId,t.taskNumber,i.titleSnapshot
    FROM pmv2_material_usages u
    INNER JOIN pmv2_task_items i ON i.id=u.taskItemId
    INNER JOIN pmv2_tasks t ON t.id=i.taskId
    UNION
    SELECT bi.deliveryDocumentId,t.taskNumber,i.titleSnapshot
    FROM warehouse_issue_batch_items bi
    INNER JOIN pmv2_material_request_items ri ON ri.id=bi.referenceId
    INNER JOIN pmv2_material_requests r ON r.id=ri.requestId
    INNER JOIN pmv2_task_items i ON i.id=r.taskItemId
    INNER JOIN pmv2_tasks t ON t.id=i.taskId
    INNER JOIN delivery_documents d ON d.id=bi.deliveryDocumentId AND d.inventoryTransactionId=bi.inventoryTransactionId
    WHERE bi.referenceType='pmv2'`;
}

/** All filtering/counting/pagination is SQL-side. No per-row resource loader and no cache. */
export function warehouseDocumentQuery(source: WarehouseDocumentSource): SQL {
  return sql`WITH links AS (${warehouseDocumentLinks(source)}),
    refs AS (SELECT deliveryId,GROUP_CONCAT(DISTINCT referenceNumber) AS referenceNumber,
      GROUP_CONCAT(DISTINCT referenceTitle) AS referenceTitle FROM links GROUP BY deliveryId),
    deliveries AS (
      SELECT d.*,r.referenceNumber,r.referenceTitle,w.nameAr AS warehouseName,l.lotCode
      FROM delivery_documents d INNER JOIN refs r ON r.deliveryId=d.id
      LEFT JOIN inventory i ON i.id=d.inventoryId LEFT JOIN warehouses w ON w.id=i.warehouseId
      LEFT JOIN inventory_lots l ON l.id=d.lotId
    ), documents AS (
      SELECT d.id,'delivery' AS kind,d.deliveryNumber AS number,d.createdAt,d.itemName,d.quantity,d.unit,1 AS itemCount,
        d.deliveredToName AS recipientName,d.deliveredByName AS issuerName,d.warehouseName,d.lotCode,d.referenceNumber,d.referenceTitle,0 AS mixedSources
      FROM deliveries d
      UNION ALL
      SELECT r.id,'return',r.returnNumber,r.createdAt,r.itemName,r.returnedQuantity,r.unit,1,
        r.recipientName,r.returnedByName,d.warehouseName,d.lotCode,d.referenceNumber,d.referenceTitle,0
      FROM return_documents r INNER JOIN warehouse_returns wr ON wr.id=r.returnId
      INNER JOIN deliveries d ON d.id=wr.sourceDeliveryDocumentId
      UNION ALL
      SELECT b.id,'warehouse_issue',b.issueNumber,b.createdAt,
        (SELECT bi.itemName FROM warehouse_issue_batch_items bi WHERE bi.batchId=b.id ORDER BY bi.id LIMIT 1),
        NULL,NULL,b.itemsCount,b.deliveredToName,b.issuedByName,b.warehouseName,NULL,
        (SELECT GROUP_CONCAT(DISTINCT d.referenceNumber) FROM warehouse_issue_batch_items bi INNER JOIN deliveries d ON d.id=bi.deliveryDocumentId WHERE bi.batchId=b.id),
        (SELECT GROUP_CONCAT(DISTINCT d.referenceTitle) FROM warehouse_issue_batch_items bi INNER JOIN deliveries d ON d.id=bi.deliveryDocumentId WHERE bi.batchId=b.id),
        (SELECT COUNT(DISTINCT COALESCE(NULLIF(bi.referenceType,''),'unknown'))>1 FROM warehouse_issue_batch_items bi WHERE bi.batchId=b.id)
      FROM warehouse_issue_batches b
      WHERE EXISTS (SELECT 1 FROM warehouse_issue_batch_items bi INNER JOIN deliveries d ON d.id=bi.deliveryDocumentId WHERE bi.batchId=b.id)
        AND NOT EXISTS (SELECT 1 FROM warehouse_issue_batch_items bi LEFT JOIN delivery_documents d ON d.id=bi.deliveryDocumentId WHERE bi.batchId=b.id AND d.id IS NULL)
    )`;
}

export function createWarehouseRequestDocumentService(deps: {
  database(): Promise<Database | null>;
  readDocument(kind: WarehouseRequestDocumentKind, id: number): Promise<any>;
  incrementPrint(kind: WarehouseRequestDocumentKind, id: number): Promise<unknown>;
}) {
  async function current(actor: Actor) {
    if (!canReadWarehouseRequestDocuments(actor)) throw denied();
    const db = await deps.database();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "تعذر الاتصال بقاعدة البيانات" });
    const [fresh] = await rows(db, sql`SELECT id,role,isActive FROM users WHERE id=${actor.id}`);
    if (!canReadWarehouseRequestDocuments(fresh) || fresh.role !== actor.role) throw denied();
    return db;
  }
  async function authorized(db: Database, input: Selection) {
    const [row] = await rows(db, sql`${warehouseDocumentQuery(input.source)} SELECT * FROM documents WHERE id=${input.id} AND kind=${input.kind}`);
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "السند غير موجود ضمن هذا المصدر أو فُقد ارتباطه بالعملية" });
    return { ...row, source: input.source } as WarehouseRequestDocumentRow;
  }
  return {
    async page(actor: Actor, input: WarehouseDocumentPageInput) {
      const db = await current(actor);
      const needle = input.search.trim().toLowerCase().replace(/[٠-٩]/g, x => String(x.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, x => String(x.charCodeAt(0) - 0x06f0));
      const predicate = needle ? sql`(LOCATE(${needle},LOWER(CONCAT_WS(' ',number,itemName,recipientName,issuerName,warehouseName,lotCode,referenceNumber,referenceTitle)))>0
        OR (kind='warehouse_issue' AND EXISTS (SELECT 1 FROM warehouse_issue_batch_items bi
          LEFT JOIN refs r ON r.deliveryId=bi.deliveryDocumentId WHERE bi.batchId=documents.id
          AND LOCATE(${needle},LOWER(CONCAT_WS(' ',bi.itemName,bi.deliveryNumber,bi.lotCode,bi.referenceNumber,r.referenceNumber,r.referenceTitle)))>0)))` : sql`1=1`;
      const prefix = warehouseDocumentQuery(input.source);
      const [count] = await rows(db, sql`${prefix} SELECT COUNT(*) AS total FROM documents WHERE ${predicate}`);
      const total = Number(count.total), pageSize = Math.min(50, Math.max(1, input.pageSize));
      const page = Math.min(Math.max(1, input.page), Math.max(1, Math.ceil(total / pageSize)));
      const direction = input.sort === "oldest" ? sql`ASC` : sql`DESC`;
      const data = await rows(db, sql`${prefix} SELECT * FROM documents WHERE ${predicate} ORDER BY createdAt ${direction},kind ASC,id ${direction} LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`);
      return { rows: data.map(row => ({ ...row, source: input.source })) as WarehouseRequestDocumentRow[], total, page, pageSize };
    },
    async detail(actor: Actor, input: Selection) {
      const db = await current(actor), row = await authorized(db, input);
      const document = await deps.readDocument(input.kind, input.id);
      if (!document) throw new TRPCError({ code: "NOT_FOUND", message: "السند غير موجود" });
      return { row, document };
    },
    async recordPrint(actor: Actor, input: Selection) {
      await authorized(await current(actor), input);
      await deps.incrementPrint(input.kind, input.id);
      return { success: true };
    },
  };
}

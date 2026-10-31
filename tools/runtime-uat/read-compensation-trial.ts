import "dotenv/config";
import { sql } from "drizzle-orm";
import { getDb } from "../../server/_core/db/client";
process.on("uncaughtException", error => { console.error(error); process.exit(1); });
const db = await getDb();
if (!db) throw Error("Trial unavailable");
async function read(query: any) { const [rows] = await db!.execute(query); return rows as any[]; }
const [current] = await read(sql`SELECT DATABASE() AS databaseName`);
if (String(current.databaseName).toLowerCase() !== "copycmms2") throw Error("Trial only");
const operational = await read(sql`SELECT o.id,o.orderNumber,o.status,o.revision,i.itemName,i.quantity AS requested,x.quantity AS delivered,d.deliveryNumber,d.deliveredToName,d.lotId,l.lotCode,x.lotUnitCost,x.cost
  FROM operational_issue_orders o INNER JOIN operational_issue_items i ON i.orderId=o.id
  LEFT JOIN operational_issue_deliveries x ON x.orderItemId=i.id LEFT JOIN delivery_documents d ON d.id=x.deliveryDocumentId
  LEFT JOIN inventory_lots l ON l.id=d.lotId WHERE o.orderNumber='OPR-2026-000003' ORDER BY i.id,x.id`);
const plans = await read(sql`SELECT c.id,c.returnId,r.returnNumber,c.purchaseOrderId,c.purchaseOrderItemId,p.id AS planId,p.status,p.purchaseOrderId AS replacementOrderId,o.poNumber,original.ticketId,original.ticketItemId
  FROM supplier_return_cases c INNER JOIN warehouse_returns r ON r.id=c.returnId LEFT JOIN supplier_return_replacement_plans p ON p.caseId=c.id
  LEFT JOIN purchase_orders o ON o.id=p.purchaseOrderId LEFT JOIN purchase_orders original ON original.id=c.purchaseOrderId ORDER BY c.id DESC LIMIT 8`);
const ticket = await read(sql`SELECT id,ticketNumber,title,status,maintenancePath,assignedTechnicianId FROM tickets WHERE id=2010107`);
const replacement = await read(sql`SELECT i.id,i.purchaseOrderId,i.catalogItemId,i.itemName,i.quantity,i.unit,i.status,d.deliveryNumber,d.quantity AS delivered,d.deliveredToName,l.lotCode,l.trackingToken,l.originalQuantity,l.remainingQuantity
  FROM purchase_order_items i LEFT JOIN delivery_documents d ON d.poItemId=i.id LEFT JOIN inventory_lots l ON l.purchaseOrderItemId=i.id
  WHERE i.purchaseOrderId=3810003`);
const sourceLots = await read(sql`SELECT 'team' AS source,k.needId AS needId,l.id AS lotId,l.lotCode,l.trackingToken,l.remainingQuantity,p.poNumber,p.id AS purchaseOrderId,i.id AS purchaseOrderItemId,i.catalogItemId
  FROM ticket_team_supply_links k INNER JOIN purchase_order_items i ON i.id=k.sourceId AND k.sourceKind='purchase'
  INNER JOIN purchase_orders p ON p.id=i.purchaseOrderId INNER JOIN inventory_lots l ON l.purchaseOrderItemId=i.id
  WHERE l.remainingQuantity>0
  UNION ALL SELECT 'pmv2',k.materialRequestItemId,l.id,l.lotCode,l.trackingToken,l.remainingQuantity,p.poNumber,p.id,i.id,i.catalogItemId
  FROM pmv2_material_purchase_links k INNER JOIN purchase_order_items i ON i.id=k.purchaseOrderItemId AND i.purchaseOrderId=k.purchaseOrderId
  INNER JOIN purchase_orders p ON p.id=i.purchaseOrderId INNER JOIN inventory_lots l ON l.purchaseOrderItemId=i.id WHERE l.remainingQuantity>0 LIMIT 12`);
const zeroStock = await read(sql`SELECT c.id,c.nameAr,c.unit FROM catalog_items c WHERE c.isActive=1 AND c.unit='قطعة'
  AND NOT EXISTS(SELECT 1 FROM inventory i WHERE i.linkedItemId=c.id) ORDER BY c.id LIMIT 6`);
console.log(JSON.stringify({operational,plans,ticket,replacement,sourceLots,zeroStock},null,2));
process.exit(0);

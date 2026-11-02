import { sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { DEFAULT_PURCHASE_DELIVERY_DAYS } from "../../../shared/purchaseItemNeedDate";
import type { OperationalActor, OperationalLine, OperationalOrder, OperationalPurchaseLink, OperationalStock } from "../../../shared/operational-issues";
import { executionRows as rows } from "./issue-reference";
import { dispatchContext } from "../../../shared/operational-dispatch";

export interface OperationalPurchasePorts {
  nextNumber(): Promise<string>;
  create(tx: any, header: any): Promise<number | null>;
  createItems(tx: any, items: any[]): Promise<void>;
  validateUnit(unit: string): Promise<void>;
}

/** Additive rollout: stock/issue still works before the owner installs the link table. */
export async function operationalPurchaseReady(tx: any): Promise<boolean> {
  const found = await rows(tx, sql`SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='operational_issue_purchase_links'`);
  return found.length === 1;
}

export async function operationalPurchaseLinks(tx: any, orderId: number, contexts: OperationalLine[] = []): Promise<OperationalPurchaseLink[]> {
  const links = await rows(tx, sql`SELECT k.orderItemId,k.purchaseOrderId,k.purchaseOrderItemId,k.quantity AS linkedQuantity,k.unit AS linkedUnit,
    p.poNumber,p.status,p.siteId,p.sectionId,p.ticketId,j.status AS itemStatus,j.catalogItemId,j.quantity,j.unit,
    i.catalogItemId AS expectedCatalogItemId,o.siteId AS expectedSiteId,o.sectionId AS expectedSectionId
    FROM operational_issue_purchase_links k INNER JOIN operational_issue_items i ON i.id=k.orderItemId
    INNER JOIN operational_issue_orders o ON o.id=i.orderId
    INNER JOIN purchase_orders p ON p.id=k.purchaseOrderId
    INNER JOIN purchase_order_items j ON j.id=k.purchaseOrderItemId AND j.purchaseOrderId=p.id
    WHERE i.orderId=${orderId} AND p.status<>'rejected' AND j.status NOT IN ('cancelled','rejected','purchase_cancelled')`);
  for (const row of links) {
    const context = dispatchContext(contexts.find(line => Number(line.id) === Number(row.orderItemId))?.dispatchContext);
    if (context) { row.expectedSiteId = context.siteId; row.expectedSectionId = context.sectionId; }
  }
  return links.map(row => ({
    orderItemId: Number(row.orderItemId), purchaseOrderId: Number(row.purchaseOrderId), purchaseOrderItemId: Number(row.purchaseOrderItemId),
    poNumber: String(row.poNumber), status: String(row.status), itemStatus: String(row.itemStatus),
    quantity: Number(row.quantity), unit: String(row.unit || ""),
    changed: Number(row.catalogItemId) !== Number(row.expectedCatalogItemId) || Number(row.quantity) !== Number(row.linkedQuantity)
      || String(row.unit || "").trim() !== String(row.linkedUnit).trim() || Boolean(row.ticketId)
      || Number(row.siteId) !== Number(row.expectedSiteId) || Number(row.sectionId) !== Number(row.expectedSectionId),
  }));
}

/** Aggregate stock and physical lots separately, so joining lots never multiplies inventory totals. */
export async function loadOperationalStock(tx: any, lines: OperationalLine[], lock = false, warehouseId?: number): Promise<OperationalStock[]> {
  if (!lines.length) return [];
  const catalogIds = sql.join(lines.map(line => sql`${Number(line.catalogItemId)}`), sql`, `);
  const inventories = await rows(tx, sql`SELECT i.id,i.linkedItemId,i.quantity,COALESCE(NULLIF(i.issueUnit,''),i.unit) AS unit,
    w.id AS warehouseId,w.nameAr AS warehouseNameAr,w.nameEn AS warehouseNameEn
    FROM inventory i INNER JOIN warehouses w ON (w.id=i.warehouseId OR (i.warehouseId IS NULL AND w.id=(SELECT MIN(m.id) FROM warehouses m WHERE m.type='main' AND m.isActive=1)))
    WHERE i.linkedItemId IN (${catalogIds}) AND i.isFrozen=0 AND w.isActive=1 ${warehouseId ? sql`AND w.id=${warehouseId}` : sql``} ORDER BY i.id ${lock ? sql`FOR UPDATE` : sql``}`);
  const lots = await rows(tx, sql`SELECT b.inventoryId,b.quantity,l.id AS lotId,l.catalogItemId,l.lotCode,l.trackingToken,
    l.issueUnit,l.issueUnitCost,l.remainingQuantity,l.createdAt AS receivedAt
    FROM inventory_lot_balances b INNER JOIN inventory_lots l ON l.id=b.lotId
    INNER JOIN inventory i ON i.id=b.inventoryId WHERE i.linkedItemId IN (${catalogIds}) AND b.quantity>0 ORDER BY l.createdAt,l.id,b.inventoryId`);
  return lines.map(line => {
    const itemInventories = inventories.filter(i => Number(i.linkedItemId) === Number(line.catalogItemId));
    const stock = itemInventories.filter(i => Number(i.quantity) > 0);
    let needsReview = itemInventories.some(i => !Number.isFinite(Number(i.quantity)) || Number(i.quantity) < 0
      || (Number(i.quantity) > 0 && String(i.unit || "").trim() !== line.unit.trim())
      || (Number(i.quantity) <= 0 && lots.some(lot => Number(lot.inventoryId) === Number(i.id))));
    const choices: OperationalStock["lots"] = [];
    for (const inventory of stock) {
      const balances = lots.filter(lot => Number(lot.inventoryId) === Number(inventory.id));
      let covered = 0;
      for (const lot of balances) {
        const valid = Number(lot.catalogItemId) === Number(line.catalogItemId)
          && String(lot.issueUnit || inventory.unit || "").trim() === line.unit.trim()
          && String(inventory.unit || "").trim() === line.unit.trim()
          && lot.issueUnitCost != null && lot.issueUnitCost !== "" && Number.isFinite(Number(lot.issueUnitCost)) && Number(lot.issueUnitCost) >= 0 && Boolean(lot.trackingToken)
          && Number(lot.remainingQuantity) >= Number(lot.quantity);
        covered += Number(lot.quantity);
        if (!valid) { needsReview = true; continue; }
        choices.push({ inventoryId: Number(inventory.id), warehouseId: Number(inventory.warehouseId),
          warehouseNameAr: String(inventory.warehouseNameAr), warehouseNameEn: inventory.warehouseNameEn || null,
          lotId: Number(lot.lotId), lotCode: String(lot.lotCode), trackingToken: String(lot.trackingToken),
          quantity: Number(lot.quantity), unit: line.unit, unitCost: Number(lot.issueUnitCost), receivedAt: lot.receivedAt instanceof Date ? lot.receivedAt.toISOString() : String(lot.receivedAt || "") });
      }
      if (Math.abs(covered - Number(inventory.quantity)) > 0.0005) needsReview = true;
    }
    // Ambiguous legacy rows can resolve the same token twice in one warehouse; do not offer them as issuable.
    const identities = new Map<string, number>();
    for (const choice of choices) {
      const key = `${choice.warehouseId}:${choice.trackingToken}`;
      identities.set(key, (identities.get(key) || 0) + 1);
    }
    if (choices.some(choice => identities.get(`${choice.warehouseId}:${choice.trackingToken}`)! > 1)) needsReview = true;
    return { itemId: Number(line.id), unit: line.unit,
      totalQuantity: Number(stock.filter(i => String(i.unit || "").trim() === line.unit.trim()).reduce((sum, i) => sum + Number(i.quantity), 0).toFixed(3)),
      lots: choices.filter(choice => identities.get(`${choice.warehouseId}:${choice.trackingToken}`) === 1), needsReview, purchase: null };
  });
}

/** Caller holds the order lock. Header, line and source link share this transaction. */
export async function addOperationalPurchaseDraft(tx: any, ports: OperationalPurchasePorts, actor: OperationalActor, order: OperationalOrder, itemId: number) {
  if (!await operationalPurchaseReady(tx)) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "يلزم إنشاء جدول ربط الصرف التشغيلي بالشراء يدويًا أولًا" });
  const [line] = await rows(tx, sql`SELECT i.*,COALESCE((SELECT SUM(d.quantity) FROM operational_issue_deliveries d WHERE d.orderItemId=i.id),0) AS issuedQuantity
    FROM operational_issue_items i WHERE i.id=${itemId} AND i.orderId=${order.id} FOR UPDATE`) as OperationalLine[];
  if (!line) throw new TRPCError({ code: "BAD_REQUEST", message: "الصنف لا ينتمي إلى أمر الصرف" });
  const context = dispatchContext(line.dispatchContext);
  const contexts = context ? await rows(tx, sql`SELECT * FROM operational_issue_items WHERE orderId=${order.id} ORDER BY id`) as OperationalLine[] : [];
  const links = await operationalPurchaseLinks(tx, order.id, contexts);
  if (context) order = { ...order, siteId: context.siteId, sectionId: context.sectionId, collectorId: context.collectorId };
  const existing = links.find(link => link.orderItemId === itemId);
  // Repeated clicks return the same live document, even after submission or arrival of stock.
  if (existing) return { ...existing, existing: true };
  const remaining = Number(line.quantity) - Number(line.issuedQuantity);
  if (order.status !== "approved" || remaining <= 0 || !Number.isInteger(remaining)) throw new TRPCError({ code: "CONFLICT", message: "يلزم أمر معتمد وكمية متبقية صحيحة" });
  const [stock] = await loadOperationalStock(tx, [line], true, context?.warehouseId);
  const shortage = Math.max(0, remaining - Math.floor(stock.totalQuantity));
  if (shortage <= 0 || stock.needsReview) throw new TRPCError({ code: "CONFLICT", message: "لا يوجد عجز غير مغطى أو أن الأرصدة تحتاج مراجعة" });
  const [catalog] = await rows(tx, sql`SELECT id,nameAr,nameEn,unit FROM catalog_items WHERE id=${Number(line.catalogItemId)} AND isActive=1`);
  if (!catalog) throw new TRPCError({ code: "BAD_REQUEST", message: "صنف الكتالوج غير نشط أو غير موجود" });
  const [section] = await rows(tx, sql`SELECT s.id FROM sections s INNER JOIN sites t ON t.id=s.siteId WHERE s.id=${Number(order.sectionId)} AND t.id=${Number(order.siteId)}`);
  if (!section) throw new TRPCError({ code: "BAD_REQUEST", message: "تحقق من موقع وقسم أمر الصرف قبل إنشاء الشراء" });
  await ports.validateUnit(line.unit);
  const candidateIds = Array.from(new Set(links.filter(link => link.status === "draft" && !link.changed).map(link => link.purchaseOrderId)));
  let purchaseOrderId: number | null = null, poNumber = "";
  for (const candidateId of candidateIds) {
    const [candidate] = await rows(tx, sql`SELECT p.id,p.poNumber FROM purchase_orders p WHERE p.id=${candidateId} AND p.status='draft'
      AND p.requestedById=${actor.id} AND p.siteId=${Number(order.siteId)} AND p.sectionId=${Number(order.sectionId)} AND p.ticketId IS NULL FOR UPDATE`);
    if (!candidate) continue;
    const [count] = await rows(tx, sql`SELECT COUNT(*) AS count FROM purchase_order_items WHERE purchaseOrderId=${candidateId}`);
    if (Number(count.count) >= 20) continue;
    purchaseOrderId = Number(candidate.id); poNumber = String(candidate.poNumber); break;
  }
  const reference = `مرجع الصرف التشغيلي: ${order.orderNumber} — بند #${line.id}`;
  if (!purchaseOrderId) {
    poNumber = await ports.nextNumber();
    purchaseOrderId = await ports.create(tx, { poNumber, requestedById: actor.id, status: "draft", siteId: Number(order.siteId),
      sectionId: Number(order.sectionId), assetId: null, categoryId: null, notes: `مرجع الصرف التشغيلي: ${order.orderNumber}\n${order.reason}` });
    if (!purchaseOrderId) throw new Error("تعذر حفظ مسودة الشراء");
  }
  await ports.createItems(tx, [{ purchaseOrderId, catalogItemId: Number(line.catalogItemId), itemName: catalog.nameAr || catalog.nameEn || line.itemName,
    quantity: shortage, unit: line.unit, status: "pending", deliveryLeadDays: DEFAULT_PURCHASE_DELIVERY_DAYS, requiredDate: null, notes: reference }]);
  const [poItem] = await rows(tx, sql`SELECT id FROM purchase_order_items WHERE purchaseOrderId=${purchaseOrderId} AND catalogItemId=${Number(line.catalogItemId)} ORDER BY id DESC LIMIT 1`);
  if (!poItem) throw new Error("تعذر ربط صنف مسودة الشراء");
  await tx.execute(sql`INSERT INTO operational_issue_purchase_links (orderItemId,purchaseOrderId,purchaseOrderItemId,quantity,unit,createdById)
    VALUES (${itemId},${purchaseOrderId},${Number(poItem.id)},${shortage},${line.unit},${actor.id})
    ON DUPLICATE KEY UPDATE purchaseOrderId=VALUES(purchaseOrderId),purchaseOrderItemId=VALUES(purchaseOrderItemId),quantity=VALUES(quantity),unit=VALUES(unit),createdById=VALUES(createdById)`);
  await tx.execute(sql`INSERT INTO audit_logs (userId,action,entityType,entityId,newValues) VALUES
    (${actor.id},'operational_issue_purchase_draft','operational_issue',${order.id},${JSON.stringify({ itemId, purchaseOrderId, purchaseOrderItemId: Number(poItem.id), quantity: shortage, unit: line.unit })})`);
  return { orderItemId: itemId, purchaseOrderId, purchaseOrderItemId: Number(poItem.id), poNumber, quantity: shortage, unit: line.unit, status: "draft", itemStatus: "pending", changed: false, existing: false };
}

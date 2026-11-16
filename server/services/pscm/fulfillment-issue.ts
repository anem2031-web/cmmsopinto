import { TRPCError } from "@trpc/server";
import { sql } from "drizzle-orm";
import { APP_ROLE } from "../../../shared/roles";
import { assertCanPerformItemStatusAction } from "../../_core/authz/engine";
import { getActiveCatalogUnitCanonicalName } from "../../_core/catalog-unit-governance";
import { withTransaction } from "../../_core/db/client";
import { issueDelivery } from "../../_core/db/warehouse-returns";
import { isInventoryLotsEnabled } from "../../_core/inventory-lots";
import { executionRows } from "../operational-issues/issue-reference";

export type PscmFulfillmentIssueInput = {
  purchaseOrderItemId: number;
  lotId: number;
  quantity: number;
  deliveredToId: number;
  operationKey: string;
};

export function pscmLotUnitsPerOrderUnit(input: {
  orderUnit: string;
  purchaseUnit: string;
  issueUnit: string;
  conversionFactor: number;
}): number | null {
  const order = input.orderUnit.trim().toLocaleLowerCase();
  const purchase = input.purchaseUnit.trim().toLocaleLowerCase();
  const issue = input.issueUnit.trim().toLocaleLowerCase();
  if (!order || !purchase || !issue || !Number.isFinite(input.conversionFactor) || input.conversionFactor <= 0) {
    return null;
  }
  // Same precedence as receiptInOrderUnits: a received order unit represents
  // the recorded number of physical issue units; an order in issue units is 1:1.
  if (order === purchase) return input.conversionFactor;
  return order === issue ? 1 : null;
}

const orderScale = 1_000_000;
const orderUnits = (quantity: number) => Math.round(quantity * orderScale);
const issuedOrderUnits = (issuedFromLot: number, quantity: number, ratio: number) =>
  orderUnits((issuedFromLot + quantity) / ratio) - orderUnits(issuedFromLot / ratio);
const validId = (value: number) => Number.isSafeInteger(value) && value > 0 && value <= 2_147_483_647;

export function pscmAvailableIssueQuantity(
  available: number, remaining: number, ratio: number, issuedFromLot: number
): number {
  if (![available, remaining, ratio, issuedFromLot].every(Number.isFinite) ||
    available < 1 || remaining <= 0 || ratio <= 0 || issuedFromLot < 0) return 0;
  const remainingUnits = orderUnits(remaining);
  const upperOrderLimit = (orderUnits(issuedFromLot / ratio) + remainingUnits + 0.5) / orderScale;
  const cap = Math.min(Math.floor(available), Math.floor(upperOrderLimit * ratio) - issuedFromLot);
  if (cap <= 0) return 0;
  return issuedOrderUnits(issuedFromLot, cap, ratio) > remainingUnits ? cap - 1 : cap;
}

export async function issuePscmFulfillment(input: PscmFulfillmentIssueInput, actorId: number) {
  if (![actorId, input.purchaseOrderItemId, input.lotId, input.quantity, input.deliveredToId].every(validId) ||
    !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(input.operationKey)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "بيانات صرف احتياج PSCM غير صالحة" });
  }
  const operationKey = input.operationKey.toLowerCase();

  return withTransaction(async (tx) => {
    const [actor] = await executionRows(tx, sql`SELECT id,role,isActive FROM users WHERE id=${actorId} FOR UPDATE`);
    if (Number(actor?.isActive) !== 1 || ![APP_ROLE.WAREHOUSE, APP_ROLE.OWNER, APP_ROLE.ADMIN].includes(actor?.role)) {
      throw new TRPCError({ code: "FORBIDDEN", message: "صرف مواد PSCM لأمين المستودع فقط" });
    }

    // The source purchase item serializes competing quantities, even across lots.
    const [item] = await executionRows(tx, sql`SELECT i.id,i.purchaseOrderId,i.status,i.reviewRole,i.siteId,i.sectionId,i.assetId,
        s.requestedQuantity,s.orderUnit,p.siteId AS orderSiteId,p.sectionId AS orderSectionId,p.assetId AS orderAssetId,
        p.sourceReference,p.status AS orderStatus
      FROM purchase_order_items i
      INNER JOIN purchase_orders p ON p.id=i.purchaseOrderId
      INNER JOIN pscm_purchase_items s ON s.purchaseOrderItemId=i.id AND s.purchaseOrderId=p.id
      WHERE i.id=${input.purchaseOrderItemId} AND p.sourceSystem='PSCM' AND s.taskId>0 FOR UPDATE`);
    if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "بند احتياج PSCM غير مرتبط بمهمة" });

    const [replay] = await executionRows(tx, sql`SELECT purchaseOrderItemId,lotId,quantity,deliveredToId,deliveryNumber
      FROM pscm_fulfillment_issues WHERE operationKey=${operationKey} FOR UPDATE`);
    if (replay) {
      if (Number(replay.purchaseOrderItemId) !== input.purchaseOrderItemId || Number(replay.lotId) !== input.lotId ||
        Number(replay.quantity) !== input.quantity || Number(replay.deliveredToId) !== input.deliveredToId) {
        throw new TRPCError({ code: "CONFLICT", message: "معرف الصرف مستخدم لعملية تسليم أخرى" });
      }
      return { deliveryNumber: String(replay.deliveryNumber) };
    }

    assertCanPerformItemStatusAction("confirmDeliveryToRequester", { userId: actorId, role: actor.role }, item.status);
    if (item.status !== "delivered_to_warehouse" || ["closed", "rejected", "draft", "revision_needed"].includes(item.orderStatus) ||
      !isInventoryLotsEnabled()) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "يلزم استلام الصنف بالمستودع وتتبع دفعة الاستلام أولًا" });
    }
    const [receiver] = await executionRows(tx, sql`SELECT id FROM users WHERE id=${input.deliveredToId}
      AND role=${APP_ROLE.TECHNICIAN} AND isActive=1 FOR UPDATE`);
    if (!receiver) throw new TRPCError({ code: "BAD_REQUEST", message: "اختر فنيًا مستلمًا نشطًا" });

    const [receiptLine] = await executionRows(tx, sql`SELECT rri.inventoryId
      FROM inventory_lots l INNER JOIN warehouse_receipt_items rri ON rri.id=l.receiptItemId AND rri.receiptId=l.receiptId
      WHERE l.id=${input.lotId} AND l.purchaseOrderItemId=${input.purchaseOrderItemId}
        AND l.purchaseOrderId=${Number(item.purchaseOrderId)} AND l.sourceType='receipt'
        AND rri.purchaseOrderItemId=${input.purchaseOrderItemId}`);
    const inventoryId = Number(receiptLine?.inventoryId);
    if (!validId(inventoryId)) throw new TRPCError({ code: "NOT_FOUND", message: "الدفعة لا تخص استلام بند الشراء المحدد" });

    // Match the central writer's stock-then-lot lock order.
    const [stock] = await executionRows(tx, sql`SELECT id,quantity,isFrozen FROM inventory WHERE id=${inventoryId} FOR UPDATE`);
    const [lot] = await executionRows(tx, sql`SELECT l.trackingToken,l.specificationStatus,l.purchaseUnit,l.issueUnit,
        l.conversionFactor,l.remainingQuantity,b.quantity AS balance
      FROM inventory_lots l
      INNER JOIN warehouse_receipt_items li ON li.id=l.receiptItemId AND li.receiptId=l.receiptId
      INNER JOIN warehouse_receipts r ON r.id=li.receiptId AND r.status='confirmed'
      INNER JOIN inventory_lot_balances b ON b.lotId=l.id AND b.inventoryId=li.inventoryId
      WHERE l.id=${input.lotId} AND l.purchaseOrderItemId=${input.purchaseOrderItemId} AND l.purchaseOrderId=${Number(item.purchaseOrderId)}
        AND l.sourceType='receipt' AND li.purchaseOrderItemId=${input.purchaseOrderItemId} AND li.inventoryId=${inventoryId} FOR UPDATE`);
    const needsMatching = item.reviewRole === APP_ROLE.CONSTRUCTION_PROCUREMENT_MANAGER;
    if (!lot || !stock || Number(stock.isFrozen) === 1 || !lot.trackingToken ||
      (lot.specificationStatus !== "approved" && (needsMatching || lot.specificationStatus != null))) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "دفعة الاستلام غير جاهزة للصرف أو لم تُعتمد مطابقتها" });
    }
    const available = Math.min(Number(lot.balance), Number(lot.remainingQuantity), Number(stock.quantity));
    if (!Number.isFinite(available) || input.quantity > available) {
      throw new TRPCError({ code: "CONFLICT", message: "الكمية تتجاوز الرصيد المتاح في دفعة الاستلام" });
    }

    const [orderUnit, purchaseUnit, issueUnit] = await Promise.all(
      [item.orderUnit, lot.purchaseUnit, lot.issueUnit].map(async (unit) =>
        (await getActiveCatalogUnitCanonicalName(unit, tx)) || String(unit ?? "").trim())
    );
    const ratio = pscmLotUnitsPerOrderUnit({ orderUnit, purchaseUnit, issueUnit, conversionFactor: Number(lot.conversionFactor) });
    if (!ratio) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "تعذر مطابقة وحدة الدفعة مع وحدة الاحتياج" });

    const [alreadyIssued] = await executionRows(tx, sql`SELECT COALESCE(SUM(orderQuantity),0) AS total,
        COALESCE(SUM(CASE WHEN lotId=${input.lotId} THEN quantity ELSE 0 END),0) AS fromLot
      FROM pscm_fulfillment_issues WHERE purchaseOrderItemId=${input.purchaseOrderItemId}`);
    const issuedLine = orderUnits(Number(alreadyIssued.total));
    const issuedFromLot = Number(alreadyIssued.fromLot);
    const added = issuedOrderUnits(issuedFromLot, input.quantity, ratio);
    const remaining = orderUnits(Number(item.requestedQuantity)) - issuedLine;
    if (!Number.isSafeInteger(added) || added <= 0 || remaining <= 0 || added > remaining) {
      throw new TRPCError({ code: "CONFLICT", message: "الكمية تتجاوز متبقي احتياج المهمة أو يصعب تمثيلها بوحدة الطلب" });
    }

    const resolution = await issueDelivery({
      inventoryId,
      quantity: input.quantity,
      unit: String(lot.issueUnit),
      performedById: actorId,
      deliveredToId: input.deliveredToId,
      purchaseOrderItemId: input.purchaseOrderItemId,
      pscmFulfillment: true,
      lotTrackingToken: String(lot.trackingToken),
      markPurchaseOrderItemDelivered: added === remaining,
      notes: `صرف مواد مهمة PSCM — ${item.sourceReference}`,
      costAllocations: [{
        beneficiarySiteId: Number(item.siteId ?? item.orderSiteId),
        beneficiarySectionId: Number(item.sectionId ?? item.orderSectionId),
        beneficiaryAssetId: (item.siteId != null && item.sectionId != null ? item.assetId : item.orderAssetId) ?? null,
        quantity: input.quantity,
      }],
    }, tx);
    if (!resolution.deliveryDocumentId) throw new Error("تعذر حفظ سند تسليم احتياج PSCM");
    await tx.execute(sql`INSERT INTO pscm_fulfillment_issues
      (operationKey,purchaseOrderItemId,lotId,quantity,deliveredToId,deliveryNumber,deliveryDocumentId,orderQuantity)
      VALUES (${operationKey},${input.purchaseOrderItemId},${input.lotId},${input.quantity},${input.deliveredToId},
        ${resolution.deliveryNumber},${resolution.deliveryDocumentId},${(added / orderScale).toFixed(6)})`);
    return { deliveryNumber: resolution.deliveryNumber };
  });
}

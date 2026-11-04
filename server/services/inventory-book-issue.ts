import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { planBookFifo } from "../../shared/inventory-book";
import { filterSpecificationLots } from "./purchase-specification-guards";

/** Orchestration only: every allocated line goes through the existing delivery writer. */
export async function issueInventoryBook(
  database: any,
  input: any,
  actorId: number,
  deliver: (
    line: any,
    tx: any,
    afterCommit: Array<() => Promise<any>>
  ) => Promise<any>,
  resumeEffects?: (snapshot: any) => Promise<any>,
  authorize?: (tx: any) => Promise<void>
) {
  if (
    input.costAllocations?.some(
      (line: any) =>
        Math.abs(Number(line.quantity) - Number(input.deliveryQty)) > 0.000001
    )
  )
    throw Error("توزيع الكمية لا يطابق كمية الصرف");
  const fingerprint = createHash("sha256")
    .update(JSON.stringify(input))
    .digest("hex");
  const afterCommit: Array<() => Promise<any>> = [];
  let pendingEffects: any[] = [];
  let effectsComplete = false;
  const result = await database.transaction(async (tx: any) => {
    await authorize?.(tx);
    afterCommit.length = 0;
    pendingEffects = [];
    effectsComplete = false;
    const [warehouses] = await tx.execute(
      sql`SELECT id,isActive FROM warehouses WHERE id=${input.warehouseId} LIMIT 1`
    );
    if (!warehouses.length || Number(warehouses[0].isActive) !== 1)
      throw Error("المستودع غير موجود أو غير نشط");
    const [masters] = await tx.execute(
      sql`SELECT id FROM catalog_items WHERE id=${input.catalogItemId} FOR UPDATE`
    );
    if (!masters.length) throw Error("صنف الكتالوج غير موجود");
    const [previous] =
      await tx.execute(sql`SELECT newValues FROM audit_logs WHERE action='deliver_inventory_book'
      AND userId=${actorId} AND entityId=${input.catalogItemId}
      AND JSON_UNQUOTE(JSON_EXTRACT(newValues,'$.operationKey'))=${input.operationKey} LIMIT 1`);
    if (previous.length) {
      const saved =
        typeof previous[0].newValues === "string"
          ? JSON.parse(previous[0].newValues)
          : previous[0].newValues;
      if (saved.fingerprint !== fingerprint)
        throw Error("مفتاح العملية مستخدم لطلب مختلف");
      pendingEffects = saved.followUps || [];
      effectsComplete = !!saved.effectsComplete;
      return saved.result;
    }
    const [parents] =
      await tx.execute(sql`SELECT id FROM inventory WHERE linkedItemId=${input.catalogItemId}
      AND warehouseId=${input.warehouseId} ORDER BY id FOR UPDATE`);
    if (!parents.length) throw Error("الصنف غير موجود في المستودع المحدد");
    const [lots] =
      await tx.execute(sql`SELECT i.id AS inventoryId,COALESCE(NULLIF(TRIM(i.issueUnit),''),i.unit) AS inventoryUnit,i.isFrozen,
      l.id AS lotId,l.lotCode,l.trackingToken,l.issueUnit,l.createdAt,b.quantity AS balanceQuantity
      FROM inventory i JOIN inventory_lot_balances b ON b.inventoryId=i.id JOIN inventory_lots l ON l.id=b.lotId
      WHERE i.linkedItemId=${input.catalogItemId} AND i.warehouseId=${input.warehouseId}
      AND l.catalogItemId=${input.catalogItemId} AND i.isFrozen=0 AND b.quantity>0
      ORDER BY l.createdAt,l.id,i.id FOR UPDATE`);
    const eligibleLots = await filterSpecificationLots(tx, lots, (row: any) => Number(row.lotId));
    const plan = planBookFifo(eligibleLots, input.deliveryQty, input.deliveryUnit);
    if (plan.some(line => !Number.isInteger(line.quantity)))
      throw Error(
        "سند الصرف الحالي يتطلب كمية صحيحة لكل لوت؛ اختر لوتًا يدويًا أو راجع الكمية"
      );
    if (plan.length > 100)
      throw Error("الكمية تتطلب أكثر من 100 لوت؛ جزّئ عملية الصرف");
    const deliveries = [];
    for (const line of plan)
      deliveries.push(
        await deliver(
          {
            inventoryId: Number(line.inventoryId),
            deliveredToId: input.deliveredToId,
            deliveryQty: line.quantity,
            deliveryUnit: input.deliveryUnit,
            lotTrackingToken: line.trackingToken,
            notes: input.notes,
            costAllocations: input.costAllocations?.map((allocation: any) => ({
              ...allocation,
              quantity: line.quantity,
            })),
          },
          tx,
          afterCommit
        )
      );
    const response = {
      success: true,
      deliveries,
      allocatedCostTotal: deliveries.reduce(
        (sum, row) => sum + Number(row.allocatedCostTotal || 0),
        0
      ),
    };
    await tx.execute(sql`INSERT INTO audit_logs (userId,action,entityType,entityId,newValues)
      VALUES (${actorId},'deliver_inventory_book','catalog_item',${input.catalogItemId},${JSON.stringify({ operationKey: input.operationKey, fingerprint, result: response, followUps: afterCommit.map((finish: any) => finish.resumeData).filter(Boolean), effectsComplete: false })})`);
    return response;
  });
  if (!effectsComplete) {
    if (afterCommit.length) {
      for (const finish of afterCommit) await finish();
    } else if (pendingEffects.length) {
      if (!resumeEffects)
        throw Error(
          "تعذر استكمال متابعة الصرف؛ احتفظ برقم العملية وأعد المحاولة"
        );
      for (const snapshot of pendingEffects) await resumeEffects(snapshot);
    }
    await database.transaction(async (tx: any) =>
      tx.execute(sql`UPDATE audit_logs SET newValues=JSON_SET(newValues,'$.effectsComplete',1)
      WHERE action='deliver_inventory_book' AND userId=${actorId} AND entityId=${input.catalogItemId}
      AND JSON_UNQUOTE(JSON_EXTRACT(newValues,'$.operationKey'))=${input.operationKey}`)
    );
  }
  return result;
}

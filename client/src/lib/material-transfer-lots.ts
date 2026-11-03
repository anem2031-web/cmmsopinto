import {
  selectFullIssueLots,
  type WarehouseLotOption,
  type WarehouseLotSelection,
} from "@shared/warehouse-lot-selection";
import { buildPmv2TransferCart } from "./pmv2-transfer-plan";

export type MaterialTransferAllocation = {
  sourceInventoryId: number;
  catalogItemId: number;
  materialName: string;
  quantity: number;
  unit: string;
  originalQuantity: number;
  lotId: number;
  lotCode: string;
  trackingToken: string;
  replacementPlanId?: number;
  allowedLotIds?: number[];
};
export type MaterialTransferGroup = Omit<
  MaterialTransferAllocation,
  "lotId" | "lotCode" | "trackingToken"
> & { key: string };
export function groupMaterialTransferPlan(
  allocations: MaterialTransferAllocation[]
): MaterialTransferGroup[] {
  const groups = new Map<string, MaterialTransferGroup>();
  for (const part of allocations) {
    const key = `${part.sourceInventoryId}:${part.catalogItemId}:${part.unit}:${part.replacementPlanId || 0}`;
    const previous = groups.get(key);
    if (previous) {
      previous.quantity += part.quantity;
      previous.originalQuantity += part.originalQuantity;
    } else
      groups.set(key, {
        key,
        sourceInventoryId: part.sourceInventoryId,
        catalogItemId: part.catalogItemId,
        materialName: part.materialName,
        quantity: part.quantity,
        unit: part.unit,
        originalQuantity: part.originalQuantity,
        replacementPlanId: part.replacementPlanId,
        allowedLotIds: part.allowedLotIds,
      });
  }
  return Array.from(groups.values());
}
export function materialTransferLotOptions(
  group: MaterialTransferGroup,
  raw: any[]
): Array<WarehouseLotOption & { trackingToken: string }> {
  if (group.replacementPlanId && !group.allowedLotIds?.length)
    throw Error("أعد فتح الطلب لتحميل اللوتات المعتمدة للبديل");
  return raw
    .filter(
      lot =>
        Number(lot.catalogItemId) === group.catalogItemId &&
        String(lot.issueUnit || group.unit).trim() === group.unit.trim() &&
        (!group.allowedLotIds ||
          group.allowedLotIds.includes(Number(lot.lotId))) &&
        Number(lot.balanceQuantity) >= 1 &&
        !!lot.trackingToken
    )
    .map(lot => ({
      lotId: Number(lot.lotId),
      inventoryId: group.sourceInventoryId,
      quantity: Math.floor(Number(lot.balanceQuantity)),
      unit: group.unit,
      lotCode: String(lot.lotCode || lot.lotId),
      trackingToken: String(lot.trackingToken),
      createdAt:
        lot.createdAt instanceof Date
          ? lot.createdAt.toISOString()
          : String(lot.createdAt || ""),
    }));
}
export function buildMaterialTransferLotCart(
  groups: MaterialTransferGroup[],
  lotsByInventory: Record<number, any[]>,
  selections: Record<string, WarehouseLotSelection>,
  context: {
    source: "tickets" | "pmv2";
    requestItemId: number;
    fromWarehouseId: number;
    toWarehouseId: number;
    quantity: number;
    materialName: string;
    unit: string;
  },
  inventory: any[],
  notes = ""
) {
  if (!groups.length)
    throw Error("خطة تحويل المواد غير متاحة؛ ارجع إلى الطلب وحدّثه");
  const allocations: MaterialTransferAllocation[] = groups.flatMap(group => {
    const source = inventory.find(
      item =>
        Number(item.id) === group.sourceInventoryId &&
        Number(item.warehouseId) === context.fromWarehouseId
    );
    if (
      !source ||
      Number(source.isFrozen) ||
      String(source.issueUnit || source.unit || group.unit).trim() !==
        group.unit.trim()
    )
      throw Error("المخزون أو وحدة الصنف لا تطابق خطة التحويل");
    return selectFullIssueLots(
      materialTransferLotOptions(
        group,
        lotsByInventory[group.sourceInventoryId] || []
      ),
      group.quantity,
      group.unit,
      selections[group.key] || { mode: "fifo" }
    ).map(lot => {
      const originalQuantity =
        (lot.quantity * group.originalQuantity) / group.quantity;
      if (
        Math.abs(
          originalQuantity * 1000 - Math.round(originalQuantity * 1000)
        ) > 0.000001
      )
        throw Error("كمية اللوت لا تحقق نسبة البديل بدقة؛ اختر توزيعًا آخر");
      return {
        ...group,
        quantity: lot.quantity,
        originalQuantity: Number(originalQuantity.toFixed(3)),
        lotId: lot.lotId,
        lotCode: lot.lotCode || String(lot.lotId),
        trackingToken: lot.trackingToken,
      };
    });
  });
  const result = buildPmv2TransferCart(
    {
      sourceWarehouse: { id: context.fromWarehouseId },
      destinationWarehouse: { id: context.toWarehouseId },
      remainingQuantity: context.quantity,
      fulfillmentAllocations: allocations,
    },
    context,
    inventory
  );
  return result.map(row => ({
    ...row,
    notes: [row.notes, notes.trim()].filter(Boolean).join(" — ") || undefined,
  }));
}

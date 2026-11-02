import { z } from "zod";
import type { OperationalStock } from "./operational-issues";
import { selectFullIssueLots, warehouseLotSelectionSchema, type WarehouseLotSelection } from "./warehouse-lot-selection";

const id = z.number().int().positive();
export const dispatchContextSchema = z.object({
  version: z.literal(1),
  warehouseId: id,
  warehouseName: z.string(),
  siteId: id,
  siteName: z.string(),
  sectionId: id,
  sectionName: z.string(),
  collectorId: id,
  collectorName: z.string(),
  source: z.enum(["inventory", "catalog"]),
});
export type DispatchContext = z.infer<typeof dispatchContextSchema>;
export function dispatchContext(value: unknown): DispatchContext | null {
  if (value == null) return null;
  return dispatchContextSchema.parse(
    typeof value === "string" ? JSON.parse(value) : value
  );
}
export const preparedCreateSchema = z.object({
  warehouseId: id,
  reason: z.string().trim().min(1).max(2000),
  operationKey: z.string().min(1).max(120),
  items: z
    .array(
      z.object({
        catalogItemId: id,
        quantity: z.number().int().positive().max(2147483647),
        unit: z.string().trim().min(1).max(50),
        siteId: id,
        sectionId: id,
        collectorId: id,
        source: z.enum(["inventory", "catalog"]),
      })
    )
    .min(1)
    .max(20),
});
export const preparedIssueSchema = z.object({
  orderId: id,
  revision: z.number().int().nonnegative(),
  operationKey: z.string().min(1).max(100),
  items: z
    .array(
      z.object({
        itemId: id,
        actualCollectorId: id.nullable().optional(),
        notes: z.string().trim().max(2000).default(""),
        selection: warehouseLotSelectionSchema.optional(),
      })
    )
    .min(1)
    .max(20),
});
export type PreparedCreate = z.infer<typeof preparedCreateSchema>;
export type PreparedIssue = z.infer<typeof preparedIssueSchema>;
export const canUseOperationalCatalog = (role: string) =>
  role === "owner" || role === "admin";

/** Quantities are in thousandths; no unit conversion and no valuation changes. */
export function allocateOperationalFifo(
  stock: OperationalStock,
  quantity: number,
  selection?: WarehouseLotSelection
) {
  if (stock.needsReview || !Number.isFinite(quantity) || quantity <= 0)
    throw new Error("راجع أرصدة الصنف قبل الصرف");
  if(selection?.mode === "manual") return selectFullIssueLots(stock.lots,quantity,stock.unit,selection);
  if (stock.fulfillment) {
    if (!stock.fulfillment.ready || Math.round(quantity * 1000) !== Math.round(stock.fulfillment.remainingOriginalQuantity * 1000))
      throw new Error("الرصيد غير كافٍ لاستكمال الاحتياج وبدائله المعتمدة بالكامل");
    return stock.fulfillment.allocations.map(lot => ({ ...lot }));
  }
  let remaining = Math.round(quantity * 1000);
  const allocations: Array<OperationalStock["lots"][number]> = [];
  for (const lot of [...stock.lots].sort(
    (a, b) =>
      String(a.receivedAt).localeCompare(String(b.receivedAt)) ||
      a.lotId - b.lotId ||
      a.inventoryId - b.inventoryId
  )) {
    if (!remaining) break;
    const used = Math.min(remaining, Math.round(lot.quantity * 1000));
    if (used <= 0) continue;
    // Existing delivery documents store integer quantities. Never silently round a split.
    if (used % 1000 !== 0)
      throw new Error("رصيد أقدم لوت كسري؛ يلزم مراجعته قبل الصرف التشغيلي");
    allocations.push({ ...lot, quantity: used / 1000 });
    remaining -= used;
  }
  if (remaining || quantity > stock.totalQuantity)
    throw new Error("الرصيد غير كافٍ لصرف الطلب بالكامل؛ لم يتم خصم أي بند");
  return allocations;
}

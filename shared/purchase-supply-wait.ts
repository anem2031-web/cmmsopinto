import { z } from "zod";

export const SUPPLY_WAIT_EDIT_MS = 2 * 60 * 60 * 1000;
export const supplyWaitKind = z.enum(["waiting_availability", "preparing"]);
export type SupplyWaitKind = z.infer<typeof supplyWaitKind>;
export type SupplyWaitActor = { id: number; role: string; isActive?: number | boolean | null };
export const supplyWaitAdmin = (actor: SupplyWaitActor) => ["admin", "owner"].includes(actor.role);
export const supplyWaitDelegate = (actor: SupplyWaitActor) => ["delegate", "delegate_manager"].includes(actor.role);
export const supplyWaitReader = (actor?: SupplyWaitActor | null) => !!actor && actor.isActive === 1
  && Number.isSafeInteger(actor.id) && actor.id > 0 && !["observer", "gate_security", "technician"].includes(actor.role);
export function supplyWaitRpcAllowed(actor: SupplyWaitActor | null | undefined, type: string, path: string) {
  if (!path.startsWith("purchaseSupplyWait.")) return true;
  return supplyWaitReader(actor) && (type === "query" && path === "purchaseSupplyWait.list"
    || type === "mutation" && path === "purchaseSupplyWait.save" && (supplyWaitAdmin(actor!) || supplyWaitDelegate(actor!)));
}
export const supplyWaitItem = z.object({ itemId: z.number().int().positive(), purchaseOrderId: z.number().int().positive() }).strict();
export const supplyWaitListInput = z.object({ viewerId: z.number().int().positive(), viewerRole: z.string().min(1).max(64), items: z.array(supplyWaitItem).min(1).max(500) }).strict();
export const supplyWaitSaveInput = supplyWaitItem.extend({
  kind: supplyWaitKind,
  expectedReceiptDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, "اختر تاريخًا صحيحًا"),
  reason: z.string().trim().min(1).max(2000),
  revision: z.number().int().nonnegative().nullable(),
}).strict();
export type SupplyWaitReference = z.infer<typeof supplyWaitItem>;
export type SupplyWaitNote = {
  kind: SupplyWaitKind; expectedReceiptDate: string; reason: string;
  createdById: number; createdByName: string; createdAt: string;
  updatedById: number; updatedByName: string; updatedAt: string;
  editableUntil: string; revision: number; canEdit: boolean;
};
export type SupplyWaitEntry = SupplyWaitReference & { canCreate: boolean; note: SupplyWaitNote | null };
export const supplyWaitKey = (item: SupplyWaitReference) => `${item.purchaseOrderId}:${item.itemId}`;
export function chunkSupplyWaitItems(items: SupplyWaitReference[], size = 500) {
  if (!Number.isInteger(size) || size < 1 || size > 500) throw Error("Invalid supply-wait read chunk size");
  const unique = Array.from(new Map(items.filter(item => Number.isSafeInteger(item.itemId) && item.itemId > 0
    && Number.isSafeInteger(item.purchaseOrderId) && item.purchaseOrderId > 0).map(item => [supplyWaitKey(item), item])).values());
  const chunks: SupplyWaitReference[][] = [];
  for (let offset = 0; offset < unique.length; offset += size) chunks.push(unique.slice(offset, offset + size));
  return chunks;
}

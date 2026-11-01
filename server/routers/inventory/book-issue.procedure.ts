import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { warehouseProcedure } from "../_shared/procedures";
import { issueCostAllocationsSchema } from "./issue-cost-allocation.schema";
import { issueInventoryBook } from "../../services/inventory-book-issue";
import { isInventoryLotsEnabled } from "../../_core/inventory-lots";

export const inventoryDeliveryInput = z.object({
  inventoryId: z.number(),
  deliveredToId: z.number(),
  deliveryQty: z.number().positive(),
  deliveryUnit: z.string().min(1, "الوحدة مطلوبة"),
  lotTrackingToken: z.string().trim().min(1).optional(),
  costAllocations: issueCostAllocationsSchema.optional(),
  notes: z.string().optional(),
});
export function createBookIssueProcedure(
  getDatabase: () => Promise<any>,
  deliverLine: (
    input: any,
    ctx: any,
    tx: any,
    afterCommit: Array<() => Promise<any>>,
    marked: Set<number>
  ) => Promise<any>,
  finishLine?: (snapshot: any, ctx: any) => Promise<any>,
  lotsEnabled: () => boolean = isInventoryLotsEnabled
) {
  return warehouseProcedure
    .input(
      inventoryDeliveryInput
        .omit({ inventoryId: true, lotTrackingToken: true })
        .extend({
          catalogItemId: z.number().int().positive(),
          warehouseId: z.number().int().positive(),
          operationKey: z.string().uuid(),
        })
    )
    .mutation(async ({ input, ctx }) => {
      if (Number(ctx.user.isActive) !== 1)
        throw new TRPCError({ code: "FORBIDDEN", message: "الحساب غير نشط" });
      if (!lotsEnabled())
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "الصرف من الدفتر يتطلب تفعيل تتبع اللوتات",
        });
      const database = await getDatabase();
      if (!database) throw Error("تعذر الاتصال بقاعدة البيانات");
      const markedPurchaseItems = new Set<number>();
      return issueInventoryBook(
        database,
        input,
        ctx.user.id,
        (line, tx, callbacks) =>
          deliverLine(line, ctx, tx, callbacks, markedPurchaseItems),
        finishLine ? snapshot => finishLine(snapshot, ctx) : undefined
      );
    });
}

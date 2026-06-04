import { z } from "zod";
import { router, warehouseProcedure } from "../_shared/procedures";
import * as db from "../../db";

// Warehouse delivery confirmations — called after PO items are purchased
export const warehouseRouter = router({
  confirmDeliveryToWarehouse: warehouseProcedure
    .input(z.object({ itemId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      await db.updatePOItem(input.itemId, {
        status: "delivered_to_warehouse",
        deliveredToWarehouseById: ctx.user.id,
        deliveredToWarehouseAt: new Date(),
      });
      await db.createAuditLog({
        userId: ctx.user.id,
        action: "confirm_delivery_warehouse",
        entityType: "purchase_order_item",
        entityId: input.itemId,
      });
      return { success: true };
    }),

  confirmDeliveryToRequester: warehouseProcedure
    .input(z.object({ itemId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      await db.updatePOItem(input.itemId, {
        status: "delivered_to_requester",
        deliveredToRequesterById: ctx.user.id,
        deliveredToRequesterAt: new Date(),
      });
      await db.createAuditLog({
        userId: ctx.user.id,
        action: "confirm_delivery_requester",
        entityType: "purchase_order_item",
        entityId: input.itemId,
      });
      return { success: true };
    }),
});

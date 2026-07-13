import { z } from "zod";
import { router, warehouseProcedure } from "../_shared/procedures";
import * as db from "../../_core/db";

// Inter-site inventory transfers
export const transfersRouter = router({
  create: warehouseProcedure
    .input(z.object({
      inventoryItemId: z.number(),
      fromSiteId: z.number(),
      toSiteId: z.number(),
      quantity: z.number().min(1),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      await db.createInventoryTransfer({ ...input, createdById: ctx.user.id });
      return { success: true };
    }),

  list: warehouseProcedure
    .input(z.object({ siteId: z.number().optional() }))
    .query(async ({ input }) => {
      return db.getInventoryTransfers(input.siteId);
    }),
});

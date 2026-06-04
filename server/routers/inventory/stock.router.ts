import { z } from "zod";
import { router, protectedProcedure, warehouseProcedure } from "../_shared/procedures";
import * as db from "../../db";

// Stock movement queries — complements inventory.router.ts
export const stockRouter = router({
  getTransactions: protectedProcedure
    .input(z.object({
      inventoryId: z.number().optional(),
      limit: z.number().optional(),
    }))
    .query(async ({ input }) => {
      return db.getInventoryTransactions(input);
    }),

  getLowStockItems: protectedProcedure.query(async () => {
    return db.getLowStockInventoryItems();
  }),
});

import { z } from "zod";
import { router, protectedProcedure } from "../_shared/procedures";
import * as db from "../../_core/db";

// Asset historical data — maintenance + inspection records
export const assetHistoryRouter = router({
  getMaintenanceHistory: protectedProcedure
    .input(z.object({ assetId: z.number() }))
    .query(async ({ input }) => {
      return db.getAssetMaintenanceHistory(input.assetId);
    }),

  getMaintenanceStats: protectedProcedure
    .input(z.object({ assetId: z.number() }))
    .query(async ({ input }) => {
      return db.getAssetMaintenanceStats(input.assetId);
    }),

  getInspectionHistory: protectedProcedure
    .input(z.object({ assetId: z.number(), limit: z.number().optional() }))
    .query(async ({ input }) => {
      return db.getInspectionResultsByAsset(input.assetId);
    }),
});

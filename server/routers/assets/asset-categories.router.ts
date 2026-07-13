import { z } from "zod";
import { router, protectedProcedure } from "../_shared/procedures";
import * as db from "../../_core/db";

export const assetCategoriesRouter = router({
  list: protectedProcedure.query(async () => {
    return db.listAssetCategories();
  }),

  create: protectedProcedure.input(z.object({ name: z.string().min(1) })).mutation(async ({ input }) => {
    return db.createAssetCategory(input.name);
  }),

  update: protectedProcedure.input(z.object({ id: z.number(), name: z.string().min(1) })).mutation(async ({ input }) => {
    return db.updateAssetCategory(input.id, input.name);
  }),

  delete: protectedProcedure.input(z.object({ id: z.number() })).mutation(async ({ input }) => {
    return db.deleteAssetCategory(input.id);
  }),
});

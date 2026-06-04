import { z } from "zod";
import { router, protectedProcedure, managerProcedure } from "../_shared/procedures";
import * as db from "../../db";
import { storageRename } from "../../storage";

// Asset documents, photos, and RFID tag management
export const assetDocumentsRouter = router({
  updateRfid: managerProcedure
    .input(z.object({ id: z.number(), rfidTag: z.string().min(1) }))
    .mutation(async ({ input }) => {
      return db.updateAssetRfidTag(input.id, input.rfidTag);
    }),

  linkRfidTag: protectedProcedure
    .input(z.object({ assetId: z.number(), rfidTag: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const asset = await db.getAssetById(input.assetId);
      if (!asset) {
        const { TRPCError } = await import("@trpc/server");
        throw new TRPCError({ code: "NOT_FOUND", message: "الأصل غير موجود" });
      }
      return db.updateAssetRfidTag(input.assetId, input.rfidTag);
    }),

  renamePhoto: managerProcedure
    .input(z.object({
      assetId: z.number(),
      oldKey: z.string(),
      newKey: z.string(),
    }))
    .mutation(async ({ input }) => {
      const { url } = await storageRename(input.oldKey, input.newKey);
      await db.updateAsset(input.assetId, { photoUrl: url });
      return { url };
    }),
});

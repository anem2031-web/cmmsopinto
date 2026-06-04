import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { router, protectedProcedure } from "../_shared/procedures";
import * as db from "../../db";

export const nfcRouter = router({
  scanTag: protectedProcedure.input(z.object({
    rfidTag: z.string().min(1, "يجب توفير رقم الرقاقة"),
  })).mutation(async ({ input }) => {
    // ✅ Find asset by RFID tag
    const asset = await db.getAssetByRfidTag(input.rfidTag);
    if (!asset) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "الأصل غير موجود. يرجى تسجيل الرقاقة أولاً.",
      });
    }
    // ✅ Get site/location associated with the asset
    const site = asset.siteId ? await db.getSiteById(asset.siteId) : null;
    // ✅ Get section associated with the asset
    let section: { id: number; name: string } | null = null;
    if (asset.sectionId) {
      const sectionsList = await db.getSections();
      const found = sectionsList.find((s: any) => s.id === asset.sectionId);
      if (found) section = { id: found.id, name: found.name };
    }
    return {
      success: true,
      asset: {
        id: asset.id,
        assetNumber: asset.assetNumber,
        name: asset.name,
        description: asset.description,
        category: asset.category,
        brand: asset.brand,
        model: asset.model,
        serialNumber: asset.serialNumber,
        siteId: asset.siteId,
        sectionId: asset.sectionId,
        locationDetail: asset.locationDetail,
        photoUrl: asset.photoUrl,
        rfidTag: asset.rfidTag,
      },
      site: site ? { id: site.id, name: site.name, address: site.address } : null,
      section: section,
    };
  }),

  lookupTag: protectedProcedure.input(z.object({
    rfidTag: z.string().min(1),
  })).query(async ({ input }) => {
    const asset = await db.getAssetByRfidTag(input.rfidTag);
    if (!asset) return null;
    const site = asset.siteId ? await db.getSiteById(asset.siteId) : null;
    return {
      asset: {
        id: asset.id,
        assetNumber: asset.assetNumber,
        name: asset.name,
        siteId: asset.siteId,
        locationDetail: asset.locationDetail,
        photoUrl: asset.photoUrl,
      },
      site: site ? { id: site.id, name: site.name } : null,
    };
  }),
});

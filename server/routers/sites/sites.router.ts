import { cacheManager, cacheKeys, invalidateCache } from "../../_core/cache";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { router, protectedProcedure } from "../_shared/procedures";
import { translateFields, detectLanguage, type SupportedLanguage } from "../../services/translation/translation";
import * as db from "../../_core/db";

export const sitesRouter = router({
  list: protectedProcedure.query(async () => {
    return cacheManager.getOrCompute(
      cacheKeys.sites(),
      () => db.getAllSites(),
      600 // 10 minutes
    );
  }),

  create: protectedProcedure.input(z.object({ name: z.string().min(1), address: z.string().optional(), description: z.string().optional() })).mutation(async ({ input, ctx }) => {
    // Auto-translate name
    let nameEn: string | undefined;
    let nameUr: string | undefined;
    try {
      const translations = await translateFields({ name: input.name });
      nameEn = translations.name?.en;
      nameUr = translations.name?.ur;
    } catch (e) { /* fallback */ }
    const id = await db.createSite({ ...input, nameEn, nameUr });
    await db.createAuditLog({ userId: ctx.user.id, action: "create_site", entityType: "site", entityId: id!, newValues: input });
    // Invalidate sites cache
    invalidateCache.sites();
    return { id };
  }),

  update: protectedProcedure.input(z.object({
    id: z.number(),
    name: z.string().min(1).optional(),
    address: z.string().optional(),
    description: z.string().optional(),
  })).mutation(async ({ input, ctx }) => {
    const oldSite = await db.getSiteById(input.id);
    if (!oldSite) throw new TRPCError({ code: "NOT_FOUND", message: "الموقع غير موجود" });
    const { id, ...updateData } = input;
    // Auto-translate name if changed
    let siteExtraFields: { nameEn?: string; nameUr?: string } = {};
    if (updateData.name) {
      try {
        const translations = await translateFields({ name: updateData.name });
        siteExtraFields.nameEn = translations.name?.en;
        siteExtraFields.nameUr = translations.name?.ur;
      } catch (e) { /* fallback */ }
    }
    await db.updateSite(id, { ...updateData, ...siteExtraFields });
    await db.createAuditLog({ userId: ctx.user.id, action: "update_site", entityType: "site", entityId: id, oldValues: { name: oldSite.name, address: oldSite.address, description: oldSite.description }, newValues: updateData });
    // Invalidate sites cache
    invalidateCache.sites();
    return { success: true };
  }),

  delete: protectedProcedure.input(z.object({ id: z.number() })).mutation(async ({ input, ctx }) => {
    const site = await db.getSiteById(input.id);
    if (!site) throw new TRPCError({ code: "NOT_FOUND", message: "الموقع غير موجود" });
    await db.deleteSite(input.id);
    await db.createAuditLog({ userId: ctx.user.id, action: "delete_site", entityType: "site", entityId: input.id, oldValues: { name: site.name, address: site.address } });
    // Invalidate sites cache
    invalidateCache.sites();
    return { success: true };
  }),
});

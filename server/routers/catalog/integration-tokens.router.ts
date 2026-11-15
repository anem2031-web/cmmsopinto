import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  createCatalogIntegrationToken,
  listCatalogIntegrationTokens,
  revokeCatalogIntegrationToken,
} from "../../_core/db/catalog-integration-tokens";
import { adminOwnerProcedure, router } from "../_shared/procedures";

const activeAdminProcedure = adminOwnerProcedure.use(({ ctx, next }) => {
  if (ctx.user.isActive !== 1) {
    throw new TRPCError({ code: "FORBIDDEN", message: "الحساب غير نشط" });
  }
  return next();
});

export const catalogIntegrationTokensRouter = router({
  list: activeAdminProcedure.query(() => listCatalogIntegrationTokens()),
  create: activeAdminProcedure.input(z.object({ name: z.string().trim().min(1).max(100) }).strict())
    .mutation(({ ctx, input }) => {
      ctx.res.setHeader("Cache-Control", "private, no-store");
      return createCatalogIntegrationToken(input.name, ctx.user.id);
    }),
  revoke: activeAdminProcedure.input(z.object({ id: z.number().int().positive() }).strict())
    .mutation(({ ctx, input }) => revokeCatalogIntegrationToken(input.id, ctx.user.id)),
});

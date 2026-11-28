import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "./_shared/procedures";
import { readYourWork } from "../services/your-work";
import { canReadYourWork } from "../../shared/your-work";

export const yourWorkRouter = router({
  // These display/cache coordinates must match the actual identity; they never select another user.
  list: protectedProcedure.input(z.object({ viewerId: z.number().int().positive(), viewerRole: z.string().min(1).max(80), language: z.enum(["ar", "en", "ur"]) }).strict().optional()).query(async ({ ctx, input }) => {
    const actor = ctx.authenticatedUser ?? ctx.user;
    if (!canReadYourWork(actor)) throw new TRPCError({ code: "FORBIDDEN", message: "صفحة أعمالك غير متاحة لهذا الحساب" });
    if (input && (input.viewerId !== actor.id || input.viewerRole !== actor.role))
      throw new TRPCError({ code: "FORBIDDEN", message: "بيانات الحساب تغيرت. يرجى تحديث الصفحة." });
    const displayActor = input ? { ...actor, preferredLanguage: input.language } : actor;
    try { return await readYourWork({ ...ctx, user: displayActor, authenticatedUser: displayActor } as typeof ctx); }
    catch (error) {
      if (error instanceof TRPCError && ["FORBIDDEN", "UNAUTHORIZED"].includes(error.code)) throw error;
      console.error("[YourWork] Unable to load personal actions", error);
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "تعذر تحميل أعمالك. يرجى المحاولة مجددًا.", cause: error });
    }
  }),
});

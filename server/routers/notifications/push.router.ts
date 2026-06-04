import { z } from "zod";
import { router, publicProcedure, protectedProcedure } from "../_shared/procedures";
import * as db from "../../db";

export const pushRouter = router({
  getVapidPublicKey: publicProcedure.query(() => {
    return { publicKey: process.env.VAPID_PUBLIC_KEY || "" };
  }),

  subscribe: protectedProcedure.input(z.object({
    endpoint: z.string().url(),
    p256dh: z.string(),
    auth: z.string(),
    userAgent: z.string().optional(),
  })).mutation(async ({ input, ctx }) => {
    await db.savePushSubscription({
      userId: ctx.user.id,
      endpoint: input.endpoint,
      p256dh: input.p256dh,
      auth: input.auth,
      userAgent: input.userAgent,
    });
    return { success: true };
  }),

  unsubscribe: protectedProcedure.input(z.object({
    endpoint: z.string(),
  })).mutation(async ({ input }) => {
    await db.deletePushSubscription(input.endpoint);
    return { success: true };
  }),

  getStatus: protectedProcedure.query(async ({ ctx }) => {
    const subs = await db.getPushSubscriptionsByUser(ctx.user.id);
    return { subscribed: subs.length > 0, count: subs.length };
  }),
});

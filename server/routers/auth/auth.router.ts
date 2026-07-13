import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "../../_core/cookies";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { router, publicProcedure, protectedProcedure } from "../_shared/procedures";
import * as db from "../../_core/db";
import { cacheManager, cacheKeys, invalidateCache } from "../../_core/cache";
import { generateTwoFactorSecret, verifyTwoFactorToken, verifyBackupCode, hashBackupCodes, removeUsedBackupCode, getRemainingBackupCodesCount } from "../../_core/twoFactor";
import { rateLimiters } from "../../_core/rateLimiter";
import { sdk } from "../../_core/sdk";
import { getTwoFactorEnforcementStatus } from "../../_core/twoFactorEnforcement";

export const authRouter = router({
  me: publicProcedure.query(opts => opts.ctx.user),

  logout: publicProcedure.mutation(({ ctx }) => {
    const cookieOptions = getSessionCookieOptions(ctx.req);
    ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
    return { success: true } as const;
  }),

  login: publicProcedure.input(z.object({
    username: z.string().min(1),
    password: z.string().min(8, "كلمة المرور يجب أن تكون 8 أحرف على الأقل"),
  })).mutation(async ({ input, ctx }) => {
    const user = await db.getUserByUsername(input.username);
    if (!user || !user.passwordHash) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: "اسم المستخدم أو كلمة المرور غير صحيحة" });
    }
    if (!user.isActive) {
      throw new TRPCError({ code: "FORBIDDEN", message: "الحساب معطل" });
    }
    const valid = await bcrypt.compare(input.password, user.passwordHash);
    if (!valid) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: "اسم المستخدم أو كلمة المرور غير صحيحة" });
    }
    const sessionToken = await sdk.createSessionToken(user.openId, { name: user.name || user.username || "", expiresInMs: 1000 * 60 * 60 * 24 * 365 });
    const cookieOptions = getSessionCookieOptions(ctx.req);
    ctx.res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: 1000 * 60 * 60 * 24 * 365 });
    await db.updateLastSignedIn(user.openId);
    const twoFactorSecret = await db.getTwoFactorSecret(user.id);
    const twoFactorEnforcementStatus = getTwoFactorEnforcementStatus(user, twoFactorSecret?.isEnabled || false);

    return {
      success: true,
      user: { id: user.id, name: user.name, role: user.role, username: user.username },
      twoFactorEnforcementStatus
    };
  }),

  changePassword: protectedProcedure.input(z.object({
    currentPassword: z.string().optional(),
    newPassword: z.string().min(8, "كلمة المرور يجب أن تكون 8 أحرف على الأقل").regex(/(?=.*[A-Z])(?=.*\d)/, "يجب أن تحتوي على حرف كبير ورقم واحد على الأقل"),
  })).mutation(async ({ input, ctx }) => {
    if (ctx.user.passwordHash && input.currentPassword) {
      const valid = await bcrypt.compare(input.currentPassword, ctx.user.passwordHash);
      if (!valid) throw new TRPCError({ code: "UNAUTHORIZED", message: "كلمة المرور الحالية غير صحيحة" });
    }
    const hash = await bcrypt.hash(input.newPassword, 10);
    await db.updateUserPassword(ctx.user.id, hash);
    return { success: true };
  }),
});

/**
 * Translation Router - tRPC procedures for the central multilingual engine
 */
import { z } from "zod";
import { protectedProcedure, router } from "../../_core/trpc";
import { TRPCError } from "@trpc/server";
import {
  queueTranslation,
  getEntityTranslations,
  getBatchTranslations,
  manualOverrideTranslation,
  getTranslationVersions,
  retryFailedJobs,
  getTranslationStats,
  getTranslationJobsList,
  updateUserLanguage,
  ENTITY_FIELD_MAP,
} from "../../services/translation/translationEngine";
import type { SupportedLanguage } from "../../../drizzle/schema";

const languageEnum = z.enum(["ar", "en", "ur"]);

export const translationRouter = router({
  /**
   * Queue translation for an entity
   */
  queueTranslation: protectedProcedure
    .input(z.object({
      entityType: z.string(),
      entityId: z.number(),
      fields: z.array(z.object({
        fieldName: z.string(),
        text: z.string(),
      })),
      sourceLanguage: languageEnum,
      targetLanguages: z.array(languageEnum).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const jobIds = await queueTranslation({
        ...input,
        userId: ctx.user.id,
      });
      return { success: true, jobIds, count: jobIds.length };
    }),

  /**
   * Get translations for a single entity
   */
  getEntityTranslations: protectedProcedure
    .input(z.object({
      entityType: z.string(),
      entityId: z.number(),
      languageCode: languageEnum,
      fieldNames: z.array(z.string()).optional(),
    }))
    .query(async ({ input }) => {
      return getEntityTranslations(
        input.entityType,
        input.entityId,
        input.languageCode,
        input.fieldNames
      );
    }),

  /**
   * Get translations for multiple entities (batch)
   */
  getBatchTranslations: protectedProcedure
    .input(z.object({
      entityType: z.string(),
      entityIds: z.array(z.number()),
      languageCode: languageEnum,
      fieldNames: z.array(z.string()).optional(),
    }))
    .query(async ({ input }) => {
      return getBatchTranslations(
        input.entityType,
        input.entityIds,
        input.languageCode,
        input.fieldNames
      );
    }),

  /**
   * Manual override - edit translation manually (marks as approved)
   */
  manualOverride: protectedProcedure
    .input(z.object({
      entityType: z.string(),
      entityId: z.number(),
      fieldName: z.string(),
      languageCode: languageEnum,
      translatedText: z.string().min(1),
    }))
    .mutation(async ({ input, ctx }) => {
      // Only owner, admin, or maintenance_manager can manually override
      const allowedRoles = ["owner", "admin", "maintenance_manager"];
      if (!allowedRoles.includes(ctx.user.role)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "ليس لديك صلاحية لتعديل الترجمات يدوياً",
        });
      }

      await manualOverrideTranslation(
        input.entityType,
        input.entityId,
        input.fieldName,
        input.languageCode,
        input.translatedText,
        ctx.user.id
      );
      return { success: true };
    }),

  /**
   * Get translation version history
   */
  getVersionHistory: protectedProcedure
    .input(z.object({
      entityType: z.string(),
      entityId: z.number(),
      fieldName: z.string(),
      languageCode: languageEnum,
    }))
    .query(async ({ input }) => {
      return getTranslationVersions(
        input.entityType,
        input.entityId,
        input.fieldName,
        input.languageCode
      );
    }),

  /**
   * Retry failed translation jobs
   */
  retryFailed: protectedProcedure
    .input(z.object({
      entityType: z.string().optional(),
    }).optional())
    .mutation(async ({ input, ctx }) => {
      // Only owner/admin can retry
      if (ctx.user.role !== "owner" && ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "فقط المالك يمكنه إعادة المحاولة" });
      }
      const count = await retryFailedJobs(input?.entityType);
      return { success: true, retriedCount: count };
    }),

  /**
   * Get translation statistics for monitoring
   */
  getStats: protectedProcedure.query(async () => {
    return getTranslationStats();
  }),

  /**
   * Get translation jobs list (for admin monitoring)
   */
  getJobs: protectedProcedure
    .input(z.object({
      status: z.string().optional(),
      entityType: z.string().optional(),
      limit: z.number().optional(),
    }).optional())
    .query(async ({ input }) => {
      return getTranslationJobsList(input || undefined);
    }),

  /**
   * Update user preferred language
   */
  setLanguage: protectedProcedure
    .input(z.object({
      language: languageEnum,
    }))
    .mutation(async ({ input, ctx }) => {
      await updateUserLanguage(ctx.user.id, input.language);
      return { success: true };
    }),

  /**
   * Get available entity types and their translatable fields
   */
  getEntityFieldMap: protectedProcedure.query(async () => {
    return ENTITY_FIELD_MAP;
  }),
});

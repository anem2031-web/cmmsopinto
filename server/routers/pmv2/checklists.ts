import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { router } from "../_shared/procedures";
import {
  Pmv2ChecklistServiceError,
  pmv2ChecklistService,
} from "../../pmv2/checklists/service";
import {
  PMV2_CHECKLIST_FREQUENCIES,
  Pmv2ChecklistValidationError,
} from "../../pmv2/checklists/validation";
import { pmv2ManagementProcedure } from "../../pmv2/security/procedures";
import { canManagePmv2Foundation } from "../../pmv2/security/policy";
import { translatePmv2TaskTitle } from "../../pmv2/simplified/translate-title";

const frequencySchema = z.enum(PMV2_CHECKLIST_FREQUENCIES);
const optionalNullablePositiveInt = z.number().int().positive().nullable().optional();
const optionalNullableWeekday = z.number().int().min(0).max(6).nullable().optional();
const optionalNullableMonthDay = z.number().int().min(1).max(31).nullable().optional();
const optionalNullableDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional();
const optionalNullableScheduleConfig = z.string().max(12000).nullable().optional();

function actorFromContext(ctx: any) {
  return {
    userId: ctx.user.id,
    ipAddress: ctx.req.ip,
    userAgent: ctx.req.get?.("user-agent") ?? undefined,
  };
}

function toTrpcError(error: unknown): never {
  if (error instanceof Pmv2ChecklistValidationError) {
    throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
  }
  if (error instanceof Pmv2ChecklistServiceError) {
    throw new TRPCError({
      code: error.code === "NOT_FOUND" ? "NOT_FOUND" : "BAD_REQUEST",
      message: error.message,
    });
  }
  throw error;
}

export const pmv2ChecklistsRouter = router({
  list: pmv2ManagementProcedure
    .input(z.object({ includeInactive: z.boolean().optional() }).optional())
    .query(({ input }) =>
      pmv2ChecklistService.listChecklists(input?.includeInactive ?? false),
    ),

  get: pmv2ManagementProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input }) => ({
      checklist: await pmv2ChecklistService.getChecklist(input.id),
      items: await pmv2ChecklistService.listItems(input.id, true),
    })),

  create: pmv2ManagementProcedure
    .input(
      z.object({
        name: z.string().trim().min(1).max(200),
        description: z.string().trim().max(5000).nullable().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      try {
        return await pmv2ChecklistService.createChecklist(
          input,
          actorFromContext(ctx),
        );
      } catch (error) {
        return toTrpcError(error);
      }
    }),

  update: pmv2ManagementProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        name: z.string().trim().min(1).max(200).optional(),
        description: z.string().trim().max(5000).nullable().optional(),
        isActive: z.boolean().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      try {
        return await pmv2ChecklistService.updateChecklist(
          input,
          actorFromContext(ctx),
        );
      } catch (error) {
        return toTrpcError(error);
      }
    }),

  items: router({
    // Preview only; manual field edits are saved separately when the item is created.
    translateTitle: pmv2ManagementProcedure
      .input(z.object({ title: z.string().trim().min(1).max(300) }).strict())
      .mutation(async ({ input, ctx }) => {
        const actor = ctx.authenticatedUser ?? ctx.user;
        if (actor.isActive !== 1 || !canManagePmv2Foundation(actor.role)) {
          throw new TRPCError({ code: "FORBIDDEN", message: "ليس لديك صلاحية لترجمة المهمة" });
        }
        try {
          return await translatePmv2TaskTitle(input.title);
        } catch {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "تعذرت الترجمة. يرجى المحاولة مجددًا أو كتابة الترجمة يدويًا" });
        }
      }),
    list: pmv2ManagementProcedure
      .input(
        z.object({
          checklistId: z.number().int().positive(),
          includeInactive: z.boolean().optional(),
        }),
      )
      .query(({ input }) =>
        pmv2ChecklistService.listItems(
          input.checklistId,
          input.includeInactive ?? false,
        ),
      ),

    create: pmv2ManagementProcedure
      .input(
        z.object({
          checklistId: z.number().int().positive(),
          title: z.string().trim().min(1).max(300),
          sortOrder: z.number().int().min(0).optional(),
          isRequired: z.boolean().optional(),
          isActive: z.boolean().optional(),
          frequency: frequencySchema,
          frequencyValue: optionalNullablePositiveInt,
          weekday: optionalNullableWeekday,
          monthDay: optionalNullableMonthDay,
          anchorDate: optionalNullableDate,
          scheduleConfigJson: optionalNullableScheduleConfig,
        }),
      )
      .mutation(async ({ input, ctx }) => {
        try {
          return await pmv2ChecklistService.createItem(
            input,
            actorFromContext(ctx),
          );
        } catch (error) {
          return toTrpcError(error);
        }
      }),

    update: pmv2ManagementProcedure
      .input(
        z.object({
          id: z.number().int().positive(),
          title: z.string().trim().min(1).max(300).optional(),
          sortOrder: z.number().int().min(0).optional(),
          isRequired: z.boolean().optional(),
          isActive: z.boolean().optional(),
          frequency: frequencySchema.optional(),
          frequencyValue: optionalNullablePositiveInt,
          weekday: optionalNullableWeekday,
          monthDay: optionalNullableMonthDay,
          anchorDate: optionalNullableDate,
          scheduleConfigJson: optionalNullableScheduleConfig,
        }),
      )
      .mutation(async ({ input, ctx }) => {
        try {
          return await pmv2ChecklistService.updateItem(
            input,
            actorFromContext(ctx),
          );
        } catch (error) {
          return toTrpcError(error);
        }
      }),
  }),
});

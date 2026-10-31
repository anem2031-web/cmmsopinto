import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { router } from "../_shared/procedures";
import {
  Pmv2TechnicianAccessError,
  pmv2TechnicianReadService,
} from "../../pmv2/technician/read-service";
import { pmv2TechnicianProcedure } from "../../pmv2/security/procedures";
import { localizeMasterDataReferences } from "../../services/translation/localizedMasterData";
import type { SupportedLanguage } from "../../services/translation/translation";
import {
  Pmv2MaterialFlowError,
  pmv2MaterialRequestService,
} from "../../pmv2/materials/request-service";
import { Pmv2TeamIssueHandoffError, pmv2TeamIssueHandoffService } from "../../pmv2/materials/team-issue-handoff-service";
import { pmv2TechnicianMaterialAttentionService } from "../../pmv2/materials/technician-attention-service";
import { pmv2TechnicianMaterialSelfService } from "../../pmv2/materials/technician-self-service";
import { pmv2TaskTimelineService } from "../../pmv2/tracking/timeline-service";
import { Pmv2TicketHandoffError, pmv2TicketHandoffService } from "../../pmv2/tickets/handoff-service";
import {
  Pmv2TechnicianLeaderRequiredError,
  Pmv2TechnicianTransitionError,
  pmv2TechnicianExecutionService,
} from "../../pmv2/technician/execution-service";

function mapTechnicianError(error: unknown): never {
  if (error instanceof Pmv2TechnicianAccessError) {
    throw new TRPCError({ code: "NOT_FOUND", message: error.message });
  }
  if (error instanceof Pmv2TechnicianLeaderRequiredError) {
    throw new TRPCError({ code: "FORBIDDEN", message: error.message });
  }
  if (error instanceof Pmv2TechnicianTransitionError || error instanceof Pmv2MaterialFlowError || error instanceof Pmv2TeamIssueHandoffError || error instanceof Pmv2TicketHandoffError) {
    throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
  }
  throw error;
}

/** Phase 3 technician task surface: read, start execution, and Core PM V2 result recording. */
export const pmv2TechnicianRouter = router({
  workspace: pmv2TechnicianProcedure.query(async ({ ctx }) =>
    localizeMasterDataReferences(await pmv2TechnicianReadService.listWorkspaceTasks(ctx.user.id), (ctx.user.preferredLanguage || "ar") as SupportedLanguage),
  ),
  today: pmv2TechnicianProcedure.query(async ({ ctx }) =>
    localizeMasterDataReferences(
      await pmv2TechnicianReadService.listTodayTasks(ctx.user.id),
      (ctx.user.preferredLanguage || "ar") as SupportedLanguage,
    ),
  ),

  materialAttention: pmv2TechnicianProcedure.query(({ ctx }) =>
    pmv2TechnicianMaterialAttentionService.list(ctx.user.id),
  ),

  items: pmv2TechnicianProcedure
    .input(z.object({ taskId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      try {
        return await pmv2TechnicianReadService.listTaskItems(ctx.user.id, input.taskId);
      } catch (error) {
        mapTechnicianError(error);
      }
    }),

  ticketHandoffContext: pmv2TechnicianProcedure
    .input(z.object({ taskItemId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      try {
        const context = await pmv2TicketHandoffService.getCreateContext(ctx.user.id, input.taskItemId);
        const { readPmv2TicketReferences } = await import("../../_core/authz/technician-resources");
        return { ...context, references: ctx.user.role === "technician" ? await readPmv2TicketReferences(context, (ctx.user.preferredLanguage || "ar") as SupportedLanguage) : undefined };
      } catch (error) {
        mapTechnicianError(error);
      }
    }),

  evidence: pmv2TechnicianProcedure
    .input(z.object({
      taskId: z.number().int().positive(),
      taskItemId: z.number().int().positive(),
    }))
    .query(async ({ ctx, input }) => {
      try {
        return await pmv2TechnicianReadService.getItemEvidence(ctx.user.id, input.taskId, input.taskItemId);
      } catch (error) {
        mapTechnicianError(error);
      }
    }),

  materialCatalog: pmv2TechnicianProcedure
    .input(z.object({
      taskId: z.number().int().positive(),
      taskItemId: z.number().int().positive(),
      search: z.string().trim().max(100).optional(),
    }))
    .query(async ({ ctx, input }) => {
      try {
        return await pmv2MaterialRequestService.searchCatalog(
          ctx.user.id,
          input.taskId,
          input.taskItemId,
          input.search,
        );
      } catch (error) {
        mapTechnicianError(error);
      }
    }),

  completionMaterials: pmv2TechnicianProcedure
    .input(z.object({
      taskId: z.number().int().positive(),
      taskItemId: z.number().int().positive(),
    }))
    .query(async ({ ctx, input }) => {
      try {
        return await pmv2TeamIssueHandoffService.listCompletionMaterials(
          ctx.user.id, input.taskId, input.taskItemId,
        );
      } catch (error) {
        mapTechnicianError(error);
      }
    }),

  materialState: pmv2TechnicianProcedure
    .input(z.object({
      taskId: z.number().int().positive(),
      taskItemId: z.number().int().positive(),
    }))
    .query(async ({ ctx, input }) => {
      try {
        return await pmv2MaterialRequestService.getItemMaterialState(
          ctx.user.id,
          input.taskId,
          input.taskItemId,
        );
      } catch (error) {
        mapTechnicianError(error);
      }
    }),

  readyMaterialReceipts: pmv2TechnicianProcedure
    .input(z.object({
      taskId: z.number().int().positive(),
      taskItemId: z.number().int().positive(),
    }))
    .query(async ({ ctx, input }) => {
      try {
        return await pmv2TeamIssueHandoffService.listTechnicianReadyReceipts(
          ctx.user.id, input.taskId, input.taskItemId,
        );
      } catch (error) {
        mapTechnicianError(error);
      }
    }),

  submitMaterialNeed: pmv2TechnicianProcedure
    .input(z.object({
      taskId: z.number().int().positive(),
      taskItemId: z.number().int().positive(),
      catalogItemId: z.number().int().positive().nullable(),
      unlistedItemName: z.string().trim().max(300).optional(),
      quantity: z.number().positive(),
      unit: z.string().trim().max(50).optional(),
    }).superRefine((value, ctx) => {
      if (value.catalogItemId == null && !value.unlistedItemName?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["unlistedItemName"],
          message: "اسم المادة غير الموجودة في الدليل مطلوب",
        });
      }
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await pmv2MaterialRequestService.submitMaterialNeed(ctx.user.id, input, {
          ipAddress: ctx.req.ip,
          userAgent: ctx.req.headers["user-agent"],
        });
      } catch (error) {
        mapTechnicianError(error);
      }
    }),

  submitAndReceiveMaterialNeed: pmv2TechnicianProcedure
    .input(z.object({
      taskId: z.number().int().positive(),
      taskItemId: z.number().int().positive(),
      catalogItemId: z.number().int().positive(),
      quantity: z.number().positive(),
      unit: z.string().trim().min(1).max(50),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await pmv2TechnicianMaterialSelfService.submitAndReceive(ctx.user.id, input, {
          ipAddress: ctx.req.ip,
          userAgent: ctx.req.headers["user-agent"],
        });
      } catch (error) {
        mapTechnicianError(error);
      }
    }),

  receiveReadyMaterial: pmv2TechnicianProcedure
    .input(z.object({
      routeDecisionActionId: z.number().int().positive(),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await pmv2TeamIssueHandoffService.issueReadyRequirementToSelf(ctx.user.id, input, {
          ipAddress: ctx.req.ip,
          userAgent: ctx.req.headers["user-agent"],
        });
      } catch (error) {
        mapTechnicianError(error);
      }
    }),

  visitState: pmv2TechnicianProcedure
    .input(z.object({ taskId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      try {
        return await pmv2TechnicianReadService.getVisitState(ctx.user.id, input.taskId);
      } catch (error) {
        mapTechnicianError(error);
      }
    }),

  timeline: pmv2TechnicianProcedure
    .input(z.object({ taskId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      try {
        return await pmv2TaskTimelineService.getForTechnician(ctx.user.id, input.taskId);
      } catch (error) {
        mapTechnicianError(error);
      }
    }),

  resumeItem: pmv2TechnicianProcedure
    .input(z.object({
      taskId: z.number().int().positive(),
      taskItemId: z.number().int().positive(),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await pmv2TechnicianExecutionService.resumeItem(ctx.user.id, input, {
          ipAddress: ctx.req.ip,
          userAgent: ctx.req.headers["user-agent"],
        });
      } catch (error) {
        mapTechnicianError(error);
      }
    }),

  startItem: pmv2TechnicianProcedure
    .input(z.object({
      taskId: z.number().int().positive(),
      taskItemId: z.number().int().positive(),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await pmv2TechnicianExecutionService.startItem(ctx.user.id, input, {
          ipAddress: ctx.req.ip,
          userAgent: ctx.req.headers["user-agent"],
        });
      } catch (error) {
        mapTechnicianError(error);
      }
    }),


  endVisit: pmv2TechnicianProcedure
    .input(z.object({ taskId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await pmv2TechnicianExecutionService.endVisit(ctx.user.id, input, {
          ipAddress: ctx.req.ip,
          userAgent: ctx.req.headers["user-agent"],
        });
      } catch (error) {
        mapTechnicianError(error);
      }
    }),

  submitBasicResult: pmv2TechnicianProcedure
    .input(z.object({
      taskId: z.number().int().positive(),
      taskItemId: z.number().int().positive(),
      result: z.enum(["ok", "fixed"]),
      note: z.string().trim().max(2000).optional(),
      materialUsages: z.array(z.object({
        catalogItemId: z.number().int().positive(),
        usedQuantity: z.number().min(0),
        physicalUsages: z.array(z.object({ deliveryDocumentId:z.number().int().positive(),usedQuantity:z.number().min(0) })).max(500).optional(),
      })).max(30).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await pmv2TechnicianExecutionService.submitBasicResult(ctx.user.id, input, {
          ipAddress: ctx.req.ip,
          userAgent: ctx.req.headers["user-agent"],
        });
      } catch (error) {
        mapTechnicianError(error);
      }
    }),

  submitDependencyResult: pmv2TechnicianProcedure
    .input(z.object({
      taskId: z.number().int().positive(),
      taskItemId: z.number().int().positive(),
      result: z.enum(["needs_material", "needs_ticket"]),
      note: z.string().trim().max(2000).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await pmv2TechnicianExecutionService.submitDependencyResult(ctx.user.id, input, {
          ipAddress: ctx.req.ip,
          userAgent: ctx.req.headers["user-agent"],
        });
      } catch (error) {
        mapTechnicianError(error);
      }
    }),
});

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "../_shared/procedures";
import { canReadSpecificationReturns, canReviewPurchaseSpecifications, specificationDecisionInput, specificationListInput } from "../../../shared/purchase-specifications";
import { PurchaseSpecificationsService, type PurchaseSpecificationPorts } from "../../services/purchase-specifications";

export function createPurchaseSpecificationsRouter(ports: PurchaseSpecificationPorts) {
  const service = new PurchaseSpecificationsService(ports);
  const review = protectedProcedure.use(({ ctx, next }) => {
    if (!canReviewPurchaseSpecifications(ctx.user)) throw new TRPCError({ code: "FORBIDDEN" });
    return next({ ctx });
  });
  const returns = protectedProcedure.use(({ ctx, next }) => {
    if (!canReadSpecificationReturns(ctx.user)) throw new TRPCError({ code: "FORBIDDEN" });
    return next({ ctx });
  });
  return router({
    status: protectedProcedure.query(({ ctx }) => service.status(ctx.user)),
    list: review.input(specificationListInput).query(({ ctx, input }) => service.list(ctx.user, input)),
    decide: review.input(specificationDecisionInput).mutation(({ ctx, input }) => service.decide(ctx.user, input)),
    rejectedReturns: returns.input(specificationListInput).query(({ ctx, input }) => service.rejectedReturns(ctx.user, input)),
    rejectedReturnSource: returns.input(z.object({ id: z.number().int().positive() })).query(({ ctx, input }) => service.rejectedReturnSource(ctx.user, input.id)),
  });
}

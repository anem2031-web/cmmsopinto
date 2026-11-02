import { z } from "zod";
import { router, approvedPricingDocumentProcedure } from "../../_core/trpc";
import { documentListPageInput } from "../../../shared/document-list";
import { ApprovedPricingDocumentReader } from "../../services/delegate-pricing-bundles/approved-reader";
import type { PricingBundlePorts } from "../../services/delegate-pricing-bundles/service";

export function createApprovedPricingDocumentsRouter(ports: Pick<PricingBundlePorts, "database" | "render" | "signature">, enabled: () => boolean) {
  const reader = new ApprovedPricingDocumentReader(ports, enabled);
  return router({
    listPage: approvedPricingDocumentProcedure.input(documentListPageInput).query(({ctx,input}) => reader.listPage(ctx.user,input)),
    pdf: approvedPricingDocumentProcedure.input(z.object({id:z.number().int().positive()})).mutation(({ctx,input}) => reader.pdf(ctx.user,input.id)),
  });
}

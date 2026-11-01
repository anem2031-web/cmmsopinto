import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, accountantProcedure, managementProcedure } from "../_shared/procedures";
import { canReadPricingBundles } from "../../../shared/delegate-pricing-bundles";
import { PricingBundleService, type PricingBundlePorts } from "../../services/delegate-pricing-bundles/service";
import { documentListPageInput } from "@shared/document-list";
import { UnifiedBundleApprovalService } from "../../services/delegate-pricing-bundles/unified-approval";
const id = z.number().int().positive();
export function createPricingBundlesRouter(ports: PricingBundlePorts, enabled: () => boolean) {
  const service = new PricingBundleService(ports);
  const unified = ports.unified ? new UnifiedBundleApprovalService(ports.unified) : null;
  const approvalAvailable=()=>{available();if(!unified||!ports.unified?.enabled())throw new TRPCError({code:'PRECONDITION_FAILED',message:'اعتماد DPB الموحد غير مفعّل'});return unified;};
  const approvalInput=z.object({id,revision:z.number().int().nonnegative(),operationKey:z.string().uuid(),custodyBalance:z.string().trim().max(40).optional(),notes:z.string().max(4000).optional(),
    rejections:z.array(z.object({itemId:id,reason:z.string().trim().min(10).max(2000)})).max(20).default([])});
  const available = () => { if (!enabled()) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "حزم التسعير غير مفعلة حاليًا" }); };
  return router({
    status: protectedProcedure.query(({ ctx }) => { if (!canReadPricingBundles(ctx.user)) throw new TRPCError({ code: "FORBIDDEN" }); return { enabled: enabled(),...(enabled()&&ports.unified?.enabled()?{approvalEnabled:true}:{}) }; }),
    approvalQueue: protectedProcedure.input(z.object({afterId:z.number().int().nonnegative().optional()}).optional()).query(({ctx,input})=>{
      if(!['owner','admin','accountant','senior_management'].includes(ctx.user.role)||Number(ctx.user.isActive)!==1)throw new TRPCError({code:'FORBIDDEN'});
      if(!enabled()||!ports.unified?.enabled())return {items:[],nextId:null};return approvalAvailable().queue(ctx.user,input?.afterId);
    }),
    approvalDetail: protectedProcedure.input(z.object({id})).query(({ctx,input})=>approvalAvailable().detail(ctx.user,input.id)),
    approveAccounting: accountantProcedure.input(approvalInput).mutation(({ctx,input})=>approvalAvailable().approve(ctx.user,'accounting',input)),
    approveManagement: managementProcedure.input(approvalInput.omit({custodyBalance:true})).mutation(({ctx,input})=>approvalAvailable().approve(ctx.user,'management',input)),
    list: protectedProcedure.query(({ ctx }) => { if (!canReadPricingBundles(ctx.user)) throw new TRPCError({ code: "FORBIDDEN" }); return enabled() ? service.list(ctx.user) : []; }),
    listPage: protectedProcedure.input(documentListPageInput).query(({ ctx, input }) => {
      if (!canReadPricingBundles(ctx.user)) throw new TRPCError({ code: "FORBIDDEN" });
      if (!enabled()) return { rows: [], total: 0, count: 0, page: 1, pageSize: input.pageSize, delegates: [] };
      return service.listPage(ctx.user, input);
    }),
    detail: protectedProcedure.input(z.object({ id })).query(({ ctx, input }) => { available(); return service.detail(ctx.user, input.id); }),
    add: protectedProcedure.input(z.object({ itemId: id })).mutation(({ ctx, input }) => { available(); return service.add(ctx.user, input.itemId); }),
    remove: protectedProcedure.input(z.object({ id, itemId: id })).mutation(({ ctx, input }) => { available(); return service.remove(ctx.user, input.id, input.itemId); }),
    send: protectedProcedure.input(z.object({ id, revision: z.number().int().nonnegative() })).mutation(({ ctx, input }) => { available(); return service.send(ctx.user, input.id, input.revision); }),
    retrySync: protectedProcedure.input(z.object({ id })).mutation(({ ctx, input }) => { available(); return service.finish(ctx.user, input.id); }),
    pdf: protectedProcedure.input(z.object({ id, approvedDocument: z.boolean().optional() })).mutation(({ ctx, input }) => { available(); return service.pdf(ctx.user, input.id, input.approvedDocument); }),
    archive: protectedProcedure.input(z.object({ id })).mutation(({ ctx, input }) => { available(); return service.archive(ctx.user, input.id); }),
  });
}

import { z } from "zod";
import { warehouseLotSelectionSchema } from "../../../shared/warehouse-lot-selection";
import { sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, warehouseProcedure } from "../_shared/procedures";
import { OperationalIssueService, type OperationalPorts } from "../../services/operational-issues/service";
import { canReadOperationalIssue, type OperationalActor } from "../../../shared/operational-issues";
import { executionRows } from "../../services/operational-issues/issue-reference";
import { canUseOperationalCatalog, preparedCreateSchema, preparedIssueSchema } from "../../../shared/operational-dispatch";
import { createPrepared, issuePrepared, preparedActor, preparedReady, preparedStockChoices, preparedSelection } from "../../services/operational-issues/prepared";
const id = z.number().int().positive();
const quantity = z.number().int("كمية الصرف التشغيلي يجب أن تكون عددًا صحيحًا").positive().max(2_147_483_647);
export function createOperationalIssuesRouter(ports: OperationalPorts, enabled: () => boolean) {
  const service = new OperationalIssueService(ports);
  const available = () => { if (!enabled()) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "الصرف التشغيلي غير متاح حاليًا" }); };
  const read = (actor: OperationalActor) => { if (actor.isActive !== 1 || !canReadOperationalIssue(actor.role)) throw new TRPCError({ code: "FORBIDDEN" }); };
  return router({
    preparationOptions: protectedProcedure.query(async ({ ctx }) => {
      available(); preparedActor(ctx.user, "create"); const db = await ports.database();
      const ready = await preparedReady(db);
      const warehouses = await executionRows(db, sql`SELECT id,nameAr,nameEn FROM warehouses WHERE isActive=1 ORDER BY id`) as Array<{ id: number; nameAr: string; nameEn: string | null }>;
      const sites = await executionRows(db, sql`SELECT id,name FROM sites ORDER BY name`) as Array<{ id: number; name: string }>;
      const sections = await executionRows(db, sql`SELECT id,siteId,name FROM sections ORDER BY name`) as Array<{ id: number; siteId: number; name: string }>;
      return { ready, warehouses, sites, sections };
    }),
    stockChoices: protectedProcedure.input(z.object({ warehouseId: id, search: z.string().max(200).default(""), afterId: z.number().int().nonnegative().default(0) })).query(({ ctx,input }) => {
      available(); return preparedStockChoices(ports, ctx.user,input);
    }),
    createPrepared: protectedProcedure.input(preparedCreateSchema).mutation(({ ctx,input }) => { available(); return createPrepared(ports,ctx.user,input); }),
    preparedSelection: protectedProcedure.input(z.object({ warehouseId: id, catalogItemIds: z.array(id).min(1).max(20) })).query(({ ctx,input }) => { available(); return preparedSelection(ports,ctx.user,input.warehouseId,input.catalogItemIds); }),
    issuePrepared: warehouseProcedure.input(preparedIssueSchema).mutation(({ ctx,input }) => { available(); return issuePrepared(ports,ctx.user,input); }),
    status: protectedProcedure.query(({ ctx }) => { read(ctx.user); return { enabled: enabled() }; }),
    list: protectedProcedure.query(async ({ ctx }) => { read(ctx.user); return { enabled: enabled(), orders: enabled() ? await service.list(ctx.user) : [] }; }),
    detail: protectedProcedure.input(z.object({ id })).query(({ ctx, input }) => { read(ctx.user); available(); return service.detail(ctx.user, input.id); }),
    availability: protectedProcedure.input(z.object({ id })).query(({ ctx, input }) => { read(ctx.user); available(); return service.availability(ctx.user, input.id); }),
    addToPurchaseDraft: warehouseProcedure.input(z.object({ orderId: id, itemId: id })).mutation(({ ctx, input }) => { available(); return service.addToPurchaseDraft(ctx.user, input.orderId, input.itemId); }),
    itemUnits: protectedProcedure.input(z.object({ catalogItemIds: z.array(id).min(1).max(20) })).query(({ ctx, input }) => { read(ctx.user); available(); return service.itemUnits(ctx.user, input.catalogItemIds); }),
    choices: protectedProcedure.query(async ({ ctx }) => {
      read(ctx.user); if (!enabled()) return { collectors: [] as Array<{ id: number; name: string }> };
      return { collectors: await executionRows(await ports.database(), sql`SELECT id,name FROM users WHERE isActive=1 AND role='technician' ORDER BY name`) as Array<{ id: number; name: string }> };
    }),
    create: protectedProcedure.input(z.object({ siteId: id, sectionId: id, collectorId: id, reason: z.string().trim().min(1).max(2000), operationKey: z.string().min(1).max(120), items: z.array(z.object({ catalogItemId: id, quantity, unit: z.string().trim().min(1).max(50) })).min(1).max(20) }))
      .mutation(({ ctx, input }) => { available(); if (!canUseOperationalCatalog(ctx.user.role)) throw new TRPCError({ code: "FORBIDDEN", message: "استخدم نموذج الإنشاء من المخزون" }); return service.create(ctx.user, input); }),
    approve: warehouseProcedure.input(z.object({ id, revision: z.number().int().nonnegative() })).mutation(({ ctx, input }) => { available(); return service.approve(ctx.user, input.id, input.revision); }),
    issue: warehouseProcedure.input(z.object({ orderId: id, itemId: id, warehouseId: id, lotTrackingToken: z.string().trim().min(1).optional(), quantity, operationKey: z.string().min(1).max(120), selection:warehouseLotSelectionSchema.optional() }))
      .mutation(({ ctx, input }) => { available(); return service.issue(ctx.user, input); }),
    returnMaterial: warehouseProcedure.input(z.object({ orderId: id, deliveryDocumentId: id, quantity: z.number().int().positive(), reason: z.string().trim().min(1).max(2000), operationKey: z.string().min(1).max(120) }))
      .mutation(({ ctx, input }) => { available(); return service.returnMaterial(ctx.user, input); }),
  });
}

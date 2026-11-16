import { TRPCError } from "@trpc/server";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { users } from "../../../drizzle/schema";
import { getDb } from "../../_core/db/client";
import { pmv2WarehouseProcedure, pmv2WarehouseReadProcedure } from "../../pmv2/security/procedures";
import { issuePscmFulfillment } from "../../services/pscm/fulfillment-issue";
import { listPscmReady } from "../../services/pscm/fulfillment-read";
import { router } from "../_shared/procedures";

const id = z.number().int().min(1).max(2_147_483_647);
function active(user: { isActive?: number | null }) {
  if (user.isActive !== 1) throw new TRPCError({ code: "FORBIDDEN" });
}

export const pscmFulfillmentRouter = router({
  ready: pmv2WarehouseReadProcedure.input(z.object({ after: id.optional() }).optional()).query(({ ctx, input }) => {
    active(ctx.user);
    return listPscmReady(ctx.user, input?.after);
  }),
  recipients: pmv2WarehouseProcedure.query(async ({ ctx }) => {
    active(ctx.user);
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE" });
    return db.select({ id: users.id, name: users.name }).from(users)
      .where(and(eq(users.role, "technician"), eq(users.isActive, 1))).orderBy(asc(users.name), asc(users.id));
  }),
  issue: pmv2WarehouseProcedure.input(z.strictObject({
    purchaseOrderItemId: id,
    lotId: id,
    quantity: id,
    deliveredToId: id,
    operationKey: z.string().uuid(),
  })).mutation(({ ctx, input }) => {
    active(ctx.user);
    return issuePscmFulfillment(input, ctx.user.id);
  }),
});

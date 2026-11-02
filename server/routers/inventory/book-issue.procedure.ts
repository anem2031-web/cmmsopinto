import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { adminOwnerProcedure } from "../_shared/procedures";
import { sql } from "drizzle-orm";
import { isOwnerOrAdminRole } from "../../../shared/restricted-module-policy";
import { issueCostAllocationsSchema } from "./issue-cost-allocation.schema";
import { issueInventoryBook } from "../../services/inventory-book-issue";
import { isInventoryLotsEnabled } from "../../_core/inventory-lots";

export const inventoryDeliveryInput = z.object({
  inventoryId: z.number(),
  deliveredToId: z.number(),
  deliveryQty: z.number().positive(),
  deliveryUnit: z.string().min(1, "الوحدة مطلوبة"),
  lotTrackingToken: z.string().trim().min(1).optional(),
  costAllocations: issueCostAllocationsSchema.optional(),
  notes: z.string().optional(),
});
export function createBookIssueProcedure(
  getDatabase: () => Promise<any>,
  deliverLine: (
    input: any,
    ctx: any,
    tx: any,
    afterCommit: Array<() => Promise<any>>,
    marked: Set<number>
  ) => Promise<any>,
  finishLine?: (snapshot: any, ctx: any) => Promise<any>,
  lotsEnabled: () => boolean = isInventoryLotsEnabled
) {
  return adminOwnerProcedure
    .input(
      inventoryDeliveryInput
        .omit({ inventoryId: true, lotTrackingToken: true })
        .extend({
          catalogItemId: z.number().int().positive(),
          warehouseId: z.number().int().positive(),
          operationKey: z.string().uuid(),
        })
    )
    .mutation(async ({ input, ctx }) => {
      const actor = ctx.authenticatedUser ?? ctx.user;
      if (Number(actor.isActive) !== 1)
        throw new TRPCError({ code: "FORBIDDEN", message: "الحساب غير نشط" });
      if (!isOwnerOrAdminRole(actor.role))
        throw new TRPCError({ code: "FORBIDDEN", message: "الصرف من دفتر المخزون متاح للمالك ومدير النظام فقط" });
      if (!lotsEnabled())
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "الصرف من الدفتر يتطلب تفعيل تتبع اللوتات",
        });
      const database = await getDatabase();
      if (!database) throw Error("تعذر الاتصال بقاعدة البيانات");
      const markedPurchaseItems = new Set<number>();
      return issueInventoryBook(
        database,
        input,
        actor.id,
        (line, tx, callbacks) =>
          deliverLine(line, ctx, tx, callbacks, markedPurchaseItems),
        finishLine ? snapshot => finishLine(snapshot, ctx) : undefined,
        async tx => {
          const [users] = await tx.execute(sql`SELECT id,role,isActive FROM users WHERE id=${actor.id} LIMIT 1 FOR UPDATE`);
          const current = users[0];
          if (!current || Number(current.id) !== actor.id || Number(current.isActive) !== 1 || !isOwnerOrAdminRole(current.role)) {
            throw new TRPCError({ code: "FORBIDDEN", message: "الصرف من دفتر المخزون متاح للمالك ومدير النظام فقط" });
          }
        }
      );
    });
}

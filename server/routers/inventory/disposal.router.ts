import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, warehouseProcedure } from "../_shared/procedures";
import * as db from "../../_core/db";

export const disposalRouter = router({

  // ── إنشاء عملية استبعاد جديدة ──────────────────────────────
  create: warehouseProcedure
    .input(z.object({
      operationDate: z.string().min(1, "تاريخ العملية مطلوب"),
      warehouseId:   z.number().optional(),
      notes:         z.string().optional(),
      items: z.array(z.object({
        inventoryId:  z.number(),
        quantity:     z.number().positive("الكمية يجب أن تكون أكبر من صفر"),
        reason:       z.enum(["damaged", "expired", "missing", "other"]),
        unitCost:     z.number().min(0).default(0),
        totalCost:    z.number().min(0).default(0),
        attachments:  z.array(z.string()).optional(),
        notes:        z.string().optional(),
      })).min(1, "يجب إضافة صنف واحد على الأقل"),
    }))
    .mutation(async ({ input, ctx }) => {
      try {
        const result = await db.createDisposal({
          operationDate: input.operationDate,
          warehouseId:   input.warehouseId,
          notes:         input.notes,
          createdBy:     ctx.user.id,
          items:         input.items.map(i => ({
            inventoryId:  i.inventoryId,
            quantity:     i.quantity,
            reason:       i.reason,
            unitCost:     i.unitCost,
            totalCost:    i.totalCost,
            attachments:  i.attachments ? JSON.stringify(i.attachments) : undefined,
            notes:        i.notes,
          })),
        });
        return result;
      } catch (err: any) {
        throw new TRPCError({ code: "BAD_REQUEST", message: err.message });
      }
    }),

  // ── قائمة عمليات الاستبعاد ──────────────────────────────────
  list: protectedProcedure.query(async () => {
    return db.listDisposalOperations();
  }),

  // ── تفاصيل عملية واحدة ──────────────────────────────────────
  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const op = await db.getDisposalById(input.id);
      if (!op) throw new TRPCError({ code: "NOT_FOUND", message: "العملية غير موجودة" });
      return op;
    }),

});

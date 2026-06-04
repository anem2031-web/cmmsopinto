import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, managerProcedure } from "../_shared/procedures";
import * as db from "../../db";

// Vendor management
export const vendorsRouter = router({
  list: protectedProcedure.query(async () => {
    return db.getAllVendors();
  }),

  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const vendor = await db.getVendorById(input.id);
      if (!vendor) throw new TRPCError({ code: "NOT_FOUND", message: "المورد غير موجود" });
      return vendor;
    }),

  create: managerProcedure
    .input(z.object({
      name: z.string().min(1),
      contactPerson: z.string().optional(),
      phone: z.string().optional(),
      email: z.string().optional(),
      address: z.string().optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const id = await db.createVendor(input);
      await db.createAuditLog({ userId: ctx.user.id, action: "create_vendor", entityType: "vendor", entityId: id! });
      return { id };
    }),

  update: managerProcedure
    .input(z.object({
      id: z.number(),
      name: z.string().optional(),
      contactPerson: z.string().optional(),
      phone: z.string().optional(),
      email: z.string().optional(),
      address: z.string().optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const { id, ...data } = input;
      await db.updateVendor(id, data);
      await db.createAuditLog({ userId: ctx.user.id, action: "update_vendor", entityType: "vendor", entityId: id });
      return { success: true };
    }),

  delete: managerProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      await db.deleteVendor(input.id);
      await db.createAuditLog({ userId: ctx.user.id, action: "delete_vendor", entityType: "vendor", entityId: input.id });
      return { success: true };
    }),
});

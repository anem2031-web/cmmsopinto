import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { router, protectedProcedure } from "../_shared/procedures";
import * as db from "../../db";

export const techniciansRouter = router({
  list: protectedProcedure.input(z.object({ activeOnly: z.boolean().optional() }).optional()).query(async ({ input }) => {
    return db.getAllTechnicians(input?.activeOnly ?? false);
  }),

  create: protectedProcedure.input(z.object({
    name: z.string().min(1),
    specialty: z.string().optional(),
  })).mutation(async ({ input, ctx }) => {
    // Auto-translate name and specialty
    let techNameEn: string | undefined;
    let techNameUr: string | undefined;
    let techSpecialtyEn: string | undefined;
    let techSpecialtyUr: string | undefined;
    try {
      const fieldsToTranslate: Record<string, string> = { name: input.name };
      if (input.specialty) fieldsToTranslate.specialty = input.specialty;
      const translations = await translateFields(fieldsToTranslate);
      techNameEn = translations.name?.en;
      techNameUr = translations.name?.ur;
      techSpecialtyEn = translations.specialty?.en;
      techSpecialtyUr = translations.specialty?.ur;
    } catch (e) { /* fallback */ }
    const id = await db.createTechnician({ ...input, nameEn: techNameEn, nameUr: techNameUr, specialtyEn: techSpecialtyEn, specialtyUr: techSpecialtyUr });
    await db.createAuditLog({ userId: ctx.user.id, action: "create_technician", entityType: "technician", entityId: id!, newValues: input });
    return { id };
  }),

  update: protectedProcedure.input(z.object({
    id: z.number(),
    name: z.string().min(1).optional(),
    specialty: z.string().optional(),
    status: z.enum(["active", "inactive"]).optional(),
  })).mutation(async ({ input, ctx }) => {
    const { id, ...updateData } = input;
    let techExtraFields: { nameEn?: string; nameUr?: string; specialtyEn?: string; specialtyUr?: string } = {};
    if (updateData.name || updateData.specialty) {
      try {
        const fieldsToTranslate: Record<string, string> = {};
        if (updateData.name) fieldsToTranslate.name = updateData.name;
        if (updateData.specialty) fieldsToTranslate.specialty = updateData.specialty;
        const translations = await translateFields(fieldsToTranslate);
        if (updateData.name) { techExtraFields.nameEn = translations.name?.en; techExtraFields.nameUr = translations.name?.ur; }
        if (updateData.specialty) { techExtraFields.specialtyEn = translations.specialty?.en; techExtraFields.specialtyUr = translations.specialty?.ur; }
      } catch (e) { /* fallback */ }
    }
    await db.updateTechnician(id, { ...updateData, ...techExtraFields });
    await db.createAuditLog({ userId: ctx.user.id, action: "update_technician", entityType: "technician", entityId: id, newValues: updateData });
    return { success: true };
  }),

  delete: protectedProcedure.input(z.object({ id: z.number() })).mutation(async ({ input, ctx }) => {
    await db.deleteTechnician(input.id);
    await db.createAuditLog({ userId: ctx.user.id, action: "delete_technician", entityType: "technician", entityId: input.id });
    return { success: true };
  }),

  getOpenTicketCounts: protectedProcedure.query(async () => {
    return db.getTechnicianOpenTicketCounts();
  }),
});

import { z } from "zod";
import { protectedProcedure, warehouseProcedure, router } from "../_shared/procedures";
import * as db from "../../db";

export const deliveryDocumentsRouter = router({

  // حفظ بيانات الوثيقة عند التسليم (بدون PDF على السيرفر)
  generate: warehouseProcedure.input(z.object({
    deliveryNumber: z.string(),
    poItemId: z.number(),
    itemName: z.string(),
    deliveredByName: z.string(),
    deliveredToName: z.string(),
    quantity: z.number(),
    unit: z.string().optional(),
    supplierName: z.string().optional(),
    actualUnitCost: z.string().optional(),
    poNumber: z.string().optional(),
    warehousePhotoUrl: z.string().optional(),
    notes: z.string().optional(),
    deliveredAt: z.string(),
  })).mutation(async ({ input }) => {
    await db.createDeliveryDocument({
      deliveryNumber: input.deliveryNumber,
      poItemId: input.poItemId,
      itemName: input.itemName,
      deliveredByName: input.deliveredByName,
      deliveredToName: input.deliveredToName,
      quantity: input.quantity,
      unit: input.unit,
      supplierName: input.supplierName,
      actualUnitCost: input.actualUnitCost,
      poNumber: input.poNumber,
      warehousePhotoUrl: input.warehousePhotoUrl,
      notes: input.notes,
    });
    return { success: true };
  }),

  // جلب كل الوثائق للتبويب
  list: protectedProcedure.query(async () => {
    return db.getDeliveryDocuments();
  }),

  // رفع عداد الطباعة
  incrementPrint: protectedProcedure.input(z.object({ id: z.number() })).mutation(async ({ input }) => {
    const count = await db.incrementDeliveryDocPrintCount(input.id);
    return { printCount: count };
  }),
});

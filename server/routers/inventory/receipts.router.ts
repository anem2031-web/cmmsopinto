import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { router, protectedProcedure, warehouseProcedure } from "../_shared/procedures";
import * as db from "../../_core/db";

export const receiptsRouter = router({

  // جلب كل الفواتير
  list: warehouseProcedure.query(async () => {
    return db.listWarehouseReceipts();
  }),

  // جلب فاتورة بالـ ID
  getById: warehouseProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const receipt = await db.getWarehouseReceiptById(input.id);
      if (!receipt) throw new TRPCError({ code: "NOT_FOUND", message: "الفاتورة غير موجودة" });
      return receipt;
    }),

  // جلب فواتير طلب شراء معين
  getByPO: warehouseProcedure
    .input(z.object({ purchaseOrderId: z.number() }))
    .query(async ({ input }) => {
      return db.getWarehouseReceiptByPO(input.purchaseOrderId);
    }),

  // مسح الباركود للبحث عن صنف
  scanBarcode: warehouseProcedure
    .input(z.object({ code: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const item = await db.getInventoryByBarcode(input.code);
      if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "الصنف غير موجود في المخزون" });
      return item;
    }),

  // البحث في المخزون
  searchInventory: warehouseProcedure
    .input(z.object({ search: z.string().min(1) }))
    .query(async ({ input }) => {
      return db.getInventoryBySearch(input.search);
    }),

  // ✅ إصلاح حرج #4: هذا الإجراء (v1) كان لا يزال قابلاً للاستدعاء المباشر عبر API
  // رغم أن صفحته الأمامية (WarehouseReceive.tsx) أُعيد توجيهها لـ NotFound منذ
  // استبداله بـ receiveFromPurchaseV2. لا يحتوي على أي تحقق من ملكية الصنف لطلب
  // الشراء ولا معاملة ذرية (خلافاً لـ v2) — وهو ما تسبب سابقاً في انفصال ربط
  // سندات الاستلام عن بنود الطلب الحقيقية. عُطِّل هنا مباشرة بدل حذف الراوتر
  // بالكامل، لأن باقي إجراءات هذا الملف (scanBarcode وغيرها) لا تزال مستخدَمة
  // فعلياً من صفحات نشطة أخرى (WarehouseReturn.tsx).
  receiveFromPurchase: warehouseProcedure
    .input(z.object({
      purchaseOrderId: z.number(),
      notes: z.string().optional(),
      items: z.array(z.object({
        purchaseOrderItemId: z.number(),
        itemName: z.string().min(1),
        receivedQuantity: z.number().min(1),
        unit: z.string().min(1),
        manufacturerBarcode: z.string().optional(),
        // existing inventory item to add to, or create new
        inventoryId: z.number().optional(),
        supplierName: z.string().min(1),
        actualUnitCost: z.string().min(1),
        warehousePhotoUrl: z.string().min(1),
      })),
    }))
    .mutation(async () => {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "تم إيقاف هذا المسار نهائياً لعدم أمانه. الرجاء استخدام استلام الفاتورة (v2) بدلاً منه.",
      });
    }),

});


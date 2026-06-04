import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { router, warehouseProcedure } from "../_shared/procedures";
import * as db from "../../db";

export const returnsRouter = router({

  // جلب كل المرتجعات
  list: warehouseProcedure
    .input(z.object({
      purchaseOrderId: z.number().optional(),
      inventoryId: z.number().optional(),
    }).optional())
    .query(async ({ input }) => {
      return db.getWarehouseReturns(input);
    }),

  // البحث عن صنف للإرجاع
  search: warehouseProcedure
    .input(z.object({
      query: z.string().min(1),
    }))
    .query(async ({ input }) => {
      // البحث بـ internalCode أو manufacturerBarcode أو اسم الصنف
      return db.getInventoryBySearch(input.query);
    }),

  // إرجاع صنف للمندوب
  create: warehouseProcedure
    .input(z.object({
      receiptId: z.number(),
      purchaseOrderId: z.number(),
      purchaseOrderItemId: z.number(),
      inventoryId: z.number(),
      returnedQuantity: z.number().min(1),
      reason: z.string().min(1, "سبب الإرجاع مطلوب"),
    }))
    .mutation(async ({ input, ctx }) => {
      // التحقق من الفاتورة
      const receipt = await db.getWarehouseReceiptById(input.receiptId);
      if (!receipt) throw new TRPCError({ code: "NOT_FOUND", message: "فاتورة الاستلام غير موجودة" });

      // التحقق من المخزون
      const inventoryItem = await db.getInventoryItemById(input.inventoryId);
      if (!inventoryItem) throw new TRPCError({ code: "NOT_FOUND", message: "الصنف غير موجود في المخزون" });

      if (inventoryItem.quantity < input.returnedQuantity) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `الكمية المتاحة في المخزون ${inventoryItem.quantity} أقل من الكمية المُرجَعة`,
        });
      }

      // توليد رقم المرتجع
      const returnNumber = await db.getNextReturnNumber();

      // إنشاء المرتجع
      const returnId = await db.createWarehouseReturn({
        returnNumber,
        receiptId: input.receiptId,
        purchaseOrderId: input.purchaseOrderId,
        purchaseOrderItemId: input.purchaseOrderItemId,
        inventoryId: input.inventoryId,
        returnedQuantity: input.returnedQuantity,
        reason: input.reason,
        returnedById: ctx.user.id,
      });

      // تسجيل حركة خروج من المخزون
      await db.addInventoryTransaction({
        inventoryId: input.inventoryId,
        type: "out",
        quantity: input.returnedQuantity,
        reason: `إرجاع للمندوب - ${input.reason} - مرتجع ${returnNumber}`,
        purchaseOrderItemId: input.purchaseOrderItemId,
        performedById: ctx.user.id,
        transactionType: "return",
        receiptId: input.receiptId,
        returnId: returnId!,
      });

      // تحديث طلب الشراء - تحديث الكمية المُرجَعة
      const poItem = await db.getPOItemById(input.purchaseOrderItemId);
      if (poItem) {
        const newReturnedQty = (poItem.returnedQuantity || 0) + input.returnedQuantity;
        await db.updatePOItem(input.purchaseOrderItemId, {
          returnedQuantity: newReturnedQty,
          returnReason: input.reason,
          returnedAt: new Date(),
        });

        // تحديث حالة طلب الشراء إذا كانت received
        const po = await db.getPurchaseOrderById(input.purchaseOrderId);
        if (po && po.status === "received") {
          await db.updatePurchaseOrder(input.purchaseOrderId, {
            status: "partial_purchase",
          });
        }
      }

      // إشعارات للمدراء
      const po = await db.getPurchaseOrderById(input.purchaseOrderId);
      const managers = await db.getManagerUsers();
      for (const mgr of managers) {
        await db.createNotification({
          userId: mgr.id,
          title: `↩️ مرتجع ${returnNumber}`,
          message: `تم إرجاع ${input.returnedQuantity} ${inventoryItem.unit || "وحدة"} من "${inventoryItem.itemName}" - طلب الشراء ${po?.poNumber || input.purchaseOrderId}`,
          type: "warning",
          relatedPOId: input.purchaseOrderId,
        });
      }

      await db.createAuditLog({
        userId: ctx.user.id,
        action: "warehouse_return",
        entityType: "purchase_order",
        entityId: input.purchaseOrderId,
        newValues: { returnNumber, returnedQuantity: input.returnedQuantity, reason: input.reason },
      });

      return { returnId, returnNumber };
    }),
});

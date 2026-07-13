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

  // استلام من المشتريات وإضافة للمخزون
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
    .mutation(async ({ input, ctx }) => {
      const po = await db.getPurchaseOrderById(input.purchaseOrderId);
      if (!po) throw new TRPCError({ code: "NOT_FOUND", message: "طلب الشراء غير موجود" });

      // توليد رقم الفاتورة
      const receiptNumber = await db.getNextReceiptNumber();

      // إنشاء فاتورة الاستلام
      const receiptId = await db.createWarehouseReceipt({
        receiptNumber,
        purchaseOrderId: input.purchaseOrderId,
        receivedById: ctx.user.id,
        notes: input.notes,
        totalItems: input.items.length,
        status: "confirmed",
      });

      const inventoryIds: number[] = [];

      for (const item of input.items) {
        let inventoryId = item.inventoryId;

        if (inventoryId) {
          // إضافة للصنف الموجود
          await db.updateInventoryItem(inventoryId, {
            quantity: undefined, // يُحدَّث عبر transaction
            lastRestockedAt: new Date(),
          });
        } else {
          // إنشاء صنف جديد في المخزون
          const internalCode = await db.getNextInventoryCode();
          inventoryId = await db.createInventoryItem({
            itemName: item.itemName,
            quantity: 0, // يُحدَّث عبر transaction
            unit: item.unit,
            internalCode,
            manufacturerBarcode: item.manufacturerBarcode || null,
            receiptId: receiptId!,
          }) as number;
        }

        inventoryIds.push(inventoryId!);

        // تسجيل حركة دخول في inventory_transactions
        await db.addInventoryTransaction({
          inventoryId: inventoryId!,
          type: "in",
          quantity: item.receivedQuantity,
          reason: `استلام من طلب شراء ${po.poNumber} - فاتورة ${receiptNumber}`,
          purchaseOrderItemId: item.purchaseOrderItemId,
          performedById: ctx.user.id,
          transactionType: "purchase",
          receiptId: receiptId!,
        });

        // تحديث بيانات الصنف في طلب الشراء
        await db.updatePOItem(item.purchaseOrderItemId, {
          status: "delivered_to_warehouse",
          receivedAt: new Date(),
          receivedById: ctx.user.id,
          receivedQuantity: item.receivedQuantity,
          supplierName: item.supplierName,
          actualUnitCost: item.actualUnitCost,
          actualTotalCost: String(parseFloat(item.actualUnitCost) * item.receivedQuantity),
          warehousePhotoUrl: item.warehousePhotoUrl,
        });
      }

      // تحديث حالة طلب الشراء
      const allItems = await db.getPOItems(input.purchaseOrderId);
      const activeItems = allItems.filter((i: any) => i.status !== "rejected" && i.status !== "cancelled");
      const allInWarehouse = activeItems.every((i: any) =>
        ["delivered_to_warehouse", "delivered_to_requester"].includes(i.status)
      );

      if (allInWarehouse) {
        await db.updatePurchaseOrder(input.purchaseOrderId, { status: "received" });
      }

      // إشعارات
      const managers = await db.getManagerUsers();
      for (const mgr of managers) {
        await db.createNotification({
          userId: mgr.id,
          title: `📦 فاتورة استلام جديدة ${receiptNumber}`,
          message: `تم استلام ${input.items.length} صنف من طلب الشراء ${po.poNumber} وإضافتها للمخزون`,
          type: "info",
          relatedPOId: input.purchaseOrderId,
        });
      }

      await db.createAuditLog({
        userId: ctx.user.id,
        action: "warehouse_receive",
        entityType: "purchase_order",
        entityId: input.purchaseOrderId,
        newValues: { receiptNumber, totalItems: input.items.length },
      });

      return { receiptId, receiptNumber, inventoryIds };
    }),
});

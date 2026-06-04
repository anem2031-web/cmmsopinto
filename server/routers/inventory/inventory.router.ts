import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { router, protectedProcedure, warehouseProcedure } from "../_shared/procedures";
import * as db from "../../db";

export const inventoryRouter = router({
  list: protectedProcedure.query(async () => {
    return db.getInventoryItems();
  }),

  create: warehouseProcedure.input(z.object({
    itemName: z.string().min(1),
    description: z.string().optional(),
    quantity: z.number().default(0),
    unit: z.string().optional(),
    minQuantity: z.number().optional(),
    location: z.string().optional(),
    siteId: z.number().optional(),
  })).mutation(async ({ input, ctx }) => {
    const id = await db.createInventoryItem(input);
    await db.createAuditLog({ userId: ctx.user.id, action: "create_inventory", entityType: "inventory", entityId: id! });
    return { id };
  }),

  update: warehouseProcedure.input(z.object({
    id: z.number(),
    itemName: z.string().optional(),
    description: z.string().optional(),
    unit: z.string().optional(),
    minQuantity: z.number().optional(),
    location: z.string().optional(),
    siteId: z.number().optional(),
  })).mutation(async ({ input, ctx }) => {
    const item = await db.getInventoryItemById(input.id);
    if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "الصنف غير موجود" });
    const { id, ...updateData } = input;
    const oldValues = { itemName: item.itemName, description: item.description, unit: item.unit, minQuantity: item.minQuantity, location: item.location };
    await db.updateInventoryItem(id, updateData);
    await db.createAuditLog({ userId: ctx.user.id, action: "update_inventory", entityType: "inventory", entityId: id, oldValues, newValues: updateData });
    return { success: true };
  }),

  delete: warehouseProcedure.input(z.object({ id: z.number() })).mutation(async ({ input, ctx }) => {
    const item = await db.getInventoryItemById(input.id);
    if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "الصنف غير موجود" });
    await db.deleteInventoryItem(input.id);
    await db.createAuditLog({ userId: ctx.user.id, action: "delete_inventory", entityType: "inventory", entityId: input.id, oldValues: { itemName: item.itemName, quantity: item.quantity } });
    return { success: true };
  }),

  addTransaction: protectedProcedure.input(z.object({
    inventoryId: z.number(),
    type: z.enum(["in", "out"]),
    quantity: z.number().min(1),
    reason: z.string().optional(),
    ticketId: z.number().optional(),
  })).mutation(async ({ input, ctx }) => {
    await db.addInventoryTransaction({ ...input, performedById: ctx.user.id });
    return { success: true };
  }),

  // جلب حركات المخزون
  getTransactions: warehouseProcedure
    .input(z.object({ inventoryId: z.number().optional() }))
    .query(async ({ input }) => {
      return db.getInventoryTransactions(input.inventoryId);
    }),

  // البحث بالباركود
  scanBarcode: warehouseProcedure
    .input(z.object({ code: z.string().min(1) }))
    .query(async ({ input }) => {
      return db.getInventoryByBarcode(input.code);
    }),

  // تسليم من المخزون للعامل
  deliverToRequester: warehouseProcedure
    .input(z.object({
      inventoryId: z.number(),
      purchaseOrderItemId: z.number(),
      purchaseOrderId: z.number(),
      deliveredToId: z.number(),
      deliveredQuantity: z.number().min(1),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const { TRPCError } = await import("@trpc/server");
      const item = await db.getInventoryItemById(input.inventoryId);
      if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "الصنف غير موجود في المخزون" });

      if (item.quantity < input.deliveredQuantity) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `الكمية المتاحة في المخزون ${item.quantity} أقل من الكمية المطلوبة`,
        });
      }

      // تسجيل حركة خروج
      await db.addInventoryTransaction({
        inventoryId: input.inventoryId,
        type: "out",
        quantity: input.deliveredQuantity,
        reason: input.notes || "تسليم للعامل",
        purchaseOrderItemId: input.purchaseOrderItemId,
        performedById: ctx.user.id,
        transactionType: "delivery",
      });

      // تحديث صنف طلب الشراء
      await db.updatePOItem(input.purchaseOrderItemId, {
        status: "delivered_to_requester",
        deliveredAt: new Date(),
        deliveredById: ctx.user.id,
        deliveredToId: input.deliveredToId,
        deliveredQuantity: input.deliveredQuantity,
      });

      // تحقق إذا كل الأصناف سُلِّمت
      const allItems = await db.getPOItems(input.purchaseOrderId);
      const activeItems = allItems.filter((i: any) => i.status !== "rejected" && i.status !== "cancelled");
      const allDelivered = activeItems.every((i: any) => i.status === "delivered_to_requester");

      if (allDelivered) {
        await db.updatePurchaseOrder(input.purchaseOrderId, { status: "received" });
        // تحديث حالة البلاغ المرتبط
        const po = await db.getPurchaseOrderById(input.purchaseOrderId);
        if (po?.ticketId) {
          const ticket = await db.getTicketById(po.ticketId);
          if (ticket && ticket.maintenancePath !== "C" &&
            !["received_warehouse","ready_for_closure","repaired","verified","closed"].includes(ticket.status)) {
            await db.updateTicket(po.ticketId, { status: "received_warehouse" });
            await db.addTicketStatusHistory({
              ticketId: po.ticketId,
              fromStatus: ticket.status,
              toStatus: "received_warehouse",
              changedById: ctx.user.id,
              notes: "تم تسليم جميع المواد للفني من المخزون",
            });
            if (ticket.assignedToId) {
              await db.createNotification({
                userId: ticket.assignedToId,
                title: "📦 تم تسليم المواد - أكمل العمل",
                message: `تم تسليم جميع مواد البلاغ ${ticket.ticketNumber} إليك. يرجى إتمام العمل.`,
                type: "info",
                relatedTicketId: po.ticketId,
              });
            }
          }
        }
      }

      // إشعار للعامل
      await db.createNotification({
        userId: input.deliveredToId,
        title: "📦 تم تسليم مواد لك من المخزون",
        message: `تم تسليم ${input.deliveredQuantity} ${item.unit || "وحدة"} من "${item.itemName}" إليك`,
        type: "info",
      });

      await db.createAuditLog({
        userId: ctx.user.id,
        action: "inventory_delivery",
        entityType: "inventory",
        entityId: input.inventoryId,
        newValues: { deliveredQuantity: input.deliveredQuantity, deliveredToId: input.deliveredToId },
      });

      return { success: true, remainingQuantity: item.quantity - input.deliveredQuantity };
    }),

});
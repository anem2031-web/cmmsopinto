import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { router, warehouseProcedure } from "../_shared/procedures";
import * as db from "../../_core/db";

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

  // مصادر الإرجاع المحتملة لصنف معيّن (سندات الاستلام السابقة له) — DTO
  // جاهز للعرض مباشرة بالواجهة بلا أي معالجة إضافية
  getReturnSources: warehouseProcedure
    .input(z.object({ inventoryId: z.number() }))
    .query(async ({ input }) => {
      return db.getReturnSources(input.inventoryId);
    }),

  // إرجاع صنف للمندوب
  create: warehouseProcedure
    .input(z.object({
      // اختيارية عمداً: الصنف قد يكون "مستقلاً" (استلام بلا طلب شراء عبر 0035)
      // أو بلا سجل استلام مرتبط أصلاً — بهذي الحالة يُسجَّل مرتجع عام بلا مصدر
      receiptId: z.number().optional(),
      purchaseOrderId: z.number().optional(),
      purchaseOrderItemId: z.number().optional(),
      inventoryId: z.number(),
      returnedQuantity: z.number().min(1),
      reason: z.string().min(1, "سبب الإرجاع مطلوب"),
      recipientName: z.string().optional(), // من استلم الصنف المرتجَع (توقيع الوثيقة)
    }))
    .mutation(async ({ input, ctx }) => {
      // التحقق من المخزون — الحد الأقصى الملزم الوحيد هو الرصيد الكلي الفعلي
      // (النظام لا يدعم تتبّع دفعات/Batch، فلا يوجد "متاح لكل سند" ملزم فعلياً)
      const inventoryItem = await db.getInventoryItemById(input.inventoryId);
      if (!inventoryItem) throw new TRPCError({ code: "NOT_FOUND", message: "الصنف غير موجود في المخزون" });

      if (inventoryItem.quantity < input.returnedQuantity) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `الكمية المتاحة في المخزون ${inventoryItem.quantity} أقل من الكمية المُرجَعة`,
        });
      }

      // ── تحقق ترابط المصدر (فقط لو زُوِّد receiptId) ──────────────────────
      // يمنع ربط الإرجاع بسند/طلب/بند لا علاقة له فعلياً بهذا الصنف — نفس
      // حاجز الأمان المطبَّق بمسار الاستلام، بدل الثقة العمياء بأرقام مُرسَلة
      let receipt: any = null;
      if (input.receiptId) {
        receipt = await db.getWarehouseReceiptById(input.receiptId);
        if (!receipt) throw new TRPCError({ code: "NOT_FOUND", message: "سند الاستلام غير موجود" });

        if (input.purchaseOrderId && receipt.purchaseOrderId !== input.purchaseOrderId) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "طلب الشراء المُرسَل لا يطابق سند الاستلام المُختار",
          });
        }
        if (input.purchaseOrderItemId) {
          const poItem = await db.getPOItemById(input.purchaseOrderItemId);
          if (!poItem || poItem.purchaseOrderId !== receipt.purchaseOrderId) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "بند طلب الشراء المُرسَل لا يطابق سند الاستلام المُختار",
            });
          }
        }
        // تحقق أن هذا السند فعلاً استلم هذا الصنف (وليس صنفاً آخر بالخطأ)
        const sources = await db.getReturnSources(input.inventoryId);
        const matchedSource = sources.find(s => s.receiptId === input.receiptId);
        if (!matchedSource) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "سند الاستلام المُختار لا يطابق سجل استلام هذا الصنف",
          });
        }
      }

      // توليد رقم المرتجع
      const returnNumber = await db.getNextReturnNumber();

      // إنشاء المرتجع
      const returnId = await db.createWarehouseReturn({
        returnNumber,
        receiptId: input.receiptId ?? null,
        purchaseOrderId: input.purchaseOrderId ?? null,
        purchaseOrderItemId: input.purchaseOrderItemId ?? null,
        inventoryId: input.inventoryId,
        returnedQuantity: input.returnedQuantity,
        reason: input.reason,
        returnedById: ctx.user.id,
      } as any);

      // تسجيل حركة خروج من المخزون
      await db.addInventoryTransaction({
        inventoryId: input.inventoryId,
        type: "out",
        quantity: input.returnedQuantity,
        reason: input.receiptId
          ? `إرجاع للمندوب - ${input.reason} - مرتجع ${returnNumber}`
          : `إرجاع عام (بلا سند استلام معروف) - ${input.reason} - مرتجع ${returnNumber}`,
        purchaseOrderItemId: input.purchaseOrderItemId,
        performedById: ctx.user.id,
        transactionType: "return",
        receiptId: input.receiptId,
        returnId: returnId!,
      });

      // تحديث طلب الشراء - فقط لو الإرجاع مرتبط فعلياً ببند طلب حقيقي
      if (input.purchaseOrderItemId && input.purchaseOrderId) {
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
      }

      // إشعارات للمدراء
      const po = input.purchaseOrderId ? await db.getPurchaseOrderById(input.purchaseOrderId) : null;
      const managers = await db.getManagerUsers();
      for (const mgr of managers) {
        await db.createNotification({
          userId: mgr.id,
          title: `↩️ مرتجع ${returnNumber}`,
          message: `تم إرجاع ${input.returnedQuantity} ${inventoryItem.unit || "وحدة"} من "${inventoryItem.itemName}"` +
            (po ? ` - طلب الشراء ${po.poNumber}` : " - بلا طلب شراء مرتبط"),
          type: "warning",
          relatedPOId: input.purchaseOrderId,
        });
      }

      await db.createAuditLog({
        userId: ctx.user.id,
        action: "warehouse_return",
        entityType: input.purchaseOrderId ? "purchase_order" : "inventory",
        entityId: input.purchaseOrderId ?? input.inventoryId,
        newValues: { returnNumber, returnedQuantity: input.returnedQuantity, reason: input.reason },
      });

      // ── وثيقة المرتجع الرسمية — تُنشأ تلقائياً هنا بالخادم مع كل عملية
      //   إرجاع (لا تعتمد على استدعاء منفصل من الواجهة)، فتظهر مضمونة
      //   بتبويب "التوثيق" وبصفحة المرتجعات مع كل مرتجع محفوظ
      const performer = await db.getUserById(ctx.user.id);
      await db.createReturnDocument({
        returnNumber,
        returnId: returnId!,
        itemName: inventoryItem.itemName,
        internalCode: (inventoryItem as any).internalCode,
        manufacturerBarcode: (inventoryItem as any).manufacturerBarcode,
        returnedQuantity: input.returnedQuantity,
        unit: inventoryItem.unit,
        reason: input.reason,
        returnedByName: (performer as any)?.name || (performer as any)?.username || "—",
        recipientName: input.recipientName,
        receiptNumber: receipt?.receiptNumber,
        invoiceNumber: receipt?.invoiceNumber,
        vendorName: receipt?.vendorName,
        poNumber: po?.poNumber,
      });

      return { returnId, returnNumber };
    }),
});

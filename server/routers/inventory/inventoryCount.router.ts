import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { warehouseProcedure, protectedProcedure, router } from "../_shared/procedures";
import * as db from "../../_core/db";

export const inventoryCountRouter = router({

  // ── بدء عملية جرد جديدة ──
  // ملاحظة: لا يُستقبل أي تاريخ/وقت من العميل إطلاقاً — يُحسب بالكامل من ساعة
  // الخادم بتوقيت الرياض داخل db.createCountOperation (حماية من تلاعب توقيت الجهاز).
  createOperation: warehouseProcedure
    .input(z.object({
      operationTitle: z.string().max(200).optional(),
      scope: z.enum(["full", "partial"]),
      warehouseId: z.number().optional(),
      itemIds: z.array(z.number()).optional(),
      allowEmpty: z.boolean().default(false),   // true = وضع يدوي/باركود (يبدأ فاضي)
    }))
    .mutation(async ({ input, ctx }) => {
      if (input.scope === "partial" && !input.allowEmpty && (!input.itemIds || input.itemIds.length === 0)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "الجرد الجزئي يتطلب تحديد أصناف" });
      }
      return db.createCountOperation({
        operationTitle: input.operationTitle,
        scope: input.scope,
        warehouseId: input.warehouseId,
        itemIds: input.itemIds,
        allowEmpty: input.allowEmpty,
        createdById: ctx.user.id,
      });
    }),

  // ── مسح/إضافة صنف لجرد جارٍ (باركود أو اختيار مباشر) — كل مسحة = وحدة تُضاف تراكمياً ──
  scanItem: warehouseProcedure
    .input(z.object({
      operationId: z.number(),
      inventoryId: z.number(),
      incrementBy: z.number().min(0.001).default(1),
    }))
    .mutation(async ({ input, ctx }) => {
      return db.scanCountItem({
        operationId: input.operationId,
        inventoryId: input.inventoryId,
        incrementBy: input.incrementBy,
        countedById: ctx.user.id,
      });
    }),

  // ── إضافة صنف لجرد جارٍ (بحث بالاسم/الرقم/الباركود) بدون كمية — بانتظار العدّ ──
  // يعيد تفاصيل الصنف كاملة ليعرضها العميل قبل إدخال الكمية الفعلية عبر recordItem.
  addItem: warehouseProcedure
    .input(z.object({
      operationId: z.number(),
      inventoryId: z.number(),
    }))
    .mutation(async ({ input }) => {
      return db.addItemToCount({
        operationId: input.operationId,
        inventoryId: input.inventoryId,
      });
    }),

  // ── إضافة صنف جديد كليّاً (غير موجود بالمخزون أصلاً) أثناء جرد جارٍ ──
  // يُنشئ الصنف بالمخزون مباشرة (كود داخلي + باركود مصنع تلقائيَين) ويُدخله
  // الرصيد فوراً بالكمية المُدخلة — مختلف عن addItem الذي يبحث بأصناف موجودة مسبقاً.
  addNewItem: warehouseProcedure
    .input(z.object({
      operationId: z.number(),
      itemName: z.string().trim().min(1, "اسم الصنف مطلوب"),
      unit: z.string().trim().min(1, "الوحدة مطلوبة"),
      quantity: z.number().min(0.001, "الكمية يجب أن تكون أكبر من صفر"),
      cost: z.number().min(0).optional(),   // اختياري دائماً
    }))
    .mutation(async ({ input, ctx }) => {
      return db.addNewItemDuringCount({
        operationId: input.operationId,
        itemName: input.itemName,
        unit: input.unit,
        quantity: input.quantity,
        cost: input.cost,
        createdById: ctx.user.id,
      });
    }),

  // ── حذف مسودة جرد بالكامل (المسودات فقط، قبل الحفظ النهائي) ──
  deleteOperation: warehouseProcedure
    .input(z.object({ operationId: z.number() }))
    .mutation(async ({ input }) => {
      return db.deleteCountOperation(input.operationId);
    }),

  // ── تسجيل الكمية المعدودة فعلياً لصنف واحد ──
  recordItem: warehouseProcedure
    .input(z.object({
      countItemId: z.number(),
      countedQuantity: z.number().min(0),
      lotNumber: z.string().optional(),
      expiryDate: z.string().optional(),
      notes: z.string().optional(),   // اختياري دائماً، حتى لو فيه فرق
    }))
    .mutation(async ({ input, ctx }) => {
      return db.recordCountItem({
        countItemId: input.countItemId,
        countedQuantity: input.countedQuantity,
        lotNumber: input.lotNumber,
        expiryDate: input.expiryDate,
        notes: input.notes,
        countedById: ctx.user.id,
      });
    }),

  // ── إنهاء عملية الجرد (تسجيل فقط، لا يمس المخزون) ──
  completeOperation: warehouseProcedure
    .input(z.object({ operationId: z.number() }))
    .mutation(async ({ input }) => {
      return db.completeCountOperation(input.operationId);
    }),

  // ── الأصناف الغير مجرودة بعد ضمن عملية جارية ──
  uncountedItems: protectedProcedure
    .input(z.object({ operationId: z.number() }))
    .query(async ({ input }) => {
      return db.getUncountedItems(input.operationId);
    }),

  // ── تفاصيل عملية جرد كاملة ──
  operationDetails: protectedProcedure
    .input(z.object({ operationId: z.number() }))
    .query(async ({ input }) => {
      const result = await db.getCountOperationDetails(input.operationId);
      if (!result) throw new TRPCError({ code: "NOT_FOUND", message: "عملية الجرد غير موجودة" });
      return result;
    }),

  // ── قائمة كل عمليات الجرد (أرشيف) ──
  listOperations: protectedProcedure.query(async () => {
    return db.listCountOperations();
  }),

  // ── فروقات جرد مكتمل (لتعبئة شاشة التسوية تلقائياً) ──
  countDiscrepancies: protectedProcedure
    .input(z.object({ operationId: z.number() }))
    .query(async ({ input }) => {
      return db.getCountDiscrepancies(input.operationId);
    }),

  // ── تطبيق تسوية المخزون (من جرد أو مستقلة) — فوري، بسبب إلزامي ──
  applySettlement: warehouseProcedure
    .input(z.object({
      sourceType: z.enum(["from_count", "manual"]),
      sourceCountOperationId: z.number().optional(),
      reason: z.string().trim().min(10, {
        message: "سبب التسوية إلزامي (10 أحرف على الأقل)",
      }),
      items: z.array(z.object({
        inventoryId: z.number(),
        afterQuantity: z.number().min(0),
        lotNumber: z.string().optional(),
        expiryDate: z.string().optional(),
      })).min(1, "لا توجد أصناف للتسوية"),
    }))
    .mutation(async ({ input, ctx }) => {
      if (input.sourceType === "from_count" && !input.sourceCountOperationId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "التسوية من جرد تتطلب رقم عملية الجرد" });
      }
      return db.applySettlement({
        sourceType: input.sourceType,
        sourceCountOperationId: input.sourceCountOperationId,
        reason: input.reason,
        appliedById: ctx.user.id,
        items: input.items,
      });
    }),

  // ── قائمة كل التسويات (أرشيف) ──
  listSettlements: protectedProcedure.query(async () => {
    return db.listSettlements();
  }),

  // ── تفاصيل تسوية كاملة (للعرض والطباعة) ──
  settlementDetails: protectedProcedure
    .input(z.object({ settlementId: z.number() }))
    .query(async ({ input }) => {
      const result = await db.getSettlementDetails(input.settlementId);
      if (!result) throw new TRPCError({ code: "NOT_FOUND", message: "التسوية غير موجودة" });
      return result;
    }),
});

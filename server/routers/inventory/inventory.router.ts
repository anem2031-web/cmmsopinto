import { materialExecutionCostsEnabled } from "../../services/material-costs/feature";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { router, inventoryReadProcedure, warehouseProcedure } from "../_shared/procedures";
import * as db from "../../_core/db";
import { syncPathBTicketFromPurchaseOrder } from "../purchase/ticket-purchase-workflow";
import { isInventoryLotsEnabled, resolveInventoryLotForIssue } from "../../_core/inventory-lots";
import { catalogSuppliers, inventory, inventoryLotBalances, inventoryLots, warehouseReceipts } from "../../../drizzle/schema";
import { and, desc, eq, gt, or, sql } from "drizzle-orm";
import { issueCostAllocationsSchema } from "./issue-cost-allocation.schema";
import { isItTeamRole, MAINTENANCE_RESPONSIBLE_DEPARTMENT } from "@shared/roles";
import { createCatalogStockProcedure } from "./catalog-stock.procedure";
import { shouldExposeTicketMaterialLink } from "@shared/ticketMaterialDelivery";
import { createInventoryBookProcedures } from "./books.procedure";

export const inventoryRouter = router({
  ...createInventoryBookProcedures(db.getDb),
  catalogStock: createCatalogStockProcedure(db.getDb),
  list: inventoryReadProcedure.query(async () => {
    return db.getInventoryItems();
  }),

  // 2B-9 — قراءة مشتقة فقط: Inventory → Catalog Item → catalog_nodes path.
  // منفصلة عن list حتى لا نغيّر عقدها أو تكلفة مستهلكيها التاريخيين (AI/export وغيرها).
  taxonomy: inventoryReadProcedure.query(async () => {
    return db.getInventoryCatalogTaxonomy();
  }),

  // 2B-8 — ملخص الدفعات ذات الرصيد الموجب لكل سجل Inventory.
  // يُستخدم فقط لإظهار أيقونة QR وعدد الدفعات في صفحة المخزون بدون N+1 queries.
  lotSummaries: inventoryReadProcedure.query(async () => {
    if (!isInventoryLotsEnabled()) return [];
    const database = await db.getDb();
    if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "تعذر الاتصال بقاعدة البيانات" });

    const rows = await database
      .select({
        inventoryId: inventoryLotBalances.inventoryId,
        lotCount: sql<number>`COUNT(*)`,
        totalQuantity: sql<string>`COALESCE(SUM(${inventoryLotBalances.quantity}), 0)`,
      })
      .from(inventoryLotBalances)
      .where(gt(inventoryLotBalances.quantity, "0"))
      .groupBy(inventoryLotBalances.inventoryId);

    return rows.map((row: any) => ({
      inventoryId: Number(row.inventoryId),
      lotCount: Number(row.lotCount || 0),
      totalQuantity: Number(row.totalQuantity || 0),
    }));
  }),

  // 2B-8 — الدفعات الموجودة فعليًا داخل سجل Inventory/المستودع المحدد.
  // يعيد فقط الـBalances الموجبة؛ QR هو هوية الـLot نفسها وليس هوية Inventory.
  listLots: inventoryReadProcedure
    .input(z.object({ inventoryId: z.number() }))
    .query(async ({ input }) => {
      if (!isInventoryLotsEnabled()) return [];
      const database = await db.getDb();
      if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "تعذر الاتصال بقاعدة البيانات" });

      const item = await db.getInventoryItemById(input.inventoryId);
      if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "الصنف غير موجود في المخزون" });

      const rows = await database
        .select({
          lotId: inventoryLots.id,
          lotCode: inventoryLots.lotCode,
          trackingToken: inventoryLots.trackingToken,
          sourceType: inventoryLots.sourceType,
          catalogItemId: inventoryLots.catalogItemId,
          originalQuantity: inventoryLots.originalQuantity,
          remainingQuantity: inventoryLots.remainingQuantity,
          balanceQuantity: inventoryLotBalances.quantity,
          purchaseUnit: inventoryLots.purchaseUnit,
          issueUnit: inventoryLots.issueUnit,
          batchNumber: inventoryLots.batchNumber,
          expiryDate: inventoryLots.expiryDate,
          receiptId: inventoryLots.receiptId,
          receiptNumber: warehouseReceipts.receiptNumber,
          invoiceNumber: warehouseReceipts.invoiceNumber,
          invoiceDate: warehouseReceipts.invoiceDate,
          receiptVendorName: warehouseReceipts.vendorName,
          supplierNameAr: catalogSuppliers.nameAr,
          supplierNameEn: catalogSuppliers.nameEn,
          createdAt: inventoryLots.createdAt,
        })
        .from(inventoryLotBalances)
        .innerJoin(inventoryLots, eq(inventoryLots.id, inventoryLotBalances.lotId))
        .leftJoin(warehouseReceipts, eq(warehouseReceipts.id, inventoryLots.receiptId))
        .leftJoin(catalogSuppliers, eq(catalogSuppliers.id, inventoryLots.catalogSupplierId))
        .where(and(
          eq(inventoryLotBalances.inventoryId, input.inventoryId),
          gt(inventoryLotBalances.quantity, "0"),
        ))
        .orderBy(desc(inventoryLots.createdAt), desc(inventoryLots.id));

      return rows.map((row: any) => ({
        ...row,
        lotId: Number(row.lotId),
        catalogItemId: row.catalogItemId == null ? null : Number(row.catalogItemId),
        originalQuantity: Number(row.originalQuantity || 0),
        remainingQuantity: Number(row.remainingQuantity || 0),
        balanceQuantity: Number(row.balanceQuantity || 0),
        supplierName: row.supplierNameAr || row.receiptVendorName || row.supplierNameEn || null,
      }));
    }),

  create: warehouseProcedure.input(z.object({
    itemName: z.string().min(1),
    description: z.string().optional(),
    quantity: z.number().min(0).default(0),
    unit: z.string().optional(),
    minQuantity: z.number().min(0).optional(),
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
    minQuantity: z.number().min(0).optional(),
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

  addTransaction: inventoryReadProcedure.input(z.object({
    inventoryId: z.number(),
    type: z.enum(["in", "out"]),
    quantity: z.number().min(0.001, "الكمية يجب أن تكون أكبر من صفر"),
    reason: z.string().optional(),
    ticketId: z.number().optional(),
  })).mutation(async ({ input, ctx }) => {
    if (input.type === "out" && materialExecutionCostsEnabled()) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "الصرف يتطلب سند صرف باللوت والجهة المستفيدة. استخدم شاشة تسليم المخزون أو احتياج البلاغ/المهمة." });
    }
    await db.addInventoryTransaction({ ...input, performedById: ctx.user.id });
    return { success: true };
  }),

  // جلب حركات المخزون
  getTransactions: warehouseProcedure
    .input(z.object({ inventoryId: z.number().optional() }))
    .query(async ({ input }) => {
      return db.getInventoryTransactions(input.inventoryId);
    }),

  // قراءة مستقلة لتقارير تحميل تكلفة الصرف حسب اللوت والجهة المستفيدة.
  // لا تغيّر تقييم المخزون الحالي؛ تعتمد فقط على snapshots المحفوظة وقت الصرف.
  issueCostAllocations: inventoryReadProcedure
    .input(z.object({
      siteId: z.number().int().positive().optional(),
      sectionId: z.number().int().positive().optional(),
      assetId: z.number().int().positive().optional(),
      dateFrom: z.string().optional(),
      dateTo: z.string().optional(),
      limit: z.number().int().min(1).max(2000).optional(),
    }).optional())
    .query(async ({ input }) => {
      const dateFrom = input?.dateFrom ? new Date(`${input.dateFrom}T00:00:00`) : undefined;
      const dateTo = input?.dateTo ? new Date(`${input.dateTo}T23:59:59.999`) : undefined;
      return db.getIssueCostAllocations({
        siteId: input?.siteId,
        sectionId: input?.sectionId,
        assetId: input?.assetId,
        dateFrom,
        dateTo,
        limit: input?.limit,
      });
    }),

  // البحث بالباركود
  scanBarcode: warehouseProcedure
    .input(z.object({ code: z.string().min(1) }))
    .query(async ({ input }) => {
      return db.getInventoryByBarcode(input.code);
    }),

  // ── Phase 2A: بطاقة الصنف — المعلومات العامة + ملخص سريع ──────────────
  getItemSummary: inventoryReadProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const item = await db.getInventoryItemById(input.id);
      if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "الصنف غير موجود" });
      // نفس منطق آخر توريد/صرف/سعر المستخدم في شاشة الملخص — لضمان تطابق الأرقام
      const allItems = await db.getInventoryItems();
      const enriched = allItems.find((i: any) => i.id === input.id);
      return { ...item, ...(enriched ?? {}) };
    }),

  // ── Phase 2B: سجل التوريد — كل الفواتير التي دخل منها الصنف ────────────
  getPurchaseHistory: inventoryReadProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      return db.getInventoryPurchaseHistory(input.id);
    }),

  // ── Phase 2C: سجل الحركة — كشف حساب كامل (وارد/صادر/رصيد بعد الحركة) ──
  getLedger: inventoryReadProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      return db.getInventoryLedger(input.id);
    }),

  // 2B-8 — بحث فعلي بQR/رمز الـLot.
  // لا نحاول مقارنة trackingToken باسم الصنف أو باركود Inventory التاريخي؛
  // نحل الرمز من inventory_lots ثم نرجع أرصدة الـInventory التي تحمل نفس Lot.
  resolveLotSearch: inventoryReadProcedure
    .input(z.object({ code: z.string().trim().min(1, "QR/رمز الدفعة مطلوب") }))
    .mutation(async ({ input }) => {
      if (!isInventoryLotsEnabled()) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "تتبع الدفعات غير مفعّل تشغيليًا بعد" });
      }
      const database = await db.getDb();
      if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "تعذر الاتصال بقاعدة البيانات" });

      const code = input.code.trim();
      const lotRows = await database
        .select({
          lotId: inventoryLots.id,
          lotCode: inventoryLots.lotCode,
          trackingToken: inventoryLots.trackingToken,
          sourceType: inventoryLots.sourceType,
          catalogItemId: inventoryLots.catalogItemId,
        })
        .from(inventoryLots)
        .where(or(eq(inventoryLots.trackingToken, code), eq(inventoryLots.lotCode, code)))
        .limit(1);

      const lot = (lotRows as any[])[0];
      if (!lot) {
        throw new TRPCError({ code: "NOT_FOUND", message: "QR/رمز الدفعة غير معروف في نظام المخزون" });
      }

      const balances = await database
        .select({
          inventoryId: inventoryLotBalances.inventoryId,
          warehouseId: inventory.warehouseId,
          balanceQuantity: inventoryLotBalances.quantity,
        })
        .from(inventoryLotBalances)
        .innerJoin(inventory, eq(inventory.id, inventoryLotBalances.inventoryId))
        .where(and(
          eq(inventoryLotBalances.lotId, Number(lot.lotId)),
          gt(inventoryLotBalances.quantity, "0"),
        ));

      if ((balances as any[]).length === 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `الدفعة ${lot.lotCode} معروفة لكن لا يوجد لها رصيد متاح حاليًا` });
      }

      return {
        lotId: Number(lot.lotId),
        lotCode: String(lot.lotCode),
        trackingToken: String(lot.trackingToken),
        sourceType: lot.sourceType,
        catalogItemId: lot.catalogItemId == null ? null : Number(lot.catalogItemId),
        matches: (balances as any[]).map((row: any) => ({
          inventoryId: Number(row.inventoryId),
          warehouseId: row.warehouseId == null ? null : Number(row.warehouseId),
          balanceQuantity: Number(row.balanceQuantity || 0),
        })),
      };
    }),

  // 2B-8 — تحقق فوري من QR الدفعة داخل الصنف/المستودع المختار قبل الصرف.
  // التحقق النهائي والخصم يعادان داخل issueDelivery transaction عند التأكيد.
  resolveDeliveryLot: warehouseProcedure
    .input(z.object({
      inventoryId: z.number(),
      trackingToken: z.string().trim().min(1, "QR الدفعة أو رقم اللوت مطلوب"),
    }))
    .mutation(async ({ input }) => {
      if (!isInventoryLotsEnabled()) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "تتبع الدفعات غير مفعّل تشغيليًا بعد" });
      }
      const database = await db.getDb();
      if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "تعذر الاتصال بقاعدة البيانات" });
      const item = await db.getInventoryItemById(input.inventoryId);
      if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "الصنف غير موجود في المخزون" });

      let lot;
      try {
        lot = await resolveInventoryLotForIssue({
          tx: database,
          trackingToken: input.trackingToken,
          inventoryId: input.inventoryId,
          inventoryCatalogItemId: (item as any).linkedItemId ?? null,
        });
      } catch (error: any) {
        throw new TRPCError({ code: "BAD_REQUEST", message: error?.message || "رقم اللوت أو QR الدفعة غير صالح للصرف" });
      }
      // Inventory can contain receipts from several purchase orders. Show the
      // provenance of the scanned lot, not the inventory's first receipt.
      const poItem = lot.purchaseOrderItemId
        ? await db.getPOItemById(lot.purchaseOrderItemId)
        : null;
      const po = poItem ? await db.getPurchaseOrderById(poItem.purchaseOrderId) : null;
      const ticket = po?.ticketId ? await db.getTicketById(po.ticketId) : null;
      const assigned = ticket?.assignedToId ? await db.getUserById(ticket.assignedToId) : null;
      const receipt = lot.receiptId ? await db.getWarehouseReceiptById(lot.receiptId) : null;
      const exposeTicket = shouldExposeTicketMaterialLink({
        ticketId: ticket?.id ?? null,
        ticketStatus: ticket?.status ?? null,
        maintenancePath: ticket?.maintenancePath ?? null,
        assignedTechnicianId: ticket?.assignedToId ?? null,
        purchaseOrderItemId: poItem?.id ?? null,
        purchaseOrderItemStatus: poItem?.status ?? null,
      });
      return {
        lotId: lot.lotId,
        lotCode: lot.lotCode,
        trackingToken: lot.trackingToken,
        sourceType: lot.sourceType,
        catalogItemId: lot.catalogItemId,
        receiptId: lot.receiptId,
        availableQuantity: lot.balanceQuantity,
        remainingQuantity: lot.remainingQuantity,
        issueUnitCost: Number(lot.issueUnitCost || 0),
        unit: String((item as any).issueUnit || item.unit || ""),
        poNumber: po?.poNumber ?? null,
        supplierName: receipt?.vendorName ?? null,
        ticketNumber: exposeTicket ? ticket?.ticketNumber ?? null : null,
        ticketAssignedToId: exposeTicket ? ticket?.assignedToId ?? null : null,
        ticketAssignedToName: exposeTicket ? assigned?.name ?? null : null,
        ticketResponsibleDepartment: exposeTicket ? ticket?.maintenanceResponsibleDepartment ?? null : null,
      };
    }),

  // مسار توافق قديم للتسليم من المخزون. أُحكم بنفس قواعد المسار المركزي:
  // لا يثق بمعرّفات الربط المرسلة، ويُلزم فنيًا مستلمًا فعليًا، ويجعل التحديث
  // داخل خدمة issueDelivery الذرية حتى لا يمكن تجاوز دورة البلاغ.
  deliverToRequester: warehouseProcedure
    .input(z.object({
      inventoryId: z.number(),
      purchaseOrderItemId: z.number(),
      purchaseOrderId: z.number(),
      deliveredToId: z.number(),
      deliveredQuantity: z.number().positive(),
      lotTrackingToken: z.string().trim().min(1).optional(),
      costAllocations: issueCostAllocationsSchema.optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const inventoryItem = await db.getInventoryItemById(input.inventoryId);
      if (!inventoryItem) {
        throw new TRPCError({ code: "NOT_FOUND", message: "الصنف غير موجود في المخزون" });
      }
      if (input.deliveredQuantity > Number(inventoryItem.quantity || 0)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `الكمية المتاحة في المخزون ${inventoryItem.quantity} أقل من الكمية المطلوبة`,
        });
      }

      const poItem = await db.getPOItemById(input.purchaseOrderItemId);
      if (!poItem || poItem.purchaseOrderId !== input.purchaseOrderId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "بند طلب الشراء لا يطابق الطلب المحدد" });
      }
      const linkedInventory = await db.getInventoryByPOItemId(input.purchaseOrderItemId);
      if (!linkedInventory || linkedInventory.id !== input.inventoryId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "صنف المخزون غير مرتبط ببند طلب الشراء المحدد" });
      }

      const po = await db.getPurchaseOrderById(input.purchaseOrderId);
      if (!po) throw new TRPCError({ code: "NOT_FOUND", message: "طلب الشراء غير موجود" });
      const ticket = po.ticketId ? await db.getTicketById(po.ticketId) : null;

      const recipient = await db.getUserById(input.deliveredToId);
      const isAllowedItRecipient =
        !!recipient &&
        isItTeamRole((recipient as any).role) &&
        ticket?.maintenancePath === "B" &&
        ticket?.maintenanceResponsibleDepartment === MAINTENANCE_RESPONSIBLE_DEPARTMENT.IT;
      if (!recipient || (recipient as any).isActive === 0 || (recipient.role !== "technician" && !isAllowedItRecipient)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "يجب اختيار فني مستلم فعلي نشط" });
      }
      if (ticket?.maintenancePath === "B" && !ticket.assignedToId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "لا يوجد فني مسند للبلاغ المرتبط" });
      }
      const assignedTechnician = ticket?.assignedToId
        ? await db.getUserById(ticket.assignedToId)
        : null;

      const deliveryResult = await db.issueDelivery({
        inventoryId: input.inventoryId,
        quantity: input.deliveredQuantity,
        unit: inventoryItem.unit || undefined,
        performedById: ctx.user.id,
        deliveredToId: input.deliveredToId,
        purchaseOrderItemId: input.purchaseOrderItemId,
        ticketId: ticket?.maintenancePath === "B" ? ticket.id : undefined,
        ticketItemId: ticket?.maintenancePath === "B" ? po.ticketItemId ?? undefined : undefined,
        ticketNumber: ticket?.maintenancePath === "B" ? ticket.ticketNumber : undefined,
        assignedTechnicianId: ticket?.maintenancePath === "B" ? ticket.assignedToId ?? undefined : undefined,
        assignedTechnicianName: ticket?.maintenancePath === "B" ? (assignedTechnician as any)?.name ?? undefined : undefined,
        notes: input.notes || "تسليم مادة مرتبطة ببلاغ من المخزون",
        markPurchaseOrderItemDelivered: true,
        lotTrackingToken: input.lotTrackingToken,
        costAllocations: input.costAllocations,
      });

      await syncPathBTicketFromPurchaseOrder(
        input.purchaseOrderId,
        ctx.user.id,
        "تم تسليم مادة مرتبطة بالبلاغ عبر مسار المخزون",
      );

      await db.createNotification({
        userId: input.deliveredToId,
        title: "📦 تم تسليم مواد لك من المخزون",
        message: `تم تسليم ${input.deliveredQuantity} ${inventoryItem.unit || "وحدة"} من "${inventoryItem.itemName}" إليك`,
        type: "info",
        relatedTicketId: ticket?.id,
      });

      await db.createAuditLog({
        userId: ctx.user.id,
        action: "inventory_delivery",
        entityType: "inventory",
        entityId: input.inventoryId,
        newValues: {
          deliveredQuantity: input.deliveredQuantity,
          deliveredToId: input.deliveredToId,
          assignedTechnicianId: ticket?.assignedToId ?? null,
          purchaseOrderItemId: input.purchaseOrderItemId,
          ticketId: ticket?.id ?? null,
          lotId: deliveryResult.lotId ?? null,
          inventoryTransactionId: deliveryResult.inventoryTransactionId ?? null,
          costAllocationCount: deliveryResult.costAllocationCount ?? 0,
          allocatedCostTotal: deliveryResult.allocatedCostTotal ?? null,
        },
      });

      return {
        success: true,
        remainingQuantity: Number(inventoryItem.quantity) - input.deliveredQuantity,
        ...deliveryResult,
      };
    }),


});

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { router, protectedProcedure, managerProcedure, warehouseProcedure, delegateProcedure } from "../_shared/procedures";
import * as db from "../../db";
import { notifyOwner } from "../../_core/notification";

export const purchaseOrdersRouter = router({
  cancelItem: protectedProcedure.input(z.object({
    itemId: z.number(),
    reason: z.string().optional(),
  })).mutation(async ({ input, ctx }) => {
    // Only senior_management, owner, admin, maintenance_manager can cancel items
    const canCancel = ["senior_management", "owner", "admin", "maintenance_manager"].includes(ctx.user.role);
    if (!canCancel) {
      throw new TRPCError({ code: "FORBIDDEN", message: "ليس لديك صلاحية إلغاء هذا الصنف" });
    }
    const item = await db.getPOItemById(input.itemId);
    if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "الصنف غير موجود" });
    // Cannot cancel already delivered items
    if (item.status === "delivered_to_requester") {
      throw new TRPCError({ code: "BAD_REQUEST", message: "لا يمكن إلغاء صنف تم تسليمه بالفعل" });
    }
    if (item.status === "cancelled") {
      throw new TRPCError({ code: "BAD_REQUEST", message: "الصنف ملغى بالفعل" });
    }
    await db.updatePOItem(input.itemId, {
      status: "cancelled",
      managementRejectionReason: input.reason || "تم الإلغاء من قبل الإدارة",
    });
    // Check if all items are now terminal (rejected or cancelled) — auto-close PO if so
    const allItems = await db.getPOItems(item.purchaseOrderId);
    const allTerminal = allItems.every(i => i.status === "rejected" || i.status === "cancelled");
    if (allTerminal) {
      const po = await db.getPurchaseOrderById(item.purchaseOrderId);
      await db.updatePurchaseOrder(item.purchaseOrderId, {
        status: "rejected",
        rejectedById: ctx.user.id,
        rejectedAt: new Date(),
        rejectionReason: "تم إلغاء جميع أصناف طلب الشراء",
      });
      if (po) {
        await db.createNotification({ userId: po.requestedById, title: "⚠️ تم إلغاء جميع أصناف طلب الشراء", message: `تم إلغاء جميع أصناف طلب الشراء رقم ${po.poNumber}.`, type: "warning", relatedPOId: item.purchaseOrderId });
      }
    }
    await db.createAuditLog({ userId: ctx.user.id, action: "cancel_po_item", entityType: "purchase_order_item", entityId: input.itemId, newValues: { reason: input.reason } });
    return { success: true };
  }),

  close: protectedProcedure.input(z.object({
    id: z.number(),
    note: z.string().optional(),
  })).mutation(async ({ input, ctx }) => {
    const po = await db.getPurchaseOrderById(input.id);
    if (!po) throw new TRPCError({ code: "NOT_FOUND" });
    if (po.requestedById !== ctx.user.id && !["admin", "owner"].includes(ctx.user.role)) {
      throw new TRPCError({ code: "FORBIDDEN", message: "ليس لديك صلاحية لإغلاق هذا الطلب" });
    }

    await db.updatePurchaseOrder(input.id, { status: "closed" });

    if (input.note) {
      await db.createProcurementComment({
        purchaseOrderId: input.id,
        userId: ctx.user.id,
        userName: ctx.user.name || "User",
        userRole: ctx.user.role,
        actionType: "closed",
        note: `إغلاق الطلب: ${input.note}`,
      });
    }

    await db.createAuditLog({ userId: ctx.user.id, action: "close_po", entityType: "purchase_order", entityId: input.id });
    return { success: true };
  }),

  confirmDeliveryToRequester: warehouseProcedure.input(z.object({
    itemId: z.number(),
    deliveredToId: z.number().optional(),
  })).mutation(async ({ input, ctx }) => {
    const item = await db.getPOItemById(input.itemId);
    if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "الصنف غير موجود" });
    if (item.status !== "delivered_to_warehouse") {
      throw new TRPCError({ code: "BAD_REQUEST", message: "هذا الصنف لم يتم توريده للمستودع بعد" });
    }
    await db.updatePOItem(input.itemId, {
      status: "delivered_to_requester",
      deliveredAt: new Date(),
      deliveredById: ctx.user.id,
      deliveredToId: input.deliveredToId || null,
    });
    // Check if all items delivered to requester (Path C: do not change ticket status)
    const allItems = await db.getPOItems(item.purchaseOrderId);
    // Exclude rejected items from auto-close check
    const activeItems = allItems.filter(i => i.status !== "rejected" && i.status !== "cancelled");
    const allDelivered = activeItems.length > 0 && activeItems.every(i => i.status === "delivered_to_requester");
    if (allDelivered) {
      await db.updatePurchaseOrder(item.purchaseOrderId, { status: "received" });
      // Advance ticket to received_warehouse so technician can complete work via completeWithParts
      const po = await db.getPurchaseOrderById(item.purchaseOrderId);
      if (po?.ticketId) {
        const ticket = await db.getTicketById(po.ticketId);
        // Path C: gate security controls ticket status, do not advance here
        if (ticket && ticket.maintenancePath !== "C" && !["received_warehouse", "ready_for_closure", "repaired", "verified", "closed"].includes(ticket.status)) {
          await db.updateTicket(po.ticketId, { status: "received_warehouse" });
          await db.addTicketStatusHistory({ ticketId: po.ticketId, fromStatus: ticket.status, toStatus: "received_warehouse", changedById: ctx.user.id, notes: "تم تسليم جميع المواد للفني - بانتظار إتمام العمل" });
          // Notify assigned technician to complete the work
          if (ticket.assignedToId) {
            await db.createNotification({ userId: ticket.assignedToId, title: "📦 تم تسليم المواد - أكمل العمل", message: `تم تسليم جميع مواد البلاغ ${ticket.ticketNumber} إليك. يرجى إتمام العمل وإرساله للإغلاق.`, type: "info", relatedTicketId: po.ticketId });
          }
          // Notify managers
          const managers = await db.getManagerUsers();
          for (const mgr of managers) {
            await db.createNotification({ userId: mgr.id, title: "📦 مواد بلاغ جاهزة للفني", message: `تم تسليم جميع مواد البلاغ ${ticket.ticketNumber}. بانتظار إتمام الفني للعمل.`, type: "info", relatedTicketId: po.ticketId });
          }
        }
      }
    }
    await db.createAuditLog({ userId: ctx.user.id, action: "deliver_to_requester", entityType: "po_item", entityId: input.itemId });
    return { success: true };
  }),

  confirmDeliveryToWarehouse: warehouseProcedure.input(z.object({
    itemId: z.number(),
    supplierName: z.string().min(1, "اسم المورد مطلوب"),
    supplierItemName: z.string().optional(),
    actualUnitCost: z.string().min(1, "تكلفة الصنف مطلوبة"),
    warehousePhotoUrl: z.string().min(1, "صورة الصنف مطلوبة"),
  })).mutation(async ({ input, ctx }) => {
    // Get the item
    const item = await db.getPOItemById(input.itemId);
    if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "الصنف غير موجود" });
    if (item.status !== "purchased") {
      throw new TRPCError({ code: "BAD_REQUEST", message: "هذا الصنف ليس في حالة \"تم الشراء\" بعد" });
    }
    const actualTotal = parseFloat(input.actualUnitCost) * item.quantity;
    await db.updatePOItem(input.itemId, {
      status: "delivered_to_warehouse",
      receivedAt: new Date(),
      receivedById: ctx.user.id,
      supplierName: input.supplierName,
      supplierItemName: input.supplierItemName || item.itemName,
      actualUnitCost: input.actualUnitCost,
      actualTotalCost: String(actualTotal),
      warehousePhotoUrl: input.warehousePhotoUrl,
    });
    // Update PO status (Path C: do not change ticket status — gate security controls it)
    const allItems = await db.getPOItems(item.purchaseOrderId);
    const activeItemsWH = allItems.filter(i => i.status !== "rejected" && i.status !== "cancelled");
    const allInWarehouse = activeItemsWH.length > 0 && activeItemsWH.every(i => ["delivered_to_warehouse", "delivered_to_requester"].includes(i.status));
    if (allInWarehouse) {
      const totalActual = activeItemsWH.reduce((sum, i) => sum + parseFloat(i.actualTotalCost || "0"), 0);
      await db.updatePurchaseOrder(item.purchaseOrderId, { status: "received", totalActualCost: String(totalActual) });
      const poWH = await db.getPurchaseOrderById(item.purchaseOrderId);
      if (poWH?.ticketId) {
        const ticketWH = await db.getTicketById(poWH.ticketId);
        if (ticketWH && ticketWH.maintenancePath !== "C") {
          await db.updateTicket(poWH.ticketId, { status: "received_warehouse" });
        }
      }
    }
    // Notify assigned technician and managers that item arrived at warehouse
    const poForNotif = await db.getPurchaseOrderById(item.purchaseOrderId);
    if (poForNotif?.ticketId) {
      const ticketForNotif = await db.getTicketById(poForNotif.ticketId);
      if (ticketForNotif?.assignedToId) {
        await db.createNotification({ userId: ticketForNotif.assignedToId, title: "📦 وصلت موادك للمستودع", message: `تم استلام الصنف "${item.itemName}" في المستودع. سيتم تسليمه لك قريباً.`, type: "info", relatedTicketId: poForNotif.ticketId });
      }
    }
    const managersWH = await db.getManagerUsers();
    for (const mgr of managersWH) {
      await db.createNotification({ userId: mgr.id, title: "📦 وصلت بضاعة للمستودع", message: `استلم المستودع الصنف "${item.itemName}" بتكلفة فعلية ${input.actualUnitCost} ر.س من المورد ${input.supplierName}`, type: "info", relatedPOId: item.purchaseOrderId });
    }
    await db.createAuditLog({ userId: ctx.user.id, action: "deliver_to_warehouse", entityType: "po_item", entityId: input.itemId, newValues: { supplierName: input.supplierName, actualUnitCost: input.actualUnitCost } });
    return { success: true };
  }),

  confirmItemPurchase: delegateProcedure.input(z.object({
    itemId: z.number(),
    purchasedPhotoUrl: z.string().min(1, "صورة الصنف المشترى مطلوبة"),
    invoicePhotoUrl: z.string().min(1, "صورة الفاتورة مطلوبة"),
  })).mutation(async ({ input, ctx }) => {
    // Admin/owner can confirm purchase for any item; delegate only for their own
    const isAdminOrOwner = ctx.user.role === "admin" || ctx.user.role === "owner";
    let item: any;
    if (isAdminOrOwner) {
      item = await db.getPOItemById(input.itemId);
    } else {
      const allItems = await db.getPOItemsByDelegate(ctx.user.id);
      item = allItems.find(i => i.id === input.itemId);
    }
    if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "الصنف غير موجود أو غير مخصص لك" });
    if (item.status !== "approved" && item.status !== "funded") {
      throw new TRPCError({ code: "BAD_REQUEST", message: "لا يمكن تأكيد شراء هذا الصنف في حالته الحالية" });
    }
    await db.updatePOItem(input.itemId, {
      status: "purchased",
      purchasedAt: new Date(),
      purchasedById: ctx.user.id,
      purchasedPhotoUrl: input.purchasedPhotoUrl,
      invoicePhotoUrl: input.invoicePhotoUrl,
    });
    // Update PO status (Path C: do not change ticket status — gate security controls it)
    const poItems = await db.getPOItems(item.purchaseOrderId);
    const activeItemsPurch = poItems.filter(i => i.status !== "rejected" && i.status !== "cancelled");
    const purchasedOrLater = activeItemsPurch.filter(i => ["purchased", "delivered_to_warehouse", "delivered_to_requester"].includes(i.status));
    const poForPath = await db.getPurchaseOrderById(item.purchaseOrderId);
    const ticketForPath = poForPath?.ticketId ? await db.getTicketById(poForPath.ticketId) : null;
    const isPathC = ticketForPath?.maintenancePath === "C";
    if (activeItemsPurch.length > 0 && purchasedOrLater.length === activeItemsPurch.length) {
      await db.updatePurchaseOrder(item.purchaseOrderId, { status: "purchased" });
      if (poForPath?.ticketId && !isPathC) {
        await db.updateTicket(poForPath.ticketId, { status: "purchased" });
      }
    } else if (purchasedOrLater.length > 0) {
      await db.updatePurchaseOrder(item.purchaseOrderId, { status: "partial_purchase" });
      if (poForPath?.ticketId && !isPathC) {
        await db.updateTicket(poForPath.ticketId, { status: "partial_purchase" });
      }
    }
    // Notify warehouse with detailed message
    const warehouseUsers = await db.getUsersByRole("warehouse");
    const po = await db.getPurchaseOrderById(item.purchaseOrderId);
    const buyer = ctx.user;
    for (const w of warehouseUsers) {
      await db.createNotification({
        userId: w.id,
        title: "📦 صنف تم شراؤه - بانتظار الاستلام",
        message: `تم شراء الصنف: "${item.itemName}" (الكمية: ${item.quantity} ${item.unit || ''}). طلب الشراء رقم: ${po?.poNumber || item.purchaseOrderId}. المندوب: ${buyer.name}. يرجى تسجيل استلام البضاعة عند وصولها.`,
        type: "info",
        relatedPOId: item.purchaseOrderId
      });
    }
    // Also notify managers/owner
    const managers = await db.getManagerUsers();
    for (const mgr of managers) {
      await db.createNotification({
        userId: mgr.id,
        title: "🛒 تم شراء صنف",
        message: `قام ${buyer.name} بشراء صنف "${item.itemName}" من طلب الشراء رقم ${po?.poNumber || item.purchaseOrderId}.`,
        type: "info",
        relatedPOId: item.purchaseOrderId
      });
    }
    await db.createAuditLog({ userId: ctx.user.id, action: "confirm_purchase", entityType: "po_item", entityId: input.itemId });
    return { success: true };
  }),

  create: protectedProcedure.input(z.object({
    ticketId: z.number().optional(),
    notes: z.string().optional(),
    items: z.array(z.object({
      itemName: z.string().min(1),
      description: z.string().optional(),
      quantity: z.number().min(1),
      unit: z.string().optional(),
      photoUrl: z.string().optional(),
      notes: z.string().optional(),
      delegateId: z.number().optional(),
    })),
  })).mutation(async ({ input, ctx }) => {
    // ✅ Batching Limit: Max 15 items per PO
    if (input.items.length === 0) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "يجب إضافة صنف واحد على الأقل" });
    }
    if (input.items.length > 15) {
      throw new TRPCError({ code: "BAD_REQUEST", message: `الحد الأقصى 15 صنف لكل طلب شراء. لديك ${input.items.length} صنف` });
    }
    const poNumber = await db.getNextPONumber();
    const poId = await db.createPurchaseOrder({
      poNumber,
      ticketId: input.ticketId,
      requestedById: ctx.user.id,
      status: "pending_review",
      notes: input.notes,
    });
    // delegateId is optional at creation — assigned during reviewItems step
    const itemsData = input.items.map(item => ({ ...item, purchaseOrderId: poId!, status: "pending" }));
    await db.createPOItems(itemsData);
    // Update ticket status if linked (Path C: keep at work_approved — gate security controls status)
    if (input.ticketId) {
      const ticket = await db.getTicketById(input.ticketId);
      if (ticket && ticket.maintenancePath !== "C") {
        await db.updateTicket(input.ticketId, { status: "needs_purchase" });
        await db.addTicketStatusHistory({ ticketId: input.ticketId, fromStatus: ticket.status, toStatus: "needs_purchase", changedById: ctx.user.id });
      }
    }
    // Notify maintenance managers, owners, and admins about the new PO
    const managers = await db.getManagerUsers();
    for (const mgr of managers) {
      if (mgr.id !== ctx.user.id) {
        await db.createNotification({
          userId: mgr.id,
          title: `🛒 طلب شراء جديد #${poNumber}`,
          message: `قام ${ctx.user.name} بإنشاء طلب شراء جديد يحتوي على ${input.items.length} صنف. بانتظار المراجعة.`,
          type: "warning",
          relatedPOId: poId!,
        });
      }
    }
    // Delegate notifications are sent in reviewItems after delegates are assigned
    await db.createAuditLog({ userId: ctx.user.id, action: "create_po", entityType: "purchase_order", entityId: poId! });
    return { id: poId, poNumber };
  }),

  delete: protectedProcedure.input(z.object({ id: z.number() })).mutation(async ({ input, ctx }) => {
    const po = await db.getPurchaseOrderById(input.id);
    if (!po) throw new TRPCError({ code: "NOT_FOUND", message: "طلب الشراء غير موجود" });
    if (!["owner", "admin", "maintenance_manager", "purchase_manager"].includes(ctx.user.role)) {
      throw new TRPCError({ code: "FORBIDDEN", message: "ليس لديك صلاحية لحذف طلبات الشراء" });
    }
    if (["funded", "partially_purchased", "completed"].includes(po.status)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "لا يمكن حذف طلب شراء مموّل أو مكتمل" });
    }
    await db.deletePurchaseOrder(input.id);
    await db.createAuditLog({ userId: ctx.user.id, action: "delete_po", entityType: "purchase_order", entityId: input.id, oldValues: { poNumber: po.poNumber, status: po.status, notes: po.notes } });
    // Notify managers about PO deletion
    const poDelManagers = await db.getManagerUsers();
    for (const mgr of poDelManagers) {
      if (mgr.id !== ctx.user.id) {
        await db.createNotification({ userId: mgr.id, title: `حذف طلب شراء #${po.poNumber}`, message: `قام ${ctx.user.name} بحذف طلب الشراء`, type: "po_deleted", relatedPOId: input.id });
      }
    }
    return { success: true };
  }),

  deleteItem: protectedProcedure.input(z.object({ id: z.number(), purchaseOrderId: z.number() })).mutation(async ({ input, ctx }) => {
    const po = await db.getPurchaseOrderById(input.purchaseOrderId);
    if (!po) throw new TRPCError({ code: "NOT_FOUND" });
    if (!["pending_estimate", "pending_accounting"].includes(po.status)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "لا يمكن حذف صنف من طلب معتمد" });
    }
    const item = await db.getPOItemById(input.id);
    await db.deletePOItem(input.id);
    await db.createAuditLog({ userId: ctx.user.id, action: "delete_po_item", entityType: "purchase_order_item", entityId: input.id, oldValues: { itemName: item?.itemName, quantity: item?.quantity } });
    return { success: true };
  }),

  editItem: protectedProcedure.input(z.object({
    id: z.number(),
    purchaseOrderId: z.number(),
    itemName: z.string().optional(),
    description: z.string().optional(),
    quantity: z.number().optional(),
    unit: z.string().optional(),
    photoUrl: z.string().optional(),
    notes: z.string().optional(),
    estimatedUnitCost: z.string().optional(),
  })).mutation(async ({ input, ctx }) => {
    const po = await db.getPurchaseOrderById(input.purchaseOrderId);
    if (!po) throw new TRPCError({ code: "NOT_FOUND" });
    if (!['pending_estimate', 'pending_accounting', 'draft', 'revision_needed'].includes(po.status)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "لا يمكن تعديل صنف في طلب معتمد أو ممول" });
    }

    // Enforce creator-only editing when status is 'revision_needed'
    if (po.status === 'revision_needed' && po.requestedById !== ctx.user.id) {
      throw new TRPCError({ code: "FORBIDDEN", message: "فقط منشئ الطلب يمكنه تعديل الأصناف عند طلب المراجعة" });
    }
    const oldItem = await db.getPOItemById(input.id);
    if (!oldItem) throw new TRPCError({ code: "NOT_FOUND" });
    const updates: any = {};
    if (input.itemName !== undefined) updates.itemName = input.itemName;
    if (input.description !== undefined) updates.description = input.description;
    if (input.quantity !== undefined) updates.quantity = input.quantity;
    if (input.unit !== undefined) updates.unit = input.unit;
    if (input.photoUrl !== undefined) updates.photoUrl = input.photoUrl;
    if (input.notes !== undefined) updates.notes = input.notes;
    if (input.estimatedUnitCost !== undefined) {
      updates.estimatedUnitCost = input.estimatedUnitCost;
      updates.estimatedTotalCost = String(parseFloat(input.estimatedUnitCost) * (input.quantity || oldItem.quantity));
    } else if (input.quantity !== undefined && oldItem.estimatedUnitCost) {
      updates.estimatedTotalCost = String(parseFloat(oldItem.estimatedUnitCost) * input.quantity);
    }
    await db.updatePOItem(input.id, updates);
    await db.createAuditLog({
      userId: ctx.user.id, action: "update", entityType: "purchase_order_item", entityId: input.id,
      oldValues: { itemName: oldItem.itemName, description: oldItem.description, quantity: oldItem.quantity, unit: oldItem.unit, estimatedUnitCost: oldItem.estimatedUnitCost, photoUrl: oldItem.photoUrl, notes: oldItem.notes },
      newValues: updates,

    });
    return { success: true };
  }),

  estimateCost: delegateProcedure.input(z.object({
    purchaseOrderId: z.number(),
    items: z.array(z.object({
      id: z.number(),
      estimatedUnitCost: z.string(),
    })),
  })).mutation(async ({ input, ctx }) => {
    let totalEstimated = 0;
    for (const item of input.items) {
      const cost = parseFloat(item.estimatedUnitCost);
      const poItem = (await db.getPOItems(input.purchaseOrderId)).find(i => i.id === item.id);
      // Guard: item must have a delegateId assigned before it can be estimated
      if (!poItem?.delegateId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `الصنف "${poItem?.itemName || item.id}" لا يمكن تسعيره قبل تعيين مندوب له` });
      }
      const totalCost = cost * (poItem?.quantity || 1);
      totalEstimated += totalCost;
      await db.updatePOItem(item.id, { estimatedUnitCost: item.estimatedUnitCost, estimatedTotalCost: String(totalCost), status: "estimated" });
    }
    // Check if all items are estimated (excluding rejected/cancelled items)
    const allItems = await db.getPOItems(input.purchaseOrderId);
    const allEstimated = allItems.every(i => i.status === "estimated" || i.status === "rejected" || i.status === "cancelled");
    if (allEstimated) {
      // Recalculate total estimated cost to ensure we only sum non-rejected/non-cancelled items
      const finalTotalEstimated = allItems.filter(i => i.status !== "rejected" && i.status !== "cancelled").reduce((sum, i) => sum + parseFloat(i.estimatedTotalCost || "0"), 0);
      await db.updatePurchaseOrder(input.purchaseOrderId, { status: "pending_accounting", totalEstimatedCost: String(finalTotalEstimated) });
      // Notify accountants
      const accountants = await db.getUsersByRole("accountant");
      for (const acc of accountants) {
        await db.createNotification({ userId: acc.id, title: "طلب شراء بانتظار الاعتماد", message: `طلب شراء بانتظار اعتماد الحسابات`, type: "warning", relatedPOId: input.purchaseOrderId });
      }
    }
    return { success: true };
  }),

  getById: protectedProcedure.input(z.object({ id: z.number() })).query(async ({ input }) => {
    const po = await db.getPurchaseOrderById(input.id);
    if (!po) throw new TRPCError({ code: "NOT_FOUND", message: "طلب الشراء غير موجود" });
    const items = await db.getPOItems(input.id);
    const comments = await db.getProcurementComments(input.id);
    return { ...po, items, comments };
  }),

  list: protectedProcedure.input(z.object({ status: z.string().optional() }).optional()).query(async ({ input, ctx }) => {
    const role = ctx.user.role;
    let filters: any = input || {};
    
    if (role === "purchase_requester") {
      // Purchase requesters only see their own requests
      filters.requestedById = ctx.user.id;
      return db.getPurchaseOrders(filters);
    }
    
    if (role === "delegate") {
      // Delegates see POs that have items assigned to them
      const items = await db.getPOItemsByDelegate(ctx.user.id);
      const poIds = Array.from(new Set(items.map(i => i.purchaseOrderId)));
      if (poIds.length === 0) return [];
      const allPOs = await db.getPurchaseOrders(filters);
      return allPOs.filter(po => poIds.includes(po.id));
    }
    return db.getPurchaseOrders(filters);
  }),

  myItems: protectedProcedure.query(async ({ ctx }) => {
    const isAdminOrOwner = ctx.user.role === "admin" || ctx.user.role === "owner";
    if (isAdminOrOwner) {
      // Admin/owner see all items
      return db.getAllPOItems();
    }
    if (ctx.user.role !== "delegate") return [];
    return db.getPOItemsByDelegate(ctx.user.id);
  }),

  pendingDeliveryItems: protectedProcedure.query(async ({ ctx }) => {
    const isAdminOrOwner = ctx.user.role === "admin" || ctx.user.role === "owner";
    if (isAdminOrOwner || ctx.user.role === "warehouse") {
      const items = await db.getPOItemsByStatus("delivered_to_warehouse");
      // Enrich each item with the assignedToId from the linked ticket
      const enriched = await Promise.all(items.map(async (item: any) => {
        const po = await db.getPurchaseOrderById(item.purchaseOrderId);
        if (po?.ticketId) {
          const ticket = await db.getTicketById(po.ticketId);
          return { ...item, ticketAssignedToId: ticket?.assignedToId ?? null };
        }
        return { ...item, ticketAssignedToId: null };
      }));
      return enriched;
    }
    return [];
  }),

  pendingPurchaseItems: protectedProcedure.query(async ({ ctx }) => {
    const isAdminOrOwner = ctx.user.role === "admin" || ctx.user.role === "owner";
    if (isAdminOrOwner) {
      // Admin/owner see all approved/funded items
      const approved = await db.getPOItemsByStatus("approved");
      const funded = await db.getPOItemsByStatus("funded");
      return [...approved, ...funded];
    }
    if (ctx.user.role !== "delegate") return [];
    const items = await db.getPOItemsByDelegate(ctx.user.id);
    return items.filter(i => i.status === "approved" || i.status === "funded");
  }),

  pendingWarehouseItems: protectedProcedure.query(async ({ ctx }) => {
    const isAdminOrOwner = ctx.user.role === "admin" || ctx.user.role === "owner";
    if (isAdminOrOwner || ctx.user.role === "warehouse") {
      return db.getPOItemsByStatus("purchased");
    }
    return [];
  }),

  requestRevision: delegateProcedure.input(z.object({
    id: z.number(),
    note: z.string().min(5, "يجب كتابة سبب طلب المراجعة (بحد أدنى 5 أحرف)"),
  })).mutation(async ({ input, ctx }) => {
    const po = await db.getPurchaseOrderById(input.id);
    if (!po) throw new TRPCError({ code: "NOT_FOUND" });

    // Reset all approvals and set to revision_needed
    await db.updatePurchaseOrder(input.id, {
      status: "revision_needed",
      accountingApprovedById: null,
      accountingApprovedAt: null,
      managementApprovedById: null,
      managementApprovedAt: null,
      totalEstimatedCost: null,
    });

    // Reset all items status to pending
    const items = await db.getPOItems(input.id);
    for (const item of items) {
      await db.updatePOItem(item.id, { status: "pending", estimatedUnitCost: null, estimatedTotalCost: null });
    }

    // Add immutable comment
    await db.createProcurementComment({
      purchaseOrderId: input.id,
      userId: ctx.user.id,
      userName: ctx.user.name || "User",
      userRole: ctx.user.role,
      actionType: "return_for_revision",
      note: input.note,
    });

    // Notify the creator
    await db.createNotification({
      userId: po.requestedById,
      title: "⚠️ طلب مراجعة لطلب شراء",
      message: `قام المندوب ${ctx.user.name} بإعادة طلب الشراء #${po.poNumber} للمراجعة: ${input.note}`,
      type: "warning",
      relatedPOId: input.id
    });

    await db.createAuditLog({ userId: ctx.user.id, action: "request_revision", entityType: "purchase_order", entityId: input.id, newValues: { status: "revision_needed", note: input.note } });
    return { success: true };
  }),

  resubmit: protectedProcedure.input(z.object({
    id: z.number(),
    note: z.string().optional(),
  })).mutation(async ({ input, ctx }) => {
    const po = await db.getPurchaseOrderById(input.id);
    if (!po) throw new TRPCError({ code: "NOT_FOUND" });
    if (po.requestedById !== ctx.user.id) throw new TRPCError({ code: "FORBIDDEN", message: "فقط منشئ الطلب يمكنه إعادة التقديم" });
    if (po.status !== "revision_needed") throw new TRPCError({ code: "BAD_REQUEST", message: "الطلب ليس في حالة مراجعة" });

    await db.updatePurchaseOrder(input.id, { status: "pending_review" });

    await db.createProcurementComment({
      purchaseOrderId: input.id,
      userId: ctx.user.id,
      userName: ctx.user.name || "User",
      userRole: ctx.user.role,
      actionType: "resubmitted",
      note: input.note || "تم تعديل الطلب وإعادة التقديم",
    });

    await db.createAuditLog({ userId: ctx.user.id, action: "resubmit_po", entityType: "purchase_order", entityId: input.id });
    return { success: true };
  }),

  update: protectedProcedure.input(z.object({
    id: z.number(),
    notes: z.string().optional(),
  })).mutation(async ({ input, ctx }) => {
    const po = await db.getPurchaseOrderById(input.id);
    if (!po) throw new TRPCError({ code: "NOT_FOUND", message: "طلب الشراء غير موجود" });
    if (!["pending_estimate", "pending_accounting"].includes(po.status)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "لا يمكن تعديل طلب شراء معتمد" });
    }
    const oldValues = { notes: po.notes };
    await db.updatePurchaseOrder(input.id, { notes: input.notes });
    await db.createAuditLog({ userId: ctx.user.id, action: "update_po", entityType: "purchase_order", entityId: input.id, oldValues, newValues: { notes: input.notes } });
    // Notify managers about PO edit
    const poManagers = await db.getManagerUsers();
    for (const mgr of poManagers) {
      if (mgr.id !== ctx.user.id) {
        await db.createNotification({ userId: mgr.id, title: `تعديل طلب شراء #${po.poNumber}`, message: `قام ${ctx.user.name} بتعديل طلب الشراء`, type: "po_updated", relatedPOId: input.id });
      }
    }
    return { success: true };
  }),
});

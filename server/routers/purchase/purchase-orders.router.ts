import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { router, protectedProcedure, managerProcedure, warehouseProcedure, delegateProcedure } from "../_shared/procedures";
import * as db from "../../db";
import { notifyOwner } from "../../_core/notification";
import { detectLanguage } from "../../services/translation";
import { queueTranslation } from "../../translationEngine";
import { notifyItemRejection } from "../_shared/router-helpers";

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
    const po = await db.getPurchaseOrderById(item.purchaseOrderId);
    const cancelReason = input.reason || "تم الإلغاء من قبل الإدارة";
    await db.updatePOItem(input.itemId, {
      status: "cancelled",
      managementRejectionReason: cancelReason,
    });
    if (po) {
      await notifyItemRejection({
        poId: po.id,
        poNumber: po.poNumber,
        requestedById: po.requestedById,
        itemName: item.itemName,
        actorId: ctx.user.id,
        actorName: ctx.user.name || "مستخدم",
        actorRole: ctx.user.role,
        reason: cancelReason,
        kind: "cancelled",
      });
    }
    // Check if all items are now terminal (rejected or cancelled) — auto-close PO if so
    const allItems = await db.getPOItems(item.purchaseOrderId);
    const allTerminal = allItems.every(i => i.status === "rejected" || i.status === "cancelled");
    if (allTerminal && po) {
      await db.updatePurchaseOrder(item.purchaseOrderId, {
        status: "rejected",
        rejectedById: ctx.user.id,
        rejectedAt: new Date(),
        rejectionReason: `تم إلغاء جميع أصناف طلب الشراء بواسطة ${ctx.user.name}`,
      });
      await db.createNotification({ userId: po.requestedById, title: "⚠️ تم إلغاء جميع أصناف طلب الشراء", message: `تم إلغاء جميع أصناف طلب الشراء رقم ${po.poNumber} بواسطة ${ctx.user.name}.`, type: "warning", relatedPOId: item.purchaseOrderId });
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

  cancelItemPurchase: delegateProcedure.input(z.object({
    itemId: z.number(),
    note: z.string().min(3, "يجب كتابة سبب إلغاء الشراء"),
  })).mutation(async ({ input, ctx }) => {
    // المندوب يلغي شراء صنفه فقط، والأدمن/الأونر أي صنف
    const isAdminOrOwner = ctx.user.role === "admin" || ctx.user.role === "owner";
    let item: any;
    if (isAdminOrOwner) {
      item = await db.getPOItemById(input.itemId);
    } else {
      const allItems = await db.getPOItemsByDelegate(ctx.user.id);
      item = allItems.find(i => i.id === input.itemId);
    }
    if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "الصنف غير موجود أو غير مخصص لك" });

    // يُسمح بالإلغاء فقط للأصناف الجاهزة للشراء (approved أو funded)
    if (item.status !== "approved" && item.status !== "funded") {
      throw new TRPCError({ code: "BAD_REQUEST", message: "لا يمكن إلغاء شراء هذا الصنف في حالته الحالية" });
    }

    const po = await db.getPurchaseOrderById(item.purchaseOrderId);
    if (!po) throw new TRPCError({ code: "NOT_FOUND", message: "طلب الشراء غير موجود" });

    // تحديث الصنف لحالة إلغاء الشراء مع اسم المندوب الكامل
    await db.updatePOItem(input.itemId, {
      status: "purchase_cancelled",
      purchaseCancelReason: input.note,
      purchaseCancelledById: ctx.user.id,
      purchaseCancelledByName: ctx.user.name || "مندوب",
      purchaseCancelledAt: new Date(),
    });

    // تعليق دائم في سجل الطلب
    await db.createProcurementComment({
      purchaseOrderId: po.id,
      userId: ctx.user.id,
      userName: ctx.user.name || "مندوب",
      userRole: ctx.user.role,
      actionType: "purchase_cancelled",
      note: `الصنف: ${item.itemName}\n\nسبب إلغاء الشراء:\n${input.note}`,
    });

    // أخطر منشئ الطلب — الصنف بانتظار تصرفه: تعديل وإعادة إرسال، أو إلغاء نهائي
    await db.createNotification({
      userId: po.requestedById,
      title: "⛔ تعذّر شراء صنف - يحتاج تصرفك",
      message: `قام المندوب ${ctx.user.name} بإلغاء شراء الصنف "${item.itemName}" من طلب الشراء ${po.poNumber}.\n\nالسبب:\n${input.note}\n\nيمكنك تعديل الصنف وإعادة إرساله للمندوب مباشرة للشراء، أو إلغاءه نهائياً.`,
      type: "warning",
      relatedPOId: po.id,
    });

    // إعادة حساب حالة الطلب
    // الصنف في purchase_cancelled لم يُحسم مصيره بعد (بانتظار منشئ الطلب) — تماماً كـ needs_item_revision
    // لذلك لا يدخل في حساب "شراء كامل"، ويبقي الطلب شراء جزئي حتى يُحسم
    const allItems = await db.getPOItems(item.purchaseOrderId);
    const activeItems = allItems.filter(
      i => !["rejected", "cancelled", "needs_item_revision", "purchase_cancelled"].includes(i.status)
    );
    const purchasedOrLater = activeItems.filter(i =>
      ["purchased", "delivered_to_warehouse", "delivered_to_requester"].includes(i.status)
    );
    const ticketForPath = po.ticketId ? await db.getTicketById(po.ticketId) : null;
    const isPathC = ticketForPath?.maintenancePath === "C";
    // أي صنف لم يُحسم بعد (مراجعة أو إلغاء شراء معلّق) يجعل الطلب "شراء جزئي" دائماً
    const hasPendingItems = allItems.some(i => i.status === "needs_item_revision" || i.status === "purchase_cancelled");

    if (activeItems.length > 0 && purchasedOrLater.length === activeItems.length) {
      // كل الأصناف الفعّالة اشتُريت → شراء كامل فقط إذا لا يوجد صنف معلّق بانتظار حسم
      const newStatus = hasPendingItems ? "partial_purchase" : "purchased";
      await db.updatePurchaseOrder(item.purchaseOrderId, { status: newStatus });
      if (po.ticketId && !isPathC) {
        await db.updateTicket(po.ticketId, { status: newStatus });
      }
    } else if (activeItems.length === 0 && !hasPendingItems) {
      // كل الأصناف ملغاة أو مرفوضة (ولا يوجد معلّق) → الطلب منتهٍ
      await db.updatePurchaseOrder(item.purchaseOrderId, { status: "received" });
    } else {
      // يوجد صنف معلّق بانتظار حسم منشئ الطلب → الطلب شراء جزئي دائماً
      await db.updatePurchaseOrder(item.purchaseOrderId, { status: "partial_purchase" });
      if (po.ticketId && !isPathC) {
        await db.updateTicket(po.ticketId, { status: "partial_purchase" });
      }
    }

    await db.createAuditLog({
      userId: ctx.user.id,
      action: "cancel_item_purchase",
      entityType: "po_item",
      entityId: input.itemId,
      newValues: { status: "purchase_cancelled", note: input.note },
    });

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
    // الأصناف في needs_item_revision لم تصل لمرحلة الشراء بعد → لا تُحسب ضمن الأصناف الفعّالة الآن
    const activeItemsPurch = poItems.filter(
      i => !["rejected", "cancelled", "needs_item_revision", "purchase_cancelled"].includes(i.status)
    );
    const purchasedOrLater = activeItemsPurch.filter(i =>
      ["purchased", "delivered_to_warehouse", "delivered_to_requester"].includes(i.status)
    );
    const poForPath = await db.getPurchaseOrderById(item.purchaseOrderId);
    const ticketForPath = poForPath?.ticketId ? await db.getTicketById(poForPath.ticketId) : null;
    const isPathC = ticketForPath?.maintenancePath === "C";
    if (activeItemsPurch.length > 0 && purchasedOrLater.length === activeItemsPurch.length) {
      // كل الأصناف الفعّالة اشتُريت — لكن في needs_item_revision؟ إذن هو شراء جزئي
      const hasRevisionItems = poItems.some(i => i.status === "needs_item_revision");
      const newStatus = hasRevisionItems ? "partial_purchase" : "purchased";
      await db.updatePurchaseOrder(item.purchaseOrderId, { status: newStatus });
      if (poForPath?.ticketId && !isPathC) {
        await db.updateTicket(poForPath.ticketId, { status: newStatus });
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

  saveDraft: protectedProcedure.input(z.object({
    ticketId: z.number().optional(),
    notes: z.string().optional(),
    items: z.array(z.object({
      itemName: z.string().min(1),
      description: z.string().optional(),
      quantity: z.number().min(1),
      unit: z.string().optional(),
      photoUrl: z.string().optional(),
      photoUrls: z.array(z.string()).optional(),
      notes: z.string().optional(),
    })),
  })).mutation(async ({ input, ctx }) => {
    if (input.items.length === 0) throw new TRPCError({ code: "BAD_REQUEST", message: "يجب إضافة صنف واحد على الأقل" });
    if (input.items.length > 20) throw new TRPCError({ code: "BAD_REQUEST", message: `الحد الأقصى 20 صنف لكل طلب شراء` });

    const poNumber = await db.getNextPONumber();
    const poId = await db.createPurchaseOrder({
      poNumber,
      ticketId: input.ticketId,
      requestedById: ctx.user.id,
      status: "draft",
      notes: input.notes,
    });

    const itemsData = input.items.map(item => ({ ...item, purchaseOrderId: poId!, status: "pending" }));
    await db.createPOItems(itemsData);

    await db.createAuditLog({ userId: ctx.user.id, action: "save_draft_po", entityType: "purchase_order", entityId: poId! });
    return { id: poId, poNumber };
  }),

  submitDraft: protectedProcedure.input(z.object({
    id: z.number(),
  })).mutation(async ({ input, ctx }) => {
    const po = await db.getPurchaseOrderById(input.id);
    if (!po) throw new TRPCError({ code: "NOT_FOUND", message: "طلب الشراء غير موجود" });
    if (po.status !== "draft") throw new TRPCError({ code: "BAD_REQUEST", message: "الطلب ليس مسودة" });
    if (String(po.requestedById) !== String(ctx.user.id) && !["admin", "owner"].includes(ctx.user.role)) {
      throw new TRPCError({ code: "FORBIDDEN", message: "فقط منشئ الطلب يمكنه إرساله" });
    }

    const items = await db.getPOItems(input.id);
    if (items.length === 0) throw new TRPCError({ code: "BAD_REQUEST", message: "لا يوجد أصناف في الطلب" });

    await db.updatePurchaseOrder(input.id, { status: "pending_review" });

    // أخطر المدراء
    const managers = await db.getManagerUsers();
    for (const mgr of managers) {
      if (mgr.id !== ctx.user.id) {
        await db.createNotification({
          userId: mgr.id,
          title: `🛒 طلب شراء جديد #${po.poNumber}`,
          message: `قام ${ctx.user.name} بإرسال طلب شراء يحتوي على ${items.length} صنف. بانتظار المراجعة.`,
          type: "warning",
          relatedPOId: input.id,
        });
      }
    }

    // تحديث التذكرة إذا مرتبطة
    if (po.ticketId) {
      const ticket = await db.getTicketById(po.ticketId);
      if (ticket && ticket.maintenancePath !== "C") {
        await db.updateTicket(po.ticketId, { status: "needs_purchase" });
      }
    }

    await db.createAuditLog({ userId: ctx.user.id, action: "submit_draft_po", entityType: "purchase_order", entityId: input.id });
    return { success: true };
  }),

  updateDraft: protectedProcedure.input(z.object({
    id: z.number(),
    notes: z.string().optional(),
    items: z.array(z.object({
      id: z.number().optional(), // موجود = تحديث، غير موجود = إضافة جديد
      itemName: z.string().min(1),
      description: z.string().optional(),
      quantity: z.number().min(1),
      unit: z.string().optional(),
      photoUrl: z.string().optional(),
      photoUrls: z.array(z.string()).optional(),
      notes: z.string().optional(),
    })),
  })).mutation(async ({ input, ctx }) => {
    const po = await db.getPurchaseOrderById(input.id);
    if (!po) throw new TRPCError({ code: "NOT_FOUND", message: "المسودة غير موجودة" });
    if (po.status !== "draft") throw new TRPCError({ code: "BAD_REQUEST", message: "لا يمكن تعديل طلب ليس مسودة" });
    if (String(po.requestedById) !== String(ctx.user.id) && !["admin", "owner"].includes(ctx.user.role)) {
      throw new TRPCError({ code: "FORBIDDEN", message: "فقط منشئ المسودة يمكنه تعديلها" });
    }
    if (input.items.length > 20) throw new TRPCError({ code: "BAD_REQUEST", message: "الحد الأقصى 20 صنف" });

    // تحديث ملاحظات الطلب
    await db.updatePurchaseOrder(input.id, { notes: input.notes || null });

    // جلب الأصناف الحالية
    const existingItems = await db.getPOItems(input.id);
    const existingIds = new Set(existingItems.map((i: any) => i.id));

    // الأصناف التي أُرسلت من الواجهة
    const submittedIds = new Set(input.items.filter(i => i.id).map(i => i.id!));

    // احذف الأصناف التي لم تعد موجودة في القائمة (حذف نهائي)
    for (const existing of existingItems) {
      if (!submittedIds.has(existing.id)) {
        await db.deletePOItem(existing.id);
      }
    }

    // تحديث الموجود أو إضافة جديد
    for (const item of input.items) {
      if (item.id && existingIds.has(item.id)) {
        // تحديث صنف موجود
        await db.updatePOItem(item.id, {
          itemName: item.itemName,
          description: item.description || null,
          quantity: item.quantity,
          unit: item.unit || null,
          photoUrl: item.photoUrl || null,
          photoUrls: item.photoUrls || null,
          notes: item.notes || null,
        });
      } else {
        // إضافة صنف جديد
        await db.createPOItems([{
          purchaseOrderId: input.id,
          itemName: item.itemName,
          description: item.description || null,
          quantity: item.quantity,
          unit: item.unit || null,
          photoUrl: item.photoUrl || null,
          photoUrls: item.photoUrls || null,
          notes: item.notes || null,
          status: "pending",
        }]);
      }
    }

    await db.createAuditLog({ userId: ctx.user.id, action: "update_draft_po", entityType: "purchase_order", entityId: input.id });
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
      photoUrls: z.array(z.string()).optional(),
      notes: z.string().optional(),
      delegateId: z.number().optional(),
    })),
  })).mutation(async ({ input, ctx }) => {
    // ✅ Batching Limit: Max 20 items per PO
    if (input.items.length === 0) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "يجب إضافة صنف واحد على الأقل" });
    }
    if (input.items.length > 20) {
      throw new TRPCError({ code: "BAD_REQUEST", message: `الحد الأقصى 20 صنف لكل طلب شراء. لديك ${input.items.length} صنف` });
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

    // ترجمة حقول PO في الخلفية
    if (input.notes) {
      queueTranslation({
        entityType: "PO",
        entityId: poId!,
        fields: [{ fieldName: "notes", text: input.notes }],
        sourceLanguage: await detectLanguage(input.notes).catch(() => "ar" as const),
        userId: ctx.user.id,
      }).catch(e => console.error("[PO] Queue translation failed:", e));
    }

    // ترجمة أسماء وأوصاف الأصناف في الخلفية
    const poItemsCreated = await db.getPOItems(poId!);
    for (const item of poItemsCreated) {
      if (item.itemName) {
        queueTranslation({
          entityType: "PO_ITEM",
          entityId: item.id,
          fields: [
            { fieldName: "itemName", text: item.itemName },
            ...(item.description ? [{ fieldName: "description", text: item.description }] : []),
            ...(item.notes ? [{ fieldName: "notes", text: item.notes }] : []),
          ],
          sourceLanguage: await detectLanguage(item.itemName).catch(() => "ar" as const),
          userId: ctx.user.id,
        }).catch(e => console.error("[PO_ITEM] Queue translation failed:", e));
      }
    }

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
    if (!["owner", "admin"].includes(ctx.user.role)) {
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

    const item = await db.getPOItemById(input.id);
    if (!item) throw new TRPCError({ code: "NOT_FOUND" });

    const isCreator = po.requestedById === ctx.user.id;
    // الأدوار المسموح لها بحذف صنف من طلب الشراء بشكل عام (تطابق صلاحية editItem)
    const isPrivilegedRole = ["owner", "admin", "maintenance_manager"].includes(ctx.user.role);

    // استثناء منشئ الطلب: يقدر يحذف صنفاً من طلبه فقط في حالتين:
    // 1) طلب مراجعة من المندوب (على الصنف needs_item_revision أو على كامل الطلب revision_needed)
    // 2) إلغاء شراء الصنف من قبل المندوب (purchase_cancelled)
    const isRevisionCase = item.status === "needs_item_revision" || po.status === "revision_needed";
    const isPurchaseCancelledCase = item.status === "purchase_cancelled";
    const creatorException = isCreator && (isRevisionCase || isPurchaseCancelledCase);

    const editableStatuses = ["draft", "pending_review", "pending_estimate", "pending_accounting", "revision_needed"];
    const isEditableStatus = editableStatuses.includes(po.status);

    if (!creatorException) {
      if (!isPrivilegedRole) {
        throw new TRPCError({ code: "FORBIDDEN", message: "ليس لديك صلاحية لحذف أصناف طلب الشراء" });
      }
      if (!isEditableStatus) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "لا يمكن حذف صنف من طلب معتمد" });
      }
    }

    // عند طلب المراجعة على كامل الطلب (revision_needed)، الحذف مقصور على منشئ الطلب فقط
    if (po.status === "revision_needed" && !isCreator) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "فقط منشئ الطلب يمكنه حذف الأصناف عند طلب المراجعة"
      });
    }

    await db.deletePOItem(input.id);
    await db.createAuditLog({ userId: ctx.user.id, action: "delete_po_item", entityType: "purchase_order_item", entityId: input.id, oldValues: { itemName: item.itemName, quantity: item.quantity } });
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
    lastKnownUpdatedAt: z.string().optional(),
  })).mutation(async ({ input, ctx }) => {
    const po = await db.getPurchaseOrderById(input.purchaseOrderId);
    if (!po) throw new TRPCError({ code: "NOT_FOUND" });

    const oldItem = await db.getPOItemById(input.id);
    if (!oldItem) {
      throw new TRPCError({ code: "NOT_FOUND" });
    }

    const isCreator = po.requestedById === ctx.user.id;
    // الأدوار المسموح لها بتعديل طلب الشراء / الصنف بشكل عام
    const isPrivilegedRole = ["owner", "admin", "maintenance_manager"].includes(ctx.user.role);

    // استثناء منشئ الطلب: يقدر يعدّل طلبه فقط في حالتين:
    // 1) طلب مراجعة من المندوب (على الصنف نفسه needs_item_revision أو على كامل الطلب revision_needed)
    // 2) إلغاء شراء الصنف من قبل المندوب (purchase_cancelled)
    const isRevisionCase = oldItem.status === "needs_item_revision" || po.status === "revision_needed";
    const isPurchaseCancelledCase = oldItem.status === "purchase_cancelled";
    const creatorException = isCreator && (isRevisionCase || isPurchaseCancelledCase);

    // الحالات المسموح فيها بالتعديل العادي (لأصحاب الأدوار المسموح لها)
    const editableStatuses = ['draft', 'pending_review', 'pending_estimate', 'pending_accounting', 'revision_needed'];
    const isEditableStatus = editableStatuses.includes(po.status);

    if (!creatorException) {
      if (!isPrivilegedRole) {
        throw new TRPCError({ code: "FORBIDDEN", message: "ليس لديك صلاحية لتعديل أصناف طلب الشراء" });
      }
      if (!isEditableStatus) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "لا يمكن تعديل صنف في طلب معتمد أو ممول" });
      }
    }

    // عند طلب المراجعة على كامل الطلب (revision_needed)، التعديل مقصور على منشئ الطلب فقط
    if (po.status === 'revision_needed' && !isCreator) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "فقط منشئ الطلب يمكنه تعديل الأصناف عند طلب المراجعة"
      });
    }

    if (
      oldItem.updatedAt &&
      input.lastKnownUpdatedAt &&
      new Date(oldItem.updatedAt).getTime() !==
        new Date(input.lastKnownUpdatedAt).getTime()
    ) {
      throw new TRPCError({
        code: "CONFLICT",
        message: "تم تعديل الصنف بواسطة مستخدم آخر، قم بتحديث الصفحة",
      });
    }
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
      userId: ctx.user.id,
      action: "update_po_item",
      entityType: "purchase_order_item",
      entityId: input.id,
      oldValues: {
        itemName: oldItem.itemName,
        description: oldItem.description,
        quantity: oldItem.quantity,
        unit: oldItem.unit,
        estimatedUnitCost: oldItem.estimatedUnitCost,
        estimatedTotalCost: oldItem.estimatedTotalCost,
        photoUrl: oldItem.photoUrl,
        notes: oldItem.notes,
      },
      newValues: { ...updates },
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
    // اجلب الطلب أولاً لمعرفة حالته الحالية
    const po = await db.getPurchaseOrderById(input.purchaseOrderId);
    if (!po) throw new TRPCError({ code: "NOT_FOUND", message: "طلب الشراء غير موجود" });

    // أي حالة بعد pending_estimate تعني الطلب تقدم وصنف المراجعة يذهب مباشرة لـ approved
    const isAlreadyApproved = ["approved", "partial_purchase", "purchased", "pending_accounting", "pending_management"].includes(po.status);

    for (const item of input.items) {
      const cost = parseFloat(item.estimatedUnitCost);
      const poItem = (await db.getPOItems(input.purchaseOrderId)).find(i => i.id === item.id);
      // Guard: item must have a delegateId assigned before it can be estimated
      if (!poItem?.delegateId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `الصنف "${poItem?.itemName || item.id}" لا يمكن تسعيره قبل تعيين مندوب له` });
      }
      // Guard: المندوب يسعّر أصنافه فقط
      const isAdminOrOwner = ctx.user.role === "admin" || ctx.user.role === "owner";
      if (!isAdminOrOwner && poItem.delegateId !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: `الصنف "${poItem.itemName}" غير مخصص لك` });
      }
      const totalCost = cost * (poItem?.quantity || 1);

      if (isAlreadyApproved) {
        // الطلب معتمد بالفعل: الصنف المعاد إرساله (كان pending بعد resubmit) يذهب مباشرة لـ approved
        // نقبل فقط الأصناف في pending (عادت من المراجعة) أو estimated
        if (!isAdminOrOwner && !["pending", "estimated"].includes(poItem.status)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: `الصنف "${poItem.itemName}" لا يمكن تسعيره في وضعه الحالي` });
        }
        await db.updatePOItem(item.id, {
          estimatedUnitCost: item.estimatedUnitCost,
          estimatedTotalCost: String(totalCost),
          status: "approved",
        });
      } else {
        // ── الوضع الطبيعي: التسعير في مرحلة pending_estimate ──
        await db.updatePOItem(item.id, {
          estimatedUnitCost: item.estimatedUnitCost,
          estimatedTotalCost: String(totalCost),
          status: "estimated",
        });
      }
    }

    const allItems = await db.getPOItems(input.purchaseOrderId);

    if (isAlreadyApproved) {
      // ── الطلب كان معتمداً: تحقق هل اكتملت جميع الأصناف الآن ──
      const stillPending = allItems.some(
        i => i.status === "needs_item_revision" || i.status === "pending" || i.status === "estimated"
      );
      if (!stillPending) {
        // كل الأصناف وصلت لـ approved أو ما بعده
        // المندوب يبدأ شراء الصنف مباشرة من صفحة "أصنافي"
        await db.createNotification({
          userId: ctx.user.id,
          title: "✅ الصنف جاهز للشراء",
          message: `اكتمل تسعير جميع الأصناف في طلب الشراء ${po.poNumber} ويمكنك البدء بالشراء الآن.`,
          type: "success",
          relatedPOId: input.purchaseOrderId,
        });
      }
      return { success: true };
    }

    // ── تحقق هل يمكن تقديم الطلب للمحاسبة ──
    // الأصناف في needs_item_revision تُعدّ "جانباً" مؤقتاً — لا تمنع الباقين من المضي
    const readyForAccounting = allItems.every(
      i =>
        i.status === "estimated" ||
        i.status === "rejected" ||
        i.status === "cancelled" ||
        i.status === "needs_item_revision"
    );
    const hasEstimatedItems = allItems.some(i => i.status === "estimated");

    if (readyForAccounting && hasEstimatedItems) {
      // احسب المجموع فقط من الأصناف المسعّرة (تجاهل المرفوض والملغى والمراجعة)
      const finalTotalEstimated = allItems
        .filter(i => i.status === "estimated")
        .reduce((sum, i) => sum + parseFloat(i.estimatedTotalCost || "0"), 0);

      await db.updatePurchaseOrder(input.purchaseOrderId, {
        status: "pending_accounting",
        totalEstimatedCost: String(finalTotalEstimated),
      });

      // أخطر المحاسبين
      const accountants = await db.getUsersByRole("accountant");
      for (const acc of accountants) {
        await db.createNotification({
          userId: acc.id,
          title: "طلب شراء بانتظار الاعتماد",
          message: `طلب شراء بانتظار اعتماد الحسابات`,
          type: "warning",
          relatedPOId: input.purchaseOrderId,
        });
      }
    }
    // إذا في أصناف لا تزال في needs_item_revision → الطلب يبقى pending_estimate
    return { success: true };
  }),

  getById: protectedProcedure.input(z.object({ id: z.number() })).query(async ({ input }) => {
    const po = await db.getPurchaseOrderById(input.id);
    if (!po) throw new TRPCError({ code: "NOT_FOUND", message: "طلب الشراء غير موجود" });
    const items = await db.getPOItems(input.id);
    const comments = await db.getProcurementComments(input.id);
    return { ...po, items, comments };
  }),

list: protectedProcedure.input(z.object({
  status: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  requestedById: z.number().optional(),
}).optional()).query(async ({ input, ctx }) => {
  const role = ctx.user.role;

  // الأدوار المحدودة: تجاهل فلاتر المستخدم وتثبيت الـ requestedById
  if (role === "purchase_requester") {
    return db.getPurchaseOrders({
      status: input?.status,
      dateFrom: input?.dateFrom,
      dateTo: input?.dateTo,
      requestedById: ctx.user.id, // دائماً طلباته فقط
    });
  }

  if (role === "delegate") {
    const items = await db.getPOItemsByDelegate(ctx.user.id);
    const poIds = Array.from(new Set(items.map(i => i.purchaseOrderId)));
    if (poIds.length === 0) return [];
    const allPOs = await db.getPurchaseOrders({
      status: input?.status,
      dateFrom: input?.dateFrom,
      dateTo: input?.dateTo,
    });
    return allPOs.filter(po => poIds.includes(po.id));
  }

  // الأدوار الكاملة الصلاحيات: تقبل جميع الفلاتر بما فيها requestedById
  return db.getPurchaseOrders({
    status: input?.status,
    dateFrom: input?.dateFrom,
    dateTo: input?.dateTo,
    requestedById: input?.requestedById,
  });
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

  pendingEstimateItems: protectedProcedure.query(async ({ ctx }) => {
    // الأصناف العائدة من المراجعة فقط — حالتها pending لكن طلبها ليس pending_review أو pending_estimate
    // أي طلب في partial_purchase أو approved يعني الصنف عائد من مراجعة ويحتاج تسعير
    const isAdminOrOwner = ctx.user.role === "admin" || ctx.user.role === "owner";

    const getRevisionPendingItems = async (allItems: any[]) => {
      const result = [];
      for (const item of allItems) {
        if (item.status !== "pending") continue;
        const po = await db.getPurchaseOrderById(item.purchaseOrderId);
        // الطلب في partial_purchase أو approved → الصنف عائد من مراجعة
        // أي حالة بعد pending_estimate تعني الصنف عائد من مراجعة ويحتاج تسعير
        if (po && ["partial_purchase", "approved", "purchased", "pending_accounting", "pending_management"].includes(po.status)) {
          result.push({ ...item, purchaseOrderNumber: po.poNumber });
        }
      }
      return result;
    };

    if (isAdminOrOwner) {
      const allPending = await db.getPOItemsByStatus("pending");
      return getRevisionPendingItems(allPending);
    }
    if (ctx.user.role !== "delegate") return [];
    const items = await db.getPOItemsByDelegate(ctx.user.id);
    console.log("[pendingEstimateItems] delegate id:", ctx.user.id, "total items:", items.length, "pending items:", items.filter(i => i.status === "pending").length);
    items.filter(i => i.status === "pending").forEach(i => console.log("  pending item:", i.id, i.itemName, "purchaseOrderId:", i.purchaseOrderId));
    const pendingItems = items.filter(i => i.status === "pending");
    return getRevisionPendingItems(pendingItems);
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

  requestItemRevision: delegateProcedure.input(z.object({
    itemId: z.number(),
    note: z.string().min(5, "يجب كتابة سبب طلب المراجعة"),
  })).mutation(async ({ input, ctx }) => {

    const item = await db.getPOItemById(input.itemId);

    if (!item) {
      throw new TRPCError({ code: "NOT_FOUND", message: "الصنف غير موجود" });
    }

    const po = await db.getPurchaseOrderById(item.purchaseOrderId);

    if (!po) {
      throw new TRPCError({ code: "NOT_FOUND", message: "طلب الشراء غير موجود" });
    }

    // ── تحقق أن المندوب يملك هذا الصنف فعلاً ──
    const isAdminOrOwner = ctx.user.role === "admin" || ctx.user.role === "owner";
    if (!isAdminOrOwner && item.delegateId !== ctx.user.id) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "لا يمكنك طلب مراجعة صنف غير مخصص لك",
      });
    }

    if (po.status !== "pending_estimate") {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "لا يمكن طلب مراجعة الصنف إلا أثناء مرحلة التسعير",
      });
    }

    await db.updatePOItem(item.id, {
      status: "needs_item_revision",
      itemRevisionNote: input.note,
      itemRevisionRequestedById: ctx.user.id,
      itemRevisionRequestedAt: new Date(),
    });

    await db.createProcurementComment({
      purchaseOrderId: po.id,
      userId: ctx.user.id,
      userName: ctx.user.name || "User",
      userRole: ctx.user.role,
      actionType: "item_revision_requested",
      note: `الصنف: ${item.itemName}\n\nالسبب:\n${input.note}`,
    });

    // أخطر منشئ الطلب ليعدّل الصنف
    await db.createNotification({
      userId: po.requestedById,
      title: "⚠️ طلب مراجعة صنف",
      message: `الصنف "${item.itemName}" يحتاج مراجعة.\n\nالسبب:\n${input.note}\n\nيرجى تعديل الصنف وإعادة إرساله.`,
      type: "warning",
      relatedPOId: po.id,
    });

    await db.createAuditLog({
      userId: ctx.user.id,
      action: "request_item_revision",
      entityType: "purchase_order_item",
      entityId: item.id,
      newValues: { status: "needs_item_revision", note: input.note },
    });

    // ── بعد طلب المراجعة: تحقق هل الأصناف الباقية كلها مسعّرة ──
    // السيناريو: المندوب سعّر 2 وطلب مراجعة 2 → الـ 2 المسعّرة يجب أن تمشي للمحاسبة الآن
    const allItemsAfter = await db.getPOItems(po.id);
    const readyForAccounting = allItemsAfter.every(
      i =>
        i.status === "estimated" ||
        i.status === "rejected" ||
        i.status === "cancelled" ||
        i.status === "needs_item_revision"
    );
    // تحقق إضافي: يجب أن يكون في صنف واحد على الأقل مسعّر حتى نتقدم
    const hasEstimatedItems = allItemsAfter.some(i => i.status === "estimated");

    if (readyForAccounting && hasEstimatedItems) {
      const finalTotalEstimated = allItemsAfter
        .filter(i => i.status === "estimated")
        .reduce((sum, i) => sum + parseFloat(i.estimatedTotalCost || "0"), 0);

      await db.updatePurchaseOrder(po.id, {
        status: "pending_accounting",
        totalEstimatedCost: String(finalTotalEstimated),
      });

      const accountants = await db.getUsersByRole("accountant");
      for (const acc of accountants) {
        await db.createNotification({
          userId: acc.id,
          title: "طلب شراء بانتظار الاعتماد",
          message: `طلب شراء رقم ${po.poNumber} بانتظار اعتماد الحسابات (بعض الأصناف قيد المراجعة).`,
          type: "warning",
          relatedPOId: po.id,
        });
      }
    }

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

  resubmitCancelledPurchase: protectedProcedure.input(z.object({
    itemId: z.number(),
  })).mutation(async ({ input, ctx }) => {

    const item = await db.getPOItemById(input.itemId);
    if (!item) {
      throw new TRPCError({ code: "NOT_FOUND", message: "الصنف غير موجود" });
    }

    const po = await db.getPurchaseOrderById(item.purchaseOrderId);
    if (!po) {
      throw new TRPCError({ code: "NOT_FOUND", message: "طلب الشراء غير موجود" });
    }

    if (po.requestedById !== ctx.user.id) {
      throw new TRPCError({ code: "FORBIDDEN", message: "فقط منشئ الطلب يمكنه إعادة إرسال الصنف" });
    }

    if (item.status !== "purchase_cancelled") {
      throw new TRPCError({ code: "BAD_REQUEST", message: "الصنف ليس في حالة إلغاء شراء" });
    }

    // ── الصنف يرجع مباشرة لحالة approved — السعر معتمد بالفعل ولا يحتاج تسعير جديد ──
    // لا يمر على التسعير، ولا الحسابات، ولا اعتماد الإدارة العليا من جديد
    await db.updatePOItem(item.id, {
      status: "approved",
      purchaseCancelReason: null,
      purchaseCancelledById: null,
      purchaseCancelledByName: null,
      purchaseCancelledAt: null,
    });

    await db.createProcurementComment({
      purchaseOrderId: po.id,
      userId: ctx.user.id,
      userName: ctx.user.name || "User",
      userRole: ctx.user.role,
      actionType: "cancelled_purchase_resubmitted",
      note: `تم تعديل الصنف "${item.itemName}" وإعادة إرساله للمندوب للشراء مباشرة (نفس السعر المعتمد سابقاً)`,
    });

    // ── أخطر المندوب المخصص للصنف مباشرةً للشراء ──
    if (item.delegateId) {
      await db.createNotification({
        userId: item.delegateId,
        title: "🛒 صنف جاهز للشراء",
        message: `تم تعديل الصنف "${item.itemName}" من طلب الشراء ${po.poNumber} وهو جاهز للشراء الآن مباشرة.`,
        type: "success",
        relatedPOId: po.id,
      });
    }

    await db.createAuditLog({
      userId: ctx.user.id,
      action: "resubmit_cancelled_purchase",
      entityType: "purchase_order_item",
      entityId: item.id,
    });

    return { success: true };

  }),

  finalizeCancelledItem: protectedProcedure.input(z.object({
    itemId: z.number(),
  })).mutation(async ({ input, ctx }) => {

    const item = await db.getPOItemById(input.itemId);
    if (!item) {
      throw new TRPCError({ code: "NOT_FOUND", message: "الصنف غير موجود" });
    }

    const po = await db.getPurchaseOrderById(item.purchaseOrderId);
    if (!po) {
      throw new TRPCError({ code: "NOT_FOUND", message: "طلب الشراء غير موجود" });
    }

    const isAdminOrOwner = ctx.user.role === "admin" || ctx.user.role === "owner";
    if (!isAdminOrOwner && po.requestedById !== ctx.user.id) {
      throw new TRPCError({ code: "FORBIDDEN", message: "فقط منشئ الطلب يمكنه إلغاء الصنف نهائياً" });
    }

    if (item.status !== "purchase_cancelled") {
      throw new TRPCError({ code: "BAD_REQUEST", message: "الصنف ليس في حالة إلغاء شراء" });
    }

    // ── إلغاء نهائي — لا رجعة فيه ──
    await db.updatePOItem(item.id, { status: "cancelled" });

    await db.createProcurementComment({
      purchaseOrderId: po.id,
      userId: ctx.user.id,
      userName: ctx.user.name || "User",
      userRole: ctx.user.role,
      actionType: "cancelled_purchase_finalized",
      note: `قام منشئ الطلب بإلغاء الصنف "${item.itemName}" نهائياً بعد تعذّر شرائه`,
    });

    // ── إعادة حساب حالة الطلب بعد الإلغاء النهائي ──
    const allItems = await db.getPOItems(item.purchaseOrderId);
    const activeItems = allItems.filter(
      i => !["rejected", "cancelled", "needs_item_revision", "purchase_cancelled"].includes(i.status)
    );
    const purchasedOrLater = activeItems.filter(i =>
      ["purchased", "delivered_to_warehouse", "delivered_to_requester"].includes(i.status)
    );
    const hasPendingItems = allItems.some(i => i.status === "needs_item_revision" || i.status === "purchase_cancelled");
    const ticketForPath = po.ticketId ? await db.getTicketById(po.ticketId) : null;
    const isPathC = ticketForPath?.maintenancePath === "C";

    if (activeItems.length > 0 && purchasedOrLater.length === activeItems.length && !hasPendingItems) {
      await db.updatePurchaseOrder(item.purchaseOrderId, { status: "purchased" });
      if (po.ticketId && !isPathC) await db.updateTicket(po.ticketId, { status: "purchased" });
    } else if (activeItems.length === 0 && !hasPendingItems) {
      await db.updatePurchaseOrder(item.purchaseOrderId, { status: "received" });
    }

    await db.createAuditLog({
      userId: ctx.user.id,
      action: "finalize_cancelled_item",
      entityType: "purchase_order_item",
      entityId: item.id,
    });

    return { success: true };

  }),

  resubmitItemRevision: protectedProcedure.input(z.object({
    itemId: z.number(),
  })).mutation(async ({ input, ctx }) => {

    const item = await db.getPOItemById(input.itemId);

    if (!item) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "الصنف غير موجود"
      });
    }

    const po = await db.getPurchaseOrderById(item.purchaseOrderId);

    if (!po) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "طلب الشراء غير موجود"
      });
    }

    if (po.requestedById !== ctx.user.id) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "فقط منشئ الطلب يمكنه إعادة إرسال الصنف"
      });
    }

    if (item.status !== "needs_item_revision") {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "الصنف ليس في حالة مراجعة"
      });
    }

    // ── أعد الصنف لحالة pending حتى يسعّره المندوب مباشرة ──
    // الطلب يبقى في pending_estimate وهذا صحيح — المندوب سيسعّر هذا الصنف
    await db.updatePOItem(item.id, {
      status: "pending",
      itemRevisionNote: null,
      itemRevisionRequestedById: null,
      itemRevisionRequestedAt: null,
    });

    await db.createProcurementComment({
      purchaseOrderId: po.id,
      userId: ctx.user.id,
      userName: ctx.user.name || "User",
      userRole: ctx.user.role,
      actionType: "item_revision_resubmitted",
      note: `تم تعديل الصنف "${item.itemName}" وإعادة إرساله للمندوب للتسعير`,
    });

    // ── أخطر المندوب المخصص للصنف مباشرةً لتسعيره ──
    if (item.delegateId) {
      await db.createNotification({
        userId: item.delegateId,
        title: "✏️ صنف جاهز للتسعير",
        message: `تم تعديل الصنف "${item.itemName}" من طلب الشراء ${po.poNumber} وهو جاهز للتسعير الآن.`,
        type: "info",
        relatedPOId: po.id,
      });
    }

    await db.createAuditLog({
      userId: ctx.user.id,
      action: "resubmit_item_revision",
      entityType: "purchase_order_item",
      entityId: item.id,
    });

    return { success: true };

  }),

  update: protectedProcedure.input(z.object({
    id: z.number(),
    notes: z.string().optional(),
  })).mutation(async ({ input, ctx }) => {
    const po = await db.getPurchaseOrderById(input.id);
    if (!po) throw new TRPCError({ code: "NOT_FOUND", message: "طلب الشراء غير موجود" });
    if (!["owner", "admin", "maintenance_manager"].includes(ctx.user.role)) {
      throw new TRPCError({ code: "FORBIDDEN", message: "ليس لديك صلاحية لتعديل طلب الشراء" });
    }
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

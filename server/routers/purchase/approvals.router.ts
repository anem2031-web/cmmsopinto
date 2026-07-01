import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { router, protectedProcedure, managerProcedure, accountantProcedure, managementProcedure } from "../_shared/procedures";
import * as db from "../../db";
import { notifyItemRejection } from "../_shared/router-helpers";

export const approvalsRouter = router({
  approveAccounting: accountantProcedure.input(z.object({
    id: z.number(),
    notes: z.string().optional(),
    custodyAmount: z.string().optional(),
    rejectedItemIds: z.array(z.number()).optional(),
    rejectionReason: z.string().optional(),
  })).mutation(async ({ input, ctx }) => {
    const po = await db.getPurchaseOrderById(input.id);
    const items = await db.getPOItems(input.id);
    
    // Process item rejections if any
    if (input.rejectedItemIds && input.rejectedItemIds.length > 0) {
      for (const itemId of input.rejectedItemIds) {
        // Verify item belongs to PO
        const item = items.find(i => i.id === itemId);
        if (item) {
          const reason = input.rejectionReason || "مرفوض من قبل الحسابات";
          await db.updatePOItem(itemId, { 
            status: "rejected", 
            managementRejectionReason: reason
          });
          await db.createAuditLog({ 
            userId: ctx.user.id, 
            action: "reject_po_item", 
            entityType: "purchase_order_item", 
            entityId: itemId,
            newValues: { reason }
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
              reason,
              kind: "rejected",
            });
          }
        }
      }
    }

          // Check if all items are now rejected or cancelled (needs_item_revision تُعدّ جانباً مؤقتاً)
    const updatedItems = await db.getPOItems(input.id);
    // الأصناف التي تُحسب للتقدم: تجاهل needs_item_revision — هي معلّقة ولكن لا تمنع الباقين
    const activeForAccounting = updatedItems.filter(i => i.status !== "needs_item_revision");
    const allRejected = activeForAccounting.length > 0 &&
      activeForAccounting.every(i => i.status === "rejected" || i.status === "cancelled");
    if (allRejected) {
      // If all items are rejected/cancelled, reject the entire PO
      await db.updatePurchaseOrder(input.id, { 
        status: "rejected", 
        rejectedById: ctx.user.id, 
        rejectedAt: new Date(), 
        rejectionReason: input.rejectionReason
          ? `${input.rejectionReason} (بواسطة ${ctx.user.name})`
          : `تم رفض جميع الأصناف من قبل الحسابات بواسطة ${ctx.user.name}`
      });
      
      // Notify PO creator
      if (po) {
        await db.createNotification({ userId: po.requestedById, title: "❌ طلب شراء مرفوض", message: `تم رفض جميع أصناف طلب الشراء رقم ${po.poNumber || input.id} من قبل الحسابات بواسطة ${ctx.user.name}.${input.rejectionReason ? ` السبب: ${input.rejectionReason}` : ""}`, type: "error", relatedPOId: input.id });
      }
    } else {
      // Normal flow: PO goes to management
      await db.updatePurchaseOrder(input.id, { status: "pending_management", accountingApprovedById: ctx.user.id, accountingApprovedAt: new Date(), accountingNotes: input.notes, custodyAmount: input.custodyAmount || null });
      
      // Notify senior management
      const mgmt = await db.getUsersByRole("senior_management");
      const custodyMsg = input.custodyAmount ? ` مبلغ العهدة: ${Number(input.custodyAmount).toLocaleString("ar-SA")} ر.س.` : "";
      for (const m of mgmt) {
        await db.createNotification({ userId: m.id, title: "طلب شراء بانتظار اعتمادك", message: `طلب شراء رقم ${po?.poNumber || input.id} بانتظار اعتماد الإدارة العليا.${custodyMsg}`, type: "warning", relatedPOId: input.id, allowSeniorManagement: true });
      }
    }
    
    await db.createAuditLog({ userId: ctx.user.id, action: "approve_accounting", entityType: "purchase_order", entityId: input.id });
    return { success: true };
  }),

  approveManagement: managementProcedure.input(z.object({
    id: z.number(),
    notes: z.string().optional(),
    rejectedItemIds: z.array(z.number()).optional(),
    rejectionReason: z.string().optional(),
  })).mutation(async ({ input, ctx }) => {

    if (ctx.user.role === "executive_director") {
      throw new TRPCError({
        code: "FORBIDDEN",
       message: "المدير التنفيذي لديه صلاحية استعراض فقط"
    });
  }
    const po = await db.getPurchaseOrderById(input.id);
    const items = await db.getPOItems(input.id);

    // Process item rejections if any
    if (input.rejectedItemIds && input.rejectedItemIds.length > 0) {
      for (const itemId of input.rejectedItemIds) {
        // Verify item belongs to PO
        const item = items.find(i => i.id === itemId);
        if (item) {
          const reason = input.rejectionReason || "مرفوض من قبل الإدارة";
          await db.updatePOItem(itemId, { 
            status: "rejected", 
            managementRejectionReason: reason
          });
          await db.createAuditLog({ 
            userId: ctx.user.id, 
            action: "reject_po_item", 
            entityType: "purchase_order_item", 
            entityId: itemId,
            newValues: { reason }
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
              reason,
              kind: "rejected",
            });
          }
        }
      }
    }

    // Check if all items are now rejected or cancelled
    const updatedItems = await db.getPOItems(input.id);
    const allRejected = updatedItems.every(i => i.status === "rejected" || i.status === "cancelled");

    if (allRejected) {
      // If all items are rejected/cancelled, reject the entire PO
      await db.updatePurchaseOrder(input.id, { 
        status: "rejected", 
        rejectedById: ctx.user.id, 
        rejectedAt: new Date(), 
        rejectionReason: input.rejectionReason
          ? `${input.rejectionReason} (بواسطة ${ctx.user.name})`
          : `تم رفض جميع الأصناف من قبل الإدارة بواسطة ${ctx.user.name}`
      });
      
      // Notify PO creator
      if (po) {
        await db.createNotification({ userId: po.requestedById, title: "❌ طلب شراء مرفوض", message: `تم رفض جميع أصناف طلب الشراء رقم ${po.poNumber || input.id} من قبل الإدارة بواسطة ${ctx.user.name}.${input.rejectionReason ? ` السبب: ${input.rejectionReason}` : ""}`, type: "error", relatedPOId: input.id });
      }
      
      await db.createAuditLog({ userId: ctx.user.id, action: "approve_management", entityType: "purchase_order", entityId: input.id, newValues: { status: "rejected_all_items" } });
      return { success: true };
    }

    // Normal flow: PO is approved (partially or fully)
    await db.updatePurchaseOrder(input.id, {
      status: "approved",
      managementApprovedById: ctx.user.id,
      managementApprovedAt: new Date(),
      managementNotes: input.notes
    });

    // ── اعتمد الأصناف الجاهزة فقط ──
    // الأصناف في needs_item_revision تبقى كما هي — ستُعتمد تلقائياً لاحقاً
    // عندما يسعّرها المندوب بعد تعديل المنشئ، تنتقل مباشرة لـ approved
    for (const item of updatedItems) {
      if (
        item.status !== "rejected" &&
        item.status !== "cancelled" &&
        item.status !== "needs_item_revision"
      ) {
        await db.updatePOItem(item.id, { status: "approved" });
      }
    }

    // Notify delegates — only for non-rejected/non-cancelled items
    const approvedItemsForNotif = updatedItems.filter(
      i =>
        i.status !== "rejected" &&
        i.status !== "cancelled" &&
        i.status !== "needs_item_revision"
    );

    const delegateIds = Array.from(
      new Set(
        approvedItemsForNotif
          .filter(i => i.delegateId)
          .map(i => i.delegateId!)
      )
    );

    for (const dId of delegateIds) {
      const delegateItems = items.filter(i => i.delegateId === dId);
      const itemNames = delegateItems.map(i => i.itemName).join("، ");
      const custodyInfo = po?.custodyAmount
        ? ` مبلغ العهدة المُصرف لك: ${Number(po.custodyAmount).toLocaleString("ar-SA")} ر.س.`
        : "";

      await db.createNotification({
        userId: dId,
        title: "✅ تم اعتماد طلب الشراء - ابدأ الشراء الآن",
        message: `تم اعتماد طلب الشراء رقم ${po?.poNumber || input.id} من قِبل الإدارة. الأصناف المطلوبة منك: ${itemNames}.${custodyInfo} يمكنك البدء بالشراء فوراً.`,
        type: "success",
        relatedPOId: input.id
      });
    }

    // If no delegates assigned, notify managers
    if (delegateIds.length === 0) {
      const managers = await db.getManagerUsers();
      for (const mgr of managers) {
        await db.createNotification({
          userId: mgr.id,
          title: "✅ تم اعتماد طلب الشراء",
          message: `تم اعتماد طلب الشراء رقم ${po?.poNumber || input.id}. لا يوجد مندوب مُعيَّن للأصناف.`,
          type: "warning",
          relatedPOId: input.id
        });
      }
    }
    // Update ticket (Path C: keep at work_approved, notify gate security)
    if (po?.ticketId) {
      const ticketForPath = await db.getTicketById(po.ticketId);
      if (ticketForPath?.maintenancePath === "C") {
        // Path C: do NOT change ticket status — gate security must approve exit first
        const gateUsers = await db.getUsersByRole("gate_security");
        for (const g of gateUsers) {
          await db.createNotification({
            userId: g.id,
            title: "🚪 أصل بانتظار الموافقة على الخروج",
            message: `البلاغ ${ticketForPath.ticketNumber} - تمت الموافقة على تكلفة الإصلاح، الأصل جاهز للخروج`,
            type: "info",
            relatedTicketId: po.ticketId
          });
        }
      } else {
        // Path A or B: normal behavior
        await db.updateTicket(po.ticketId, { status: "purchase_approved" });
        await db.addTicketStatusHistory({ ticketId: po.ticketId, fromStatus: "purchase_pending_management", toStatus: "purchase_approved", changedById: ctx.user.id });
      }
    }
    await db.createAuditLog({ userId: ctx.user.id, action: "approve_management", entityType: "purchase_order", entityId: input.id });
    return { success: true };
  }),

  reject: protectedProcedure.input(z.object({
    id: z.number(),
    reason: z.string().min(1),
  })).mutation(async ({ input, ctx }) => {
    const poReject = await db.getPurchaseOrderById(input.id);
    await db.updatePurchaseOrder(input.id, { status: "rejected", rejectedById: ctx.user.id, rejectedAt: new Date(), rejectionReason: input.reason });
    await db.createProcurementComment({
      purchaseOrderId: input.id,
      userId: ctx.user.id,
      userName: ctx.user.name || "مستخدم",
      userRole: ctx.user.role,
      actionType: "po_rejected",
      note: `تم رفض طلب الشراء بالكامل\n\nالسبب:\n${input.reason}`,
    });
    // Notify PO creator and managers
    if (poReject?.requestedById && poReject.requestedById !== ctx.user.id) {
      await db.createNotification({ userId: poReject.requestedById, title: "❌ تم رفض طلب الشراء", message: `تم رفض طلب الشراء رقم ${poReject.poNumber} بواسطة ${ctx.user.name}. السبب: ${input.reason}`, type: "critical", relatedPOId: input.id });
    }
    const managersReject = await db.getManagerUsers();
    for (const mgr of managersReject) {
      if (mgr.id !== ctx.user.id) {
        await db.createNotification({ userId: mgr.id, title: "❌ رفض طلب شراء", message: `تم رفض طلب الشراء رقم ${poReject?.poNumber || input.id} بواسطة ${ctx.user.name}. السبب: ${input.reason}`, type: "critical", relatedPOId: input.id });
      }
    }
    return { success: true };
  }),

  reviewItems: managerProcedure.input(z.object({
    poId: z.number(),
    items: z.array(z.object({
      id: z.number(),
      action: z.enum(["approve", "reject"]),
      delegateId: z.number().optional(),
      rejectionReason: z.string().optional(),
    })),
  })).mutation(async ({ input, ctx }) => {
    const po = await db.getPurchaseOrderById(input.poId);
    if (!po) throw new TRPCError({ code: "NOT_FOUND", message: "طلب الشراء غير موجود" });
    if (po.status !== "pending_review") {
      throw new TRPCError({ code: "BAD_REQUEST", message: "طلب الشراء ليس في مرحلة المراجعة" });
    }
    // ── Atomic validation: fetch all DB items for this PO before any updates ──
    const dbItems = await db.getPOItems(input.poId);
    // A) Count check: submitted items must equal DB items (no partial submission)
    if (input.items.length !== dbItems.length) {
      throw new TRPCError({ code: "BAD_REQUEST", message: `يجب مراجعة جميع الأصناف (${dbItems.length} صنف). تم إرسال ${input.items.length} فقط` });
    }
// B) Ownership check: every submitted item.id must belong to this PO
      const dbItemIds = new Set(dbItems.map((i: any) => i.id));
      for (const reviewItem of input.items) {
        if (!dbItemIds.has(reviewItem.id)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: `الصنف رقم ${reviewItem.id} لا ينتمي لطلب الشراء هذا` });
        }
      }
      // ── Validate each item action ──
      for (const reviewItem of input.items) {
        if (reviewItem.action === "approve" && !reviewItem.delegateId) {
          throw new TRPCError({ code: "BAD_REQUEST", message: `الصنف رقم ${reviewItem.id}: يجب تعيين مندوب للأصناف المعتمدة` });
        }
        if (reviewItem.action === "reject" && !reviewItem.rejectionReason) {
          throw new TRPCError({ code: "BAD_REQUEST", message: `الصنف رقم ${reviewItem.id}: يجب إدخال سبب رفض الأصناف المرفوضة` });
        }
      }
      // Apply per-item decisions
      for (const reviewItem of input.items) {
        if (reviewItem.action === "approve") {
          await db.updatePOItem(reviewItem.id, {
            status: "pending",
            delegateId: reviewItem.delegateId,
            managementRejectionReason: null,
          });
        } else {
          await db.updatePOItem(reviewItem.id, {
            status: "rejected",
            managementRejectionReason: reviewItem.rejectionReason,
          });
          const rejectedItem = dbItems.find((i: any) => i.id === reviewItem.id);
          if (rejectedItem) {
            await notifyItemRejection({
              poId: po.id,
              poNumber: po.poNumber,
              requestedById: po.requestedById,
              itemName: rejectedItem.itemName,
              actorId: ctx.user.id,
              actorName: ctx.user.name || "مستخدم",
              actorRole: ctx.user.role,
              reason: reviewItem.rejectionReason!,
              kind: "rejected",
            });
          }
        }
      }
      // Determine new PO status
      const allItems = await db.getPOItems(input.poId);
      const hasApproved = allItems.some(i => i.status === "pending");
      const allRejected = allItems.every(i => i.status === "rejected" || i.status === "cancelled");
      if (allRejected) {
        await db.updatePurchaseOrder(input.poId, { status: "rejected", rejectedById: ctx.user.id, rejectedAt: new Date(), rejectionReason: `تم رفض جميع الأصناف بواسطة ${ctx.user.name}` });
        if (po.requestedById && po.requestedById !== ctx.user.id) {
          await db.createNotification({ userId: po.requestedById, title: "❌ تم رفض جميع أصناف طلب الشراء", message: `تم رفض جميع أصناف طلب الشراء رقم ${po.poNumber} بواسطة ${ctx.user.name}.`, type: "critical", relatedPOId: input.poId });
        }
} else if (hasApproved) {
        await db.updatePurchaseOrder(input.poId, {
          status: "pending_estimate",
          reviewedById: ctx.user.id,
          reviewedAt: new Date(),
        });
        const approvedItems = allItems.filter(i => i.status === "pending" && i.delegateId);
        const delegateIds = Array.from(new Set(approvedItems.map(i => i.delegateId!)));
        for (const dId of delegateIds) {
          const delegateItems = approvedItems.filter(i => i.delegateId === dId);
          const itemNames = delegateItems.map(i => i.itemName).join("، ");
          await db.createNotification({ userId: dId, title: "طلب شراء جديد — ابدأ التسعير", message: `تم تخصيص الأصناف التالية لك في طلب الشراء ${po.poNumber}: ${itemNames}`, type: "info", relatedPOId: input.poId });
        }
      }
      await db.createAuditLog({ userId: ctx.user.id, action: "review_po_items", entityType: "purchase_order", entityId: input.poId });
      return { success: true };
    }),
});

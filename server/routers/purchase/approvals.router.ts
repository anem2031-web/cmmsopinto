import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { router, protectedProcedure, managerProcedure, accountantProcedure, managementProcedure } from "../_shared/procedures";
import * as db from "../../_core/db";
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
      // مبلغ العهدة إلزامي عند الاعتماد الفعلي (غير مطلوب في حالة الرفض الكامل أعلاه)
      const custodyValue = input.custodyAmount ? parseFloat(input.custodyAmount) : NaN;
      if (!input.custodyAmount || !input.custodyAmount.trim() || isNaN(custodyValue) || custodyValue <= 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "مبلغ العهدة إلزامي لاعتماد الطلب من الحسابات" });
      }
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

  // ── اعتماد دفعة تسعير واحدة من الحسابات (لا تؤثر على باقي الدفعات) ──
  approveAccountingBatch: accountantProcedure.input(z.object({
    batchId: z.number(),
    notes: z.string().optional(),
    custodyAmount: z.string().optional(),
    rejectedItemIds: z.array(z.number()).optional(),
    rejectionReason: z.string().optional(),
  })).mutation(async ({ input, ctx }) => {
    const batch = await db.getPOPricingBatchById(input.batchId);
    if (!batch) throw new TRPCError({ code: "NOT_FOUND", message: "دفعة التسعير غير موجودة" });
    if (batch.status !== "pending_accounting") {
      throw new TRPCError({ code: "BAD_REQUEST", message: "هذه الدفعة ليست بانتظار اعتماد الحسابات" });
    }

    const po = await db.getPurchaseOrderById(batch.purchaseOrderId);
    if (!po) throw new TRPCError({ code: "NOT_FOUND", message: "طلب الشراء غير موجود" });

    const batchItems = (await db.getPOItems(batch.purchaseOrderId)).filter(i => i.batchId === batch.id);

    // معالجة رفض أصناف ضمن الدفعة (إن وجدت)
    if (input.rejectedItemIds && input.rejectedItemIds.length > 0) {
      for (const itemId of input.rejectedItemIds) {
        const item = batchItems.find(i => i.id === itemId);
        if (item) {
          const reason = input.rejectionReason || "مرفوض من قبل الحسابات";
          await db.updatePOItem(itemId, { status: "rejected", managementRejectionReason: reason });
          await notifyItemRejection({
            poId: po.id, poNumber: po.poNumber, requestedById: po.requestedById,
            itemName: item.itemName, actorId: ctx.user.id, actorName: ctx.user.name || "مستخدم",
            actorRole: ctx.user.role, reason, kind: "rejected",
          });
        }
      }
    }

    const allBatchRejected = batchItems.every(i =>
      input.rejectedItemIds?.includes(i.id) || i.status === "rejected" || i.status === "cancelled"
    );

    if (allBatchRejected) {
      await db.updatePOPricingBatch(batch.id, {
        status: "rejected", rejectedById: ctx.user.id, rejectedAt: new Date(), rejectionReason: input.rejectionReason,
      });
    } else {
      // مبلغ العهدة إلزامي عند اعتماد الدفعة فعلياً (غير مطلوب في حالة رفض الدفعة بالكامل أعلاه)
      const custodyValue = input.custodyAmount ? parseFloat(input.custodyAmount) : NaN;
      if (!input.custodyAmount || !input.custodyAmount.trim() || isNaN(custodyValue) || custodyValue <= 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "مبلغ العهدة إلزامي لاعتماد الدفعة من الحسابات" });
      }
      await db.updatePOPricingBatch(batch.id, {
        status: "pending_management",
        accountingApprovedById: ctx.user.id,
        accountingApprovedAt: new Date(),
        accountingNotes: input.notes,
        custodyAmount: input.custodyAmount || null,
      });

      // ── تحديث حالة الطلب العامة على أساس مجموع الدفعات ──
      // بدون هذا، حالة الطلب الرئيسي تفضل "pending_accounting" للأبد حتى بعد
      // ما كل دفعاته تتاعتمد من الحسابات وتنتقل فعلياً للإدارة العليا — نفس
      // النمط المطبّق فعلاً بمرحلة اعتماد الإدارة العليا (approveManagementBatch).
      const allBatchesAfterAccounting = await db.getPOPricingBatches(po.id);
      const anyStillPendingAccounting = allBatchesAfterAccounting.some(b => b.status === "pending_accounting");
      if (!anyStillPendingAccounting && po.status === "pending_accounting") {
        await db.updatePurchaseOrder(po.id, { status: "pending_management" });
      }

      const mgmt = await db.getUsersByRole("senior_management");
      for (const m of mgmt) {
        await db.createNotification({
          userId: m.id,
          title: "طلب شراء بانتظار اعتمادك",
          message: `طلب شراء رقم ${po.poNumber} — الدفعة رقم ${batch.batchNumber} (${batchItems.length} صنف) بانتظار اعتماد الإدارة العليا.`,
          type: "warning", relatedPOId: po.id, allowSeniorManagement: true,
        });
      }
    }

    await db.createAuditLog({
      userId: ctx.user.id, action: "approve_accounting_batch",
      entityType: "po_pricing_batch", entityId: batch.id,
    });
    return { success: true };
  }),

  // ── اعتماد دفعة تسعير واحدة من الإدارة العليا (بعد اعتماد الحسابات لها) ──
  approveManagementBatch: managementProcedure.input(z.object({
    batchId: z.number(),
    notes: z.string().optional(),
    rejectedItemIds: z.array(z.number()).optional(),
    rejectionReason: z.string().optional(),
  })).mutation(async ({ input, ctx }) => {
    if (ctx.user.role === "executive_director") {
      throw new TRPCError({ code: "FORBIDDEN", message: "المدير التنفيذي لديه صلاحية استعراض فقط" });
    }
    const batch = await db.getPOPricingBatchById(input.batchId);
    if (!batch) throw new TRPCError({ code: "NOT_FOUND", message: "دفعة التسعير غير موجودة" });
    if (batch.status !== "pending_management") {
      throw new TRPCError({ code: "BAD_REQUEST", message: "هذه الدفعة ليست بانتظار اعتماد الإدارة" });
    }

    const po = await db.getPurchaseOrderById(batch.purchaseOrderId);
    if (!po) throw new TRPCError({ code: "NOT_FOUND", message: "طلب الشراء غير موجود" });
    const batchItems = (await db.getPOItems(batch.purchaseOrderId)).filter(i => i.batchId === batch.id);

    if (input.rejectedItemIds && input.rejectedItemIds.length > 0) {
      for (const itemId of input.rejectedItemIds) {
        const item = batchItems.find(i => i.id === itemId);
        if (item) {
          const reason = input.rejectionReason || "مرفوض من قبل الإدارة";
          await db.updatePOItem(itemId, { status: "rejected", managementRejectionReason: reason });
          await notifyItemRejection({
            poId: po.id, poNumber: po.poNumber, requestedById: po.requestedById,
            itemName: item.itemName, actorId: ctx.user.id, actorName: ctx.user.name || "مستخدم",
            actorRole: ctx.user.role, reason, kind: "rejected",
          });
        }
      }
    }

    const allBatchRejected = batchItems.every(i =>
      input.rejectedItemIds?.includes(i.id) || i.status === "rejected" || i.status === "cancelled"
    );

    if (allBatchRejected) {
      await db.updatePOPricingBatch(batch.id, {
        status: "rejected", rejectedById: ctx.user.id, rejectedAt: new Date(), rejectionReason: input.rejectionReason,
      });
    } else {
      await db.updatePOPricingBatch(batch.id, {
        status: "approved", managementApprovedById: ctx.user.id, managementApprovedAt: new Date(), managementNotes: input.notes,
      });

      for (const item of batchItems) {
        if (item.status !== "rejected" && item.status !== "cancelled") {
          await db.updatePOItem(item.id, { status: "approved" });
        }
      }

      // ── تحديث حالة الطلب العامة على أساس مجموع الدفعات ──
      const allBatches = await db.getPOPricingBatches(po.id);
      const anyPending = allBatches.some(b => b.status === "pending_accounting" || b.status === "pending_management");
      if (!anyPending && po.status !== "approved") {
        await db.updatePurchaseOrder(po.id, { status: "approved", managementApprovedById: ctx.user.id, managementApprovedAt: new Date() });
      }

      const delegateIds = Array.from(new Set(batchItems.filter(i => i.delegateId && i.status === "approved").map(i => i.delegateId!)));
      const custodyInfoBatch = batch.custodyAmount
        ? ` مبلغ العهدة المُصرف لك: ${Number(batch.custodyAmount).toLocaleString("ar-SA")} ر.س.`
        : "";
      for (const dId of delegateIds) {
        const delegateItems = batchItems.filter(i => i.delegateId === dId);
        const itemNames = delegateItems.map(i => i.itemName).join("، ");
        await db.createNotification({
          userId: dId,
          title: "✅ تم اعتماد دفعة من طلب الشراء - ابدأ الشراء الآن",
          message: `تم اعتماد الدفعة رقم ${batch.batchNumber} من طلب الشراء رقم ${po.poNumber}. الأصناف: ${itemNames}.${custodyInfoBatch} يمكنك البدء بالشراء فوراً.`,
          type: "success", relatedPOId: po.id,
        });
      }
    }

    await db.createAuditLog({
      userId: ctx.user.id, action: "approve_management_batch",
      entityType: "po_pricing_batch", entityId: batch.id,
    });
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

  reviewItems: protectedProcedure.input(z.object({
    poId: z.number(),
    items: z.array(z.object({
      id: z.number(),
      action: z.enum(["approve", "reject"]),
      delegateId: z.number().optional(),
      rejectionReason: z.string().optional(),
    })),
  })).mutation(async ({ input, ctx }) => {
    const isStandardManager = ["maintenance_manager", "purchase_manager", "owner", "admin"].includes(ctx.user.role);
    const isFoodWarehouseManager = ctx.user.role === "food_warehouse_manager";
    if (!isStandardManager && !isFoodWarehouseManager) {
      throw new TRPCError({ code: "FORBIDDEN", message: "ليس لديك صلاحية لهذا الإجراء" });
    }

    const po = await db.getPurchaseOrderById(input.poId);
    if (!po) throw new TRPCError({ code: "NOT_FOUND", message: "طلب الشراء غير موجود" });

    // مدير المستودع الغذائي: مقيّد بطلبات مساعد المستودع الغذائي أو طلباته هو شخصياً فقط
    if (isFoodWarehouseManager) {
      const requester = po.requestedById ? await db.getUserById(po.requestedById) : null;
      const isOwnRequest = po.requestedById === ctx.user.id;
      const isAssistantRequest = (requester as any)?.role === "food_warehouse_assistant";
      if (!isOwnRequest && !isAssistantRequest) {
        throw new TRPCError({ code: "FORBIDDEN", message: "لا يمكنك اعتماد هذا الطلب" });
      }
    }

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

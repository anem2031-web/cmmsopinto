import * as db from "../../_core/db";
import {
  createPurchaseOrderReadGuard,
  assertCanPerformPOAction,
} from "../../_core/authz/guard";
import { unifiedBundleApprovalsEnabled } from "../../services/delegate-pricing-bundles/unified-feature";
import type { UnifiedApprovalPorts } from "../../services/delegate-pricing-bundles/unified-approval";
import {
  replacementFundingForBatch,
  approveReplacementAccounting,
  approveReplacementManagement,
} from "../../supplier-return-followup/pricing-bridge";
import { returnReplacementToDelegate, returnReplacementToDelegateFromUnifiedBundle } from "../../supplier-return-followup/repricing";
import { syncPathBTicketFromPurchaseOrder } from "../purchase/ticket-purchase-workflow";
import { notifyItemRejection } from "../_shared/router-helpers";
import { createBundleReplacementAdapter } from "../../services/delegate-pricing-bundles/replacement-approval-adapter";
import { canApprovePricingBundleStage } from "../../../shared/business-role-policy";
import { TRPCError } from "@trpc/server";

export const unifiedApprovalPorts: UnifiedApprovalPorts = {
  enabled: unifiedBundleApprovalsEnabled,
  database: async () => {
    const database = await db.getDb();
    if (!database) throw Error("قاعدة البيانات غير متاحة");
    return database;
  },
  readGuard: createPurchaseOrderReadGuard,
  authorizeStage: (actor, stage, orders) => {
    if (!canApprovePricingBundleStage(actor, stage)) throw new TRPCError({ code: "FORBIDDEN", message: "ليس لديك صلاحية لهذه المرحلة من حزمة التسعير" });
    // The service already verified the locked DPB stage, every batch and all members.
    // This exact DPB-only accounting grant never substitutes the actor's role.
    if (actor.role === "senior_management" && stage === "accounting") return;
    // The exact locked DPB/batch stage is authoritative for these members, rather than a mixed PO header.
    for (const order of orders)
      assertCanPerformPOAction(
        stage === "accounting" ? "approveAccounting" : "approveManagement",
        actor,
        {
          ...order,
          status:
            stage === "accounting"
              ? "pending_accounting"
              : "pending_management",
        }
      );
  },
  updateItem: async (tx, item, data, actor, bundleNumber) => {
    await db.updatePOItem(Number(item.id), data, tx, {
      actorUserId: actor.id,
      actorName: actor.name || null,
      note: `قرار حزمة التسعير ${bundleNumber}`,
      metadata: {
        bundleNumber,
        originalBatchId: item.batchId,
        purchaseOrderId: item.purchaseOrderId,
      },
    });
  },
  replacement: createBundleReplacementAdapter({
    returnToDelegate: returnReplacementToDelegate,
    returnToDelegateFromBundle: returnReplacementToDelegateFromUnifiedBundle,
    management: approveReplacementManagement,
    funding: replacementFundingForBatch,
    accounting: approveReplacementAccounting,
  }),
  finish: async (c, actor, stage) => {
    const firstPoId = Number(c.orders[0].id);
    const firstAcceptedPoId = Number(
      c.items.find(
        (item: any) =>
          !c.priorRejected.has(Number(item.id)) &&
          !["rejected", "cancelled"].includes(item.status)
      )?.purchaseOrderId || firstPoId
    );
    if (stage === "send") {
      for (const user of await db.getUsersByRole("accountant"))
        await db.createNotification({
          userId: user.id,
          title: "حزمة تسعير بانتظار اعتماد الحسابات",
          message: `حزمة ${c.root.bundleNumber} تضم ${c.snapshot.rows.length} صنفًا؛ المراجعة والعهدة من حزمة التسعير كاملة.`,
          type: "warning",
          relatedPoId: firstPoId,
          eventKey: `dpb_approval:${c.root.bundleId}`,
        });
      return;
    }
    for (const order of c.orders)
      await syncPathBTicketFromPurchaseOrder(
        Number(order.id),
        actor.id,
        `تمت مراجعة حزمة التسعير ${c.root.bundleNumber}`
      );
    const rejections = JSON.parse(
      (stage === "accounting"
        ? c.root.accountingRejections
        : c.root.managementRejections) || "[]"
    );
    for (const rejection of rejections.filter(
      (row: any) => !row.observedBeforeApproval
    )) {
      const item = c.snapshot.rows.find(
        (row: any) => Number(row.id) === Number(rejection.itemId)
      );
      const order = c.orders.find(
        (row: any) => Number(row.id) === Number(item.purchaseOrderId)
      );
      await notifyItemRejection({
        poId: Number(order.id),
        poNumber: order.poNumber,
        requestedById: order.requestedById,
        itemId: Number(item.id),
        itemName: item.itemName,
        actorId: actor.id,
        actorName: actor.name || "مستخدم",
        actorRole: actor.role,
        reason: rejection.reason,
        kind: "rejected",
      });
    }
    if (stage === "accounting" && c.root.status === "pending_management") {
      for (const user of await db.getUsersByRole("senior_management"))
        await db.createNotification({
          userId: user.id,
          title: "حزمة تسعير بانتظار اعتماد الإدارة العليا",
          message: `تم اعتماد الحسابات لحزمة ${c.root.bundleNumber}؛ راجع أصنافها واعتمد الحزمة كاملة.`,
          type: "warning",
          relatedPoId: firstPoId,
          allowSeniorManagement: true,
          eventKey: `dpb_approval:${c.root.bundleId}`,
        });
    } else if (stage === "management" && c.root.status === "approved")
      await db.createNotification({
        userId: Number(c.root.delegateId),
        title: "تم اعتماد حزمة التسعير — الأصناف جاهزة للشراء",
        message: `اعتمدت حزمة ${c.root.bundleNumber}. الأصناف المقبولة متاحة منفردة للشراء، وكل صنف يكمل مساره الأصلي.`,
        type: "success",
        relatedPoId: firstAcceptedPoId,
      });
  },
};

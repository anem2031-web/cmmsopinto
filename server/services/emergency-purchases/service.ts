import { sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { readScopeChunks } from "../../_core/authz/read-batch";

type Database = { execute(query: ReturnType<typeof sql>): Promise<unknown> };

async function rows(tx: Database, query: ReturnType<typeof sql>) {
  const result = await tx.execute(query);
  if (!Array.isArray(result) || !Array.isArray(result[0])) {
    throw new Error("تعذر قراءة بيانات الشراء الطارئ");
  }
  return result[0];
}

const ids = (values: number[]) =>
  sql.join(values.map(id => sql`${id}`), sql`,`);

export const emergencyPurchasesEnabled = () =>
  process.env.EMERGENCY_PURCHASES_ENABLED === "true" &&
  process.env.DELEGATE_PRICING_BUNDLES_ENABLED === "true" &&
  process.env.DELEGATE_PRICING_BUNDLE_APPROVALS_ENABLED === "true" &&
  process.env.INVENTORY_LOTS_ENABLED === "true";

/** A disabled entry flag cannot remove holds on emergency purchases already recorded. */
export async function emergencyPurchaseTablesAvailable(tx: Database | null | undefined) {
  if (!tx) return false;
  const tables = await rows(tx, sql`SELECT TABLE_NAME FROM information_schema.TABLES
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('emergency_purchase_items','emergency_pricing_bundles')`);
  if (!tables.length) return false;
  if (tables.length !== 2) throw new Error("جداول الشراء الطارئ غير مكتملة");
  return true;
}

export async function markEmergencyPurchaseItem(tx: Database, itemId: number, actorId: number) {
  if (!emergencyPurchasesEnabled() || !await emergencyPurchaseTablesAvailable(tx)) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "مسار الشراء الطارئ غير مفعّل" });
  }
  const [external] = await rows(tx, sql`SELECT j.id FROM purchase_order_items i
    JOIN external_maintenance_jobs j ON j.purchaseOrderId=i.purchaseOrderId WHERE i.id=${itemId} LIMIT 1`);
  if (external) throw new TRPCError({ code: "CONFLICT", message: "الصيانة الخارجية تستكمل الاستلام بإجراءاتها الخاصة" });
  const replacementTables = await rows(tx, sql`SELECT TABLE_NAME FROM information_schema.TABLES
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='supplier_return_replacement_plans'`);
  if (replacementTables.length) {
    const [replacement] = await rows(tx, sql`SELECT r.id FROM purchase_order_items i
      JOIN supplier_return_replacement_plans r ON r.purchaseOrderId=i.purchaseOrderId
      WHERE i.id=${itemId} LIMIT 1`);
    if (replacement) throw new TRPCError({ code: "CONFLICT", message: "بديل مرتجع المورد يستكمل اعتماد فرق السعر ضمن إجراء التعويض" });
  }
  await tx.execute(sql`INSERT INTO emergency_purchase_items (purchaseOrderItemId,markedById)
    VALUES (${itemId},${actorId}) ON DUPLICATE KEY UPDATE purchaseOrderItemId=purchaseOrderItemId`);
}

export type EmergencyItemState = {
  bundleId: number | null;
  delegateId: number | null;
  submitted: boolean;
  cancelled: boolean;
  approved: boolean;
  purchaseAllowed: boolean;
};

export async function loadEmergencyItemStates(tx: Database | null | undefined, itemIds: number[]) {
  if (!tx || !itemIds.length || !await emergencyPurchaseTablesAvailable(tx)) return new Map<number, EmergencyItemState>();
  const items = await readScopeChunks(itemIds, chunk => rows(tx, sql`SELECT e.purchaseOrderItemId,e.bundleId,e.cancelledAt,
    b.delegateId,p.delegateId AS itemDelegateId,p.status AS itemStatus,p.batchId,p.purchasedAt,p.delegateChangeRequestedAt,
    h.status AS orderStatus,d.submittedAt,d.cancelledAt AS bundleCancelledAt,a.status AS approvalStatus,
    a.accountingApprovedById,a.accountingApprovedAt,a.managementApprovedById,a.managementApprovedAt,l.pricingBatchId
    FROM emergency_purchase_items e JOIN purchase_order_items p ON p.id=e.purchaseOrderItemId
    JOIN purchase_orders h ON h.id=p.purchaseOrderId
    LEFT JOIN emergency_pricing_bundles d ON d.bundleId=e.bundleId
    LEFT JOIN delegate_pricing_bundles b ON b.id=d.bundleId
    LEFT JOIN delegate_pricing_bundle_approvals a ON a.bundleId=d.bundleId
    LEFT JOIN delegate_pricing_bundle_batches l ON l.bundleId=d.bundleId AND l.purchaseOrderId=p.purchaseOrderId
    WHERE e.purchaseOrderItemId IN (${ids(chunk)})`));
  return new Map<number, EmergencyItemState>(items.map(item => {
    const sameBatch = Number(item.batchId) > 0 && Number(item.batchId) === Number(item.pricingBatchId);
    const cancelled = item.cancelledAt != null || item.bundleCancelledAt != null;
    const submitted = item.submittedAt != null && sameBatch;
    return [Number(item.purchaseOrderItemId), {
      bundleId: item.bundleId == null ? null : Number(item.bundleId),
      delegateId: item.delegateId == null ? null : Number(item.delegateId),
      submitted,
      cancelled,
      approved: submitted && !cancelled && item.approvalStatus === "approved" &&
        Number(item.accountingApprovedById) > 0 && item.accountingApprovedAt != null &&
        Number(item.managementApprovedById) > 0 && item.managementApprovedAt != null,
      purchaseAllowed: submitted && !cancelled && item.approvalStatus === "awaiting_receipt" &&
        item.itemStatus === "estimated" && item.purchasedAt == null && item.delegateChangeRequestedAt == null &&
        Number(item.delegateId) > 0 && Number(item.delegateId) === Number(item.itemDelegateId) &&
        !["closed", "draft", "rejected", "revision_needed"].includes(item.orderStatus),
    }];
  }));
}

export async function emergencyItemIds(tx: Database | null | undefined, itemIds: number[]) {
  if (!tx || !itemIds.length || !await emergencyPurchaseTablesAvailable(tx)) return new Set<number>();
  return new Set((await readScopeChunks(itemIds, chunk => rows(tx, sql`SELECT purchaseOrderItemId
    FROM emergency_purchase_items WHERE purchaseOrderItemId IN (${ids(chunk)})`))).map(item => Number(item.purchaseOrderItemId)));
}

export async function isEmergencyPurchaseAllowed(tx: Database, itemId: number, actorId: number) {
  const item = (await loadEmergencyItemStates(tx, [itemId])).get(itemId);
  return !!item?.purchaseAllowed && item.delegateId === actorId;
}

export async function assertEmergencyPurchaseAllowed(tx: Database, itemId: number, actorId: number) {
  if (!await isEmergencyPurchaseAllowed(tx, itemId, actorId)) {
    throw new TRPCError({ code: "CONFLICT", message: "أرسل حزمة الصنف الطارئ قبل تسجيل الشراء" });
  }
}

export type EmergencyBundleState = {
  emergencyPurchase: true;
  receivedItemCount: number;
  requiredItemCount: number;
  emergencyCancelled: boolean;
};

export async function loadEmergencyBundleStates(tx: Database, bundleIds: number[]) {
  if (!bundleIds.length || !await emergencyPurchaseTablesAvailable(tx)) return new Map<number, EmergencyBundleState>();
  const states = await readScopeChunks(bundleIds, chunk => rows(tx, sql`SELECT bundleId,receivedItemCount,requiredItemCount,cancelledAt
    FROM emergency_pricing_bundles WHERE bundleId IN (${ids(chunk)})`));
  return new Map<number, EmergencyBundleState>(states.map(state => [Number(state.bundleId), {
    emergencyPurchase: true,
    receivedItemCount: Number(state.receivedItemCount),
    requiredItemCount: Number(state.requiredItemCount),
    emergencyCancelled: state.cancelledAt != null,
  }]));
}

export async function cancelEmergencyBundleItem(tx: Database, itemId: number, actorId: number, reason: string) {
  const note = reason.trim();
  if (!note) throw new TRPCError({ code: "BAD_REQUEST", message: "سبب إلغاء الصنف الطارئ مطلوب" });
  await assertEmergencyPurchaseAllowed(tx, itemId, actorId);
  await tx.execute(sql`UPDATE emergency_purchase_items
    SET cancelledAt=CURRENT_TIMESTAMP,cancelledById=${actorId},cancellationReason=${note}
    WHERE purchaseOrderItemId=${itemId} AND cancelledAt IS NULL`);
}

async function readAffectedBundleIds(tx: Database, itemIds: number[]) {
  if (!itemIds.length || !await emergencyPurchaseTablesAvailable(tx)) return [];
  const sources = await readScopeChunks(itemIds, chunk => rows(tx, sql`SELECT DISTINCT bundleId FROM emergency_purchase_items
    WHERE purchaseOrderItemId IN (${ids(chunk)}) AND bundleId IS NOT NULL`));
  return Array.from(new Set(sources.map(source => Number(source.bundleId)))).sort((a, b) => a - b);
}

/** Acquire in bundle order before taking any PO/item/receipt write locks. */
export async function lockEmergencyBundleRootsForItems(tx: Database, itemIds: number[]) {
  const bundleIds = await readAffectedBundleIds(tx, itemIds);
  for (const bundleId of bundleIds) {
    await rows(tx, sql`SELECT d.bundleId FROM delegate_pricing_bundle_approvals a
      JOIN emergency_pricing_bundles d ON d.bundleId=a.bundleId
      WHERE a.bundleId=${bundleId} FOR UPDATE`);
  }
}

export async function readEmergencyBundleReceiptProgress(tx: Database, bundleId: number) {
  const members = await rows(tx, sql`SELECT purchaseOrderItemId FROM emergency_purchase_items
    WHERE bundleId=${bundleId} AND cancelledAt IS NULL ORDER BY purchaseOrderItemId FOR UPDATE`);
  const itemIds = members.map(row => Number(row.purchaseOrderItemId));
  if (!itemIds.length) return { required: 0, received: 0 };
  // Locking reads see the last committed receipt even after waiting for the bundle lock.
  // Recording the delegate's handoff does not create either of these warehouse rows.
  const receipts = await rows(tx, sql`SELECT ri.purchaseOrderItemId FROM warehouse_receipt_items ri
    JOIN warehouse_receipts r ON r.id=ri.receiptId
    JOIN inventory_lots l ON l.receiptId=r.id AND l.receiptItemId=ri.id AND l.purchaseOrderItemId=ri.purchaseOrderItemId
    WHERE ri.purchaseOrderItemId IN (${ids(itemIds)}) AND r.status='confirmed' AND ri.receivedQuantity>0 FOR UPDATE`);
  return { required: itemIds.length, received: new Set(receipts.map(row => Number(row.purchaseOrderItemId))).size };
}

/** Must run in the same transaction as the stock receipt or an eligible cancellation. */
export async function syncEmergencyBundleReceipts(tx: Database, itemIds: number[]) {
  const bundleIds = await readAffectedBundleIds(tx, itemIds);
  for (const bundleId of bundleIds) {
    const [current] = await rows(tx, sql`SELECT d.bundleId FROM emergency_pricing_bundles d
      JOIN delegate_pricing_bundle_approvals a ON a.bundleId=d.bundleId
      WHERE d.bundleId=${bundleId} AND d.submittedAt IS NOT NULL AND d.cancelledAt IS NULL
      AND a.status='awaiting_receipt' FOR UPDATE`);
    if (!current) continue;
    const { required, received } = await readEmergencyBundleReceiptProgress(tx, bundleId);
    await tx.execute(sql`UPDATE emergency_pricing_bundles SET receivedItemCount=${received},requiredItemCount=${required}
      ${required === 0 ? sql`,cancelledAt=CURRENT_TIMESTAMP` : sql``} WHERE bundleId=${bundleId}`);
    if (required === 0 || received !== required) continue;
    await tx.execute(sql`UPDATE po_pricing_batches SET status='pending_accounting' WHERE status='awaiting_receipt'
      AND id IN (SELECT pricingBatchId FROM delegate_pricing_bundle_batches WHERE bundleId=${bundleId})`);
    await tx.execute(sql`UPDATE delegate_pricing_bundle_approvals SET status='pending_accounting',revision=revision+1
      WHERE bundleId=${bundleId} AND status='awaiting_receipt'`);
  }
}

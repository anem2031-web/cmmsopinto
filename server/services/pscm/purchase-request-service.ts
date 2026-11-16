import { createHash } from "node:crypto";
import { and, eq, inArray, ne, or } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  assets,
  auditLogs,
  catalogCodeAliases,
  catalogItems,
  centerCategories,
  pscmPurchaseItems,
  purchaseOrders,
  sections,
  sites,
  users,
} from "../../../drizzle/schema";
import {
  MAX_PURCHASE_DELIVERY_DAYS,
  remainingPurchaseCalendarDays,
} from "../../../shared/purchaseItemNeedDate";
import { APP_ROLE } from "../../../shared/roles";
import { findKnownInactiveCatalogUnitNames } from "../../_core/catalog-unit-governance";
import { withTransaction, type getDb } from "../../_core/db/client";
import { createNotification } from "../../_core/db/notifications";
import {
  createPOItems,
  createPurchaseOrder,
  getNextPONumber,
  getPOItems,
} from "../../_core/db/purchase";
import { getAllUsers } from "../../_core/db/users";
import { assertPurchaseCatalogBaseUnits } from "../purchase-catalog-units";
import { queuePOItemsTranslation } from "../purchase-item-translations";
import { purchaseReviewRecipients } from "../purchase-review-routing";
import {
  PscmPurchaseError,
  type PscmPurchaseConfirmation,
  type PscmPurchasePayload,
} from "./purchase-request-contract";

type Database = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Source = PscmPurchasePayload["source"];
type Item = PscmPurchasePayload["items"][number];

function sourceCriteria(source: Source) {
  return and(
    eq(purchaseOrders.sourceSystem, source.system),
    eq(purchaseOrders.sourceInstanceId, source.instanceId),
    or(
      eq(purchaseOrders.sourceRequestId, source.requisitionId),
      eq(purchaseOrders.sourceReference, source.requisitionNumber)
    )
  );
}

async function findExistingPurchase(
  tx: Tx,
  source: Source,
  hash: string
): Promise<PscmPurchaseConfirmation | null> {
  const rows = await tx
    .select({
      id: purchaseOrders.id,
      poNumber: purchaseOrders.poNumber,
      hash: purchaseOrders.sourcePayloadHash,
      requesterName: purchaseOrders.sourceRequesterName,
    })
    .from(purchaseOrders)
    .where(sourceCriteria(source))
    .for("update");
  const [existing] = rows;
  if (!existing) return null;
  if (
    rows.length !== 1 ||
    existing.hash !== hash ||
    (existing.requesterName &&
      source.requesterName &&
      existing.requesterName !== source.requesterName)
  ) {
    throw new PscmPurchaseError("source_conflict");
  }
  // An identical requisition from an upgraded sender can supply a missing name.
  if (existing.requesterName === null && source.requesterName) {
    await tx
      .update(purchaseOrders)
      .set({ sourceRequesterName: source.requesterName })
      .where(eq(purchaseOrders.id, existing.id));
  }
  return {
    purchaseRequestId: existing.id,
    purchaseRequestNumber: existing.poNumber,
  };
}

async function lockPurchaseRequester(tx: Tx, requesterId: number) {
  const [requester] = await tx
    .select({ role: users.role, active: users.isActive })
    .from(users)
    .where(eq(users.id, requesterId))
    .for("update");
  if (
    !requester ||
    requester.active !== 1 ||
    (requester.role !== APP_ROLE.PURCHASE_REQUESTER &&
      requester.role !== APP_ROLE.CONSTRUCTION_PROCUREMENT_MANAGER)
  ) {
    throw new PscmPurchaseError("requester_unavailable");
  }
}

async function validateReferences(tx: Tx, items: Item[]) {
  const { siteId, sectionId, assetId } = items[0];
  if (
    items.some(
      item =>
        item.siteId !== siteId ||
        item.sectionId !== sectionId ||
        item.assetId !== assetId
    )
  ) {
    throw new PscmPurchaseError("invalid_location");
  }
  const [location] = await tx
    .select({ id: sections.id })
    .from(sections)
    .innerJoin(sites, eq(sites.id, sections.siteId))
    .where(
      and(
        eq(sites.id, siteId),
        eq(sites.isActive, 1),
        eq(sections.id, sectionId),
        eq(sections.isActive, 1)
      )
    )
    .for("update");
  if (!location) throw new PscmPurchaseError("invalid_location");

  if (assetId !== null) {
    const [asset] = await tx
      .select({ id: assets.id })
      .from(assets)
      .where(
        and(
          eq(assets.id, assetId),
          eq(assets.siteId, siteId),
          eq(assets.sectionId, sectionId),
          ne(assets.status, "disposed")
        )
      )
      .for("update");
    if (!asset) throw new PscmPurchaseError("invalid_location");
  }

  const categoryIds = Array.from(new Set(items.map(item => item.categoryId)));
  const categories = await tx
    .select({ id: centerCategories.id })
    .from(centerCategories)
    .where(
      and(
        inArray(centerCategories.id, categoryIds),
        eq(centerCategories.isActive, 1)
      )
    )
    .orderBy(centerCategories.id)
    .for("update");
  if (categories.length !== categoryIds.length)
    throw new PscmPurchaseError("invalid_category");
}

async function validateCatalog(tx: Tx, items: Item[]) {
  const linked = items.flatMap(item =>
    item.catalogItemId === null
      ? []
      : [{ id: item.catalogItemId, code: item.catalogCode }]
  );
  const ids = Array.from(new Set(linked.map(item => item.id)));
  if (ids.length) {
    const rows = await tx
      .select({ id: catalogItems.id, code: catalogItems.code })
      .from(catalogItems)
      .where(and(inArray(catalogItems.id, ids), eq(catalogItems.isActive, 1)))
      .orderBy(catalogItems.id)
      .for("update");
    if (rows.length !== ids.length)
      throw new PscmPurchaseError("invalid_catalog_item");
    const codes = new Map(rows.map(row => [row.id, row.code?.trim()]));
    const changed = linked.filter(item => codes.get(item.id) !== item.code);
    if (changed.length) {
      const aliases = await tx
        .select({
          id: catalogCodeAliases.entityId,
          code: catalogCodeAliases.oldCode,
        })
        .from(catalogCodeAliases)
        .where(
          and(
            eq(catalogCodeAliases.entityType, "item"),
            inArray(catalogCodeAliases.entityId, ids),
            inArray(
              catalogCodeAliases.oldCode,
              Array.from(new Set(changed.map(item => item.code)))
            )
          )
        );
      const previousCodes = new Set(
        aliases.map(alias => `${alias.id}:${alias.code}`)
      );
      if (changed.some(item => !previousCodes.has(`${item.id}:${item.code}`))) {
        throw new PscmPurchaseError("invalid_catalog_item");
      }
    }
  }

  const units = items.map(item => ({
    catalogItemId: item.catalogItemId,
    unit: item.unit.nameAr,
  }));
  if (units.some(item => item.unit.length > 50))
    throw new PscmPurchaseError("invalid_unit");
  if (
    (
      await findKnownInactiveCatalogUnitNames(
        units.map(item => item.unit),
        tx
      )
    ).length
  ) {
    throw new PscmPurchaseError("invalid_unit");
  }
  try {
    await assertPurchaseCatalogBaseUnits(tx, units);
  } catch (error) {
    if (error instanceof TRPCError && error.code === "BAD_REQUEST")
      throw new PscmPurchaseError("invalid_unit");
    throw error;
  }
}

function toPurchaseItem(item: Item, submittedAt: Date) {
  if (!/^\d+(?:\.0+)?$/.test(item.quantity) || Number(item.quantity) < 1) {
    throw new PscmPurchaseError("unsupported_quantity");
  }
  const days = remainingPurchaseCalendarDays(item.needDate, submittedAt);
  if (days === null || days > MAX_PURCHASE_DELIVERY_DAYS)
    throw new PscmPurchaseError("invalid_need_date");
  return {
    catalogItemId: item.catalogItemId,
    itemName: item.itemName,
    description: item.specifications || null,
    notes: item.notes || null,
    quantity: Number(item.quantity),
    unit: item.unit.nameAr,
    requiredDate: item.needDate,
    // A previously approved requirement can become overdue while delivery is queued.
    deliveryLeadDays: Math.max(0, days),
    siteId: item.siteId,
    sectionId: item.sectionId,
    assetId: item.assetId,
    categoryId: item.categoryId,
    reviewRole: item.reviewRole,
    delegateId: null,
    status: "pending_review" as const,
  };
}

async function notifyReviewers(
  purchase: PscmPurchaseConfirmation,
  sourceReference: string,
  items: Item[]
) {
  // An automated submission may be assigned to the configured requester's review role.
  const recipients = purchaseReviewRecipients(await getAllUsers(), items);
  const results = await Promise.allSettled(
    recipients.map(user =>
      createNotification({
        userId: user.id,
        title: `🛒 طلب شراء جديد #${purchase.purchaseRequestNumber}`,
        message: `تم إنشاء طلب شراء من احتياج PSCM رقم ${sourceReference} يحتوي على ${items.length} صنف. بانتظار المراجعة.`,
        type: "warning",
        relatedPoId: purchase.purchaseRequestId,
      })
    )
  );
  if (results.some(result => result.status === "rejected")) {
    console.error("[PSCM purchase] One or more reviewer notifications failed.");
  }
}

function isDuplicateKey(error: unknown): boolean {
  const candidate = error as {
    code?: string;
    cause?: { code?: string };
  } | null;
  return (
    candidate?.code === "ER_DUP_ENTRY" ||
    candidate?.cause?.code === "ER_DUP_ENTRY"
  );
}

export async function importApprovedPscmPurchase(
  payload: PscmPurchasePayload,
  requesterId: number
) {
  const { source } = payload;
  const { requesterName, ...sourceIdentity } = source;
  const items = [...payload.items].sort((a, b) => a.sequence - b.sequence);
  // Keep hashes compatible with sender versions that omitted the display name.
  const hash = createHash("sha256")
    .update(JSON.stringify({ ...payload, source: sourceIdentity, items }))
    .digest("hex");

  let result: PscmPurchaseConfirmation & { created: boolean };
  try {
    result = await withTransaction(async (tx: Tx) => {
      // The requester row serializes same-client imports before the counter is used.
      // The unique source indexes also guard against races across configurations.
      await lockPurchaseRequester(tx, requesterId);
      const existing = await findExistingPurchase(tx, source, hash);
      if (existing) return { ...existing, created: false };

      const submittedAt = new Date();
      const purchaseItems = items.map(item =>
        toPurchaseItem(item, submittedAt)
      );
      await validateReferences(tx, items);
      await validateCatalog(tx, items);
      const purchaseRequestNumber = await getNextPONumber(tx);
      const { siteId, sectionId, assetId, categoryId } = purchaseItems[0];
      const purchaseRequestId = await createPurchaseOrder(
        {
          poNumber: purchaseRequestNumber,
          requestedById: requesterId,
          status: "pending_review",
          submittedAt,
          siteId,
          sectionId,
          assetId,
          categoryId,
          sourceSystem: source.system,
          sourceInstanceId: source.instanceId,
          sourceRequestId: source.requisitionId,
          sourceReference: source.requisitionNumber,
          sourceRequesterName: requesterName ?? null,
          sourcePayloadHash: hash,
        },
        tx
      );
      if (!purchaseRequestId) throw new Error("Missing purchase order id");
      await createPOItems(
        purchaseItems.map(item => ({
          ...item,
          purchaseOrderId: purchaseRequestId,
        })),
        tx
      );
      if (source.task) {
        const task = source.task;
        const created: Array<{ id: number }> = await getPOItems(purchaseRequestId, tx);
        if (created.length !== items.length) throw new Error("Missing imported purchase items");
        await tx.insert(pscmPurchaseItems).values(created.map((line, index) => ({
          purchaseOrderItemId: line.id,
          purchaseOrderId: purchaseRequestId,
          sequence: items[index].sequence,
          taskId: task.id,
          taskName: task.name,
          projectId: source.project.id,
          projectName: source.project.name,
          requestedQuantity: purchaseItems[index].quantity,
          orderUnit: purchaseItems[index].unit,
        })));
      }
      await tx.insert(auditLogs).values({
        userId: requesterId,
        action: "create_po",
        entityType: "purchase_order",
        entityId: purchaseRequestId,
        newValues: { poNumber: purchaseRequestNumber, source },
      });
      return { purchaseRequestId, purchaseRequestNumber, created: true };
    });
  } catch (error) {
    if (!isDuplicateKey(error)) throw error;
    const existing = await withTransaction(async (tx: Tx) => {
      await lockPurchaseRequester(tx, requesterId);
      return findExistingPurchase(tx, source, hash);
    });
    if (!existing) throw error;
    return { ...existing, created: false };
  }

  if (result.created) {
    void getPOItems(result.purchaseRequestId)
      .then(rows => queuePOItemsTranslation(rows, requesterId))
      .catch(() =>
        console.error("[PSCM purchase] Failed to queue item translations.")
      );
    void notifyReviewers(result, source.requisitionNumber, items).catch(() =>
      console.error("[PSCM purchase] Failed to notify reviewers.")
    );
  }
  return result;
}

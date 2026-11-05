import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { pendingPurchaseCoverageQuantity } from "./specification-purchase-coverage";
import {
  pmv2ItemActions,
  pmv2MaterialPurchaseLinks,
  pmv2MaterialRequestItems,
  pmv2MaterialRequests,
  pmv2TaskItems,
  pmv2Tasks,
  pmv2Teams,
  users,
} from "../../../drizzle/schema";
import { getDb } from "../../_core/db/client";
import {
  currentCatalogAdapter,
  currentInventoryAdapter,
  currentPurchaseAdapter,
  currentWarehouseAdapter,
  Pmv2ExternalReferenceError,
} from "../adapters/current-system";

export class Pmv2WarehouseQueueError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "Pmv2WarehouseQueueError";
  }
}



type MaterialRouteDecisionSnapshot = {
  route: "material_request";
  materialRequestItemId: number;
  requestedQuantity: number;
  availableQuantity: number | null;
  shortageQuantity: number;
};

function parseMaterialRequestRouteDecision(note: string | null | undefined): MaterialRouteDecisionSnapshot | null {
  if (!note) return null;
  try {
    const parsed = JSON.parse(note) as Record<string, unknown>;
    if (parsed.version !== 1 || parsed.route !== "material_request") return null;
    const materialRequestItemId = Number(parsed.materialRequestItemId);
    const requestedQuantity = Number(parsed.requestedQuantity);
    const shortageQuantity = Number(parsed.shortageQuantity);
    const availableQuantity = parsed.availableQuantity == null ? null : Number(parsed.availableQuantity);
    if (!Number.isInteger(materialRequestItemId) || materialRequestItemId <= 0) return null;
    if (!Number.isFinite(requestedQuantity) || requestedQuantity <= 0) return null;
    if (!Number.isFinite(shortageQuantity) || shortageQuantity < 0) return null;
    if (availableQuantity != null && (!Number.isFinite(availableQuantity) || availableQuantity < 0)) return null;
    return {
      route: "material_request",
      materialRequestItemId,
      requestedQuantity,
      availableQuantity,
      shortageQuantity,
    };
  } catch {
    return null;
  }
}

export type Pmv2MainWarehouseAvailabilityStatus =
  | "available"
  | "insufficient"
  | "unlisted"
  | "catalog_unavailable"
  | "ambiguous_inventory"
  | "unit_mismatch";

function normalizeUnit(value: string | null | undefined) {
  return String(value || "").trim().toLocaleLowerCase();
}

function roundQuantity(value: number) {
  return Number(Math.max(0, value).toFixed(3));
}

async function requireDb() {
  const db = await getDb();
  if (!db) throw new Error("تعذر الاتصال بقاعدة البيانات");
  return db;
}

/**
 * Phase 4 / Step 4.2A warehouse-side read model.
 *
 * The queue is intentionally read-only. PM V2 reads the current Catalog,
 * Main-Warehouse Inventory, and destination Warehouse through adapters. It does
 * not create Warehouse Transfers, Purchase Orders, inventory transactions, or
 * mutate PM V2 request status in this slice.
 */
export class Pmv2WarehouseQueueService {
  async listWaitingMaterialItems() {
    const db = await requireDb();

    let mainWarehouse;
    try {
      mainWarehouse = await currentWarehouseAdapter.requireSingleActiveMainWarehouse();
    } catch (error) {
      if (error instanceof Pmv2ExternalReferenceError) {
        throw new Pmv2WarehouseQueueError(error.message);
      }
      throw error;
    }

    const rows = await db
      .select({
        requestId: pmv2MaterialRequests.id,
        requestItemId: pmv2MaterialRequestItems.id,
        requestCreatedAt: pmv2MaterialRequests.createdAt,
        requestedById: pmv2MaterialRequests.requestedById,
        requestCreatorName: users.name,
        taskItemId: pmv2MaterialRequests.taskItemId,
        taskItemTitle: pmv2TaskItems.titleSnapshot,
        taskId: pmv2Tasks.id,
        taskNumber: pmv2Tasks.taskNumber,
        dueDate: pmv2Tasks.dueDate,
        taskStatus: pmv2Tasks.status,
        teamId: pmv2MaterialRequests.teamId,
        teamCode: pmv2Teams.code,
        teamWarehouseId: pmv2MaterialRequests.teamWarehouseId,
        catalogItemId: pmv2MaterialRequestItems.catalogItemId,
        itemNameSnapshot: pmv2MaterialRequestItems.itemNameSnapshot,
        requestedQuantity: pmv2MaterialRequestItems.requestedQuantity,
        unitSnapshot: pmv2MaterialRequestItems.unitSnapshot,
        status: pmv2MaterialRequestItems.status,
        receivedWarehouseQuantity: pmv2MaterialRequestItems.receivedWarehouseQuantity,
        issuedToTeamQuantity: pmv2MaterialRequestItems.issuedToTeamQuantity,
        requestItemCreatedAt: pmv2MaterialRequestItems.createdAt,
      })
      .from(pmv2MaterialRequestItems)
      .innerJoin(
        pmv2MaterialRequests,
        eq(pmv2MaterialRequests.id, pmv2MaterialRequestItems.requestId),
      )
      .innerJoin(
        pmv2TaskItems,
        eq(pmv2TaskItems.id, pmv2MaterialRequests.taskItemId),
      )
      .innerJoin(pmv2Tasks, eq(pmv2Tasks.id, pmv2TaskItems.taskId))
      .innerJoin(pmv2Teams, eq(pmv2Teams.id, pmv2MaterialRequests.teamId))
      .leftJoin(users, eq(users.id, pmv2MaterialRequests.requestedById))
      .where(eq(pmv2MaterialRequestItems.status, "waiting_warehouse"))
      .orderBy(
        asc(pmv2MaterialRequestItems.createdAt),
        asc(pmv2MaterialRequestItems.id),
      );

    const taskItemIds = [
      ...new Set(rows.map((row) => row.taskItemId).filter((id) => Number(id) > 0)),
    ];
    const routeDecisionRows = taskItemIds.length
      ? await db
          .select({
            id: pmv2ItemActions.id,
            note: pmv2ItemActions.note,
          })
          .from(pmv2ItemActions)
          .where(
            and(
              eq(pmv2ItemActions.action, "material_route_decision"),
              inArray(pmv2ItemActions.taskItemId, taskItemIds),
            ),
          )
          .orderBy(desc(pmv2ItemActions.id))
      : [];
    const routeDecisionByRequestItemId = new Map<number, MaterialRouteDecisionSnapshot>();
    for (const action of routeDecisionRows) {
      const snapshot = parseMaterialRequestRouteDecision(action.note);
      if (!snapshot || routeDecisionByRequestItemId.has(snapshot.materialRequestItemId)) continue;
      routeDecisionByRequestItemId.set(snapshot.materialRequestItemId, snapshot);
    }

    const catalogIds = [
      ...new Set(
        rows
          .map((row) => row.catalogItemId)
          .filter((id): id is number => Number.isInteger(id) && Number(id) > 0),
      ),
    ];
    const teamWarehouseIds = [
      ...new Set(rows.map((row) => row.teamWarehouseId).filter((id) => Number(id) > 0)),
    ];

    const [availabilityRows, catalogEntries, teamWarehouseEntries] = await Promise.all([
      currentInventoryAdapter.getCatalogAvailabilities(catalogIds, mainWarehouse.id),
      currentCatalogAdapter.getItemsByIds(catalogIds),
      Promise.all(
        teamWarehouseIds.map(async (warehouseId) => [
          warehouseId,
          await currentWarehouseAdapter.getWarehouseById(warehouseId),
        ] as const),
      ),
    ]);

    const availabilityByCatalogId = new Map(
      availabilityRows.map((item) => [item.catalogItemId, item]),
    );
    const catalogById = new Map(catalogEntries.map((item) => [item.id, item]));
    const teamWarehouseById = new Map(teamWarehouseEntries);

    const requestItemIds = rows.map((row) => Number(row.requestItemId)).filter((id) => id > 0);
    const purchaseLinkRows = requestItemIds.length
      ? await db
          .select({
            id: pmv2MaterialPurchaseLinks.id,
            materialRequestItemId: pmv2MaterialPurchaseLinks.materialRequestItemId,
            purchaseOrderId: pmv2MaterialPurchaseLinks.purchaseOrderId,
            purchaseOrderItemId: pmv2MaterialPurchaseLinks.purchaseOrderItemId,
            linkedQuantity: pmv2MaterialPurchaseLinks.linkedQuantity,
          })
          .from(pmv2MaterialPurchaseLinks)
          .where(inArray(pmv2MaterialPurchaseLinks.materialRequestItemId, requestItemIds))
      : [];
    const [purchaseOrders, purchaseItems] = await Promise.all([
      currentPurchaseAdapter.getOrdersByIds(purchaseLinkRows.map((row) => Number(row.purchaseOrderId))),
      currentPurchaseAdapter.getItemsByIds(purchaseLinkRows.map((row) => Number(row.purchaseOrderItemId))),
    ]);
    const purchaseOrderById = new Map(purchaseOrders.map((row) => [row.id, row]));
    const purchaseItemById = new Map(purchaseItems.map((row) => [row.id, row]));
    const purchaseLinksByRequestItemId = new Map<number, any[]>();
    for (const link of purchaseLinkRows) {
      const order = purchaseOrderById.get(Number(link.purchaseOrderId)) ?? null;
      const purchaseItem = purchaseItemById.get(Number(link.purchaseOrderItemId)) ?? null;
      const linkedQuantity = roundQuantity(Number(link.linkedQuantity || 0));
      const pendingCoverageQuantity = order && purchaseItem
        ? pendingPurchaseCoverageQuantity(linkedQuantity, order.status, purchaseItem.status, purchaseItem.inventoryReceivedQuantity, purchaseItem.specificationHeldQuantity)
        : 0;
      const row = {
        id: Number(link.id),
        purchaseOrderId: Number(link.purchaseOrderId),
        purchaseOrderItemId: Number(link.purchaseOrderItemId),
        linkedQuantity,
        poNumber: order?.poNumber || null,
        orderStatus: order?.status || null,
        itemStatus: purchaseItem?.status || null,
        purchaseQuantity: purchaseItem?.quantity ?? null,
        inventoryReceivedQuantity: purchaseItem?.inventoryReceivedQuantity ?? null,
        pendingCoverageQuantity,
        pendingCoverage: pendingCoverageQuantity > 0,
      };
      const list = purchaseLinksByRequestItemId.get(Number(link.materialRequestItemId)) || [];
      list.push(row);
      purchaseLinksByRequestItemId.set(Number(link.materialRequestItemId), list);
    }

    const items = rows.map((row) => {
      const routeDecision = routeDecisionByRequestItemId.get(row.requestItemId) ?? null;
      const requestedQuantity = Number(row.requestedQuantity || 0);
      const issuedToTeamQuantity = Number(row.issuedToTeamQuantity || 0);
      const remainingQuantity = Number(
        Math.max(0, requestedQuantity - issuedToTeamQuantity).toFixed(3),
      );
      const catalogItem = row.catalogItemId == null
        ? null
        : catalogById.get(row.catalogItemId) ?? null;
      const availability = row.catalogItemId == null
        ? null
        : availabilityByCatalogId.get(row.catalogItemId) ?? null;
      const availableQuantity = availability == null
        ? null
        : Math.max(0, Number(availability.availableQuantity || 0));
      const purchaseLinks = purchaseLinksByRequestItemId.get(Number(row.requestItemId)) || [];
      const pendingPurchaseCoverageQuantity = roundQuantity(
        purchaseLinks.reduce((sum, link) => sum + Number(link.pendingCoverageQuantity || 0), 0),
      );

      let availabilityStatus: Pmv2MainWarehouseAvailabilityStatus;
      if (row.catalogItemId == null) {
        availabilityStatus = "unlisted";
      } else if (!catalogItem || !catalogItem.isActive) {
        availabilityStatus = "catalog_unavailable";
      } else if (availability?.ambiguous) {
        availabilityStatus = "ambiguous_inventory";
      } else if (
        availability?.unit &&
        row.unitSnapshot &&
        normalizeUnit(availability.unit) !== normalizeUnit(row.unitSnapshot)
      ) {
        availabilityStatus = "unit_mismatch";
      } else if ((availableQuantity ?? 0) >= remainingQuantity) {
        availabilityStatus = "available";
      } else {
        availabilityStatus = "insufficient";
      }

      return {
        ...row,
        requestedQuantity,
        taskNeedQuantity: routeDecision?.requestedQuantity ?? null,
        teamAvailableAtRequest: routeDecision?.availableQuantity ?? null,
        receivedWarehouseQuantity: Number(row.receivedWarehouseQuantity || 0),
        issuedToTeamQuantity,
        remainingQuantity,
        teamWarehouse: teamWarehouseById.get(row.teamWarehouseId) ?? null,
        catalogItem,
        mainWarehouseAvailability: availability
          ? {
              inventoryId: availability.inventoryId,
              availableQuantity,
              unit: availability.unit,
              lotsRequired: availability.lotsRequired,
              ambiguous: availability.ambiguous,
            }
          : null,
        availabilityStatus,
        transferableNow:
          row.catalogItemId == null ||
          availableQuantity == null ||
          availabilityStatus === "catalog_unavailable" ||
          availabilityStatus === "ambiguous_inventory" ||
          availabilityStatus === "unit_mismatch"
            ? 0
            : Number(Math.min(remainingQuantity, availableQuantity).toFixed(3)),
        mainWarehouseShortageQuantity:
          row.catalogItemId == null || availableQuantity == null
            ? null
            : Number(Math.max(0, remainingQuantity - availableQuantity).toFixed(3)),
        purchaseLinks,
        pendingPurchaseCoverageQuantity,
        purchaseNeededQuantity:
          row.catalogItemId == null || availableQuantity == null
            ? null
            : Number(Math.max(0, remainingQuantity - availableQuantity - pendingPurchaseCoverageQuantity).toFixed(3)),
      };
    });

    return {
      mainWarehouse,
      total: items.length,
      items,
    };
  }
}

export const pmv2WarehouseQueueService = new Pmv2WarehouseQueueService();

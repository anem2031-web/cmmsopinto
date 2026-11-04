import { and, asc, eq, gt, inArray, isNull, like, ne, or, sql, type SQL } from "drizzle-orm";
import { assets, catalogItems, catalogNodes, deliveryDocuments, inventory, inventoryLotBalances, inventoryLots, materialExecutionCostContexts, purchaseOrderItems, purchaseOrders, sections, sites, tickets, users, warehouseReceiptItems, warehouseReceipts, warehouses, warehouseTransfers } from "../../../drizzle/schema";
import { materialExecutionCostsEnabled } from "../../services/material-costs/feature";
import { getDb } from "../../_core/db/client";
import { createRecipientWarehouseReturn, issueDelivery } from "../../_core/db/warehouse-returns";
import { isInventoryLotsEnabled } from "../../_core/inventory-lots";
import { filterSpecificationLots } from "../../services/purchase-specification-guards";
import type {
  CatalogAdapter,
  DeliveryAdapter,
  InventoryAdapter,
  InventoryIssueAdapter,
  RecipientReturnAdapter,
  MaintenanceTargetAdapter,
  Pmv2AssetRef,
  Pmv2CatalogItemRef,
  Pmv2ExternalId,
  Pmv2MaintenanceTargetRef,
  Pmv2PurchaseOrderItemRef,
  Pmv2PurchaseOrderRef,
  Pmv2SectionRef,
  Pmv2SiteRef,
  Pmv2UserRef,
  Pmv2WarehouseRef,
  UsersAdapter,
  WarehouseAdapter,
  WarehouseTransferAdapter,
  PurchaseAdapter,
  TicketAdapter,
  Pmv2TicketRef,
} from "./contracts";

export class Pmv2ExternalReferenceError extends Error {
  constructor(
    public readonly referenceType: "user" | "warehouse" | "catalog_item",
    public readonly referenceId: number,
    message: string,
  ) {
    super(message);
    this.name = "Pmv2ExternalReferenceError";
  }
}

async function requireDb() {
  const db = await getDb();
  if (!db) throw new Error("تعذر الاتصال بقاعدة البيانات");
  return db;
}

async function getUserRef(id: Pmv2ExternalId): Promise<Pmv2UserRef | null> {
  const db = await requireDb();
  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      role: users.role,
      isActive: users.isActive,
    })
    .from(users)
    .where(eq(users.id, id))
    .limit(1);
  const row = rows[0];
  return row
    ? {
        id: row.id,
        name: row.name,
        role: row.role,
        isActive: row.isActive === 1,
      }
    : null;
}

async function getWarehouseRef(
  id: Pmv2ExternalId,
): Promise<Pmv2WarehouseRef | null> {
  const db = await requireDb();
  const rows = await db
    .select({
      id: warehouses.id,
      code: warehouses.code,
      nameAr: warehouses.nameAr,
      nameEn: warehouses.nameEn,
      isActive: warehouses.isActive,
    })
    .from(warehouses)
    .where(eq(warehouses.id, id))
    .limit(1);
  const row = rows[0];
  return row
    ? {
        id: row.id,
        code: row.code,
        nameAr: row.nameAr,
        nameEn: row.nameEn,
        isActive: row.isActive === 1,
      }
    : null;
}

async function getCatalogItemRef(
  id: Pmv2ExternalId,
): Promise<Pmv2CatalogItemRef | null> {
  const db = await requireDb();
  const rows = await db
    .select({
      id: catalogItems.id,
      code: catalogItems.code,
      nameAr: catalogItems.nameAr,
      nameEn: catalogItems.nameEn,
      unit: catalogItems.unit,
      isActive: catalogItems.isActive,
    })
    .from(catalogItems)
    .where(eq(catalogItems.id, id))
    .limit(1);
  const row = rows[0];
  return row
    ? {
        id: row.id,
        code: row.code,
        nameAr: row.nameAr,
        nameEn: row.nameEn,
        unit: row.unit,
        isActive: row.isActive === 1,
        categoryPathAr: null,
        categoryPathEn: null,
      }
    : null;
}


async function getCatalogItemRefsWithTaxonomy(
  ids: Pmv2ExternalId[],
): Promise<Pmv2CatalogItemRef[]> {
  const uniqueIds = [...new Set(ids.filter((id) => Number.isInteger(id) && id > 0))];
  if (uniqueIds.length === 0) return [];

  const db = await requireDb();
  const [itemRows, nodeRows] = await Promise.all([
    db
      .select({
        id: catalogItems.id,
        code: catalogItems.code,
        nameAr: catalogItems.nameAr,
        nameEn: catalogItems.nameEn,
        unit: catalogItems.unit,
        nodeId: catalogItems.nodeId,
        isActive: catalogItems.isActive,
      })
      .from(catalogItems)
      .where(inArray(catalogItems.id, uniqueIds)),
    db
      .select({
        id: catalogNodes.id,
        parentId: catalogNodes.parentId,
        nameAr: catalogNodes.nameAr,
        nameEn: catalogNodes.nameEn,
      })
      .from(catalogNodes),
  ]);

  const nodeById = new Map(nodeRows.map((node) => [Number(node.id), node]));
  const pathCache = new Map<number, typeof nodeRows>();
  const getPath = (nodeId: number) => {
    const cached = pathCache.get(nodeId);
    if (cached) return cached;

    const path: typeof nodeRows = [];
    const visited = new Set<number>();
    let currentId: number | null = nodeId;
    for (let depth = 0; currentId && depth < 50; depth += 1) {
      if (visited.has(currentId)) break;
      visited.add(currentId);
      const node = nodeById.get(currentId);
      if (!node) break;
      path.unshift(node);
      currentId = node.parentId == null ? null : Number(node.parentId);
    }
    pathCache.set(nodeId, path);
    return path;
  };

  return itemRows.map((row) => {
    const path = getPath(Number(row.nodeId));
    return {
      id: row.id,
      code: row.code,
      nameAr: row.nameAr,
      nameEn: row.nameEn,
      unit: row.unit,
      isActive: row.isActive === 1,
      categoryPathAr: path.map((node) => node.nameAr).filter(Boolean).join(" › ") || null,
      categoryPathEn: path.map((node) => node.nameEn).filter(Boolean).join(" > ") || null,
    };
  });
}

/** Current CMMS users adapter. PM V2 references users but never owns them. */
export const currentUsersAdapter: UsersAdapter = {
  async listActiveUsers(): Promise<Pmv2UserRef[]> {
    const db = await requireDb();
    const rows = await db
      .select({
        id: users.id,
        name: users.name,
        role: users.role,
        isActive: users.isActive,
      })
      .from(users)
      .where(eq(users.isActive, 1))
      .orderBy(asc(users.name));
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      role: row.role,
      isActive: row.isActive === 1,
    }));
  },

  getUserById: getUserRef,

  async requireActiveUser(id: Pmv2ExternalId): Promise<Pmv2UserRef> {
    const user = await getUserRef(id);
    if (!user) {
      throw new Pmv2ExternalReferenceError(
        "user",
        id,
        "المستخدم المحدد غير موجود",
      );
    }
    if (!user.isActive) {
      throw new Pmv2ExternalReferenceError(
        "user",
        id,
        "المستخدم المحدد غير فعال",
      );
    }
    return user;
  },
};

/** Current CMMS warehouse adapter. PM V2 references warehouses but never owns them. */
export const currentWarehouseAdapter: WarehouseAdapter = {
  async listActiveWarehouses(): Promise<Pmv2WarehouseRef[]> {
    const db = await requireDb();
    const rows = await db
      .select({
        id: warehouses.id,
        code: warehouses.code,
        nameAr: warehouses.nameAr,
        nameEn: warehouses.nameEn,
        isActive: warehouses.isActive,
      })
      .from(warehouses)
      .where(eq(warehouses.isActive, 1))
      .orderBy(asc(warehouses.nameAr));
    return rows.map((row) => ({
      id: row.id,
      code: row.code,
      nameAr: row.nameAr,
      nameEn: row.nameEn,
      isActive: row.isActive === 1,
    }));
  },

  getWarehouseById: getWarehouseRef,

  async requireActiveWarehouse(id: Pmv2ExternalId): Promise<Pmv2WarehouseRef> {
    const warehouse = await getWarehouseRef(id);
    if (!warehouse) {
      throw new Pmv2ExternalReferenceError(
        "warehouse",
        id,
        "المستودع المحدد غير موجود",
      );
    }
    if (!warehouse.isActive) {
      throw new Pmv2ExternalReferenceError(
        "warehouse",
        id,
        "المستودع المحدد غير فعال",
      );
    }
    return warehouse;
  },

  async requireSingleActiveMainWarehouse(): Promise<Pmv2WarehouseRef> {
    const db = await requireDb();
    // Match the current receiving workflow contract: resolve dynamically and
    // reject an ambiguous Main-Warehouse configuration instead of hard-coding ID 1.
    const rows = await db
      .select({
        id: warehouses.id,
        code: warehouses.code,
        nameAr: warehouses.nameAr,
        nameEn: warehouses.nameEn,
        isActive: warehouses.isActive,
      })
      .from(warehouses)
      .where(and(eq(warehouses.type, "main"), eq(warehouses.isActive, 1)))
      .orderBy(asc(warehouses.id))
      .limit(2);

    if (rows.length === 0) {
      throw new Pmv2ExternalReferenceError(
        "warehouse",
        0,
        "لا يوجد مستودع رئيسي مفعّل يمكن استخدامه لفحص طلبات PM V2",
      );
    }
    if (rows.length > 1) {
      throw new Pmv2ExternalReferenceError(
        "warehouse",
        0,
        "يوجد أكثر من مستودع رئيسي مفعّل؛ يجب تصحيح إعداد المخازن قبل معالجة طلبات PM V2",
      );
    }

    const row = rows[0];
    return {
      id: row.id,
      code: row.code,
      nameAr: row.nameAr,
      nameEn: row.nameEn,
      isActive: row.isActive === 1,
    };
  },
};


/** Current CMMS catalog adapter. Catalog remains the material master. */
export const currentCatalogAdapter: CatalogAdapter = {
  async searchActiveItems(query = "", limit = 30): Promise<Pmv2CatalogItemRef[]> {
    const db = await requireDb();
    const safeLimit = Math.min(Math.max(Math.trunc(limit || 30), 1), 50);
    const term = query.trim();
    const where = term
      ? and(
          eq(catalogItems.isActive, 1),
          or(
            like(catalogItems.nameAr, `%${term}%`),
            like(catalogItems.nameEn, `%${term}%`),
            like(catalogItems.code, `%${term}%`),
            like(catalogItems.manufacturer, `%${term}%`),
            like(catalogItems.descriptionAr, `%${term}%`),
            like(catalogItems.descriptionEn, `%${term}%`),
            like(catalogItems.unit, `%${term}%`),
          ),
        )
      : eq(catalogItems.isActive, 1);
    const rows = await db
      .select({
        id: catalogItems.id,
        code: catalogItems.code,
        nameAr: catalogItems.nameAr,
        nameEn: catalogItems.nameEn,
        unit: catalogItems.unit,
        isActive: catalogItems.isActive,
      })
      .from(catalogItems)
      .where(where)
      .orderBy(asc(catalogItems.nameAr), asc(catalogItems.id))
      .limit(safeLimit);
    return rows.map((row) => ({
      id: row.id,
      code: row.code,
      nameAr: row.nameAr,
      nameEn: row.nameEn,
      unit: row.unit,
      isActive: row.isActive === 1,
      categoryPathAr: null,
      categoryPathEn: null,
    }));
  },

  getItemById: getCatalogItemRef,

  async getItemsByIds(ids: Pmv2ExternalId[]): Promise<Pmv2CatalogItemRef[]> {
    return getCatalogItemRefsWithTaxonomy(ids);
  },

  async requireActiveItem(id: Pmv2ExternalId): Promise<Pmv2CatalogItemRef> {
    const item = await getCatalogItemRef(id);
    if (!item) {
      throw new Pmv2ExternalReferenceError(
        "catalog_item",
        id,
        "المادة المحددة غير موجودة في دليل المواد",
      );
    }
    if (!item.isActive) {
      throw new Pmv2ExternalReferenceError(
        "catalog_item",
        id,
        "المادة المحددة غير فعالة في دليل المواد",
      );
    }
    return item;
  },
};

/**
 * Current Inventory availability adapter. It is read-only: PM V2 never changes
 * stock here. With lot tracking enabled, positive lot balances are the usable
 * quantity because the current issue workflow requires a valid Lot/QR.
 */
async function getCatalogAvailabilitiesReadOnly(
  catalogItemIds: Pmv2ExternalId[],
  warehouseId: Pmv2ExternalId,
) {
  const ids = [...new Set(catalogItemIds.filter((id) => Number.isInteger(id) && id > 0))];
  if (ids.length === 0) return [];

  const db = await requireDb();
  const rows = await db
    .select({
      id: inventory.id,
      catalogItemId: inventory.linkedItemId,
      quantity: inventory.quantity,
      unit: inventory.unit,
      issueUnit: inventory.issueUnit,
    })
    .from(inventory)
    .where(
      and(
        inArray(inventory.linkedItemId, ids),
        eq(inventory.warehouseId, warehouseId),
        eq(inventory.isFrozen, 0),
      ),
    );

  const byCatalog = new Map<number, typeof rows>();
  for (const row of rows) {
    if (!row.catalogItemId) continue;
    const current = byCatalog.get(row.catalogItemId) ?? [];
    current.push(row);
    byCatalog.set(row.catalogItemId, current);
  }

  const lotsRequired = isInventoryLotsEnabled();
  const lotTotals = new Map<number, number>();
  if (lotsRequired && rows.length > 0) {
    const balances = await db
      .select({
        lotId: inventoryLotBalances.lotId,
        inventoryId: inventoryLotBalances.inventoryId,
        quantity: inventoryLotBalances.quantity,
      })
      .from(inventoryLotBalances)
      .where(
        and(
          inArray(inventoryLotBalances.inventoryId, rows.map((row) => row.id)),
          gt(inventoryLotBalances.quantity, "0"),
        ),
      );
    const eligibleBalances = await filterSpecificationLots(db, balances, (row) => Number(row.lotId));
    for (const balance of eligibleBalances) {
      lotTotals.set(
        balance.inventoryId,
        (lotTotals.get(balance.inventoryId) ?? 0) + Number(balance.quantity || 0),
      );
    }
  }

  return ids.map((catalogItemId) => {
    const matching = byCatalog.get(catalogItemId) ?? [];
    if (matching.length > 1) {
      return {
        catalogItemId,
        warehouseId,
        inventoryId: null,
        availableQuantity: 0,
        unit: null,
        lotsRequired,
        ambiguous: true,
      };
    }

    const row = matching[0];
    if (!row) {
      return {
        catalogItemId,
        warehouseId,
        inventoryId: null,
        availableQuantity: 0,
        unit: null,
        lotsRequired,
        ambiguous: false,
      };
    }

    return {
      catalogItemId,
      warehouseId,
      inventoryId: row.id,
      availableQuantity: lotsRequired
        ? lotTotals.get(row.id) ?? 0
        : Number(row.quantity || 0),
      unit: row.issueUnit || row.unit || null,
      lotsRequired,
      ambiguous: false,
    };
  });
}

export const currentInventoryAdapter: InventoryAdapter = {
  async listAvailableCatalogItemIds(warehouseId, limit = 120) {
    const db = await requireDb();
    const safeLimit = Math.min(Math.max(Math.trunc(limit || 120), 1), 250);
    const scanLimit = Math.min(safeLimit * 4, 1000);

    const rows = isInventoryLotsEnabled()
      ? await db
          .select({
            inventoryId: inventory.id,
            catalogItemId: inventory.linkedItemId,
          })
          .from(inventory)
          .innerJoin(inventoryLotBalances, eq(inventoryLotBalances.inventoryId, inventory.id))
          .innerJoin(inventoryLots, eq(inventoryLots.id, inventoryLotBalances.lotId))
          .where(
            and(
              eq(inventory.warehouseId, warehouseId),
              eq(inventory.isFrozen, 0),
              gt(inventoryLotBalances.quantity, "0"),
              or(isNull(inventoryLots.specificationStatus), eq(inventoryLots.specificationStatus, "approved")),
            ),
          )
          .groupBy(inventory.id, inventory.linkedItemId)
          .orderBy(asc(inventory.linkedItemId), asc(inventory.id))
          .limit(scanLimit)
      : await db
          .select({
            inventoryId: inventory.id,
            catalogItemId: inventory.linkedItemId,
          })
          .from(inventory)
          .where(
            and(
              eq(inventory.warehouseId, warehouseId),
              eq(inventory.isFrozen, 0),
              gt(inventory.quantity, "0"),
            ),
          )
          .orderBy(asc(inventory.linkedItemId), asc(inventory.id))
          .limit(scanLimit);

    const seen = new Set<number>();
    const result: number[] = [];
    for (const row of rows) {
      const catalogItemId = Number(row.catalogItemId || 0);
      if (!Number.isInteger(catalogItemId) || catalogItemId <= 0 || seen.has(catalogItemId)) continue;
      seen.add(catalogItemId);
      result.push(catalogItemId);
      if (result.length >= safeLimit) break;
    }
    return result;
  },

  async getInventoryItemById(inventoryId) {
    const db = await requireDb();
    const rows = await db
      .select({
        id: inventory.id,
        warehouseId: inventory.warehouseId,
        catalogItemId: inventory.linkedItemId,
        quantity: inventory.quantity,
        issueUnit: inventory.issueUnit,
        fallbackUnit: inventory.unit,
      })
      .from(inventory)
      .where(eq(inventory.id, inventoryId))
      .limit(1);
    const row = rows[0];
    return row
      ? {
          id: row.id,
          warehouseId: row.warehouseId,
          catalogItemId: row.catalogItemId,
          quantity: Number(row.quantity || 0),
          unit: row.issueUnit || row.fallbackUnit || null,
        }
      : null;
  },

  async getCatalogAvailability(catalogItemId, warehouseId) {
    const results = await getCatalogAvailabilitiesReadOnly([catalogItemId], warehouseId);
    return results[0] ?? {
      catalogItemId,
      warehouseId,
      inventoryId: null,
      availableQuantity: 0,
      unit: null,
      lotsRequired: isInventoryLotsEnabled(),
      ambiguous: false,
    };
  },

  getCatalogAvailabilities: getCatalogAvailabilitiesReadOnly,

  async listAvailableLots(inventoryId) {
    const db = await requireDb();
    const rows = await db
      .select({
        id: inventoryLots.id,
        inventoryId: inventoryLotBalances.inventoryId,
        lotCode: inventoryLots.lotCode,
        trackingToken: inventoryLots.trackingToken,
        quantity: inventoryLotBalances.quantity,
        expiryDate: inventoryLots.expiryDate,
        createdAt: inventoryLots.createdAt,
      })
      .from(inventoryLotBalances)
      .innerJoin(inventoryLots, eq(inventoryLots.id, inventoryLotBalances.lotId))
      .where(and(eq(inventoryLotBalances.inventoryId, inventoryId), gt(inventoryLotBalances.quantity, "0")))
      .orderBy(asc(inventoryLots.createdAt), asc(inventoryLots.id));

    const eligibleRows = await filterSpecificationLots(db, rows, (row) => Number(row.id));
    return eligibleRows.map((row) => ({
      id: Number(row.id),
      inventoryId: Number(row.inventoryId),
      lotCode: String(row.lotCode),
      trackingToken: String(row.trackingToken),
      quantity: Number(row.quantity || 0),
      expiryDate: row.expiryDate == null ? null : String(row.expiryDate),
      createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
    }));
  },
};

/** Existing Inventory/Delivery write boundary, invoked by PM V2 through an adapter. */
export const currentInventoryIssueAdapter: InventoryIssueAdapter = {
  async issueDelivery(input, transaction) {
    const result = await issueDelivery({
      pmv2TaskItemId: input.taskItemId,
      inventoryId: input.inventoryId,
      quantity: input.quantity,
      unit: input.unit,
      performedById: input.performedById,
      deliveredToId: input.deliveredToId,
      lotTrackingToken: input.lotTrackingToken,
      notes: input.notes,
      costAllocations: [{
        beneficiarySiteId: input.costTarget.beneficiarySiteId,
        beneficiarySectionId: input.costTarget.beneficiarySectionId,
        beneficiaryAssetId: input.costTarget.beneficiaryAssetId ?? undefined,
        quantity: input.quantity,
      }],
    }, transaction);
    return {
      deliveryNumber: result.deliveryNumber,
      deliveryDocumentId: result.deliveryDocumentId,
      inventoryTransactionId: result.inventoryTransactionId,
      lotId: result.lotId,
      lotCode: result.lotCode,
      lotTrackingToken: result.lotTrackingToken,
      quantity: Number(result.quantity || 0),
      unit: result.unit || input.unit || "",
    };
  },
};

/** Existing recipient-to-warehouse Return workflow boundary. */
export const currentRecipientReturnAdapter: RecipientReturnAdapter = {
  async createReturn(input, transaction) {
    const result = await createRecipientWarehouseReturn(input, transaction);
    return {
      returnId: Number(result.returnId),
      returnNumber: String(result.returnNumber),
      sourceDeliveryDocumentId: input.sourceDeliveryDocumentId,
      lotId: Number(result.lotId),
      lotCode: result.lotCode == null ? null : String(result.lotCode),
      returnedQuantity: Number(result.returnedQuantity || 0),
    };
  },
};

/**
 * Current Delivery adapter.
 *
 * Read-only by design: PM V2 consumes the authoritative Delivery Document
 * created by the existing Inventory workflow and never fabricates a stock
 * movement or delivery identity.
 */
export const currentDeliveryAdapter: DeliveryAdapter = {
  async getDeliveryByNumber(deliveryNumber, transaction) {
    const number = String(deliveryNumber || "").trim();
    if (!number) return null;

    const db = transaction || await requireDb();
    const rows = await db
      .select({
        id: deliveryDocuments.id,
        deliveryNumber: deliveryDocuments.deliveryNumber,
        inventoryId: deliveryDocuments.inventoryId,
        inventoryTransactionId: deliveryDocuments.inventoryTransactionId,
        inventoryLotId: deliveryDocuments.lotId,
        lotCode: inventoryLots.lotCode,
        purchaseOrderItemId: deliveryDocuments.poItemId,
        deliveredToId: deliveryDocuments.deliveredToId,
        quantity: deliveryDocuments.quantity,
        unit: deliveryDocuments.unit,
        createdAt: deliveryDocuments.createdAt,
        warehouseId: inventory.warehouseId,
        catalogItemId: inventory.linkedItemId,
      })
      .from(deliveryDocuments)
      .innerJoin(inventory, eq(inventory.id, deliveryDocuments.inventoryId))
      .leftJoin(inventoryLots, eq(inventoryLots.id, deliveryDocuments.lotId))
      .where(eq(deliveryDocuments.deliveryNumber, number))
      .limit(2);

    if (rows.length !== 1) return null;
    const row = rows[0];
    if (row.inventoryId == null || row.inventoryTransactionId == null) return null;

    const [costContext] = materialExecutionCostsEnabled()
      ? await db.select().from(materialExecutionCostContexts).where(eq(materialExecutionCostContexts.inventoryTransactionId, row.inventoryTransactionId)).limit(1)
      : [];

    return {
      executionSource: costContext?.executionSource ?? null,
      executionId: costContext?.executionId ?? null,
      executionItemId: costContext?.executionItemId ?? null,
      id: row.id,
      deliveryNumber: row.deliveryNumber,
      inventoryId: row.inventoryId,
      warehouseId: row.warehouseId,
      catalogItemId: row.catalogItemId,
      inventoryTransactionId: row.inventoryTransactionId,
      inventoryLotId: row.inventoryLotId,
      lotCode: row.lotCode || null,
      purchaseOrderItemId: Number(row.purchaseOrderItemId || 0) > 0
        ? Number(row.purchaseOrderItemId)
        : null,
      deliveredToId: row.deliveredToId == null ? null : Number(row.deliveredToId),
      quantity: Number(row.quantity || 0),
      unit: row.unit || null,
      createdAt: row.createdAt,
    };
  },
};

/**
 * Current Warehouse Transfer adapter.
 *
 * This boundary is deliberately read-only. The existing transfer router/db
 * service remains the only owner of stock movement, QR/Lot validation, and
 * transfer audit. PM V2 calls this adapter only after that workflow returned a
 * successful transfer number so it can validate the source event before
 * projecting fulfillment into pmv2_material_request_items.
 */
export const currentWarehouseTransferAdapter: WarehouseTransferAdapter = {
  async getTransfersByNumbers(transferNumbers) {
    const numbers = [
      ...new Set(
        transferNumbers
          .map((value) => String(value || "").trim())
          .filter(Boolean),
      ),
    ];
    if (numbers.length === 0) return [];

    const db = await requireDb();
    const rows = await db
      .select({
        id: warehouseTransfers.id,
        transferNumber: warehouseTransfers.transferNumber,
        batchId: warehouseTransfers.batchId,
        fromWarehouseId: warehouseTransfers.fromWarehouseId,
        toWarehouseId: warehouseTransfers.toWarehouseId,
        fromInventoryId: warehouseTransfers.fromInventoryId,
        inventoryLotId: warehouseTransfers.lotId,
        catalogItemId: inventory.linkedItemId,
        quantity: warehouseTransfers.quantity,
        unit: inventory.issueUnit,
        fallbackUnit: inventory.unit,
        createdById: warehouseTransfers.createdById,
        createdAt: warehouseTransfers.createdAt,
      })
      .from(warehouseTransfers)
      .innerJoin(inventory, eq(inventory.id, warehouseTransfers.fromInventoryId))
      .where(inArray(warehouseTransfers.transferNumber, numbers));

    return rows.map((row) => ({
      id: row.id,
      transferNumber: row.transferNumber,
      batchId: row.batchId,
      fromWarehouseId: row.fromWarehouseId,
      toWarehouseId: row.toWarehouseId,
      fromInventoryId: row.fromInventoryId,
      inventoryLotId: row.inventoryLotId,
      catalogItemId: row.catalogItemId,
      quantity: Number(row.quantity || 0),
      unit: row.unit || row.fallbackUnit || null,
      createdById: row.createdById,
      createdAt: row.createdAt,
    }));
  },
};



/** Read-only boundary over the current Purchase and confirmed Warehouse Receipt truth. */
const specificationHeldReceiptQuantity = sql<number>`CASE WHEN EXISTS (
  SELECT 1 FROM inventory_lots sl WHERE sl.receiptItemId=${warehouseReceiptItems.id}
  AND sl.specificationStatus IN ('pending','rejected') AND sl.remainingQuantity>0
) THEN ${warehouseReceiptItems.receivedQuantity} ELSE 0 END`;

export const currentPurchaseAdapter: PurchaseAdapter = {
  async getOrdersByIds(ids) {
    const uniqueIds = [...new Set(ids.filter((id) => Number.isInteger(id) && id > 0))];
    if (!uniqueIds.length) return [];
    const db = await requireDb();
    const rows = await db
      .select({ id: purchaseOrders.id, poNumber: purchaseOrders.poNumber, status: purchaseOrders.status })
      .from(purchaseOrders)
      .where(inArray(purchaseOrders.id, uniqueIds));
    return rows.map((row) => ({ id: Number(row.id), poNumber: String(row.poNumber), status: String(row.status) } satisfies Pmv2PurchaseOrderRef));
  },

  async getItemsByIds(ids) {
    const uniqueIds = [...new Set(ids.filter((id) => Number.isInteger(id) && id > 0))];
    if (!uniqueIds.length) return [];
    const db = await requireDb();
    const [rows, receiptRows] = await Promise.all([
      db
        .select({
          id: purchaseOrderItems.id,
          purchaseOrderId: purchaseOrderItems.purchaseOrderId,
          catalogItemId: purchaseOrderItems.catalogItemId,
          itemName: purchaseOrderItems.itemName,
          quantity: purchaseOrderItems.quantity,
          unit: purchaseOrderItems.unit,
          status: purchaseOrderItems.status,
        })
        .from(purchaseOrderItems)
        .where(inArray(purchaseOrderItems.id, uniqueIds)),
      db
        .select({
          purchaseOrderItemId: warehouseReceiptItems.purchaseOrderItemId,
          receivedQuantity: warehouseReceiptItems.receivedQuantity,
          specificationHeldQuantity: specificationHeldReceiptQuantity,
        })
        .from(warehouseReceiptItems)
        .innerJoin(warehouseReceipts, eq(warehouseReceipts.id, warehouseReceiptItems.receiptId))
        .where(and(
          inArray(warehouseReceiptItems.purchaseOrderItemId, uniqueIds),
          eq(warehouseReceipts.status, "confirmed"),
        )),
    ]);
    const receivedByItemId = new Map<number, number>();
    const heldByItemId = new Map<number, number>();
    for (const receipt of receiptRows) {
      if (receipt.purchaseOrderItemId == null) continue;
      const itemId = Number(receipt.purchaseOrderItemId);
      receivedByItemId.set(itemId, Number(((receivedByItemId.get(itemId) || 0) + Number(receipt.receivedQuantity || 0)).toFixed(3)));
      heldByItemId.set(itemId, Number(((heldByItemId.get(itemId) || 0) + Number(receipt.specificationHeldQuantity || 0)).toFixed(3)));
    }
    return rows.map((row) => ({
      id: Number(row.id),
      purchaseOrderId: Number(row.purchaseOrderId),
      catalogItemId: row.catalogItemId == null ? null : Number(row.catalogItemId),
      itemName: String(row.itemName),
      quantity: Number(row.quantity || 0),
      unit: row.unit == null ? null : String(row.unit),
      status: String(row.status),
      inventoryReceivedQuantity: receivedByItemId.get(Number(row.id)) || 0,
      specificationHeldQuantity: heldByItemId.get(Number(row.id)) || 0,
    } satisfies Pmv2PurchaseOrderItemRef));
  },

  async getOrderWithItems(purchaseOrderId) {
    if (!Number.isInteger(purchaseOrderId) || purchaseOrderId <= 0) return null;
    const db = await requireDb();
    const orderRows = await db
      .select({ id: purchaseOrders.id, poNumber: purchaseOrders.poNumber, status: purchaseOrders.status })
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, purchaseOrderId))
      .limit(1);
    const orderRow = orderRows[0];
    if (!orderRow) return null;
    const itemRows = await db
      .select({
        id: purchaseOrderItems.id,
        purchaseOrderId: purchaseOrderItems.purchaseOrderId,
        catalogItemId: purchaseOrderItems.catalogItemId,
        itemName: purchaseOrderItems.itemName,
        quantity: purchaseOrderItems.quantity,
        unit: purchaseOrderItems.unit,
        status: purchaseOrderItems.status,
      })
      .from(purchaseOrderItems)
      .where(eq(purchaseOrderItems.purchaseOrderId, purchaseOrderId));
    const itemIds = itemRows.map((row) => Number(row.id));
    const receiptRows = itemIds.length
      ? await db
          .select({
            purchaseOrderItemId: warehouseReceiptItems.purchaseOrderItemId,
            receivedQuantity: warehouseReceiptItems.receivedQuantity,
            specificationHeldQuantity: specificationHeldReceiptQuantity,
          })
          .from(warehouseReceiptItems)
          .innerJoin(warehouseReceipts, eq(warehouseReceipts.id, warehouseReceiptItems.receiptId))
          .where(and(
            inArray(warehouseReceiptItems.purchaseOrderItemId, itemIds),
            eq(warehouseReceipts.status, "confirmed"),
          ))
      : [];
    const receivedByItemId = new Map<number, number>();
    const heldByItemId = new Map<number, number>();
    for (const receipt of receiptRows) {
      if (receipt.purchaseOrderItemId == null) continue;
      const itemId = Number(receipt.purchaseOrderItemId);
      receivedByItemId.set(itemId, Number(((receivedByItemId.get(itemId) || 0) + Number(receipt.receivedQuantity || 0)).toFixed(3)));
      heldByItemId.set(itemId, Number(((heldByItemId.get(itemId) || 0) + Number(receipt.specificationHeldQuantity || 0)).toFixed(3)));
    }
    return {
      order: { id: Number(orderRow.id), poNumber: String(orderRow.poNumber), status: String(orderRow.status) },
      items: itemRows.map((row) => ({
        id: Number(row.id),
        purchaseOrderId: Number(row.purchaseOrderId),
        catalogItemId: row.catalogItemId == null ? null : Number(row.catalogItemId),
        itemName: String(row.itemName),
        quantity: Number(row.quantity || 0),
        unit: row.unit == null ? null : String(row.unit),
        status: String(row.status),
        inventoryReceivedQuantity: receivedByItemId.get(Number(row.id)) || 0,
        specificationHeldQuantity: heldByItemId.get(Number(row.id)) || 0,
      })),
    };
  },
};

/**
 * Current CMMS maintenance-target adapter.
 * It reads Site/Section/Asset master data in place and validates the logical
 * Site -> Section -> Asset relationships proven during Phase 0.
 */
export const currentMaintenanceTargetAdapter: MaintenanceTargetAdapter = {
  async listSites(): Promise<Pmv2SiteRef[]> {
    const db = await requireDb();
    const rows = await db
      .select({ id: sites.id, name: sites.name, isActive: sites.isActive })
      .from(sites)
      .where(eq(sites.isActive, 1))
      .orderBy(asc(sites.name));
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      isActive: row.isActive === 1,
    }));
  },

  async listSections(siteId?: Pmv2ExternalId): Promise<Pmv2SectionRef[]> {
    const db = await requireDb();
    const conditions = [eq(sections.isActive, 1)];
    if (siteId !== undefined) conditions.push(eq(sections.siteId, siteId));
    const rows = await db
      .select({
        id: sections.id,
        siteId: sections.siteId,
        name: sections.name,
        isActive: sections.isActive,
      })
      .from(sections)
      .where(and(...conditions))
      .orderBy(asc(sections.name));
    return rows.map((row) => ({
      id: row.id,
      siteId: row.siteId,
      name: row.name,
      isActive: row.isActive === 1,
    }));
  },

  async listAssets(filters): Promise<Pmv2AssetRef[]> {
    const db = await requireDb();
    const conditions: SQL[] = [];
    if (filters?.siteId !== undefined) conditions.push(eq(assets.siteId, filters.siteId));
    if (filters?.sectionId !== undefined) conditions.push(eq(assets.sectionId, filters.sectionId));
    const rows = await db
      .select({
        id: assets.id,
        siteId: assets.siteId,
        sectionId: assets.sectionId,
        name: assets.name,
        status: assets.status,
      })
      .from(assets)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(asc(assets.name));
    return rows;
  },

  async validateTarget(target: Pmv2MaintenanceTargetRef): Promise<boolean> {
    const db = await requireDb();

    if (target.type === "site") {
      const rows = await db
        .select({ id: sites.id })
        .from(sites)
        .where(and(eq(sites.id, target.siteId), eq(sites.isActive, 1)))
        .limit(1);
      return rows.length === 1;
    }

    if (target.type === "section") {
      const rows = await db
        .select({ id: sections.id })
        .from(sections)
        .innerJoin(sites, eq(sites.id, sections.siteId))
        .where(
          and(
            eq(sections.id, target.sectionId),
            eq(sections.isActive, 1),
            eq(sites.isActive, 1),
          ),
        )
        .limit(1);
      return rows.length === 1;
    }

    const assetRows = await db
      .select({
        id: assets.id,
        siteId: assets.siteId,
        sectionId: assets.sectionId,
        status: assets.status,
      })
      .from(assets)
      .where(and(eq(assets.id, target.assetId), ne(assets.status, "disposed")))
      .limit(1);
    const asset = assetRows[0];
    if (!asset || asset.siteId == null || asset.sectionId == null) return false;

    const parentRows = await db
      .select({ sectionSiteId: sections.siteId })
      .from(sections)
      .innerJoin(sites, eq(sites.id, sections.siteId))
      .where(
        and(
          eq(sections.id, asset.sectionId),
          eq(sections.isActive, 1),
          eq(sites.id, asset.siteId),
          eq(sites.isActive, 1),
        ),
      )
      .limit(1);
    return parentRows.length === 1 && parentRows[0].sectionSiteId === asset.siteId;
  },
};


/** Current CMMS Ticket read adapter. PM V2 stores only source links and reads live Ticket state here. */
export const currentTicketAdapter: TicketAdapter = {
  async getTicketsByIds(ids: Pmv2ExternalId[]): Promise<Pmv2TicketRef[]> {
    const uniqueIds = [...new Set(ids.filter((id) => Number.isInteger(id) && id > 0))];
    if (uniqueIds.length === 0) return [];
    const db = await requireDb();
    const rows = await db
      .select({
        id: tickets.id,
        ticketNumber: tickets.ticketNumber,
        status: tickets.status,
        maintenancePath: tickets.maintenancePath,
      })
      .from(tickets)
      .where(inArray(tickets.id, uniqueIds));
    return rows.map((row) => ({
      id: Number(row.id),
      ticketNumber: String(row.ticketNumber),
      status: String(row.status),
      maintenancePath: row.maintenancePath == null ? null : String(row.maintenancePath),
    }));
  },
};

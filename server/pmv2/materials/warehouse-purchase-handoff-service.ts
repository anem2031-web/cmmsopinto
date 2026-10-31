import { and, eq, sql } from "drizzle-orm";
import {
  pmv2MaterialPurchaseLinks,
  pmv2MaterialRequestItems,
  pmv2MaterialRequests,
  pmv2TaskItems,
  pmv2Tasks,
} from "../../../drizzle/schema";
import { getDb } from "../../_core/db/client";
import { findCatalogUnitByName } from "../../_core/catalog-unit-governance";
import {
  currentCatalogAdapter,
  currentInventoryAdapter,
  currentPurchaseAdapter,
  currentWarehouseAdapter,
  Pmv2ExternalReferenceError,
} from "../adapters/current-system";
import { writePmv2AuditWithDb } from "../audit/service";
import { assertPmv2CompensationSettled,Pmv2ReplacementCoverageError } from "./replacement-coverage";

export class Pmv2WarehousePurchaseHandoffError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "Pmv2WarehousePurchaseHandoffError";
  }
}

function roundQuantity(value: number) {
  return Number(Math.max(0, value).toFixed(3));
}

function normalizeUnit(value: string | null | undefined) {
  return String(value || "").trim().toLocaleLowerCase();
}

async function resolveActiveCatalogUnit(db: any, ...candidates: Array<string | null | undefined>) {
  for (const candidate of candidates) {
    if (!String(candidate || "").trim()) continue;
    const unit = await findCatalogUnitByName(candidate, db);
    if (unit && Number(unit.isActive) === 1) return unit;
  }
  return null;
}

async function unitsEquivalent(
  db: any,
  left: string | null | undefined,
  right: string | null | undefined,
) {
  if (!left || !right) return true;
  const [leftUnit, rightUnit] = await Promise.all([
    findCatalogUnitByName(left, db),
    findCatalogUnitByName(right, db),
  ]);
  if (leftUnit && rightUnit) return Number(leftUnit.id) === Number(rightUnit.id);
  return normalizeUnit(left) === normalizeUnit(right);
}

function pendingPurchaseCoverageQuantity(
  linkedQuantity: number,
  orderStatus: string | null | undefined,
  itemStatus: string | null | undefined,
  inventoryReceivedQuantity: number | null | undefined,
) {
  if (["rejected", "received", "closed"].includes(String(orderStatus || ""))) return 0;
  if (["rejected", "cancelled", "purchase_cancelled", "delivered_to_requester"].includes(String(itemStatus || ""))) return 0;
  return roundQuantity(Number(linkedQuantity || 0) - Number(inventoryReceivedQuantity || 0));
}

async function requireDb() {
  const db = await getDb();
  if (!db) throw new Error("تعذر الاتصال بقاعدة البيانات");
  return db;
}

async function loadRequestItemContext(db: any, requestItemId: number) {
  const rows = await db
    .select({
      requestItemId: pmv2MaterialRequestItems.id,
      requestId: pmv2MaterialRequestItems.requestId,
      catalogItemId: pmv2MaterialRequestItems.catalogItemId,
      itemNameSnapshot: pmv2MaterialRequestItems.itemNameSnapshot,
      requestedQuantity: pmv2MaterialRequestItems.requestedQuantity,
      unitSnapshot: pmv2MaterialRequestItems.unitSnapshot,
      status: pmv2MaterialRequestItems.status,
      issuedToTeamQuantity: pmv2MaterialRequestItems.issuedToTeamQuantity,
      taskItemId: pmv2MaterialRequests.taskItemId,
      teamWarehouseId: pmv2MaterialRequests.teamWarehouseId,
      taskId: pmv2TaskItems.taskId,
      taskNumber: pmv2Tasks.taskNumber,
    })
    .from(pmv2MaterialRequestItems)
    .innerJoin(pmv2MaterialRequests, eq(pmv2MaterialRequests.id, pmv2MaterialRequestItems.requestId))
    .innerJoin(pmv2TaskItems, eq(pmv2TaskItems.id, pmv2MaterialRequests.taskItemId))
    .innerJoin(pmv2Tasks, eq(pmv2Tasks.id, pmv2TaskItems.taskId))
    .where(eq(pmv2MaterialRequestItems.id, requestItemId))
    .limit(1);
  return rows[0] ?? null;
}

async function listPurchaseLinks(db: any, requestItemId: number) {
  const links = await db
    .select({
      id: pmv2MaterialPurchaseLinks.id,
      purchaseOrderId: pmv2MaterialPurchaseLinks.purchaseOrderId,
      purchaseOrderItemId: pmv2MaterialPurchaseLinks.purchaseOrderItemId,
      linkedQuantity: pmv2MaterialPurchaseLinks.linkedQuantity,
    })
    .from(pmv2MaterialPurchaseLinks)
    .where(eq(pmv2MaterialPurchaseLinks.materialRequestItemId, requestItemId));
  if (!links.length) return [];

  const [orders, items] = await Promise.all([
    currentPurchaseAdapter.getOrdersByIds(links.map((link) => Number(link.purchaseOrderId))),
    currentPurchaseAdapter.getItemsByIds(links.map((link) => Number(link.purchaseOrderItemId))),
  ]);
  const orderById = new Map(orders.map((order) => [order.id, order]));
  const itemById = new Map(items.map((item) => [item.id, item]));

  return links.map((link) => {
    const order = orderById.get(Number(link.purchaseOrderId)) ?? null;
    const item = itemById.get(Number(link.purchaseOrderItemId)) ?? null;
    const linkedQuantity = roundQuantity(Number(link.linkedQuantity || 0));
    const pendingCoverageQuantity = order && item
      ? pendingPurchaseCoverageQuantity(linkedQuantity, order.status, item.status, item.inventoryReceivedQuantity)
      : 0;
    return {
      id: Number(link.id),
      purchaseOrderId: Number(link.purchaseOrderId),
      purchaseOrderItemId: Number(link.purchaseOrderItemId),
      linkedQuantity,
      poNumber: order?.poNumber || null,
      orderStatus: order?.status || null,
      itemStatus: item?.status || null,
      purchaseQuantity: item?.quantity ?? null,
      inventoryReceivedQuantity: item?.inventoryReceivedQuantity ?? null,
      pendingCoverageQuantity,
      pendingCoverage: pendingCoverageQuantity > 0,
    };
  });
}

function mapExternalReferenceError(error: unknown): never {
  if (error instanceof Pmv2ExternalReferenceError) {
    throw new Pmv2WarehousePurchaseHandoffError(error.message);
  }
  throw error;
}

async function validatePurchaseUnitForCatalogItem(
  db: any,
  catalogItemId: number,
  purchaseUnit: string | null | undefined,
) {
  let linkedCatalogItem;
  try {
    linkedCatalogItem = await currentCatalogAdapter.requireActiveItem(catalogItemId);
  } catch (error) {
    mapExternalReferenceError(error);
  }

  const expectedPurchaseCatalogUnit = await resolveActiveCatalogUnit(db, linkedCatalogItem!.unit);
  const purchaseCatalogUnit = purchaseUnit
    ? await resolveActiveCatalogUnit(db, purchaseUnit)
    : null;
  if (!purchaseCatalogUnit) {
    throw new Pmv2WarehousePurchaseHandoffError("اختر وحدة قياس فعالة لبند طلب الشراء قبل ربطه بـ PM V2");
  }
  if (
    expectedPurchaseCatalogUnit &&
    Number(expectedPurchaseCatalogUnit.id) !== Number(purchaseCatalogUnit.id)
  ) {
    throw new Pmv2WarehousePurchaseHandoffError("وحدة بند طلب الشراء لا تطابق وحدة الصنف المرتبطة في Master Data");
  }

  return { linkedCatalogItem, purchaseCatalogUnit, expectedPurchaseCatalogUnit };
}

/**
 * Phase 4 purchase handoff.
 *
 * Purchase remains the authoritative owner of Purchase Orders and PO Items. PM V2
 * computes/validates the still-uncovered shortage and stores only its source link.
 * Patch 121 lets the existing Purchase create mutation call this service inside the
 * SAME DB transaction, so PO creation and the PM V2 source link commit or rollback
 * together without moving Purchase ownership into PM V2.
 */
export class Pmv2WarehousePurchaseHandoffService {
  async preparePurchaseHandoff(requestItemId: number) {
    if (!Number.isInteger(requestItemId) || requestItemId <= 0) {
      throw new Pmv2WarehousePurchaseHandoffError("بند طلب المواد غير صالح");
    }
    const db = await requireDb();
    return this.preparePurchaseHandoffWithDb(db, requestItemId);
  }

  /**
   * Patch 121: validate and reserve one PM V2 shortage for Purchase creation.
   * The caller MUST execute this inside the same DB transaction that creates
   * the Purchase Order and its single item. The row lock serializes concurrent
   * attempts for the same material request item, so a second request observes
   * the first committed PM V2 purchase coverage before it can create anything.
   */
  async prepareAtomicPurchaseCreation(
    tx: any,
    input: {
      requestItemId: number;
      purchaseItem: { catalogItemId?: number | null; quantity: number; unit?: string | null };
    },
  ) {
    const requestItemId = Number(input.requestItemId);
    if (!Number.isInteger(requestItemId) || requestItemId <= 0) {
      throw new Pmv2WarehousePurchaseHandoffError("بند طلب المواد غير صالح");
    }

    await tx.execute(sql`SELECT id FROM pmv2_material_request_items WHERE id = ${requestItemId} FOR UPDATE`);

    const handoff = await this.preparePurchaseHandoffWithDb(tx, requestItemId);
    const purchaseCatalogItemId = Number(input.purchaseItem.catalogItemId || 0);
    if (!purchaseCatalogItemId || purchaseCatalogItemId !== Number(handoff.catalogItemId)) {
      throw new Pmv2WarehousePurchaseHandoffError("بند طلب الشراء لا يطابق مادة PM V2");
    }

    const expectedPurchaseQuantity = Math.max(1, Math.ceil(Number(handoff.purchaseMinimumQuantity || 0)));
    const submittedPurchaseQuantity = Number(input.purchaseItem.quantity || 0);
    if (!Number.isFinite(submittedPurchaseQuantity) || Math.abs(submittedPurchaseQuantity - expectedPurchaseQuantity) > 0.0005) {
      throw new Pmv2WarehousePurchaseHandoffError(
        `كمية طلب الشراء المرتبط بـ PM V2 يجب أن تكون ${expectedPurchaseQuantity}`,
      );
    }

    await validatePurchaseUnitForCatalogItem(tx, Number(handoff.catalogItemId), input.purchaseItem.unit);

    return {
      requestItemId,
      linkedQuantity: roundQuantity(Math.min(Number(handoff.purchaseMinimumQuantity || 0), submittedPurchaseQuantity)),
      handoff,
    };
  }

  /**
   * Patch 121: persist the PM V2 source link in the SAME transaction that
   * created the Purchase Order. Any failure here rolls the Purchase rows back.
   */
  async linkAtomicCreatedPurchase(
    tx: any,
    actorUserId: number,
    input: {
      requestItemId: number;
      purchaseOrderId: number;
      purchaseOrderItemId: number;
      poNumber: string;
      purchaseItemQuantity: number;
      linkedQuantity: number;
      remainingRequestQuantity: number;
      availableMainQuantity: number;
    },
    auditContext?: { ipAddress?: string; userAgent?: string },
  ) {
    const linkedQuantity = roundQuantity(Number(input.linkedQuantity || 0));
    if (linkedQuantity <= 0) {
      throw new Pmv2WarehousePurchaseHandoffError("كمية بند طلب الشراء غير صالحة للربط");
    }

    const insert = await tx.insert(pmv2MaterialPurchaseLinks).values({
      materialRequestItemId: input.requestItemId,
      purchaseOrderId: input.purchaseOrderId,
      purchaseOrderItemId: input.purchaseOrderItemId,
      linkedQuantity: linkedQuantity.toFixed(3),
      createdById: actorUserId,
    });
    const linkId = Number(insert[0]?.insertId || 0);

    await writePmv2AuditWithDb(tx, {
      actorUserId,
      action: "material_purchase_linked",
      entity: "material_request_item",
      entityId: input.requestItemId,
      newValues: {
        purchaseOrderId: input.purchaseOrderId,
        purchaseOrderItemId: input.purchaseOrderItemId,
        poNumber: input.poNumber,
        purchaseItemQuantity: Number(input.purchaseItemQuantity || 0),
        linkedQuantity,
        remainingRequestQuantity: Number(input.remainingRequestQuantity || 0),
        availableMainQuantity: Number(input.availableMainQuantity || 0),
        atomicPurchaseCreation: true,
      },
      ipAddress: auditContext?.ipAddress,
      userAgent: auditContext?.userAgent,
    });

    return { linkId, linkedQuantity };
  }

  private async preparePurchaseHandoffWithDb(db: any, requestItemId: number) {
    const context = await loadRequestItemContext(db, requestItemId);
    if (!context) throw new Pmv2WarehousePurchaseHandoffError("بند طلب المواد غير موجود");
    if (context.status !== "waiting_warehouse") {
      throw new Pmv2WarehousePurchaseHandoffError("بند طلب المواد لم يعد بانتظار استكمال النقص");
    }
    if (context.catalogItemId == null) {
      throw new Pmv2WarehousePurchaseHandoffError("لا يمكن بدء طلب شراء قبل ربط المادة بصنف معروف في الدليل");
    }
    try {await assertPmv2CompensationSettled(db,requestItemId,Number(context.taskItemId));}
    catch(error) {if(error instanceof Pmv2ReplacementCoverageError) throw new Pmv2WarehousePurchaseHandoffError(error.message);throw error;}

    let mainWarehouse;
    let catalogItem;
    try {
      [mainWarehouse, catalogItem] = await Promise.all([
        currentWarehouseAdapter.requireSingleActiveMainWarehouse(),
        currentCatalogAdapter.requireActiveItem(context.catalogItemId),
      ]);
    } catch (error) {
      mapExternalReferenceError(error);
    }

    const availability = await currentInventoryAdapter.getCatalogAvailability(context.catalogItemId, mainWarehouse!.id);
    if (availability.ambiguous) {
      throw new Pmv2WarehousePurchaseHandoffError("هوية مخزون الصنف في المستودع الرئيسي غير فريدة؛ صححها قبل تحديد كمية الشراء");
    }
    if (availability.unit && context.unitSnapshot && !(await unitsEquivalent(db, availability.unit, context.unitSnapshot))) {
      throw new Pmv2WarehousePurchaseHandoffError("وحدة المخزون الحالية لا تطابق وحدة طلب PM V2؛ يلزم التحقق قبل بدء الشراء");
    }

    const activeCatalogUnit = await resolveActiveCatalogUnit(db, catalogItem!.unit);
    const purchaseUnit = activeCatalogUnit
      ? String(activeCatalogUnit.nameAr || activeCatalogUnit.nameEn || "").trim()
      : String(context.unitSnapshot || availability.unit || catalogItem!.unit || "").trim();
    const purchaseUnitId = activeCatalogUnit ? Number(activeCatalogUnit.id) : null;

    const requestedQuantity = roundQuantity(Number(context.requestedQuantity || 0));
    const issuedToTeamQuantity = roundQuantity(Number(context.issuedToTeamQuantity || 0));
    const remainingQuantity = roundQuantity(requestedQuantity - issuedToTeamQuantity);
    if (remainingQuantity <= 0) throw new Pmv2WarehousePurchaseHandoffError("تم تغطية كمية هذا الطلب بالفعل");

    const availableMainQuantity = roundQuantity(Number(availability.availableQuantity || 0));
    const purchaseLinks = await listPurchaseLinks(db, requestItemId);
    const pendingPurchaseCoverage = roundQuantity(
      purchaseLinks.reduce((sum, link) => sum + link.pendingCoverageQuantity, 0),
    );
    const uncoveredAfterMain = roundQuantity(remainingQuantity - availableMainQuantity);
    const purchaseMinimumQuantity = roundQuantity(uncoveredAfterMain - pendingPurchaseCoverage);
    if (purchaseMinimumQuantity <= 0) {
      if (uncoveredAfterMain <= 0) {
        throw new Pmv2WarehousePurchaseHandoffError("الكمية الناقصة أصبحت متوفرة بالكامل في المستودع الرئيسي؛ استخدم التحويل إلى مخزن الفريق");
      }
      throw new Pmv2WarehousePurchaseHandoffError("يوجد طلب شراء مرتبط يغطي العجز الحالي؛ لا تنشئ طلب شراء مكررًا");
    }

    return {
      requestItemId: context.requestItemId,
      requestId: context.requestId,
      taskId: context.taskId,
      taskItemId: context.taskItemId,
      taskNumber: context.taskNumber,
      catalogItemId: context.catalogItemId,
      itemName: context.itemNameSnapshot || catalogItem!.nameAr || catalogItem!.nameEn,
      itemCode: catalogItem!.code,
      unit: purchaseUnit || null,
      unitId: purchaseUnitId,
      requestShortageQuantity: requestedQuantity,
      issuedToTeamQuantity,
      remainingQuantity,
      availableMainQuantity,
      pendingPurchaseCoverage,
      purchaseMinimumQuantity,
      mainWarehouse,
    };
  }

  async linkPurchaseOrder(
    actorUserId: number,
    input: { requestItemId: number; purchaseOrderId: number; purchaseOrderItemId: number },
    auditContext?: { ipAddress?: string; userAgent?: string },
  ) {
    const { requestItemId, purchaseOrderId, purchaseOrderItemId } = input;
    if (![requestItemId, purchaseOrderId, purchaseOrderItemId].every((value) => Number.isInteger(value) && value > 0)) {
      throw new Pmv2WarehousePurchaseHandoffError("مرجع طلب الشراء غير صالح");
    }

    const db = await requireDb();
    const context = await loadRequestItemContext(db, requestItemId);
    if (!context || context.catalogItemId == null) {
      throw new Pmv2WarehousePurchaseHandoffError("بند طلب المواد غير موجود أو غير مرتبط بصنف Catalog صالح");
    }

    const purchase = await currentPurchaseAdapter.getOrderWithItems(purchaseOrderId);
    if (!purchase) throw new Pmv2WarehousePurchaseHandoffError("طلب الشراء غير موجود");
    const purchaseItem = purchase.items.find((item) => item.id === purchaseOrderItemId);
    if (!purchaseItem || purchaseItem.purchaseOrderId !== purchaseOrderId) {
      throw new Pmv2WarehousePurchaseHandoffError("بند طلب الشراء المحدد لا ينتمي إلى طلب الشراء");
    }
    if (purchaseItem.catalogItemId !== context.catalogItemId) {
      throw new Pmv2WarehousePurchaseHandoffError("بند طلب الشراء لا يطابق مادة PM V2");
    }
    if (["rejected", "cancelled", "purchase_cancelled"].includes(purchaseItem.status) || purchase.order.status === "rejected") {
      throw new Pmv2WarehousePurchaseHandoffError("لا يمكن ربط طلب شراء مرفوض أو ملغي باحتياج PM V2");
    }
    // Purchase unit rule is shared with atomic PM V2 Purchase creation.
    await validatePurchaseUnitForCatalogItem(db, context.catalogItemId, purchaseItem.unit);

    return db.transaction(async (tx: any) => {
      await tx.execute(sql`SELECT id FROM pmv2_material_request_items WHERE id = ${requestItemId} FOR UPDATE`);
      const locked = await loadRequestItemContext(tx, requestItemId);
      if (!locked || locked.catalogItemId !== context.catalogItemId) {
        throw new Pmv2WarehousePurchaseHandoffError("تغيرت هوية طلب المواد أثناء الربط؛ حدّث الشاشة");
      }
      try {await assertPmv2CompensationSettled(tx,requestItemId,Number(locked.taskItemId));}
      catch(error) {if(error instanceof Pmv2ReplacementCoverageError) throw new Pmv2WarehousePurchaseHandoffError(error.message);throw error;}

      const existingRows = await tx
        .select({
          id: pmv2MaterialPurchaseLinks.id,
          materialRequestItemId: pmv2MaterialPurchaseLinks.materialRequestItemId,
          linkedQuantity: pmv2MaterialPurchaseLinks.linkedQuantity,
        })
        .from(pmv2MaterialPurchaseLinks)
        .where(eq(pmv2MaterialPurchaseLinks.purchaseOrderItemId, purchaseOrderItemId))
        .limit(1);
      const existing = existingRows[0];
      if (existing) {
        if (Number(existing.materialRequestItemId) !== requestItemId) {
          throw new Pmv2WarehousePurchaseHandoffError("بند طلب الشراء مرتبط مسبقًا باحتياج PM V2 آخر");
        }
        return {
          idempotent: true,
          linked: true,
          purchaseOrderId,
          purchaseOrderItemId,
          poNumber: purchase.order.poNumber,
          linkedQuantity: roundQuantity(Number(existing.linkedQuantity || 0)),
        };
      }

      let mainWarehouse;
      try {
        mainWarehouse = await currentWarehouseAdapter.requireSingleActiveMainWarehouse();
      } catch (error) {
        mapExternalReferenceError(error);
      }
      const availability = await currentInventoryAdapter.getCatalogAvailability(locked.catalogItemId!, mainWarehouse!.id);
      if (availability.ambiguous) {
        throw new Pmv2WarehousePurchaseHandoffError("تعذر ربط الشراء لأن هوية مخزون الصنف في المستودع الرئيسي غير فريدة");
      }

      const requestedQuantity = roundQuantity(Number(locked.requestedQuantity || 0));
      const issuedToTeamQuantity = roundQuantity(Number(locked.issuedToTeamQuantity || 0));
      const remainingQuantity = roundQuantity(requestedQuantity - issuedToTeamQuantity);
      const availableMainQuantity = roundQuantity(Number(availability.availableQuantity || 0));
      const existingLinks = await listPurchaseLinks(tx, requestItemId);
      const pendingPurchaseCoverage = roundQuantity(
        existingLinks.reduce((sum, link) => sum + link.pendingCoverageQuantity, 0),
      );
      const uncoveredQuantity = roundQuantity(remainingQuantity - availableMainQuantity - pendingPurchaseCoverage);
      if (uncoveredQuantity <= 0) {
        return {
          idempotent: false,
          linked: false,
          purchaseOrderId,
          purchaseOrderItemId,
          poNumber: purchase.order.poNumber,
          linkedQuantity: 0,
          message: "تم إنشاء طلب الشراء، لكن العجز لم يعد قائمًا عند الربط؛ لم تُنسب كمية منه إلى PM V2",
        };
      }

      const linkQuantity = roundQuantity(Math.min(uncoveredQuantity, Number(purchaseItem.quantity || 0)));
      if (linkQuantity <= 0) throw new Pmv2WarehousePurchaseHandoffError("كمية بند طلب الشراء غير صالحة للربط");

      const insert = await tx.insert(pmv2MaterialPurchaseLinks).values({
        materialRequestItemId: requestItemId,
        purchaseOrderId,
        purchaseOrderItemId,
        linkedQuantity: linkQuantity.toFixed(3),
        createdById: actorUserId,
      });
      const linkId = Number(insert[0]?.insertId || 0);

      await writePmv2AuditWithDb(tx, {
        actorUserId,
        action: "material_purchase_linked",
        entity: "material_request_item",
        entityId: requestItemId,
        newValues: {
          purchaseOrderId,
          purchaseOrderItemId,
          poNumber: purchase.order.poNumber,
          purchaseItemQuantity: Number(purchaseItem.quantity || 0),
          linkedQuantity: linkQuantity,
          remainingRequestQuantity: remainingQuantity,
          availableMainQuantity,
        },
        ipAddress: auditContext?.ipAddress,
        userAgent: auditContext?.userAgent,
      });

      return {
        idempotent: false,
        linked: true,
        linkId,
        purchaseOrderId,
        purchaseOrderItemId,
        poNumber: purchase.order.poNumber,
        linkedQuantity: linkQuantity,
      };
    });
  }
}

export const pmv2WarehousePurchaseHandoffService = new Pmv2WarehousePurchaseHandoffService();

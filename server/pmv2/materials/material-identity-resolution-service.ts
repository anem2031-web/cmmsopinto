import { and, desc, eq, ne, notInArray, sql } from "drizzle-orm";
import {
  pmv2ItemActions,
  pmv2MaterialRequestItems,
  pmv2MaterialRequests,
  pmv2TaskItems,
  pmv2Tasks,
  pmv2Teams,
} from "../../../drizzle/schema";
import { getDb } from "../../_core/db/client";
import { createNotification } from "../../_core/db/notifications";
import {
  currentCatalogAdapter,
  currentInventoryAdapter,
  currentWarehouseAdapter,
  Pmv2ExternalReferenceError,
} from "../adapters/current-system";
import { writePmv2AuditWithDb } from "../audit/service";
import { canRoleAccessPmv2Warehouse } from "../../../shared/roles";
import { assertPmv2UnitApprovalUntouched, pmv2ApprovedMaterialQuantity, pmv2CatalogBaseUnit } from "./catalog-unit-policy";
import {
  Pmv2MaterialRequestItemValidationError,
  validatePmv2MaterialRequestItemWrite,
} from "./request-item-validation";

const MATERIAL_ROUTE_DECISION_ACTION = "material_route_decision";
const MATERIAL_IDENTITY_RESOLVED_ACTION = "material_identity_resolved";

type MaterialRouteDecisionSnapshot = {
  version: 1;
  route: "team_inventory" | "material_request";
  catalogItemId: number | null;
  itemNameSnapshot: string;
  requestedQuantity: number;
  unit: string;
  teamWarehouseId: number;
  inventoryId: number | null;
  availableQuantity: number | null;
  shortageQuantity: number;
  lotsRequired: boolean;
  materialRequestId: number | null;
  materialRequestItemId: number | null;
};

export class Pmv2MaterialIdentityResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "Pmv2MaterialIdentityResolutionError";
  }
}

function normalizeUnit(value: string | null | undefined) {
  return String(value || "").trim().toLocaleLowerCase();
}

function roundQuantity(value: number) {
  return Number(Math.max(0, value).toFixed(3));
}

function parseMaterialRouteDecision(note: string | null | undefined): MaterialRouteDecisionSnapshot | null {
  if (!note) return null;
  try {
    const parsed = JSON.parse(note) as Partial<MaterialRouteDecisionSnapshot>;
    if (parsed.version !== 1) return null;
    if (parsed.route !== "team_inventory" && parsed.route !== "material_request") return null;
    const requestedQuantity = Number(parsed.requestedQuantity);
    const shortageQuantity = Number(parsed.shortageQuantity);
    const materialRequestItemId = parsed.materialRequestItemId == null ? null : Number(parsed.materialRequestItemId);
    if (!Number.isFinite(requestedQuantity) || requestedQuantity <= 0) return null;
    if (!Number.isFinite(shortageQuantity) || shortageQuantity < 0) return null;
    if (materialRequestItemId != null && (!Number.isInteger(materialRequestItemId) || materialRequestItemId <= 0)) return null;
    return {
      version: 1,
      route: parsed.route,
      catalogItemId: parsed.catalogItemId == null ? null : Number(parsed.catalogItemId),
      itemNameSnapshot: String(parsed.itemNameSnapshot || ""),
      requestedQuantity,
      unit: String(parsed.unit || ""),
      teamWarehouseId: Number(parsed.teamWarehouseId || 0),
      inventoryId: parsed.inventoryId == null ? null : Number(parsed.inventoryId),
      availableQuantity: parsed.availableQuantity == null ? null : Number(parsed.availableQuantity),
      shortageQuantity,
      lotsRequired: Boolean(parsed.lotsRequired),
      materialRequestId: parsed.materialRequestId == null ? null : Number(parsed.materialRequestId),
      materialRequestItemId,
    };
  } catch {
    return null;
  }
}

function mapIntegrationError(error: unknown): never {
  if (
    error instanceof Pmv2ExternalReferenceError ||
    error instanceof Pmv2MaterialRequestItemValidationError
  ) {
    throw new Pmv2MaterialIdentityResolutionError(error.message);
  }
  throw error;
}

async function requireDb() {
  const db = await getDb();
  if (!db) throw new Error("تعذر الاتصال بقاعدة البيانات");
  return db;
}

async function loadUnlistedContext(db: any, requestItemId: number) {
  const rows = await db
    .select({
      requestItemId: pmv2MaterialRequestItems.id,
      requestId: pmv2MaterialRequestItems.requestId,
      catalogItemId: pmv2MaterialRequestItems.catalogItemId,
      itemNameSnapshot: pmv2MaterialRequestItems.itemNameSnapshot,
      requestedQuantity: pmv2MaterialRequestItems.requestedQuantity,
      unitSnapshot: pmv2MaterialRequestItems.unitSnapshot,
      status: pmv2MaterialRequestItems.status,
      receivedWarehouseQuantity: pmv2MaterialRequestItems.receivedWarehouseQuantity,
      issuedToTeamQuantity: pmv2MaterialRequestItems.issuedToTeamQuantity,
      taskItemId: pmv2MaterialRequests.taskItemId,
      visitId: pmv2MaterialRequests.visitId,
      requestedById: pmv2MaterialRequests.requestedById,
      teamId: pmv2MaterialRequests.teamId,
      teamWarehouseId: pmv2MaterialRequests.teamWarehouseId,
      taskItemTitle: pmv2TaskItems.titleSnapshot,
      taskId: pmv2Tasks.id,
      taskNumber: pmv2Tasks.taskNumber,
      taskStatus: pmv2Tasks.status,
      itemStatus: pmv2TaskItems.status,
      itemResult: pmv2TaskItems.result,
      teamCode: pmv2Teams.code,
    })
    .from(pmv2MaterialRequestItems)
    .innerJoin(pmv2MaterialRequests, eq(pmv2MaterialRequests.id, pmv2MaterialRequestItems.requestId))
    .innerJoin(pmv2TaskItems, eq(pmv2TaskItems.id, pmv2MaterialRequests.taskItemId))
    .innerJoin(pmv2Tasks, eq(pmv2Tasks.id, pmv2TaskItems.taskId))
    .innerJoin(pmv2Teams, eq(pmv2Teams.id, pmv2MaterialRequests.teamId))
    .where(eq(pmv2MaterialRequestItems.id, requestItemId))
    .limit(1);
  return rows[0] ?? null;
}

async function loadLatestRequestRouteDecision(db: any, taskItemId: number, requestItemId: number) {
  const rows = await db
    .select({ id: pmv2ItemActions.id, note: pmv2ItemActions.note })
    .from(pmv2ItemActions)
    .where(and(
      eq(pmv2ItemActions.taskItemId, taskItemId),
      eq(pmv2ItemActions.action, MATERIAL_ROUTE_DECISION_ACTION),
    ))
    .orderBy(desc(pmv2ItemActions.id));

  for (const row of rows) {
    const snapshot = parseMaterialRouteDecision(row.note);
    if (snapshot?.materialRequestItemId === requestItemId) {
      return { id: Number(row.id), snapshot };
    }
  }
  return null;
}

/**
 * Resolves a technician-entered free-text material to the existing Catalog.
 * It does not create Catalog/Inventory/Transfer/Purchase rows. The selected
 * Catalog identity is applied to the PM V2 request, then the existing PM V2
 * stock-routing rules are recalculated from live Team-Warehouse stock.
 */
export class Pmv2MaterialIdentityResolutionService {
  async searchCandidates(requestItemId: number, query = "") {
    if (!Number.isInteger(requestItemId) || requestItemId <= 0) {
      throw new Pmv2MaterialIdentityResolutionError("مرجع بند طلب المادة غير صالح");
    }
    const db = await requireDb();
    const context = await loadUnlistedContext(db, requestItemId);
    if (!context) throw new Pmv2MaterialIdentityResolutionError("بند طلب المادة غير موجود");
    if (context.status !== "waiting_warehouse") {
      throw new Pmv2MaterialIdentityResolutionError("بند المادة لم يعد بانتظار معالجة المستودع");
    }
    if (["cancelled", "completed"].includes(context.taskStatus) || context.itemStatus !== "waiting_material" || context.itemResult !== "needs_material")
      throw new Pmv2MaterialIdentityResolutionError("بند الصيانة لم يعد في حالة انتظار المواد");

    let teamWarehouse;
    let mainWarehouse;
    try {
      [teamWarehouse, mainWarehouse] = await Promise.all([
        currentWarehouseAdapter.requireActiveWarehouse(Number(context.teamWarehouseId)),
        currentWarehouseAdapter.requireSingleActiveMainWarehouse(),
      ]);
    } catch (error) {
      mapIntegrationError(error);
    }

    const items = context.catalogItemId == null ? await currentCatalogAdapter.searchActiveItems(query, 30)
      : await currentCatalogAdapter.getItemsByIds([Number(context.catalogItemId)]);
    if (context.catalogItemId != null && (!items[0]?.isActive || normalizeUnit(items[0].unit) === normalizeUnit(context.unitSnapshot)))
      throw new Pmv2MaterialIdentityResolutionError("تم تحديد هوية هذه المادة ووحدتها مسبقًا؛ حدّث الشاشة");
    const ids = items.map((item) => item.id);
    const [teamAvailabilities, mainAvailabilities] = await Promise.all([
      currentInventoryAdapter.getCatalogAvailabilities(ids, Number(context.teamWarehouseId)),
      currentInventoryAdapter.getCatalogAvailabilities(ids, Number(mainWarehouse!.id)),
    ]);
    const teamByCatalog = new Map(teamAvailabilities.map((item) => [item.catalogItemId, item]));
    const mainByCatalog = new Map(mainAvailabilities.map((item) => [item.catalogItemId, item]));

    return {
      request: {
        requestItemId: Number(context.requestItemId),
        requestId: Number(context.requestId),
        originalItemName: String(context.itemNameSnapshot),
        requestedQuantity: Number(context.requestedQuantity || 0),
        unit: context.unitSnapshot == null ? null : String(context.unitSnapshot),
        taskNumber: String(context.taskNumber),
        taskItemTitle: String(context.taskItemTitle),
        teamWarehouse,
        mainWarehouse,
      },
      items: items.map((item) => ({
        ...item,
        teamAvailability: teamByCatalog.get(item.id) ?? {
          catalogItemId: item.id,
          warehouseId: Number(context.teamWarehouseId),
          inventoryId: null,
          availableQuantity: 0,
          unit: null,
          lotsRequired: false,
          ambiguous: false,
        },
        mainWarehouseAvailability: mainByCatalog.get(item.id) ?? {
          catalogItemId: item.id,
          warehouseId: Number(mainWarehouse!.id),
          inventoryId: null,
          availableQuantity: 0,
          unit: null,
          lotsRequired: false,
          ambiguous: false,
        },
      })),
    };
  }

  async resolveIdentity(
    actorUserId: number,
    input: { requestItemId: number; catalogItemId: number; requestedQuantity?: number },
    auditContext?: { ipAddress?: string; userAgent?: string },
  ) {
    const requestItemId = Number(input.requestItemId);
    const catalogItemId = Number(input.catalogItemId);
    if (![requestItemId, catalogItemId].every((value) => Number.isInteger(value) && value > 0)) {
      throw new Pmv2MaterialIdentityResolutionError("مرجع المادة أو الصنف غير صالح");
    }

    let catalogItem;
    try {
      catalogItem = await currentCatalogAdapter.requireActiveItem(catalogItemId);
    } catch (error) {
      mapIntegrationError(error);
    }
    let officialItemName = String(catalogItem!.nameAr || catalogItem!.nameEn || `#${catalogItemId}`);

    const db = await requireDb();
    const result = await db.transaction(async (tx: any) => {
      const [actorRows] = await tx.execute(sql`SELECT id,role,isActive FROM users WHERE id=${actorUserId} FOR UPDATE`);
      const actor = Array.isArray(actorRows) ? actorRows[0] : null;
      if (!actor || Number(actor.isActive) !== 1 || !canRoleAccessPmv2Warehouse(actor.role))
        throw new Pmv2MaterialIdentityResolutionError("ليس لديك صلاحية معالجة طلب مواد المستودع");
      await tx.execute(sql`SELECT id FROM pmv2_material_request_items WHERE id = ${requestItemId} FOR UPDATE`);
      const context = await loadUnlistedContext(tx, requestItemId);
      if (!context) throw new Pmv2MaterialIdentityResolutionError("بند طلب المادة غير موجود");
      if (context.status !== "waiting_warehouse") {
        throw new Pmv2MaterialIdentityResolutionError("بند المادة لم يعد بانتظار معالجة المستودع");
      }
      const [catalogRows] = await tx.execute(sql`SELECT id,nameAr,nameEn,code,unit,isActive FROM catalog_items WHERE id=${catalogItemId} FOR UPDATE`);
      const currentCatalog = Array.isArray(catalogRows) ? catalogRows[0] : null;
      if (!currentCatalog || Number(currentCatalog.isActive) !== 1) throw new Pmv2MaterialIdentityResolutionError("صنف الكتالوج غير نشط أو غير موجود");
      catalogItem = { ...catalogItem!, ...currentCatalog, isActive: true };
      officialItemName = String(currentCatalog.nameAr || currentCatalog.nameEn || `#${catalogItemId}`);
      let authoritativeUnit: string;
      try { authoritativeUnit = pmv2CatalogBaseUnit(currentCatalog.unit); } catch (error) { throw new Pmv2MaterialIdentityResolutionError((error as Error).message); }
      const repairing = context.catalogItemId != null;
      if (repairing && (Number(context.catalogItemId) !== catalogItemId || normalizeUnit(context.unitSnapshot) === normalizeUnit(authoritativeUnit)))
        throw new Pmv2MaterialIdentityResolutionError("تم تحديد هوية هذه المادة ووحدتها مسبقًا؛ حدّث الشاشة");
      if (["cancelled", "completed"].includes(context.taskStatus) || context.itemStatus !== "waiting_material" || context.itemResult !== "needs_material") {
        throw new Pmv2MaterialIdentityResolutionError("بند الصيانة لم يعد في حالة انتظار المواد");
      }

      const routeDecision = await loadLatestRequestRouteDecision(tx, Number(context.taskItemId), requestItemId);
      if (!routeDecision || (repairing ? Number(routeDecision.snapshot.catalogItemId) !== catalogItemId : routeDecision.snapshot.catalogItemId != null)) {
        throw new Pmv2MaterialIdentityResolutionError("تعذر العثور على قرار المادة غير المدرجة المرتبط بهذا الطلب");
      }
      if (Number(routeDecision.snapshot.teamWarehouseId) !== Number(context.teamWarehouseId)) {
        throw new Pmv2MaterialIdentityResolutionError("مخزن الفريق في قرار المادة لا يطابق الطلب الحالي");
      }
      const [historyRows] = await tx.execute(sql`SELECT (EXISTS(SELECT 1 FROM pmv2_material_purchase_links WHERE materialRequestItemId=${requestItemId})
        OR EXISTS(SELECT 1 FROM pmv2_material_usages WHERE materialRequestItemId=${requestItemId})) AS hasHistory`);
      if (!Array.isArray(historyRows) || historyRows.length !== 1) throw Error("تعذر التحقق من سجل احتياج المواد");
      const historyActions = await tx.select({ action: pmv2ItemActions.action, note: pmv2ItemActions.note }).from(pmv2ItemActions)
        .where(eq(pmv2ItemActions.taskItemId, Number(context.taskItemId)));
      try { assertPmv2UnitApprovalUntouched({ received: Number(context.receivedWarehouseQuantity || 0), issued: Number(context.issuedToTeamQuantity || 0),
        hasProcurementOrUsage: Number(historyRows[0].hasHistory) !== 0, actions: historyActions, requestItemId, routeActionId: routeDecision.id }); }
      catch (error) { throw new Pmv2MaterialIdentityResolutionError((error as Error).message); }

      const otherActive = await tx
        .select({ id: pmv2MaterialRequestItems.id })
        .from(pmv2MaterialRequestItems)
        .innerJoin(pmv2MaterialRequests, eq(pmv2MaterialRequests.id, pmv2MaterialRequestItems.requestId))
        .where(and(
          eq(pmv2MaterialRequests.taskItemId, Number(context.taskItemId)),
          eq(pmv2MaterialRequestItems.catalogItemId, catalogItemId),
          ne(pmv2MaterialRequestItems.id, requestItemId),
          notInArray(pmv2MaterialRequestItems.status, ["consumed", "cancelled"]),
        ))
        .limit(1);
      if (otherActive.some((row: any) => Number(row.id) !== requestItemId)) {
        throw new Pmv2MaterialIdentityResolutionError("يوجد احتياج فعال آخر لنفس الصنف على بند الصيانة؛ راجع الطلبات قبل الربط");
      }

      let teamWarehouse;
      let mainWarehouse;
      try {
        [teamWarehouse, mainWarehouse] = await Promise.all([
          currentWarehouseAdapter.requireActiveWarehouse(Number(context.teamWarehouseId)),
          currentWarehouseAdapter.requireSingleActiveMainWarehouse(),
        ]);
      } catch (error) {
        mapIntegrationError(error);
      }

      const [teamAvailability, mainAvailability] = await Promise.all([
        currentInventoryAdapter.getCatalogAvailability(catalogItemId, Number(context.teamWarehouseId)),
        currentInventoryAdapter.getCatalogAvailability(catalogItemId, Number(mainWarehouse!.id)),
      ]);
      if (teamAvailability.ambiguous) {
        throw new Pmv2MaterialIdentityResolutionError("توجد أكثر من بطاقة مخزون للصنف المحدد في مخزن الفريق؛ صحح هوية المخزون قبل الربط");
      }

      const requestUnit = authoritativeUnit;
      if ([teamAvailability, mainAvailability].some(stock => stock.inventoryId && stock.unit && normalizeUnit(stock.unit) !== normalizeUnit(authoritativeUnit))) {
        throw new Pmv2MaterialIdentityResolutionError(
          "وحدة المخزون الحالية تختلف عن وحدة الكتالوج؛ راجع سجل الصنف قبل اعتماد الاحتياج",
        );
      }

      let fullNeedQuantity: number;
      try { fullNeedQuantity = pmv2ApprovedMaterialQuantity(input.requestedQuantity ?? routeDecision.snapshot.requestedQuantity, authoritativeUnit); }
      catch (error) { throw new Pmv2MaterialIdentityResolutionError((error as Error).message); }
      const teamAvailableQuantity = roundQuantity(Number(teamAvailability.availableQuantity || 0));
      const shortageQuantity = roundQuantity(fullNeedQuantity - teamAvailableQuantity);
      const route = shortageQuantity <= 0 ? "team_inventory" as const : "material_request" as const;

      const nextItemWrite = validatePmv2MaterialRequestItemWrite({
        requestId: Number(context.requestId),
        catalogItemId,
        itemNameSnapshot: officialItemName,
        requestedQuantity: route === "material_request" ? shortageQuantity : fullNeedQuantity,
        unitSnapshot: requestUnit || authoritativeUnit || null,
        status: route === "material_request" ? "waiting_warehouse" : "cancelled",
        receivedWarehouseQuantity: Number(context.receivedWarehouseQuantity || 0),
        issuedToTeamQuantity: Number(context.issuedToTeamQuantity || 0),
      });

      await tx
        .update(pmv2MaterialRequestItems)
        .set({
          catalogItemId: nextItemWrite.catalogItemId,
          itemNameSnapshot: nextItemWrite.itemNameSnapshot,
          requestedQuantity: String(nextItemWrite.requestedQuantity),
          unitSnapshot: nextItemWrite.unitSnapshot,
          status: nextItemWrite.status,
        })
        .where(eq(pmv2MaterialRequestItems.id, requestItemId));

      const nextRouteSnapshot: MaterialRouteDecisionSnapshot = {
        version: 1,
        route,
        catalogItemId,
        itemNameSnapshot: officialItemName,
        requestedQuantity: fullNeedQuantity,
        unit: requestUnit || authoritativeUnit,
        teamWarehouseId: Number(context.teamWarehouseId),
        inventoryId: teamAvailability.inventoryId,
        availableQuantity: teamAvailableQuantity,
        shortageQuantity,
        lotsRequired: Boolean(teamAvailability.lotsRequired),
        materialRequestId: route === "material_request" ? Number(context.requestId) : null,
        materialRequestItemId: route === "material_request" ? requestItemId : null,
      };
      const routeInsert = await tx.insert(pmv2ItemActions).values({
        taskItemId: Number(context.taskItemId),
        visitId: Number(context.visitId),
        action: MATERIAL_ROUTE_DECISION_ACTION,
        result: null,
        note: JSON.stringify(nextRouteSnapshot),
        performedById: actorUserId,
      });
      const routeDecisionActionId = Number(routeInsert[0]?.insertId || 0);
      if (!routeDecisionActionId) throw new Error("تعذر تحديد قرار مسار المادة بعد حل الهوية");

      const identityNote = {
        version: 1,
        materialRequestId: Number(context.requestId),
        materialRequestItemId: requestItemId,
        originalItemName: String(context.itemNameSnapshot),
        originalRequestedQuantity: Number(routeDecision.snapshot.requestedQuantity),
        originalUnit: routeDecision.snapshot.unit || context.unitSnapshot || null,
        resolvedCatalogItemId: catalogItemId,
        resolvedItemName: officialItemName,
        resolvedItemCode: catalogItem!.code || null,
        requestedQuantity: fullNeedQuantity,
        unit: requestUnit || authoritativeUnit || null,
        teamWarehouseId: Number(context.teamWarehouseId),
        teamAvailableQuantity,
        shortageQuantity,
        route,
        routeDecisionActionId,
      };
      await tx.insert(pmv2ItemActions).values({
        taskItemId: Number(context.taskItemId),
        visitId: Number(context.visitId),
        action: MATERIAL_IDENTITY_RESOLVED_ACTION,
        result: null,
        note: JSON.stringify(identityNote),
        performedById: actorUserId,
      });

      await writePmv2AuditWithDb(tx, {
        actorUserId,
        action: "material_identity_resolved",
        entity: "material_request_item",
        entityId: requestItemId,
        oldValues: {
          catalogItemId: context.catalogItemId,
          itemNameSnapshot: String(context.itemNameSnapshot),
          requestedQuantity: Number(context.requestedQuantity || 0),
          unitSnapshot: context.unitSnapshot,
          status: String(context.status),
        },
        newValues: {
          catalogItemId,
          itemNameSnapshot: officialItemName,
          itemCode: catalogItem!.code || null,
          requestedTotalQuantity: fullNeedQuantity,
          teamAvailableQuantity,
          shortageQuantity,
          route,
          requestStatus: nextItemWrite.status,
          routeDecisionActionId,
          teamWarehouseId: Number(teamWarehouse!.id),
        },
        ipAddress: auditContext?.ipAddress,
        userAgent: auditContext?.userAgent,
      });

      return {
        requestItemId,
        requestId: Number(context.requestId),
        taskId: Number(context.taskId),
        taskItemId: Number(context.taskItemId),
        taskNumber: String(context.taskNumber),
        requestedById: Number(context.requestedById),
        originalItemName: String(context.itemNameSnapshot),
        catalogItem: catalogItem!,
        requestedQuantity: fullNeedQuantity,
        unit: requestUnit || authoritativeUnit || null,
        teamWarehouse: teamWarehouse!,
        teamAvailableQuantity,
        shortageQuantity,
        route,
        warehouseRequestClosed: route === "team_inventory",
        routeDecisionActionId,
      };
    });

    const resolvedCode = result.catalogItem?.code ? ` (${result.catalogItem.code})` : "";
    const notificationMessage = result.route === "team_inventory"
      ? `تم التعرف على المادة التي سجلتها «${result.originalItemName}» بأنها «${result.catalogItem.nameAr || result.catalogItem.nameEn}»${resolvedCode}. الكمية متوفرة في مخزن الفريق وجاهزة للاستلام ضمن المهمة ${result.taskNumber}.`
      : `تم التعرف على المادة التي سجلتها «${result.originalItemName}» بأنها «${result.catalogItem.nameAr || result.catalogItem.nameEn}»${resolvedCode}. النقص الحالي ${result.shortageQuantity} ${result.unit || ""} وسيكمل المستودع معالجته ضمن المهمة ${result.taskNumber}.`;
    try {
      await createNotification({
        userId: Number(result.requestedById),
        title: "تم التعرف على المادة المطلوبة",
        message: notificationMessage,
        type: result.route === "team_inventory" ? "success" : "info",
      });
    } catch (error) {
      console.error("[PMV2] material identity notification failed", error);
    }

    return result;
  }
}

export const pmv2MaterialIdentityResolutionService = new Pmv2MaterialIdentityResolutionService();

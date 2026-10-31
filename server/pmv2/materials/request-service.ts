import { pmv2ExecutionActor, pmv2ExecutionActorCondition, pmv2ExecutionTeamCondition } from "../security/execution-access";
import { and, desc, eq, isNull, notInArray, sql } from "drizzle-orm";
import {
  pmv2ItemActions,
  pmv2MaterialRequestItems,
  pmv2MaterialUsages,
  pmv2MaterialRequests,
  pmv2TaskItems,
  pmv2Tasks,
  pmv2Teams,
} from "../../../drizzle/schema";
import { getDb } from "../../_core/db/client";
import { pmv2ApprovedMaterialQuantity, pmv2CatalogBaseUnit } from "./catalog-unit-policy";
import {
  currentCatalogAdapter,
  currentInventoryAdapter,
  currentWarehouseAdapter,
  Pmv2ExternalReferenceError,
} from "../adapters/current-system";
import { writePmv2AuditWithDb } from "../audit/service";
import { Pmv2TechnicianAccessError } from "../technician/read-service";
import { queuePmv2Translation } from "../translation-queue";
import {
  Pmv2MaterialRequestItemValidationError,
  validatePmv2MaterialRequestItemWrite,
} from "./request-item-validation";

export class Pmv2MaterialFlowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "Pmv2MaterialFlowError";
  }
}

type SubmitMaterialNeedInput = {
  taskId: number;
  taskItemId: number;
  catalogItemId: number | null;
  unlistedItemName?: string;
  quantity: number;
  unit?: string;
};

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

function parseMaterialRouteDecision(note: string | null | undefined): MaterialRouteDecisionSnapshot | null {
  if (!note) return null;
  try {
    const parsed = JSON.parse(note) as Partial<MaterialRouteDecisionSnapshot>;
    if (parsed.version !== 1) return null;
    if (parsed.route !== "team_inventory" && parsed.route !== "material_request") return null;
    if (parsed.catalogItemId != null && (!Number.isInteger(parsed.catalogItemId) || parsed.catalogItemId <= 0)) return null;
    if (!parsed.itemNameSnapshot || (parsed.catalogItemId != null && !parsed.unit)) return null;
    const requestedQuantity = Number(parsed.requestedQuantity);
    const shortageQuantity = Number(parsed.shortageQuantity);
    if (!Number.isFinite(requestedQuantity) || requestedQuantity <= 0) return null;
    if (!Number.isFinite(shortageQuantity) || shortageQuantity < 0) return null;
    return {
      version: 1,
      route: parsed.route,
      catalogItemId: parsed.catalogItemId ?? null,
      itemNameSnapshot: String(parsed.itemNameSnapshot),
      requestedQuantity,
      unit: String(parsed.unit || ""),
      teamWarehouseId: Number(parsed.teamWarehouseId || 0),
      inventoryId: parsed.inventoryId == null ? null : Number(parsed.inventoryId),
      availableQuantity: parsed.availableQuantity == null ? null : Number(parsed.availableQuantity),
      shortageQuantity,
      lotsRequired: Boolean(parsed.lotsRequired),
      materialRequestId: parsed.materialRequestId == null ? null : Number(parsed.materialRequestId),
      materialRequestItemId: parsed.materialRequestItemId == null ? null : Number(parsed.materialRequestItemId),
    };
  } catch {
    return null;
  }
}

type MaterialIdentityResolutionSnapshot = {
  version: 1;
  materialRequestId: number;
  materialRequestItemId: number;
  originalItemName: string;
  resolvedCatalogItemId: number;
  resolvedItemName: string;
  resolvedItemCode: string | null;
  requestedQuantity: number;
  unit: string | null;
  teamAvailableQuantity: number;
  shortageQuantity: number;
  route: "team_inventory" | "material_request";
  routeDecisionActionId: number;
};

function parseMaterialIdentityResolution(note: string | null | undefined): MaterialIdentityResolutionSnapshot | null {
  if (!note) return null;
  try {
    const parsed = JSON.parse(note) as Partial<MaterialIdentityResolutionSnapshot>;
    const requestItemId = Number(parsed.materialRequestItemId);
    const catalogItemId = Number(parsed.resolvedCatalogItemId);
    if (parsed.version !== 1 || !Number.isInteger(requestItemId) || requestItemId <= 0) return null;
    if (!Number.isInteger(catalogItemId) || catalogItemId <= 0) return null;
    if (parsed.route !== "team_inventory" && parsed.route !== "material_request") return null;
    return {
      version: 1,
      materialRequestId: Number(parsed.materialRequestId || 0),
      materialRequestItemId: requestItemId,
      originalItemName: String(parsed.originalItemName || ""),
      resolvedCatalogItemId: catalogItemId,
      resolvedItemName: String(parsed.resolvedItemName || ""),
      resolvedItemCode: parsed.resolvedItemCode == null ? null : String(parsed.resolvedItemCode),
      requestedQuantity: Number(parsed.requestedQuantity || 0),
      unit: parsed.unit == null ? null : String(parsed.unit),
      teamAvailableQuantity: Number(parsed.teamAvailableQuantity || 0),
      shortageQuantity: Number(parsed.shortageQuantity || 0),
      route: parsed.route,
      routeDecisionActionId: Number(parsed.routeDecisionActionId || 0),
    };
  } catch {
    return null;
  }
}

function normalizeUnit(value: string | null | undefined) {
  return String(value || "").trim().toLocaleLowerCase();
}

function normalizeItemName(value: string | null | undefined) {
  return String(value || "").trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

function mapIntegrationError(error: unknown): never {
  if (
    error instanceof Pmv2ExternalReferenceError ||
    error instanceof Pmv2MaterialRequestItemValidationError
  ) {
    throw new Pmv2MaterialFlowError(error.message);
  }
  throw error;
}

async function requireDb() {
  const db = await getDb();
  if (!db) throw new Error("تعذر الاتصال بقاعدة البيانات");
  return db;
}

/**
 * Phase 4 material boundary.
 *
 * This service decides only whether the requested quantity is already available
 * in the Team Warehouse or whether a PM V2 Material Request is needed for the
 * shortage. It never changes Inventory, Lots, Deliveries, Transfers, or PO data.
 */
export class Pmv2MaterialRequestService {
  async searchCatalog(
    userId: number,
    taskId: number,
    taskItemId: number,
    query?: string,
  ) {
    const db = await requireDb();
    const allowed = await db
      .select({
        teamId: pmv2Tasks.teamId,
        programTargetId: pmv2Tasks.programTargetId,
        teamWarehouseId: pmv2Teams.warehouseId,
      })
      .from(pmv2TaskItems)
      .innerJoin(pmv2Tasks, eq(pmv2Tasks.id, pmv2TaskItems.taskId))
      .innerJoin(pmv2Teams, eq(pmv2Teams.id, pmv2Tasks.teamId))
      .innerJoin(
        pmv2ExecutionActor, pmv2ExecutionActorCondition(userId),
      )
      .where(and(pmv2ExecutionTeamCondition(userId, pmv2Tasks.teamId), eq(pmv2Tasks.id, taskId), eq(pmv2TaskItems.id, taskItemId)))
      .limit(1);

    const context = allowed[0];
    if (!context) throw new Pmv2TechnicianAccessError();

    try {
      await currentWarehouseAdapter.requireActiveWarehouse(context.teamWarehouseId);
    } catch (error) {
      mapIntegrationError(error);
    }

    const term = String(query || "").trim();

    // Existing PM V2 usage is valid evidence for smarter defaults because it is
    // already linked to real Task/Team history. We deliberately do not infer
    // specialty/category relationships from names or free text.
    const historyRows = await db
      .select({
        catalogItemId: pmv2MaterialUsages.catalogItemId,
        programTargetId: pmv2Tasks.programTargetId,
        createdAt: pmv2MaterialUsages.createdAt,
      })
      .from(pmv2MaterialUsages)
      .innerJoin(pmv2TaskItems, eq(pmv2TaskItems.id, pmv2MaterialUsages.taskItemId))
      .innerJoin(pmv2Tasks, eq(pmv2Tasks.id, pmv2TaskItems.taskId))
      .where(eq(pmv2Tasks.teamId, context.teamId))
      .orderBy(desc(pmv2MaterialUsages.createdAt))
      .limit(300);

    const historyByCatalog = new Map<number, {
      teamUseCount: number;
      sameTargetUseCount: number;
      lastUsedAt: string | null;
    }>();
    for (const row of historyRows) {
      const catalogItemId = Number(row.catalogItemId || 0);
      if (!Number.isInteger(catalogItemId) || catalogItemId <= 0) continue;
      const current = historyByCatalog.get(catalogItemId) ?? {
        teamUseCount: 0,
        sameTargetUseCount: 0,
        lastUsedAt: null,
      };
      current.teamUseCount += 1;
      if (Number(row.programTargetId) === Number(context.programTargetId)) {
        current.sameTargetUseCount += 1;
      }
      if (!current.lastUsedAt && row.createdAt) current.lastUsedAt = String(row.createdAt);
      historyByCatalog.set(catalogItemId, current);
    }

    let candidateIds: number[];
    let sourceOrder = new Map<number, number>();

    if (term) {
      // Full Catalog search remains available at all times. Taxonomy is enriched
      // after search so operator identity stays name + code + category path.
      const searched = await currentCatalogAdapter.searchActiveItems(term, 50);
      candidateIds = searched.map((item) => Number(item.id));
      sourceOrder = new Map(candidateIds.map((id, index) => [id, index]));
    } else {
      // Smart default: real usable Team-Warehouse stock first, then materials
      // demonstrably used by this Team/target, then a general active-Catalog fill.
      const [stockedIds, general] = await Promise.all([
        currentInventoryAdapter.listAvailableCatalogItemIds(context.teamWarehouseId, 120),
        currentCatalogAdapter.searchActiveItems("", 50),
      ]);
      const historyIds = [...historyByCatalog.entries()]
        .sort((a, b) => {
          if (b[1].sameTargetUseCount !== a[1].sameTargetUseCount) {
            return b[1].sameTargetUseCount - a[1].sameTargetUseCount;
          }
          if (b[1].teamUseCount !== a[1].teamUseCount) return b[1].teamUseCount - a[1].teamUseCount;
          return String(b[1].lastUsedAt || "").localeCompare(String(a[1].lastUsedAt || ""));
        })
        .map(([id]) => id);
      candidateIds = [...new Set([
        ...stockedIds.map(Number),
        ...historyIds,
        ...general.map((item) => Number(item.id)),
      ])];
      sourceOrder = new Map(candidateIds.map((id, index) => [id, index]));
    }

    if (candidateIds.length === 0) return [];

    const catalogRefs = await currentCatalogAdapter.getItemsByIds(candidateIds);
    const catalogById = new Map(catalogRefs.map((item) => [Number(item.id), item]));
    const activeItems = candidateIds
      .map((id) => catalogById.get(id))
      .filter((item): item is NonNullable<typeof item> => Boolean(item?.isActive));

    const availability = await currentInventoryAdapter.getCatalogAvailabilities(
      activeItems.map((item) => item.id),
      context.teamWarehouseId,
    );
    const availabilityByItem = new Map(availability.map((item) => [item.catalogItemId, item]));

    const normalizedTerm = term.toLocaleLowerCase();
    const textScore = (item: (typeof activeItems)[number]) => {
      if (!normalizedTerm) return 0;
      const code = String(item.code || "").trim().toLocaleLowerCase();
      const nameAr = String(item.nameAr || "").trim().toLocaleLowerCase();
      const nameEn = String(item.nameEn || "").trim().toLocaleLowerCase();
      if (code === normalizedTerm) return 5000;
      if (nameAr === normalizedTerm || nameEn === normalizedTerm) return 4600;
      if (code.startsWith(normalizedTerm)) return 4300;
      if (nameAr.startsWith(normalizedTerm) || nameEn.startsWith(normalizedTerm)) return 4100;
      if (code.includes(normalizedTerm)) return 3800;
      if (nameAr.includes(normalizedTerm) || nameEn.includes(normalizedTerm)) return 3600;
      return 3000;
    };

    return activeItems
      .map((item) => {
        const itemId = Number(item.id);
        const teamAvailability = availabilityByItem.get(item.id) ?? {
          catalogItemId: item.id,
          warehouseId: context.teamWarehouseId,
          inventoryId: null,
          availableQuantity: 0,
          unit: null,
          lotsRequired: false,
          ambiguous: false,
        };
        const history = historyByCatalog.get(itemId) ?? {
          teamUseCount: 0,
          sameTargetUseCount: 0,
          lastUsedAt: null,
        };
        const inTeamStock = !teamAvailability.ambiguous && Number(teamAvailability.availableQuantity || 0) > 0;
        const smartPriority = inTeamStock
          ? "team_stock"
          : history.sameTargetUseCount > 0
            ? "same_target_history"
            : history.teamUseCount > 0
              ? "team_history"
              : "catalog";
        const rankingScore = term
          ? textScore(item)
            + (inTeamStock ? 500 : 0)
            + Math.min(history.sameTargetUseCount, 10) * 20
            + Math.min(history.teamUseCount, 20) * 5
          : (inTeamStock ? 100000 : 0)
            + (history.sameTargetUseCount > 0 ? 50000 : 0)
            + (history.teamUseCount > 0 ? 30000 : 0)
            + Math.min(history.sameTargetUseCount, 20) * 100
            + Math.min(history.teamUseCount, 50) * 10;

        return {
          ...item,
          teamAvailability: availabilityByItem.get(item.id) ?? teamAvailability,
          smartPriority,
          smartSignals: {
            inTeamStock,
            sameTargetUseCount: history.sameTargetUseCount,
            teamUseCount: history.teamUseCount,
            lastUsedAt: history.lastUsedAt,
          },
          rankingScore,
          sourceOrder: sourceOrder.get(itemId) ?? Number.MAX_SAFE_INTEGER,
        };
      })
      .sort((a, b) => {
        if (b.rankingScore !== a.rankingScore) return b.rankingScore - a.rankingScore;
        if (a.sourceOrder !== b.sourceOrder) return a.sourceOrder - b.sourceOrder;
        return String(a.nameAr).localeCompare(String(b.nameAr), "ar");
      })
      .slice(0, 30)
      .map(({ rankingScore: _rankingScore, sourceOrder: _sourceOrder, ...item }) => item);
  }

  async getItemMaterialState(userId: number, taskId: number, taskItemId: number) {
    const db = await requireDb();
    const allowed = await db
      .select({
        taskItemId: pmv2TaskItems.id,
        status: pmv2TaskItems.status,
        result: pmv2TaskItems.result,
        teamId: pmv2Tasks.teamId,
        teamWarehouseId: pmv2Teams.warehouseId,
      })
      .from(pmv2TaskItems)
      .innerJoin(pmv2Tasks, eq(pmv2Tasks.id, pmv2TaskItems.taskId))
      .innerJoin(pmv2Teams, eq(pmv2Teams.id, pmv2Tasks.teamId))
      .innerJoin(
        pmv2ExecutionActor, pmv2ExecutionActorCondition(userId),
      )
      .where(and(pmv2ExecutionTeamCondition(userId, pmv2Tasks.teamId), eq(pmv2Tasks.id, taskId), eq(pmv2TaskItems.id, taskItemId)))
      .limit(1);

    const context = allowed[0];
    if (!context) throw new Pmv2TechnicianAccessError();

    let warehouse;
    try {
      warehouse = await currentWarehouseAdapter.requireActiveWarehouse(context.teamWarehouseId);
    } catch (error) {
      mapIntegrationError(error);
    }

    const rows = await db
      .select({
        requestId: pmv2MaterialRequests.id,
        requestedById: pmv2MaterialRequests.requestedById,
        visitId: pmv2MaterialRequests.visitId,
        createdAt: pmv2MaterialRequests.createdAt,
        requestItemId: pmv2MaterialRequestItems.id,
        catalogItemId: pmv2MaterialRequestItems.catalogItemId,
        itemNameSnapshot: pmv2MaterialRequestItems.itemNameSnapshot,
        requestedQuantity: pmv2MaterialRequestItems.requestedQuantity,
        unitSnapshot: pmv2MaterialRequestItems.unitSnapshot,
        status: pmv2MaterialRequestItems.status,
        receivedWarehouseQuantity: pmv2MaterialRequestItems.receivedWarehouseQuantity,
        issuedToTeamQuantity: pmv2MaterialRequestItems.issuedToTeamQuantity,
      })
      .from(pmv2MaterialRequests)
      .innerJoin(
        pmv2MaterialRequestItems,
        eq(pmv2MaterialRequestItems.requestId, pmv2MaterialRequests.id),
      )
      .where(eq(pmv2MaterialRequests.taskItemId, taskItemId))
      .orderBy(desc(pmv2MaterialRequests.id), desc(pmv2MaterialRequestItems.id));

    const routeRows = await db
      .select({
        actionId: pmv2ItemActions.id,
        note: pmv2ItemActions.note,
        performedById: pmv2ItemActions.performedById,
        createdAt: pmv2ItemActions.createdAt,
      })
      .from(pmv2ItemActions)
      .where(
        and(
          eq(pmv2ItemActions.taskItemId, taskItemId),
          eq(pmv2ItemActions.action, MATERIAL_ROUTE_DECISION_ACTION),
        ),
      )
      .orderBy(desc(pmv2ItemActions.id));

    const identityRows = await db
      .select({
        actionId: pmv2ItemActions.id,
        note: pmv2ItemActions.note,
        performedById: pmv2ItemActions.performedById,
        createdAt: pmv2ItemActions.createdAt,
      })
      .from(pmv2ItemActions)
      .where(
        and(
          eq(pmv2ItemActions.taskItemId, taskItemId),
          eq(pmv2ItemActions.action, MATERIAL_IDENTITY_RESOLVED_ACTION),
        ),
      )
      .orderBy(desc(pmv2ItemActions.id));
    const identityByRequestItemId = new Map<number, MaterialIdentityResolutionSnapshot & {
      actionId: number;
      performedById: number;
      createdAt: string;
    }>();
    for (const row of identityRows) {
      const identity = parseMaterialIdentityResolution(row.note);
      if (!identity || identityByRequestItemId.has(identity.materialRequestItemId)) continue;
      identityByRequestItemId.set(identity.materialRequestItemId, {
        ...identity,
        actionId: Number(row.actionId),
        performedById: Number(row.performedById),
        createdAt: String(row.createdAt),
      });
    }

    const latestCatalogRoute = new Map<number, MaterialRouteDecisionSnapshot & {
      actionId: number;
      performedById: number;
      createdAt: string;
    }>();
    for (const row of routeRows) {
      const decision = parseMaterialRouteDecision(row.note);
      if (!decision || decision.catalogItemId == null || latestCatalogRoute.has(decision.catalogItemId)) continue;
      latestCatalogRoute.set(decision.catalogItemId, {
        ...decision,
        actionId: row.actionId,
        performedById: row.performedById,
        createdAt: row.createdAt,
      });
    }

    return {
      taskItemId,
      itemStatus: context.status,
      itemResult: context.result,
      teamId: context.teamId,
      teamWarehouse: warehouse!,
      requests: rows.map((row) => ({
        ...row,
        requestedQuantity: Number(row.requestedQuantity || 0),
        receivedWarehouseQuantity: Number(row.receivedWarehouseQuantity || 0),
        issuedToTeamQuantity: Number(row.issuedToTeamQuantity || 0),
        identityResolution: identityByRequestItemId.get(Number(row.requestItemId)) ?? null,
      })),
      teamInventoryHandoffs: Array.from(latestCatalogRoute.values())
        .filter((decision) => decision.route === "team_inventory")
        .sort((a, b) => b.actionId - a.actionId),
    };
  }

  async submitMaterialNeed(
    userId: number,
    input: SubmitMaterialNeedInput,
    auditContext?: { ipAddress?: string; userAgent?: string },
  ) {
    const quantity = Number(input.quantity);
    // Client unit is retained only as a compatibility input; never authoritative.
    let unit = "";

    const catalogItemId = input.catalogItemId == null ? null : Number(input.catalogItemId);
    if (catalogItemId !== null && (!Number.isInteger(catalogItemId) || catalogItemId <= 0)) {
      throw new Pmv2MaterialFlowError("معرّف مادة الدليل غير صالح");
    }

    const unlistedItemName = String(input.unlistedItemName || "").trim().replace(/\s+/g, " ");
    if (catalogItemId === null && (!unlistedItemName || unlistedItemName.length > 300)) {
      throw new Pmv2MaterialFlowError(
        "اسم المادة غير الموجودة في الدليل مطلوب ويجب ألا يتجاوز 300 حرف",
      );
    }

    let catalogItem: Awaited<ReturnType<typeof currentCatalogAdapter.requireActiveItem>> | null = null;
    if (catalogItemId !== null) {
      try {
        catalogItem = await currentCatalogAdapter.requireActiveItem(catalogItemId);
      } catch (error) {
        mapIntegrationError(error);
      }
    }
    let itemNameSnapshot = catalogItem
      ? (catalogItem.nameAr || catalogItem.nameEn)
      : unlistedItemName;

    const db = await requireDb();
    const result = await db.transaction(async (tx: any) => {
      await tx.execute(sql`SELECT id FROM pmv2_task_items WHERE id = ${input.taskItemId} FOR UPDATE`);

      const accessible = await tx
        .select({
          taskItemId: pmv2TaskItems.id,
          itemStatus: pmv2TaskItems.status,
          itemResult: pmv2TaskItems.result,
          taskStatus: pmv2Tasks.status,
          teamId: pmv2Tasks.teamId,
          teamWarehouseId: pmv2Teams.warehouseId,
        })
        .from(pmv2TaskItems)
        .innerJoin(pmv2Tasks, eq(pmv2Tasks.id, pmv2TaskItems.taskId))
        .innerJoin(pmv2Teams, eq(pmv2Teams.id, pmv2Tasks.teamId))
        .innerJoin(
          pmv2ExecutionActor, pmv2ExecutionActorCondition(userId),
        )
        .where(
          and(
            pmv2ExecutionTeamCondition(userId, pmv2Tasks.teamId),
            eq(pmv2Tasks.id, input.taskId),
            eq(pmv2TaskItems.id, input.taskItemId),
          ),
        )
        .limit(1);

      const context = accessible[0];
      if (!context) throw new Pmv2TechnicianAccessError();
      if (["cancelled", "completed"].includes(context.taskStatus) || context.itemStatus !== "waiting_material" || context.itemResult !== "needs_material") {
        throw new Pmv2MaterialFlowError("يمكن تحديد الاحتياج المادي فقط لبند حالته بانتظار المواد");
      }
      if (catalogItemId !== null) {
        const [current] = await tx.execute(sql`SELECT id,nameAr,nameEn,code,unit,isActive FROM catalog_items WHERE id=${catalogItemId} FOR UPDATE`);
        const item = Array.isArray(current) ? current[0] : null;
        if (!item || Number(item.isActive) !== 1) throw new Pmv2MaterialFlowError("صنف الكتالوج غير نشط أو غير موجود");
        try { unit = pmv2CatalogBaseUnit(item.unit); } catch (error) { throw new Pmv2MaterialFlowError((error as Error).message); }
        catalogItem = { ...catalogItem!, ...item, isActive: true };
        itemNameSnapshot = String(item.nameAr || item.nameEn || `#${catalogItemId}`);
      }
      try { pmv2ApprovedMaterialQuantity(quantity, unit); } catch (error) { throw new Pmv2MaterialFlowError((error as Error).message); }

      const needActions = await tx
        .select({ id: pmv2ItemActions.id, visitId: pmv2ItemActions.visitId })
        .from(pmv2ItemActions)
        .where(
          and(
            eq(pmv2ItemActions.taskItemId, input.taskItemId),
            eq(pmv2ItemActions.action, "submit_result"),
            eq(pmv2ItemActions.result, "needs_material"),
          ),
        )
        .orderBy(desc(pmv2ItemActions.id))
        .limit(1);
      const needAction = needActions[0];
      if (!needAction) {
        throw new Pmv2MaterialFlowError("لم يتم العثور على إجراء تحتاج مواد المرتبط بهذا البند");
      }

      const writeRouteDecision = async (snapshot: MaterialRouteDecisionSnapshot) => {
        const insert = await tx.insert(pmv2ItemActions).values({
          taskItemId: input.taskItemId,
          visitId: needAction.visitId,
          action: MATERIAL_ROUTE_DECISION_ACTION,
          result: null,
          note: JSON.stringify(snapshot),
          performedById: userId,
        });
        const actionId = Number(insert[0]?.insertId || 0);
        if (!actionId) throw new Error("تعذر تحديد سجل قرار مسار المادة");
        return actionId;
      };

      let warehouse;
      try {
        warehouse = await currentWarehouseAdapter.requireActiveWarehouse(context.teamWarehouseId);
      } catch (error) {
        mapIntegrationError(error);
      }

      const availability = catalogItemId === null
        ? {
            catalogItemId: null,
            warehouseId: context.teamWarehouseId,
            inventoryId: null,
            availableQuantity: 0,
            unit: null,
            lotsRequired: false,
            ambiguous: false,
          }
        : await currentInventoryAdapter.getCatalogAvailability(
            catalogItemId,
            context.teamWarehouseId,
          );
      if (availability.ambiguous) {
        throw new Pmv2MaterialFlowError(
          "توجد أكثر من بطاقة مخزون لنفس المادة في مخزن الفريق؛ يلزم تصحيح هوية المخزون قبل تقرير التوفر",
        );
      }

      if (
        catalogItemId !== null &&
        availability.inventoryId &&
        availability.unit &&
        normalizeUnit(availability.unit) !== normalizeUnit(unit)
      ) {
        throw new Pmv2MaterialFlowError(
          `وحدة الصرف الحالية للمادة في مخزن الفريق هي ${availability.unit}؛ استخدم نفس الوحدة لتحديد الكمية`,
        );
      }

      const availableQuantity = catalogItemId === null
        ? 0
        : Math.max(0, Number(availability.availableQuantity || 0));
      if (catalogItemId !== null && availableQuantity >= quantity) {
        const routeDecisionActionId = await writeRouteDecision({
          version: 1,
          route: "team_inventory",
          catalogItemId,
          itemNameSnapshot,
          requestedQuantity: quantity,
          unit,
          teamWarehouseId: context.teamWarehouseId,
          inventoryId: availability.inventoryId,
          availableQuantity,
          shortageQuantity: 0,
          lotsRequired: availability.lotsRequired,
          materialRequestId: null,
          materialRequestItemId: null,
        });

        await writePmv2AuditWithDb(tx, {
          actorUserId: userId,
          action: "material_need_routed_team_inventory",
          entity: "task_item",
          entityId: input.taskItemId,
          newValues: {
            taskId: input.taskId,
            catalogItemId,
            requestedQuantity: quantity,
            unit,
            teamId: context.teamId,
            teamWarehouseId: context.teamWarehouseId,
            inventoryId: availability.inventoryId,
            availableQuantity,
            lotsRequired: availability.lotsRequired,
            materialRequestCreated: false,
          },
          ipAddress: auditContext?.ipAddress,
          userAgent: auditContext?.userAgent,
        });

        return {
          route: "team_inventory" as const,
          taskId: input.taskId,
          taskItemId: input.taskItemId,
          catalogItem: catalogItem!,
          requestedQuantity: quantity,
          unit,
          teamWarehouse: warehouse!,
          inventoryId: availability.inventoryId,
          availableQuantity,
          lotsRequired: availability.lotsRequired,
          materialRequestCreated: false,
          routeDecisionActionId,
        };
      }

      const existingActive = await tx
        .select({
          requestId: pmv2MaterialRequests.id,
          requestItemId: pmv2MaterialRequestItems.id,
          catalogItemId: pmv2MaterialRequestItems.catalogItemId,
          itemNameSnapshot: pmv2MaterialRequestItems.itemNameSnapshot,
          status: pmv2MaterialRequestItems.status,
        })
        .from(pmv2MaterialRequestItems)
        .innerJoin(
          pmv2MaterialRequests,
          eq(pmv2MaterialRequests.id, pmv2MaterialRequestItems.requestId),
        )
        .where(
          and(
            eq(pmv2MaterialRequests.taskItemId, input.taskItemId),
            catalogItemId === null
              ? isNull(pmv2MaterialRequestItems.catalogItemId)
              : eq(pmv2MaterialRequestItems.catalogItemId, catalogItemId),
            notInArray(pmv2MaterialRequestItems.status, ["consumed", "cancelled"]),
          ),
        )
        .orderBy(desc(pmv2MaterialRequestItems.id));
      const duplicate = catalogItemId === null
        ? existingActive.find(
            (row: any) => normalizeItemName(row.itemNameSnapshot) === normalizeItemName(itemNameSnapshot),
          )
        : existingActive[0];
      if (duplicate) {
        throw new Pmv2MaterialFlowError(
          "يوجد بالفعل طلب مواد فعال لهذه المادة على نفس البند؛ راجع الطلب الحالي بدل إنشاء طلب مكرر",
        );
      }

      const shortageQuantity = catalogItemId === null
        ? Number(quantity.toFixed(3))
        : Number((quantity - availableQuantity).toFixed(3));
      const requestInsert = await tx.insert(pmv2MaterialRequests).values({
        taskItemId: input.taskItemId,
        visitId: needAction.visitId,
        requestedById: userId,
        teamId: context.teamId,
        teamWarehouseId: context.teamWarehouseId,
      });
      const requestId = Number(requestInsert[0]?.insertId || 0);
      if (!requestId) throw new Error("تعذر تحديد رقم طلب المواد الجديد");

      let itemWrite;
      try {
        itemWrite = validatePmv2MaterialRequestItemWrite({
          requestId,
          catalogItemId,
          itemNameSnapshot,
          requestedQuantity: shortageQuantity,
          unitSnapshot: unit,
          status: "waiting_warehouse",
          receivedWarehouseQuantity: 0,
          issuedToTeamQuantity: 0,
        });
      } catch (error) {
        mapIntegrationError(error);
      }

      const requestItemInsert = await tx.insert(pmv2MaterialRequestItems).values(itemWrite!);
      const materialRequestItemId = Number(requestItemInsert[0]?.insertId || 0);
      if (!materialRequestItemId) throw new Error("تعذر تحديد رقم بند طلب المواد الجديد");

      const routeDecisionActionId = await writeRouteDecision({
        version: 1,
        route: "material_request",
        catalogItemId,
        itemNameSnapshot,
        requestedQuantity: quantity,
        unit,
        teamWarehouseId: context.teamWarehouseId,
        inventoryId: availability.inventoryId,
        availableQuantity: catalogItemId === null ? null : availableQuantity,
        shortageQuantity,
        lotsRequired: availability.lotsRequired,
        materialRequestId: requestId,
        materialRequestItemId,
      });

      await writePmv2AuditWithDb(tx, {
        actorUserId: userId,
        action: "material_request_created",
        entity: "material_request",
        entityId: requestId,
        newValues: {
          taskId: input.taskId,
          taskItemId: input.taskItemId,
          visitId: needAction.visitId,
          materialRequestItemId,
          catalogItemId,
          itemNameSnapshot,
          unlistedCatalogItem: catalogItemId === null,
          requestedTotalQuantity: quantity,
          availabilityChecked: catalogItemId !== null,
          availableTeamQuantity: catalogItemId === null ? null : availableQuantity,
          shortageQuantity,
          unit,
          teamId: context.teamId,
          teamWarehouseId: context.teamWarehouseId,
          status: "waiting_warehouse",
        },
        ipAddress: auditContext?.ipAddress,
        userAgent: auditContext?.userAgent,
      });

      return {
        route: "material_request" as const,
        taskId: input.taskId,
        taskItemId: input.taskItemId,
        catalogItem,
        itemNameSnapshot,
        unlistedCatalogItem: catalogItemId === null,
        requestedQuantity: quantity,
        unit,
        teamWarehouse: warehouse!,
        inventoryId: availability.inventoryId,
        availableQuantity: catalogItemId === null ? null : availableQuantity,
        shortageQuantity,
        lotsRequired: availability.lotsRequired,
        materialRequestCreated: true,
        requestId,
        materialRequestItemId,
        routeDecisionActionId,
        requestStatus: "waiting_warehouse" as const,
      };
    });
    if (result.route === "material_request" && result.materialRequestItemId) {
      await queuePmv2Translation("PMV2_MATERIAL_REQUEST_ITEM", result.materialRequestItemId, [
        ["itemNameSnapshot", result.itemNameSnapshot],
      ]);
    }
    return result;
  }
}

export const pmv2MaterialRequestService = new Pmv2MaterialRequestService();

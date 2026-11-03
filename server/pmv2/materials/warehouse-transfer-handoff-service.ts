import { and, eq, sql } from "drizzle-orm";
import {
  pmv2ItemActions,
  pmv2MaterialRequestItems,
  pmv2MaterialRequests,
  pmv2TaskItems,
  pmv2Tasks,
} from "../../../drizzle/schema";
import { getDb } from "../../_core/db/client";
import {
  currentCatalogAdapter,
  currentInventoryAdapter,
  currentWarehouseAdapter,
  currentWarehouseTransferAdapter,
  Pmv2ExternalReferenceError,
} from "../adapters/current-system";
import { writePmv2AuditWithDb } from "../audit/service";
import { validatePmv2MaterialRequestItemWrite } from "./request-item-validation";
import { loadPmv2Replacements, loadPmv2ReplacementStock, replacementForPhysicalLot,planPmv2Fulfillment } from "./replacement-coverage";

const MATERIAL_TRANSFER_LINK_ACTION = "material_transfer_linked";
const MAX_TRANSFER_NUMBERS_PER_LINK = 20;

export class Pmv2WarehouseTransferHandoffError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "Pmv2WarehouseTransferHandoffError";
  }
}

type MaterialTransferLinkSnapshot = {
  version: 1;
  materialRequestItemId: number;
  transferId: number;
  transferNumber: string;
  batchId: number | null;
  quantity: number;
  fromWarehouseId: number;
  toWarehouseId: number;
  catalogItemId: number;
  originalQuantity?: number;
  replacementPlanId?: number;
  unit?: string;
};

function normalizeUnit(value: string | null | undefined) {
  return String(value || "").trim().toLocaleLowerCase();
}

function roundQuantity(value: number) {
  return Number(Math.max(0, value).toFixed(3));
}

function parseTransferLinkSnapshot(note: string | null | undefined): MaterialTransferLinkSnapshot | null {
  if (!note) return null;
  try {
    const value = JSON.parse(note) as Partial<MaterialTransferLinkSnapshot>;
    if (
      value.version !== 1 ||
      !Number.isInteger(value.materialRequestItemId) ||
      Number(value.materialRequestItemId) <= 0 ||
      !Number.isInteger(value.transferId) ||
      Number(value.transferId) <= 0 ||
      typeof value.transferNumber !== "string" ||
      !value.transferNumber.trim() ||
      !Number.isFinite(Number(value.quantity)) ||
      Number(value.quantity) <= 0 ||
      !Number.isInteger(value.fromWarehouseId) ||
      !Number.isInteger(value.toWarehouseId) ||
      !Number.isInteger(value.catalogItemId)
    ) {
      return null;
    }
    if (value.originalQuantity != null && (!Number.isFinite(Number(value.originalQuantity)) || Number(value.originalQuantity)<=0 || !Number.isSafeInteger(value.replacementPlanId) || Number(value.replacementPlanId)<=0 || !value.unit)) return null;
    return {
      version: 1,
      materialRequestItemId: Number(value.materialRequestItemId),
      transferId: Number(value.transferId),
      transferNumber: value.transferNumber.trim(),
      batchId: value.batchId == null ? null : Number(value.batchId),
      quantity: Number(value.quantity),
      fromWarehouseId: Number(value.fromWarehouseId),
      toWarehouseId: Number(value.toWarehouseId),
      catalogItemId: Number(value.catalogItemId),
      ...(value.originalQuantity != null && { originalQuantity: Number(value.originalQuantity), replacementPlanId: Number(value.replacementPlanId), unit: String(value.unit ?? "") }),
    };
  } catch {
    return null;
  }
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
      receivedWarehouseQuantity: pmv2MaterialRequestItems.receivedWarehouseQuantity,
      issuedToTeamQuantity: pmv2MaterialRequestItems.issuedToTeamQuantity,
      taskItemId: pmv2MaterialRequests.taskItemId,
      visitId: pmv2MaterialRequests.visitId,
      teamWarehouseId: pmv2MaterialRequests.teamWarehouseId,
      taskId: pmv2TaskItems.taskId,
      taskNumber: pmv2Tasks.taskNumber,
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
    .where(eq(pmv2MaterialRequestItems.id, requestItemId))
    .limit(1);
  return rows[0] ?? null;
}

function mapExternalReferenceError(error: unknown): never {
  if (error instanceof Pmv2ExternalReferenceError) {
    throw new Pmv2WarehouseTransferHandoffError(error.message);
  }
  throw error;
}

/**
 * Phase 4 / Step 4.2B integration boundary.
 *
 * This service never moves stock. `prepareTransferHandoff` only rechecks the
 * current Main-Warehouse state before sending the operator to the existing
 * Warehouse Transfer screen. `linkConfirmedTransfers` accepts only real
 * transfer numbers already created by that workflow, validates them against
 * the PM V2 need, and then projects their confirmed quantity into PM V2.
 */
export class Pmv2WarehouseTransferHandoffService {
  async prepareTransferHandoff(requestItemId: number) {
    if (!Number.isInteger(requestItemId) || requestItemId <= 0) {
      throw new Pmv2WarehouseTransferHandoffError("بند طلب المواد غير صالح");
    }

    const db = await requireDb();
    const context = await loadRequestItemContext(db, requestItemId);
    if (!context) {
      throw new Pmv2WarehouseTransferHandoffError("بند طلب المواد غير موجود");
    }
    if (context.status !== "waiting_warehouse") {
      throw new Pmv2WarehouseTransferHandoffError("بند طلب المواد لم يعد بانتظار تحويل المستودع");
    }
    if (context.catalogItemId == null) {
      throw new Pmv2WarehouseTransferHandoffError("لا يمكن بدء تحويل قبل ربط المادة بصنف معروف في الدليل");
    }
    const replacements=(await loadPmv2Replacements(db,[requestItemId])).get(requestItemId)??[];

    let mainWarehouse;
    let teamWarehouse;
    let catalogItem;
    try {
      [mainWarehouse, teamWarehouse, catalogItem] = await Promise.all([
        currentWarehouseAdapter.requireSingleActiveMainWarehouse(),
        currentWarehouseAdapter.requireActiveWarehouse(context.teamWarehouseId),
        replacements.length ? currentCatalogAdapter.getItemsByIds([context.catalogItemId]).then(items=>items[0]??{nameAr:context.itemNameSnapshot,nameEn:"",unit:context.unitSnapshot,isActive:false}) : currentCatalogAdapter.requireActiveItem(context.catalogItemId),
      ]);
    } catch (error) {
      mapExternalReferenceError(error);
    }

    const availability = catalogItem!.isActive ? await currentInventoryAdapter.getCatalogAvailability(
      context.catalogItemId,
      mainWarehouse!.id,
    ) : {catalogItemId:context.catalogItemId,warehouseId:mainWarehouse!.id,inventoryId:null,availableQuantity:0,unit:context.unitSnapshot,lotsRequired:true,ambiguous:false};
    if (availability.ambiguous) {
      throw new Pmv2WarehouseTransferHandoffError(
        "توجد أكثر من بطاقة مخزون لنفس الصنف في المستودع الرئيسي؛ صحح الهوية قبل التحويل",
      );
    }
    if (
      availability.unit &&
      context.unitSnapshot &&
      normalizeUnit(availability.unit) !== normalizeUnit(context.unitSnapshot)
    ) {
      throw new Pmv2WarehouseTransferHandoffError(
        "وحدة المخزون الحالية لا تطابق وحدة طلب PM V2؛ لا يمكن بدء التحويل",
      );
    }

    const requestedQuantity = Number(context.requestedQuantity || 0);
    const issuedToTeamQuantity = Number(context.issuedToTeamQuantity || 0);
    const remainingQuantity = roundQuantity(requestedQuantity - issuedToTeamQuantity);
    const replacementCatalogs=await currentCatalogAdapter.getItemsByIds(replacements.map(({plan})=>plan.catalogItemId));
    if(replacements.some(({plan})=>!replacementCatalogs.some(item=>item.id===plan.catalogItemId&&item.isActive))) throw new Pmv2WarehouseTransferHandoffError("صنف البديل غير نشط حاليًا؛ راجع تعريف الصنف قبل التحويل");
    const stock=await loadPmv2ReplacementStock(db,replacements,[mainWarehouse!.id]);
    const replacementLotIds=new Set(replacements.flatMap(({plan})=>plan.lots.map(lot=>lot.lotId)));
    const originalLots=availability.inventoryId ? (await currentInventoryAdapter.listAvailableLots(availability.inventoryId)).filter(lot=>!replacementLotIds.has(lot.id)) : [];
    const previousRows=await db.select({note:pmv2ItemActions.note}).from(pmv2ItemActions).where(and(eq(pmv2ItemActions.taskItemId,context.taskItemId),eq(pmv2ItemActions.action,MATERIAL_TRANSFER_LINK_ACTION)));
    const previous=previousRows.map((row:any)=>parseTransferLinkSnapshot(row.note)).filter((link:any)=>link?.materialRequestItemId===requestItemId);
    const fulfillment=planPmv2Fulfillment({requiredOriginal:remainingQuantity,originalUnit:String(context.unitSnapshot),originalStock:originalLots.map(lot=>({lotId:lot.id,inventoryId:availability.inventoryId!,warehouseId:mainWarehouse!.id,catalogItemId:context.catalogItemId!,unit:String(availability.unit||context.unitSnapshot),quantity:lot.quantity,lotCode:lot.lotCode,trackingToken:lot.trackingToken})),replacements:replacements.map(replacement=>({replacement,stock:replacement.plan.lots.map(lot=>stock.get(`${mainWarehouse!.id}:${lot.lotId}`)).filter((lot):lot is NonNullable<typeof lot>=>!!lot),alreadyAllocated:previous.filter((link:any)=>link.replacementPlanId===replacement.plan.planId).reduce((sum:number,link:any)=>sum+Number(link.originalQuantity??0),0)}))});
    const fulfillmentAllocations=fulfillment.allocations.map(part=>({sourceInventoryId:part.inventoryId,catalogItemId:part.catalogItemId,materialName:part.replacementPlanId?replacements.find(({plan})=>plan.planId===part.replacementPlanId)!.plan.itemName:context.itemNameSnapshot,quantity:part.quantity,unit:part.unit,originalQuantity:part.originalQuantity,lotId:part.lotId,lotCode:part.lotCode,trackingToken:part.trackingToken,
      allowedLotIds:part.replacementPlanId?replacements.find(({plan})=>plan.planId===part.replacementPlanId)!.plan.lots.map(lot=>lot.lotId):originalLots.map(lot=>lot.id),
      ...(part.replacementPlanId?{replacementPlanId:part.replacementPlanId}:{})}));
    const availableQuantity=fulfillment.availableOriginal;
    const transferableNow=fulfillment.complete?remainingQuantity:0;

    if (remainingQuantity <= 0) {
      throw new Pmv2WarehouseTransferHandoffError("تم تغطية كمية هذا الطلب بالفعل");
    }
    if(!fulfillment.complete&&fulfillment.unrepresentable) throw new Pmv2WarehouseTransferHandoffError("أرصدة لوتات البديل لا تحقق نسبة التعويض المعتمدة بوحدات صحيحة؛ راجع توزيع اللوتات والكمية دون تقريب");
    if (availableQuantity <= 0) {
      throw new Pmv2WarehouseTransferHandoffError("لا توجد كمية قابلة للتحويل من المستودع الرئيسي حاليًا؛ استخدم مسار شراء العجز");
    }
    if (availableQuantity + 0.0005 < remainingQuantity) {
      throw new Pmv2WarehouseTransferHandoffError(
        `المستودع الرئيسي لا يغطي كامل النقص (${remainingQuantity})؛ لا يبدأ PM V2 تحويلًا جزئيًا افتراضيًا. استخدم مسار شراء العجز أولًا`,
      );
    }

    return {
      requestItemId: context.requestItemId,
      requestId: context.requestId,
      taskItemId: context.taskItemId,
      taskNumber: context.taskNumber,
      catalogItemId: context.catalogItemId,
      materialName: context.itemNameSnapshot || catalogItem!.nameAr || catalogItem!.nameEn,
      unit: context.unitSnapshot || availability.unit || catalogItem!.unit || null,
      requestedQuantity,
      issuedToTeamQuantity,
      remainingQuantity,
      availableQuantity,
      transferableNow,
      sourceWarehouse: mainWarehouse!,
      destinationWarehouse: teamWarehouse!,
      sourceInventoryId: availability.inventoryId ?? fulfillmentAllocations[0]?.sourceInventoryId ?? null,
      lotsRequired: availability.lotsRequired,
      fulfillmentAllocations,
    };
  }

  async linkConfirmedTransfers(
    actorUserId: number,
    input: { requestItemId: number; transferNumbers: string[] },
    auditContext?: { ipAddress?: string; userAgent?: string },
  ) {
    const requestItemId = Number(input.requestItemId);
    if (!Number.isInteger(requestItemId) || requestItemId <= 0) {
      throw new Pmv2WarehouseTransferHandoffError("بند طلب المواد غير صالح");
    }
    const transferNumbers = [
      ...new Set(
        (input.transferNumbers || [])
          .map((value) => String(value || "").trim())
          .filter(Boolean),
      ),
    ];
    if (transferNumbers.length === 0) {
      throw new Pmv2WarehouseTransferHandoffError("رقم التحويل المؤكد مطلوب");
    }
    if (transferNumbers.length > MAX_TRANSFER_NUMBERS_PER_LINK) {
      throw new Pmv2WarehouseTransferHandoffError("عدد التحويلات المطلوب ربطها أكبر من الحد المسموح");
    }

    const db = await requireDb();
    const initialContext = await loadRequestItemContext(db, requestItemId);
    if (!initialContext) {
      throw new Pmv2WarehouseTransferHandoffError("بند طلب المواد غير موجود");
    }
    if (initialContext.catalogItemId == null) {
      throw new Pmv2WarehouseTransferHandoffError("لا يمكن ربط تحويل بمادة غير معروفة في الدليل");
    }
    if (initialContext.status !== "waiting_warehouse" && initialContext.status !== "issued_to_team") {
      throw new Pmv2WarehouseTransferHandoffError("حالة بند طلب المواد لا تسمح بربط تحويل مستودع في هذه الخطوة");
    }

    let mainWarehouse;
    let teamWarehouse;
    try {
      [mainWarehouse, teamWarehouse] = await Promise.all([
        currentWarehouseAdapter.requireSingleActiveMainWarehouse(),
        currentWarehouseAdapter.requireActiveWarehouse(initialContext.teamWarehouseId),
      ]);
    } catch (error) {
      mapExternalReferenceError(error);
    }

    const transfers = await currentWarehouseTransferAdapter.getTransfersByNumbers(transferNumbers);
    const transferByNumber = new Map(transfers.map((transfer) => [transfer.transferNumber, transfer]));
    const missingNumbers = transferNumbers.filter((number) => !transferByNumber.has(number));
    if (missingNumbers.length > 0) {
      throw new Pmv2WarehouseTransferHandoffError(
        `لم يتم العثور على تحويل مستودع مؤكد بالأرقام: ${missingNumbers.join(", ")}`,
      );
    }

    for (const transfer of transfers) {
      if (transfer.fromWarehouseId !== mainWarehouse!.id) {
        throw new Pmv2WarehouseTransferHandoffError(
          `التحويل ${transfer.transferNumber} لم يبدأ من المستودع الرئيسي المعتمد`,
        );
      }
      if (transfer.toWarehouseId !== teamWarehouse!.id) {
        throw new Pmv2WarehouseTransferHandoffError(
          `التحويل ${transfer.transferNumber} لا يتجه إلى مخزن الفريق المرتبط بالطلب`,
        );
      }
      if (!Number.isFinite(transfer.quantity) || transfer.quantity <= 0) {
        throw new Pmv2WarehouseTransferHandoffError(
          `كمية التحويل ${transfer.transferNumber} غير صالحة`,
        );
      }
    }

    return db.transaction(async (tx: any) => {
      const context = await loadRequestItemContext(tx, requestItemId);
      if (!context) {
        throw new Pmv2WarehouseTransferHandoffError("بند طلب المواد غير موجود");
      }
      if (context.catalogItemId !== initialContext.catalogItemId || context.teamWarehouseId !== initialContext.teamWarehouseId) {
        throw new Pmv2WarehouseTransferHandoffError("تغيرت هوية طلب المواد أثناء الربط؛ حدّث الشاشة وحاول مرة أخرى");
      }

      const linkRows = await tx
        .select({ id: pmv2ItemActions.id, note: pmv2ItemActions.note })
        .from(pmv2ItemActions)
        .where(eq(pmv2ItemActions.action, MATERIAL_TRANSFER_LINK_ACTION));

      const linkedByTransferId = new Map<number, MaterialTransferLinkSnapshot>();
      const linkedForRequest = new Map<number, MaterialTransferLinkSnapshot>();
      for (const row of linkRows) {
        const snapshot = parseTransferLinkSnapshot(row.note);
        if (!snapshot) continue;
        if (!linkedByTransferId.has(snapshot.transferId)) {
          linkedByTransferId.set(snapshot.transferId, snapshot);
        }
        if (
          snapshot.materialRequestItemId === requestItemId &&
          !linkedForRequest.has(snapshot.transferId)
        ) {
          linkedForRequest.set(snapshot.transferId, snapshot);
        }
      }

      for (const transfer of transfers) {
        const existing = linkedByTransferId.get(transfer.id);
        if (existing && existing.materialRequestItemId !== requestItemId) {
          throw new Pmv2WarehouseTransferHandoffError(
            `التحويل ${transfer.transferNumber} مرتبط مسبقًا بطلب مواد PM V2 آخر`,
          );
        }
      }

      const newlyLinked: MaterialTransferLinkSnapshot[] = [];
      const replacements = (await loadPmv2Replacements(tx, [requestItemId])).get(requestItemId) ?? [];
      for (const transfer of transfers) {
        if (linkedForRequest.has(transfer.id)) continue;
        let replacementCoverage: { originalQuantity: number; replacementPlanId: number; unit: string } | undefined;
        if (replacements.some(({plan})=>plan.lots.some(lot=>lot.lotId===transfer.inventoryLotId)) || transfer.catalogItemId !== context.catalogItemId || normalizeUnit(transfer.unit) !== normalizeUnit(context.unitSnapshot)) {
          await tx.execute(sql`SELECT id FROM warehouse_transfers WHERE id=${transfer.id} FOR UPDATE`);
          const coverage = replacementForPhysicalLot(replacements, { lotId: transfer.inventoryLotId ?? null, catalogItemId: transfer.catalogItemId, unit: transfer.unit, quantity: transfer.quantity });
          const alreadyCovered = Array.from(linkedForRequest.values()).filter(link=>link.replacementPlanId===coverage.replacement.plan.planId).reduce((sum,link)=>sum+Number(link.originalQuantity ?? 0),0);
          if (alreadyCovered+coverage.originalQuantity>coverage.replacement.maximumOriginalQuantity+0.0005) throw new Pmv2WarehouseTransferHandoffError("سبق تخصيص كمية هذا البديل لاحتياج PMV2");
          replacementCoverage = { originalQuantity: coverage.originalQuantity, replacementPlanId: coverage.replacement.plan.planId, unit: String(transfer.unit) };
        }
        const snapshot: MaterialTransferLinkSnapshot = {
          version: 1,
          materialRequestItemId: requestItemId,
          transferId: transfer.id,
          transferNumber: transfer.transferNumber,
          batchId: transfer.batchId,
          quantity: roundQuantity(transfer.quantity),
          fromWarehouseId: transfer.fromWarehouseId,
          toWarehouseId: transfer.toWarehouseId,
          catalogItemId: transfer.catalogItemId!,
          ...replacementCoverage,
        };
        await tx.insert(pmv2ItemActions).values({
          taskItemId: context.taskItemId,
          visitId: context.visitId,
          action: MATERIAL_TRANSFER_LINK_ACTION,
          result: null,
          note: JSON.stringify(snapshot),
          performedById: actorUserId,
        });
        linkedForRequest.set(transfer.id, snapshot);
        linkedByTransferId.set(transfer.id, snapshot);
        newlyLinked.push(snapshot);
      }

      const requestedQuantity = Number(context.requestedQuantity || 0);
      const confirmedQuantity = roundQuantity(
        Array.from(linkedForRequest.values()).reduce(
          (sum, snapshot) => sum + Number(snapshot.originalQuantity ?? snapshot.quantity ?? 0),
          0,
        ),
      );
      const projectedIssuedQuantity = roundQuantity(
        Math.min(requestedQuantity, confirmedQuantity),
      );
      const nextStatus = projectedIssuedQuantity >= requestedQuantity
        ? "issued_to_team"
        : "waiting_warehouse";

      const write = validatePmv2MaterialRequestItemWrite({
        requestId: context.requestId,
        catalogItemId: context.catalogItemId,
        itemNameSnapshot: context.itemNameSnapshot,
        requestedQuantity,
        unitSnapshot: context.unitSnapshot,
        status: nextStatus,
        receivedWarehouseQuantity: Number(context.receivedWarehouseQuantity || 0),
        issuedToTeamQuantity: projectedIssuedQuantity,
      });

      const oldIssuedQuantity = Number(context.issuedToTeamQuantity || 0);
      const changed =
        newlyLinked.length > 0 ||
        oldIssuedQuantity !== projectedIssuedQuantity ||
        context.status !== nextStatus;

      if (changed) {
        await tx
          .update(pmv2MaterialRequestItems)
          .set({
            issuedToTeamQuantity: write.issuedToTeamQuantity,
            status: write.status,
          })
          .where(eq(pmv2MaterialRequestItems.id, requestItemId));

        await writePmv2AuditWithDb(tx, {
          actorUserId,
          action: "material_transfer_linked",
          entity: "material_request_item",
          entityId: requestItemId,
          oldValues: {
            status: context.status,
            issuedToTeamQuantity: oldIssuedQuantity,
          },
          newValues: {
            status: write.status,
            requestedQuantity,
            issuedToTeamQuantity: write.issuedToTeamQuantity,
            remainingQuantity: roundQuantity(requestedQuantity - write.issuedToTeamQuantity),
            newlyLinkedTransfers: newlyLinked.map((snapshot) => ({
              transferId: snapshot.transferId,
              transferNumber: snapshot.transferNumber,
              quantity: snapshot.quantity,
            })),
            confirmedTransferCount: linkedForRequest.size,
          },
          ipAddress: auditContext?.ipAddress,
          userAgent: auditContext?.userAgent,
        });
      }

      return {
        requestItemId,
        requestId: context.requestId,
        taskItemId: context.taskItemId,
        requestedQuantity,
        issuedToTeamQuantity: write.issuedToTeamQuantity,
        remainingQuantity: roundQuantity(requestedQuantity - write.issuedToTeamQuantity),
        status: write.status,
        newlyLinkedTransfers: newlyLinked,
        confirmedTransferCount: linkedForRequest.size,
        idempotent: !changed,
      };
    });
  }
}

export const pmv2WarehouseTransferHandoffService = new Pmv2WarehouseTransferHandoffService();

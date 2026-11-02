import { canUserExecuteAllPmv2Teams, pmv2ExecutionActor, pmv2ExecutionActorCondition, pmv2ExecutionTeamCondition } from "../security/execution-access";
import { selectFullIssueLots, type WarehouseLotSelection, type WarehouseLotOption } from "../../../shared/warehouse-lot-selection";
import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import {
  pmv2ItemActions,
  pmv2MaterialRequestItems,
  pmv2MaterialUsages,
  pmv2ProgramTargets,
  pmv2TaskItems,
  pmv2Tasks,
  pmv2TeamMembers,
  pmv2Teams,
  users,
  catalogItems,
} from "../../../drizzle/schema";
import { getDb } from "../../_core/db/client";
import {
  currentCatalogAdapter,
  currentDeliveryAdapter,
  currentInventoryAdapter,
  currentInventoryIssueAdapter,
  currentMaintenanceTargetAdapter,
  currentRecipientReturnAdapter,
} from "../adapters/current-system";
import { writePmv2AuditWithDb } from "../audit/service";
import { validatePmv2MaterialUsageWrite } from "./usage-validation";
import { getPmv2MaterialQuantityValidationMessage } from "../../../shared/pmv2MaterialQuantity";
import { PMV2_ALL_TEAM_EXECUTION_ROLES, PMV2_TECHNICIAN_EXECUTION_ROLES, canRoleExecuteAllPmv2Teams } from "../../../shared/roles";
import { loadPmv2Replacements, loadPmv2ReplacementStock, replacementForPhysicalLot, originalEquivalent, physicalEquivalent,validatePmv2PhysicalUsage,settlePmv2PhysicalConsumption,planPmv2Fulfillment } from "./replacement-coverage";

const MATERIAL_ROUTE_DECISION_ACTION = "material_route_decision";
const MATERIAL_ISSUE_LINK_ACTION = "material_issue_linked";
const MATERIAL_ISSUE_LINK_PENDING_ACTION = "material_issue_link_pending";
const MATERIAL_CONSUMPTION_DECLARED_ACTION = "material_consumption_declared";
const MATERIAL_RETURN_PART_LINKED_ACTION = "material_return_part_linked";
const MATERIAL_CONSUMPTION_FINALIZED_ACTION = "material_consumption_finalized";
const MATERIAL_RETURN_COMPLETED_ACTION = "material_return_completed";

export class Pmv2TeamIssueHandoffError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "Pmv2TeamIssueHandoffError";
  }
}

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

type RequirementContext = MaterialRouteDecisionSnapshot & {
  routeDecisionActionId: number;
  requesterUserId: number;
  visitId: number;
  taskId: number;
  taskNumber: string;
  taskStatus: string;
  programTargetId: number;
  taskItemId: number;
  taskItemTitle: string;
  itemStatus: string;
  itemResult: string | null;
  teamId: number;
  teamCode: string;
};

type IssueActionNote = {
  version: 2;
  routeDecisionActionId: number;
  materialRequestItemId: number | null;
  deliveryDocumentId: number;
  deliveryNumber: string;
  inventoryTransactionId: number;
  inventoryLotId: number | null;
  lotCode: string | null;
  inventoryId: number;
  warehouseId: number;
  catalogItemId: number;
  quantity: number;
  generalStockQuantity: number;
  materialRequestQuantity: number;
  requiredQuantity: number;
  requesterUserId: number;
  recipientUserId: number;
  unit: string;
  originalQuantity?: number;
  replacementPlanId?: number;
  replacementItemName?:string;
};

type PendingIssueLinkNote = {
  version: 1;
  routeDecisionActionId: number;
  deliveryDocumentId: number | null;
  deliveryNumber: string;
  quantity: number;
  lotId: number | null;
  lotCode: string | null;
  recipientUserId: number;
  errorMessage: string;
};

type ConsumptionDeclarationNote = {
  version: 1;
  routeDecisionActionId: number;
  catalogItemId: number;
  materialRequestItemId: number | null;
  requiredQuantity: number;
  issuedQuantity: number;
  usedQuantity: number | null;
  toReturnQuantity: number | null;
  unit: string;
  declaredById: number;
  physicalUsages?:Array<{deliveryDocumentId:number;usedQuantity:number}>;
  physicalMode?:true;
};

type ReturnPartNote = {
  version: 1;
  declarationActionId: number;
  routeDecisionActionId: number;
  sourceDeliveryDocumentId: number;
  returnId: number;
  returnNumber: string;
  lotId: number;
  lotCode: string | null;
  quantity: number;
  originalQuantity?: number;
};

type Pmv2ItemStatus = "pending" | "in_progress" | "waiting_material" | "waiting_ticket" | "ready_to_complete" | "completed";

function roundQuantity(value: number) {
  return Number(Math.max(0, Number(value || 0)).toFixed(3));
}

function normalizeUnit(value: string | null | undefined) {
  return String(value || "").trim().toLocaleLowerCase();
}

function deriveTaskStatus(itemStatuses: Pmv2ItemStatus[]) {
  if (itemStatuses.length > 0 && itemStatuses.every((status) => status === "completed")) return "completed";
  if (itemStatuses.includes("waiting_material")) return "waiting_material";
  if (itemStatuses.includes("waiting_ticket")) return "waiting_ticket";
  if (itemStatuses.includes("in_progress")) return "in_progress";
  if (itemStatuses.includes("ready_to_complete")) return "ready_to_complete";
  if (itemStatuses.includes("completed")) return "in_progress";
  return "pending";
}

function parseJson<T>(note: string | null | undefined): T | null {
  if (!note) return null;
  try { return JSON.parse(note) as T; } catch { return null; }
}

function parseMaterialRouteDecision(note: string | null | undefined): MaterialRouteDecisionSnapshot | null {
  const parsed = parseJson<Partial<MaterialRouteDecisionSnapshot>>(note);
  if (!parsed || parsed.version !== 1) return null;
  if (parsed.route !== "team_inventory" && parsed.route !== "material_request") return null;
  if (parsed.catalogItemId != null && (!Number.isInteger(Number(parsed.catalogItemId)) || Number(parsed.catalogItemId) <= 0)) return null;
  const requestedQuantity = Number(parsed.requestedQuantity);
  const teamWarehouseId = Number(parsed.teamWarehouseId || 0);
  if (!Number.isFinite(requestedQuantity) || requestedQuantity <= 0 || !Number.isInteger(teamWarehouseId) || teamWarehouseId <= 0) return null;
  if (!parsed.itemNameSnapshot || (parsed.catalogItemId != null && !parsed.unit)) return null;
  return {
    version: 1,
    route: parsed.route,
    catalogItemId: parsed.catalogItemId == null ? null : Number(parsed.catalogItemId),
    itemNameSnapshot: String(parsed.itemNameSnapshot),
    requestedQuantity: roundQuantity(requestedQuantity),
    unit: String(parsed.unit || ""),
    teamWarehouseId,
    inventoryId: parsed.inventoryId == null ? null : Number(parsed.inventoryId),
    availableQuantity: parsed.availableQuantity == null ? null : Number(parsed.availableQuantity),
    shortageQuantity: roundQuantity(Number(parsed.shortageQuantity || 0)),
    lotsRequired: Boolean(parsed.lotsRequired),
    materialRequestId: parsed.materialRequestId == null ? null : Number(parsed.materialRequestId),
    materialRequestItemId: parsed.materialRequestItemId == null ? null : Number(parsed.materialRequestItemId),
  };
}

function parseIssueNote(note: string | null | undefined): IssueActionNote | null {
  const parsed = parseJson<Partial<IssueActionNote>>(note);
  if (!parsed || parsed.version !== 2 || !parsed.deliveryDocumentId || !parsed.routeDecisionActionId || !parsed.catalogItemId) return null;
  return parsed as IssueActionNote;
}

function parsePendingIssueLinkNote(note: string | null | undefined): PendingIssueLinkNote | null {
  const parsed = parseJson<Partial<PendingIssueLinkNote>>(note);
  if (!parsed || parsed.version !== 1 || !parsed.routeDecisionActionId || !parsed.deliveryNumber) return null;
  return parsed as PendingIssueLinkNote;
}

function parseDeclarationNote(note: string | null | undefined): ConsumptionDeclarationNote | null {
  const parsed = parseJson<Partial<ConsumptionDeclarationNote>>(note);
  if (!parsed || parsed.version !== 1 || !parsed.routeDecisionActionId || !parsed.catalogItemId) return null;
  return parsed as ConsumptionDeclarationNote;
}

function parseReturnPartNote(note: string | null | undefined): ReturnPartNote | null {
  const parsed = parseJson<Partial<ReturnPartNote>>(note);
  if (!parsed || parsed.version !== 1 || !parsed.declarationActionId || !parsed.sourceDeliveryDocumentId || !parsed.returnId) return null;
  return parsed as ReturnPartNote;
}

async function requireDb() {
  const db = await getDb();
  if (!db) throw new Error("تعذر الاتصال بقاعدة البيانات");
  return db;
}

async function listActiveTeamTechnicians(db: any, teamIds: number[]) {
  if (teamIds.length === 0) return [];
  return db.select({ teamId: pmv2TeamMembers.teamId, userId: users.id, userName: users.name })
    .from(pmv2TeamMembers)
    .innerJoin(users, eq(users.id, pmv2TeamMembers.userId))
    .where(and(
      inArray(pmv2TeamMembers.teamId, teamIds),
      eq(pmv2TeamMembers.isActive, 1),
      eq(users.isActive, 1),
      inArray(users.role, [...PMV2_TECHNICIAN_EXECUTION_ROLES] as any),
    ));
}

async function loadRequirementByRouteAction(db: any, routeDecisionActionId: number): Promise<RequirementContext | null> {
  const rows = await db.select({
    actionId: pmv2ItemActions.id,
    requesterUserId: pmv2ItemActions.performedById,
    visitId: pmv2ItemActions.visitId,
    note: pmv2ItemActions.note,
    taskId: pmv2Tasks.id,
    taskNumber: pmv2Tasks.taskNumber,
    taskStatus: pmv2Tasks.status,
    programTargetId: pmv2Tasks.programTargetId,
    taskItemId: pmv2TaskItems.id,
    taskItemTitle: pmv2TaskItems.titleSnapshot,
    itemStatus: pmv2TaskItems.status,
    itemResult: pmv2TaskItems.result,
    teamId: pmv2Tasks.teamId,
    teamCode: pmv2Teams.code,
    teamWarehouseId: pmv2Teams.warehouseId,
  })
    .from(pmv2ItemActions)
    .innerJoin(pmv2TaskItems, eq(pmv2TaskItems.id, pmv2ItemActions.taskItemId))
    .innerJoin(pmv2Tasks, eq(pmv2Tasks.id, pmv2TaskItems.taskId))
    .innerJoin(pmv2Teams, eq(pmv2Teams.id, pmv2Tasks.teamId))
    .where(and(eq(pmv2ItemActions.id, routeDecisionActionId), eq(pmv2ItemActions.action, MATERIAL_ROUTE_DECISION_ACTION)))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  const snapshot = parseMaterialRouteDecision(row.note);
  if (!snapshot || snapshot.teamWarehouseId !== Number(row.teamWarehouseId)) return null;
  return {
    ...snapshot,
    routeDecisionActionId: Number(row.actionId),
    requesterUserId: Number(row.requesterUserId),
    visitId: Number(row.visitId),
    taskId: Number(row.taskId),
    taskNumber: String(row.taskNumber),
    taskStatus: String(row.taskStatus),
    programTargetId: Number(row.programTargetId),
    taskItemId: Number(row.taskItemId),
    taskItemTitle: String(row.taskItemTitle),
    itemStatus: String(row.itemStatus),
    itemResult: row.itemResult == null ? null : String(row.itemResult),
    teamId: Number(row.teamId),
    teamCode: String(row.teamCode),
  };
}

async function loadLatestRequirementsForTaskItem(db: any, taskItemId: number) {
  const rows = await db.select({ id: pmv2ItemActions.id, note: pmv2ItemActions.note })
    .from(pmv2ItemActions)
    .where(and(eq(pmv2ItemActions.taskItemId, taskItemId), eq(pmv2ItemActions.action, MATERIAL_ROUTE_DECISION_ACTION)))
    .orderBy(desc(pmv2ItemActions.id));
  const latest = new Map<number, { id: number; snapshot: MaterialRouteDecisionSnapshot }>();
  let hasUnlisted = false;
  const unlistedRequestItemIds = new Set<number>();
  for (const row of rows) {
    const snapshot = parseMaterialRouteDecision(row.note);
    if (!snapshot) continue;
    if (snapshot.catalogItemId == null) {
      if (snapshot.materialRequestItemId) unlistedRequestItemIds.add(Number(snapshot.materialRequestItemId));
      else hasUnlisted = true;
      continue;
    }
    if (!latest.has(snapshot.catalogItemId)) latest.set(snapshot.catalogItemId, { id: Number(row.id), snapshot });
  }

  // Historical free-text route decisions must stop blocking completion after the
  // warehouse resolves that request item to a real Catalog identity. The old
  // action remains immutable for audit; current request-item identity/status is
  // the authority for whether an unresolved unlisted need still exists.
  if (unlistedRequestItemIds.size > 0) {
    const requestRows = await db
      .select({
        id: pmv2MaterialRequestItems.id,
        catalogItemId: pmv2MaterialRequestItems.catalogItemId,
        status: pmv2MaterialRequestItems.status,
      })
      .from(pmv2MaterialRequestItems)
      .where(inArray(pmv2MaterialRequestItems.id, [...unlistedRequestItemIds]));
    if (requestRows.some((row: any) => row.catalogItemId == null && !["cancelled", "consumed"].includes(String(row.status)))) {
      hasUnlisted = true;
    }
  }
  return { latest, hasUnlisted };
}

async function listIssueActions(db: any, taskItemId: number) {
  const rows = await db.select({ id: pmv2ItemActions.id, note: pmv2ItemActions.note, performedById: pmv2ItemActions.performedById })
    .from(pmv2ItemActions)
    .where(and(eq(pmv2ItemActions.taskItemId, taskItemId), eq(pmv2ItemActions.action, MATERIAL_ISSUE_LINK_ACTION)))
    .orderBy(pmv2ItemActions.id);
  return rows.map((row: any) => ({ id: Number(row.id), performedById: Number(row.performedById), note: parseIssueNote(row.note) })).filter((row: any) => row.note);
}

async function sumIssuedForRoute(db: any, taskItemId: number, routeDecisionActionId: number) {
  const rows = await listIssueActions(db, taskItemId);
  return roundQuantity(rows.filter((row: any) => row.note.routeDecisionActionId === routeDecisionActionId)
    .reduce((sum: number, row: any) => sum + originalEquivalent(row.note), 0));
}

async function sumRequestAttributedIssue(db: any, taskItemId: number, routeDecisionActionId: number) {
  const rows = await listIssueActions(db, taskItemId);
  return roundQuantity(rows.filter((row: any) => row.note.routeDecisionActionId === routeDecisionActionId)
    .reduce((sum: number, row: any) => sum + Number(row.note.materialRequestQuantity || 0), 0));
}

async function listUnlinkedPhysicalIssues(db: any, taskItemId: number, routeDecisionActionId: number) {
  const [pendingRows, linkedRows] = await Promise.all([
    db.select({ id: pmv2ItemActions.id, note: pmv2ItemActions.note })
      .from(pmv2ItemActions)
      .where(and(eq(pmv2ItemActions.taskItemId, taskItemId), eq(pmv2ItemActions.action, MATERIAL_ISSUE_LINK_PENDING_ACTION)))
      .orderBy(desc(pmv2ItemActions.id)),
    listIssueActions(db, taskItemId),
  ]);
  const linkedDeliveryNumbers = new Set(linkedRows.map((row: any) => String(row.note.deliveryNumber)));
  const result: Array<{ id: number; note: PendingIssueLinkNote }> = [];
  const seen = new Set<string>();
  for (const row of pendingRows) {
    const note = parsePendingIssueLinkNote(row.note);
    if (!note || note.routeDecisionActionId !== routeDecisionActionId || linkedDeliveryNumbers.has(note.deliveryNumber) || seen.has(note.deliveryNumber)) continue;
    seen.add(note.deliveryNumber);
    result.push({ id: Number(row.id), note });
  }
  return result;
}

async function recordPendingIssueLink(
  actorUserId: number,
  requirement: RequirementContext,
  delivery: { deliveryDocumentId: number | null; deliveryNumber: string; quantity: number; lotId: number | null; lotCode: string | null },
  recipientUserId: number,
  error: unknown,
) {
  const db = await requireDb();
  const existing = await db.select({ id: pmv2ItemActions.id, note: pmv2ItemActions.note })
    .from(pmv2ItemActions)
    .where(and(eq(pmv2ItemActions.taskItemId, requirement.taskItemId), eq(pmv2ItemActions.action, MATERIAL_ISSUE_LINK_PENDING_ACTION)))
    .orderBy(desc(pmv2ItemActions.id));
  if (existing.some((row: any) => parsePendingIssueLinkNote(row.note)?.deliveryNumber === delivery.deliveryNumber)) return;
  const note: PendingIssueLinkNote = {
    version: 1,
    routeDecisionActionId: requirement.routeDecisionActionId,
    deliveryDocumentId: delivery.deliveryDocumentId,
    deliveryNumber: delivery.deliveryNumber,
    quantity: roundQuantity(delivery.quantity),
    lotId: delivery.lotId,
    lotCode: delivery.lotCode,
    recipientUserId,
    errorMessage: error instanceof Error ? error.message : "تعذر ربط سند الصرف بـPM V2",
  };
  await db.insert(pmv2ItemActions).values({
    taskItemId: requirement.taskItemId,
    visitId: requirement.visitId,
    action: MATERIAL_ISSUE_LINK_PENDING_ACTION,
    note: JSON.stringify(note),
    performedById: actorUserId,
  });
}

async function areAllLatestRequirementsIssued(db: any, taskItemId: number) {
  const { latest, hasUnlisted } = await loadLatestRequirementsForTaskItem(db, taskItemId);
  if (hasUnlisted || latest.size === 0) return false;
  for (const requirement of latest.values()) {
    const issued = await sumIssuedForRoute(db, taskItemId, requirement.id);
    if (issued + 0.0005 < requirement.snapshot.requestedQuantity) return false;
  }
  return true;
}

async function projectTaskStatus(tx: any, taskId: number) {
  const itemRows = await tx.select({ status: pmv2TaskItems.status }).from(pmv2TaskItems).where(eq(pmv2TaskItems.taskId, taskId));
  const status = deriveTaskStatus(itemRows.map((row: any) => row.status as Pmv2ItemStatus));
  await tx.update(pmv2Tasks).set({ status }).where(eq(pmv2Tasks.id, taskId));
  return status;
}

function allocateLots(lots: Array<{ id: number; lotCode: string; trackingToken: string; quantity: number }>, quantity: number) {
  let remaining = roundQuantity(quantity);
  const allocations: Array<{ lotId: number; lotCode: string; trackingToken: string; quantity: number }> = [];
  for (const lot of lots) {
    if (remaining <= 0) break;
    const take = roundQuantity(Math.min(remaining, Number(lot.quantity || 0)));
    if (take <= 0) continue;
    allocations.push({ lotId: lot.id, lotCode: lot.lotCode, trackingToken: lot.trackingToken, quantity: take });
    remaining = roundQuantity(remaining - take);
  }
  return { allocations, remaining };
}

async function resolveTarget(programTargetId: number) {
  const db = await requireDb();
  const rows = await db.select({ siteId: pmv2ProgramTargets.siteId, sectionId: pmv2ProgramTargets.sectionId, assetId: pmv2ProgramTargets.assetId })
    .from(pmv2ProgramTargets).where(eq(pmv2ProgramTargets.id, programTargetId)).limit(1);
  const target = rows[0];
  if (!target) return { label: "هدف الصيانة غير معروف", costTarget: null as any, blocker: "تعذر تحديد هدف الصيانة" };

  if (target.assetId) {
    const assets = await currentMaintenanceTargetAdapter.listAssets();
    const asset = assets.find((item) => item.id === Number(target.assetId));
    if (!asset || !asset.siteId || !asset.sectionId) {
      return { label: `أصل #${target.assetId}`, costTarget: null as any, blocker: "الأصل لا يحمل موقعًا وقسمًا صالحين لتحميل تكلفة الصرف" };
    }
    return {
      label: asset.name,
      costTarget: { beneficiarySiteId: asset.siteId, beneficiarySectionId: asset.sectionId, beneficiaryAssetId: asset.id },
      blocker: null,
    };
  }
  if (target.sectionId) {
    const sections = await currentMaintenanceTargetAdapter.listSections();
    const section = sections.find((item) => item.id === Number(target.sectionId));
    if (!section) return { label: `قسم #${target.sectionId}`, costTarget: null as any, blocker: "قسم الصيانة غير صالح" };
    return {
      label: section.name,
      costTarget: { beneficiarySiteId: section.siteId, beneficiarySectionId: section.id, beneficiaryAssetId: null },
      blocker: null,
    };
  }
  if (target.siteId) {
    const sites = await currentMaintenanceTargetAdapter.listSites();
    const site = sites.find((item) => item.id === Number(target.siteId));
    return {
      label: site?.name || `موقع #${target.siteId}`,
      costTarget: null as any,
      blocker: "الصرف الحالي يتطلب قسمًا مستفيدًا؛ هدف المهمة محدد على مستوى الموقع فقط",
    };
  }
  return { label: "هدف غير محدد", costTarget: null as any, blocker: "هدف المهمة لا يحتوي موقعًا/قسمًا/أصلًا صالحًا" };
}

async function finalizeConsumptionWithDb(tx: any, declarationActionId: number, declaration: ConsumptionDeclarationNote) {
  const declarationRows = await tx.select({ taskItemId: pmv2ItemActions.taskItemId, visitId: pmv2ItemActions.visitId })
    .from(pmv2ItemActions).where(eq(pmv2ItemActions.id, declarationActionId)).limit(1);
  const declarationRow = declarationRows[0];
  if (!declarationRow) throw new Pmv2TeamIssueHandoffError("سجل استخدام المادة غير موجود");
  const taskItemId = Number(declarationRow.taskItemId);
  const already = await tx.select({ id: pmv2ItemActions.id, note: pmv2ItemActions.note })
    .from(pmv2ItemActions)
    .where(and(eq(pmv2ItemActions.taskItemId, taskItemId), eq(pmv2ItemActions.action, MATERIAL_CONSUMPTION_FINALIZED_ACTION)));
  if (already.some((row: any) => Number(parseJson<any>(row.note)?.declarationActionId || 0) === declarationActionId)) return;

  const issueRows = (await listIssueActions(tx, taskItemId)).filter((row: any) => row.note.routeDecisionActionId === declaration.routeDecisionActionId);
  const returnRows = await tx.select({ note: pmv2ItemActions.note }).from(pmv2ItemActions)
    .where(and(eq(pmv2ItemActions.taskItemId, taskItemId), eq(pmv2ItemActions.action, MATERIAL_RETURN_PART_LINKED_ACTION)));
  const returnedByDelivery = new Map<number, number>();
  for (const row of returnRows) {
    const note = parseReturnPartNote(row.note);
    if (!note || note.declarationActionId !== declarationActionId) continue;
    returnedByDelivery.set(note.sourceDeliveryDocumentId, roundQuantity((returnedByDelivery.get(note.sourceDeliveryDocumentId) || 0) + note.quantity));
  }

  const netParts = issueRows.map((row: any) => ({
    ...row.note,
    netQuantity: roundQuantity(Number(row.note.quantity || 0) - Number(returnedByDelivery.get(row.note.deliveryDocumentId) || 0)),
  })).filter((part: any) => part.netQuantity > 0);
  if(declaration.physicalUsages) {
    const declared=new Map(declaration.physicalUsages.map(part=>[part.deliveryDocumentId,part.usedQuantity]));
    for(const issue of issueRows) {
      const actual=roundQuantity(issue.note.quantity-Number(returnedByDelivery.get(issue.note.deliveryDocumentId)||0));
      if(Math.abs(actual-Number(declared.get(issue.note.deliveryDocumentId)??-1))>0.0005) throw new Pmv2TeamIssueHandoffError("صافي صرف اللوت لا يطابق استخدام الصنف الفعلي المسجل");
    }
  }
  if(declaration.physicalMode) {
    if(!declaration.physicalUsages) throw new Pmv2TeamIssueHandoffError("تفاصيل الاستخدام الفعلي غير موجودة");
    let allocations;try{allocations=settlePmv2PhysicalConsumption(issueRows.map((row:any)=>row.note),declaration.physicalUsages,returnedByDelivery);}catch(error){throw new Pmv2TeamIssueHandoffError(error instanceof Error?error.message:"تعذر تسوية الاستخدام الفعلي");}
    for(const allocation of allocations) {
        const part=issueRows.find((row:any)=>row.note.deliveryDocumentId===allocation.deliveryDocumentId)!.note;
        const usage=validatePmv2MaterialUsageWrite({taskItemId,visitId:Number(declarationRow.visitId),materialRequestItemId:allocation.materialRequestItemId,warehouseId:part.warehouseId,catalogItemId:part.catalogItemId,inventoryTransactionId:part.inventoryTransactionId,inventoryLotId:part.inventoryLotId,deliveryDocumentId:part.deliveryDocumentId,purchaseOrderItemId:null,usedQuantity:allocation.quantity,unitSnapshot:part.unit,recordedById:declaration.declaredById});
        await tx.insert(pmv2MaterialUsages).values({...usage,usedQuantity:usage.usedQuantity.toFixed(3)});
    }
    if(declaration.materialRequestItemId) await tx.update(pmv2MaterialRequestItems).set({status:"consumed"}).where(and(eq(pmv2MaterialRequestItems.id,declaration.materialRequestItemId),eq(pmv2MaterialRequestItems.status,"issued_to_team")));
    await tx.insert(pmv2ItemActions).values({taskItemId,visitId:Number(declarationRow.visitId),action:MATERIAL_CONSUMPTION_FINALIZED_ACTION,note:JSON.stringify({version:1,declarationActionId,catalogItemId:declaration.catalogItemId,physicalMode:true,physicalUsages:declaration.physicalUsages}),performedById:declaration.declaredById});
    return;
  }
  if(declaration.usedQuantity==null) throw new Pmv2TeamIssueHandoffError("كمية الاستخدام الأصلية غير موجودة");
  const netTotal = roundQuantity(netParts.reduce((sum: number, part: any) => sum + originalEquivalent(part,part.netQuantity), 0));
  if (Math.abs(netTotal - declaration.usedQuantity) > 0.0005) {
    throw new Pmv2TeamIssueHandoffError(`الاستهلاك الصافي (${netTotal}) لا يطابق الكمية المستخدمة المسجلة (${declaration.usedQuantity})`);
  }

  const requirement = await loadRequirementByRouteAction(tx, declaration.routeDecisionActionId);
  if (!requirement) throw new Pmv2TeamIssueHandoffError("تعذر استعادة احتياج المادة الأصلي");
  const teamStockAtDecision = roundQuantity(Math.max(0,
    Number.isFinite(Number(requirement.availableQuantity))
      ? Number(requirement.availableQuantity)
      : requirement.requestedQuantity - requirement.shortageQuantity,
  ));
  let requestBudget = roundQuantity(Math.max(0, declaration.usedQuantity - teamStockAtDecision));
  if (requirement.materialRequestItemId) {
    const requestRows = await tx.select({ requestedQuantity: pmv2MaterialRequestItems.requestedQuantity, issuedToTeamQuantity: pmv2MaterialRequestItems.issuedToTeamQuantity })
      .from(pmv2MaterialRequestItems).where(eq(pmv2MaterialRequestItems.id, requirement.materialRequestItemId)).limit(1);
    const row = requestRows[0];
    requestBudget = row ? roundQuantity(Math.min(requestBudget, Number(row.requestedQuantity || 0), Number(row.issuedToTeamQuantity || 0))) : 0;
  } else requestBudget = 0;
  let generalBudget = roundQuantity(declaration.usedQuantity - requestBudget);

  for (const part of netParts) {
    let remaining = originalEquivalent(part,part.netQuantity);
    const general = roundQuantity(Math.min(generalBudget, remaining));
    if (general > 0) {
      const usage = validatePmv2MaterialUsageWrite({
        taskItemId, visitId: Number(declarationRow.visitId), materialRequestItemId: null,
        warehouseId: part.warehouseId, catalogItemId: part.catalogItemId,
        inventoryTransactionId: part.inventoryTransactionId, inventoryLotId: part.inventoryLotId,
        deliveryDocumentId: part.deliveryDocumentId, purchaseOrderItemId: null,
        usedQuantity: physicalEquivalent(part,general), unitSnapshot: part.unit, recordedById: declaration.declaredById,
      });
      await tx.insert(pmv2MaterialUsages).values({ ...usage, usedQuantity: usage.usedQuantity.toFixed(3) });
      generalBudget = roundQuantity(generalBudget - general);
      remaining = roundQuantity(remaining - general);
    }
    const request = roundQuantity(Math.min(requestBudget, remaining));
    if (request > 0) {
      const usage = validatePmv2MaterialUsageWrite({
        taskItemId, visitId: Number(declarationRow.visitId), materialRequestItemId: requirement.materialRequestItemId,
        warehouseId: part.warehouseId, catalogItemId: part.catalogItemId,
        inventoryTransactionId: part.inventoryTransactionId, inventoryLotId: part.inventoryLotId,
        deliveryDocumentId: part.deliveryDocumentId, purchaseOrderItemId: null,
        usedQuantity: physicalEquivalent(part,request), unitSnapshot: part.unit, recordedById: declaration.declaredById,
      });
      await tx.insert(pmv2MaterialUsages).values({ ...usage, usedQuantity: usage.usedQuantity.toFixed(3) });
      requestBudget = roundQuantity(requestBudget - request);
    }
  }

  if (requirement.materialRequestItemId) {
    const requestUsageRows = await tx.select({ usedQuantity: pmv2MaterialUsages.usedQuantity, deliveryDocumentId: pmv2MaterialUsages.deliveryDocumentId }).from(pmv2MaterialUsages)
      .where(and(eq(pmv2MaterialUsages.taskItemId, taskItemId), eq(pmv2MaterialUsages.materialRequestItemId, requirement.materialRequestItemId)));
    const issueByDelivery=new Map(issueRows.map((row:any)=>[Number(row.note.deliveryDocumentId),row.note]));
    const requestUsed = roundQuantity(requestUsageRows.reduce((sum: number, row: any) => {
      const part=issueByDelivery.get(Number(row.deliveryDocumentId)) as IssueActionNote|undefined;
      return sum+(part ? originalEquivalent(part,Number(row.usedQuantity||0)) : Number(row.usedQuantity||0));
    }, 0));
    const requestRows = await tx.select({ requestedQuantity: pmv2MaterialRequestItems.requestedQuantity }).from(pmv2MaterialRequestItems)
      .where(eq(pmv2MaterialRequestItems.id, requirement.materialRequestItemId)).limit(1);
    if (requestRows[0] && requestUsed + 0.0005 >= Number(requestRows[0].requestedQuantity || 0)) {
      await tx.update(pmv2MaterialRequestItems).set({ status: "consumed" })
        .where(and(eq(pmv2MaterialRequestItems.id, requirement.materialRequestItemId), eq(pmv2MaterialRequestItems.status, "issued_to_team")));
    }
  }

  await tx.insert(pmv2ItemActions).values({
    taskItemId, visitId: Number(declarationRow.visitId), action: MATERIAL_CONSUMPTION_FINALIZED_ACTION,
    note: JSON.stringify({ version: 1, declarationActionId, catalogItemId: declaration.catalogItemId, usedQuantity: declaration.usedQuantity }),
    performedById: declaration.declaredById,
  });
}

export class Pmv2TeamIssueHandoffService {
  async listReadyToIssueQueue() {
    const db = await requireDb();
    const routeRows = await db.select({
      actionId: pmv2ItemActions.id, requesterUserId: pmv2ItemActions.performedById, visitId: pmv2ItemActions.visitId, note: pmv2ItemActions.note,
      taskId: pmv2Tasks.id, taskNumber: pmv2Tasks.taskNumber, taskStatus: pmv2Tasks.status, programTargetId: pmv2Tasks.programTargetId,
      taskItemId: pmv2TaskItems.id, taskItemTitle: pmv2TaskItems.titleSnapshot, itemStatus: pmv2TaskItems.status, itemResult: pmv2TaskItems.result,
      teamId: pmv2Tasks.teamId, teamCode: pmv2Teams.code, teamWarehouseId: pmv2Teams.warehouseId,
    }).from(pmv2ItemActions)
      .innerJoin(pmv2TaskItems, eq(pmv2TaskItems.id, pmv2ItemActions.taskItemId))
      .innerJoin(pmv2Tasks, eq(pmv2Tasks.id, pmv2TaskItems.taskId))
      .innerJoin(pmv2Teams, eq(pmv2Teams.id, pmv2Tasks.teamId))
      .where(and(
        eq(pmv2ItemActions.action, MATERIAL_ROUTE_DECISION_ACTION),
        eq(pmv2TaskItems.status, "waiting_material"), eq(pmv2TaskItems.result, "needs_material"), ne(pmv2Tasks.status, "cancelled"),
      )).orderBy(desc(pmv2ItemActions.id));

    const latest = new Map<string, RequirementContext>();
    for (const row of routeRows) {
      const snapshot = parseMaterialRouteDecision(row.note);
      if (!snapshot?.catalogItemId || snapshot.teamWarehouseId !== Number(row.teamWarehouseId)) continue;
      const key = `${row.taskItemId}:${snapshot.catalogItemId}`;
      if (latest.has(key)) continue;
      latest.set(key, {
        ...snapshot, routeDecisionActionId: Number(row.actionId), requesterUserId: Number(row.requesterUserId), visitId: Number(row.visitId),
        taskId: Number(row.taskId), taskNumber: String(row.taskNumber), taskStatus: String(row.taskStatus), programTargetId: Number(row.programTargetId),
        taskItemId: Number(row.taskItemId), taskItemTitle: String(row.taskItemTitle), itemStatus: String(row.itemStatus), itemResult: String(row.itemResult),
        teamId: Number(row.teamId), teamCode: String(row.teamCode),
      });
    }
    if (!latest.size) return [];

    const materialRequestItemIds = [...new Set([...latest.values()]
      .map((item) => Number(item.materialRequestItemId || 0))
      .filter((id) => id > 0))];
    const materialRequestRows = materialRequestItemIds.length
      ? await db
          .select({
            id: pmv2MaterialRequestItems.id,
            status: pmv2MaterialRequestItems.status,
            requestedQuantity: pmv2MaterialRequestItems.requestedQuantity,
            issuedToTeamQuantity: pmv2MaterialRequestItems.issuedToTeamQuantity,
          })
          .from(pmv2MaterialRequestItems)
          .where(inArray(pmv2MaterialRequestItems.id, materialRequestItemIds))
      : [];
    const materialRequestById = new Map(materialRequestRows.map((row) => [Number(row.id), row]));
    const replacementsByRequest=await loadPmv2Replacements(db,materialRequestItemIds);
    const replacementStock=await loadPmv2ReplacementStock(db,Array.from(replacementsByRequest.values()).flat(),Array.from(latest.values()).map(item=>item.teamWarehouseId));

    // Include only the actual active global executor who requested this material,
    // without registering that account as a permanent team member.
    const requesterIds = Array.from(new Set(Array.from(latest.values()).map(item => item.requesterUserId)));
    const globalRequesters = requesterIds.length ? await db.select({ id: users.id, name: users.name }).from(users)
      .where(and(inArray(users.id, requesterIds), eq(users.isActive, 1), inArray(users.role, [...PMV2_ALL_TEAM_EXECUTION_ROLES]))) : [];
    const globalRequesterById = new Map<number, { id: number; name: string }>(globalRequesters.map(row => [Number(row.id), { id: Number(row.id), name: String(row.name || "فني") }]));

    const techRows = await listActiveTeamTechnicians(db, [...new Set([...latest.values()].map((item) => item.teamId))]);
    const techByTeam = new Map<number, Array<{ id: number; name: string }>>();
    for (const row of techRows as any[]) {
      const list = techByTeam.get(Number(row.teamId)) || [];
      list.push({ id: Number(row.userId), name: String(row.userName || "فني") });
      techByTeam.set(Number(row.teamId), list);
    }
    const catalogRefs = await currentCatalogAdapter.getItemsByIds([...new Set([...latest.values()].map((item) => Number(item.catalogItemId)))]);
    const catalogById = new Map(catalogRefs.map((item) => [item.id, item]));

    const result: any[] = [];
    for (const requirement of latest.values()) {
      if (requirement.materialRequestItemId) {
        const requestItem = materialRequestById.get(Number(requirement.materialRequestItemId));
        const requestedFromWarehouse = Number(requestItem?.requestedQuantity || 0);
        const suppliedToTeam = Number(requestItem?.issuedToTeamQuantity || 0);
        if (!requestItem || requestItem.status !== "issued_to_team" || suppliedToTeam + 0.0005 < requestedFromWarehouse) {
          // A shortage-routed requirement is not receivable/issuable until the
          // shortage itself has physically reached the Team Warehouse. This
          // keeps the warehouse queue focused on covering the shortage only and
          // prevents the original full task need from appearing as an issue card.
          continue;
        }
      }
      const previousIssues=(await listIssueActions(db,requirement.taskItemId)).filter((row:any)=>row.note.routeDecisionActionId===requirement.routeDecisionActionId);
      const issuedQuantity = roundQuantity(previousIssues.reduce((sum:number,row:any)=>sum+originalEquivalent(row.note),0));
      const remainingQuantity = roundQuantity(requirement.requestedQuantity - issuedQuantity);
      if (remainingQuantity <= 0) continue;
      const pendingLinks = await listUnlinkedPhysicalIssues(db, requirement.taskItemId, requirement.routeDecisionActionId);
      const pendingRelink = pendingLinks[0] || null;
      const availability = await currentInventoryAdapter.getCatalogAvailability(Number(requirement.catalogItemId), requirement.teamWarehouseId);
      const target = await resolveTarget(requirement.programTargetId);
      const technicians = [...(techByTeam.get(requirement.teamId) || [])];
      const globalRequester = globalRequesterById.get(requirement.requesterUserId);
      if (globalRequester && !technicians.some(item => item.id === globalRequester.id)) technicians.push(globalRequester);
      const requester = technicians.find((item) => item.id === requirement.requesterUserId) || null;
      const inventoryId = availability.ambiguous ? null : availability.inventoryId;
      const originalActive=catalogById.get(Number(requirement.catalogItemId))?.isActive===true;
      const lots = inventoryId && originalActive ? await currentInventoryAdapter.listAvailableLots(inventoryId) : [];
      const replacements=replacementsByRequest.get(Number(requirement.materialRequestItemId))??[];
      const replacementLotIds=new Set(replacements.flatMap(({plan})=>plan.lots.map(lot=>lot.lotId)));
      const fulfillment=planPmv2Fulfillment({requiredOriginal:remainingQuantity,originalUnit:requirement.unit,originalStock:lots.filter(lot=>!replacementLotIds.has(lot.id)).map(lot=>({lotId:lot.id,inventoryId:inventoryId!,warehouseId:requirement.teamWarehouseId,catalogItemId:Number(requirement.catalogItemId),unit:availability.unit||requirement.unit,quantity:lot.quantity,lotCode:lot.lotCode,trackingToken:lot.trackingToken})),replacements:replacements.map(replacement=>({replacement,stock:replacement.plan.lots.map(lot=>replacementStock.get(`${requirement.teamWarehouseId}:${lot.lotId}`)).filter((lot):lot is NonNullable<typeof lot>=>!!lot),alreadyAllocated:previousIssues.filter((row:any)=>row.note.replacementPlanId===replacement.plan.planId).reduce((sum:number,row:any)=>sum+originalEquivalent(row.note),0)}))});
      const fulfillmentAllocations=fulfillment.allocations;
      const availableLotOptions: Array<WarehouseLotOption & {catalogItemId:number;trackingToken:string;inventoryId:number}> = lots.filter(lot => !replacementLotIds.has(lot.id)).map(lot => ({
        lotId:lot.id, lotCode:lot.lotCode, inventoryId:inventoryId!, catalogItemId:Number(requirement.catalogItemId), trackingToken:lot.trackingToken,
        quantity:lot.quantity, unit:availability.unit||requirement.unit, createdAt:lot.createdAt,
      }));
      for (const replacement of replacements) {
        const used=previousIssues.filter((row:any)=>row.note.replacementPlanId===replacement.plan.planId).reduce((sum:number,row:any)=>sum+originalEquivalent(row.note),0);
        for(const source of replacement.plan.lots) {
          const lot=replacementStock.get(`${requirement.teamWarehouseId}:${source.lotId}`);
          if(lot) availableLotOptions.push({...lot,originalPerUnit:Number(replacement.plan.originalQuantityCovered)/replacement.plan.lots.reduce((sum,row)=>sum+Number(row.quantity),0),coverageKey:String(replacement.plan.planId),coverageLimit:Math.max(0,replacement.maximumOriginalQuantity-used)});
        }
      }
      let blocker = target.blocker;
      if (pendingRelink) blocker = `تم إنشاء سند الصرف ${pendingRelink.note.deliveryNumber} فعليًا ويحتاج إعادة ربط فقط — لا تكرر الصرف`;
      if (!fulfillment.complete&&fulfillment.unrepresentable) blocker ||="أرصدة لوتات البديل لا تحقق نسبة التعويض المعتمدة بوحدات صحيحة؛ راجع توزيع اللوتات والكمية دون تقريب";
      else if (availability.ambiguous&&originalActive) blocker ||= "هوية المخزون في مخزن الفريق غير فريدة";
      else if (!fulfillment.complete) blocker ||= "أرصدة الصنف والبدائل المعتمدة لا تغطي كامل احتياج المهمة";
      const canIssueToAuthorizedExecutor = !blocker;
      if (!requester && technicians.length === 0) blocker ||= "لا يوجد فني نشط في فريق المهمة يمكنه الاستلام";

      const catalog = catalogById.get(Number(requirement.catalogItemId));
      result.push({
        routeDecisionActionId: requirement.routeDecisionActionId,
        materialRequestItemId: requirement.materialRequestItemId,
        taskId: requirement.taskId, taskNumber: requirement.taskNumber, taskItemId: requirement.taskItemId, taskItemTitle: requirement.taskItemTitle,
        teamId: requirement.teamId, teamCode: requirement.teamCode, warehouseId: requirement.teamWarehouseId,
        catalogItemId: requirement.catalogItemId, itemName: catalog?.nameAr || requirement.itemNameSnapshot, itemCode: catalog?.code || null,
        unit: requirement.unit, requiredQuantity: requirement.requestedQuantity, issuedQuantity, remainingQuantity,
        availableQuantity: fulfillment.availableOriginal, inventoryId:inventoryId??fulfillmentAllocations[0]?.inventoryId??null,
        fulfillmentAllocations,
        availableLotOptions,
        requesterUserId: requirement.requesterUserId, requesterName: requester?.name || `#${requirement.requesterUserId}`,
        defaultRecipientUserId: requester?.id || technicians[0]?.id || null, technicians,
        targetLabel: target.label, canIssue: !blocker, canIssueToAuthorizedExecutor, blocker,
        pendingRelink: pendingRelink ? {
          actionId: pendingRelink.id,
          deliveryNumber: pendingRelink.note.deliveryNumber,
          deliveryDocumentId: pendingRelink.note.deliveryDocumentId,
          quantity: pendingRelink.note.quantity,
          lotId: pendingRelink.note.lotId,
          lotCode: pendingRelink.note.lotCode,
          recipientUserId: pendingRelink.note.recipientUserId,
          errorMessage: pendingRelink.note.errorMessage,
        } : null,
        lotAllocations: fulfillmentAllocations.map((item) => ({ lotId: item.lotId, lotCode: item.lotCode, quantity: item.quantity,unit:item.unit,originalQuantity:item.originalQuantity,replacementPlanId:item.replacementPlanId })),
      });
    }
    return result.sort((a, b) => a.taskNumber.localeCompare(b.taskNumber));
  }

  async listTechnicianReadyReceipts(userId: number, taskId: number, taskItemId: number) {
    const allTeams = await canUserExecuteAllPmv2Teams(await requireDb(), userId);
    const queue = await this.listReadyToIssueQueue();
    return queue
      .filter((item) =>
        item.taskId === taskId &&
        item.taskItemId === taskItemId &&
        (allTeams || item.technicians.some((technician: any) => technician.id === userId)),
      )
      .map((item) => ({
        routeDecisionActionId: item.routeDecisionActionId,
        materialRequestItemId: item.materialRequestItemId ?? null,
        catalogItemId: item.catalogItemId,
        itemName: item.itemName,
        itemCode: item.itemCode,
        unit: item.unit,
        requiredQuantity: item.requiredQuantity,
        issuedQuantity: item.issuedQuantity,
        remainingQuantity: item.remainingQuantity,
        availableQuantity: item.availableQuantity,
        warehouseId: item.warehouseId,
        canReceive: Boolean(item.canIssue || (allTeams && item.canIssueToAuthorizedExecutor)),
        blocker: allTeams && item.canIssueToAuthorizedExecutor ? null : item.blocker || null,
        pendingRelink: item.pendingRelink,
        lotAllocations: item.lotAllocations,
      }));
  }

  async issueReadyRequirementToSelf(
    technicianUserId: number,
    input: { routeDecisionActionId: number },
    auditContext?: { ipAddress?: string; userAgent?: string },
  ) {
    return this.issueReadyRequirement(technicianUserId, {
      routeDecisionActionId: input.routeDecisionActionId,
      deliveredToId: technicianUserId,
    }, auditContext);
  }

  async issueReadyRequirement(actorUserId: number, input: { routeDecisionActionId: number; deliveredToId?: number; selection?: WarehouseLotSelection }, auditContext?: { ipAddress?: string; userAgent?: string }) {
    const queue = await this.listReadyToIssueQueue();
    const candidate = queue.find((item) => item.routeDecisionActionId === input.routeDecisionActionId);
    if (!candidate) throw new Pmv2TeamIssueHandoffError("احتياج المادة لم يعد متاحًا للصرف؛ حدّث الشاشة");
    const deliveredToId = Number(input.deliveredToId || candidate.defaultRecipientUserId || 0);
    const db = await requireDb();
    const recipient = await db.select({ id: pmv2ExecutionActor.id, role: pmv2ExecutionActor.role }).from(pmv2ExecutionActor)
      .where(pmv2ExecutionTeamCondition(deliveredToId, candidate.teamId)).limit(1);
    if (!recipient[0]) throw new Pmv2TeamIssueHandoffError("المستلم الفعلي يجب أن يكون منفذًا مخوّلًا نشطًا للمهمة");
    const authorizedSelfRecipient = actorUserId === deliveredToId && canRoleExecuteAllPmv2Teams(recipient[0].role);
    if (!candidate.inventoryId || !(candidate.canIssue || (authorizedSelfRecipient && candidate.canIssueToAuthorizedExecutor))) {
      throw new Pmv2TeamIssueHandoffError(candidate.blocker || "المادة غير جاهزة للصرف");
    }
    const technicianSelfService = actorUserId === deliveredToId;

    if(input.selection || !technicianSelfService) return this.issueSelectedRequirement(db, actorUserId, input.selection ?? {mode:"fifo"}, candidate, deliveredToId, auditContext);

    const requirement = await loadRequirementByRouteAction(db, candidate.routeDecisionActionId);
    if (!requirement) throw new Pmv2TeamIssueHandoffError("تعذر استعادة احتياج المادة");
    const target = await resolveTarget(requirement.programTargetId);
    if (!target.costTarget) throw new Pmv2TeamIssueHandoffError(target.blocker || "تعذر تحديد جهة تحميل تكلفة الصرف");
    const allocations=candidate.fulfillmentAllocations as Array<{inventoryId:number;quantity:number;unit:string;trackingToken:string}>;
    if (!allocations?.length) throw new Pmv2TeamIssueHandoffError("أرصدة الـLots تغيرت ولا تغطي كامل الكمية؛ حدّث الشاشة");
    const activeCatalogs=await currentCatalogAdapter.getItemsByIds(candidate.fulfillmentAllocations.map((part:any)=>Number(part.catalogItemId)));
    if(candidate.fulfillmentAllocations.some((part:any)=>!activeCatalogs.some(item=>item.id===Number(part.catalogItemId)&&item.isActive))) throw new Pmv2TeamIssueHandoffError("صنف الصرف أو البديل غير نشط حاليًا");

    const posted: any[] = [];
    for (const allocation of allocations) {
      let delivery: any = null;
      try {
        delivery = await currentInventoryIssueAdapter.issueDelivery({
          taskItemId: requirement.taskItemId,
          inventoryId: allocation.inventoryId, quantity: allocation.quantity, unit: allocation.unit,
          performedById: actorUserId, deliveredToId, lotTrackingToken: allocation.trackingToken,
          notes: technicianSelfService
            ? `استلام ذاتي من مخزن الفريق لمهمة PM V2 ${candidate.taskNumber}`
            : `صرف تلقائي لمهمة PM V2 ${candidate.taskNumber}`,
          costTarget: target.costTarget,
        });
      } catch (error) {
        if (posted.length > 0) {
          return { completed: false, partial: true, posted, message: error instanceof Error ? error.message : "تعذر استكمال كامل الصرف؛ تم حفظ ما نُفّذ فقط" };
        }
        throw error;
      }

      try {
        const link = await this.linkConfirmedDelivery(actorUserId, {
          routeDecisionActionId: candidate.routeDecisionActionId, deliveryNumber: delivery.deliveryNumber,
        }, auditContext);
        posted.push({ ...delivery, link });
      } catch (error) {
        try {
          await recordPendingIssueLink(actorUserId, requirement, delivery, deliveredToId, error);
        } catch {
          // The physical Delivery is already authoritative. Always return its number
          // to the UI even if the recovery marker itself could not be persisted.
        }
        posted.push({ ...delivery, link: null, requiresRelink: true });
        return {
          completed: false,
          partial: true,
          requiresRelink: true,
          posted,
          pendingDeliveryNumber: delivery.deliveryNumber,
          message: `تم الصرف فعليًا بسند ${delivery.deliveryNumber} لكن تعذر ربطه بـPM V2. استخدم إعادة الربط فقط ولا تكرر الصرف.`,
        };
      }
    }
    return { completed: true, partial: false, posted, issuedQuantity: candidate.remainingQuantity, recipientUserId: deliveredToId };
  }

  private async issueSelectedRequirement(
    db: any,
    actorUserId: number,
    selection: WarehouseLotSelection,
    candidate: any,
    deliveredToId: number,
    auditContext?: { ipAddress?: string; userAgent?: string },
  ) {
    return db.transaction(async (tx: any) => {
      await tx.execute(
        sql`SELECT id FROM pmv2_task_items WHERE id=${candidate.taskItemId} FOR UPDATE`,
      );
      const [actor] = await tx
        .select({ id: users.id, role: users.role, isActive: users.isActive })
        .from(users)
        .where(eq(users.id, actorUserId))
        .limit(1);
      if (
        !actor ||
        Number(actor.isActive) !== 1 ||
        !["warehouse", "admin", "owner"].includes(actor.role)
      )
        throw new Pmv2TeamIssueHandoffError("الصرف المختار متاح للمستودع فقط");
      const requirement = await loadRequirementByRouteAction(
        tx,
        candidate.routeDecisionActionId,
      );
      if (
        !requirement ||
        requirement.itemStatus !== "waiting_material" ||
        requirement.itemResult !== "needs_material" ||
        ["cancelled", "completed"].includes(requirement.taskStatus) ||
        requirement.teamWarehouseId !== candidate.warehouseId ||
        requirement.catalogItemId !== candidate.catalogItemId
      )
        throw new Pmv2TeamIssueHandoffError("تغير احتياج المهمة؛ حدّث الشاشة");
      const remaining = roundQuantity(
        requirement.requestedQuantity -
          (await sumIssuedForRoute(
            tx,
            requirement.taskItemId,
            requirement.routeDecisionActionId,
          )),
      );
      if (
        remaining <= 0 ||
        Math.abs(remaining - candidate.remainingQuantity) > 0.0005
      )
        throw new Pmv2TeamIssueHandoffError(
          "تغير المتبقي المطلوب؛ حدّث الشاشة ولا تكرر الصرف",
        );
      const allocations =
        selection.mode === "fifo" &&
        candidate.availableLotOptions.some((lot: any) => lot.coverageKey)
          ? candidate.fulfillmentAllocations
          : selectFullIssueLots(
              candidate.availableLotOptions,
              remaining,
              requirement.unit,
              selection,
            );
      if (!allocations.length)
        throw new Pmv2TeamIssueHandoffError("يلزم تغطية كامل الاحتياج");
      const catalogIds = Array.from(
        new Set<number>(
          allocations.map((lot: any) => Number(lot.catalogItemId)),
        ),
      );
      const catalogs = await tx
        .select({ id: catalogItems.id, isActive: catalogItems.isActive })
        .from(catalogItems)
        .where(inArray(catalogItems.id, catalogIds));
      if (
        catalogs.length !== catalogIds.length ||
        catalogs.some((row: any) => Number(row.isActive) !== 1)
      )
        throw new Pmv2TeamIssueHandoffError("صنف الصرف أو البديل غير نشط");
      const inventoryIds = Array.from(
        new Set<number>(allocations.map((lot: any) => Number(lot.inventoryId))),
      ).sort((a, b) => a - b);
      await tx.execute(
        sql`SELECT id FROM inventory WHERE id IN (${sql.join(
          inventoryIds.map((id) => sql`${id}`),
          sql`,`,
        )}) ORDER BY id FOR UPDATE`,
      );
      const target = await resolveTarget(requirement.programTargetId);
      if (!target.costTarget)
        throw new Pmv2TeamIssueHandoffError(
          target.blocker || "جهة تحميل التكلفة غير صالحة",
        );
      const posted = [];
      for (const allocation of allocations) {
        const delivery = await currentInventoryIssueAdapter.issueDelivery(
          {
            taskItemId: requirement.taskItemId,
            inventoryId: allocation.inventoryId,
            quantity: allocation.quantity,
            unit: allocation.unit,
            performedById: actorUserId,
            deliveredToId,
            lotTrackingToken: allocation.trackingToken,
            notes: `صرف كامل احتياج مهمة PM V2 ${candidate.taskNumber}`,
            costTarget: target.costTarget,
          },
          tx,
        );
        const link = await this.linkConfirmedDelivery(
          actorUserId,
          {
            routeDecisionActionId: candidate.routeDecisionActionId,
            deliveryNumber: delivery.deliveryNumber,
          },
          auditContext,
          tx,
        );
        posted.push({ ...delivery, link });
      }
      return {
        completed: true,
        partial: false,
        posted,
        issuedQuantity: remaining,
        recipientUserId: deliveredToId,
      };
    });
  }

  async linkConfirmedDelivery(actorUserId: number, input: { routeDecisionActionId: number; deliveryNumber: string }, auditContext?: { ipAddress?: string; userAgent?: string }, existingTx?:any) {
    const routeDecisionActionId = Number(input.routeDecisionActionId);
    const deliveryNumber = String(input.deliveryNumber || "").trim();
    const db = existingTx || await requireDb();
    const requirement = await loadRequirementByRouteAction(db, routeDecisionActionId);
    if (!requirement?.catalogItemId) throw new Pmv2TeamIssueHandoffError("احتياج PM V2 غير صالح للربط");
    const delivery = await currentDeliveryAdapter.getDeliveryByNumber(deliveryNumber,existingTx);
    if (!delivery || !delivery.id || delivery.catalogItemId == null || delivery.warehouseId == null) throw new Pmv2TeamIssueHandoffError("سند الصرف المؤكد غير موجود أو غير مكتمل");
    if (delivery.executionSource && (delivery.executionSource !== "pmv2" || delivery.executionId !== requirement.taskId || delivery.executionItemId !== requirement.taskItemId)) {
      throw new Pmv2TeamIssueHandoffError("سند الصرف مسجل على مرجع تكلفة آخر؛ لا يمكن احتسابه مرة أخرى على مهمة PMV2. استخدم الصرف من احتياج المهمة.");
    }

    const executeLink = async (tx: any) => {
      await tx.execute(sql`SELECT id FROM delivery_documents WHERE id = ${delivery.id} FOR UPDATE`);
      await tx.execute(sql`SELECT id FROM pmv2_task_items WHERE id = ${requirement.taskItemId} FOR UPDATE`);
      const issueRows = await listIssueActions(tx, requirement.taskItemId);
      const existing = issueRows.find((row: any) => row.note.deliveryDocumentId === delivery.id);
      if (existing) {
        if (existing.note.routeDecisionActionId !== routeDecisionActionId) throw new Pmv2TeamIssueHandoffError("سند الصرف مرتبط مسبقًا باحتياج PM V2 آخر");
        return { idempotent: true, issueActionId: existing.id, deliveryNumber, linkedQuantity: originalEquivalent(existing.note), physicalQuantity: existing.note.quantity };
      }
      if (requirement.itemStatus !== "waiting_material" || requirement.itemResult !== "needs_material") throw new Pmv2TeamIssueHandoffError("بند المهمة لم يعد بانتظار المواد");
      if (delivery.warehouseId !== requirement.teamWarehouseId) throw new Pmv2TeamIssueHandoffError("سند الصرف لا يطابق مخزن احتياج PM V2");
      const replacements = requirement.materialRequestItemId ? (await loadPmv2Replacements(tx,[requirement.materialRequestItemId])).get(requirement.materialRequestItemId) ?? [] : [];
      let replacementCoverage: { originalQuantity:number; replacementPlanId:number;replacementItemName:string } | undefined;
      if (replacements.some(({plan})=>plan.lots.some(lot=>lot.lotId===delivery.inventoryLotId)) || delivery.catalogItemId!==requirement.catalogItemId || (normalizeUnit(delivery.unit) && normalizeUnit(delivery.unit)!==normalizeUnit(requirement.unit))) {
        const coverage=replacementForPhysicalLot(replacements,{lotId:delivery.inventoryLotId,catalogItemId:delivery.catalogItemId,unit:delivery.unit,quantity:delivery.quantity});
        const previous=issueRows.filter((row:any)=>row.note.replacementPlanId===coverage.replacement.plan.planId).reduce((sum:number,row:any)=>sum+originalEquivalent(row.note),0);
        if (previous+coverage.originalQuantity>coverage.replacement.maximumOriginalQuantity+0.0005) throw new Pmv2TeamIssueHandoffError("سبق تخصيص كمية هذا البديل لاحتياج PMV2");
        replacementCoverage={originalQuantity:coverage.originalQuantity,replacementPlanId:coverage.replacement.plan.planId,replacementItemName:coverage.replacement.plan.itemName};
      }
      if (!delivery.deliveredToId) throw new Pmv2TeamIssueHandoffError("سند الصرف لا يحتوي مستلمًا فعليًا");
      const recipient = await tx.select({ id: pmv2ExecutionActor.id }).from(pmv2ExecutionActor)
        .where(pmv2ExecutionTeamCondition(delivery.deliveredToId, requirement.teamId)).limit(1);
      if (!recipient[0]) throw new Pmv2TeamIssueHandoffError("المستلم ليس منفذًا مخوّلًا نشطًا للمهمة");

      const issuedBefore = await sumIssuedForRoute(tx, requirement.taskItemId, routeDecisionActionId);
      const remainingBefore = roundQuantity(requirement.requestedQuantity - issuedBefore);
      const physicalQuantity = roundQuantity(Number(delivery.quantity || 0));
      const linkedQuantity = replacementCoverage?.originalQuantity ?? physicalQuantity;
      if (linkedQuantity > remainingBefore + 0.0005) throw new Pmv2TeamIssueHandoffError("كمية سند الصرف أكبر من المتبقي المطلوب للمهمة");
      if (linkedQuantity <= 0) throw new Pmv2TeamIssueHandoffError("كمية سند الصرف غير صالحة");

      let requestLinkedQuantity = 0;
      if (requirement.materialRequestItemId) {
        const requestRows = await tx.select({ requestedQuantity: pmv2MaterialRequestItems.requestedQuantity, issuedToTeamQuantity: pmv2MaterialRequestItems.issuedToTeamQuantity })
          .from(pmv2MaterialRequestItems).where(eq(pmv2MaterialRequestItems.id, requirement.materialRequestItemId)).limit(1);
        const request = requestRows[0];
        if (request) {
          const teamStockAtDecision = roundQuantity(Math.max(0, Number.isFinite(Number(requirement.availableQuantity)) ? Number(requirement.availableQuantity) : requirement.requestedQuantity - requirement.shortageQuantity));
          const issuedFromRequest = roundQuantity(Math.min(Number(request.requestedQuantity || 0), Number(request.issuedToTeamQuantity || 0)));
          const requestBefore = await sumRequestAttributedIssue(tx, requirement.taskItemId, routeDecisionActionId);
          const desiredAfter = roundQuantity(Math.min(issuedFromRequest, Math.max(0, issuedBefore + linkedQuantity - teamStockAtDecision)));
          requestLinkedQuantity = roundQuantity(Math.min(linkedQuantity, Math.max(0, desiredAfter - requestBefore)));
        }
      }
      if(replacementCoverage) requestLinkedQuantity=linkedQuantity;
      const generalStockQuantity = roundQuantity(linkedQuantity - requestLinkedQuantity);
      const insert = await tx.insert(pmv2ItemActions).values({
        taskItemId: requirement.taskItemId, visitId: requirement.visitId, action: MATERIAL_ISSUE_LINK_ACTION, result: null,
        note: JSON.stringify({
          version: 2, routeDecisionActionId, materialRequestItemId: requirement.materialRequestItemId,
          deliveryDocumentId: delivery.id, deliveryNumber, inventoryTransactionId: delivery.inventoryTransactionId,
          inventoryLotId: delivery.inventoryLotId, lotCode: delivery.lotCode, inventoryId: delivery.inventoryId, warehouseId: delivery.warehouseId,
          catalogItemId: delivery.catalogItemId!, quantity: physicalQuantity, generalStockQuantity, materialRequestQuantity: requestLinkedQuantity,
          requiredQuantity: requirement.requestedQuantity, requesterUserId: requirement.requesterUserId, recipientUserId: delivery.deliveredToId,
          unit: delivery.unit || requirement.unit,
          ...replacementCoverage,
        } satisfies IssueActionNote), performedById: actorUserId,
      });
      const issueActionId = Number(insert[0]?.insertId || 0);
      const allIssued = await areAllLatestRequirementsIssued(tx, requirement.taskItemId);
      if (allIssued) await tx.update(pmv2TaskItems).set({ status: "ready_to_complete" })
        .where(and(eq(pmv2TaskItems.id, requirement.taskItemId), eq(pmv2TaskItems.status, "waiting_material"), eq(pmv2TaskItems.result, "needs_material")));
      const taskStatus = await projectTaskStatus(tx, requirement.taskId);
      await writePmv2AuditWithDb(tx, { actorUserId, action: "material_issue_linked", entity: "task_item", entityId: requirement.taskItemId,
        oldValues: { itemStatus: requirement.itemStatus, issuedQuantity: issuedBefore },
        newValues: { deliveryNumber, linkedQuantity, issuedQuantity: roundQuantity(issuedBefore + linkedQuantity), allIssued, taskStatus, requesterUserId: requirement.requesterUserId, recipientUserId: delivery.deliveredToId },
        ipAddress: auditContext?.ipAddress, userAgent: auditContext?.userAgent });
      return { idempotent: false, issueActionId, deliveryNumber, linkedQuantity, physicalQuantity, totalIssuedQuantity: roundQuantity(issuedBefore + linkedQuantity), remainingQuantity: roundQuantity(remainingBefore - linkedQuantity), allIssued, taskStatus };
    };
    return existingTx ? executeLink(existingTx) : db.transaction(executeLink);
  }

  async listCompletionMaterials(userId: number, taskId: number, taskItemId: number) {
    const db = await requireDb();
    const allowed = await db.select({ id: pmv2TaskItems.id }).from(pmv2TaskItems).innerJoin(pmv2Tasks, eq(pmv2Tasks.id, pmv2TaskItems.taskId))
      .innerJoin(pmv2ExecutionActor, pmv2ExecutionActorCondition(userId))
      .where(and(pmv2ExecutionTeamCondition(userId, pmv2Tasks.teamId), eq(pmv2Tasks.id, taskId), eq(pmv2TaskItems.id, taskItemId))).limit(1);
    if (!allowed[0]) throw new Pmv2TeamIssueHandoffError("المهمة غير موجودة ضمن مهامك");
    const { latest } = await loadLatestRequirementsForTaskItem(db, taskItemId);
    const catalogs = await currentCatalogAdapter.getItemsByIds([...latest.keys()]);
    const byId = new Map(catalogs.map((item) => [item.id, item]));
    const result = [];
    const issues=await listIssueActions(db,taskItemId);
    for (const [catalogItemId, row] of latest) {
      const issuedQuantity = await sumIssuedForRoute(db, taskItemId, row.id);
      const parts=issues.filter((issue:any)=>issue.note.routeDecisionActionId===row.id);
      result.push({ routeDecisionActionId: row.id, catalogItemId, itemName: byId.get(catalogItemId)?.nameAr || row.snapshot.itemNameSnapshot,
        itemCode: byId.get(catalogItemId)?.code || null, unit: row.snapshot.unit, requiredQuantity: row.snapshot.requestedQuantity, issuedQuantity,
        defaultUsedQuantity: issuedQuantity,
        physicalParts:parts.some((issue:any)=>issue.note.replacementPlanId) ? parts.map((issue:any)=>({deliveryDocumentId:issue.note.deliveryDocumentId,lotCode:issue.note.lotCode,itemName:issue.note.replacementItemName||byId.get(catalogItemId)?.nameAr||row.snapshot.itemNameSnapshot,catalogItemId:issue.note.catalogItemId,quantity:issue.note.quantity,unit:issue.note.unit,originalQuantity:originalEquivalent(issue.note),replacementPlanId:issue.note.replacementPlanId??null})) : [] });
    }
    return result;
  }

  async declareConsumptionWithDb(tx: any, userId: number, taskId: number, taskItemId: number, visitId: number, materialUsages: Array<{ catalogItemId: number; usedQuantity: number;physicalUsages?:Array<{deliveryDocumentId:number;usedQuantity:number}> }>) {
    const { latest, hasUnlisted } = await loadLatestRequirementsForTaskItem(tx, taskItemId);
    if (hasUnlisted) throw new Pmv2TeamIssueHandoffError("يوجد احتياج مادة غير مدرج لا يمكن تسوية استهلاكه تلقائيًا");
    if (latest.size === 0) return { pendingReturnQuantity: 0, hasPhysicalReturns:false,declarations: [] as any[] };
    const inputByCatalog = new Map(materialUsages.map((item) => [Number(item.catalogItemId), item]));
    if (inputByCatalog.size !== latest.size) throw new Pmv2TeamIssueHandoffError("أدخل الكمية المستخدمة لكل مادة مصروفة للمهمة");

    if (!Number.isInteger(visitId) || visitId <= 0) throw new Pmv2TeamIssueHandoffError("تعذر تحديد زيارة المهمة لتسجيل استهلاك المادة");

    const declarations: any[] = [];
    let pendingReturnQuantity = 0;
    let hasPhysicalReturns=false;
    for (const [catalogItemId, requirement] of latest) {
      if (!inputByCatalog.has(catalogItemId)) throw new Pmv2TeamIssueHandoffError("الكمية المستخدمة لمادة مطلوبة غير مدخلة");
      const issuedQuantity = await sumIssuedForRoute(tx, taskItemId, requirement.id);
      const input=inputByCatalog.get(catalogItemId)!;
      const issues=(await listIssueActions(tx,taskItemId)).filter((row:any)=>row.note.routeDecisionActionId===requirement.id);
      if(issues.some((row:any)=>row.note.replacementPlanId) && !input.physicalUsages) throw new Pmv2TeamIssueHandoffError("أدخل الاستخدام الفعلي لكل صنف ولوت بديل");
      if(input.physicalUsages) {
        let hasReturns=false;
        try { hasReturns=validatePmv2PhysicalUsage(issues.map((issue:any)=>issue.note),input.physicalUsages).hasReturns; }
        catch(error) {throw new Pmv2TeamIssueHandoffError(error instanceof Error?error.message:"استخدام المواد الفعلي غير صالح");}
        const note:ConsumptionDeclarationNote={version:1,routeDecisionActionId:requirement.id,catalogItemId,materialRequestItemId:requirement.snapshot.materialRequestItemId,requiredQuantity:requirement.snapshot.requestedQuantity,issuedQuantity,usedQuantity:null,toReturnQuantity:null,unit:requirement.snapshot.unit,declaredById:userId,physicalMode:true,physicalUsages:input.physicalUsages};
        const insert=await tx.insert(pmv2ItemActions).values({taskItemId,visitId,action:MATERIAL_CONSUMPTION_DECLARED_ACTION,note:JSON.stringify(note),performedById:userId});
        const declarationActionId=Number(insert[0]?.insertId||0);declarations.push({declarationActionId,...note});
        if(hasReturns) hasPhysicalReturns=true;
        else await finalizeConsumptionWithDb(tx,declarationActionId,note);
        continue;
      }
      const usedQuantity = Number(input.usedQuantity);
      if (!Number.isFinite(usedQuantity) || usedQuantity < 0) throw new Pmv2TeamIssueHandoffError("الكمية المستخدمة يجب ألا تكون سالبة");
      if (usedQuantity > 0 && !input.physicalUsages) {
        const quantityValidationMessage = getPmv2MaterialQuantityValidationMessage(usedQuantity, requirement.snapshot.unit);
        if (quantityValidationMessage) throw new Pmv2TeamIssueHandoffError(quantityValidationMessage);
      }
      if (usedQuantity > issuedQuantity + 0.0005) throw new Pmv2TeamIssueHandoffError(`الكمية المستخدمة (${usedQuantity}) أكبر من المصروف فعليًا (${issuedQuantity})`);
      const toReturnQuantity = roundQuantity(issuedQuantity - usedQuantity);
      // The authoritative recipient-return workflow is still integer-only in the
      // live document schema. Reject an unreturnable decimal remainder here rather
      // than closing the task with a return that the warehouse cannot post later.
      if (toReturnQuantity > 0 && !Number.isInteger(toReturnQuantity) && !input.physicalUsages) {
        throw new Pmv2TeamIssueHandoffError("مسار مرتجع المستودع الحالي يدعم الكميات الصحيحة فقط؛ لا يمكن حفظ كمية مستخدمة تترك مرتجعًا كسريًا");
      }
      const note: ConsumptionDeclarationNote = { version: 1, routeDecisionActionId: requirement.id, catalogItemId,
        materialRequestItemId: requirement.snapshot.materialRequestItemId, requiredQuantity: requirement.snapshot.requestedQuantity,
        issuedQuantity, usedQuantity, toReturnQuantity, unit: requirement.snapshot.unit, declaredById: userId,...(input.physicalUsages?{physicalUsages:input.physicalUsages}: {}) };
      const insert = await tx.insert(pmv2ItemActions).values({ taskItemId, visitId, action: MATERIAL_CONSUMPTION_DECLARED_ACTION, note: JSON.stringify(note), performedById: userId });
      const declarationActionId = Number(insert[0]?.insertId || 0);
      declarations.push({ declarationActionId, ...note });
      pendingReturnQuantity = roundQuantity(pendingReturnQuantity + toReturnQuantity);
      if (toReturnQuantity <= 0) await finalizeConsumptionWithDb(tx, declarationActionId, note);
    }
    return { pendingReturnQuantity, hasPhysicalReturns,declarations };
  }

  async listPendingReturns() {
    const db = await requireDb();
    const declarations = await db.select({ id: pmv2ItemActions.id, taskItemId: pmv2ItemActions.taskItemId, visitId: pmv2ItemActions.visitId, note: pmv2ItemActions.note,
      taskNumber: pmv2Tasks.taskNumber, taskItemTitle: pmv2TaskItems.titleSnapshot })
      .from(pmv2ItemActions).innerJoin(pmv2TaskItems, eq(pmv2TaskItems.id, pmv2ItemActions.taskItemId)).innerJoin(pmv2Tasks, eq(pmv2Tasks.id, pmv2TaskItems.taskId))
      .where(eq(pmv2ItemActions.action, MATERIAL_CONSUMPTION_DECLARED_ACTION)).orderBy(desc(pmv2ItemActions.id));
    const result: any[] = [];
    for (const row of declarations) {
      const declaration = parseDeclarationNote(row.note);
      if (!declaration || (!declaration.physicalMode && !(Number(declaration.toReturnQuantity)>0))) continue;
      const returnRows = await db.select({ note: pmv2ItemActions.note }).from(pmv2ItemActions)
        .where(and(eq(pmv2ItemActions.taskItemId, row.taskItemId), eq(pmv2ItemActions.action, MATERIAL_RETURN_PART_LINKED_ACTION)));
      const linked = returnRows.map((r: any) => parseReturnPartNote(r.note)).filter((note: any) => note?.declarationActionId === Number(row.id));
      const issues = (await listIssueActions(db, Number(row.taskItemId))).filter((issue: any) => issue.note.routeDecisionActionId === declaration.routeDecisionActionId);
      const declaredPhysical=declaration.physicalUsages ? new Map(declaration.physicalUsages.map(part=>[part.deliveryDocumentId,part.usedQuantity])) : null;
      const physicalReturnTotal=declaration.physicalMode ? roundQuantity(issues.reduce((sum:number,issue:any)=>sum+issue.note.quantity-Number(declaredPhysical?.get(issue.note.deliveryDocumentId)||0),0)) : 0;
      const returnedQuantity = roundQuantity(linked.reduce((sum: number, note: any) => sum + Number(declaration.physicalMode ? note.quantity : note.originalQuantity ?? note.quantity ?? 0), 0));
      const remainingReturnQuantity = roundQuantity(Number(declaration.physicalMode ? physicalReturnTotal : declaration.toReturnQuantity) - returnedQuantity);
      if (remainingReturnQuantity <= 0) continue;
      const returnedByDelivery = new Map<number, number>();
      for (const note of linked as ReturnPartNote[]) returnedByDelivery.set(note.sourceDeliveryDocumentId, roundQuantity((returnedByDelivery.get(note.sourceDeliveryDocumentId) || 0) + note.quantity));
      const lots = new Map<number, { lotId: number; lotCode: string | null; issuedQuantity: number; returnableQuantity: number; physicalReturnableQuantity:number; physicalUnit:string }>();
      for (const issue of issues) {
        const lotId = Number(issue.note.inventoryLotId || 0); if (!lotId) continue;
        const ret = Number(returnedByDelivery.get(issue.note.deliveryDocumentId) || 0);
        const entry = lots.get(lotId) || { lotId, lotCode: issue.note.lotCode || null, issuedQuantity: 0, returnableQuantity: 0,physicalReturnableQuantity:0,physicalUnit:issue.note.unit };
        entry.issuedQuantity = roundQuantity(entry.issuedQuantity + (declaration.physicalMode ? issue.note.quantity : originalEquivalent(issue.note)));
        const physicalReturnable=roundQuantity(issue.note.quantity-Number(declaredPhysical?.get(issue.note.deliveryDocumentId)||0)-ret);
        entry.returnableQuantity = roundQuantity(entry.returnableQuantity + (declaration.physicalMode ? physicalReturnable : originalEquivalent(issue.note,physicalReturnable)));
        entry.physicalReturnableQuantity=roundQuantity(entry.physicalReturnableQuantity+physicalReturnable);
        lots.set(lotId, entry);
      }
      const catalog = (await currentCatalogAdapter.getItemsByIds([declaration.catalogItemId]))[0];
      const recipientId = issues[0]?.note.recipientUserId || null;
      const recipientRows = recipientId ? await db.select({ name: users.name }).from(users).where(eq(users.id, recipientId)).limit(1) : [];
      result.push({ declarationActionId: Number(row.id), taskNumber: row.taskNumber, taskItemTitle: row.taskItemTitle,
        catalogItemId: declaration.catalogItemId, itemName: catalog?.nameAr || `#${declaration.catalogItemId}`, itemCode: catalog?.code || null, unit: declaration.unit,
        issuedQuantity: declaration.issuedQuantity, usedQuantity: declaration.usedQuantity, toReturnQuantity: declaration.toReturnQuantity,physicalMode:!!declaration.physicalMode,
        physicalUsages:declaration.physicalMode ? issues.map((issue:any)=>({deliveryDocumentId:issue.note.deliveryDocumentId,itemName:issue.note.replacementItemName||catalog?.nameAr,lotCode:issue.note.lotCode,unit:issue.note.unit,usedQuantity:Number(declaredPhysical?.get(issue.note.deliveryDocumentId)||0)})) : [],
        returnedQuantity, remainingReturnQuantity, previousRecipientUserId: recipientId, previousRecipientName: recipientRows[0]?.name || null,
        lots: [...lots.values()].filter((lot) => lot.returnableQuantity > 0), singleLot: [...lots.values()].filter((lot) => lot.returnableQuantity > 0).length === 1 });
    }
    return result;
  }

  async confirmPendingReturn(actorUserId: number, input: { declarationActionId: number; lotAllocations?: Array<{ lotId: number; quantity: number }> }) {
    const pending = (await this.listPendingReturns()).find((item) => item.declarationActionId === input.declarationActionId);
    if (!pending) throw new Pmv2TeamIssueHandoffError("المرتجع لم يعد معلقًا أو تم استلامه مسبقًا");
    let allocations = input.lotAllocations || [];
    if (pending.singleLot) allocations = [{ lotId: pending.lots[0].lotId, quantity: pending.remainingReturnQuantity }];
    const normalized = allocations.map((item) => ({ lotId: Number(item.lotId), quantity: roundQuantity(Number(item.quantity)) })).filter((item) => item.quantity > 0);
    const sum = roundQuantity(normalized.reduce((total, item) => total + item.quantity, 0));
    if (Math.abs(sum - pending.remainingReturnQuantity) > 0.0005) throw new Pmv2TeamIssueHandoffError(`مجموع توزيع المرتجع يجب أن يساوي ${pending.remainingReturnQuantity}`);
    for (const allocation of normalized) {
      const lot = pending.lots.find((item: any) => item.lotId === allocation.lotId);
      if (!lot || allocation.quantity > lot.returnableQuantity + 0.0005) throw new Pmv2TeamIssueHandoffError("كمية المرتجع للـLot أكبر من الكمية المصروفة القابلة للإرجاع");
    }

    const db = await requireDb();
    const declarationRows = await db.select({ taskItemId: pmv2ItemActions.taskItemId, note: pmv2ItemActions.note }).from(pmv2ItemActions)
      .where(eq(pmv2ItemActions.id, input.declarationActionId)).limit(1);
    const declaration = parseDeclarationNote(declarationRows[0]?.note);
    if (!declaration) throw new Pmv2TeamIssueHandoffError("بيانات المرتجع غير صالحة");
    const taskItemId = Number(declarationRows[0].taskItemId);
    const issues = (await listIssueActions(db, taskItemId)).filter((issue: any) => issue.note.routeDecisionActionId === declaration.routeDecisionActionId);
    const declaredPhysical=declaration.physicalUsages ? new Map(declaration.physicalUsages.map(part=>[part.deliveryDocumentId,part.usedQuantity])) : null;
    const existingReturnRows = await db.select({ note: pmv2ItemActions.note }).from(pmv2ItemActions)
      .where(and(eq(pmv2ItemActions.taskItemId, taskItemId), eq(pmv2ItemActions.action, MATERIAL_RETURN_PART_LINKED_ACTION)));
    const returnedByDelivery = new Map<number, number>();
    for (const row of existingReturnRows) {
      const note = parseReturnPartNote(row.note); if (!note || note.declarationActionId !== input.declarationActionId) continue;
      returnedByDelivery.set(note.sourceDeliveryDocumentId, roundQuantity((returnedByDelivery.get(note.sourceDeliveryDocumentId) || 0) + note.quantity));
    }

    const posted: any[] = [];
    for (const allocation of normalized) {
      let remaining = allocation.quantity;
      for (const issue of issues.filter((row: any) => Number(row.note.inventoryLotId) === allocation.lotId)) {
        if (remaining <= 0) break;
        const physicalAvailable=roundQuantity(issue.note.quantity - Number(declaredPhysical?.get(issue.note.deliveryDocumentId)||0)-Number(returnedByDelivery.get(issue.note.deliveryDocumentId) || 0));
        const available = declaration.physicalMode ? physicalAvailable : originalEquivalent(issue.note,physicalAvailable);
        const take = roundQuantity(Math.min(available, remaining));
        if (take <= 0) continue;
        const physicalTake=declaration.physicalMode ? take : physicalEquivalent(issue.note,take);
        if(!Number.isInteger(physicalTake)) throw new Pmv2TeamIssueHandoffError("كمية المرتجع الفعلية يجب أن تكون صحيحة حسب مستند المرتجع الحالي");
        const result = await currentRecipientReturnAdapter.createReturn({ sourceDeliveryDocumentId: issue.note.deliveryDocumentId, returnedQuantity: physicalTake,
          reason: `مرتجع غير مستخدم من مهمة PM V2 ${pending.taskNumber}`, returnedById: actorUserId });
        const insertDb = await requireDb();
        await insertDb.insert(pmv2ItemActions).values({ taskItemId, visitId: Number((await insertDb.select({ visitId: pmv2ItemActions.visitId }).from(pmv2ItemActions).where(eq(pmv2ItemActions.id, input.declarationActionId)).limit(1))[0]?.visitId),
          action: MATERIAL_RETURN_PART_LINKED_ACTION,
          note: JSON.stringify({ version: 1, declarationActionId: input.declarationActionId, routeDecisionActionId: declaration.routeDecisionActionId,
            sourceDeliveryDocumentId: issue.note.deliveryDocumentId, returnId: result.returnId, returnNumber: result.returnNumber,
            lotId: allocation.lotId, lotCode: result.lotCode, quantity: physicalTake,...(!declaration.physicalMode?{originalQuantity:take}: {}) } satisfies ReturnPartNote), performedById: actorUserId });
        posted.push(result); remaining = roundQuantity(remaining - take);
        returnedByDelivery.set(issue.note.deliveryDocumentId,roundQuantity(Number(returnedByDelivery.get(issue.note.deliveryDocumentId)||0)+physicalTake));
      }
      if (remaining > 0.0005) throw new Pmv2TeamIssueHandoffError("تعذر توزيع كامل كمية المرتجع على سندات الصرف الأصلية");
    }

    const refreshed = (await this.listPendingReturns()).find((item) => item.declarationActionId === input.declarationActionId);
    if (!refreshed) {
      const finishDb = await requireDb();
      await finishDb.transaction(async (tx: any) => {
        await finalizeConsumptionWithDb(tx, input.declarationActionId, declaration);
        const decl = await tx.select({ visitId: pmv2ItemActions.visitId }).from(pmv2ItemActions).where(eq(pmv2ItemActions.id, input.declarationActionId)).limit(1);
        await tx.insert(pmv2ItemActions).values({ taskItemId, visitId: Number(decl[0]?.visitId), action: MATERIAL_RETURN_COMPLETED_ACTION,
          note: JSON.stringify({ version: 1, declarationActionId: input.declarationActionId, returnedQuantity: declaration.toReturnQuantity,...(declaration.physicalMode?{physicalMode:true}: {}) }), performedById: actorUserId });
      });
    }
    return { completed: !refreshed, posted, remainingReturnQuantity: refreshed?.remainingReturnQuantity || 0 };
  }
}

export const pmv2TeamIssueHandoffService = new Pmv2TeamIssueHandoffService();

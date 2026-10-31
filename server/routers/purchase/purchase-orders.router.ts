import { pricingBundlesEnabled, reservedPricingItemIds, assertItemOutsidePricingBundle } from "../../services/delegate-pricing-bundles/reservations";
import { isDelegateSupplyItemOpen } from "../../../shared/delegateSupplyStage";
import { delegateCompletedInput } from "../../../shared/delegate-completed";
import { listDelegateCompleted } from "../../services/delegate-completed";
import { isDelegateOwnPurchaseDraft } from "../../../shared/purchaseDraftVisibility";
import { isItTeamRole } from "@shared/roles";
import { assertLegacyTeamExecutionAllowed } from "../maintenance-teams/execution.guard";
import { createTicketMaterialPurchase } from "../maintenance-teams/purchase-form";
import { TeamTicketError } from "../../../shared/maintenance-team-tickets/model";
import { ticketPurchaseBreakdown, MAX_TICKET_PURCHASE_QUANTITY } from "../../../shared/maintenance-team-tickets/purchase-quantities";
import { withPurchaseSubmissionTime } from "../../../shared/purchaseSubmissionTime";
import { comparePurchaseRequiredDates, resolvePurchaseItemNeedTiming } from "../../../shared/purchaseItemNeedDate";
import { purchaseItemNeedTimingShape, validatePurchaseItemNeedTiming } from "./item-need-timing";
import { and, eq, sql } from "drizzle-orm";
import { itPurchaseNeeds, purchaseOrderItems, purchaseOrders } from "../../../drizzle/schema";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { router, protectedProcedure, managerProcedure, warehouseProcedure, delegateProcedure, inventoryReadProcedure } from "../_shared/procedures";
import * as db from "../../_core/db";
import { notifyOwner } from "../../_core/notification";
import { detectLanguage, type SupportedLanguage } from "../../services/translation/translation";
import { queueTranslation } from "../../services/translation/translationEngine";
import { localizeNamedRecords, localizeMasterDataReferences } from "../../services/translation/localizedMasterData";
import { notifyItemRejection } from "../_shared/router-helpers";
import { generatePurchaseRequestPDF } from "../../services/export/exportService";
import { storagePut } from "../../_core/storage";
import { prepareIdeaExecution, linkCreatedExecution, validateDirectIdeaPurchaseContext, assertNotTrackedIdeaSource } from "../../services/improvement-ideas/execution";
import { findKnownInactiveCatalogUnitNames } from "../../_core/catalog-unit-governance";
import { assertPurchaseCatalogBaseUnits } from "../../services/purchase-catalog-units";
import { assertCanViewPurchaseOrder, filterVisiblePurchaseOrders, assertCanPerformPOAction, assertCanPerformItemPOAction, assertPOItemAssignedToDelegate, isItemAssignedToPODelegate, assertCanPerformItemStatusPOAction, assertCanResolveReturnedPOItem, assertCanRequestDelegateChange, assertCanResolveDelegateChange } from "../../_core/authz/guard";
import { OWN_REQUESTS_ONLY_ROLES } from "../../_core/authz/policy";
import { computeActionablePOs, getDelegateItemActionMode } from "./actionable";
import { rejectEmptyPendingPricingBatches } from "./pricing-batch-state";
import {
  assertCanCreateTicketLinkedPurchaseOrder,
  syncPathBTicketFromPurchaseOrder,
  syncPathBTicketFromTicketId,
} from "./ticket-purchase-workflow";
import {
  Pmv2WarehousePurchaseHandoffError,
  pmv2WarehousePurchaseHandoffService,
} from "../../pmv2/materials/warehouse-purchase-handoff-service";
import {
  hasActualDeliveryRecipient,
  isPendingTicketMaterialLink,
  shouldExposeTicketMaterialLink,
} from "@shared/ticketMaterialDelivery";
import { resolveInventoryLotForIssue, isInventoryLotsEnabled } from "../../_core/inventory-lots";
import { issueCostAllocationsSchema } from "../inventory/issue-cost-allocation.schema";
import { APP_ROLE, MAINTENANCE_RESPONSIBLE_DEPARTMENT, canRoleViewAllPurchaseSupplyTracking } from "@shared/roles";
import { createTranslatedProcurementComment, queuePurchaseTranslation } from "./translation-queue";
import { isPurchasePdfApprover, purchaseDocumentPermission, withPurchaseDocumentPermissions } from "../../_core/authz/purchase-document";
import { loadDocumentListPort } from "../../_core/db/document-list";
import { reserveReplacementPricing, markReplacementPurchased } from "../../supplier-return-followup/pricing-bridge";
import { trialEnabled, readRows } from "../../supplier-return-followup/runtime";

// ── دالة مشتركة: ترجمة أصناف طلب الشراء في الخلفية ──────────────────────────
async function queuePOItemsTranslation(items: any[], userId: number): Promise<void> {
  for (const item of items) {
    if (!item.itemName || !item.id) continue;
    const fields = [
      { fieldName: "itemName", text: item.itemName },
      ...(item.description ? [{ fieldName: "description", text: item.description }] : []),
      ...(item.notes ? [{ fieldName: "notes", text: item.notes }] : []),
    ];
    queueTranslation({
      entityType: "PO_ITEM",
      entityId: item.id,
      fields,
      sourceLanguage: await detectLanguage(item.itemName).catch(() => "ar" as const),
      userId,
    }).catch(e => console.error("[PO_ITEM] Queue translation failed:", e));
  }
}

// ── دالة مشتركة: ترجمة ملاحظات طلب الشراء في الخلفية ────────────────────────
async function localizePurchaseUserNames<T extends Record<string, any>>(rows: T[], language: SupportedLanguage): Promise<T[]> {
  if (!rows.length) return rows;
  rows = rows.map(row => typeof row.poNumber === "string" && "submittedAt" in row
    ? withPurchaseSubmissionTime(row)
    : row);
  const refs = [
    ["requestedById", "requestedByName"],
    ["reviewedById", "reviewedByName"],
    ["accountingApprovedById", "accountingApprovedByName"],
    ["managementApprovedById", "managementApprovedByName"],
    ["delegateId", "delegateName"],
    ["actorUserId", "actorName"],
  ] as const;
  const sourceNames = new Map<number, string>();
  const collect = (row: any) => {
    for (const [idField, nameField] of refs) {
      if (row?.[idField] && row?.[nameField]) sourceNames.set(Number(row[idField]), String(row[nameField]));
    }
    if (row?.item && typeof row.item === "object") collect(row.item);
    if (Array.isArray(row?.items)) row.items.forEach(collect);
    if (Array.isArray(row?.history)) row.history.forEach(collect);
    if (Array.isArray(row?.events)) row.events.forEach(collect);
  };
  rows.forEach(collect);
  if (!sourceNames.size) return rows;
  const localized = await localizeNamedRecords(
    "USER",
    Array.from(sourceNames, ([id, name]) => ({ id, name })),
    language,
  );
  const names = new Map(localized.map((entry) => [entry.id, entry.name]));
  const apply = (row: any): any => {
    const result = { ...row };
    for (const [idField, nameField] of refs) {
      const id = Number(row?.[idField]);
      if (id && names.has(id) && row?.[nameField]) result[nameField] = names.get(id);
    }
    if (row?.item && typeof row.item === "object") result.item = apply(row.item);
    if (Array.isArray(row?.items)) result.items = row.items.map(apply);
    if (Array.isArray(row?.history)) result.history = row.history.map(apply);
    if (Array.isArray(row?.events)) result.events = row.events.map(apply);
    return result;
  };
  return rows.map(apply);
}

async function queuePONotesTranslation(poId: number, notes: string, userId: number): Promise<void> {
  queueTranslation({
    entityType: "PO",
    entityId: poId,
    fields: [{ fieldName: "notes", text: notes }],
    sourceLanguage: await detectLanguage(notes).catch(() => "ar" as const),
    userId,
  }).catch(e => console.error("[PO] Queue translation failed:", e));
}

async function assertTicketAllowsNewPurchaseOrder(
  user: { id: number; role: string },
  ticketId?: number,
  options: { currentPurchaseOrderId?: number; submittingExistingDraft?: boolean; ticketItemId?: number } = {},
): Promise<any | null> {
  return assertCanCreateTicketLinkedPurchaseOrder(user, ticketId, options);
}

function mapPmv2AtomicPurchaseError(error: unknown): never {
  if (error instanceof Pmv2WarehousePurchaseHandoffError) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: error.message });
  }
  throw error;
}

function assertPmv2PurchaseCreateShape(input: {
  pmv2RequestItemId?: number;
  ticketId?: number;
  ticketItemId?: number;
  items: Array<unknown>;
}) {
  if (!input.pmv2RequestItemId) return;
  if (input.ticketId || input.ticketItemId) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "لا يمكن دمج ارتباط PM V2 وارتباط البلاغ في طلب شراء واحد" });
  }
  if (input.items.length !== 1) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "طلب الشراء المرتبط بـ PM V2 يجب أن يحتوي على صنف واحد فقط" });
  }
}

type PurchaseOrderContextInput = {
  ticketId?: number | null;
  siteId?: number | null;
  sectionId?: number | null;
  assetId?: number | null;
  categoryId?: number | null;
};

type PurchaseOrderItemContextInput = {
  itemName?: string;
  siteId?: number | null;
  sectionId?: number | null;
  assetId?: number | null;
  categoryId?: number | null;
};

async function resolveAndValidatePurchaseOrderItemContexts(
  items: PurchaseOrderItemContextInput[],
  header: { siteId: number; sectionId: number; assetId: number | null; categoryId: number | null },
  options: { requireCategory: boolean },
) {
  const resolved = items.map(item => ({
    siteId: item.siteId ?? header.siteId,
    sectionId: item.sectionId ?? header.sectionId,
    assetId: item.assetId === undefined ? header.assetId : item.assetId,
    categoryId: item.categoryId === undefined ? header.categoryId : item.categoryId,
  }));

  const [sites, sections, assets, categories] = await Promise.all([
    db.getAllSites(), db.getSections(), db.listAssets({}), db.listCenterCategories(false),
  ]);
  const siteIds = new Set(sites.map((row: any) => Number(row.id)));
  const sectionById = new Map(sections.map((row: any) => [Number(row.id), row]));
  const assetById = new Map(assets.map((row: any) => [Number(row.id), row]));
  const categoryById = new Map(categories.map((row: any) => [Number(row.id), row]));

  resolved.forEach((context, index) => {
    const label = items[index]?.itemName?.trim() || `#${index + 1}`;
    if (!siteIds.has(Number(context.siteId))) throw new TRPCError({ code: "BAD_REQUEST", message: `الموقع مطلوب للصنف ${label}` });
    const section = sectionById.get(Number(context.sectionId));
    if (!section || Number((section as any).siteId) !== Number(context.siteId)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: `القسم غير مرتبط بالموقع للصنف ${label}` });
    }
    if (options.requireCategory && !context.categoryId) {
      throw new TRPCError({ code: "BAD_REQUEST", message: `التصنيف مطلوب للصنف ${label}` });
    }
    if (context.categoryId) {
      const category = categoryById.get(Number(context.categoryId));
      if (!category) throw new TRPCError({ code: "BAD_REQUEST", message: `التصنيف غير موجود للصنف ${label}` });
      if (!Number((category as any).isActive)) throw new TRPCError({ code: "BAD_REQUEST", message: `التصنيف معطّل للصنف ${label}` });
    }
    if (context.assetId) {
      const asset = assetById.get(Number(context.assetId));
      if (!asset || Number((asset as any).siteId) !== Number(context.siteId) || Number((asset as any).sectionId) !== Number(context.sectionId)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `الأصل غير مرتبط بالموقع والقسم للصنف ${label}` });
      }
    }
  });
  return resolved;
}

async function resolveAndValidatePurchaseOrderContext(
  input: PurchaseOrderContextInput,
  options: { allowInactiveCategoryId?: number | null } = {},
) {
  let siteId = input.siteId ?? null;
  let sectionId = input.sectionId ?? null;
  let assetId = input.assetId ?? null;
  const categoryId = input.categoryId ?? null;
  const assetWasProvided = input.assetId !== undefined;

  // الطلب المرتبط ببلاغ يرث سياق الموقع/القسم عند غيابهما. أما الأصل فيُورث فقط
  // إذا لم يُرسل الحقل أصلًا؛ إرسال null يعني أن المستخدم اختار صراحةً "بدون أصل".
  // هذا يحافظ على مسارات IT القديمة التي تنشئ الطلب مباشرة من داخل البلاغ، مع
  // إبقاء الأصل اختياريًا في نموذج طلب الشراء.
  if (input.ticketId && (!siteId || !sectionId || !assetWasProvided)) {
    const ticket = await db.getTicketById(input.ticketId);
    if (!ticket) throw new TRPCError({ code: "NOT_FOUND", message: "البلاغ المرتبط غير موجود" });
    if (!siteId && ticket.siteId) siteId = Number(ticket.siteId);
    if (!sectionId && ticket.sectionId) sectionId = Number(ticket.sectionId);
    if (!assetWasProvided && ticket.assetId) assetId = Number(ticket.assetId);
  }

  if (!siteId || !sectionId) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "الموقع والقسم مطلوبان في طلب الشراء" });
  }

  const site = await db.getSiteById(siteId);
  if (!site) throw new TRPCError({ code: "BAD_REQUEST", message: "الموقع المحدد غير موجود" });

  const siteSections = await db.getSections(siteId);
  const section = siteSections.find((row: any) => Number(row.id) === Number(sectionId));
  if (!section) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "القسم المحدد غير مرتبط بالموقع المختار" });
  }

  if (assetId) {
    const asset = await db.getAssetById(assetId);
    if (!asset) throw new TRPCError({ code: "BAD_REQUEST", message: "الأصل المحدد غير موجود" });
    if (Number(asset.sectionId || 0) !== Number(sectionId)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "الأصل المحدد غير مرتبط بالقسم المختار" });
    }
    if (asset.siteId && Number(asset.siteId) !== Number(siteId)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "الأصل المحدد غير مرتبط بالموقع المختار" });
    }
  }

  if (categoryId) {
    const category = await db.getCenterCategoryById(categoryId);
    if (!category) throw new TRPCError({ code: "BAD_REQUEST", message: "تصنيف طلب الشراء غير موجود" });
    const isExistingInactive = Number(options.allowInactiveCategoryId || 0) === Number(categoryId);
    if (!category.isActive && !isExistingInactive) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "لا يمكن اختيار تصنيف معطّل" });
    }
  }

  return { siteId, sectionId, assetId: assetId || null, categoryId: categoryId || null };
}

async function assertValidCatalogItemLinks(
  items: Array<{ id?: number; catalogItemId?: number | null }>,
  existingItems: Array<{ id: number; catalogItemId?: number | null }> = [],
): Promise<void> {
  const requestedIds = Array.from(new Set(
    items
      .map(item => item.catalogItemId)
      .filter((id): id is number => typeof id === "number")
  ));
  if (requestedIds.length === 0) return;

  // أولاً: لا نسمح أبداً بهوية تشير إلى Master Item مفقود.
  const existingCatalogIds = new Set(await db.getExistingCatalogItemIds(requestedIds));
  const missingIds = requestedIds.filter(id => !existingCatalogIds.has(id));
  if (missingIds.length > 0) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `أحد أصناف الكتالوج المحددة غير موجود: ${missingIds.join(", ")}`,
    });
  }

  // 2B-10-2B: الرابط الجديد فقط يجب أن يكون إلى Catalog Item نشط.
  // إذا كانت مسودة قديمة تحمل نفس catalogItemId ثم تم تعطيل الصنف لاحقاً،
  // نسمح بحفظ بقية تعديلات المسودة دون إجبار المستخدم على كسر الهوية التاريخية.
  const previousCatalogByPoItemId = new Map(
    existingItems.map(item => [Number(item.id), item.catalogItemId == null ? null : Number(item.catalogItemId)]),
  );
  const newRelationshipIds = Array.from(new Set(items.flatMap(item => {
    const submittedCatalogItemId = item.catalogItemId == null ? null : Number(item.catalogItemId);
    if (!submittedCatalogItemId) return [];
    const previousCatalogItemId = item.id ? previousCatalogByPoItemId.get(Number(item.id)) : null;
    return previousCatalogItemId === submittedCatalogItemId ? [] : [submittedCatalogItemId];
  })));

  if (newRelationshipIds.length === 0) return;
  const activeCatalogIds = new Set(await db.getActiveCatalogItemIds(newRelationshipIds));
  const inactiveIds = newRelationshipIds.filter(id => !activeCatalogIds.has(id));
  if (inactiveIds.length > 0) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `لا يمكن إنشاء رابط جديد إلى صنف كتالوج غير نشط: ${inactiveIds.join(", ")}`,
    });
  }
}

async function assertNoInactiveCatalogUnitUsage(
  items: Array<{ id?: number; unit?: string | null }>,
  existingItems: Array<{ id: number; unit?: string | null }> = [],
): Promise<void> {
  const previousUnitByPoItemId = new Map(
    existingItems.map(item => [Number(item.id), (item.unit || "").trim()]),
  );

  const newlyUsedUnits = items.flatMap(item => {
    const submittedUnit = (item.unit || "").trim();
    if (!submittedUnit) return [];
    const previousUnit = item.id ? previousUnitByPoItemId.get(Number(item.id)) || "" : "";
    return previousUnit === submittedUnit ? [] : [submittedUnit];
  });

  const inactiveUnits = await findKnownInactiveCatalogUnitNames(newlyUsedUnits);
  if (inactiveUnits.length > 0) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `لا يمكن استخدام وحدة قياس معطّلة في طلب جديد: ${inactiveUnits.join(", ")}`,
    });
  }
}

async function getPurchaseOrderTicketContext(purchaseOrderId: number) {
  const po = await db.getPurchaseOrderById(purchaseOrderId);
  const ticket = po?.ticketId ? await db.getTicketById(po.ticketId) : null;
  const externalJob = ticket?.maintenancePath === "C"
    ? await db.getExternalMaintenanceJobByPurchaseOrderId(purchaseOrderId)
    : null;
  return { po, ticket, externalJob };
}

function shapeEnrichedPurchaseCycleItem(item: any, context: { po: any; ticket: any; externalJob: any } | undefined) {
  const { po, ticket, externalJob } = context || { po: null, ticket: null, externalJob: null };
  return {
    ...item,
    purchaseOrderNumber: po?.poNumber || null,
    purchaseOrderStatus: po?.status || null,
    ticketId: ticket?.id || null,
    ticketNumber: ticket?.ticketNumber || null,
    maintenancePath: item.itemMaintenancePath || ticket?.maintenancePath || null,
    isExternalMaintenance: (item.itemMaintenancePath || ticket?.maintenancePath) === "C" && !!externalJob,
    externalMaintenanceJobId: externalJob?.id || null,
    externalMaintenanceStatus: externalJob?.status || null,
    externalWarehouseReceivedAt: externalJob?.warehouseReceivedAt || null,
  };
}

// الحل الدائم لمشكلة N+1: استعلام مجمّع واحد لكل بنود القائمة بدل رحلة قاعدة
// بيانات مستقلة لكل بند. أي تبويب جديد يحتاج إثراء بنود بسياق طلب الشراء/البلاغ
// يجب أن يستخدم هذه الدالة، وليس enrichPurchaseCycleItem القديمة لكل بند.
async function enrichPurchaseCycleItemsBatch(items: any[]) {
  const contextMap = await db.getPurchaseOrderTicketContextBatch(items.map(i => i.purchaseOrderId));
  return items.map(item => shapeEnrichedPurchaseCycleItem(item, contextMap.get(item.purchaseOrderId)));
}

interface InventoryTicketDeliveryContext {
  purchaseOrderItemId: number | null;
  purchaseOrderId: number | null;
  purchaseOrderItemStatus: string | null;
  ticketItemId: number | null;
  ticketId: number | null;
  ticketNumber: string | null;
  ticketStatus: string | null;
  maintenancePath: string | null;
  assignedTechnicianId: number | null;
  assignedTechnicianName: string | null;
}

async function getInventoryTicketDeliveryContext(
  inventoryId: number,
  purchaseOrderItemId?: number | null,
): Promise<InventoryTicketDeliveryContext | null> {
  const database = await db.getDb();
  if (!database) return null;

  // عند مسح Lot نستخدم purchaseOrderItemId المحفوظ على نفس الدفعة كمصدر الحقيقة.
  // fallback القديم يبقى فقط للمخزون الذي لا يمرر Lot/PO item حتى لا نغيّر سلوكه.
  const safePurchaseOrderItemId = purchaseOrderItemId ? Number(purchaseOrderItemId) : null;
  const safeInventoryId = Number(inventoryId);
  const rows = safePurchaseOrderItemId
    ? await database.execute(`
      SELECT
        poi.id AS purchaseOrderItemId,
        poi.purchaseOrderId,
        poi.status AS purchaseOrderItemStatus,
        po.ticketId,
        po.ticketItemId,
        t.ticketNumber,
        t.status AS ticketStatus,
        t.maintenancePath,
        t.assignedToId AS assignedTechnicianId,
        assigned.name AS assignedTechnicianName
      FROM purchase_order_items poi
      LEFT JOIN purchase_orders po ON po.id = poi.purchaseOrderId
      LEFT JOIN tickets t ON t.id = po.ticketId
      LEFT JOIN users assigned ON assigned.id = t.assignedToId
      WHERE poi.id = ${safePurchaseOrderItemId}
      LIMIT 1
    `)
    : await database.execute(`
      SELECT
        wri.purchaseOrderItemId,
        poi.purchaseOrderId,
        poi.status AS purchaseOrderItemStatus,
        po.ticketId,
        po.ticketItemId,
        t.ticketNumber,
        t.status AS ticketStatus,
        t.maintenancePath,
        t.assignedToId AS assignedTechnicianId,
        assigned.name AS assignedTechnicianName
      FROM inventory inv
      LEFT JOIN warehouse_receipt_items wri
        ON wri.inventoryId = inv.id
       AND wri.receiptId = inv.receiptId
      LEFT JOIN purchase_order_items poi
        ON poi.id = wri.purchaseOrderItemId
      LEFT JOIN purchase_orders po
        ON po.id = poi.purchaseOrderId
      LEFT JOIN tickets t
        ON t.id = po.ticketId
      LEFT JOIN users assigned
        ON assigned.id = t.assignedToId
      WHERE inv.id = ${safeInventoryId}
      ORDER BY wri.id DESC
      LIMIT 1
    `);

  const row = ((rows as any)?.[0] || [])[0] as any;
  if (!row) return null;
  return {
    purchaseOrderItemId: row.purchaseOrderItemId ? Number(row.purchaseOrderItemId) : null,
    purchaseOrderId: row.purchaseOrderId ? Number(row.purchaseOrderId) : null,
    purchaseOrderItemStatus: row.purchaseOrderItemStatus ?? null,
    ticketItemId: row.ticketItemId ? Number(row.ticketItemId) : null,
    ticketId: row.ticketId ? Number(row.ticketId) : null,
    ticketNumber: row.ticketNumber ?? null,
    ticketStatus: row.ticketStatus ?? null,
    maintenancePath: row.maintenancePath ?? null,
    assignedTechnicianId: row.assignedTechnicianId ? Number(row.assignedTechnicianId) : null,
    assignedTechnicianName: row.assignedTechnicianName ?? null,
  };
}

async function assertActualDeliveryRecipient(
  deliveredToId?: number | null,
  linkedTicket?: any | null,
): Promise<any> {
  if (linkedTicket) await assertLegacyTeamExecutionAllowed(linkedTicket);
  if (!hasActualDeliveryRecipient(deliveredToId)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "يجب اختيار الفني المستلم فعليًا قبل تأكيد التسليم",
    });
  }
  const recipient = await db.getUserById(Number(deliveredToId));
  if (!recipient || (recipient as any).isActive === 0) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "الفني المستلم غير موجود أو غير نشط" });
  }
  if ((recipient as any).role === APP_ROLE.TECHNICIAN) return recipient;

  // مدير IT أو عضو فريق IT النشط يستلم مواد بلاغ IT من المسار B.
  const isScopedItRecipient =
    isItTeamRole((recipient as any).role) &&
    linkedTicket?.maintenancePath === "B" &&
    linkedTicket?.maintenanceResponsibleDepartment === MAINTENANCE_RESPONSIBLE_DEPARTMENT.IT;
  if (!isScopedItRecipient) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "المستلم الفعلي يجب أن يكون فنيًا، أو عضو فريق IT المسند إليه بلاغ IT المرتبط",
    });
  }
  return recipient;
}

async function syncAndNotifyTicketMaterialDelivery(params: {
  purchaseOrderId: number;
  ticketId: number;
  actorId: number;
  actualRecipientId: number;
  actualRecipientName: string;
}): Promise<string | null> {
  const before = await db.getTicketById(params.ticketId);
  await syncPathBTicketFromPurchaseOrder(
    params.purchaseOrderId,
    params.actorId,
    "تم تسليم مادة مرتبطة بالبلاغ من المخزون",
  );
  const after = await db.getTicketById(params.ticketId);
  if (!after) return null;

  const justUnlockedRepair =
    before?.status !== "received_warehouse" && after.status === "received_warehouse";
  if (!justUnlockedRepair) return after.status;

  if (after.assignedToId) {
    await db.createNotification({
      userId: after.assignedToId,
      title: "📦 اكتمل تسليم مواد البلاغ - ابدأ الإصلاح",
      message: `اكتمل تسليم جميع مواد البلاغ ${after.ticketNumber}. المستلم الفعلي لآخر عملية: ${params.actualRecipientName}. يمكنك الآن بدء الإصلاح.`,
      type: "info",
      relatedTicketId: after.id,
    });
  }

  if (params.actualRecipientId !== after.assignedToId) {
    await db.createNotification({
      userId: params.actualRecipientId,
      title: "📦 استلام مواد نيابة عن فني البلاغ",
      message: `تم توثيق استلام مواد البلاغ ${after.ticketNumber} باسمك. يبقى البلاغ مسندًا للفني المسؤول المسجل في البلاغ.`,
      type: "info",
      relatedTicketId: after.id,
    });
  }

  const managers = await db.getTicketWorkflowManagerUsers(after);
  for (const manager of managers) {
    if (manager.id === params.actorId) continue;
    await db.createNotification({
      userId: manager.id,
      title: "📦 اكتمل تسليم مواد البلاغ",
      message: `اكتمل تسليم جميع مواد البلاغ ${after.ticketNumber}. المستلم الفعلي: ${params.actualRecipientName}. بانتظار بدء الإصلاح.`,
      type: "info",
      relatedTicketId: after.id,
    });
  }

  return after.status;
}


/**
 * [DELEGATE-PRICING-DOC 2026-08-31] أرشفة نسخة التسعير الصادرة من المندوب
 * لحظة إرسال دفعة تسعير طلب مفرد إلى الحسابات. الارتباط هنا بـ Pricing Batch
 * نفسه، ولا يغيّر أي حالة أو انتقال Workflow. فشل الأرشفة لا يلغي الإرسال
 * الناجح؛ تُعاد النتيجة للواجهة كي تُظهر تنبيهًا واضحًا للمستخدم.
 */
async function archiveDelegatePricingBatchPdf(args: {
  poId: number;
  poNumber: string;
  batchId: number;
  batchNumber: number;
  delegateId: number;
}): Promise<boolean> {
  try {
    const buffer = await generatePurchaseRequestPDF(args.poId, args.delegateId, args.batchId);
    const fileName = `${args.poNumber}-دفعة${args.batchNumber}-تسعير-مندوب.pdf`;
    const key = `cmms/delegate-pricing-documents/po-${args.poId}/batch-${args.batchId}-${Date.now()}.pdf`;
    const { key: fileKey } = await storagePut(key, buffer, "application/pdf");
    const proxyUrl = `/api/media?key=${encodeURIComponent(fileKey)}`;

    await db.createAttachment({
      entityType: "delegate_pricing_batch",
      entityId: args.batchId,
      fileName,
      fileUrl: proxyUrl,
      fileKey,
      mimeType: "application/pdf",
      fileSize: buffer.length,
      uploadedById: args.delegateId,
    });
    return true;
  } catch (e: any) {
    console.error("[ArchiveDelegatePricingBatchPdf] Failed:", e?.message || e);
    return false;
  }
}

/**
 * [PB 2026-08-29] منطق إرسال دفعة تسعير طلب واحد للحسابات.
 *
 * مستخرَج حرفيًا من إجراء submitPricedBatch (بلا أي تغيير في المنطق أو
 * الترتيب أو الرسائل) ليشاركه مسار إرسال الحزمة، فلا يوجد موضعان لنفس
 * المنطق يمكن أن ينحرف أحدهما عن الآخر.
 *
 * opts اختيارية بالكامل: استدعاؤها بدونها ينتج **نفس** السلوك السابق
 * حرفيًا (scope يبقى 'single' بالقيمة الافتراضية، و
 * purchasePackageSubmissionId يبقى NULL). تُمرَّر فقط من مسار الحزمة.
 */
export async function finalizePricedBatchForPO(purchaseOrderId: number, user: { id: number; name?: string | null }, po: any, batchId: number, batchNumber: number, readyItems: any[]) {
  // أخطر المحاسبين بالدفعة الجديدة
  const accountants = await db.getUsersByRole("accountant");
  for (const acc of accountants) {
    await db.createNotification({
      userId: acc.id,
      title: "طلب شراء بانتظار الاعتماد",
      message: `طلب شراء رقم ${po.poNumber} — دفعة جديدة رقم ${batchNumber} (${readyItems.length} صنف) بانتظار اعتماد الحسابات.`,
      type: "warning",
      relatedPoId: purchaseOrderId,
    });
  }

  await syncPathBTicketFromPurchaseOrder(purchaseOrderId, user.id, "تم إرسال دفعة التسعير إلى الحسابات");

  await db.createAuditLog({
    userId: user.id,
    action: "submit_pricing_batch",
    entityType: "purchase_order",
    entityId: purchaseOrderId,
    newValues: { batchId, batchNumber, itemCount: readyItems.length },
  });

}

export async function submitPricedBatchForPO(
  purchaseOrderId: number,
  user: { id: number; role: string; [key: string]: any },
  opts?: { purchasePackageSubmissionId?: number; selectedItemIds?: number[]; tx?: any; skipArchive?: boolean; bundleId?: number; delegateSignatureSnapshot?: string | null },
) {
  if (pricingBundlesEnabled() && user.role === "delegate" && !opts?.bundleId) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "أضف الأصناف إلى حزمة التسعير ثم أرسلها من شاشة الحزمة" });
  const po = await db.getPurchaseOrderById(purchaseOrderId, opts?.tx);
  if (!po) throw new TRPCError({ code: "NOT_FOUND", message: "طلب الشراء غير موجود" });

  const allItems = await db.getPOItems(purchaseOrderId, opts?.tx);
  if (opts?.selectedItemIds && (!opts.tx || !opts.bundleId)) throw new TRPCError({ code: "BAD_REQUEST", message: "إرسال أصناف محددة يتطلب معاملة الحزمة المقفلة" });
  const selected = opts?.selectedItemIds ? new Set(opts.selectedItemIds) : null;
  const reserved = opts?.bundleId ? new Set<number>() : await reservedPricingItemIds(pricingBundlesEnabled() ? (opts?.tx || await db.getDb()) : null, allItems.map((i: any) => i.id));
  const included = (i: any) => (!selected || selected.has(i.id)) && !reserved.has(i.id);
  const blockedEstimatedItems = allItems.filter(
    (i: any) => included(i) && i.status === "estimated" && !i.batchId && i.delegateChangeRequestedAt && isItemAssignedToPODelegate(user as any, i)
  );
  if (blockedEstimatedItems.length > 0) {
    throw new TRPCError({ code: "CONFLICT", message: "لا يمكن إرسال صنف للحسابات أثناء وجود طلب تغيير مندوب معلّق" });
  }
  // الأصناف الجاهزة للإرسال: مسعّرة، غير مرسلة، ولا يوجد عليها طلب تغيير مندوب
  const readyItems = allItems.filter(
    (i: any) => included(i) && i.status === "estimated" && !i.batchId && !i.delegateChangeRequestedAt && isItemAssignedToPODelegate(user as any, i)
  );

  if (readyItems.length === 0) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "لا توجد أصناف مسعّرة جاهزة للإرسال للحسابات" });
  }

  if (selected && readyItems.length !== selected.size) throw new TRPCError({ code: "CONFLICT", message: "تغيرت أصناف الحزمة قبل الإرسال" });
  // Compensation remains in the existing pricing workflow. Reserve the
  // returned supplier credit before the accounting batch is inserted, under
  // the same bundle transaction. Normal purchase orders return immediately.
  let replacementCompensation: Awaited<ReturnType<typeof reserveReplacementPricing>> = null;
  if (opts?.tx) {
    replacementCompensation = await reserveReplacementPricing(opts.tx, user.id, purchaseOrderId, readyItems.map((item: any) => ({ id: item.id, estimatedTotalCost: item.estimatedTotalCost })));
  } else {
    const database = await db.getDb();
    if (database && await trialEnabled(database)) {
      const [replacement] = await readRows(database, sql`SELECT id FROM supplier_return_replacement_plans WHERE purchaseOrderId=${purchaseOrderId} LIMIT 1`);
      if (replacement) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "أرسل تسعير البديل من حزمة التسعير حتى يُحجز رصيد المرتجع مع الدفعة في معاملة واحدة" });
    }
  }
  const batchNumber = await db.getNextBatchNumber(purchaseOrderId, opts?.tx);
  const totalBatchCost = readyItems.reduce((sum: number, i: any) => sum + parseFloat(i.estimatedTotalCost || "0"), 0);

  const batchId = await db.createPOPricingBatch({
    purchaseOrderId,
    batchNumber,
    submittedById: user.id,
    itemCount: readyItems.length,
    totalEstimatedCost: String(totalBatchCost),
    status: "pending_accounting",
    ...(opts?.bundleId && { delegateSignatureSnapshot: opts.delegateSignatureSnapshot ?? null }),
    // [PB] يُضبطان معًا فقط عند الإرسال ضمن حزمة. بدونهما يبقى السلوك
    // مطابقًا للإرسال العادي حرفيًا.
    ...(opts?.purchasePackageSubmissionId != null && {
      purchasePackageSubmissionId: opts.purchasePackageSubmissionId,
      scope: "multi" as const,
    }),
  } as any, opts?.tx);

  for (const item of readyItems) {
    await db.updatePOItem(item.id, { batchId }, opts?.tx, {
      actorUserId: user.id,
      actorName: user.name || null,
      eventType: "pricing_batch_changed",
      note: `إرسال الصنف ضمن دفعة التسعير رقم ${batchNumber}`,
      metadata: { batchNumber },
    });
  }

  // أي دفعة تسعير جديدة (أولى أو لاحقة) تُعيد الطلب لحالة "بانتظار اعتماد الحسابات"
  // بغض النظر عن المرحلة التي وصلها الطلب سابقاً (approved / partial_purchase / purchased...)،
  // حتى يظهر بشكل صحيح عند الفلترة من شاشة الحسابات/الإدارة العليا، ولا يُشترط تسعير الطلب بالكامل.
  // الاستثناء الوحيد: طلب مغلق أو مرفوض نهائياً لا يجب أن تتغير حالته.
  if (!["closed", "rejected"].includes(po.status)) {
    await db.updatePurchaseOrder(purchaseOrderId, { status: "pending_accounting" }, opts?.tx);
  }

  if (!opts?.bundleId) await finalizePricedBatchForPO(purchaseOrderId, user, po, Number(batchId), Number(batchNumber), readyItems);

  // داخل الحزمة نؤرشف مستندًا واحدًا للإرسال كله بعد اكتمال جميع طلباته،
  // لذلك لا ننشئ هنا مستندًا منفصلًا لكل PR تابع للحزمة.
  const pricingDocumentArchived = !opts?.skipArchive && opts?.purchasePackageSubmissionId == null
    ? await archiveDelegatePricingBatchPdf({
        poId: purchaseOrderId,
        poNumber: po.poNumber,
        batchId: Number(batchId),
        batchNumber: Number(batchNumber),
        delegateId: user.id,
      })
    : null;

  return {
    success: true,
    batchId,
    batchNumber,
    itemCount: readyItems.length,
    ...(replacementCompensation ? { replacementCompensation } : {}),
    pricingDocumentArchived,
  };
}

export const purchaseOrdersRouter = router({
  documentPermission: protectedProcedure.input(z.object({
    poId: z.number().int().positive(), batchId: z.number().int().positive().optional(), submissionId: z.number().int().positive().optional(),
  })).query(({ ctx, input }) => purchaseDocumentPermission(ctx.user, input.poId, input.batchId, input.submissionId)),
  cancelItem: protectedProcedure.input(z.object({
    itemId: z.number(),
    reason: z.string().optional(),
  })).mutation(async ({ input, ctx }) => {
    const item = await db.getPOItemById(input.itemId);
    if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "الصنف غير موجود" });
    const po = await db.getPurchaseOrderById(item.purchaseOrderId);
    if (!po) throw new TRPCError({ code: "NOT_FOUND", message: "طلب الشراء غير موجود" });

    // إلغاء الصنف الإداري مرتبط بمرحلة الدور، وليس بمجرد امتلاك الدور:
    // مدير الصيانة في draft/pending_review، والإدارة العليا في pending_management،
    // بينما owner/admin يحتفظان بالتجاوز المطلق.
    assertCanPerformPOAction("cancelItem", ctx.user, po);
    // Cannot cancel already delivered items
    if (item.status === "delivered_to_requester") {
      throw new TRPCError({ code: "BAD_REQUEST", message: "لا يمكن إلغاء صنف تم تسليمه بالفعل" });
    }
    if (item.status === "cancelled") {
      throw new TRPCError({ code: "BAD_REQUEST", message: "الصنف ملغى بالفعل" });
    }
    const cancelReason = input.reason || "تم الإلغاء من قبل الإدارة";
    await db.updatePOItem(input.itemId, {
      status: "cancelled",
      managementRejectionReason: cancelReason,
    });
    // إذا كان الصنف آخر صنف فعّال داخل دفعة تسعير معلّقة، تُغلق الدفعة
    // فورًا حتى لا تبقى أزرار اعتماد الحسابات/الإدارة ظاهرة على دفعة فارغة.
    await rejectEmptyPendingPricingBatches(item.purchaseOrderId, {
      actorId: ctx.user.id,
      actorName: ctx.user.name,
      reason: `أُغلقت الدفعة تلقائيًا بعد إلغاء جميع أصنافها — آخر إلغاء بواسطة ${ctx.user.name || "مستخدم"}`,
    });
    if (po) {
      await notifyItemRejection({
        poId: po.id,
        poNumber: po.poNumber,
        requestedById: po.requestedById,
        itemId: item.id,
        itemName: item.itemName,
        actorId: ctx.user.id,
        actorName: ctx.user.name || "مستخدم",
        actorRole: ctx.user.role,
        reason: cancelReason,
        kind: "cancelled",
      });
    }
    // Check if all items are now terminal (rejected or cancelled) — auto-close PO if so
    const allItems = await db.getPOItems(item.purchaseOrderId);
    const allTerminal = allItems.every(i => i.status === "rejected" || i.status === "cancelled");
    if (allTerminal && po) {
      await db.updatePurchaseOrder(item.purchaseOrderId, {
        status: "rejected",
        rejectedById: ctx.user.id,
        rejectedAt: new Date(),
        rejectionReason: `تم إلغاء جميع أصناف طلب الشراء بواسطة ${ctx.user.name}`,
      });
      await db.createNotification({ userId: po.requestedById, title: "⚠️ تم إلغاء جميع أصناف طلب الشراء", message: `تم إلغاء جميع أصناف طلب الشراء رقم ${po.poNumber} بواسطة ${ctx.user.name}.`, type: "warning", relatedPoId: item.purchaseOrderId });
    }
    await syncPathBTicketFromPurchaseOrder(
      item.purchaseOrderId,
      ctx.user.id,
      "تم إلغاء صنف من طلب الشراء",
    );
    await db.createAuditLog({ userId: ctx.user.id, action: "cancel_po_item", entityType: "purchase_order_item", entityId: input.itemId, newValues: { reason: input.reason } });
    return { success: true };
  }),

  close: protectedProcedure.input(z.object({
    id: z.number(),
    note: z.string().optional(),
  })).mutation(async ({ input, ctx }) => {
    const po = await db.getPurchaseOrderById(input.id);
    if (!po) throw new TRPCError({ code: "NOT_FOUND" });
    if (po.requestedById !== ctx.user.id && !["admin", "owner"].includes(ctx.user.role)) {
      throw new TRPCError({ code: "FORBIDDEN", message: "ليس لديك صلاحية لإغلاق هذا الطلب" });
    }
    if (po.ticketId) {
      const linkedTicket = await db.getTicketById(po.ticketId);
      if (
        linkedTicket?.maintenancePath === "B" &&
        ["approved", "partial_purchase", "purchased", "received"].includes(po.status)
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "لا يمكن إغلاق طلب شراء للمسار B بعد بدء التنفيذ أو الاستلام؛ استخدم إجراءات إلغاء الأصناف المعتمدة حتى يبقى سجل الدورة صحيحاً",
        });
      }
    }

    await db.updatePurchaseOrder(input.id, { status: "closed" });

    if (input.note) {
      await createTranslatedProcurementComment(db, {
        purchaseOrderId: input.id,
        userId: ctx.user.id,
        userName: ctx.user.name || "User",
        userRole: ctx.user.role,
        actionType: "closed",
        note: `إغلاق الطلب: ${input.note}`,
      });
    }

    await syncPathBTicketFromPurchaseOrder(input.id, ctx.user.id, "تم إغلاق طلب الشراء");
    await db.createAuditLog({ userId: ctx.user.id, action: "close_po", entityType: "purchase_order", entityId: input.id });
    return { success: true };
  }),

  confirmDeliveryToRequester: warehouseProcedure.input(z.object({
    itemId:        z.number(),
    deliveredToId: z.number(),
    deliveryQty:   z.number().positive("الكمية يجب أن تكون أكبر من صفر"),
    deliveryUnit:  z.string().min(1, "الوحدة مطلوبة"),
    lotTrackingToken: z.string().trim().min(1).optional(),
    costAllocations: issueCostAllocationsSchema.optional(),
    notes:         z.string().optional(),
  })).mutation(async ({ input, ctx }) => {
    const item = await db.getPOItemById(input.itemId);
    if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "الصنف غير موجود" });
    assertCanPerformItemStatusPOAction("confirmDeliveryToRequester", ctx.user, item.status);

    const po = await db.getPurchaseOrderById(item.purchaseOrderId);
    if (!po) throw new TRPCError({ code: "NOT_FOUND", message: "طلب الشراء غير موجود" });

    const ticket = po.ticketId ? await db.getTicketById(po.ticketId) : null;
    const actualRecipient = await assertActualDeliveryRecipient(input.deliveredToId, ticket);
    if (ticket?.maintenancePath === "B" && !ticket.assignedToId) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "لا يمكن تسليم مواد البلاغ قبل وجود فني مسند له",
      });
    }

    const inventoryItem = await db.getInventoryByPOItemId(input.itemId);
    if (!inventoryItem) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "يجب إدخال الصنف إلى المخزون أولًا قبل تسليمه للفني",
      });
    }

    // PO quantities use purchase units; lot original quantities use stock/issue units.
    // A carton order must not cap a piece delivery at the number of cartons.
    let maximumIssueQuantity = Number((item as any).quantity || 0);
    if (isInventoryLotsEnabled()) {
      const connection = await db.getDb();
      if (!connection) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "تعذر قراءة كمية الاستلام بوحدة الصرف" });
      const received: any = await connection.execute(sql`SELECT COALESCE(SUM(originalQuantity),0) AS quantity FROM inventory_lots WHERE purchaseOrderItemId=${input.itemId}`);
      const receivedInIssueUnits = Number(received?.[0]?.[0]?.quantity || 0);
      maximumIssueQuantity = Math.min(Number(inventoryItem.quantity || 0), receivedInIssueUnits > 0 ? receivedInIssueUnits : maximumIssueQuantity);
    }
    if (input.deliveryQty > maximumIssueQuantity) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `الكمية المطلوبة (${input.deliveryQty}) أكبر من المتاح للتسليم بوحدة الصرف (${maximumIssueQuantity})`,
      });
    }

    const assignedTechnician = ticket?.assignedToId
      ? await db.getUserById(ticket.assignedToId)
      : null;

    const deliveryResult = await db.issueDelivery({
      inventoryId: inventoryItem.id,
      quantity: input.deliveryQty,
      unit: input.deliveryUnit,
      performedById: ctx.user.id,
      deliveredToId: input.deliveredToId,
      purchaseOrderItemId: input.itemId,
      ticketId: ticket?.maintenancePath === "B" ? ticket.id : undefined,
      ticketItemId: ticket?.maintenancePath === "B" ? po.ticketItemId ?? undefined : undefined,
      ticketNumber: ticket?.maintenancePath === "B" ? ticket.ticketNumber : undefined,
      assignedTechnicianId: ticket?.maintenancePath === "B" ? ticket.assignedToId ?? undefined : undefined,
      assignedTechnicianName: ticket?.maintenancePath === "B" ? (assignedTechnician as any)?.name ?? undefined : undefined,
      notes: input.notes || "تسليم للفني — طلب شراء",
      warehousePhotoUrl: (item as any).warehousePhotoUrl || undefined,
      markPurchaseOrderItemDelivered: true,
      lotTrackingToken: input.lotTrackingToken,
      costAllocations: input.costAllocations,
    });

    let ticketStatus: string | null = null;
    if (ticket?.maintenancePath === "B") {
      ticketStatus = await syncAndNotifyTicketMaterialDelivery({
        purchaseOrderId: item.purchaseOrderId,
        ticketId: ticket.id,
        actorId: ctx.user.id,
        actualRecipientId: input.deliveredToId,
        actualRecipientName: (actualRecipient as any).name || "فني",
      });
    } else {
      await syncPathBTicketFromPurchaseOrder(
        item.purchaseOrderId,
        ctx.user.id,
        "تم تحديث تسليم مواد طلب الشراء إلى الفني",
      );
    }

    await db.createAuditLog({
      userId: ctx.user.id,
      action: "deliver_to_requester",
      entityType: "po_item",
      entityId: input.itemId,
      newValues: {
        deliveredToId: input.deliveredToId,
        assignedTechnicianId: ticket?.assignedToId ?? null,
        deliveryQty: input.deliveryQty,
        ticketId: ticket?.id ?? null,
        lotId: deliveryResult.lotId ?? null,
        inventoryTransactionId: deliveryResult.inventoryTransactionId ?? null,
          costAllocationCount: deliveryResult.costAllocationCount ?? 0,
          allocatedCostTotal: deliveryResult.allocatedCostTotal ?? null,
      },
    });

    return { success: true, ...deliveryResult, ticketStatus };
  }),

  incrementPrintCount: warehouseProcedure.input(z.object({
    itemId: z.number(),
  })).mutation(async ({ input }) => {
    const item = await db.getPOItemById(input.itemId);
    if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "الصنف غير موجود" });
    const newCount = (item.printCount ?? 0) + 1;
    await db.updatePOItem(input.itemId, { printCount: newCount });
    return { printCount: newCount };
  }),

  confirmDeliveryToWarehouse: warehouseProcedure.input(z.object({
    itemId: z.number(),
    receivedQuantity: z.number().min(1, "الكمية يجب أن تكون أكبر من صفر"),
    supplierInvoiceNumber: z.string().min(1, "رقم فاتورة المورد مطلوب"),
    warehousePhotoUrl: z.string().min(1, "صورة الصنف مطلوبة"),
  })).mutation(async ({ input, ctx }) => {
    // Get the item
    const item = await db.getPOItemById(input.itemId);
    if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "الصنف غير موجود" });
    // ✅ الحارس المركزي: يفحص حالة الصنف نفسه (لا حالة الطلب ككل)
    assertCanPerformItemStatusPOAction("confirmDeliveryToWarehouse", ctx.user, item.status);
    await db.updatePOItem(input.itemId, {
      status: "delivered_to_warehouse",
      receivedAt: new Date(),
      receivedById: ctx.user.id,
      receivedQuantity: input.receivedQuantity,
      supplierInvoiceNumber: input.supplierInvoiceNumber,
      warehousePhotoUrl: input.warehousePhotoUrl,
    });
    const allItems = await db.getPOItems(item.purchaseOrderId);
    const activeItemsWH = allItems.filter(i => i.status !== "rejected" && i.status !== "cancelled");
    const allInWarehouse = activeItemsWH.length > 0 && activeItemsWH.every(i => ["delivered_to_warehouse", "delivered_to_requester"].includes(i.status));
    if (allInWarehouse) {
      await db.updatePurchaseOrder(item.purchaseOrderId, { status: "received" });
    }
    // Arrival at the warehouse does not unlock repair. Path B advances only
    // after every active item is delivered to the technician/requester.
    await syncPathBTicketFromPurchaseOrder(
      item.purchaseOrderId,
      ctx.user.id,
      "تم استلام مواد طلب الشراء في المستودع",
    );
    // Notify assigned technician and managers that item arrived at warehouse
    const poForNotif = await db.getPurchaseOrderById(item.purchaseOrderId);
    if (poForNotif?.ticketId) {
      const ticketForNotif = await db.getTicketById(poForNotif.ticketId);
      if (ticketForNotif?.assignedToId) {
        await db.createNotification({ userId: ticketForNotif.assignedToId, title: "📦 وصلت موادك للمستودع", message: `تم استلام الصنف "${item.itemName}" في المستودع. سيتم تسليمه لك قريباً.`, type: "info", relatedTicketId: poForNotif.ticketId });
      }
    }
    const managersWH = await db.getPurchaseManagerUsers();
    for (const mgr of managersWH) {
      await db.createNotification({ userId: mgr.id, title: "📦 وصلت بضاعة للمستودع", message: `استلم المستودع الصنف "${item.itemName}" بكمية ${input.receivedQuantity} — فاتورة المورد رقم ${input.supplierInvoiceNumber}`, type: "info", relatedPoId: item.purchaseOrderId });
    }
    await db.createAuditLog({ userId: ctx.user.id, action: "deliver_to_warehouse", entityType: "po_item", entityId: input.itemId, newValues: { receivedQuantity: input.receivedQuantity, supplierInvoiceNumber: input.supplierInvoiceNumber } });
    return { success: true, itemId: item.id, purchaseOrderId: item.purchaseOrderId,
      itemStatus: "delivered_to_warehouse" as const, purchaseOrderStatus: poForNotif?.status };
  }),

  cancelItemPurchase: delegateProcedure.input(z.object({
    itemId: z.number(),
    note: z.string().min(3, "يجب كتابة سبب إلغاء الشراء"),
  })).mutation(async ({ input, ctx }) => {
    const item = await db.getPOItemById(input.itemId);
    if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "الصنف غير موجود" });
    // ✅ الحارس المركزي: المندوب يلغي شراء صنفه المخصَّص له فقط (owner/admin يتجاوزان)
    assertPOItemAssignedToDelegate(ctx.user, item);

    // يُسمح بالإلغاء فقط للأصناف الجاهزة للشراء (approved أو funded)
    if (item.status !== "approved" && item.status !== "funded") {
      throw new TRPCError({ code: "BAD_REQUEST", message: "لا يمكن إلغاء شراء هذا الصنف في حالته الحالية" });
    }

    const po = await db.getPurchaseOrderById(item.purchaseOrderId);
    if (!po) throw new TRPCError({ code: "NOT_FOUND", message: "طلب الشراء غير موجود" });

    // تحديث الصنف لحالة إلغاء الشراء مع اسم المندوب الكامل
    await db.updatePOItem(input.itemId, {
      status: "purchase_cancelled",
      purchaseCancelReason: input.note,
      purchaseCancelledById: ctx.user.id,
      purchaseCancelledByName: ctx.user.name || "مندوب",
      purchaseCancelledAt: new Date(),
    });
    await queuePurchaseTranslation("PO_ITEM", input.itemId, [
      { fieldName: "purchaseCancelReason", text: input.note },
    ], ctx.user.id);

    // تعليق دائم في سجل الطلب
    await createTranslatedProcurementComment(db, {
      purchaseOrderId: po.id,
      purchaseOrderItemId: input.itemId,
      userId: ctx.user.id,
      userName: ctx.user.name || "مندوب",
      userRole: ctx.user.role,
      actionType: "purchase_cancelled",
      note: `الصنف: ${item.itemName}\n\nسبب إلغاء الشراء:\n${input.note}`,
    });

    // أخطر منشئ الطلب — الصنف بانتظار تصرفه: تعديل وإعادة إرسال، أو إلغاء نهائي
    await db.createNotification({
      userId: po.requestedById,
      title: "⛔ تعذّر شراء صنف - يحتاج تصرفك",
      message: `قام المندوب ${ctx.user.name} بإلغاء شراء الصنف "${item.itemName}" من طلب الشراء ${po.poNumber}.\n\nالسبب:\n${input.note}\n\nيمكنك تعديل الصنف وإعادة إرساله للمندوب مباشرة للشراء، أو إلغاءه نهائياً.`,
      type: "warning",
      relatedPoId: po.id,
    });

    // إعادة حساب حالة الطلب
    // الصنف في purchase_cancelled لم يُحسم مصيره بعد (بانتظار منشئ الطلب) — تماماً كـ needs_item_revision
    // لذلك لا يدخل في حساب "شراء كامل"، ويبقي الطلب شراء جزئي حتى يُحسم
    const allItems = await db.getPOItems(item.purchaseOrderId);
    const activeItems = allItems.filter(
      i => !["rejected", "cancelled", "needs_item_revision", "purchase_cancelled"].includes(i.status)
    );
    const purchasedOrLater = activeItems.filter(i =>
      ["purchased", "delivered_to_warehouse", "delivered_to_requester"].includes(i.status)
    );
    // أي صنف لم يُحسم بعد (مراجعة أو إلغاء شراء معلّق) يجعل الطلب "شراء جزئي" دائماً
    const hasPendingItems = allItems.some(i => i.status === "needs_item_revision" || i.status === "purchase_cancelled");

    if (activeItems.length > 0 && purchasedOrLater.length === activeItems.length) {
      // كل الأصناف الفعّالة اشتُريت → شراء كامل فقط إذا لا يوجد صنف معلّق بانتظار حسم
      const newStatus = hasPendingItems ? "partial_purchase" : "purchased";
      await db.updatePurchaseOrder(item.purchaseOrderId, { status: newStatus });

    } else if (activeItems.length === 0 && !hasPendingItems) {
      // كل الأصناف ملغاة أو مرفوضة (ولا يوجد معلّق) → الطلب منتهٍ
      await db.updatePurchaseOrder(item.purchaseOrderId, { status: "received" });
    } else {
      // يوجد صنف معلّق بانتظار حسم منشئ الطلب → الطلب شراء جزئي دائماً
      await db.updatePurchaseOrder(item.purchaseOrderId, { status: "partial_purchase" });

    }

    await syncPathBTicketFromPurchaseOrder(
      item.purchaseOrderId,
      ctx.user.id,
      "تم تحديث حالة شراء صنف مرتبط بالبلاغ",
    );

    await db.createAuditLog({
      userId: ctx.user.id,
      action: "cancel_item_purchase",
      entityType: "po_item",
      entityId: input.itemId,
      newValues: { status: "purchase_cancelled", note: input.note },
    });

    return { success: true };
  }),

  confirmItemPurchase: delegateProcedure.input(z.object({
    itemId: z.number(),
    purchasedPhotoUrl: z.string().min(1, "صورة الصنف المشترى مطلوبة"),
    invoicePhotoUrl: z.string().min(1, "صورة الفاتورة مطلوبة"),
  })).mutation(async ({ input, ctx }) => {
    const item = await db.getPOItemById(input.itemId);
    if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "الصنف غير موجود" });
    // ✅ الحارس المركزي: المندوب يؤكد شراء أصنافه المخصَّصة له فقط (owner/admin يتجاوزان)
    assertPOItemAssignedToDelegate(ctx.user, item);
    if (item.status !== "approved" && item.status !== "funded") {
      throw new TRPCError({ code: "BAD_REQUEST", message: "لا يمكن تأكيد شراء هذا الصنف في حالته الحالية" });
    }
    const purchaseContext = await getPurchaseOrderTicketContext(item.purchaseOrderId);
    const isExternalMaintenance =
      purchaseContext.ticket?.maintenancePath === "C" && !!purchaseContext.externalJob;

    const purchaseWrite = {
      status: "purchased",
      purchasedAt: new Date(),
      purchasedById: ctx.user.id,
      purchasedPhotoUrl: input.purchasedPhotoUrl,
      invoicePhotoUrl: input.invoicePhotoUrl,
    } as const;
    const purchaseDb = await db.getDb();
    const replacementLinked = purchaseDb && await trialEnabled(purchaseDb)
      ? (await readRows(purchaseDb, sql`SELECT id FROM supplier_return_replacement_plans WHERE purchaseOrderItemId=${input.itemId} LIMIT 1`)).length > 0
      : false;
    let replacementPurchase = false;
    if (replacementLinked) {
      try {
        await db.withTransaction(async tx => {
          replacementPurchase = await markReplacementPurchased(tx, ctx.user.id, input.itemId);
          if (!replacementPurchase) throw new TRPCError({ code: "CONFLICT", message: "رابط طلب التعويض تغير؛ حدّث الصفحة" });
          await db.updatePOItem(input.itemId, purchaseWrite, tx);
        });
      } catch (error) {
        const { ReturnFollowupError } = await import("../../supplier-return-followup/policy");
        if (error instanceof ReturnFollowupError) throw new TRPCError({ code: error.code === "INVALID" ? "BAD_REQUEST" : error.code, message: error.message });
        throw error;
      }
    } else await db.updatePOItem(input.itemId, purchaseWrite);
    // Update PO status. Path C uses the same pricing/approval/execution cycle,
    // but the completed service returns through gate entry rather than goods receiving.
    const poItems = await db.getPOItems(item.purchaseOrderId);
    // الأصناف في needs_item_revision لم تصل لمرحلة الشراء بعد → لا تُحسب ضمن الأصناف الفعّالة الآن
    const activeItemsPurch = poItems.filter(
      i => !["rejected", "cancelled", "needs_item_revision", "purchase_cancelled"].includes(i.status)
    );
    const purchasedOrLater = activeItemsPurch.filter(i =>
      ["purchased", "delivered_to_warehouse", "delivered_to_requester"].includes(i.status)
    );
    let purchaseOrderStatus = purchaseContext.po?.status;
    if (activeItemsPurch.length > 0 && purchasedOrLater.length === activeItemsPurch.length) {
      // كل الأصناف الفعّالة اشتُريت — لكن في needs_item_revision؟ إذن هو شراء جزئي
      const hasRevisionItems = poItems.some(i => i.status === "needs_item_revision");
      const newStatus = hasRevisionItems ? "partial_purchase" : "purchased";
      await db.updatePurchaseOrder(item.purchaseOrderId, { status: newStatus });
      purchaseOrderStatus = newStatus;

    } else if (purchasedOrLater.length > 0) {
      await db.updatePurchaseOrder(item.purchaseOrderId, { status: "partial_purchase" });
      purchaseOrderStatus = "partial_purchase";

    }
    await syncPathBTicketFromPurchaseOrder(
      item.purchaseOrderId,
      ctx.user.id,
      "تم تحديث شراء أصناف طلب الشراء",
    );

    const po = purchaseContext.po || await db.getPurchaseOrderById(item.purchaseOrderId);
    const buyer = ctx.user;

    if (isExternalMaintenance && purchaseContext.externalJob && purchaseContext.ticket) {
      const allCompleted = activeItemsPurch.length > 0 && purchasedOrLater.length === activeItemsPurch.length;
      if (allCompleted) {
        await db.updateExternalMaintenanceJob(purchaseContext.externalJob.id, {
          status: "waiting_gate_entry",
          delegateReadyForReturnById: ctx.user.id,
          delegateReadyForReturnAt: new Date(),
        });
        await db.updateTicket(purchaseContext.ticket.id, {
          externalRepairCompletedAt: new Date(),
          externalRepairCompletedById: ctx.user.id,
        });
        await db.addTicketStatusHistory({
          ticketId: purchaseContext.ticket.id,
          fromStatus: purchaseContext.ticket.status,
          toStatus: purchaseContext.ticket.status,
          changedById: ctx.user.id,
          notes: "أكمل المندوب دورة الصيانة الخارجية وأصبح الأصل بانتظار موافقة الحراسة على الدخول",
        });
        const gateUsers = await db.getUsersByRole("gate_security");
        for (const gateUser of gateUsers) {
          await db.createNotification({
            userId: gateUser.id,
            title: "🏠 أصل عائد بانتظار موافقة الدخول",
            message: `اكتملت الصيانة الخارجية للبلاغ ${purchaseContext.ticket.ticketNumber}. يرجى توثيق موافقة دخول الأصل.`,
            type: "warning",
            relatedTicketId: purchaseContext.ticket.id,
            relatedPoId: item.purchaseOrderId,
          });
        }
      }
    } else {
      // المسار B/طلبات الشراء العامة: البضاعة تتجه إلى المستودع.
      const warehouseUsers = await db.getUsersByRole("warehouse");
      for (const w of warehouseUsers) {
        await db.createNotification({
          userId: w.id,
          title: "📦 صنف تم شراؤه - بانتظار الاستلام",
          message: `تم شراء الصنف: "${item.itemName}" (الكمية: ${item.quantity} ${item.unit || ''}). طلب الشراء رقم: ${po?.poNumber || item.purchaseOrderId}. المندوب: ${buyer.name}. يرجى تسجيل استلام البضاعة عند وصولها.`,
          type: "info",
          relatedPoId: item.purchaseOrderId
        });
      }
    }

    const managers = await db.getPurchaseManagerUsers();
    for (const mgr of managers) {
      await db.createNotification({
        userId: mgr.id,
        title: isExternalMaintenance ? "🔧 اكتملت الصيانة الخارجية" : "🛒 تم شراء صنف",
        message: isExternalMaintenance
          ? `أكد ${buyer.name} اكتمال الصيانة الخارجية للطلب ${po?.poNumber || item.purchaseOrderId}. الأصل بانتظار موافقة الدخول.`
          : `قام ${buyer.name} بشراء صنف "${item.itemName}" من طلب الشراء رقم ${po?.poNumber || item.purchaseOrderId}.`,
        type: "info",
        relatedPoId: item.purchaseOrderId
      });
    }
    await db.createAuditLog({ userId: ctx.user.id, action: "confirm_purchase", entityType: "po_item", entityId: input.itemId });
    return { success: true, itemId: item.id, purchaseOrderId: item.purchaseOrderId,
      itemStatus: "purchased" as const, purchaseOrderStatus };
  }),

  saveDraft: protectedProcedure.input(z.object({
    fromIdeaId: z.number().int().positive().optional(),
    ticketId: z.number().optional(),
    ticketItemId: z.number().optional(), // الخطوة 4 (2026-08-08) — بند محدد ضمن بلاغ متعدد الجهات
    siteId: z.number().int().positive().optional(),
    sectionId: z.number().int().positive().optional(),
    assetId: z.number().int().positive().nullable().optional(),
    categoryId: z.number().int().positive().nullable().optional(),
    notes: z.string().optional(),
    items: z.array(z.object({
      catalogItemId: z.number().int().positive().nullable().optional(),
      itemName: z.string().min(1),
      ...purchaseItemNeedTimingShape,
      description: z.string().optional(),
      quantity: z.number().min(1),
      unit: z.string().optional(),
      photoUrl: z.string().optional(),
      photoUrls: z.array(z.string()).optional(),
      siteId: z.number().int().positive().nullable().optional(),
      sectionId: z.number().int().positive().nullable().optional(),
      assetId: z.number().int().positive().nullable().optional(),
      categoryId: z.number().int().positive().nullable().optional(),
      notes: z.string().optional(),
    })),
  })).mutation(async ({ input, ctx }) => {
    if (input.items.length === 0) throw new TRPCError({ code: "BAD_REQUEST", message: "يجب إضافة صنف واحد على الأقل" });
    if (input.fromIdeaId && (input.ticketId || input.ticketItemId)) throw new TRPCError({ code: "BAD_REQUEST", message: "اختر مصدر تنفيذ واحدًا؛ مرجع فكرة التذكرة ينتقل تلقائيًا" });
    if (input.items.length > 20) throw new TRPCError({ code: "BAD_REQUEST", message: `الحد الأقصى 20 صنف لكل طلب شراء` });
    await assertValidCatalogItemLinks(input.items);
    await assertNoInactiveCatalogUnitUsage(input.items);
    await assertTicketAllowsNewPurchaseOrder(ctx.user, input.ticketId, { ticketItemId: input.ticketItemId });
    const purchaseContext = await resolveAndValidatePurchaseOrderContext(input);
    const itemContexts = await resolveAndValidatePurchaseOrderItemContexts(input.items, purchaseContext, { requireCategory: false });

    // ⚠️ 2026-08-13: كان يستدعي getNextPONumber() هنا — أي أن مسودة واحدة تُنشأ
    // ثم تُترك أو تُحذف كانت تستهلك/تحجز رقمًا حقيقيًا من تسلسل PR-YYYY-NNNN
    // بلا داعٍ. الآن يُستدعى مولّد مستقل ببادئة مختلفة (DFT-)؛ الرقم الرسمي لا
    // يُخصَّص إلا عند submitDraft. راجع docs/PO_DRAFT_INDEPENDENT_NUMBERING.md.
    const poNumber = await db.getNextDraftNumber();
    // ✅ إصلاح حرج #5: نفس مبدأ create() — إنشاء الرأس والبنود معاً ضمن معاملة واحدة
    const poId = await db.withTransaction(async (tx: any) => {
      await assertPurchaseCatalogBaseUnits(tx, input.items);
      const idea = input.fromIdeaId ? await prepareIdeaExecution(tx, input.fromIdeaId, ctx.user, purchaseContext) : null;
      const newPoId = await db.createPurchaseOrder({
        poNumber,
        ticketId: input.ticketId,
        ticketItemId: input.ticketItemId,
        requestedById: ctx.user.id,
        status: "draft",
        notes: input.notes,
        ...purchaseContext,
      }, tx);
      const itemsData = input.items.map((item, index) => ({ ...item, ...itemContexts[index], ...resolvePurchaseItemNeedTiming(item), purchaseOrderId: newPoId!, status: "pending" }));
      await db.createPOItems(itemsData, tx);
      if (idea) await linkCreatedExecution(tx, idea, "purchase", Number(newPoId), ctx.user.id);
      return newPoId;
    });

    // ترجمة الأصناف في الخلفية
    const poItemsCreated = await db.getPOItems(poId!);
    queuePOItemsTranslation(poItemsCreated, ctx.user.id);

    // ترجمة ملاحظات الطلب إذا وجدت
    if (input.notes) queuePONotesTranslation(poId!, input.notes, ctx.user.id);

    await db.createAuditLog({ userId: ctx.user.id, action: "save_draft_po", entityType: "purchase_order", entityId: poId! });
    return { id: poId, poNumber };
  }),

  submitDraft: protectedProcedure.input(z.object({
    id: z.number(),
  })).mutation(async ({ input, ctx }) => {
    const po = await db.getPurchaseOrderById(input.id);
    if (!po) throw new TRPCError({ code: "NOT_FOUND", message: "طلب الشراء غير موجود" });
    if (po.status !== "draft") throw new TRPCError({ code: "BAD_REQUEST", message: "الطلب ليس مسودة" });
    assertCanPerformPOAction("submitDraft", ctx.user, po, { isCreator: String(po.requestedById) === String(ctx.user.id) });
    await assertTicketAllowsNewPurchaseOrder(ctx.user, po.ticketId ?? undefined, { currentPurchaseOrderId: po.id, submittingExistingDraft: true, ticketItemId: po.ticketItemId ?? undefined });
    const purchaseContext = await resolveAndValidatePurchaseOrderContext({
      ticketId: po.ticketId,
      siteId: po.siteId,
      sectionId: po.sectionId,
      assetId: po.assetId,
      categoryId: po.categoryId,
    }, { allowInactiveCategoryId: po.categoryId });

    if (!purchaseContext.categoryId) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "يجب اختيار التصنيف قبل إرسال طلب الشراء للمراجعة" });
    }

    // ⚠️ 2026-08-13: هذه اللحظة — لا لحظة حفظ المسودة — هي التي يُخصَّص فيها
    // الرقم الرسمي فعليًا (بنفس نظام الترقيم الحالي getNextPONumber، بلا تعديل
    // عليه) ويُستبدَل رقم المسودة (DFT-) به نهائيًا. createdAt يُصبح أيضًا لحظة
    // الإرسال بدل لحظة إنشاء المسودة — لأن createdAt هو الحقل المعروض فعليًا
    // كـ"تاريخ الطلب" في كل مكان بالنظام (قائمة الطلبات، صفحة التفاصيل)، فتحديثه
    // هنا يجعل كل ذلك العرض صحيحًا تلقائيًا بلا أي تعديل على صفحات/تقارير أخرى.
    // submittedAt يبقى كما كان (لم يُحذف ولم يتغيّر سلوكه) — يصبح مطابقًا لـ
    // createdAt لطلبات هذا المسار فقط، وهذا تكرار غير ضار لا يستحق إزالته الآن.
    // Header and deadlines commit together. Lock before rereading saved durations,
    // so a repeated submission cannot restart the item deadlines.
    const { items, officialPoNumber } = await db.withTransaction(async (tx: any) => {
      const [current] = await tx.select({ status: purchaseOrders.status }).from(purchaseOrders)
        .where(eq(purchaseOrders.id, input.id)).for("update");
      if (current?.status !== "draft") throw new TRPCError({ code: "CONFLICT", message: "الطلب لم يعد مسودة؛ يرجى تحديث الصفحة" });
      const items = await db.getPOItems(input.id, tx);
      if (items.length === 0) throw new TRPCError({ code: "BAD_REQUEST", message: "لا يوجد أصناف في الطلب" });
      const itemContexts = await resolveAndValidatePurchaseOrderItemContexts(items, purchaseContext, { requireCategory: true });
      const submittedAt = new Date();
      const datedItems = items.map((item: any, index: number) => {
        try { return { ...item, ...itemContexts[index], ...resolvePurchaseItemNeedTiming(item, submittedAt) }; }
        catch (error) { throw new TRPCError({ code: "BAD_REQUEST", message: `${error instanceof Error ? error.message : "تاريخ الاحتياج غير صالح"}: ${item.itemName || item.id}` }); }
      });
      const officialPoNumber = await db.getNextPONumber();
      for (const item of datedItems) {
        await db.updatePOItem(item.id, { siteId: item.siteId, sectionId: item.sectionId, assetId: item.assetId, categoryId: item.categoryId, requiredDate: item.requiredDate, deliveryLeadDays: item.deliveryLeadDays }, tx, {
          actorUserId: ctx.user.id, actorName: ctx.user.name, eventType: "item_updated",
          note: "تثبيت تاريخ الاحتياج وتحديث عدد الأيام عند إرسال طلب الشراء",
        });
      }
      await db.updatePurchaseOrder(input.id, {
        status: "pending_review", poNumber: officialPoNumber,
        createdAt: submittedAt, submittedAt, ...purchaseContext,
      }, tx);
      return { items: datedItems, officialPoNumber };
    });

    // أخطر المدراء
    const managers = await db.getPurchaseManagerUsers();
    for (const mgr of managers) {
      if (mgr.id !== ctx.user.id) {
        await db.createNotification({
          userId: mgr.id,
          title: `🛒 طلب شراء جديد #${officialPoNumber}`,
          message: `قام ${ctx.user.name} بإرسال طلب شراء يحتوي على ${items.length} صنف. بانتظار المراجعة.`,
          type: "warning",
          relatedPoId: input.id,
        });
      }
    }

    await syncPathBTicketFromPurchaseOrder(input.id, ctx.user.id, "تم إرسال طلب الشراء للمراجعة");

    await db.createAuditLog({ userId: ctx.user.id, action: "submit_draft_po", entityType: "purchase_order", entityId: input.id });

    // ترجمة الأصناف التي لم تُترجم بعد (قد تكون فاتت عند حفظ المسودة)
    const itemsNeedingTranslation = items.filter((i: any) => !i.itemNameEn && !i.itemNameAr);
    if (itemsNeedingTranslation.length > 0) queuePOItemsTranslation(itemsNeedingTranslation, ctx.user.id);
    if (po.notes) queuePONotesTranslation(input.id, po.notes, ctx.user.id);

    return { success: true };
  }),

  updateDraft: protectedProcedure.input(z.object({
    id: z.number(),
    siteId: z.number().int().positive().optional(),
    sectionId: z.number().int().positive().optional(),
    assetId: z.number().int().positive().nullable().optional(),
    categoryId: z.number().int().positive().nullable().optional(),
    notes: z.string().optional(),
    items: z.array(z.object({
      id: z.number().optional(), // موجود = تحديث، غير موجود = إضافة جديد
      catalogItemId: z.number().int().positive().nullable().optional(),
      itemName: z.string().min(1),
      ...purchaseItemNeedTimingShape,
      description: z.string().optional(),
      quantity: z.number().min(1),
      unit: z.string().optional(),
      photoUrl: z.string().optional(),
      photoUrls: z.array(z.string()).optional(),
      siteId: z.number().int().positive().nullable().optional(),
      sectionId: z.number().int().positive().nullable().optional(),
      assetId: z.number().int().positive().nullable().optional(),
      categoryId: z.number().int().positive().nullable().optional(),
      notes: z.string().optional(),
    })),
  })).mutation(async ({ input, ctx }) => {
    const po = await db.getPurchaseOrderById(input.id);
    if (!po) throw new TRPCError({ code: "NOT_FOUND", message: "المسودة غير موجودة" });
    if (po.status !== "draft") throw new TRPCError({ code: "BAD_REQUEST", message: "لا يمكن تعديل طلب ليس مسودة" });
    assertCanPerformPOAction("editDraft", ctx.user, po, { isCreator: String(po.requestedById) === String(ctx.user.id) });
    await assertTicketAllowsNewPurchaseOrder(ctx.user, po.ticketId ?? undefined, { currentPurchaseOrderId: po.id, submittingExistingDraft: true, ticketItemId: po.ticketItemId ?? undefined });
    if (input.items.length > 20) throw new TRPCError({ code: "BAD_REQUEST", message: "الحد الأقصى 20 صنف" });
    if (input.items.length === 0) throw new TRPCError({ code: "BAD_REQUEST", message: "يجب إضافة صنف واحد على الأقل" });

    // جلب الأصناف الحالية قبل أي كتابة حتى نميّز بين رابط Catalog تاريخي محفوظ
    // وبين رابط جديد يجب أن يشير إلى Master Item نشط (2B-10-2B).
    const existingItems = await db.getPOItems(input.id);
    await assertValidCatalogItemLinks(input.items, existingItems);
    await assertNoInactiveCatalogUnitUsage(input.items, existingItems);
    const purchaseContext = await resolveAndValidatePurchaseOrderContext({
      ticketId: po.ticketId,
      siteId: input.siteId ?? po.siteId,
      sectionId: input.sectionId ?? po.sectionId,
      assetId: input.assetId !== undefined ? input.assetId : po.assetId,
      categoryId: input.categoryId !== undefined ? input.categoryId : po.categoryId,
    }, { allowInactiveCategoryId: po.categoryId });
    const itemContexts = await resolveAndValidatePurchaseOrderItemContexts(input.items, purchaseContext, { requireCategory: false });
    // Use the same header lock as submission. A late editor cannot clear/restart
    // operational deadlines after the order has already been sent.
    await db.withTransaction(async (tx: any) => {
      const [current] = await tx.select({ status: purchaseOrders.status }).from(purchaseOrders)
        .where(eq(purchaseOrders.id, input.id)).for("update");
      if (current?.status !== "draft") throw new TRPCError({ code: "CONFLICT", message: "الطلب لم يعد مسودة؛ يرجى تحديث الصفحة" });
      const currentItems = await db.getPOItems(input.id, tx);
      const existingIds = new Set(currentItems.map((item: any) => item.id));
      if (input.items.some(item => item.id != null && !existingIds.has(item.id))) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "أحد الأصناف لا ينتمي إلى طلب الشراء" });
      }
      await assertPurchaseCatalogBaseUnits(tx, input.items.filter(item => {
        const existing = currentItems.find((entry: any) => entry.id === item.id);
        return !existing || !["cancelled", "rejected"].includes(existing.status);
      }), currentItems);
      await validateDirectIdeaPurchaseContext(tx, input.id, purchaseContext);
      await db.updatePurchaseOrder(input.id, { notes: input.notes || null, ...purchaseContext }, tx);
      const submittedIds = new Set(input.items.filter(item => item.id).map(item => item.id!));
      for (const existing of currentItems) {
        if (["cancelled", "rejected"].includes(existing.status)) continue;
        if (!submittedIds.has(existing.id)) {
          await tx.delete(purchaseOrderItems).where(and(eq(purchaseOrderItems.id, existing.id), eq(purchaseOrderItems.purchaseOrderId, input.id)));
        }
      }
      for (const [itemIndex, item] of input.items.entries()) {
        const existing = item.id ? currentItems.find((entry: any) => entry.id === item.id) : null;
        if (existing && ["cancelled", "rejected"].includes(existing.status)) continue;
        const values = {
          itemName: item.itemName, ...resolvePurchaseItemNeedTiming(item),
          description: item.description || null, quantity: item.quantity,
          unit: item.unit || null, photoUrl: item.photoUrl || null,
          photoUrls: item.photoUrls || null, notes: item.notes || null, ...itemContexts[itemIndex],
        };
        if (existing) {
          await db.updatePOItem(item.id!, {
            ...(item.catalogItemId !== undefined ? { catalogItemId: item.catalogItemId } : {}), ...values,
          }, tx);
        } else {
          await db.createPOItems([{
            purchaseOrderId: input.id, catalogItemId: item.catalogItemId ?? null, ...values, status: "pending",
          }], tx);
        }
      }
    });

    await db.createAuditLog({ userId: ctx.user.id, action: "update_draft_po", entityType: "purchase_order", entityId: input.id });

    // ترجمة جميع الأصناف بعد التعديل (تشمل الجديدة والمعدّلة)
    const allItems = await db.getPOItems(input.id);
    queuePOItemsTranslation(allItems, ctx.user.id);
    if (input.notes) queuePONotesTranslation(input.id, input.notes, ctx.user.id);

    return { success: true };
  }),

  create: protectedProcedure.input(z.object({
    supplierReturnPlanId: z.number().int().positive().optional(),
    ticketTeam: z.object({ assignmentId: z.number().int().positive(), needId: z.number().int().positive(), expectedRevision: z.number().int().nonnegative(), operationKey: z.string().trim().min(1).max(120), warehouseExtraQuantity: z.number().int().nonnegative().max(MAX_TICKET_PURCHASE_QUANTITY).optional() }).strict().optional(),
    fromIdeaId: z.number().int().positive().optional(),
    itPurchaseNeedId: z.number().int().positive().optional(),
    ticketId: z.number().optional(),
    ticketItemId: z.number().optional(), // الخطوة 4 (2026-08-08) — بند محدد ضمن بلاغ متعدد الجهات
    pmv2RequestItemId: z.number().int().positive().optional(),
    siteId: z.number().int().positive().optional(),
    sectionId: z.number().int().positive().optional(),
    assetId: z.number().int().positive().nullable().optional(),
    categoryId: z.number().int().positive().nullable().optional(),
    notes: z.string().optional(),
    items: z.array(z.object({
      catalogItemId: z.number().int().positive().nullable().optional(),
      itemName: z.string().min(1),
      ...purchaseItemNeedTimingShape,
      description: z.string().optional(),
      quantity: z.number().min(1),
      unit: z.string().optional(),
      photoUrl: z.string().optional(),
      photoUrls: z.array(z.string()).optional(),
      siteId: z.number().int().positive().nullable().optional(),
      sectionId: z.number().int().positive().nullable().optional(),
      assetId: z.number().int().positive().nullable().optional(),
      categoryId: z.number().int().positive().nullable().optional(),
      notes: z.string().optional(),
      delegateId: z.number().optional(),
    }).superRefine(validatePurchaseItemNeedTiming)),
  })).mutation(async ({ input, ctx }) => {
    // ✅ Batching Limit: Max 20 items per PO
    if (input.items.length === 0) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "يجب إضافة صنف واحد على الأقل" });
    }
    if (input.items.length > 20) {
      throw new TRPCError({ code: "BAD_REQUEST", message: `الحد الأقصى 20 صنف لكل طلب شراء. لديك ${input.items.length} صنف` });
    }
    assertPmv2PurchaseCreateShape(input);
    if (input.fromIdeaId && (input.ticketId || input.ticketItemId || input.pmv2RequestItemId || input.itPurchaseNeedId)) throw new TRPCError({ code: "BAD_REQUEST", message: "اختر مصدر تنفيذ واحدًا؛ مرجع فكرة التذكرة ينتقل تلقائيًا" });
    await assertValidCatalogItemLinks(input.items);
    await assertNoInactiveCatalogUnitUsage(input.items);
    if (input.ticketTeam && (input.fromIdeaId || input.pmv2RequestItemId || input.itPurchaseNeedId)) throw new TRPCError({ code: "BAD_REQUEST", message: "اختر مصدر طلب واحدًا" });
    if (input.supplierReturnPlanId && (input.ticketTeam || input.fromIdeaId || input.pmv2RequestItemId || input.itPurchaseNeedId)) throw new TRPCError({ code: "BAD_REQUEST", message: "طلب تعويض المرتجع لا يُدمج مع مصدر إنشاء آخر" });
    if (input.ticketTeam && (ctx.user.isActive !== 1 || !["warehouse", "owner", "admin"].includes(ctx.user.role))) throw new TRPCError({ code: "FORBIDDEN", message: "توفير مواد الفريق للمستودع فقط" });
    if (!input.ticketTeam && !input.supplierReturnPlanId) await assertTicketAllowsNewPurchaseOrder(ctx.user, input.ticketId, { ticketItemId: input.ticketItemId });
    const purchaseContext = await resolveAndValidatePurchaseOrderContext(input);
    if (!purchaseContext.categoryId) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "يجب اختيار التصنيف قبل إرسال طلب الشراء للمراجعة" });
    }
    const itemContexts = await resolveAndValidatePurchaseOrderItemContexts(input.items, purchaseContext, { requireCategory: true });
    let poNumber = await db.getNextPONumber();
    // ✅ إصلاح حرج #5: إنشاء رأس الطلب وبنوده معاً ضمن معاملة ذرية واحدة —
    // إما ينجحان كلاهما أو يُلغى كل شيء تلقائياً (rollback) عند أي فشل جزئي.
    // سابقاً كانا استدعاءين منفصلين تحت autocommit، فكان يمكن أن ينجح إنشاء
    // الرأس ويفشل إدراج البنود، تاركاً طلباً "رأساً بلا أصناف" للأبد.
    let poId: number | null = null;
    let ticketTeamCreated = true;
    try {
      poId = await db.withTransaction(async (tx: any) => {
        await assertPurchaseCatalogBaseUnits(tx, input.items);
        const replacement = input.supplierReturnPlanId
          ? await (await import("../../supplier-return-followup/purchase-bridge")).prepareReplacementPurchase(tx, ctx.user, input.supplierReturnPlanId, {
              ticketId: input.ticketId, ticketItemId: input.ticketItemId, items: input.items, context: purchaseContext,
            })
          : null;
        if (input.ticketTeam) {
          const linked = await createTicketMaterialPurchase(tx, { id: ctx.user.id, role: ctx.user.role, active: ctx.user.isActive === 1 }, input, async handoff => {
            const breakdown = ticketPurchaseBreakdown(handoff, handoff.unit);
            const submittedAt = new Date();
            const id = Number(await db.createPurchaseOrder({ poNumber, ticketId: input.ticketId, ticketItemId: input.ticketItemId, requestedById: ctx.user.id, status: "pending_review", submittedAt, notes: [input.notes?.trim(), breakdown].filter(Boolean).join("\n"), ...purchaseContext }, tx));
            await db.createPOItems(input.items.map((item, index) => ({ ...item, ...itemContexts[index], ...resolvePurchaseItemNeedTiming(item, submittedAt), quantity: handoff.purchaseTotalQuantity, notes: [item.notes?.trim(), breakdown].filter(Boolean).join("\n"), purchaseOrderId: id, status: "pending" })), tx);
            const items = await db.getPOItems(id, tx);
            if (items.length !== 1 || !items[0]?.id) throw new TeamTicketError("CONFLICT", "تعذر إنشاء بند شراء الفريق");
            return { id, poNumber, source: { sourceId: Number(items[0].id), sourceNumber: poNumber, quantity: Number(items[0].quantity), status: "pending" as const } };
          });
          poNumber = linked.poNumber;
          ticketTeamCreated = linked.created;
          return linked.id;
        }
        const idea = input.fromIdeaId ? await prepareIdeaExecution(tx, input.fromIdeaId, ctx.user, purchaseContext) : null;
        // Serialize IT orders on the execution ticket, including direct manager orders.
        if (input.ticketId) {
          await db.lockTicketForSubTicketSequence(input.ticketId, tx);
          const linked = await db.getTicketById(input.ticketId, tx);
          if (linked?.maintenanceResponsibleDepartment === MAINTENANCE_RESPONSIBLE_DEPARTMENT.IT) {
            const active = await tx.execute(sql`SELECT id FROM purchase_orders WHERE ticketId=${input.ticketId} AND status IN ('draft','pending_review','pending_estimate','pending_accounting','pending_management','approved','partial_purchase','purchased','received','revision_needed') LIMIT 1`);
            if (active[0]?.length && !replacement) throw new TRPCError({ code: "CONFLICT", message: "يوجد طلب شراء نشط لهذه المهمة" });
          }
        }
        if (input.itPurchaseNeedId) {
          const rows = await tx.select().from(itPurchaseNeeds).where(eq(itPurchaseNeeds.id, input.itPurchaseNeedId)).for("update");
          const need = rows[0];
          if (!need || ctx.user.role !== APP_ROLE.IT_MANAGER || need.managerId !== ctx.user.id || need.status !== "pending" || need.ticketId !== input.ticketId || need.ticketItemId !== input.ticketItemId) {
            throw new TRPCError({ code: "CONFLICT", message: "الاحتياج غير متاح أو لا يتطابق مع البلاغ وبنده" });
          }
        }
        const pmv2Atomic = input.pmv2RequestItemId
          ? await pmv2WarehousePurchaseHandoffService.prepareAtomicPurchaseCreation(tx, {
              requestItemId: input.pmv2RequestItemId,
              purchaseItem: input.items[0],
            })
          : null;

        const submittedAt = new Date();
        const newPoId = await db.createPurchaseOrder({
          poNumber,
          ticketId: input.ticketId,
          ticketItemId: input.ticketItemId,
          requestedById: ctx.user.id,
          status: "pending_review",
          submittedAt,
          notes: replacement ? [input.notes?.trim(), `تعويض مرتجع المورد #${replacement.caseId} — طلب الشراء الأصلي #${replacement.originalOrderId}`].filter(Boolean).join("\n") : input.notes,
          ...purchaseContext,
        }, tx);
        // delegateId is optional at creation — assigned during reviewItems step
        const itemsData = input.items.map((item, index) => ({ ...item, ...itemContexts[index], ...resolvePurchaseItemNeedTiming(item, submittedAt), purchaseOrderId: newPoId!, status: "pending" }));
        await db.createPOItems(itemsData, tx);
        if (replacement) {
          const createdItems = await db.getPOItems(newPoId!, tx);
          if (createdItems.length !== 1 || !createdItems[0]?.id) throw new TRPCError({ code: "CONFLICT", message: "تعذر تثبيت بند التعويض" });
          await (await import("../../supplier-return-followup/purchase-bridge")).linkReplacementPurchase(tx, replacement, Number(newPoId), Number(createdItems[0].id));
        }

        if (input.itPurchaseNeedId) await tx.update(itPurchaseNeeds).set({ status: "ordered", purchaseOrderId: newPoId }).where(eq(itPurchaseNeeds.id, input.itPurchaseNeedId));

        if (pmv2Atomic) {
          const createdItems = await db.getPOItems(newPoId!, tx);
          const createdItem = createdItems[0];
          if (!createdItem?.id) {
            throw new Pmv2WarehousePurchaseHandoffError("تعذر إنشاء بند طلب الشراء المرتبط بـ PM V2");
          }
          await pmv2WarehousePurchaseHandoffService.linkAtomicCreatedPurchase(tx, ctx.user.id, {
            requestItemId: pmv2Atomic.requestItemId,
            purchaseOrderId: newPoId!,
            purchaseOrderItemId: Number(createdItem.id),
            poNumber,
            purchaseItemQuantity: Number(createdItem.quantity || 0),
            linkedQuantity: pmv2Atomic.linkedQuantity,
            remainingRequestQuantity: Number(pmv2Atomic.handoff.remainingQuantity || 0),
            availableMainQuantity: Number(pmv2Atomic.handoff.availableMainQuantity || 0),
          }, {
            ipAddress: ctx.req.ip,
            userAgent: ctx.req.headers["user-agent"],
          });
        }

        if (idea) await linkCreatedExecution(tx, idea, "purchase", Number(newPoId), ctx.user.id);
        return Number(newPoId);
      });
    } catch (error) {
      if (input.supplierReturnPlanId) {
        const { ReturnFollowupError } = await import("../../supplier-return-followup/policy");
        if (error instanceof ReturnFollowupError) throw new TRPCError({ code: error.code === "INVALID" ? "BAD_REQUEST" : error.code, message: error.message });
      }
      if (input.ticketTeam && error instanceof TeamTicketError) throw new TRPCError({ code: error.code === "FORBIDDEN" ? "FORBIDDEN" : error.code === "INVALID" ? "BAD_REQUEST" : "CONFLICT", message: error.message });
      if (input.pmv2RequestItemId) mapPmv2AtomicPurchaseError(error);
      throw error;
    }

    // ترجمة حقول الطلب والأصناف في الخلفية
    if (input.ticketTeam && !ticketTeamCreated) return { id: poId, poNumber, pmv2Linked: false };
    const poItemsCreated = await db.getPOItems(poId!);
    queuePOItemsTranslation(poItemsCreated, ctx.user.id);
    if (input.notes) queuePONotesTranslation(poId!, input.notes, ctx.user.id);

    await syncPathBTicketFromPurchaseOrder(poId!, ctx.user.id,
      input.supplierReturnPlanId ? "تم إنشاء طلب تعويض المرتجع لنفس احتياج البلاغ" : "تم إنشاء طلب شراء مرتبط بالبلاغ");
    // Notify maintenance managers, owners, and admins about the new PO
    const managers = await db.getPurchaseManagerUsers();
    for (const mgr of managers) {
      if (mgr.id !== ctx.user.id) {
        await db.createNotification({
          userId: mgr.id,
          title: `🛒 طلب شراء جديد #${poNumber}`,
          message: `قام ${ctx.user.name} بإنشاء طلب شراء جديد يحتوي على ${input.items.length} صنف. بانتظار المراجعة.`,
          type: "warning",
          relatedPoId: poId!,
        });
      }
    }
    // Delegate notifications are sent in reviewItems after delegates are assigned
    await db.createAuditLog({ userId: ctx.user.id, action: "create_po", entityType: "purchase_order", entityId: poId! });
    return { id: poId, poNumber, pmv2Linked: Boolean(input.pmv2RequestItemId) };
  }),

  delete: protectedProcedure.input(z.object({ id: z.number() })).mutation(async ({ input, ctx }) => {
    const po = await db.getPurchaseOrderById(input.id);
    if (!po) throw new TRPCError({ code: "NOT_FOUND", message: "طلب الشراء غير موجود" });
    // ✅ الحارس المركزي: owner/admin فقط (لا بند إضافي بالسياسة لأي دور آخر)
    assertCanPerformPOAction("deleteOrder", ctx.user);
    // ملاحظة: القيد التالي (منع الحذف بعد مرحلة معيّنة) قاعدة عمل/سلامة بيانات
    // عامة تنطبق على الجميع (حتى owner/admin) — ليست قاعدة صلاحية تختلف بين
    // الأدوار، لذلك تبقى هنا بدل نقلها لسياسة الحارس (التي تتجاوزها owner/admin
    // بتصميمها أصلًا).
    // ✅ إصلاح حرج #3: القيم السابقة (funded, partially_purchased, completed) لم تكن
    // موجودة إطلاقًا في enum الحالات الحقيقي للنظام، فكان الشرط كوداً ميتاً لا يتحقق
    // أبداً — يسمح بحذف أي طلب مهما كانت حالته. القائمة الصحيحة أدناه تطابق poStatuses
    // الفعلي في drizzle/schema.ts، وتمنع الحذف بعد اعتماد الإدارة العليا تحديداً
    // (وكذلك أي مرحلة مالية سابقة له كالاعتماد المحاسبي، لارتباط مبلغ العهدة بها).
    const nonDeletableStatuses = [
      "pending_accounting", "pending_management", "approved",
      "partial_purchase", "purchased", "received", "closed",
    ];
    if (nonDeletableStatuses.includes(po.status)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "لا يمكن حذف طلب شراء تجاوز مرحلة المراجعة (اعتماد محاسبي/إداري أو أبعد)" });
    }
    // نحذف الطلب أولاً — الحذف هو العملية الأساسية ويجب أن ينجح دائماً
    await db.withTransaction(tx => assertNotTrackedIdeaSource(tx, "purchase", input.id));
    await db.deletePurchaseOrder(input.id);
    if (po.ticketId) {
      await syncPathBTicketFromTicketId(po.ticketId, ctx.user.id, "تم حذف طلب شراء مرتبط بالبلاغ");
    }
    await db.createAuditLog({ userId: ctx.user.id, action: "delete_po", entityType: "purchase_order", entityId: input.id, oldValues: { poNumber: po.poNumber, status: po.status, notes: po.notes } });

    // إشعار المدراء أمر ثانوي: نغلّفه بـ try/catch حتى لا يظهر أي خطأ للمستخدم
    // أو يفشل شيء بعد نجاح الحذف الفعلي، حتى لو حصل خطأ غير متوقع في الإشعارات مستقبلاً
    try {
      const poDelManagers = await db.getPurchaseManagerUsers();
      for (const mgr of poDelManagers) {
        if (mgr.id !== ctx.user.id) {
          await db.createNotification({ userId: mgr.id, title: `حذف طلب شراء #${po.poNumber}`, message: `قام ${ctx.user.name} بحذف طلب الشراء`, type: "po_deleted", relatedPoId: input.id });
        }
      }
    } catch (notifyError) {
      console.error("[PO Delete] فشل إرسال إشعار الحذف (تم الحذف بنجاح رغم ذلك):", notifyError);
    }

    return { success: true };
  }),

  deleteItem: protectedProcedure.input(z.object({ id: z.number(), purchaseOrderId: z.number() })).mutation(async ({ input, ctx }) => {
    const po = await db.getPurchaseOrderById(input.purchaseOrderId);
    if (!po) throw new TRPCError({ code: "NOT_FOUND" });

    const item = await db.getPOItemById(input.id);
    if (!item) throw new TRPCError({ code: "NOT_FOUND" });

    // ✅ إصلاح حرج #1 (IDOR): يجب التأكد أن الصنف ينتمي فعلاً لطلب الشراء المُرسل
    // قبل الاعتماد على حالة/صلاحية ذلك الطلب لاتخاذ قرار الحذف. بدون هذا التحقق
    // يمكن حذف صنف من طلب "ب" مكتمل بتمرير رقم طلب "أ" آخر لا يزال قابلاً للتعديل.
    if (item.purchaseOrderId !== input.purchaseOrderId) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "هذا الصنف لا ينتمي لطلب الشراء المحدد" });
    }

    const isCreator = po.requestedById === ctx.user.id;

    // ✅ الحارس المركزي (مستوى الصنف) — يستبدل الفحص اليدوي المتعدد الشروط
    // الذي كان هنا (استثناء منشئ الطلب حسب حالة الصنف/الطلب + الأدوار المميّزة
    // + قيد revision_needed غير المشروط بالدور). نفس السلوك بالضبط، موحَّد بـpolicy.ts.
    assertCanPerformItemPOAction("deleteItem", ctx.user, {
      itemStatus: item.status,
      poStatus: po.status,
      isCreator,
    });

    // ✅ إصلاح حرج #2: منع حذف آخر صنف متبقٍ في الطلب — يمنع تفريغ الطلب بالكامل
    // من أصنافه وبقائه "رأسًا" بلا بنود. إن رغب المستخدم بإلغاء الطلب كليًا
    // فعليه استخدام حذف/إلغاء الطلب نفسه، لا حذف آخر صنف فيه.
    const allItemsInPO = await db.getPOItems(input.purchaseOrderId);
    if (allItemsInPO.length <= 1) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "لا يمكن حذف آخر صنف متبقٍ في طلب الشراء. لإلغاء الطلب بالكامل استخدم خيار حذف/إلغاء الطلب نفسه.",
      });
    }

    await db.deletePOItem(input.id);
    await db.createAuditLog({
      userId: ctx.user.id,
      action: "delete_po_item",
      entityType: "purchase_order_item",
      entityId: input.id,
      oldValues: { purchaseOrderId: item.purchaseOrderId, poNumber: po.poNumber, ...item },
    });
    return { success: true };
  }),



  editItem: protectedProcedure.input(z.object({
    id: z.number(),
    purchaseOrderId: z.number(),
    itemName: z.string().optional(),
    description: z.string().optional(),
    quantity: z.number().optional(),
    unit: z.string().optional(),
    photoUrl: z.string().optional(),
    notes: z.string().optional(),
    estimatedUnitCost: z.string().optional(),
    lastKnownUpdatedAt: z.string().optional(),
  })).mutation(async ({ input, ctx }) => {
    if (pricingBundlesEnabled()) await assertItemOutsidePricingBundle(await db.getDb(), input.id);
    const po = await db.getPurchaseOrderById(input.purchaseOrderId);
    if (!po) throw new TRPCError({ code: "NOT_FOUND" });

    const oldItem = await db.getPOItemById(input.id);
    if (!oldItem) {
      throw new TRPCError({ code: "NOT_FOUND" });
    }

    // ✅ إصلاح حرج #1 (IDOR): نفس إصلاح deleteItem — التأكد أن الصنف ينتمي
    // فعلاً لطلب الشراء المُرسل قبل الاعتماد على حالته/صلاحيته لاتخاذ قرار التعديل.
    if (oldItem.purchaseOrderId !== input.purchaseOrderId) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "هذا الصنف لا ينتمي لطلب الشراء المحدد" });
    }

    const isCreator = po.requestedById === ctx.user.id;

    // ✅ الحارس المركزي (مستوى الصنف) — نفس منطق deleteItem بالضبط (موحَّد بـpolicy.ts)
    assertCanPerformItemPOAction("editItem", ctx.user, {
      itemStatus: oldItem.status,
      poStatus: po.status,
      isCreator,
    });

    if (
      oldItem.updatedAt &&
      input.lastKnownUpdatedAt &&
      String(oldItem.updatedAt) !== String(input.lastKnownUpdatedAt)
    ) {
      throw new TRPCError({
        code: "CONFLICT",
        message: "تم تعديل الصنف بواسطة مستخدم آخر، قم بتحديث الصفحة",
      });
    }
    if (oldItem.delegateChangeRequestedAt && input.estimatedUnitCost !== undefined) {
      throw new TRPCError({
        code: "CONFLICT",
        message: "لا يمكن تعديل سعر الصنف أثناء انتظار قرار تغيير المندوب",
      });
    }

    const updates: any = {};
    if (input.itemName !== undefined) updates.itemName = input.itemName;
    if (input.description !== undefined) updates.description = input.description;
    if (input.quantity !== undefined) updates.quantity = input.quantity;
    if (input.unit !== undefined) updates.unit = input.unit;
    if (input.photoUrl !== undefined) updates.photoUrl = input.photoUrl;
    if (input.notes !== undefined) updates.notes = input.notes;
    if (input.estimatedUnitCost !== undefined) {
      updates.estimatedUnitCost = input.estimatedUnitCost;
      updates.estimatedTotalCost = String(parseFloat(input.estimatedUnitCost) * (input.quantity || oldItem.quantity));
    } else if (input.quantity !== undefined && oldItem.estimatedUnitCost) {
      updates.estimatedTotalCost = String(parseFloat(oldItem.estimatedUnitCost) * input.quantity);
    }
    if (input.estimatedUnitCost !== undefined) {
      const updated = await db.updatePOItemIfDelegateChangeUnlocked(input.id, updates, undefined, undefined, undefined, oldItem.batchId);
      if (!updated) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "تم إيقاف تعديل السعر بسبب وجود طلب تغيير مندوب؛ قم بتحديث الصفحة",
        });
      }
    } else {
      await db.updatePOItem(input.id, updates, undefined, undefined, oldItem.batchId);
    }
    await db.createAuditLog({
      userId: ctx.user.id,
      action: "update_po_item",
      entityType: "purchase_order_item",
      entityId: input.id,
      oldValues: {
        itemName: oldItem.itemName,
        description: oldItem.description,
        quantity: oldItem.quantity,
        unit: oldItem.unit,
        estimatedUnitCost: oldItem.estimatedUnitCost,
        estimatedTotalCost: oldItem.estimatedTotalCost,
        photoUrl: oldItem.photoUrl,
        notes: oldItem.notes,
      },
      newValues: { ...updates },
    });
    return { success: true };
  }),

  editAndResubmitReturnedItem: protectedProcedure.input(z.object({
    id: z.number(),
    purchaseOrderId: z.number(),
    itemName: z.string().optional(),
    description: z.string().optional(),
    quantity: z.number().positive().optional(),
    unit: z.string().optional(),
    photoUrl: z.string().optional(),
    notes: z.string().optional(),
    estimatedUnitCost: z.string().optional(),
    lastKnownUpdatedAt: z.string().optional(),
  })).mutation(async ({ input, ctx }) => {
    const po = await db.getPurchaseOrderById(input.purchaseOrderId);
    if (!po) throw new TRPCError({ code: "NOT_FOUND", message: "طلب الشراء غير موجود" });

    const oldItem = await db.getPOItemById(input.id);
    if (!oldItem) throw new TRPCError({ code: "NOT_FOUND", message: "الصنف غير موجود" });

    if (oldItem.purchaseOrderId !== input.purchaseOrderId) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "هذا الصنف لا ينتمي لطلب الشراء المحدد" });
    }

    // هذه العملية مخصّصة للصنف الذي أعاده المندوب. يسمح بها لمنشئ الطلب
    // أو owner/admin فقط، وتنفذ حفظ التعديلات وإعادة الإرسال في تحديث واحد.
    assertCanResolveReturnedPOItem(
      ctx.user,
      { requestedById: po.requestedById, itemStatus: oldItem.status },
      "فقط منشئ الطلب أو الإدارة يمكنه تعديل الصنف وإعادة إرساله"
    );

    if (!['needs_item_revision', 'purchase_cancelled'].includes(oldItem.status)) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "الصنف ليس في حالة عودة للمنشئ للتعديل وإعادة الإرسال",
      });
    }

    if (
      oldItem.updatedAt &&
      input.lastKnownUpdatedAt &&
      String(oldItem.updatedAt) !== String(input.lastKnownUpdatedAt)
    ) {
      throw new TRPCError({
        code: "CONFLICT",
        message: "تم تعديل الصنف بواسطة مستخدم آخر، قم بتحديث الصفحة",
      });
    }

    const wasRevisionRequest = oldItem.status === 'needs_item_revision';
    const updates: any = {
      status: wasRevisionRequest ? 'pending' : 'approved',
    };

    if (input.itemName !== undefined) updates.itemName = input.itemName;
    if (input.description !== undefined) updates.description = input.description;
    if (input.quantity !== undefined) updates.quantity = input.quantity;
    if (input.unit !== undefined) updates.unit = input.unit;
    if (input.photoUrl !== undefined) updates.photoUrl = input.photoUrl;
    if (input.notes !== undefined) updates.notes = input.notes;

    if (input.estimatedUnitCost !== undefined) {
      updates.estimatedUnitCost = input.estimatedUnitCost;
      updates.estimatedTotalCost = String(
        parseFloat(input.estimatedUnitCost) * (input.quantity || oldItem.quantity)
      );
    } else if (input.quantity !== undefined && oldItem.estimatedUnitCost) {
      updates.estimatedTotalCost = String(parseFloat(oldItem.estimatedUnitCost) * input.quantity);
    }

    if (wasRevisionRequest) {
      updates.itemRevisionNote = null;
      updates.itemRevisionRequestedById = null;
      updates.itemRevisionRequestedAt = null;
      updates.batchId = null;
    } else {
      updates.purchaseCancelReason = null;
      updates.purchaseCancelledById = null;
      updates.purchaseCancelledByName = null;
      updates.purchaseCancelledAt = null;
    }

    await db.updatePOItem(oldItem.id, updates);
    await queuePurchaseTranslation("PO_ITEM", oldItem.id, [
      { fieldName: "itemName", text: input.itemName },
      { fieldName: "description", text: input.description },
      { fieldName: "notes", text: input.notes },
    ], ctx.user.id);

    const finalItemName = input.itemName ?? oldItem.itemName;
    await createTranslatedProcurementComment(db, {
      purchaseOrderId: po.id,
      purchaseOrderItemId: oldItem.id,
      userId: ctx.user.id,
      userName: ctx.user.name || "User",
      userRole: ctx.user.role,
      actionType: wasRevisionRequest
        ? "item_revision_edited_and_resubmitted"
        : "cancelled_purchase_edited_and_resubmitted",
      note: wasRevisionRequest
        ? `تم حفظ تعديلات الصنف "${finalItemName}" وإعادة إرساله للمندوب للتسعير`
        : `تم حفظ تعديلات الصنف "${finalItemName}" وإعادة إرساله للمندوب للشراء مباشرة`,
    });

    if (oldItem.delegateId) {
      await db.createNotification({
        userId: oldItem.delegateId,
        title: wasRevisionRequest ? "✏️ صنف معدل وجاهز للتسعير" : "🛒 صنف معدل وجاهز للشراء",
        message: wasRevisionRequest
          ? `تم تعديل الصنف "${finalItemName}" من طلب الشراء ${po.poNumber} وإعادة إرساله لك للتسعير.`
          : `تم تعديل الصنف "${finalItemName}" من طلب الشراء ${po.poNumber} وإعادة إرساله لك للشراء مباشرة.`,
        type: wasRevisionRequest ? "info" : "success",
        relatedPoId: po.id,
      });
    }

    await syncPathBTicketFromPurchaseOrder(
      po.id,
      ctx.user.id,
      "تم تعديل صنف معاد وإرساله مجددًا ضمن دورة الشراء",
    );

    await db.createAuditLog({
      userId: ctx.user.id,
      action: wasRevisionRequest
        ? "edit_and_resubmit_item_revision"
        : "edit_and_resubmit_cancelled_purchase",
      entityType: "purchase_order_item",
      entityId: oldItem.id,
      oldValues: {
        status: oldItem.status,
        itemName: oldItem.itemName,
        description: oldItem.description,
        quantity: oldItem.quantity,
        unit: oldItem.unit,
        photoUrl: oldItem.photoUrl,
        notes: oldItem.notes,
      },
      newValues: updates,
    });

    return { success: true, status: updates.status };
  }),

  requestDelegateChange: delegateProcedure.input(z.object({
    itemId: z.number(),
    reason: z.string().trim().min(5, "يجب كتابة سبب طلب تغيير المندوب"),
  })).mutation(async ({ input, ctx }) => {
    const item = await db.getPOItemById(input.itemId);
    if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "الصنف غير موجود" });

    const po = await db.getPurchaseOrderById(item.purchaseOrderId);
    if (!po) throw new TRPCError({ code: "NOT_FOUND", message: "طلب الشراء غير موجود" });

    assertCanRequestDelegateChange(ctx.user, {
      delegateId: item.delegateId,
      itemStatus: item.status,
      batchId: item.batchId,
      estimatedUnitCost: item.estimatedUnitCost,
      delegateChangeRequestedAt: item.delegateChangeRequestedAt,
      reviewedById: po.reviewedById,
    });

    const requestSaved = await db.requestPOItemDelegateChangeAtomic({
      itemId: item.id,
      delegateId: ctx.user.id,
      reason: input.reason,
      requestedAt: new Date(),
      actorName: ctx.user.name || null,
    });
    if (!requestSaved) {
      throw new TRPCError({
        code: "CONFLICT",
        message: "تغيّرت حالة الصنف أو بدأ تسعيره؛ قم بتحديث الصفحة ثم أعد المحاولة",
      });
    }
    await queuePurchaseTranslation("PO_ITEM", item.id, [
      { fieldName: "delegateChangeReason", text: input.reason },
    ], ctx.user.id);

    // ⚠️ 2026-08-13: الإشعار يذهب لنفس من راجع الطلب واختار المندوب لهذا
    // الصنف أصلًا (po.reviewedById) — لا بثًّا لكل مديري المشتريات. هو الشخص
    // الوحيد المخوَّل بحسم الطلب فعليًا (راجع canResolvePOItemDelegateChange)،
    // فبثّ الإشعار لغيره كان يُري مديرين إشعارًا لا يقدرون على التصرف بموجبه.
    // Fallback: طلب قديم بلا reviewedById مسجَّل — يُبث لكل المديرين كسابقًا،
    // مطابقًا لتوسعة الحارس المؤقتة لنفس الحالة.
    if (po.reviewedById) {
      await db.createNotification({
        userId: po.reviewedById,
        title: "طلب تغيير مندوب صنف",
        message: `طلب المندوب ${ctx.user.name || "المندوب"} تغيير مسؤول الصنف "${item.itemName}" في طلب الشراء ${po.poNumber}. السبب: ${input.reason}`,
        type: "warning",
        relatedPoId: po.id,
      });
    } else {
      const maintenanceManagers = await db.getPurchaseManagerUsers();
      for (const manager of maintenanceManagers) {
        if (!manager.isActive) continue;
        await db.createNotification({
          userId: manager.id,
          title: "طلب تغيير مندوب صنف",
          message: `طلب المندوب ${ctx.user.name || "المندوب"} تغيير مسؤول الصنف "${item.itemName}" في طلب الشراء ${po.poNumber}. السبب: ${input.reason}`,
          type: "warning",
          relatedPoId: po.id,
        });
      }
    }

    await db.createAuditLog({
      userId: ctx.user.id,
      action: "request_po_item_delegate_change",
      entityType: "purchase_order_item",
      entityId: item.id,
      oldValues: { delegateId: item.delegateId },
      newValues: {
        delegateChangeRequestedById: ctx.user.id,
        delegateChangeRequestedByName: ctx.user.name || null,
        delegateChangeReason: input.reason,
      },
    });

    return { success: true };
  }),

  resolveDelegateChange: protectedProcedure.input(z.object({
    itemId: z.number(),
    delegateId: z.number(),
  })).mutation(async ({ input, ctx }) => {
    const item = await db.getPOItemById(input.itemId);
    if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "الصنف غير موجود" });

    const po = await db.getPurchaseOrderById(item.purchaseOrderId);
    if (!po) throw new TRPCError({ code: "NOT_FOUND", message: "طلب الشراء غير موجود" });

    assertCanResolveDelegateChange(ctx.user, {
      delegateId: item.delegateId,
      itemStatus: item.status,
      batchId: item.batchId,
      delegateChangeRequestedAt: item.delegateChangeRequestedAt,
      reviewedById: po.reviewedById,
    });

    const newDelegate = await db.getUserById(input.delegateId);
    if (!newDelegate || newDelegate.role !== "delegate" || !newDelegate.isActive) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "المندوب المختار غير موجود أو غير نشط" });
    }

    const oldDelegateId = item.delegateId;
    const oldDelegate = oldDelegateId ? await db.getUserById(oldDelegateId) : null;

    const assignmentSaved = await db.resolvePOItemDelegateChangeAtomic({
      itemId: item.id,
      newDelegateId: input.delegateId,
      actorUserId: ctx.user.id,
      actorName: ctx.user.name || null,
    });
    if (!assignmentSaved) {
      throw new TRPCError({
        code: "CONFLICT",
        message: "تم حسم الطلب أو تغيّرت حالة الصنف بواسطة مستخدم آخر؛ قم بتحديث الصفحة",
      });
    }

    if (oldDelegateId && oldDelegateId !== input.delegateId) {
      await db.createNotification({
        userId: oldDelegateId,
        title: "تم تحويل مسؤولية صنف",
        message: `تم تحويل الصنف "${item.itemName}" من طلب الشراء ${po.poNumber} إلى المندوب ${newDelegate.name || "المختار"}.`,
        type: "info",
        relatedPoId: po.id,
      });
    }

    await db.createNotification({
      userId: input.delegateId,
      title: oldDelegateId === input.delegateId ? "تم تأكيد استمرار مسؤوليتك عن الصنف" : "تم تعيين صنف جديد لك",
      message: oldDelegateId === input.delegateId
        ? `قرر ${ctx.user.name || "مدير الصيانة"} إبقاء الصنف "${item.itemName}" من طلب الشراء ${po.poNumber} ضمن مسؤوليتك، وهو جاهز للتسعير.`
        : `عيّنك ${ctx.user.name || "مدير الصيانة"} مسؤولًا عن الصنف "${item.itemName}" من طلب الشراء ${po.poNumber}. الصنف جاهز للتسعير.`,
      type: "success",
      relatedPoId: po.id,
    });

    await db.createAuditLog({
      userId: ctx.user.id,
      action: "resolve_po_item_delegate_change",
      entityType: "purchase_order_item",
      entityId: item.id,
      oldValues: {
        delegateId: oldDelegateId,
        delegateName: oldDelegate?.name || null,
        delegateChangeReason: item.delegateChangeReason,
        delegateChangeRequestedById: item.delegateChangeRequestedById,
      },
      newValues: {
        delegateId: input.delegateId,
        delegateName: newDelegate.name || null,
        changedById: ctx.user.id,
        changedByName: ctx.user.name || null,
      },
    });

    return { success: true, delegateId: input.delegateId };
  }),

  estimateCost: delegateProcedure.input(z.object({
    purchaseOrderId: z.number(),
    items: z.array(z.object({
      id: z.number(),
      estimatedUnitCost: z.string(),
    })),
  })).mutation(async ({ input, ctx }) => {
    // اجلب الطلب أولاً لمعرفة حالته الحالية
    const po = await db.getPurchaseOrderById(input.purchaseOrderId);
    if (!po) throw new TRPCError({ code: "NOT_FOUND", message: "طلب الشراء غير موجود" });

    for (const item of input.items) {
      const cost = parseFloat(item.estimatedUnitCost);
      const poItem = (await db.getPOItems(input.purchaseOrderId)).find(i => i.id === item.id);
      // Guard: item must have a delegateId assigned before it can be estimated
      if (!poItem?.delegateId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `الصنف "${poItem?.itemName || item.id}" لا يمكن تسعيره قبل تعيين مندوب له` });
      }
      // لا يجوز حفظ سعر إلا لصنف pending فعليًا. هذا الشرط يمنع إعادة تنشيط
      // cancelled/rejected أو أي حالة لاحقة عبر رابط قديم أو استدعاء API مباشر.
      if (poItem.status !== "pending") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `الصنف "${poItem.itemName}" غير متاح للتسعير بحالته الحالية`,
        });
      }
      if (poItem.delegateChangeRequestedAt) {
        throw new TRPCError({ code: "CONFLICT", message: `تسعير الصنف "${poItem.itemName}" موقوف حتى يبت مدير الصيانة في طلب تغيير المندوب` });
      }
      // ✅ الحارس المركزي: المندوب يسعّر أصنافه المخصَّصة له فقط (owner/admin يتجاوزان)
      assertPOItemAssignedToDelegate(ctx.user, poItem);
      const totalCost = cost * (poItem?.quantity || 1);

      // ── دائمًا: حفظ السعر فقط يضع الصنف في "estimated" بانتظار إرساله ضمن دفعة ──
      // (سواء كان الطلب لسه pending_estimate، أو سبق واعتُمدت دفعات أخرى منه، أو حتى لو وصل الطلب لحالة approved)
      // لا يوجد أي مسار يعتمد الصنف تلقائيًا بدون المرور على submitPricedBatch ثم اعتماد الحسابات/الإدارة لهذه الدفعة تحديدًا.
      const estimateSaved = await db.updatePOItemIfDelegateChangeUnlocked(item.id, {
        estimatedUnitCost: item.estimatedUnitCost,
        estimatedTotalCost: String(totalCost),
        status: "estimated",
        batchId: null, // أي إعادة تسعير تفصل الصنف عن أي دفعة قديمة وتجعله جاهزًا لدفعة جديدة
      }, "pending", {
        actorUserId: ctx.user.id,
        actorName: ctx.user.name || null,
        eventType: "estimate_updated",
      });
      if (!estimateSaved) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `تعذر تسعير الصنف "${poItem.itemName}" لأن حالته تغيرت أو أصبح عليه طلب تغيير مندوب؛ قم بتحديث الصفحة`,
        });
      }
    }

    // ملاحظة: حفظ التسعير لم يعد يُرسل الطلب تلقائيًا للحسابات.
    // المندوب يسعّر أي عدد من الأصناف ويحفظها (حالتها تصبح "estimated")،
    // ثم يقرر بنفسه متى يرسلها للحسابات عبر زر "إرسال للحسابات" (submitPricedBatch)،
    // والذي قد يُستدعى عدة مرات (دفعات) على نفس رقم الطلب، وكل دفعة تحتاج اعتماد حسابات/إدارة مستقل.
    return { success: true };
  }),

  // ── إرسال الأصناف المسعّرة (غير المرسلة سابقًا) للحسابات كدفعة جديدة ──
  submitPricedBatch: delegateProcedure.input(z.object({
    purchaseOrderId: z.number(),
  })).mutation(async ({ input, ctx }) => {
    // [PB-DELEGATE-SEND-GUARD 2026-09-02]
    // الطلب الذي انضم إلى حزمة لا يجوز أن ينشئ إرسالًا منفردًا يتجاوز
    // purchase_package_submission. مسار الحزمة نفسه يستدعي helper مباشرة
    // مع purchasePackageSubmissionId، لذلك لا يتأثر بهذا الحارس.
    const po = await db.getPurchaseOrderById(input.purchaseOrderId);
    if (!po) {
      throw new TRPCError({ code: "NOT_FOUND", message: "طلب الشراء غير موجود" });
    }
    if (po.packageId) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "هذا الطلب تابع لحزمة شراء؛ إرسال التسعير للحسابات يتم من خلال الحزمة فقط",
      });
    }

    // [PB 2026-08-29] المنطق المستخرج يبقى كما هو للطلبات المنفردة.
    return submitPricedBatchForPO(input.purchaseOrderId, ctx.user);
  }),

  // ── جلب كل دفعات التسعير الخاصة بطلب معيّن (لعرضها للمندوب والمحاسب) ──
  listPricingBatches: protectedProcedure.input(z.object({
    purchaseOrderId: z.number(),
  })).query(async ({ input, ctx }) => {
    // إصلاح ذاتي للبيانات القديمة: الدفعات التي بقيت معلّقة بعد إلغاء جميع
    // أصنافها تُغلق عند فتح الطلب، ثم تُعرض كسجل تاريخي غير قابل للاعتماد.
    const po = await db.getPurchaseOrderById(input.purchaseOrderId);
    if (!po) throw new TRPCError({ code: "NOT_FOUND" });
    await assertCanViewPurchaseOrder(ctx.user, po);
    await rejectEmptyPendingPricingBatches(input.purchaseOrderId);
    const batches = await db.getPOPricingBatches(input.purchaseOrderId);
    const visible = ctx.user.role === "delegate" ? batches.filter(batch => Number(batch.submittedById) === ctx.user.id) : batches;
    const pricingDb = typeof db.getDb === "function" ? await db.getDb() : null;
    const replacementRows = pricingDb && await trialEnabled(pricingDb)
      ? await readRows(pricingDb, sql`SELECT p.id,p.quotedTotal,p.creditAllocated,p.additionalFunding,i.batchId
          FROM supplier_return_replacement_plans p INNER JOIN purchase_order_items i ON i.id=p.purchaseOrderItemId AND i.purchaseOrderId=p.purchaseOrderId
          WHERE p.purchaseOrderId=${input.purchaseOrderId}`)
      : [];
    const replacementByBatch = new Map(replacementRows.filter(row => row.batchId != null).map(row => [Number(row.batchId), row]));
    const scope = isPurchasePdfApprover(ctx.user) ? await loadDocumentListPort(visible.map(batch => ({
      entityType: batch.purchasePackageSubmissionId == null ? "po_financial_batch" : "purchase_package_submission_financial",
      entityId: batch.purchasePackageSubmissionId ?? batch.id,
    })), undefined, { actor: ctx.user, orders: [po] }) : undefined;
    return Promise.all(visible.map(async batch => ({ ...batch,
      ...(replacementByBatch.has(batch.id) ? { replacementFunding: {
        quotedTotal: String(replacementByBatch.get(batch.id).quotedTotal),
        creditAllocated: String(replacementByBatch.get(batch.id).creditAllocated),
        additionalFunding: String(replacementByBatch.get(batch.id).additionalFunding),
      } } : {}),
      ...(isPurchasePdfApprover(ctx.user) ? await purchaseDocumentPermission(ctx.user, input.purchaseOrderId, batch.purchasePackageSubmissionId == null ? batch.id : undefined, batch.purchasePackageSubmissionId ?? undefined, scope) : { pdfAllowed: true, pdfBlockedReason: null }),
    })));
  }),

  /**
   * "بانتظار إجرائي" — الطلبات التي تنتظر إجراءً من المستخدم الحالي، مع سبب
   * ظهور كل طلب والإجراء المقترح. يعتمد كليًا على الحارس المركزي لتحديد ما
   * يستطيع المستخدم فعله، فلا يعرّف أي صلاحية جديدة.
   */
  actionableForMe: protectedProcedure.query(async ({ ctx }) => {
    const allPOs = await db.getPurchaseOrders({});
    // نطاق الرؤية أولًا — لا يظهر أي طلب لا يملك المستخدم صلاحية رؤيته أصلًا
    const visible = await filterVisiblePurchaseOrders(ctx.user, allPOs);
    if (visible.length === 0) return { items: [], total: 0 };

    const poItems = await db.getPOItemsForPOs(visible.map((p: any) => p.id));
    const actionable = computeActionablePOs(
      { id: ctx.user.id, role: ctx.user.role },
      visible as any,
      poItems as any
    );
    const localized = await localizePurchaseUserNames(actionable as any[], (ctx.user.preferredLanguage || "ar") as SupportedLanguage);
    return { items: localized, total: localized.length };
  }),

  getById: protectedProcedure.input(z.object({ id: z.number() })).query(async ({ input, ctx }) => {
    const po = await db.getPurchaseOrderById(input.id);
    if (!po) throw new TRPCError({ code: "NOT_FOUND", message: "طلب الشراء غير موجود" });

    // ✅ الحارس المركزي (server/_core/authz) — يستبدل المنطق المكرر الذي كان
    // هنا سابقًا. نفس القرار بالضبط يُستخدم من list() عبر filterVisiblePurchaseOrders
    // فلا يمكن أن ينحرف نطاق التفاصيل عن نطاق القائمة.
    await assertCanViewPurchaseOrder(ctx.user, po);

    const allItems = await db.getPOItems(input.id);
    const items = ctx.user.role === "delegate" && !isDelegateOwnPurchaseDraft(ctx.user, po)
      ? allItems.filter((item: any) => Number(item.delegateId) === ctx.user.id) : allItems;
    const allComments = await db.getProcurementComments(input.id);
    const ownItemIds = new Set(items.map((item: any) => item.id));
    const comments = ctx.user.role === "delegate" ? allComments.filter(comment => !comment.purchaseOrderItemId || ownItemIds.has(comment.purchaseOrderItemId)) : allComments;
    const [localizedPo] = await localizePurchaseUserNames([po as any], (ctx.user.preferredLanguage || "ar") as SupportedLanguage);
    if (ctx.user.role === "delegate") {
      // Participant names stay on the authorized document; no directory/profile is returned.
      return localizeMasterDataReferences({ ...localizedPo, requestedByName: localizedPo.requestedByName ?? null,
        items: items.map((item: any) => ({ ...item, delegateName: null })), comments }, (ctx.user.preferredLanguage || "ar") as SupportedLanguage);
    }
    return { ...localizedPo, items, comments, ...(isPurchasePdfApprover(ctx.user) ? await purchaseDocumentPermission(ctx.user, input.id) : { pdfAllowed: true, pdfBlockedReason: null }) };
  }),

list: protectedProcedure.input(z.object({
  status: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  requestedById: z.number().optional(),
}).optional()).query(async ({ input, ctx }) => {
  const role = ctx.user.role;

  // الأدوار المقيّدة بطلباتها الخاصة فقط: تصفية مباشرة بالاستعلام (أداء أفضل،
  // لا حاجة لجلب كل الطلبات ثم فلترتها).
  if (OWN_REQUESTS_ONLY_ROLES.includes(role)) {
    const rows = await db.getPurchaseOrders({
      status: input?.status,
      dateFrom: input?.dateFrom,
      dateTo: input?.dateTo,
      requestedById: ctx.user.id, // دائماً طلباته فقط
    });
    return localizePurchaseUserNames(rows as any[], (ctx.user.preferredLanguage || "ar") as SupportedLanguage);
  }

  // ✅ الحارس المركزي (server/_core/authz) — نفس القرار بالضبط المستخدم من
  // getById عبر assertCanViewPurchaseOrder، فلا يمكن أن ينحرف نطاق القائمة عن
  // نطاق التفاصيل. فلتر requestedById الاختياري يبقى متاحًا فقط للأدوار التي
  // كانت تدعمه أصلًا (الأدوار كاملة الصلاحية + أدوار الاعتماد/الاستلام).
  const supportsRequestedByIdFilter =
    ["owner", "admin", "maintenance_manager", "general_maintenance_manager", "construction_procurement_manager", "purchase_manager", "accountant", "senior_management", "executive_director", "warehouse"].includes(role);

  const allPOs = await db.getPurchaseOrders({
    status: input?.status,
    dateFrom: input?.dateFrom,
    dateTo: input?.dateTo,
    requestedById: supportsRequestedByIdFilter ? input?.requestedById : undefined,
  });
  const visible = await filterVisiblePurchaseOrders(ctx.user, allPOs);

  if (role === "delegate") {
    // itemCount الأصلي = إجمالي أصناف الطلب كله (لكل الأدوار). للمندوب تحديداً
    // يجب أن يعكس عدد أصنافه هو فقط ضمن هذا الطلب، وليس إجمالي كل المناديب.
    const items = await db.getPOItemsByDelegate(ctx.user.id);
    const myItemCountByPO = new Map<number, number>();
    for (const it of items) {
      myItemCountByPO.set(it.purchaseOrderId, (myItemCountByPO.get(it.purchaseOrderId) ?? 0) + 1);
    }
    const rows = visible.map(po => ({ ...po, itemCount: myItemCountByPO.get(po.id) ?? 0 }));
    return localizePurchaseUserNames(rows as any[], (ctx.user.preferredLanguage || "ar") as SupportedLanguage);
  }

  return withPurchaseDocumentPermissions(ctx.user, await localizePurchaseUserNames(visible as any[], (ctx.user.preferredLanguage || "ar") as SupportedLanguage));
}),

  // Delegate-only read archive; existing operation/download boundaries remain unchanged.
  completedItems: delegateProcedure.input(delegateCompletedInput).query(({ ctx, input }) => listDelegateCompleted(ctx.user, input)),

  myItems: protectedProcedure.query(async ({ ctx }) => {
    const isAdminOrOwner = ctx.user.role === "admin" || ctx.user.role === "owner";
    if (isAdminOrOwner) {
      // Admin/owner see all items
      return db.getAllPOItems();
    }
    if (ctx.user.role !== "delegate") return [];
    return db.getPOItemsByDelegate(ctx.user.id);
  }),

  /**
   * «متابعة أصنافي» — قائمة مسطحة بكل الأصناف داخل طلبات الشراء التي أنشأها
   * المستخدم نفسه، مع حالة كل صنف والمندوب المسؤول عنه. لا تمنح أي صلاحية
   * تنفيذ جديدة؛ هي شاشة متابعة فقط.
   */
  myRequestedItems: protectedProcedure.query(async ({ ctx }) => {
    const items = await db.getPOItemsRequestedBy(ctx.user.id);
    const localized = await localizePurchaseUserNames(items as any[], (ctx.user.preferredLanguage || "ar") as SupportedLanguage);
    return { items: localized, total: localized.length };
  }),

  /**
   * «متابعة التوريد» — عرض إداري شامل لمديري الصيانة/الإنشاءات وAdmin/Owner،
   * بينما المندوب لا يمكنه جلب إلا الأصناف المسندة إليه. هذا القيد خادمي وليس
   * مجرد إخفاء تبويب في الواجهة.
   */
  supplyTracking: protectedProcedure.query(async ({ ctx }) => {
    if (ctx.user.role === APP_ROLE.DELEGATE) {
      const items = await db.getPurchaseSupplyTrackingItems(ctx.user.id);
      const scoped = items.filter(item => Number(item.delegateId) === ctx.user.id);
      const enriched = (await enrichPurchaseCycleItemsBatch(scoped)).filter(isDelegateSupplyItemOpen);
      const localized = await localizePurchaseUserNames(enriched, (ctx.user.preferredLanguage || "ar") as SupportedLanguage);
      return { items: localized, total: localized.length, scope: "delegate" as const };
    }
    if (!canRoleViewAllPurchaseSupplyTracking(ctx.user.role)) {
      throw new TRPCError({ code: "FORBIDDEN", message: "غير مصرح بعرض متابعة التوريد" });
    }
    const items = await db.getPurchaseSupplyTrackingItems();
    const localized = await localizePurchaseUserNames(items as any[], (ctx.user.preferredLanguage || "ar") as SupportedLanguage);
    return { items: localized, total: localized.length, scope: "all" as const };
  }),

  /** Timeline لبند شراء محدد، بنفس صلاحية مشاهدة طلب الشراء الأصلي. */
  itemHistory: protectedProcedure.input(z.object({ itemId: z.number() })).query(async ({ input, ctx }) => {
    const item = await db.getPOItemById(input.itemId);
    if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "الصنف غير موجود" });
    if (ctx.user.role === "delegate") assertPOItemAssignedToDelegate(ctx.user, item);
    const po = await db.getPurchaseOrderById(item.purchaseOrderId);
    if (!po) throw new TRPCError({ code: "NOT_FOUND", message: "طلب الشراء غير موجود" });
    await assertCanViewPurchaseOrder(ctx.user, po);
    const timeline = await db.getPOItemTimeline(input.itemId);
    if (!timeline) throw new TRPCError({ code: "NOT_FOUND", message: "تعذر جلب تاريخ الصنف" });
    const [localized] = await localizePurchaseUserNames([timeline as any], (ctx.user.preferredLanguage || "ar") as SupportedLanguage);
    return localized;
  }),

  /**
   * قائمة مسطحة بأصناف المندوب التي تحتاج إجراءه الآن.
   * تختلف عن actionableForMe التي تجمع العمل على مستوى PR؛ هذه الواجهة تخدم
   * تبويب «أصنافي بانتظار المعالجة» لتفادي فتح عشرات الطلبات واحدًا واحدًا.
   */
  actionableItemsForMe: protectedProcedure.query(async ({ ctx }) => {
    if (ctx.user.role !== "delegate") return { items: [], total: 0 };

    const assignedItems = await db.getPOItemsByDelegate(ctx.user.id);
    if (assignedItems.length === 0) return { items: [], total: 0 };

    const bundleReserved = await reservedPricingItemIds(pricingBundlesEnabled() ? await db.getDb() : null, assignedItems.map((i: any) => i.id));
    const enriched = await enrichPurchaseCycleItemsBatch(assignedItems);
    const items = enriched.flatMap((item: any) => {
      const poStatus = String(item.purchaseOrderStatus || "");
      const actionMode = getDelegateItemActionMode(poStatus, item);
      if (!actionMode || (actionMode === "estimate" && bundleReserved.has(item.id))) return [];

      const actionLabel = actionMode === "purchase"
        ? (poStatus === "partial_purchase" ? "إكمال الشراء" : "تنفيذ الشراء")
        : (item.status === "estimated" ? "جاهز للإرسال" : "بانتظار التسعير");

      return [{ ...item, actionMode, actionLabel }];
    });

    const localized = await localizePurchaseUserNames(items, (ctx.user.preferredLanguage || "ar") as SupportedLanguage);
    localized.sort(comparePurchaseRequiredDates);
    return { items: localized, total: localized.length };
  }),

  pendingEstimateItems: protectedProcedure.query(async ({ ctx }) => {
    const isAdminOrOwner = ctx.user.role === "admin" || ctx.user.role === "owner";

    // كانت هذه الدالة تمرّ على كل بند بحلقة for عادية، وتفتح 3-4 رحلات قاعدة
    // بيانات متتالية لكل بند (استعلام po يدويًا + enrichPurchaseCycleItem القديمة).
    // مع عشرات البنود هذا يعني مئات الرحلات المتتابعة — أبطأ نقطة بالصفحة فعليًا.
    // الحل الدائم: تصفية البنود بالذاكرة أولاً، ثم إثراء الناجين منها بضربة واحدة
    // عبر enrichPurchaseCycleItemsBatch (استعلام JOIN واحد لكل البنود دفعة واحدة).
    const collectEligibleItems = async (allItems: any[]) => {
      const bundleReserved = await reservedPricingItemIds(pricingBundlesEnabled() ? await db.getDb() : null, allItems.map((i: any) => i.id));
      const eligible = allItems.filter(item => {
        if (bundleReserved.has(item.id)) return false;
        const isUnpriced = item.status === "pending" && !item.delegateChangeRequestedAt;
        const isPricedNotSubmitted = item.status === "estimated" && !item.batchId && !item.delegateChangeRequestedAt;
        return isUnpriced || isPricedNotSubmitted;
      });
      const enriched = await enrichPurchaseCycleItemsBatch(eligible);
      const excludedPoStatuses = new Set(["draft", "pending_review", "closed", "rejected"]);
      const visible = enriched.filter(item => item.purchaseOrderStatus && !excludedPoStatuses.has(item.purchaseOrderStatus));

      // [PB 2026-08-29] إثراء بحقلي الحزمة — عرض فقط، لا يؤثر على الأهلية
      // أو الفلترة أعلاه إطلاقًا. الأصناف التابعة لطلبات غير مجمّعة تبقى
      // بلا هذين الحقلين فتُعرض كما اليوم حرفيًا.
      const packageMap = await db.getPackageInfoForPOs(
        Array.from(new Set(visible.map((i: any) => i.purchaseOrderId)))
      );
      return visible.map((item: any) => {
        const pkg = packageMap.get(item.purchaseOrderId);
        return pkg ? { ...item, packageId: pkg.packageId, packageNumber: pkg.packageNumber } : item;
      });
    };

    if (isAdminOrOwner) {
      const [pending, estimated] = await Promise.all([
        db.getPOItemsByStatus("pending"),
        db.getPOItemsByStatus("estimated"),
      ]);
      return collectEligibleItems([...pending, ...estimated]);
    }
    if (ctx.user.role !== "delegate") return [];
    const items = await db.getPOItemsByDelegate(ctx.user.id);
    return collectEligibleItems(items);
  }),

  pendingDeliveryItems: protectedProcedure.query(async ({ ctx }) => {
    const isAdminOrOwner = ctx.user.role === "admin" || ctx.user.role === "owner";
    if (isAdminOrOwner || ctx.user.role === "warehouse") {
      // المصدر الصحيح للحقيقة: بنود delivered_to_warehouse التي لم يُنشأ لها
      // warehouse_receipt_items مرتبط بـ warehouse_receipts بحالة confirmed بعد.
      // (سجلات invoiceDraft/OCR لا تُحسب لأن receipt حالتها ليست confirmed بعد)
      const items = await db.getPOItemsPendingInventoryEntry();
      // كانت هذه فيها نفس خلل N+1 (استعلامين لكل بند بالتتابع) — استُبدلت بنفس
      // الاستعلام المجمّع الدائم بدل رحلة قاعدة بيانات مستقلة لكل بند.
      const contextMap = await db.getPurchaseOrderTicketContextBatch(items.map((i: any) => i.purchaseOrderId));
      const enriched = items.map((item: any) => ({
        ...item,
        ticketAssignedToId: contextMap.get(item.purchaseOrderId)?.ticket?.assignedToId ?? null,
      }));
      return enriched;
    }
    return [];
  }),

  // جلب أصناف المخزون الجاهزة للتسليم.
  // إذا كان بند الشراء ما زال يمثل احتياج بلاغ B مفتوحًا نعرض فني البلاغ
  // كمرجع ثابت. بعد أول تسليم مرتبط بالبند يصبح الرصيد المتبقي مخزونًا عامًا
  // ولا يُعاد عرض اسم فني البلاغ القديم.
  inventoryReadyForDelivery: protectedProcedure.query(async ({ ctx }) => {
    const isAdminOrOwner = ctx.user.role === "admin" || ctx.user.role === "owner";
    if (!isAdminOrOwner && ctx.user.role !== "warehouse") return [];

    const database = await db.getDb();
    if (!database) return [];

    const rows = await database.execute(`
      SELECT
        inv.id,
        inv.itemName,
        inv.itemName_ar,
        inv.itemName_en,
        inv.quantity,
        inv.unit,
        inv.averageCost,
        inv.internalCode,
        inv.manufacturerBarcode,
        inv.createdAt AS createdAt,
        inv.receiptId,
        wr.purchaseOrderId,
        wr.receiptNumber,
        wr.vendorName,
        po.poNumber,
        wri.purchaseOrderItemId,
        poi.status AS purchaseOrderItemStatus,
        po.ticketId AS sourceTicketId,
        t.ticketNumber AS sourceTicketNumber,
        t.status AS sourceTicketStatus,
        t.maintenancePath,
        t.maintenanceResponsibleDepartment AS sourceMaintenanceResponsibleDepartment,
        t.assignedToId AS sourceAssignedTechnicianId,
        assigned.name AS sourceAssignedTechnicianName
      FROM inventory inv
      LEFT JOIN warehouse_receipts wr
        ON inv.receiptId = wr.id
      LEFT JOIN warehouse_receipt_items wri
        ON wri.receiptId = inv.receiptId
       AND wri.inventoryId = inv.id
      LEFT JOIN purchase_order_items poi
        ON poi.id = wri.purchaseOrderItemId
      LEFT JOIN purchase_orders po
        ON po.id = poi.purchaseOrderId
      LEFT JOIN tickets t
        ON t.id = po.ticketId
      LEFT JOIN users assigned
        ON assigned.id = t.assignedToId
      WHERE inv.quantity > 0
      ORDER BY inv.createdAt DESC, wri.id DESC
    `);

    const sourceItems = (rows as any)?.[0] || [];
    const seenInventoryIds = new Set<number>();
    const result: any[] = [];

    for (const raw of sourceItems as any[]) {
      const inventoryId = Number(raw.id);
      if (seenInventoryIds.has(inventoryId)) continue;
      seenInventoryIds.add(inventoryId);

      const exposeTicketLink = shouldExposeTicketMaterialLink({
        ticketId: raw.sourceTicketId ? Number(raw.sourceTicketId) : null,
        ticketStatus: raw.sourceTicketStatus ?? null,
        maintenancePath: raw.maintenancePath ?? null,
        assignedTechnicianId: raw.sourceAssignedTechnicianId
          ? Number(raw.sourceAssignedTechnicianId)
          : null,
        purchaseOrderItemId: raw.purchaseOrderItemId
          ? Number(raw.purchaseOrderItemId)
          : null,
        purchaseOrderItemStatus: raw.purchaseOrderItemStatus ?? null,
      });

      const {
        sourceTicketId,
        sourceTicketNumber,
        sourceTicketStatus,
        sourceMaintenanceResponsibleDepartment,
        sourceAssignedTechnicianId,
        sourceAssignedTechnicianName,
        ...publicInventoryRow
      } = raw;

      result.push({
        ...publicInventoryRow,
        purchaseOrderItemId: exposeTicketLink && raw.purchaseOrderItemId
          ? Number(raw.purchaseOrderItemId)
          : null,
        ticketId: exposeTicketLink && raw.sourceTicketId
          ? Number(raw.sourceTicketId)
          : null,
        ticketNumber: exposeTicketLink ? raw.sourceTicketNumber ?? null : null,
        ticketResponsibleDepartment: exposeTicketLink ? raw.sourceMaintenanceResponsibleDepartment ?? null : null,
        ticketAssignedToId: exposeTicketLink && raw.sourceAssignedTechnicianId
          ? Number(raw.sourceAssignedTechnicianId)
          : null,
        ticketAssignedToName: exposeTicketLink
          ? raw.sourceAssignedTechnicianName ?? null
          : null,
      });
    }

    return result;
  }),

  // تسليم صنف من المخزون إلى فني مستلم فعلي.
  // المستلم إلزامي. عند وجود حلقة ربط مع بلاغ B يُحدَّث بند الطلب ويُفتح
  // مسار الإصلاح بعد اكتمال تسليم جميع الأصناف الفعالة، بينما يبقى الرصيد
  // الزائد في المخزون دون ربط لاحق بالبلاغ القديم.
  deliverInventoryItem: warehouseProcedure.input(z.object({
    inventoryId:   z.number(),
    deliveredToId: z.number(),
    deliveryQty:   z.number().positive(),
    deliveryUnit:  z.string().min(1, "الوحدة مطلوبة"),
    lotTrackingToken: z.string().trim().min(1).optional(),
    costAllocations: issueCostAllocationsSchema.optional(),
    notes:         z.string().optional(),
  })).mutation(async ({ input, ctx }) => {
    const invItem = await db.getInventoryItemById(input.inventoryId);
    if (!invItem) throw new TRPCError({ code: "NOT_FOUND", message: "الصنف غير موجود في المخزون" });

    if (input.deliveryQty > invItem.quantity) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `الكمية المطلوبة (${input.deliveryQty}) أكبر من الرصيد (${invItem.quantity})`,
      });
    }

    // QR/Lot هو هوية الوارد الفعلية. نحلّه قبل تقرير ربط البلاغ حتى لا نعتمد
    // على Inventory مجمّع قد يحتوي Lots قادمة من طلبات شراء مختلفة.
    const database = await db.getDb();
    if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "تعذر الاتصال بقاعدة البيانات" });
    const scannedLot = input.lotTrackingToken
      ? await resolveInventoryLotForIssue({
          tx: database,
          trackingToken: input.lotTrackingToken,
          inventoryId: input.inventoryId,
          inventoryCatalogItemId: (invItem as any).linkedItemId ?? null,
        })
      : null;
    const context = scannedLot
      ? (scannedLot.purchaseOrderItemId
          ? await getInventoryTicketDeliveryContext(input.inventoryId, scannedLot.purchaseOrderItemId)
          : null)
      : await getInventoryTicketDeliveryContext(input.inventoryId);
    const linkedTicketForRecipient = context?.ticketId ? await db.getTicketById(context.ticketId) : null;
    const actualRecipient = await assertActualDeliveryRecipient(input.deliveredToId, linkedTicketForRecipient);
    const contextSnapshot = context ? {
      ticketId: context.ticketId,
      ticketStatus: context.ticketStatus,
      maintenancePath: context.maintenancePath,
      assignedTechnicianId: context.assignedTechnicianId,
      purchaseOrderItemId: context.purchaseOrderItemId,
      purchaseOrderItemStatus: context.purchaseOrderItemStatus,
    } : null;
    const pendingTicketMaterial = !!contextSnapshot && isPendingTicketMaterialLink(contextSnapshot);
    const linkToTicket = !!contextSnapshot && shouldExposeTicketMaterialLink(contextSnapshot);

    if (pendingTicketMaterial && !context?.assignedTechnicianId) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "لا يمكن تسليم مواد البلاغ قبل وجود فني مسند له",
      });
    }

    const deliveryResult = await db.issueDelivery({
      inventoryId: input.inventoryId,
      quantity: input.deliveryQty,
      unit: input.deliveryUnit,
      performedById: ctx.user.id,
      deliveredToId: input.deliveredToId,
      purchaseOrderItemId: linkToTicket ? context?.purchaseOrderItemId ?? undefined : undefined,
      ticketId: linkToTicket ? context?.ticketId ?? undefined : undefined,
      ticketItemId: linkToTicket ? context?.ticketItemId ?? undefined : undefined,
      ticketNumber: linkToTicket ? context?.ticketNumber ?? undefined : undefined,
      assignedTechnicianId: linkToTicket ? context?.assignedTechnicianId ?? undefined : undefined,
      assignedTechnicianName: linkToTicket ? context?.assignedTechnicianName ?? undefined : undefined,
      notes: input.notes || (linkToTicket ? "تسليم مادة مرتبطة ببلاغ" : "تسليم من المخزون العام"),
      markPurchaseOrderItemDelivered: linkToTicket,
      lotTrackingToken: input.lotTrackingToken,
      costAllocations: input.costAllocations,
    });

    let ticketStatus: string | null = null;
    if (
      linkToTicket &&
      context?.purchaseOrderId &&
      context.ticketId
    ) {
      ticketStatus = await syncAndNotifyTicketMaterialDelivery({
        purchaseOrderId: context.purchaseOrderId,
        ticketId: context.ticketId,
        actorId: ctx.user.id,
        actualRecipientId: input.deliveredToId,
        actualRecipientName: (actualRecipient as any).name || "فني",
      });
    }

    await db.createAuditLog({
      userId: ctx.user.id,
      action: linkToTicket ? "deliver_ticket_material_from_inventory" : "deliver_inventory_item",
      entityType: "inventory",
      entityId: input.inventoryId,
      newValues: {
        deliveredToId: input.deliveredToId,
        assignedTechnicianId: linkToTicket ? context?.assignedTechnicianId ?? null : null,
        purchaseOrderItemId: linkToTicket ? context?.purchaseOrderItemId ?? null : null,
        ticketId: linkToTicket ? context?.ticketId ?? null : null,
        deliveryQty: input.deliveryQty,
        remainingQuantity: Math.max(0, Number(invItem.quantity) - input.deliveryQty),
        lotId: deliveryResult.lotId ?? null,
        inventoryTransactionId: deliveryResult.inventoryTransactionId ?? null,
          costAllocationCount: deliveryResult.costAllocationCount ?? 0,
          allocatedCostTotal: deliveryResult.allocatedCostTotal ?? null,
      },
    });

    return {
      success: true,
      ...deliveryResult,
      linkedToTicket: linkToTicket,
      ticketStatus,
      remainingQuantity: Math.max(0, Number(invItem.quantity) - input.deliveryQty),
    };
  }),

  pendingPurchaseItems: protectedProcedure.query(async ({ ctx }) => {
    const isAdminOrOwner = ctx.user.role === "admin" || ctx.user.role === "owner";
    let items: any[] = [];
    if (isAdminOrOwner) {
      const approved = await db.getPOItemsByStatus("approved");
      const funded = await db.getPOItemsByStatus("funded");
      items = [...approved, ...funded];
    } else if (ctx.user.role === "delegate") {
      const mine = await db.getPOItemsByDelegate(ctx.user.id);
      items = mine.filter(i => i.status === "approved" || i.status === "funded");
    }
    return enrichPurchaseCycleItemsBatch(items);
  }),

  pendingWarehouseItems: protectedProcedure.query(async ({ ctx }) => {
    const isAdminOrOwner = ctx.user.role === "admin" || ctx.user.role === "owner";
    if (!isAdminOrOwner && ctx.user.role !== "warehouse") return [];
    const purchased = await db.getPOItemsByStatus("purchased");
    const enriched = await enrichPurchaseCycleItemsBatch(purchased);
    // المسار C خدمة صيانة خارجية وليس بضاعة تنتظر استلام المستودع من المورد.
    return enriched.filter(item => !item.isExternalMaintenance);
  }),

  requestRevision: delegateProcedure.input(z.object({
    id: z.number(),
    note: z.string().min(5, "يجب كتابة سبب طلب المراجعة (بحد أدنى 5 أحرف)"),
  })).mutation(async ({ input, ctx }) => {
    const po = await db.getPurchaseOrderById(input.id);
    if (!po) throw new TRPCError({ code: "NOT_FOUND" });

    // Reset all approvals and set to revision_needed
    await db.updatePurchaseOrder(input.id, {
      status: "revision_needed",
      accountingApprovedById: null,
      accountingApprovedAt: null,
      managementApprovedById: null,
      managementApprovedAt: null,
      totalEstimatedCost: null,
    });

    // أعد فقط الأصناف النشطة للمراجعة. cancelled/rejected سجلات نهائية مرجعية
    // ولا يجوز أن يعيد طلب مراجعة كامل تنشيطها أو يمسح قرارها السابق.
    const items = await db.getPOItems(input.id);
    for (const item of items) {
      if (["cancelled", "rejected"].includes(item.status)) continue;
      await db.updatePOItem(item.id, { status: "pending", estimatedUnitCost: null, estimatedTotalCost: null });
    }

    // Add immutable comment
    await createTranslatedProcurementComment(db, {
      purchaseOrderId: input.id,
      userId: ctx.user.id,
      userName: ctx.user.name || "User",
      userRole: ctx.user.role,
      actionType: "return_for_revision",
      note: input.note,
    });

    // Notify the creator
    await db.createNotification({
      userId: po.requestedById,
      title: "⚠️ طلب مراجعة لطلب شراء",
      message: `قام المندوب ${ctx.user.name} بإعادة طلب الشراء #${po.poNumber} للمراجعة: ${input.note}`,
      type: "warning",
      relatedPoId: input.id
    });

    await syncPathBTicketFromPurchaseOrder(input.id, ctx.user.id, "أعيد طلب الشراء للمراجعة");
    await db.createAuditLog({ userId: ctx.user.id, action: "request_revision", entityType: "purchase_order", entityId: input.id, newValues: { status: "revision_needed", note: input.note } });
    return { success: true };
  }),

  requestItemRevision: delegateProcedure.input(z.object({
    itemId: z.number(),
    note: z.string().min(5, "يجب كتابة سبب طلب المراجعة"),
  })).mutation(async ({ input, ctx }) => {

    const item = await db.getPOItemById(input.itemId);

    if (!item) {
      throw new TRPCError({ code: "NOT_FOUND", message: "الصنف غير موجود" });
    }

    const po = await db.getPurchaseOrderById(item.purchaseOrderId);

    if (!po) {
      throw new TRPCError({ code: "NOT_FOUND", message: "طلب الشراء غير موجود" });
    }

    // ── تحقق أن المندوب يملك هذا الصنف فعلاً ──
    const isAdminOrOwner = ctx.user.role === "admin" || ctx.user.role === "owner";
    if (!isAdminOrOwner && item.delegateId !== ctx.user.id) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "لا يمكنك طلب مراجعة صنف غير مخصص لك",
      });
    }

    // يُسمح بطلب المراجعة في أي وقت طالما الصنف لا يزال متاحاً لدى المندوب
    // (لم يُسعَّر بعد ولم يُرسل ضمن أي دفعة تسعير)، بغض النظر عن حالة الطلب
    // الإجمالية (فلا يتأثر ذلك بتقدّم أصناف أخرى للمحاسبة عبر مندوبين آخرين)
    if (item.status !== "pending") {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "لا يمكن طلب مراجعة الصنف بعد تسعيره أو إرساله بالفعل",
      });
    }
    if (item.batchId) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "لا يمكن طلب مراجعة صنف تم إرساله بالفعل ضمن دفعة تسعير",
      });
    }

    await db.updatePOItem(item.id, {
      status: "needs_item_revision",
      itemRevisionNote: input.note,
      itemRevisionRequestedById: ctx.user.id,
      itemRevisionRequestedAt: new Date(),
    });
    await queuePurchaseTranslation("PO_ITEM", item.id, [
      { fieldName: "itemRevisionNote", text: input.note },
    ], ctx.user.id);

    await createTranslatedProcurementComment(db, {
      purchaseOrderId: po.id,
      purchaseOrderItemId: item.id,
      userId: ctx.user.id,
      userName: ctx.user.name || "User",
      userRole: ctx.user.role,
      actionType: "item_revision_requested",
      note: `الصنف: ${item.itemName}\n\nالسبب:\n${input.note}`,
    });

    // أخطر منشئ الطلب ليعدّل الصنف
    await db.createNotification({
      userId: po.requestedById,
      title: "⚠️ طلب مراجعة صنف",
      message: `الصنف "${item.itemName}" يحتاج مراجعة.\n\nالسبب:\n${input.note}\n\nيمكنك تعديل الصنف وإعادة إرساله، أو إلغاءه نهائياً.`,
      type: "warning",
      relatedPoId: po.id,
    });

    await db.createAuditLog({
      userId: ctx.user.id,
      action: "request_item_revision",
      entityType: "purchase_order_item",
      entityId: item.id,
      newValues: { status: "needs_item_revision", note: input.note },
    });

    // ── بعد طلب المراجعة: تحقق هل الأصناف الباقية كلها مسعّرة ──
    // السيناريو: المندوب سعّر 2 وطلب مراجعة 2 → الـ 2 المسعّرة يجب أن تمشي للمحاسبة الآن
    const allItemsAfter = await db.getPOItems(po.id);
    const readyForAccounting = allItemsAfter.every(
      i =>
        i.status === "estimated" ||
        i.status === "rejected" ||
        i.status === "cancelled" ||
        i.status === "needs_item_revision"
    );
    // تحقق إضافي: يجب أن يكون في صنف واحد على الأقل مسعّر حتى نتقدم
    const hasEstimatedItems = allItemsAfter.some(i => i.status === "estimated");

    if (readyForAccounting && hasEstimatedItems) {
      const finalTotalEstimated = allItemsAfter
        .filter(i => i.status === "estimated")
        .reduce((sum, i) => sum + parseFloat(i.estimatedTotalCost || "0"), 0);

      await db.updatePurchaseOrder(po.id, {
        status: "pending_accounting",
        totalEstimatedCost: String(finalTotalEstimated),
      });

      const accountants = await db.getUsersByRole("accountant");
      for (const acc of accountants) {
        await db.createNotification({
          userId: acc.id,
          title: "طلب شراء بانتظار الاعتماد",
          message: `طلب شراء رقم ${po.poNumber} بانتظار اعتماد الحسابات (بعض الأصناف قيد المراجعة).`,
          type: "warning",
          relatedPoId: po.id,
        });
      }
    }

    await syncPathBTicketFromPurchaseOrder(
      po.id,
      ctx.user.id,
      "طُلبت مراجعة أحد أصناف طلب الشراء",
    );
    return { success: true };

  }),

  resubmit: protectedProcedure.input(z.object({
    id: z.number(),
    note: z.string().optional(),
  })).mutation(async ({ input, ctx }) => {
    const po = await db.getPurchaseOrderById(input.id);
    if (!po) throw new TRPCError({ code: "NOT_FOUND" });
    const isAdminOrOwner = ctx.user.role === "admin" || ctx.user.role === "owner";
    if (!isAdminOrOwner && po.requestedById !== ctx.user.id) {
      throw new TRPCError({ code: "FORBIDDEN", message: "فقط منشئ الطلب أو الإدارة يمكنه إعادة التقديم" });
    }
    if (po.status !== "revision_needed") throw new TRPCError({ code: "BAD_REQUEST", message: "الطلب ليس في حالة مراجعة" });

    await db.updatePurchaseOrder(input.id, { status: "pending_review" });

    await createTranslatedProcurementComment(db, {
      purchaseOrderId: input.id,
      userId: ctx.user.id,
      userName: ctx.user.name || "User",
      userRole: ctx.user.role,
      actionType: "resubmitted",
      note: input.note || "تم تعديل الطلب وإعادة التقديم",
    });

    await syncPathBTicketFromPurchaseOrder(input.id, ctx.user.id, "أعيد إرسال طلب الشراء للمراجعة");
    await db.createAuditLog({ userId: ctx.user.id, action: "resubmit_po", entityType: "purchase_order", entityId: input.id });
    return { success: true };
  }),

  resubmitCancelledPurchase: protectedProcedure.input(z.object({
    itemId: z.number(),
  })).mutation(async ({ input, ctx }) => {

    const item = await db.getPOItemById(input.itemId);
    if (!item) {
      throw new TRPCError({ code: "NOT_FOUND", message: "الصنف غير موجود" });
    }

    const po = await db.getPurchaseOrderById(item.purchaseOrderId);
    if (!po) {
      throw new TRPCError({ code: "NOT_FOUND", message: "طلب الشراء غير موجود" });
    }

    assertCanResolveReturnedPOItem(
      ctx.user,
      { requestedById: po.requestedById, itemStatus: item.status },
      "فقط منشئ الطلب أو الإدارة يمكنه إعادة إرسال الصنف"
    );

    if (item.status !== "purchase_cancelled") {
      throw new TRPCError({ code: "BAD_REQUEST", message: "الصنف ليس في حالة إلغاء شراء" });
    }

    // ── الصنف يرجع مباشرة لحالة approved — السعر معتمد بالفعل ولا يحتاج تسعير جديد ──
    // لا يمر على التسعير، ولا الحسابات، ولا اعتماد الإدارة العليا من جديد
    await db.updatePOItem(item.id, {
      status: "approved",
      purchaseCancelReason: null,
      purchaseCancelledById: null,
      purchaseCancelledByName: null,
      purchaseCancelledAt: null,
    });

    await createTranslatedProcurementComment(db, {
      purchaseOrderId: po.id,
      purchaseOrderItemId: item.id,
      userId: ctx.user.id,
      userName: ctx.user.name || "User",
      userRole: ctx.user.role,
      actionType: "cancelled_purchase_resubmitted",
      note: `تم تعديل الصنف "${item.itemName}" وإعادة إرساله للمندوب للشراء مباشرة (نفس السعر المعتمد سابقاً)`,
    });

    // ── أخطر المندوب المخصص للصنف مباشرةً للشراء ──
    if (item.delegateId) {
      await db.createNotification({
        userId: item.delegateId,
        title: "🛒 صنف جاهز للشراء",
        message: `تم تعديل الصنف "${item.itemName}" من طلب الشراء ${po.poNumber} وهو جاهز للشراء الآن مباشرة.`,
        type: "success",
        relatedPoId: po.id,
      });
    }

    await syncPathBTicketFromPurchaseOrder(
      item.purchaseOrderId,
      ctx.user.id,
      "أعيد الصنف الملغى إلى مرحلة الشراء",
    );

    await db.createAuditLog({
      userId: ctx.user.id,
      action: "resubmit_cancelled_purchase",
      entityType: "purchase_order_item",
      entityId: item.id,
    });

    return { success: true };

  }),

  finalizeCancelledItem: protectedProcedure.input(z.object({
    itemId: z.number(),
  })).mutation(async ({ input, ctx }) => {

    const item = await db.getPOItemById(input.itemId);
    if (!item) {
      throw new TRPCError({ code: "NOT_FOUND", message: "الصنف غير موجود" });
    }

    const po = await db.getPurchaseOrderById(item.purchaseOrderId);
    if (!po) {
      throw new TRPCError({ code: "NOT_FOUND", message: "طلب الشراء غير موجود" });
    }

    assertCanResolveReturnedPOItem(
      ctx.user,
      { requestedById: po.requestedById, itemStatus: item.status },
      "فقط منشئ الطلب أو الإدارة يمكنه إلغاء الصنف نهائياً"
    );

    if (!["purchase_cancelled", "needs_item_revision"].includes(item.status)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "الصنف ليس معاداً لمنشئ الطلب لاتخاذ قرار" });
    }

    const wasRevisionRequest = item.status === "needs_item_revision";

    // ── إلغاء نهائي — لا رجعة فيه ──
    await db.updatePOItem(item.id, { status: "cancelled" });
    await rejectEmptyPendingPricingBatches(item.purchaseOrderId, {
      actorId: ctx.user.id,
      actorName: ctx.user.name,
      reason: `أُغلقت الدفعة تلقائيًا بعد الإلغاء النهائي لجميع أصنافها — بواسطة ${ctx.user.name || "مستخدم"}`,
    });

    await createTranslatedProcurementComment(db, {
      purchaseOrderId: po.id,
      purchaseOrderItemId: item.id,
      userId: ctx.user.id,
      userName: ctx.user.name || "User",
      userRole: ctx.user.role,
      actionType: wasRevisionRequest ? "item_revision_cancelled_final" : "cancelled_purchase_finalized",
      note: wasRevisionRequest
        ? `قام ${ctx.user.name || "المستخدم"} بإلغاء الصنف "${item.itemName}" نهائياً بعد طلب مراجعته`
        : `قام ${ctx.user.name || "المستخدم"} بإلغاء الصنف "${item.itemName}" نهائياً بعد تعذّر شرائه`,
    });

    // ── إعادة حساب حالة الطلب بعد الإلغاء النهائي ──
    const allItems = await db.getPOItems(item.purchaseOrderId);
    const activeItems = allItems.filter(
      i => !["rejected", "cancelled", "needs_item_revision", "purchase_cancelled"].includes(i.status)
    );
    const purchasedOrLater = activeItems.filter(i =>
      ["purchased", "delivered_to_warehouse", "delivered_to_requester"].includes(i.status)
    );
    const hasPendingItems = allItems.some(i => i.status === "needs_item_revision" || i.status === "purchase_cancelled");
    const allTerminal = allItems.every(i => ["rejected", "cancelled"].includes(i.status));

    if (allTerminal) {
      await db.updatePurchaseOrder(item.purchaseOrderId, {
        status: "rejected",
        rejectedById: ctx.user.id,
        rejectedAt: new Date(),
        rejectionReason: "تم إلغاء جميع أصناف طلب الشراء نهائياً",
      });
    } else if (activeItems.length > 0 && purchasedOrLater.length === activeItems.length && !hasPendingItems) {
      await db.updatePurchaseOrder(item.purchaseOrderId, { status: "purchased" });

    }

    await syncPathBTicketFromPurchaseOrder(
      item.purchaseOrderId,
      ctx.user.id,
      "تم حسم الصنف الملغى نهائيًا",
    );

    await db.createAuditLog({
      userId: ctx.user.id,
      action: wasRevisionRequest ? "finalize_revision_item_cancellation" : "finalize_cancelled_item",
      entityType: "purchase_order_item",
      entityId: item.id,
      oldValues: { status: item.status },
      newValues: { status: "cancelled" },
    });

    return { success: true };

  }),

  resubmitItemRevision: protectedProcedure.input(z.object({
    itemId: z.number(),
  })).mutation(async ({ input, ctx }) => {

    const item = await db.getPOItemById(input.itemId);

    if (!item) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "الصنف غير موجود"
      });
    }

    const po = await db.getPurchaseOrderById(item.purchaseOrderId);

    if (!po) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "طلب الشراء غير موجود"
      });
    }

    assertCanResolveReturnedPOItem(
      ctx.user,
      { requestedById: po.requestedById, itemStatus: item.status },
      "فقط منشئ الطلب أو الإدارة يمكنه إعادة إرسال الصنف"
    );

    if (item.status !== "needs_item_revision") {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "الصنف ليس في حالة مراجعة"
      });
    }

    // ── أعد الصنف لحالة pending حتى يسعّره المندوب مباشرة ──
    // الطلب يبقى في pending_estimate وهذا صحيح — المندوب سيسعّر هذا الصنف
    await db.updatePOItem(item.id, {
      status: "pending",
      itemRevisionNote: null,
      itemRevisionRequestedById: null,
      itemRevisionRequestedAt: null,
    });

    await createTranslatedProcurementComment(db, {
      purchaseOrderId: po.id,
      purchaseOrderItemId: item.id,
      userId: ctx.user.id,
      userName: ctx.user.name || "User",
      userRole: ctx.user.role,
      actionType: "item_revision_resubmitted",
      note: `تم تعديل الصنف "${item.itemName}" وإعادة إرساله للمندوب للتسعير`,
    });

    // ── أخطر المندوب المخصص للصنف مباشرةً لتسعيره ──
    if (item.delegateId) {
      await db.createNotification({
        userId: item.delegateId,
        title: "✏️ صنف جاهز للتسعير",
        message: `تم تعديل الصنف "${item.itemName}" من طلب الشراء ${po.poNumber} وهو جاهز للتسعير الآن.`,
        type: "info",
        relatedPoId: po.id,
      });
    }

    await syncPathBTicketFromPurchaseOrder(
      item.purchaseOrderId,
      ctx.user.id,
      "أعيد الصنف للتسعير بعد المراجعة",
    );

    await db.createAuditLog({
      userId: ctx.user.id,
      action: "resubmit_item_revision",
      entityType: "purchase_order_item",
      entityId: item.id,
    });

    return { success: true };

  }),

  update: protectedProcedure.input(z.object({
    id: z.number(),
    notes: z.string().optional(),
  })).mutation(async ({ input, ctx }) => {
    const po = await db.getPurchaseOrderById(input.id);
    if (!po) throw new TRPCError({ code: "NOT_FOUND", message: "طلب الشراء غير موجود" });
    const isAdminOrOwner = ctx.user.role === "admin" || ctx.user.role === "owner";
    if (!isAdminOrOwner && !["maintenance_manager", "general_maintenance_manager", "construction_procurement_manager"].includes(ctx.user.role)) {
      throw new TRPCError({ code: "FORBIDDEN", message: "ليس لديك صلاحية لتعديل طلب الشراء" });
    }
    // مدير الصيانة يستطيع التعديل فقط قبل خروج الطلب من نطاقه المباشر.
    // pending_estimate وما بعدها متابعة فقط، مثل pending_management.
    if (!isAdminOrOwner && !["draft", "pending_review"].includes(po.status)) {
      throw new TRPCError({ code: "FORBIDDEN", message: "هذه المرحلة للمتابعة فقط ولا تسمح لمدير الصيانة بالتعديل" });
    }
    const oldValues = { notes: po.notes };
    await db.updatePurchaseOrder(input.id, { notes: input.notes });
    await db.createAuditLog({ userId: ctx.user.id, action: "update_po", entityType: "purchase_order", entityId: input.id, oldValues, newValues: { notes: input.notes } });
    // Notify managers about PO edit
    const poManagers = await db.getPurchaseManagerUsers();
    for (const mgr of poManagers) {
      if (mgr.id !== ctx.user.id) {
        await db.createNotification({ userId: mgr.id, title: `تعديل طلب شراء #${po.poNumber}`, message: `قام ${ctx.user.name} بتعديل طلب الشراء`, type: "po_updated", relatedPoId: input.id });
      }
    }
    return { success: true };
  }),

  // ── تتبع صنف: خطوة 1 — البحث عن الأسماء المطابقة فقط (لاختيار الصنف بدقة)
  searchItemNames: inventoryReadProcedure
    .input(z.object({ query: z.string().min(2, "اكتب حرفين على الأقل") }))
    .query(async ({ input }) => {
      return db.searchItemNames(input.query);
    }),

  // ── تتبع صنف: خطوة 2 — قصة زمنية كاملة (Timeline) لاسم صنف محدد بدقة
  trackItem: inventoryReadProcedure
    .input(z.object({
      itemName: z.string().min(2, "اكتب حرفين على الأقل"),
      exactMatch: z.boolean().default(false),
    }))
    .query(async ({ input }) => {
      return db.trackItemHistory(input.itemName, input.exactMatch);
    }),
});

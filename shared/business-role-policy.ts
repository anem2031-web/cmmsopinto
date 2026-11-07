/** Central capability boundary for the reviewed business roles.
 * Exact path/type grants are deliberately additive to existing ownership,
 * document-stage and module guards. They never substitute a more powerful role.
 * New endpoints must receive a reviewed grant here before these roles can use them.
 */
export const BUSINESS_GUARDED_ROLES = ["accountant", "senior_management", "executive_director", "warehouse", "food_warehouse_assistant"] as const;
import { EXTERNAL_FOLLOWUP_QUERIES, externalFollowupRpcAllowed } from "./external-maintenance-followup";
import { canAccessReturnsCenter, RETURNS_CENTER_PATH } from "./returns-center";
export type BusinessRole = typeof BUSINESS_GUARDED_ROLES[number];
export type BusinessIdentity = { id: number; role: string; isActive?: number };
export type PricingBundleApprovalStage = "accounting" | "management";
/** DPB-only stage capability. It does not grant accounting actions on a PO/PB. */
export function canApprovePricingBundleStage(actor: BusinessIdentity | null | undefined, stage: PricingBundleApprovalStage): boolean {
  if (!actor || !Number.isSafeInteger(actor.id) || actor.id <= 0 || actor.isActive !== 1) return false;
  const roles = stage === "accounting" ? ["owner", "admin", "accountant", "senior_management"]
    : stage === "management" ? ["owner", "admin", "senior_management"] : [];
  return roles.includes(actor.role);
}
export const isBusinessGuardedRole = (role?: string | null): role is BusinessRole =>
  !!role && (BUSINESS_GUARDED_ROLES as readonly string[]).includes(role);
const paths = (namespace: string, names: string) => names.trim().split(/\s+/).filter(Boolean).map(name => `${namespace}.${name}`);

const sharedQueries = [
  "auth.me", "notifications.summary", "notifications.list", "notifications.unreadCount", "push.getStatus", "push.getVapidPublicKey",
  "users.list", "users.byRole", "users.listTechnicians", "sites.list", "sections.list", "assets.list",
  "centerCategories.list", "purchaseCategories.list", "warehouse.list",
  "inventory.catalogStock", "tickets.getById", "tickets.items", "tickets.history", "tickets.getConfirmation", "tickets.executionReferences", "tickets.departmentPlan", "inspectionResults.listByTicket", "externalMaintenance.getByTicket",
  "catalog.nodes.list", "catalog.items.list", "catalog.units.list",
  "attachments.list", "translation.getEntityTranslations", "translation.getBatchTranslations",
  ...paths("purchaseOrders", "list getById actionableForMe myRequestedItems itemHistory listPricingBatches documentPermission"),
  ...paths("supplierReturns", "status list"),
  ...paths("purchasePackages", "list getById cards actionableSubmissionsForMe submissions"),
  ...paths("improvementIdeas", "listPaginated getById getGroupedClassifiedCounts getClassifiedByGroup executionSummary executionReference"),
  ...paths("inventoryReports", "stockBalance valuation valueDistribution accountingReview analytics movementMeta movements"),
  "inventoryReconciliation.run",
];
const sharedMutations = [
  "auth.login", "auth.logout", "auth.changePassword", "translation.setLanguage",
  "notifications.markRead", "notifications.markAllRead", "push.subscribe", "push.unsubscribe", "audit.recordPwaUpdateDecision",
  "attachments.add", "attachments.delete", "improvementIdeas.create", "improvementIdeas.delete",
  "supplierReturns.chooseReplacement", "supplierReturns.cancelAfterRefund",
  ...paths("purchaseOrders", "saveDraft submitDraft updateDraft create delete deleteItem editItem editAndResubmitReturnedItem cancelItem resubmit resubmitCancelledPurchase finalizeCancelledItem resubmitItemRevision update"),
];
const documentQueries = [
  "deliveryDocuments.list", "deliveryDocuments.getForPrint", "warehouseIssueBatches.list", "warehouseIssueBatches.getById", "returnDocuments.list", "disposal.list", "disposal.getById",
  ...paths("inventoryCount", "listOperations operationDetails listSettlements settlementDetails lotTrackingStatus"),
];
const settlementReviewQueries = paths("inventoryCount", "settlementDrafts settlementDraftDetails");
const settlementReviewMutations = paths("inventoryCount", "returnSettlementDraft approveSettlementDraft requestCountCorrection");
const documentMutations = ["deliveryDocuments.incrementPrint", "warehouseIssueBatches.incrementPrint", "returnDocuments.incrementPrint"];
const costQueries = ["materialCosts.status", "materialCosts.report", "reports.costReport"];
const managementQueries = [
  ...paths("tickets", "list listPaginated inboxCounts getById executionReferences items myItemsForTickets history getConfirmation departmentPlan"),
  "inspectionResults.listByTicket", "inspectionResults.dashboardStats",
  ...paths("reports", "ticketsByStatus ticketsByCategory ticketsByPriority costComparison monthlySummary technicianPerformance externalTechnicianPerformance purchaseCycleReport maintenanceCycleReport sectionReport technicianMonthlyReport"),
  ...paths("maintenanceReports", "technicianPerformance sectionReport technicianMonthlyReport maintenanceCycleReport"),
  ...paths("analytics", "ticketsByStatus ticketsByCategory ticketsByPriority monthlySummary costComparison"),
  "preventive.getReport", "preventive.getDetectionRateReport", "preventive.getAssetInspectionHistory", "preventive.listWorkOrders",
  "kpi.getTicketTimelines", "kpi.getPOTimelines",
];
const managementMutations = ["tickets.create", "tickets.createTicket", "tickets.update", "tickets.submitForTriage", "tickets.confirmCompletion", "improvementIdeas.decide", "ai.analyze"];
/** Granted Catalog functionality; overview/settings stay owner/admin only. */
const seniorCatalogQueries = [
  "catalog.audit.list",
  ...paths("catalog.nodes", "list getById getChildren"),
  ...paths("catalog.items", "list count getById previewNextCode"),
  ...paths("catalog.itemCandidates", "listPending previewNextCode"),
  "catalog.units.list",
  ...paths("catalog.suppliers", "match list getById stats"),
  "catalog.suppliers.candidates.listPending",
  "catalog.itemSuppliers.listByItem",
];
const seniorCatalogMutations = [
  ...paths("catalog.nodes", "create update previewMove moveSubtree delete reactivate"),
  ...paths("catalog.items", "create update delete reactivate"),
  ...paths("catalog.itemCandidates", "suggestExisting markSameItem markNotSameItem linkExisting approveNew"),
  ...paths("catalog.units", "create update delete reactivate"),
  ...paths("catalog.suppliers", "create update delete"),
  ...paths("catalog.suppliers.candidates", "linkExisting approveNew"),
  ...paths("catalog.itemSuppliers", "matchInvoiceItems assign remove setPreferred"),
  ...paths("catalog.importExport", "exportExcel exportItemsExcel exportTaxonomyTreeExcel importPreview importCommit"),
];
const warehouseQueries = [
  ...paths("warehouseRequestDocuments", "list detail"),
  ...paths("purchaseSpecifications", "status rejectedReturns rejectedReturnSource"),
  ...paths("supplierReturns", "status list delegates valuePreview"),
  ...paths("inventory", "list books bookPages taxonomy lotSummaries listLots getTransactions issueCostAllocations scanBarcode getItemSummary getPurchaseHistory getLedger"),
  ...paths("inventoryCount", "searchCandidates uncountedItems countDiscrepancies"),
  ...paths("warehouseReceipts", "list getById getForPrint getByPO searchInventory"),
  ...paths("warehouseReceiptsV2", "purchaseReceiptContext checkDuplicate findSimilarItems listV2 getByIdV2 scanBarcode searchInventory"),
  ...paths("warehouseReturns", "list search getReturnSources"),
  ...paths("stock", "getTransactions getLowStockItems"), "warehouse.getAvailableCategories",
  ...paths("transfers", "listCards getBatchDetail"),
  ...paths("purchaseOrders", "pendingDeliveryItems inventoryReadyForDelivery pendingPurchaseItems pendingWarehouseItems searchItemNames trackItem"),
  ...paths("operationalIssues", "status list detail availability itemUnits choices preparationOptions stockChoices preparedSelection"),
  ...paths("ticketTeamAssignments", "queue warehouseRequests"),
  ...paths("ticketTeamExecution", "details balances searchMaterialIdentityCandidates preview catalog warehouseTicket"),
  ...paths("pmv2.warehouse", "waitingMaterialQueue searchMaterialIdentityCandidates readyToIssueQueue pendingReturns"),
  "materialCosts.issueTargets",
  "externalMaintenance.listForWarehouse", "technicians.list",
  ...paths("catalog.nodes", "getById getChildren"),
  ...paths("catalog.items", "count getById previewNextCode"),
  ...paths("catalog.itemCandidates", "listPending previewNextCode"),
  ...paths("catalog.suppliers", "match list getById stats"),
  "catalog.suppliers.candidates.listPending", "catalog.itemSuppliers.listByItem",
];

/**
 * Read-only warehouse oversight granted to senior management in its capacity
 * as warehouse management. Keep this list query-only: stock movements and
 * warehouse workflow mutations remain exclusive to the warehouse role.
 */
const warehouseOversightQueries = [
  ...paths("inventory", "list books bookPages taxonomy lotSummaries listLots getTransactions issueCostAllocations getItemSummary getPurchaseHistory getLedger"),
  ...paths("inventoryCount", "searchCandidates uncountedItems countDiscrepancies listOperations operationDetails listSettlements settlementDetails lotTrackingStatus"),
  ...paths("transfers", "listCards getBatchDetail"),
  ...paths("warehouseIssueBatches", "list getById"),
  ...paths("stock", "getTransactions getLowStockItems"),
  ...paths("purchaseOrders", "searchItemNames trackItem"),
];
const warehouseMutations = [
  "warehouseRequestDocuments.recordPrint",
  ...paths("supplierReturns", "create command confirmRefund"),
  "externalMaintenance.returnForRouteReview",
  ...paths("inventoryCount", "saveSettlementDraft submitSettlementDraft correctCount"),
  "users.create", "deliveryDocuments.generate",
  "externalMaintenance.prepareByWarehouse", "externalMaintenance.receiveByWarehouse", "externalMaintenance.handoverByWarehouse",
  ...paths("inventory", "create update delete addTransaction resolveLotSearch resolveDeliveryLot deliverToRequester"),
  ...paths("inventoryCount", "createOperation scanItem scanLot addItem addNewItem openingBalanceTemplate openingBalanceImportPreview openingBalanceImportCommit openingBalanceExport deleteOperation recordItem completeOperation"),
  "warehouseReceipts.incrementPrint", "warehouseReceipts.scanBarcode",
  ...paths("warehouseReceiptsV2", "analyzeInvoice receiveFromPurchaseV2 generateItemBarcodes generateItemBarcode"),
  ...paths("warehouseReturns", "resolveRecipientReturnSource createRecipientReturn resolveReturnLot create"),
  ...paths("warehouseIssueBatches", "resolveLot create"),
  ...paths("warehouse", "create confirmDeliveryToWarehouse confirmDeliveryToRequester"),
  "transfers.resolveLot", "transfers.createBatch", "disposal.resolveLot", "disposal.create",
  ...paths("purchaseOrders", "confirmDeliveryToRequester incrementPrintCount confirmDeliveryToWarehouse deliverInventoryItem"),
  ...paths("operationalIssues", "addToPurchaseDraft approve issue returnMaterial createPrepared issuePrepared"),
  ...paths("ticketTeamExecution", "prepareSupply issue transferFromForm request resolve provide purchaseReceipt returnMaterial"),
  ...paths("pmv2.warehouse", "resolveMaterialIdentity prepareTransferHandoff preparePurchaseHandoff linkPurchaseOrder linkConfirmedTransfers issueReadyRequirement linkConfirmedDelivery confirmPendingReturn"),
  ...paths("catalog.nodes", "create update"),
  ...paths("catalog.items", "create update delete reactivate"),
  ...paths("catalog.itemCandidates", "suggestExisting markSameItem markNotSameItem linkExisting approveNew"),
  ...paths("catalog.units", "create update"),
  ...paths("catalog.suppliers", "create update delete"),
  ...paths("catalog.suppliers.candidates", "linkExisting approveNew"),
  ...paths("catalog.itemSuppliers", "matchInvoiceItems assign remove setPreferred"),
];

// Kept as a closed inventory of legacy Construction RPC names for compatibility
// tests. No business role receives these capabilities; owner/admin bypass the
// business-role policy and are checked by the owner/admin module guard.
const constructionQueries = [
  ...paths("construction.projects", "list getById portfolioStats"), ...paths("construction.phases", "list getById"),
  ...paths("construction.activities", "list listByProject"), ...paths("construction.tasks", "list kanban gantt getById"),
  ...paths("construction.taskComments", "list"), ...paths("construction.taskDependencies", "list"),
  ...paths("construction.members", "list workload"), ...paths("construction.timeLogs", "list projectSummary"),
  ...paths("construction.customFields", "list"), ...paths("construction.automations", "list"),
  ...paths("construction.goals", "list"), ...paths("construction.dailyReports", "list getByDate"),
  ...paths("construction.quantityTracking", "list listByProject"), ...paths("construction.changeOrders", "list"),
  ...paths("construction.safetyLogs", "list"), ...paths("construction.reports", "delayAnalysis teamPerformance budgetSummary quantitySummary safetySummary"),
];
const constructionMutations = [
  ...paths("construction.projects", "create update delete recalculateProgress"), ...paths("construction.phases", "create update delete reorder recalculateProgress"),
  ...paths("construction.activities", "create update delete reorder"), ...paths("construction.tasks", "create update changeStatus bulkChangeStatus delete"),
  ...paths("construction.taskComments", "create update delete"), ...paths("construction.taskDependencies", "create delete"),
  ...paths("construction.members", "add updateRole remove"), ...paths("construction.timeLogs", "create delete"),
  ...paths("construction.customFields", "create delete setValue"), ...paths("construction.automations", "create toggle delete"),
  ...paths("construction.goals", "create update delete"), ...paths("construction.dailyReports", "create approve"),
  ...paths("construction.quantityTracking", "create update delete"), ...paths("construction.changeOrders", "create approve reject"),
  ...paths("construction.safetyLogs", "create close"),
];

/** Exposed for coverage tests; final ownership/stage checks remain mandatory. */
export const BUSINESS_ROLE_CAPABILITIES: Record<BusinessRole, { query: readonly string[]; mutation: readonly string[] }> = {
  accountant: { query: [...sharedQueries, ...costQueries, "attachments.listByType", ...paths("delegatePricingBundles", "status list listPage detail approvalQueue approvalDetail")],
    mutation: [...sharedMutations, ...paths("purchaseOrders", "approveAccounting approveAccountingBatch rejectAccountingBatchItem reject"), "purchasePackages.approveAccountingSubmission", ...paths("delegatePricingBundles","pdf approveAccounting resumeApproval")] },
  senior_management: { query: [...sharedQueries, ...documentQueries, ...settlementReviewQueries, ...warehouseOversightQueries, ...costQueries, ...managementQueries, ...seniorCatalogQueries, "attachments.listByType", "technicians.list", ...paths("delegatePricingBundles", "status list listPage detail approvalQueue approvalDetail")],
    mutation: [...sharedMutations, ...documentMutations, ...settlementReviewMutations, ...managementMutations, ...seniorCatalogMutations, ...paths("purchaseOrders", "reviewItems resolveDelegateChange approveManagement approveManagementBatch reject"), "purchasePackages.approveManagementSubmission", ...paths("delegatePricingBundles","pdf approveAccounting approveManagement resumeApproval")] },
  executive_director: { query: [...sharedQueries, ...documentQueries, ...costQueries, ...managementQueries, "technicians.list"],
    mutation: [...sharedMutations, ...documentMutations, ...managementMutations] },
  warehouse: { query: [...sharedQueries, ...documentQueries, ...settlementReviewQueries, ...costQueries, ...warehouseQueries],
    mutation: [...sharedMutations, ...documentMutations, ...warehouseMutations] },
  food_warehouse_assistant: { query: [...sharedQueries, ...documentQueries], mutation: [...sharedMutations, ...documentMutations] },
};

export function businessRpcAllowed(user: BusinessIdentity | null | undefined, type: string, path: string): boolean {
  if ((EXTERNAL_FOLLOWUP_QUERIES as readonly string[]).includes(path)) return externalFollowupRpcAllowed(user, type, path);
  if (!isBusinessGuardedRole(user?.role)) return true;
  if (path === "construction" || path.startsWith("construction.") || path === "preventive" || path.startsWith("preventive.")) return false;
  if (type === "mutation" && path === "auth.logout") return true;
  if (user?.isActive !== 1 || (type !== "query" && type !== "mutation")) return false;
  return BUSINESS_ROLE_CAPABILITIES[user.role][type].includes(path);
}

const commonPages = new Set(["/", "/notifications", "/improvement-ideas", "/purchase-orders", "/purchase-orders/new", "/documents", "/inventory/reports", "/inventory/reconciliation",
  "/inventory/reports/stock-balance", "/inventory/reports/movements", "/inventory/reports/valuation", "/inventory/reports/analytics"]);
const warehousePages = new Set(["/inventory", "/inventory-operations", "/warehouse/receive-v2", "/warehouse/return", "/warehouse/returns", "/warehouse/transfer", "/warehouse/issue", "/warehouses", "/purchase-cycle", "/external-maintenance", "/item-tracker", "/users", "/catalog", "/operational-issues", "/maintenance-team-tickets", "/scheduled-maintenance/warehouse-requests"]);
const warehouseOversightPages = new Set(["/inventory", "/inventory-operations", "/warehouse/returns", "/warehouse/transfer", "/warehouse/issue", "/warehouses", "/item-tracker"]);
const managementPages = new Set(["/tickets", "/tickets/inbox", "/tickets/new", "/reports", "/reports/technicians", "/reports/purchase-cycle", "/reports/maintenance-cycle", "/reports/section-report", "/reports/preventive", "/inspection-dashboard", "/ai-assistant"]);
export function businessPageAllowed(role: BusinessRole, rawPath: string): boolean {
  const path = rawPath.split(/[?#]/, 1)[0] || "/";
  if (path === RETURNS_CENTER_PATH) return canAccessReturnsCenter(role);
  if (path === "/catalog") return role === "warehouse" || role === "senior_management";
  if (path === "/inventory-settlement-review") return role === "warehouse" || role === "senior_management";
  // The page shell is reachable; its data and actions require project membership.
  if (/^\/construction(?:\/(?:tickets|reports|projects(?:\/(?:new|[1-9]\d*(?:\/edit)?))?))?$/.test(path)) return false;
  if (commonPages.has(path) || /^\/purchase-orders\/(?:[1-9]\d*|edit-draft\/[1-9]\d*)$/.test(path) || /^\/purchase-packages\/[1-9]\d*$/.test(path) || /^\/tickets\/[1-9]\d*$/.test(path)) return true;
  if (path === "/reports/cost") return role !== "food_warehouse_assistant";
  if (role === "accountant" || role === "senior_management") {
    if (path === "/delegate-pricing-bundles") return true;
    if (role === "senior_management" && warehouseOversightPages.has(path)) return true;
    if (role === "accountant") return false;
  }
  if (role === "warehouse") return warehousePages.has(path);
  if (role === "senior_management" || role === "executive_director") {
    if (managementPages.has(path) || /^\/tickets\/[1-9]\d*$/.test(path)) return true;
  }
  return false;
}

/** The existing warehouse "add account" permission is limited to technicians. */
export const canCreateUserRole = (actorRole: string, newRole: string): boolean =>
  actorRole === "owner" || actorRole === "admin" || (actorRole === "warehouse" && newRole === "technician");

export const businessHomePath = (role: BusinessRole) => role === "warehouse" ? "/inventory"
  : role === "senior_management" || role === "executive_director" ? "/reports" : "/purchase-orders";

export function businessHttpAllowed(user: BusinessIdentity | null | undefined, method: string, path: string): boolean {
  if (!isBusinessGuardedRole(user?.role)) return true;
  if (user?.isActive !== 1) return false;
  if (method === "POST") return ["/api/upload", "/api/upload-url", "/api/export/html-to-pdf"].includes(path)
    || (path === "/api/export/inventory" && user.role !== "executive_director" && user.role !== "food_warehouse_assistant");
  if (method !== "GET") return false;
  if (/^\/api\/export\/po\/[1-9]\d*\/pdf$/.test(path)) return true;
  if (/^\/api\/tickets\/[1-9]\d*\/pdf$/.test(path)) return user.role === "senior_management" || user.role === "executive_director";
  if (/^\/api\/reports\/inventory\/(?:foundation-preview|stock-balance|movements|valuation|valuation\/by-warehouse|valuation\/by-category|valuation\/accounting-review|analytics)(?:\.(?:xlsx|pdf)|\/print)$/.test(path))
    return ["accountant", "senior_management", "warehouse"].includes(user.role);
  return ["accountant", "senior_management"].includes(user.role) && ["/api/export/tickets", "/api/export/purchase-orders", "/api/export/technician-performance", "/api/export/workflow-guide"].includes(path);
}

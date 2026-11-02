import { delegatePricingBundlesRouter, approvedPricingDocumentsRouter } from "./delegate-pricing-bundles";
import { router } from "./_shared/procedures";
import { operationalIssuesRouter } from "./operational-issues";
import { maintenanceTeamsRouter, ticketTeamAssignmentsRouter, ticketTeamExecutionRouter } from "./maintenance-teams";
import { systemRouter } from "../_core/systemRouter";
import { translationRouter } from "./translation/translation.router";

import { authRouter } from "./auth/auth.router";
import { usersRouter } from "./users/users.router";
import { sitesRouter } from "./sites/sites.router";
import { sectionsRouter } from "./sections/sections.router";
import { techniciansRouter } from "./technicians/technicians.router";

import { ticketsMergedRouter } from "./tickets/index";

import { purchaseOrdersRouter } from "./purchase/purchase-orders.router";
import { deliveryDocumentsRouter } from "./purchase/delivery-documents.router";
import { returnDocumentsRouter } from "./inventory/return-documents.router";
import { approvalsRouter } from "./purchase/approvals.router";
import { purchasePackagesRouter } from "./purchase/purchase-packages.router";
import { centerCategoriesRouter } from "./purchase/purchase-categories.router";

import { inventoryRouter } from "./inventory/inventory.router";
// ⚠️ receiptsRouter (v1) لا يزال مسجَّلاً لأن الإجراء scanBarcode بداخله لا يزال
// مستخدَمًا فعليًا من صفحة نشطة (WarehouseReturn.tsx). الإجراء الخطير تحديدًا
// (receiveFromPurchase) عُطِّل من داخل الملف نفسه، لا بحذف الراوتر بالكامل —
// انظر التعليق داخل server/routers/inventory/receipts.router.ts
import { receiptsRouter } from "./inventory/receipts.router";
import { receiptsV2Router } from "./inventory/receipts.v2.router";
import { inventoryCountRouter } from "./inventory/inventoryCount.router";
import { invoiceDraftRouter } from "./inventory/invoiceDraft.router";
import { returnsRouter } from "./inventory/returns.router";
import { supplierReturnsRouter } from "./inventory/supplier-returns.router";
import { stockRouter } from "./inventory/stock.router";
import { warehouseRouter } from "./inventory/warehouse.router";
import { transfersRouter } from "./inventory/transfers.router";
import { disposalRouter } from "./inventory/disposal.router";
import { reconciliationRouter } from "./inventory/reconciliation.router";

import { assetsRouter } from "./assets/assets.router";
import { assetMaintenanceRouter } from "./assets/asset-maintenance.router";
import { assetHistoryRouter } from "./assets/asset-history.router";
import { assetDocumentsRouter } from "./assets/asset-documents.router";
import { nfcRouter } from "./assets/nfc.router";
import { inspectionResultsRouter } from "./assets/inspection-results.router";
import { assetCategoriesRouter } from "./assets/asset-categories.router";

import { notificationsRouter } from "./notifications/notifications.router";
import { pushRouter } from "./notifications/push.router";

import { uploadsRouter } from "./uploads/uploads.router";
import { attachmentsRouter } from "./uploads/attachments.router";

import { reportsRouter } from "./reports/reports.router";
import { materialCostsRouter } from "./reports/material-costs.router";
import { analyticsRouter } from "./reports/analytics.router";
import { maintenanceReportsRouter } from "./reports/maintenance-reports.router";
// ✅ purchaseReportsRouter (purchase-reports.router.ts) حُذف نهائيًا — كان كودًا ميتًا
// 100% (صفر استخدام من الواجهة)، ونسخة مكرَّرة من purchaseCycleReport/costReport
// الموجودتين فعلياً وبشكل صحيح في reportsRouter أعلاه. راجع docs/CHANGELOG_TECHNICAL.md
// (بند 2026-07-21) لتفاصيل هذا الاكتشاف والإصلاح الكامل.
import { inventoryReportsRouter } from "./reports/inventory-reports.router";
import { warehouseIssueBatchesRouter } from "./inventory/warehouse-issue-batches.router";

import { aiRouter } from "./ai/ai.router";
import { imageRouter } from "./ai/image.router";
import { llmRouter } from "./ai/llm.router";

import { dashboardRouter } from "./system/dashboard.router";
import { kpiRouter } from "./system/kpi.router";
import { auditRouter } from "./system/audit.router";
import { backupsRouter } from "./system/backups.router";
import { preventiveRouter } from "./system/preventive.router";
import { pmPlansRouter } from "./system/pmPlans.router";
import { catalogRouter } from "./catalog/catalog.router";
import { improvementIdeasRouter } from "./improvement-ideas/improvement-ideas.router";
import { constructionRouter } from "./construction/index";
import { externalMaintenanceRouter } from "./external-maintenance/external-maintenance.router";
import { pmv2Router } from "./pmv2";

export const appRouter = router({
  system: systemRouter,
  translation: translationRouter,

  auth: authRouter,
  users: usersRouter,

  sites: sitesRouter,
  sections: sectionsRouter,
  technicians: techniciansRouter,

  tickets: ticketsMergedRouter,
  operationalIssues: operationalIssuesRouter,
  delegatePricingBundles: delegatePricingBundlesRouter,
  approvedPricingDocuments: approvedPricingDocumentsRouter,

purchaseOrders: router({
  ...purchaseOrdersRouter._def.procedures,
  ...approvalsRouter._def.procedures,
}),

  // [PB] حزمة الشراء — مساحة اسم مستقلة تمامًا (2026-08-29). لم تُدمج داخل
  // purchaseOrders عمدًا: الحزمة مستوى أعلى من الطلب، ودمجها كان سيوحي
  // بأنها إجراء على طلب واحد. صفر تأثير على التسجيل القائم أعلاه.
  purchasePackages: purchasePackagesRouter,
  centerCategories: centerCategoriesRouter,
  // Backward-compatible API alias for clients deployed before Center Categories rename.
  purchaseCategories: centerCategoriesRouter,

  deliveryDocuments: deliveryDocumentsRouter,
  returnDocuments: returnDocumentsRouter,

  inventory: inventoryRouter,
  warehouseReceipts: receiptsRouter,
  warehouseReceiptsV2: receiptsV2Router,
  invoiceDraft: invoiceDraftRouter,
  inventoryCount: inventoryCountRouter,
  warehouseReturns: returnsRouter,
  supplierReturns: supplierReturnsRouter,
  stock: stockRouter,
  warehouse: warehouseRouter,
  warehouseIssueBatches: warehouseIssueBatchesRouter,
  transfers: transfersRouter,
  disposal: disposalRouter,
  inventoryReconciliation: reconciliationRouter,

  assets: assetsRouter,
  assetMaintenance: assetMaintenanceRouter,
  assetHistory: assetHistoryRouter,
  assetDocuments: assetDocumentsRouter,
  nfc: nfcRouter,
  inspectionResults: inspectionResultsRouter,
  assetCategories: assetCategoriesRouter,

  notifications: notificationsRouter,
  push: pushRouter,

  upload: uploadsRouter,
  attachments: attachmentsRouter,

  reports: reportsRouter,
  materialCosts: materialCostsRouter,
  analytics: analyticsRouter,
  maintenanceReports: maintenanceReportsRouter,
  inventoryReports: inventoryReportsRouter,

  ai: aiRouter,
  image: imageRouter,
  llm: llmRouter,

  dashboard: dashboardRouter,
  kpi: kpiRouter,
  audit: auditRouter,
  backups: backupsRouter,
  preventive: preventiveRouter,
  pmPlans: pmPlansRouter,

  // ── وحدة الكتالوج المستقلة ──
  catalog: catalogRouter,

  // ── مركز التحسين والتطوير ──
  improvementIdeas: improvementIdeasRouter,

  // ── وحدة الإنشاءات ──
  construction: constructionRouter,

  externalMaintenance: externalMaintenanceRouter,

  // PM V2 bounded-module namespace — additive registration only.
  pmv2: pmv2Router,
  maintenanceTeams: maintenanceTeamsRouter,
  ticketTeamAssignments: ticketTeamAssignmentsRouter,
  ticketTeamExecution: ticketTeamExecutionRouter,
});

export type AppRouter = typeof appRouter;

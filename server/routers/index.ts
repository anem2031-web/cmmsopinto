import { router } from "./_shared/procedures";
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
import { approvalsRouter } from "./purchase/approvals.router";
import { vendorsRouter } from "./purchase/vendors.router";

import { inventoryRouter } from "./inventory/inventory.router";
import { receiptsRouter } from "./inventory/receipts.router";
import { receiptsV2Router } from "./inventory/receipts.v2.router";
import { invoiceDraftRouter } from "./inventory/invoiceDraft.router";
import { returnsRouter } from "./inventory/returns.router";
import { stockRouter } from "./inventory/stock.router";
import { warehouseRouter } from "./inventory/warehouse.router";
import { transfersRouter } from "./inventory/transfers.router";
import { disposalRouter } from "./inventory/disposal.router";

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
import { analyticsRouter } from "./reports/analytics.router";
import { maintenanceReportsRouter } from "./reports/maintenance-reports.router";
import { purchaseReportsRouter } from "./reports/purchase-reports.router";
import { inventoryReportsRouter } from "./reports/inventory-reports.router";

import { aiRouter } from "./ai/ai.router";
import { imageRouter } from "./ai/image.router";
import { llmRouter } from "./ai/llm.router";

import { dashboardRouter } from "./system/dashboard.router";
import { kpiRouter } from "./system/kpi.router";
import { auditRouter } from "./system/audit.router";
import { backupsRouter } from "./system/backups.router";
import { preventiveRouter } from "./system/preventive.router";
import { catalogRouter } from "./catalog.router";
import { improvementIdeasRouter } from "./improvement-ideas/improvement-ideas.router";
import { constructionRouter } from "./construction/index";

export const appRouter = router({
  system: systemRouter,
  translation: translationRouter,

  auth: authRouter,
  users: usersRouter,

  sites: sitesRouter,
  sections: sectionsRouter,
  technicians: techniciansRouter,

  tickets: ticketsMergedRouter,

purchaseOrders: router({
  ...purchaseOrdersRouter._def.procedures,
  ...approvalsRouter._def.procedures,
}),

  deliveryDocuments: deliveryDocumentsRouter,
  vendors: vendorsRouter,

  inventory: inventoryRouter,
  warehouseReceipts: receiptsRouter,
  warehouseReceiptsV2: receiptsV2Router,
  invoiceDraft: invoiceDraftRouter,
  warehouseReturns: returnsRouter,
  stock: stockRouter,
  warehouse: warehouseRouter,
  transfers: transfersRouter,
  disposal: disposalRouter,

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
  analytics: analyticsRouter,
  maintenanceReports: maintenanceReportsRouter,
  purchaseReports: purchaseReportsRouter,
  inventoryReports: inventoryReportsRouter,

  ai: aiRouter,
  image: imageRouter,
  llm: llmRouter,

  dashboard: dashboardRouter,
  kpi: kpiRouter,
  audit: auditRouter,
  backups: backupsRouter,
  preventive: preventiveRouter,

  // ── وحدة الكتالوج المستقلة ──
  catalog: catalogRouter,

  // ── مركز التحسين والتطوير ──
  improvementIdeas: improvementIdeasRouter,

  // ── وحدة الإنشاءات ──
  construction: constructionRouter,
});

export type AppRouter = typeof appRouter;

import { router } from "../_shared/procedures";

// All asset maintenance procedures (getMaintenanceHistory, getMaintenanceStats,
// addSparePart, getSpareParts, removeSparePart, getMetrics, calculateMetrics,
// getAllMetrics, getLowStockAlerts, getAssetSparePartsWithLowStock) are served
// directly from assets/assets.router.ts → appRouter.assets.*
// This router is intentionally empty; assetMaintenance key is reserved for future
// domain separation when asset-maintenance grows beyond the assets namespace.
export const assetMaintenanceRouter = router({});

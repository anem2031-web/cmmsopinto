import { startVitest } from "vitest/node";
import base from "../maintenance-team-tickets/execution-vitest.config.mjs";
// Real core/service acceptance above, plus existing canonical send/receipt/delivery
// and source-link regressions. No live DB, app startup, environment, or network.
// The separate baseline run is retained in tmp/purchase-review-legacy-baselines.log:
// unifiedPricingBundleApproval has its independently confirmed old PDF-parent
// expectation failure; ticketMaterialDeliveryWorkflow has an old literal-source
// comparison failure. Both files remain intact and are checked separately.
const files = [
  "server/tests/purchaseItemReviewAcceptance.test.ts",
  "server/tests/delegatePricingBundles.test.ts",
  "server/tests/purchaseGroupedReceipt.test.ts",
  "server/tests/purchaseReceiptMembershipReads.test.ts",
  "server/tests/warehouseDeliverySignature.test.ts",
  "server/tests/pathBPurchaseWorkflow.test.ts",
  "server/tests/supplierReturnPurchaseBridge.test.ts",
  "server/tests/supplierReturnReceiptBridge.test.ts",
  "server/tests/supplierReturnPathBReplacement.test.ts",
  "server/tests/pmv2ReplacementCoverage.test.ts",
];
const runner = await startVitest("test", files, { config: false, watch: false }, { ...base, test: { ...base.test, include: files } });
process.exitCode = !runner || runner.state.getFiles().length !== files.length || runner.state.getFiles().some(file => file.result?.state === "fail") || runner.state.getUnhandledErrors().length ? 1 : 0;
await runner?.close();

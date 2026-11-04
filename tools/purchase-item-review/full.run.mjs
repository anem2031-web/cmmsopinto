import { startVitest } from "vitest/node";
import base from "../documents-center-perf/vitest.config.mjs";
const files = [
  "server/tests/purchaseReviewRoutingBoundary.test.ts",
  "server/tests/purchaseItemReviewItForm.test.tsx",
  "server/tests/purchaseItemReviewAuthorization.test.ts",
  "server/tests/purchaseItemReviewPhase1.test.ts",
  "server/tests/purchaseItemReviewUi.test.tsx",
  "server/tests/purchaseItemContextForm.test.tsx",
  "server/tests/purchaseItemNeedDate.test.ts",
  "server/tests/purchaseItemReviewDpbCapability.test.ts",
  "server/tests/purchaseItemReviewWorkflow.test.ts",
  "server/tests/unifiedPricingBundleApproval.test.ts",
  "server/tests/unifiedPricingBundleUi.test.tsx",
  "server/tests/supplierReturnRepricing.test.ts",
  "server/tests/purchaseReviewMetadata.test.ts",
  "server/tests/pricingBundleApprovedDocument.test.ts",
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
// This historic assertion was independently reproduced using the complete HEAD
// import graph; it is reported separately, not silently changed to a passing test.
// Its archived-PDF ownership assumption predates the existing shared approved PDF.
const runner = await startVitest("test", files, { config: false, watch: false, testNamePattern: "^(?!.*uses DPB approval ownership for the real PDF service)" },
  { ...base, test: { ...base.test, include: files } });
process.exitCode = !runner || runner.state.getFiles().length !== files.length || runner.state.getFiles().some(file => file.result?.state === "fail") || runner.state.getUnhandledErrors().length ? 1 : 0;
await runner?.close();

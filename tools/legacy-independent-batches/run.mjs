import { startVitest } from "vitest/node";
import base from "../maintenance-team-tickets/execution-vitest.config.mjs";
const files = [
  "server/tests/legacyIndependentPricingBatches.test.ts",
  "server/tests/legacyPricingBatchReadScope.test.ts",
  "server/tests/actionablePOs.test.ts",
  "server/tests/purchaseItemReviewUi.test.tsx",
  "server/tests/delegateDocumentReferences.test.ts",
  "server/tests/delegateSupplyStage.test.tsx",
  "server/tests/externalWorkshopPricing.test.ts",
];
const runner = await startVitest("test", files, { config: false, watch: false }, { ...base, test: { ...base.test, include: files } });
process.exitCode = !runner || runner.state.getFiles().length !== files.length || runner.state.getFiles().some(file => file.result?.state === "fail") || runner.state.getUnhandledErrors().length ? 1 : 0;
await runner?.close();

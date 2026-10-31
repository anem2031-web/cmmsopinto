import { startVitest } from "vitest/node";
import base from "../maintenance-team-tickets/execution-vitest.config.mjs";
const files = ["server/tests/supplierReturnFollowupPolicy.test.ts", "server/tests/supplierReturnCommands.test.ts", "server/tests/supplierReturnCreation.test.ts", "server/tests/supplierReturnRead.test.ts", "server/tests/supplierReturnRpc.test.ts", "server/tests/inventoryReturnsPhase5Step2.test.ts", "tools/supplier-return-followup/ui.test.tsx"];
files.push("server/tests/supplierReturnFinance.test.ts");
files.push("server/tests/supplierReturnValuation.test.ts", "server/tests/supplierReturnValuationRuntime.test.ts");
files.push("server/tests/supplierReturnPricingBridge.test.ts");
files.push("server/tests/supplierReturnApprovalBridge.test.ts");
files.push("server/tests/supplierReturnReceiptBridge.test.ts");
files.push("server/tests/supplierReturnCreatorChoice.test.ts");
files.push("server/tests/supplierReturnRepricing.test.ts");
files.push("server/tests/supplierReturnPurchaseBridge.test.ts");
files.push("server/tests/supplierReturnPathBReplacement.test.ts");
files.push("server/tests/pathBPurchaseWorkflow.test.ts");
files.push("server/tests/supplierReturnFeature.test.ts");
files.push("server/tests/supplierReturnFulfillment.test.ts", "server/tests/teamReplacementFulfillment.test.ts");
files.push("server/tests/pmv2ReplacementCoverage.test.ts");
files.push("server/tests/pmv2ReplacementUi.test.ts");
files.push("server/tests/pmv2SourceFixture.test.ts");
files.push("server/tests/pmv2CompletionFixture.test.ts");
files.push("server/tests/teamCompensationFixture.test.ts");
const config = { ...base, test: { ...base.test, include: files } };
const runner = await startVitest("test", files, { config: false, watch: false }, config);
if (!runner) process.exitCode = 1;
else {
  if (runner.state.getFiles().length !== files.length || runner.state.getFiles().some(f => f.result?.state === "fail") || runner.state.getUnhandledErrors().length) process.exitCode = 1;
  await runner.close();
}

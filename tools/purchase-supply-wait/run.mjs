import { startVitest } from "vitest/node";
import config from "../documents-center-perf/vitest.config.mjs";
const context = await startVitest("test", [], { config: false, watch: false }, {
  ...config, test: { ...config.test, include: ["server/tests/purchaseSupplyWait.test.ts", "server/tests/purchaseSupplyWaitUi.test.tsx",
    "server/tests/delegateSupplyStage.test.tsx", "server/tests/purchaseItemReviewUi.test.tsx",
    "server/tests/delegateManagerUi.test.tsx", "server/tests/purchaseSpecificationsUi.test.tsx", "server/tests/externalMaintenanceFollowupUi.test.tsx"] },
});
process.exitCode = !context || context.state.getFiles().some(file => file.result?.state === "fail") || context.state.getUnhandledErrors().length ? 1 : 0;
await context?.close();

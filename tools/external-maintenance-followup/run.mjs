import { startVitest } from "vitest/node";
import base from "../maintenance-team-tickets/execution-vitest.config.mjs";
const files = [
  "server/tests/externalWorkshopPricing.test.ts",
  "server/tests/externalMaintenanceFollowupReader.test.ts",
  "server/tests/externalMaintenanceFollowupUi.test.tsx",
  "server/tests/externalMaintenanceReturnTime.test.ts",
  "server/tests/externalMaintenanceDelegateCore.test.ts",
  "server/tests/externalMaintenancePurchaseTitleDocument.test.ts",
];
const runner = await startVitest("test", files, { config: false, watch: false }, { ...base, test: { ...base.test, include: files } });
process.exitCode = !runner || runner.state.getFiles().length !== files.length || runner.state.getFiles().some(file => file.result?.state === "fail") || runner.state.getUnhandledErrors().length ? 1 : 0;
await runner?.close();

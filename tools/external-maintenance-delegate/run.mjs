import { startVitest } from "vitest/node";
import base from "../maintenance-team-tickets/execution-vitest.config.mjs";
const files = [
  "server/tests/externalMaintenanceDelegateCore.test.ts",
  "server/tests/externalDelegateReceiptAccess.test.ts",
  "server/tests/externalDelegateReceiptUi.test.tsx",
  "server/tests/externalMaintenancePurchaseTitleDocument.test.ts",
  "server/tests/externalMaintenanceGateReceiptUi.test.ts",
  "server/tests/pathCExternalMaintenanceWorkflow.test.ts",
  "server/tests/externalRouteReview.test.ts",
  "server/tests/externalPreparationPhoto.test.ts",
  "server/tests/gateSecurityGuard.test.ts",
];
const runner = await startVitest("test", files, { config: false, watch: false }, { ...base, test: { ...base.test, include: files } });
process.exitCode = !runner || runner.state.getFiles().length !== files.length || runner.state.getFiles().some(file => file.result?.state === "fail") || runner.state.getUnhandledErrors().length ? 1 : 0;
await runner?.close();

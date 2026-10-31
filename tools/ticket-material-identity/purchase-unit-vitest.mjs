import { startVitest } from "vitest/node";
import base from "../maintenance-team-tickets/execution-vitest.config.mjs";
const files = ["server/tests/purchaseCatalogBaseUnit.test.ts", "server/tests/inventoryCosting.test.ts", "tools/ticket-material-identity/purchase-unit-label.test.tsx"];
const runner = await startVitest("test", files, { config: false, watch: false }, { ...base, test: { ...base.test, include: files } });
if (!runner) process.exitCode = 1;
else {
  if (runner.state.getFiles().length !== files.length || runner.state.getFiles().some(file => file.result?.state === "fail") || runner.state.getUnhandledErrors().length) process.exitCode = 1;
  await runner.close();
}

import { startVitest } from "vitest/node";
import base from "../maintenance-team-tickets/execution-vitest.config.mjs";
const files = [
  "server/tests/materialTransferLots.test.ts",
  "server/tests/materialTransferLotsUi.test.tsx",
  "server/tests/warehouseLotSelection.test.ts",
  "server/tests/warehouseLotSelectionUi.test.tsx",
  "server/tests/pmv2ReplacementUi.test.ts",
  "server/tests/pmv2ReplacementCoverage.test.ts",
  "server/tests/teamReplacementFulfillment.test.ts",
  "server/tests/ticketWarehouseLotsRpc.test.ts",
];
const runner = await startVitest(
  "test",
  files,
  { config: false, watch: false },
  { ...base, test: { ...base.test, include: files } }
);
process.exitCode =
  !runner ||
  runner.state.getFiles().length !== files.length ||
  runner.state.getFiles().some(file => file.result?.state === "fail") ||
  runner.state.getUnhandledErrors().length
    ? 1
    : 0;
await runner?.close();

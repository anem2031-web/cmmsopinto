import { startVitest } from "vitest/node";
import base from "../maintenance-team-tickets/execution-vitest.config.mjs";
const files = [
  "server/tests/warehouseLotSelection.test.ts",
  "server/tests/warehouseLotSelectionUi.test.tsx",
  "server/tests/pmv2FullLotIssue.test.ts",
  "server/tests/ticketWarehouseLotsRpc.test.ts",
  "server/tests/teamReplacementFulfillment.test.ts",
  "server/tests/pmv2ReplacementCoverage.test.ts",
  "server/tests/operationalIssues.test.ts",
  "server/tests/operationalIssuesUi.test.tsx",
  "server/tests/operationalStockProcurement.test.ts",
  "server/tests/operationalStockUi.test.tsx",
  "server/tests/operationalPrepared.test.ts",
  "server/tests/operationalPreparedUi.test.tsx",
  "server/tests/operationalReplacement.test.ts",
  "tools/maintenance-team-tickets/execution-ui.test.tsx",
  "tools/maintenance-team-tickets/warehouse-ui.test.tsx",
];
const runner = await startVitest(
  "test",
  files,
  { config: false, watch: false },
  { ...base, test: { ...base.test, include: files } }
);
if (!runner) process.exitCode = 1;
else {
  if (
    runner.state.getFiles().length !== files.length ||
    runner.state.getFiles().some(file => file.result?.state === "fail") ||
    runner.state.getUnhandledErrors().length
  )
    process.exitCode = 1;
  await runner.close();
}

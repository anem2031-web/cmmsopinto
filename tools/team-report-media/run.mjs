import { startVitest } from "vitest/node";
import base from "../maintenance-team-tickets/execution-vitest.config.mjs";
const files = [
  ...base.test.include,
  "tools/maintenance-team-tickets/material-parity-ui.test.tsx",
  "tools/ticket-execution-parity/ui.test.tsx",
  "server/tests/teamTicketReportMedia.test.ts",
  "server/tests/teamTicketReportMediaUi.test.tsx",
  "server/tests/externalPreparationPhoto.test.ts",
  "server/tests/warehouseMaterialTicket.test.ts",
  "server/tests/warehouseMaterialTicketUi.test.tsx",
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

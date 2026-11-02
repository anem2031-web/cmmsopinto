import { startVitest } from "vitest/node";
import base from "../maintenance-team-tickets/execution-vitest.config.mjs";
const files = [
  "server/tests/inventoryBooks.test.ts",
  "server/tests/inventoryBookSql.test.ts",
  "server/tests/inventoryBooksUi.test.tsx",
  "server/tests/inventoryDeliveryDialogLifecycle.test.tsx",
  "server/tests/inventoryCosting.test.ts",
  "server/tests/receiptInventoryIdentityGovernance.test.ts",
  "server/tests/inventoryCountUnifiedSearch.test.ts",
  "server/tests/inventoryReceiptIssueTransferPhase5Step3.test.ts",
  "server/tests/inventoryListReadPerformance.test.ts",
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

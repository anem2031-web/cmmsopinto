import { startVitest } from "vitest/node";
import base from "../maintenance-team-tickets/execution-vitest.config.mjs";
const files = ["server/tests/pmv2CatalogUnitApproval.test.ts"];
const runner = await startVitest("test", files, { config: false, watch: false }, { ...base, test: { ...base.test, include: files } });
if (!runner) process.exitCode = 1;
else {
  if (runner.state.getFiles().length !== files.length || runner.state.getFiles().some(f => f.result?.state === "fail") || runner.state.getUnhandledErrors().length) process.exitCode = 1;
  await runner.close();
}

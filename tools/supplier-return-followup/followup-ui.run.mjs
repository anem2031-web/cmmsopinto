import { startVitest } from "vitest/node";
import base from "../maintenance-team-tickets/execution-vitest.config.mjs";
const files = ["server/tests/supplierReturnFollowupList.test.ts", "server/tests/supplierReturnFollowupUi.test.tsx", "server/tests/supplierReturnRead.test.ts", "tools/supplier-return-followup/ui.test.tsx"];
const runner = await startVitest("test", files, { config: false, watch: false }, { ...base, test: { ...base.test, include: files } });
process.exitCode = !runner || runner.state.getFiles().length !== files.length || runner.state.getFiles().some(file => file.result?.state === "fail") || runner.state.getUnhandledErrors().length ? 1 : 0;
await runner?.close();

import { startVitest } from "vitest/node";
import base from "../maintenance-team-tickets/execution-vitest.config.mjs";
const files = ["server/tests/supplierReturnStandalone.test.ts", "server/tests/supplierReturnPurchaseBridge.test.ts", "server/tests/supplierReturnCreatorChoice.test.ts", "server/tests/supplierReturnCommands.test.ts"];
const runner = await startVitest("test", files, { config: false, watch: false }, { ...base, test: { ...base.test, include: files } });
process.exitCode = !runner || runner.state.getFiles().length !== files.length || runner.state.getFiles().some(file => file.result?.state === "fail") || runner.state.getUnhandledErrors().length ? 1 : 0;
await runner?.close();

import { startVitest } from "vitest/node";
import base from "../maintenance-team-tickets/execution-vitest.config.mjs";
const files = ["server/tests/yourWork.test.ts", "server/tests/yourWorkPurchases.test.ts", "server/tests/yourWorkPmv2.test.ts", "server/tests/yourWorkAggregation.test.ts", "server/tests/yourWorkOperations.test.ts", "server/tests/yourWorkTicketMaterials.test.ts"];
const runner = await startVitest("test", files, { config: false, watch: false, cache: false }, { ...base, test: { ...base.test, include: files } });
process.exitCode = !runner || runner.state.getFiles().length !== files.length || runner.state.getFiles().some(file => file.result?.state === "fail") || runner.state.getUnhandledErrors().length ? 1 : 0;
await runner?.close();

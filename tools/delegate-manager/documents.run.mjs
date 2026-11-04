import { startVitest } from "vitest/node";
import base from "../maintenance-team-tickets/execution-vitest.config.mjs";
const config = { ...base, test: { ...base.test, include: ["server/tests/delegateManagerDocuments.test.ts", "server/tests/externalMaintenancePurchaseTitleDocument.test.ts"] } };
const context = await startVitest("test", [], { config: false, watch: false }, config);
process.exitCode = !context || context.state.getFiles().some(file => file.result?.state === "fail") || context.state.getUnhandledErrors().length ? 1 : 0;
await context?.close();

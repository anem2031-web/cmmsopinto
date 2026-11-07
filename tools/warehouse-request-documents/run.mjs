import { startVitest } from "vitest/node";
import base from "../maintenance-team-tickets/execution-vitest.config.mjs";
const files = ["server/tests/warehouseRequestDocuments.test.ts", "server/tests/warehouseRequestDocumentsUi.test.tsx", "server/tests/operationalIssuesUi.test.tsx", "tools/maintenance-team-tickets/warehouse-ui.test.tsx"];
const context = await startVitest("test", files, { config: false, watch: false }, { ...base, test: { ...base.test, include: files } });
process.exitCode = !context || context.state.getFiles().length !== files.length || context.state.getFiles().some(file => file.result?.state === "fail") || context.state.getUnhandledErrors().length ? 1 : 0;
await context?.close();

import { startVitest } from "vitest/node";
import base from "../maintenance-team-tickets/execution-vitest.config.mjs";
const files = [
  "server/tests/delegateManagerRoleParity.test.ts",
  "server/tests/delegateManagerAssignment.test.ts",
  "server/tests/delegateManagerUi.test.tsx",
  "server/tests/delegateManagerDocuments.test.ts",
];
const context = await startVitest("test", files, { config: false, watch: false }, { ...base, test: { ...base.test, include: files } });
process.exitCode = !context || context.state.getFiles().length !== files.length || context.state.getFiles().some(file => file.result?.state === "fail") || context.state.getUnhandledErrors().length ? 1 : 0;
await context?.close();

import { startVitest } from "vitest/node";
import base from "../maintenance-team-tickets/execution-vitest.config.mjs";

const files = [
  "server/tests/catalogManagementRoleAccess.test.ts",
  "server/tests/catalogPickerAccess.test.ts",
  "server/tests/catalogRequiredImage.test.ts",
  "server/tests/itCatalogItemAccessUi.test.tsx",
  "server/tests/catalogManagementRoleAccessUi.test.tsx",
];
const runner = await startVitest("test", files, { config: false, watch: false }, {
  ...base,
  test: { ...base.test, include: files },
});
process.exitCode = !runner || runner.state.getFiles().length !== files.length
  || runner.state.getFiles().some(file => file.result?.state === "fail")
  || runner.state.getUnhandledErrors().length ? 1 : 0;
await runner?.close();

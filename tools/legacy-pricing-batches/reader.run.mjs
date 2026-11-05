import { startVitest } from "vitest/node";
import base from "../documents-center-perf/vitest.config.mjs";
const files = ["server/tests/legacyPricingBatchReadScope.test.ts", "server/tests/actionablePOs.test.ts"];
const runner = await startVitest("test", files, { config: false, watch: false }, { ...base, test: { ...base.test, include: files } });
process.exitCode = !runner || runner.state.getFiles().length !== files.length || runner.state.getFiles().some(file => file.result?.state === "fail") || runner.state.getUnhandledErrors().length ? 1 : 0;
await runner?.close();

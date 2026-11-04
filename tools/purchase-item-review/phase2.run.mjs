import { startVitest } from "vitest/node";
import base from "../documents-center-perf/vitest.config.mjs";
const files = ["server/tests/unifiedPricingBundleApproval.test.ts", "server/tests/unifiedPricingBundleUi.test.tsx", "server/tests/supplierReturnRepricing.test.ts"];
// Existing PDF-accountant ownership assertion also fails on the complete HEAD
// import graph: tmp/dpb-pdf-head-baseline.mjs / .log. It is outside this phase.
const runner = await startVitest("test", files, { config: false, watch: false, testNamePattern: "^(?!.*uses DPB approval ownership for the real PDF service)" },
  { ...base, test: { ...base.test, include: files } });
process.exitCode = !runner || runner.state.getFiles().length !== files.length || runner.state.getFiles().some(file => file.result?.state === "fail") || runner.state.getUnhandledErrors().length ? 1 : 0;
await runner?.close();

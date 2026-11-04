import { startVitest } from "vitest/node";
import base from "../documents-center-perf/vitest.config.mjs";
const files = ["server/tests/purchaseItemReviewWorkflow.test.ts", "server/tests/unifiedPricingBundleApproval.test.ts", "server/tests/supplierReturnRepricing.test.ts"];
const runner = await startVitest("test", files, { config: false, watch: false, testNamePattern: "^(?!.*uses DPB approval ownership for the real PDF service)" },
  { ...base, test: { ...base.test, include: files } });
process.exitCode = !runner || runner.state.getFiles().length !== files.length || runner.state.getFiles().some(file => file.result?.state === "fail") || runner.state.getUnhandledErrors().length ? 1 : 0;
await runner?.close();

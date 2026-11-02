import { startVitest } from "vitest/node";
import previous from "../documents-center-perf/vitest.config.mjs";
const context = await startVitest("test", [], {config:false,watch:false}, {
  ...previous, test:{...previous.test, include:["server/tests/approvedPricingDocumentAccess.test.ts","server/tests/approvedPricingDocumentsUi.test.tsx","server/tests/documentsCenterNavigation.test.ts","server/tests/pricingBundleApprovedDocument.test.ts",...previous.test.include]},
});
process.exitCode = !context || context.state.getFiles().some(file=>file.result?.state==="fail") || context.state.getUnhandledErrors().length ? 1 : 0;
await context?.close();

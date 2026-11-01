import { startVitest } from "vitest/node";
import config from "../documents-center-perf/vitest.config.mjs";
const ctx = await startVitest(
  "test",
  [],
  { config: false, watch: false },
  {
    ...config,
    test: {
      ...config.test,
      include: [
        "server/tests/unifiedPricingBundleApproval.test.ts",
        "server/tests/unifiedPricingBundleUi.test.tsx",
        "server/tests/pricingBundleApprovedDocument.test.ts",
        ...config.test.include,
      ],
    },
  }
);
process.exitCode =
  !ctx ||
  ctx.state.getFiles().some(file => file.result?.state === "fail") ||
  ctx.state.getUnhandledErrors().length
    ? 1
    : 0;
await ctx?.close();

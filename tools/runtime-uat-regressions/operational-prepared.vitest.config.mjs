import { defineConfig } from "vitest/config";
import base from "./operational-stock.vitest.config.mjs";
export default defineConfig({ ...base, test: { ...base.test, include: [...base.test.include,
  "server/tests/operationalPrepared.test.ts", "server/tests/operationalPreparedUi.test.tsx",
  "server/tests/operationalReplacement.test.ts",
] } });

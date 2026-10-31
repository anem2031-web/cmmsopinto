import base from "../maintenance-team-tickets/execution-vitest.config.mjs";

// Isolated UI boundaries only: no application environment, database, or network.
export default { ...base, test: { ...base.test, include: [
  "tools/ticket-material-identity/identity-ui.test.tsx",
  "tools/maintenance-team-tickets/material-parity-ui.test.tsx",
  "tools/maintenance-team-tickets/execution-ui.test.tsx",
  "tools/maintenance-team-tickets/warehouse-ui.test.tsx",
  "tools/maintenance-team-tickets/warehouse-extra-ui.test.tsx",
  "tools/ticket-execution-parity/ui.test.tsx",
] } };

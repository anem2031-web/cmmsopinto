# Catalog base unit and warehouse quantity approval — 2026-10-31

## Approved scope

Use the existing catalog base unit for new catalog-linked purchase and material needs. Do not add a second purchase/issue unit to the catalog. Keep invoice packaging and the conversion factor entered for each receipt/lot unchanged. Preserve historical documents, stock units, role grants and workflow boundaries.

## Implementation

- Ticket team/IT and PMV2 technicians enter quantity in a readonly catalog unit. A free-text material has a name and quantity; its unit remains pending until warehouse catalog identification.
- The shared identification dialog shows the original need and readonly catalog unit, and accepts an approved quantity in that unit. Ticket quantities remain integers; PMV2 retains its existing unit-dependent decimal validation.
- The existing resolve operations save catalog identity, unit and approved quantity together, with original identity and before/after values in action/audit history. No client unit is authoritative.
- A previously linked mismatch can be reviewed for the same catalog identity only, before any supply, purchase, delivery, consumption or return history. Fresh actor, workflow and revision checks remain at the write boundary. Missing master units are reported; no guessed unit or implicit quantity conversion is introduced.
- New catalog-linked purchase rows and explicit unit/identity edits are validated against current catalog units inside the existing authorized transaction. Unchanged historical draft snapshots and manual noncatalog rows retain their previous behavior. Existing catalog IDs omitted by a draft update are resolved from the stored row before validation. The readonly purchase unit renders English historical snapshots without rewriting their stored values.
- Catalog unit validation reads distinct IDs in chunks of 500, with no global cache. Existing receipt quantities, invoice units, conversion factors, inventory valuation and stock writers are unchanged.

## Isolated verification

All runners below use isolated fixtures; they do not load a live database:

| Verification | Result |
| --- | --- |
| Ticket material identity/domain/execution | 102 passed |
| Ticket/warehouse/shared UI | 116 passed |
| PMV2 catalog unit, quantity approval and completion guard | 20 passed |
| Purchase unit validation, legacy unit labels and inventory conversion costing | 17 passed |
| Shared read scope and role regression | 399 passed |
| Supplier-return and linked fulfillment regression | 274 passed |
| Operational issue/dispatch regression | 216 passed |

Commands:

```text
node --import tsx --import ./tools/maintenance-team-tickets/no-live-db.mjs --test tools/ticket-material-identity/identity.node.ts server/maintenance-team-tickets/testing/domain.node.ts tools/maintenance-team-tickets/execution.node.ts
node node_modules/vitest/vitest.mjs run --config tools/ticket-material-identity/unit-approval.vitest.config.mjs
node tools/pmv2-unit-approval/run.mjs
node tools/ticket-material-identity/purchase-unit-vitest.mjs
node tools/read-scope-perf/run.mjs
node tools/supplier-return-followup/run.mjs
node node_modules/vitest/vitest.mjs run --config tools/runtime-uat-regressions/operational-prepared.vitest.config.mjs
```

The final `npm run build` passed after the purchase guard/legacy-label fixes. Vite reports existing large-chunk warnings. The full TypeScript check still reports existing project diagnostics, including the pre-existing PMV2 translation-queue call and ES target iteration errors. This is not a claim of a globally clean typecheck.

## Boundaries

No schema changes or manual SQL are required. No production `cmms` writes, Railway deployment, automatic historical conversion or repair of the user's actual pending record is authorized by this implementation report. Any runtime fixture is restricted to the previously authorized `copycmms2` trial and named as test data. Supplier replacement-of-replacement and the Excel issue-entry task remain paused.

## Live trial acceptance

- Started the verified `copycmms2` runner on `http://localhost:4002`; background schedulers and outbound web push disabled in that process. No `.env` or production settings changed.
- Created only the named `TEST-MATERIAL-UNITS-2026-10-31T12:44:23.713Z` fixture through authenticated owner RPC: parent ticket2070005, execution ticket2070006 (`MT-2026-00645-01`), assignment30002.
- Need30002 was submitted with name and quantity2 and **no unit**. Need30003 selected catalog180213 while submitting a conflicting client unit `كرتون`; the saved unit was authoritative `قطعة`.
- Logged in as the warehouse user MAJID in the actual browser, opened **تذاكر الصيانة → تحتاج معالجة**, and identified need30002 as catalog180228 **فرشاة دهان يد خشب**. The dialog showed readonly `قطعة`; changed the approved quantity from2 to1 and confirmed once.
- The browser moved that need to **جاهزة للصرف** with requested1piece, branch available1piece and purchase shortage0. The existing full-need issue action became available. **No stock issue was performed in this acceptance.**
- A separate authenticated read verified catalog180228, unit`قطعة`, quantity1, original technician description retained and a `material_resolved` identity-review audit. There were no deliveries for this need.
- A transient database `ECONNRESET` occurred during authentication while preparing the trial; the normal connection recovered and the same checkpointed fixture was resumed. No application connection settings or retry behavior were changed as part of this material-unit fix.
- Evidence: [warehouse-approved.jpg](warehouse-approved.jpg), [ticket-fixture.json](ticket-fixture.json). The screenshot uses the user's existing narrow browser viewport; the DOM and authenticated read provide the full quantity/state evidence.

Legacy same-identity mismatch repair and PMV2 behavior were covered by isolated mutation/UI tests, not by manufacturing legacy database rows or changing the user's existing request. Final `git diff --check` passed. No claim is made that production catalog master units or old stock units have been repaired.

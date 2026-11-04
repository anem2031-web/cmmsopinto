# Purchase item review — implementation checkpoint

User-approved scope: three sequential phases, each tested before the next; manual SQL only after all three code phases and isolated regression checks. No database connection, environment changes or deployment. User requires reviewRole for every item even when saving a draft. Existing automatic external-C flow remains unchanged.

## Contract

- Nullable item fields: reviewRole (enum general_maintenance_manager / construction_procurement_manager / senior_management), reviewedById, reviewedAt, reviewerSignatureSnapshot.
- New formal form item status pending_review until approved, then pending with delegateId and delegateAssignedAt. Draft saves retain existing pending status but must include a reviewRole.
- Historical NULL reviewRole items keep legacy guards/workflow. No backfill or historic PDF rewrite.
- Every routed reviewer mutation uses the exact item, current active actor and role. Post-review delegate changes return to the actual item reviewer. Owner/admin oversight stays.
- Independent per-item decisions must preserve all PO/PMV2/ticket/return IDs, amounts and stock writers. Whole-order legacy resets must not reset routed independent items.

## Phase 1

Implemented: form validation/hydration; canonical save/update/submit/create propagation; role-specific notices; new routed review transaction with subset decisions, current locked actor/delegates, conditional updates, audit/history; central guards and chunked read scope; early senior scoped details/PB/media; independent actionable items and UI selection; fresh locked edit/delete/cancel and delegate reassignment boundaries; old pathways preserved.

Checks: phase1.run.mjs initially 166 tests passed; after fresh delegate reassignment and media/PB cases, 176 passed. Shared read-scope suite 401 passed with explicit empty routing fixtures for old actors. Build passed (tmp/purchase-review-phase1-build.log). TypeScript project has existing unrelated diagnostics; new modules were filtered without reported errors. Offline UI preview ar/en/ur at390/1280.

## Phase 2 — code and isolated checks complete

Senior management gets DPB accounting-stage capability only (no global accountantProcedure expansion). Three separate waiting tabs: initial item review / accounting DPB approval / management DPB approval. Same actual user can perform two explicit separate approvals. Exact actor signatures, stage/revision/idempotency and full-member authorization preserved. Optional stage on approvalQueue/detail, old default behavior retained.

Checks: dedicated accounting/management stage and replay/signature tests, UI stages/counters/links and independent capability audit passed. The second build passed before starting phase 3. The pre-existing PDF ownership assertion was reproduced on the complete HEAD import graph and remains explicitly reported, not changed to alter existing approved-archive policy.

## Phase 3 — code and isolated checks complete

Implemented: mixed header safeguards and legacy whole-approval/whole-rejection/whole-return containment for routed items; item-reviewed eligibility at the actual estimation/submission boundary; new PDF reviewer attribution and frozen signature compatibility; report/timeline review stage per item; source/ID/idempotency coverage. The existing inline IT creation form also carries the required item review selector, so the new canonical validation does not leave that caller without a way to choose its route. Stock, receipt and transfer writers were not redesigned.

## Verification and manual migration boundary

- `node tools/purchase-item-review/full.run.mjs`: 491 passed / 1 known historical PDF assertion skipped, 24 files. Real routed review and unified accounting/management services, actual canonical receipt/delivery/document writers and existing source bridge fixtures use process-local data only.
- `node tools/read-scope-perf/run.mjs`: 405 passed. Every list scope stays independent and bounded by distinct parent chunks, with fresh actual write/download checks.
- `npm run build`: passed (`tmp/purchase-review-build-final.log`). Project-wide type checking retains pre-existing diagnostics; newly introduced UI/selection projection type issues were corrected and checked separately, without fixing unrelated project errors.
- Real component UI previews: ar/en/ur at390/1280; separate review/accounting/management tabs and no overflow. PDF generated in Chromium and rendered to PNG: `tmp/purchase-item-review/docs/multiple-reviewers-approved.pdf` and `multiple-reviewers-approved-page1.png` show multiple captured reviewers on the same original form and the actual accounting actor.
- Independent acceptance runner: 119 passed, including source identities and unchanged lot/inventory balances through review/approval. This is isolated acceptance, not a live application/database UAT.
- Legacy baseline run is explicit: `tmp/purchase-review-legacy-baselines.log` contains 62 passes and the two old failures (approved PDF ownership expectation and an old delivery source-literal check). The PDF failure also reproduces on the complete HEAD import graph in `tmp/dpb-pdf-head-baseline.log`. No runtime authorization was broadened to make these pass.

Manual-only scripts: `01_inspect_copycmms2.sql`, `02_add_copycmms2.sql`, `03_verify_copycmms2.sql`. Four nullable columns plus two non-unique indexes; no data backfill, deletion, FK change or automatic DDL. Run inspection first and add only missing definitions; the existing status enum must include pending_review. Trial copycmms2 first. Live UAT and any production migration follow the user's manual application of the reviewed SQL; the new code must not be deployed against a database missing these columns.

No unrelated deferred Excel, chained supplier-return, inventory cleanup or other module changes authorized.

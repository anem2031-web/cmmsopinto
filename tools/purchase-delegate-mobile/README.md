Run the isolated card regression from the checkout:

```powershell
node tools/purchase-delegate-mobile/run.mjs --output C:/Users/mh/Documents/Codex/2026-11-04/new-chat/tmp/delegate-mobile
```

Requires installed dependencies and local Chrome. Supply `--chrome <absolute-path>` for another Chrome installation. Artifacts must be outside the checkout.

The runner extracts the actual delegate actionable Card JSX and assignment predicate with TypeScript AST, renders the real Card/Button/Badge primitives, and compiles the real Tailwind stylesheet. Explicit local fixtures cover Arabic, English, Urdu; delegate and delegate manager; 320, 375, 390, 768, and 1280 pixels; short and long titles; eligible assignment, add-to-bundle, and purchase variants. RPC-linked optional components use their real control shape, classes, and translated labels with no RPC hooks. Navigation and assignment handlers are invoked directly from the rendered real card with propagation assertions; no assignment is submitted.

Headless Chrome receives only in-memory HTML. Every attempted network request is aborted and fails the run. No application startup, environment file, authentication session, server module, or database is used. `results.json` records dimensions, eligibility/handler checks, loaded local files, and screenshots. The baseline replaces only the three responsive class strings in the extracted fixture, proves that the former layout collapses the title, and saves a before screenshot; source files are never reverted.

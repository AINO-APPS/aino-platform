# 03: Generated API models

**What to build:** Every client stops hand-maintaining task and sprint models. The OpenAPI contract generates web/Electron types and Kotlin and Swift models, so renaming a field breaks the build rather than the running product. Completed in one place, consumed by all four clients.

**Blocked by:** 01

**Status:** done

- [x] Web and Electron compile against generated task and sprint types
- [x] Kotlin and Swift models are generated and compile
- [x] Regenerating is deterministic and committed
- [x] Removing a field from the contract fails each client build
- [x] The generated output is validated by a test that fails on drift

## Comments

**2026-10-25 — implemented**

- Commit `8950ae55`. `contracts/openapi.json` is the single source; `scripts/generate-api-models.mjs` emits the web/Electron TS types plus the Kotlin and Swift models, and `--check` fails the build on drift. `contracts/tests/generated-models.test.mjs` proves regeneration is deterministic and that removing a contract field changes the output.

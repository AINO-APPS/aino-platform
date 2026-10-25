# 03: Generated API models

**What to build:** Every client stops hand-maintaining task and sprint models. The OpenAPI contract generates web/Electron types and Kotlin and Swift models, so renaming a field breaks the build rather than the running product. Completed in one place, consumed by all four clients.

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] Web and Electron compile against generated task and sprint types
- [ ] Kotlin and Swift models are generated and compile
- [ ] Regenerating is deterministic and committed
- [ ] Removing a field from the contract fails each client build
- [ ] The generated output is validated by a test that fails on drift

# 10: Enforce minimum client versions

**What to build:** Platform operators can enforce minimum versions for Android, desktop and web so that outdated recognized clients are directed to upgrade before legacy APIs are removed.

**Blocked by:** 09: Report client versions and handle upgrades.

**Status:** resolved

- [x] Operators can configure the platform-wide gate mode and a minimum version for each recognized client class.
- [x] In enforce mode, a recognized client below its minimum receives HTTP 426 with `CLIENT_UPGRADE_REQUIRED`, its current version and the required minimum.
- [x] A recognized client with no version is treated as version zero; unrecognized clients are never gated.
- [x] Health and the public client-version read remain exempt so clients can recover and show upgrade instructions.
- [x] Version comparison handles supported semantic versions and rejects malformed configuration safely.
- [x] Integration tests cover the enforcement boundary, each client class, missing versions and exempt routes.

## Comments

Implementation is code-only on `integration/project-types`, starting at
`2d78e9eb`. The operator explicitly chose no deployment or gate configuration
changes. Ticket 11 stays blocked on actual enforcement and verified ownership
rollout. Tests use the spec's agreed mini-Express HTTP and pure version seams.

## Answer

Implemented platform-wide `off`, `report` and `enforce` configuration. Invalid
operator values fail application startup with the variable named rather than
silently disabling protection. Missing defaults remain OFF with `0.0.0` minima.
The pre-authentication gate emits the existing uncacheable 426 contract below
the minimum; equal/newer versions pass. Legacy bearer/mobile-cookie and desktop
origin recognition are preserved. Unknown clients and health/public GET/HEAD
recovery reads, including trailing slashes, remain exempt.

Semantic comparison handles numeric components without floating-point rounding,
prerelease numeric/text identifiers (including hyphens), and build metadata.
Missing/invalid client versions retain the existing `0` response sentinel.
OpenAPI documents the shared 426 response on every gated operation. Route
inventory and snapshots are unchanged because no routes were added or removed;
generated API model freshness checks passed. Operator and module docs updated.

### Verification

- Red: the HTTP seam returned 401 instead of the required 426, invalid config
  did not throw, and hyphenated prerelease comparison returned equality.
  Each regression passed after its implementation slice.
- 32 focused server tests passed across gate, comparison, authentication and
  persistence; final gate/comparison rerun passed 30 tests including mobile
  token-cookie recognition.
- Full server CI: 2,055 passed; 506 PostgreSQL tests initially skipped without
  a test URL. The disposable loopback PostgreSQL runner then passed all 506
  tests across 24 suites, with zero skips. Combined: 2,561 tests passed.
- Contracts: 93 passed, including red-to-green coverage of previously missing
  operation-level 426 responses. Types, layering, production build, migration
  shipping/baseline checks and root guardrails passed.
- Requested broad review since Phase 2 found the operation-contract omission,
  now fixed. Standards review also identified pre-existing organization-scope
  omissions in date, hierarchy, board-settings and project-type repositories.
  These repositories are untouched by ticket 10; that broader follow-up is not
  silently repaired or represented as an enforcement defect. The finding is a
  documented-standard breach, not demonstrated HTTP data leakage.

No push, release, deployment, production database operation or gate/ownership
configuration change was made. Ticket 11 remains blocked on actual enforcement
and verified project-ownership rollout, as explicitly requested by the operator.

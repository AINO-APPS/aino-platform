# 09: Report client versions and handle upgrades

**What to build:** Current Android, desktop and web clients identify their versions, and operators can observe adoption before enabling enforcement; clients present an appropriate update action if the server responds with `426`.

**Blocked by:** 03: Kanban board and backlog; 04: Task list views and calendar; 05: Scrum planning without Scheduled or auto sprints; 07: Show subtasks across planning and effort totals; 08: Complete sprints with one carryover rule; Phase 2 ticket 13 (Android project-scope release).

**Status:** claimed

Platform/web/desktop claimed on `ticket/project-types-09`. Android and release proof remain separate; this claim does not resolve the whole ticket.

- [ ] Android, desktop and web requests identify client class and version; desktop forwards its bundled web version.
- [x] The platform-wide gate supports off and report modes; report mode records observed client versions without blocking requests.
- [x] Platform admins can view distinct users by client class and version over the previous 30 days.
- [x] A public version read exposes the current mode and minimum versions and remains available to update flows.
- [ ] Android and web show a blocking update-required or reload experience on `426`; desktop starts its updater and requests a restart.
- [x] Unrecognized browsers and integrations are not blocked, and requests from recognized clients without a version are reported as version zero.
- [ ] The Android and desktop releases stop using the Scheduled, timer and team-scope paths that are retired in ticket 11.

## Comments

### Platform/web/desktop implementation (partial ticket 09)

- Work is isolated on `ticket/project-types-09`. Base
  `4f5f8a120678dfc8f8c1d92932c456c11697aab1` and platform prerequisite
  `7d483048` were verified as ancestors before implementation. Android's
  `6caa765f` is not a git object in this platform repository; no Android checkout
  was generated or modified.
- Public GET `/api/client-versions` returns the agreed
  `{ mode: "off" | "report", minimums: { android, desktop, web } }` before
  tenant/auth/maintenance checks. GET `/api/admin/client-versions` is restricted
  to the existing tenantless platform-admin identity and console realm and
  reports `{ window_days: 30, versions: [{ client, version, users }] }`.
- Platform-wide environment configuration defaults to OFF and semantic
  `0.0.0` minima. Invalid modes (including `enforce`) remain OFF. Nothing in
  production was activated. Enforce/removal remain tickets 10/11.
- Expand-only rerunnable migrations are tenant `0033_client_versions.sql` and
  master `0011_client_versions.sql`, with matching new-database baselines.
  Observation fields never change `mobile`/`web` login exclusivity. Verified
  authenticated usage updates last-seen; a separate tenant-safe master
  observation survives session replacement/logout. Forged/revoked/anonymous
  tokens and impersonated identities do not count.
- Web, desktop, anonymous public-note reads and first-party fetches identify
  their immutable bundled web version from release metadata plus source
  revision. Desktop forwards both headers and has a bundled manifest fallback,
  including authorized uploads. Signed-upload hops never carry auth/client
  headers; an unreadable legacy redirect fails safely. No desktop version bump
  was needed for header/build tests.
- All API failure paths can trigger a blocking web reload or desktop's existing
  updater/download/restart boundary. Released planning uses project scope only;
  unswitched tenants see a migration-needed state without changing their switch.
  Legacy server routes remain. Browser and Electron build audits found no
  Scheduled/timer/sprint-config API paths.
- Contracts, route snapshot/inventory, generated web models, tasks parity,
  module README and [operator guide](../../../docs/client-versions.md) are
  updated. Ticket remains **claimed**, not resolved: Android implementation
  and installed/released-client proof are independently outstanding.

### TDD evidence

Each seam was exercised red before implementation: missing HTTP/config/service/
repository modules; missing web version headers; global 426 signaling; unsigned
third-party credential isolation; blocking reload and desktop restart actions;
project-only fallback; desktop proxy class forwarding; bundled metadata missing
from the container build; and unsafe opaque redirects (404 instead of safe
502). Green coverage includes mini-Express/no-DB routes, validated auth hooks,
tenant-safe persistence ports, real PostgreSQL upserts and independent
tenant/master migration reruns, JSON/text/blob/arraybuffer failures, and actual
bundled web/desktop metadata parity. No production database was used.

### Validation and baseline

- Current `integration/project-types` was merged at the end (already up to date
  at `4f5f8a12`), then affected checks were rerun.
- Focused server/auth/public/route checks: **62 passed**, one PostgreSQL test
  skipped in the no-DB run; the dedicated disposable PostgreSQL run passed that
  test and both existing container-port helper tests.
- Affected web/desktop transport/UI/planning checks: **114 passed / 17 files**,
  serially without resource contention. Build-version/container-metadata tests:
  **2 passed**. Desktop suite: **45 passed**.
- Contracts: **91 passed**; generated models, all guardrails, server/client/
  desktop typechecks, server dependency layering/build, browser and Electron web
  builds, SPA integrity, SQL asset shipping, baseline verification and diff
  whitespace checks passed.
- Full server CI: **2013 passed, 17 failed, 491 skipped** (184 passing suites,
  four failing and 23 skipped). All 17 failures were independently reproduced
  against an isolated archive of exact base `4f5f8a12`:
  `sprints.routes` (9), `tasks.workflowLifecycle.routes` (6),
  `tasks.teamVisibility.routes` (1), and `metrics.jobs` (1). They are not fixed
  by ticket 09.
- Exact-base client proof also reproduced **three failures** in
  `CommandPalette.test.tsx` (2) and `tasksLanding.test.ts` (1): legacy Scheduled/
  team-sprint expectations predating ticket 09. Resource-contended broad runs
  additionally hit existing 5-second UI timeouts; affected suites pass serially.
- Final whole-client run (`--maxWorkers=2 --testTimeout=15000
  --hookTimeout=20000`): **1071 passed, 3 failed / 159 files** (157 passing,
  two failing). Only the three independently confirmed exact-base failures
  above remain; all ticket-09 tests pass.

### Outstanding release steps

1. Finish the separately owned Android slice and its release/header/426 proof.
2. At release stage use `scripts/set-desktop-version.mjs` for desktop `3.0.80`
   or later with matching locks; package the new web bundle/manifest and prove
   installed updater/restart and browser reload. This work does not publish,
   push, tag, release or deploy anything.
3. Verify ownership rollout separately. Only after client releases and explicit
   operator approval may REPORT be enabled. Ticket 10 owns enforcement; ticket
   11 owns destructive retirement. Whole ticket 09 is not closed here.

### Release validation (separate bounded repair, 2026-11-11)

- Isolated branch `fix/project-types-release-validation` starts at the confirmed
  integration merge `16e68bd61bb6cc13395e77c3ec3ba7511299c837`. This repairs
  prerequisite release checks; it does not resolve ticket 09 or change its claim.
- Merged the latest `integration/project-types` before completion: already up
  to date at that same tip. Post-merge original server suites: **108 passed**;
  affected client suites: **30 passed**; all guardrails passed again.
- RED: `cd server; npm test -- --runInBand sprints.routes.test.ts
  tasks.workflowLifecycle.routes.test.ts tasks.teamVisibility.routes.test.ts
  metrics.jobs.test.ts` reproduced **17 failed / 108 tests**. The two named
  client suites reproduced **3 failed / 23 tests**.
- Causes: new Scrum guards consumed old positional sprint fixtures; PUT's
  transactional hierarchy read had no fixture row; the project-read capability
  fixture omitted the newly selected project type. Corrected fixtures retain
  refusal, lifecycle, authorization, audit and transaction assertions. PUT now
  also asserts the resulting state. The real runtime defect was the metrics
  collector still polling the removed `sprint-lifecycle` queue; that entry and
  its obsolete architecture documentation are removed.
- Client fixtures now use server-provided project tabs, keep Sprint visible
  without a current sprint, and exclude Scheduled. Added seven cases covering
  Kanban/Task list palette access and server tabs surviving feature loss.
- PostgreSQL RED: all **23 suites / 491 tests** actually ran:
  **305 passed, 186 failed, zero skipped**. Eight suites exposed stale fixtures:
  sprints under non-Scrum defaults, board tickets without project workflow
  states, missing `canAddSubtask` expectations, org-wide rather than project WIP,
  due-date rewriting/restoration, subtask story points, ordering outside the
  visibility contract, and today's seeder used against pre-expansion schemas.
  Historical schema fixtures now seed historical defaults independently;
  migration, rerun and fresh/upgraded convergence checks remain intact.
- Final full server CI: `cd server; npm run test:pg -- --runInBand --ci
  --coverage .` — **2521 passed / 211 suites, zero failed, zero skipped**;
  **1 snapshot passed**. This includes **491 PostgreSQL tests / all 23 suites**,
  not just the previously verified `clientVersions` suite. Both Docker port
  safety helper tests also pass.
- The remaining 22 PostgreSQL suites covered are: `projectBoard`,
  `projectPlanning`, `projectTypes`, `projectTypesPlanningMigration`,
  `projectsAccess`, `projectsKeyRename`, `projectsMigration`, `projectsOwnership`,
  `projectsWorkflow`, `serviceDeskProject`, `sprintCompletion`,
  `tasks.capabilities`, `tasks.estimateMigration`, `tasks.hierarchy`,
  `tasks.placement`, `tasks.placementRoutes`, `tasks.startDates`,
  `tasks.worklogMigration`, `tasks.worklogRoutes`, `tasksHierarchyExpand`,
  `tasksSchemaExpand`, and `tasksStartDateExpand`.
- Isolation: the existing `test:pg` runner created fresh loopback-only
  `postgres:16` containers and each suite created its own disposable database.
  Docker was initially stopped; the existing Docker Desktop runtime was started
  and readiness verified. Test containers were removed after each run. No
  application/production database was queried or mutated.
- Full client: `npm test -- --maxWorkers=2 --testTimeout=15000
  --hookTimeout=20000` — **1081 passed / 159 files, zero failed or skipped**.
  Desktop: **45 passed**. Contracts: **91 passed**. Build-version checks:
  **2 passed**. Server/client/desktop types, server layering, all guardrails,
  server build, migration shipping/baseline verification, browser and Electron
  renderer builds, SPA integrity and whitespace checks pass.
- Remaining gaps are release proof, not suppressed test failures: the separate
  Android slice and released-client header/426 evidence; installed desktop
  updater/restart and browser reload proof; independently approved ownership
  rollout and report/enforce/removal steps. No push, tag, release, deployment,
  gate configuration, ownership switch or Android change was performed.

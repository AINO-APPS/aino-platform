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

### Phase 3 two-axis review corrections (2026-11-11)

Scope is **all Phase 3 changes since Phase 2**, not only ticket09. This evidence
does not resolve ticket09 or authorize publication, rollout or enforcement.
Clean fix worktrees/branches were created from the verified platform integration
`feb4ac65681453d55269981afd185732c7469c45` and Android integration
`71a3bda5eba2c250265d0d7a396217532526d281`. Neither integration worktree nor
unrelated main-worktree changes were edited. All eight findings were confirmed;
none was treated as a false positive.

1. **Standards / reciprocal row locks — confirmed and fixed.** Deterministic
   real-PG execution of the actual placement and board-lock helpers reproduced
   a rejected move from a deadlock, rather than a synthetic SQL model. Status
   writes now acquire the same organization placement/lifecycle advisory lock
   before any row lock. Tracing the shared protocol also reproduced the same
   directly coupled key-rename/project-move deadlock; key renames join that
   protocol. Both helper concurrency cases pass. Additional real HTTP
   status/key-rename versus move-project races exercise the complete routers:
   project moves succeed and stale status may refuse with 409, never deadlock 500.
2. **Standards / inactive Epic classification — confirmed and fixed.** After
   authorized deactivation, an unrelated Epic title edit returned 409, while
   parenting a childless Epic under another Epic incorrectly returned 200.
   Stored types now retain their hierarchy level even when inactive. Full edit
   payloads resubmitting the existing type ID/key also work; only a genuinely
   new type selection must be active. Real HTTP regressions cover both outcomes,
   unchanged ID/key resubmission, new selection refusal and preserved history.
3. **Spec / dated Scrum backlog — confirmed and fixed, not a compatibility-only
   false positive.** Migrated rows retaining `planned_date` were absent from
   `GET /tasks/backlog?project_id=…` and serialized `container: scheduled` through
   detail/capabilities in **both** project and compatibility ownership modes.
   Backlog membership no longer filters any date. Containers follow the project
   type/initial-state backlog setting, never dates; the legacy Scheduled read
   remains a date-filtered compatibility shim, not a container. HTTP coverage
   includes Scrum plus Kanban backlog on/off and Task list across both modes.
   Legacy team-based authorization/placement remains intact until ticket11.
4. **Spec / migration leaf links — confirmed after ordered-chain tracing.**
   No migration after 0031 recovered the ordinary eligible leaves it cleared;
   the full chain through 0033 left the seeded Story #3 parentless. Historical
   0031 is unchanged. Additive `0034_recover_hierarchy_leaves.sql` uses its
   immutable repair snapshots to recover eligible same-project ordinary leaves
   as Subtasks and inherit the current parent's sprint, recording separate
   corrections and system history. Original repair rows/history are preserved.
   It never guesses missing links or overwrites later human hierarchy,
   placement or points edits. Proven same-transaction 0032 automatic-retirement
   history is recognized by matching migration timestamps; ambiguous older
   split-migration placement history stays untouched for administrator review.
   Real-PG fixtures cover epic children, ordinary leaves, deeper chains,
   non-leaves, cross-project links, epics with parents, invalid Subtasks,
   self-links, human edits and active/planned/completed automatic sprints.
   Fresh ordered-chain and already-applied-0031 upgrade paths both run the full
   migration runner twice, then replay 0034 directly with identical results.
5. **Spec / Android Add subtask — confirmed and fixed.** RED reproduced the
   missing capability decoder and absent Add subtask on a zero-child parent.
   The native detail now renders the server decision independently of the Epic
   feature, including before the first child. A title-only parent-subtask POST
   leaves type/project/sprint inheritance to the server. Creation prevents
   duplicate submissions, refreshes parent progress, and preserves drafts and
   standard reasons on stale refusals. Decoder, actual MockWebServer
   HTTP/ViewModel and Compose create/open/navigation tests cover this seam;
   endpoint coverage and native contract fixtures are updated.
6. **Spec / Cancelled parent creation — confirmed and fixed.** RED returned
   `canAddSubtask: true` and 200 from all three subtask create routes after parent
   cancellation. Capability and transactional create/conversion guards now
   share `CANCELLED_TERMINAL`. HTTP regressions check denial, no inserted child
   and unchanged parent history, including compatibility ownership mode.
7. **Spec / hierarchy-repairs review — confirmed and fixed.** The authorized
   Phase 2 review API had no reader and the UI had no section. Its existing
   web-admin endpoint now returns organization-scoped original and correction
   records with whitelisted before/after fields, reasons and timestamps. Deleted
   tickets retain records; renames update only the current displayed key.
   Authorization, tenant isolation, immutable history, generated wire models,
   OpenAPI and the accessible review UI are covered. Review never changes an
   ownership switch; administration remains web-only.
8. **Spec / week calendar — confirmed and fixed.** RED could not find a Week
   control. Month and Monday-to-Sunday Week now share inclusive spans, paged
   reads, undated tray, overlays, drag shifts and keyboard date edits.
   Accessible pressed-state controls, Today and week navigation use existing
   design tokens. Tests cover year boundaries, spans, single dates, overlays,
   toggles, drag, validation and unchanged month behavior.

Validation uses only the existing `test:pg` runner's fresh loopback-only
PostgreSQL containers and isolated per-suite databases. No application `.env`
database, production service, new dependency install, push, tag, release,
deployment, gate change or ownership switch was used.

#### Validation and remaining release gates

- RED commands used the real PostgreSQL runner for the lock, Epic, backlog,
  Cancelled-parent, migration-chain and authorized-review seams; Vitest for
  missing review/week UI; and native Gradle decoder/Compose tests for Add subtask.
  Targeted GREEN runs covered each finding before broader validation.
- Full web suite: **1,084 tests / 159 files passed**, zero failures/skips, using
  two workers and the established 15s/20s test/hook timeouts. Client typecheck
  passed. Browser and Electron renderer builds and both SPA integrity checks
  passed; version-metadata checks **2 passed**.
- Contracts **92 passed**; generated models are current. Explicit native-owner
  parity verification against the fix checkout also passed. Contract unit tests
  run without a native-repo override because their absent-sibling fixture
  intentionally tests that condition; native-owner verification is separate.
- Desktop typecheck and **45 tests** passed. Edge router **11 tests** passed.
  Server typecheck, dependency layering, build, **34** tenant SQL asset shipping,
  baseline verification, all platform/native guardrails and whitespace checks
  passed. Android endpoint parity is **272/539 proven**, 234 waived,
  3 client-retired, 32 pending, **zero unmatched**; all 85 realtime types match.
- Latest complete server CI:
  `cd server; npm run test:pg -- --runInBand --silent --ci --coverage .` —
  **2,536 tests / 212 suites passed**, **zero failures/skips**, **1 snapshot
  passed**. This enabled **all 24 PostgreSQL-gated suites**, including the new
  ordered leaf-recovery suite and complete HTTP concurrency regressions, rather
  than running only a proxy subset. Both disposable-port safety helper tests
  passed. The broader loop updated obsolete Scheduled/Cancelled expectations
  and exact query fixtures; real HTTP regressions remain the behavior oracle.
- Android final CI:
  `gradlew.bat --no-daemon testPlayDebugUnitTest lintPlayDebug assemblePlayDebug
  testDirectDebugUnitTest assembleDirectDebug --max-workers=2 --console=plain`
  passed. Play: **1,451 tests / 223 suites**; Direct: **1,458 tests / 223 suites**;
  both **zero failures/errors/skips**. Lint: **zero errors / 208 warnings**
  (unchanged warning baseline). Both debug APKs assembled and remain in the
  fix checkout's build outputs. The final run explicitly selected this
  platform checkout's contract fixtures with `AINO_PLATFORM_CONTRACT_FIXTURES`;
  committed native fixtures also carry the matching Add-subtask decision.
- An initial broad native run exposed the fixture helper's implicit ancestor-
  checkout lookup, now removed: default tests use committed checkout-local
  resources unless an explicit platform fixture override is supplied. That run
  also had an undetailed packaging failure. Isolated `packagePlayDebug
  --stacktrace` passed without source/config changes, and the complete final
  CI rerun passed both assemblies. No tests were skipped or suppressed.
- Android implementation is committed as
  `f8a38145ad6cc62ec55ff8b16c7d953b993513a5`; merging its current
  `integration/project-types` returned **Already up to date**. Both fix branches
  retain their respective reviewed integration bases. The platform fix commit
  is identified in the final handoff.

Ticket09 remains **claimed**, not resolved. Android/desktop publication,
installed-client request-header and blocking-426/update/restart proof, browser
reload proof, and explicit operator approval remain release acceptance work.
The gate stays OFF intentionally. No ticket10 enforcement or ticket11 contract/
destructive removal is implemented or authorized here.

### Publication preflight blocked on a production restore point (2026-11-11)

Ticket remains **claimed**, not resolved. Publication stopped before a source
push, PR, tag, version bump, production deployment or database operation.

- Clean release branches `release/project-types-09` were created in isolated
  platform/native worktrees from reviewed integration tips
  `54f4511424d95a109e171465cf431d2f85021937` and
  `7d1180bb1c91f51ef65adad0af8e0ae0ef64a0b3`. Fetching and merging current
  defaults returned **Already up to date** in both: platform `origin/master`
  `7d483048011aaa0f898aa4f126135e24f750e1db`, Android `origin/main`
  `6caa765fb09e87f9ea46c9ebf319b170008fe3c0`.
- **Concrete safety blocker:** production Postgres volume instance
  `2f366dc6-26dd-4f3c-bba8-a5ca162980c3` has **no backups and no backup
  schedules**. The read-only Railway GraphQL queries
  `volumeInstanceBackupList` and `volumeInstanceBackupScheduleList` both
  returned `[]` at approximately **2026-11-11 06:24 UTC**. The existing
  `db-backup.yml` workflow also has no recorded runs. No database contents,
  credentials, ownership switches or backup operations were accessed.
- This is not a schema-only deployment: pending migration
  `0032_project_types_scrum_planning.sql` restores due dates, clears saved
  pre-sprint dates, moves tickets, closes automatic sprints and **deletes
  planned automatic sprints**. `0031` and `0034` also repair hierarchy data.
  Their disposable-Postgres validation is recorded above, but is not a
  production restore point. The optional-backup operator decision in
  `docs/PRE_PUSH_DEPLOYMENT_RUNBOOK.md` section 1.4 explicitly describes the
  different **2026-08-27 migration-squash** deployment; it is not treated as
  approval to run these new data migrations without recovery evidence.
- **Unblock:** the operator must create/confirm a recoverable backup covering
  the production master and every tenant database (for example a Railway
  snapshot of the shared Postgres volume), with its ID/timestamp and recovery
  scope recorded before release resumes. Do not waive this check, run direct
  production SQL, or invoke the dump workflow on the operator's behalf.
- Production project `c19393be-ed82-43e5-b227-c1b8bc056743`, environment
  `c3c5b681-4b08-4eff-aec2-24089ebde1d9`, still runs the **previous Phase 2**
  platform commit `7d483048011aaa0f898aa4f126135e24f750e1db`:
  web deployment `109dfbbc-addd-4d0e-9e29-6bf222938d73` **SUCCESS**;
  realtime `83db0dfa-f130-462a-a330-7697c84ff859` **SUCCESS**;
  worker `6065861f-f068-4a2d-9931-97b7c78c8d7c` **SUCCESS**.
  These are not Phase 3 deployment evidence.
- Baseline HTTP checks: `https://next.aino.org.in/readyz` returned 200 JSON
  ready/web, `/healthz` returned 200 JSON ok/web, `/api/health` returned 200
  JSON ok, and the realtime Railway domain's `/readyz` returned 200 JSON
  ready/realtime. `/api/client-versions` currently returns the SPA HTML
  fallback, **not the required public version JSON**. HTTP 200 alone does not
  prove that the Phase 3 API exists.
- Restricted read-back of only the four non-secret client-version variables
  found `CLIENT_VERSION_MODE` and all three `CLIENT_VERSION_MIN_*` values
  **unset on web, realtime and worker**. Configuration was not changed; the
  reviewed Phase 3 defaults remain OFF/`0.0.0`. Public OFF/minimum verification
  must still be repeated after an actual Phase 3 deploy; it is not claimed
  from the old API's HTML response. REPORT approval remains separate.
- Latest published releases and live updater pointers are unchanged:
  [desktop v3.0.79](https://github.com/AINO-APPS/aino-platform/releases/tag/v3.0.79)
  at `969d7a22e753c1d2a0a2bbd696619b8ef80f2cfd`, and
  [Android android-v0.27.17](https://github.com/AINO-APPS/aino-android/releases/tag/android-v0.27.17)
  at `6caa765fb09e87f9ea46c9ebf319b170008fe3c0`.
  `https://cdn.aino.org.in/desktop/latest.json` returns
  `{"version":"3.0.79","tag":"v3.0.79"}`; Android's `android/latest.json`
  returns `0.27.17` and its matching versioned direct APK URL.
  Recheck collisions before choosing proposed `3.0.80` / `0.27.18`
  (`versionCode 27018`) on resumption.
- No new release assets, signed APK/AAB, desktop manifests, installed-client
  header/426/update/restart proof or physical-device acceptance were verified
  in this blocked attempt. No Play Store upload is claimed.
- Next implementation frontier remains ticket **10 after 09 is resolved**;
  ticket **11** additionally requires enforcement, all-organization ownership
  switch-over and its other recorded prerequisites. Both files are untouched;
  no compatibility endpoint or gate setting was removed or enabled.
- Cleanup is deliberately conservative while publication is blocked. The new
  clean worktrees remain at
  `D:\Learnings\WorkPulse-Split\.worktrees\project-types-09-release` and
  `D:\Learnings\WorkPulse-Split\.worktrees\project-types-09-android-release`;
  both local release branches are retained. The explicitly permitted
  `git -c core.longpaths=true worktree remove` attempts, without force, returned
  **not a working tree** for both existing residue directories
  `D:\Learnings\WorkPulse-Split\.worktrees\project-types-09-android` and
  `D:\Learnings\WorkPulse-Split\.worktrees\project-types-review-fixes-android`.
  Their remaining files were not manually deleted. No other worktree, branch
  or user-dirty checkout was modified.
- Documentation-only precommit validation: all `npm run check:guardrails`
  checks and `git diff --check` passed. The tracker commit is retained locally
  and fast-forward merged into the clean platform integration; no remote
  documentation PR or production-triggering push is needed for this blocker.

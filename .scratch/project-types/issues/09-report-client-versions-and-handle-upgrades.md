# 09: Report client versions and handle upgrades

**What to build:** Current Android, desktop and web clients identify their versions, and operators can observe adoption before enabling enforcement; clients present an appropriate update action if the server responds with `426`.

**Blocked by:** 03: Kanban board and backlog; 04: Task list views and calendar; 05: Scrum planning without Scheduled or auto sprints; 07: Show subtasks across planning and effort totals; 08: Complete sprints with one carryover rule; Phase 2 ticket 13 (Android project-scope release).

**Status:** resolved

Current Android, desktop and web releases are published and verified. Final CI and release closeout are recorded below; historical partial claims remain in the comments.

- [x] Android, desktop and web requests identify client class and version; desktop forwards its bundled web version.
- [x] The platform-wide gate supports off and report modes; report mode records observed client versions without blocking requests.
- [x] Platform admins can view distinct users by client class and version over the previous 30 days.
- [x] A public version read exposes the current mode and minimum versions and remains available to update flows.
- [x] Android and web show a blocking update-required or reload experience on `426`; desktop starts its updater and requests a restart.
- [x] Unrecognized browsers and integrations are not blocked, and requests from recognized clients without a version are reported as version zero.
- [x] The Android and desktop releases stop using the Scheduled, timer and team-scope paths that are retired in ticket 11.

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

### Approved snapshot rejected by Railway workspace plan (2026-11-12)

- The operator explicitly approved creating/verifying the named snapshot and
  continuing publication afterward. This supersedes the missing-approval
  barrier, but does not authorize plan changes, restore/delete/schedules or
  unprotected migrations.
- Authentication and the exact project/environment/Postgres/volume-instance
  mapping above were reverified before the approved command:
  `railway postgres pitr backup create --project
  c19393be-ed82-43e5-b227-c1b8bc056743 --environment
  c3c5b681-4b08-4eff-aec2-24089ebde1d9 --service
  0c25959f-9c91-46b1-854e-c3d58a4b3f6a --name
  pre-project-types-09 --json`.
- The command failed at **2026-11-12 03:37:57 UTC**, exit **1**, with CLI JSON
  `{"code":"GRAPHQL_ERROR","error":"Failed to create a backup","hint":null}`.
  The scoped CLI operation history exposes the precise rejection:
  **`Failed to create a backup: Manual backups and backup schedules are only available for Pro workspaces`**.
- Read-only `volumeInstanceBackupList` immediately afterward returned `[]`.
  No snapshot ID, completed backup or retention/recoverability proof exists.
  Retrying the same mutation through GraphQL would not resolve this explicit
  workspace-plan restriction; no alternative mutation or plan upgrade was used.
- Active-tenant host/database-routing coverage remains unverified. The newly
  authorized narrow catalog lookup was not needed after the backup itself
  failed, and no production database SQL was executed. Do not infer that all
  tenants are covered by the observed single Postgres service.
- **Unblock:** the operator must enable an eligible workspace plan or separately
  approve/provide another recoverable backup mechanism covering all affected
  targets. Once a real snapshot is verified, perform the authorized read-only
  active-host inventory before deployment; external hosts still require their
  own backup approval.
- Remote release collision checks remain unchanged: desktop **v3.0.79** and
  Android **android-v0.27.17** are latest; default branch tips still match those
  recorded above. No source push, PR, tag, version bump, release, deployment,
  gate/configuration change, restore, deletion or schedule change occurred.
  Ticket **09 remains claimed**. Tickets **10/11** remain untouched.

### Approved encrypted local backup blocked by source connectivity (2026-11-12)

- The operator explicitly approved encrypted local backups outside repositories,
  secure decryption-material retention and disposable PostgreSQL restore
  validation, followed by the original publication sequence. No further
  backup approval or Railway plan change was requested or attempted.
- Existing local Docker is available (server **27.3.1**) and 7-Zip is installed.
  Native `psql`, `pg_dump`, `pg_dumpall` and `pg_restore` are not on PATH.
  Portable/version-compatible tooling can be used after source connectivity
  exists; installing encryption tooling does not solve the current blocker.
- Production metadata still identifies the same approved Postgres service and
  volume instance. Its image is
  `ghcr.io/railwayapp-templates/postgres-ssl:18`; compatible backup/restore
  clients must support PostgreSQL **18**.
- A bounded, read-only application SSH probe used the existing local SSH
  identity and exact approved project/environment/web service. It attempted
  only `pwd`, not SQL, and failed with exit **255**:
  **`ssh: connect to host ssh.railway.com port 22: Connection timed out`**.
- The independent direct-database route check found `DATABASE_PUBLIC_URL`,
  `RAILWAY_TCP_PROXY_DOMAIN` and `RAILWAY_TCP_PROXY_PORT` **unset**.
  Read-only GraphQL `tcpProxies` for this exact environment/Postgres service
  returned **`[]`** at approximately **2026-11-12 03:46 UTC**. Its only
  configured database endpoint is private `postgres.railway.internal:5432`.
  No public proxy, new infrastructure or alternate cloud upload was created.
- **Concrete unblock:** permit this workstation to reach the existing Railway
  SSH endpoint `ssh.railway.com:22` (or provide an already authorized,
  reachable source connection). No credentials should be placed in chat.
  Then perform the approved fresh active-tenant routing inventory, consistent
  globals/master/all-target dumps, encryption and disposable PostgreSQL 18
  recovery verification before any release deployment.
- No production database contents were read, no plaintext staging or encrypted
  backup deliverable was created, and no keys/passwords were generated or
  printed. Tenant-host coverage, identity/schema/data-count verification and
  recovery remain unproven; neither an empty file nor a live database-file copy
  is treated as a verified backup.
- Publication remains stopped: no source push, PR, tag, version bump, release,
  deploy, production SQL, restore, plan/schedule/gate change or ownership
  operation occurred. Ticket **09 remains claimed** and **10/11** are untouched.

### Operator waiver for disposable internal-test data (2026-11-12)

- Operator clarification: **"the app is not yet publically releases, all data
  are added for internal testings, so if tthe ticket lost in plans doesnt have
  any issues"**.
- Scope: the operator represents **all current application data as disposable
  internal-testing data**, not production customer data, and explicitly accepts
  the known `0032` date/planning migration risk, including planned-ticket/sprint
  loss. The pre-release backup condition is waived for this publication only.
- Prior failed snapshot and local-backup attempts remain accurate: **no backup
  exists and no recovery verification is claimed**. No Railway plan, network,
  public TCP proxy, SSH, backup schedule or storage configuration is changed.
- Proceed only through reviewed feature PRs, green CI and the existing
  server/web production pipeline; native/desktop publication follows healthy
  EXPAND APIs. Only standard deployment migrations may change database data.
  CI, published-assets/feed checks and post-deployment verification are **not**
  waived.
- REPORT/enforcement and project-ownership switches remain unapproved and
  unchanged. Compatibility API removal remains ticket 11. Ticket 09 stays
  **claimed** until both current client releases are published and verified.

### Published release verification and final CI closeout (2026-11-12)

#### Source and CI

- [Platform EXPAND PR #7](https://github.com/AINO-APPS/aino-platform/pull/7)
  merged at `88d967e5833f754f4a22ed8a1360b33cf54651c9` after green CI.
  Initial Linux CI found one Windows-only path in the client-version migration
  regression; `path.join` repaired the existing test without changing SQL.
  [Repaired CI](https://github.com/AINO-APPS/aino-platform/actions/runs/43151846752):
  **2,536 server tests / 212 suites**, all 24 real-PG suites, one snapshot;
  **1,084 client tests / 159 files**, plus accessibility **23 tests**; all green.
  Local contracts **92**, bundled-version tests **2** and all guardrails passed.
- [macOS updater prerequisite PR #8](https://github.com/AINO-APPS/aino-platform/pull/8)
  added required x64/arm64 ZIP targets alongside DMGs. Its packaging regression
  went RED then GREEN; [full CI](https://github.com/AINO-APPS/aino-platform/actions/runs/43153424937)
  passed, including **46 desktop tests**. Final platform source/tag commit:
  [e218cfca50036606ca0d34765e19b636bec2ed2f](https://github.com/AINO-APPS/aino-platform/commit/e218cfca50036606ca0d34765e19b636bec2ed2f).
  [Merged CI](https://github.com/AINO-APPS/aino-platform/actions/runs/43154286951)
  and [web publication](https://github.com/AINO-APPS/aino-platform/actions/runs/43154286774)
  both succeeded.
- [Android source PR #8](https://github.com/AINO-APPS/aino-android/pull/8)
  merged after both full source CI runs
  [43151269253](https://github.com/AINO-APPS/aino-android/actions/runs/43151269253)
  and [43151261088](https://github.com/AINO-APPS/aino-android/actions/runs/43151261088)
  passed. Published tag commit:
  [be5a29b8c2a4667c45d8508175a1a90629c351eb](https://github.com/AINO-APPS/aino-android/commit/be5a29b8c2a4667c45d8508175a1a90629c351eb).
- Native merged/tag CI initially exposed asynchronous readiness barriers in
  `TicketSessionUiTest`: cancellation could precede inline-detail initialization,
  and placement asserted Plan membership before the final projection.
  The exact local cancellation test passed; complete CI reruns
  [43153111703 attempt 2](https://github.com/AINO-APPS/aino-android/actions/runs/43153111703/attempts/2)
  and [43156655025 attempt 2](https://github.com/AINO-APPS/aino-android/actions/runs/43156655025/attempts/2)
  passed, without exclusions or timeout changes.
  [Test-only repair PR #9](https://github.com/AINO-APPS/aino-android/pull/9)
  subsequently added complete readiness predicates, retaining every assertion.
  Both affected cases passed locally in Play and Direct; full
  [PR CI](https://github.com/AINO-APPS/aino-android/actions/runs/43158954497)
  and [push CI](https://github.com/AINO-APPS/aino-android/actions/runs/43158942818)
  passed before merge at `e66acb3fb122000c9256215810e1354b2dab7daa`.
  The only diff from the published tag is that test file; application code,
  version and immutable release artifacts are unchanged.
- Final test-only merged
  [CI 43160395954](https://github.com/AINO-APPS/aino-android/actions/runs/43160395954)
  completed **SUCCESS** at `e66acb3fb122000c9256215810e1354b2dab7daa` before
  this ticket's Status changed to **resolved**.

#### Production EXPAND verification

- Project `c19393be-ed82-43e5-b227-c1b8bc056743`, production environment
  `c3c5b681-4b08-4eff-aec2-24089ebde1d9`; all final deployments match platform
  source `e218cfca50036606ca0d34765e19b636bec2ed2f`:
  **web `e61cbc4a-90c6-42a7-82b2-8dc420d229d8` SUCCESS**,
  **realtime `2572a0ef-219f-401f-a4ef-c10a5108eb38` SUCCESS**,
  **worker `0661f3a5-8652-41ef-ba8f-dbee02773d48` SUCCESS**.
  Earlier approved EXPAND deployments at `88d967e5` also reached SUCCESS;
  scoped web pre-deploy logs confirm master/tenant migrations completed and
  `migrate.js: success — exiting`. No direct database SQL was executed.
- Actual HTTP JSON: `https://next.aino.org.in/readyz` **200 ready/web**,
  `/api/health` **200 ok**; realtime Railway `/readyz` **200 ready/realtime**.
  Worker remains private; configured readiness plus SUCCESS and scoped
  runtime dependency-ready logs are its evidence, not an invented public probe.
- Public GET `https://next.aino.org.in/api/client-versions` returns **200**,
  `Cache-Control: no-store`,
  `{"mode":"off","minimums":{"android":"0.0.0","desktop":"0.0.0","web":"0.0.0"}}`.
  No REPORT/enforcement or ownership switch was enabled; compatibility routes
  remain. REPORT activation still requires separate operator approval.

#### Published artifacts, feeds and runtime evidence

- [Desktop v3.0.80](https://github.com/AINO-APPS/aino-platform/releases/tag/v3.0.80)
  is a real non-draft/non-prerelease release at `e218cfca5003`.
  [Release workflow 43155507487](https://github.com/AINO-APPS/aino-platform/actions/runs/43155507487)
  succeeded for Windows, macOS and Linux and promoted R2 after all builds.
  **18 GitHub assets**: seven installers/update payloads, five blockmaps,
  three updater manifests and three checksum files.
  Every **15 CDN file** was downloaded/hashed and matched published SHA-256
  checksums, GitHub digests and sizes; all seven updater payloads also matched
  manifest SHA-512. No draft/empty release is counted.
- `https://cdn.aino.org.in/desktop/latest.json` returns
  `{"version":"3.0.80","tag":"v3.0.80"}`.
  Versioned `latest.yml`, `latest-mac.yml`, `latest-linux.yml` all report
  **3.0.80** and reference verified files. macOS has x64 and arm64 ZIPs and
  DMGs, Windows an EXE, Linux AppImage/DEB.
  The actual downloaded macOS ZIP contains bundled `client-version.json`
  **`3.0.80+web.e218cfca5003`**, matching the public web manifest.
- [Android android-v0.27.18](https://github.com/AINO-APPS/aino-android/releases/tag/android-v0.27.18)
  is a real non-draft/non-prerelease release at `be5a29b8c2a4`.
  [Release workflow 43156655163](https://github.com/AINO-APPS/aino-android/actions/runs/43156655163)
  succeeded. GitHub publishes signed direct APK, signed Play AAB and checksums;
  R2 publishes the direct APK and updater manifest. **No Play Store upload**.
  APK SHA-256:
  `4abc98ea6be4187e606551d2b39675099f9d32ace0bab03b01c6801b47c750c8`;
  AAB SHA-256:
  `1181c6c782ab5cb45924525194c1f711c35d279ede12d00fcf804ecd3e72e372`.
  Actual downloaded bytes matched checksums, GitHub digests and sizes.
- `https://cdn.aino.org.in/android/latest.json` returns **0.27.18** and the
  matching versioned `AINO-0.27.18-direct.apk` URL. Local SDK `aapt` and official
  digest-verified bundletool independently verify APK/AAB package
  **`app.aino.mobile`**, version **0.27.18**, code **27018**.
  `apksigner verify` and `jarsigner -verify` succeed; both certificate SHA-256
  digests equal the existing release identity
  `c490582bf04deaa2cf5575cbaa4d6b1c40e99ab5df7b950f56457cff4a9b6806`.
- The released browser bundle sent `X-AINO-Client: web` and version
  **`3.0.80+web.e218cfca5003`**. Valid 426 responses intercepted exclusively
  inside the agent-owned browser harness produced the blocking update heading;
  Reload AINO caused another navigation/request and remained blocking.
  Production was never forced to emit 426. Existing native/desktop transport,
  proxy/header fallback, blocking-UI and updater/download/restart harnesses
  passed in full CI; first-party project-only planning checks remain green.

#### Deliberate limits and remaining frontier

- **No backup/recovery proof exists.** The explicit operator waiver above
  covers disposable internal-test data and known planning/date migration risk
  for this publication only. No customer data is represented, and no network,
  SSH, public TCP proxy, workspace-plan or backup-schedule change was made.
- Physical Android/device and installed Windows/macOS/Linux update/restart
  acceptance were **not run**. Published-byte/feed verification and existing
  runtime/unit harness proof are the accepted release evidence. Desktop builds
  retain the existing **unsigned** distribution posture; OS signing,
  notarization/installation and Play Store acceptance are not invented.
- Ticket **09 is resolved**: all code and required current-client publication
  criteria are implemented and verified. Ticket **10** is the next frontier.
  Ticket **11** additionally requires enforcement and verified all-organization
  project-ownership switch-over. Neither ticket file was changed or claimed.
- Safe integration merges retain platform published source
  `e218cfca50036606ca0d34765e19b636bec2ed2f` plus this local tracker/documentation
  closeout, and Android source
  `e66acb3fb122000c9256215810e1354b2dab7daa`. No reset, force-push or direct
  default-branch push was used. All new commits include the Copilot trailer.
- Named verification downloads and the portable verifier/tool were removed
  after successful checksum/signature/package proof. Release worktrees are
  removed only after their commits are retained. Both old unregistered Android
  residue directories were subsequently inspected and removed using exact
  extended-length Windows paths, without force. Their absence was verified;
  unrelated worktrees and retained branches were untouched.

# 14: Docs, glossary and parity closeout

**What to build:** the written record matches what shipped:

- The glossary and ADR-017 read cleanly.
- Module docs describe projects owning tickets.
- Every parity and PostgreSQL suite is green on the integrated branch.

**Blocked by:** 01, 02, 03, 04, 05, 06, 07, 08, 09, 10, 11, 12, 13

**Status:** resolved

Claimed 2026-11-04 on `ticket/projects-own-tickets-14`, from clean integration
`200ec391`. Validation seams are the ticket-mandated existing contract/parity
validators, server HTTP/service and PostgreSQL suites, client tests and Android
Plan/detail JVM tests; documentation is checked against the shipped APIs.
Resolved 2026-11-07 after the integrated validation gates passed.

Spec: [projects-own-tickets](../spec.md). Decisions: ADR-017.

- [x] **GLOSSARY:**
  - Remove the Unassigned entry.
  - Placement: a project move replaces team transfer.
  - Fix the entries that run together: Placement/Sprint, Current sprint, Board, Unassigned and Worklog/Timesheet.
  - Note that teams are never tied to one project.
- [x] **ADR-017:** fix the Consequences bullet where the workflow text runs into the Service Desk text. Record that creating a project needs team lead or above.
- [x] **ADR-013:** add a cross-reference saying it is superseded.
- [x] **The tasks module README and the projects and Service Desk docs** describe project ownership, roles, aliases, archive and the switch-over.
- [x] **The roadmap's Phase 2 row** is marked shipped once the work merges.
- [x] **The full integrated runs pass with no skips**: the PostgreSQL test script, server suite, web suite, focused Android tests, contracts validation, tasks parity, Android endpoint and realtime parity, typechecks and guardrails.

## Answer

Documentation now matches the Phase 2 implementation: see
[Projects](../../../docs/PROJECTS.md), [Service Desk](../../../docs/SERVICE_DESK.md),
the glossary, ADR-013/017 and the tasks module README. The roadmap records shipped
implementation, not automatic activation of every organization.

The project-only Android proof initially used integration `bbfc1108`; final
Android `integration/projects-own-tickets` now also includes manual worklogs at
`74c51fe687bad295a0ad9d0033a5f38df3736c6c`. The dirty platform/Android mains
and other feature worktrees were not edited. The native source calls the actual
current APIs: accessible projects, `projects/mine`, project-scoped
sprints/backlog, create with `project_id`, move preview/confirm with
`project_id`, and by-key lookup returning the canonical ticket. The matrix names
native behavioral owners for scope, create, move, archived/viewer actions, alias
lookup and `project_updated` refetch. Administration remains deliberately
web-only.

### Validation record

Commands are run from this platform worktree unless a different directory is
specified. Full-run results and any remaining gaps are recorded below rather
than treating a focused green check as complete parity.

- `npm --prefix server run typecheck` and
  `npm --prefix client run typecheck`: initially failed because this new
  worktree had no dependencies (`tsc` unavailable). After
  `npm --prefix server ci --no-audit --no-fund` and
  `npm --prefix client ci --no-audit --no-fund`, both typechecks passed.
- `npm --prefix server run lint:deps`: passed, 360 modules / 1,506 dependencies.
- `npm run contracts:validate`: 85 tests passed, zero skipped after closing
  the old create-picker waiver assertion. An integrated pre-existing test race
  was also reproduced: generator negative tests temporarily remove `Task.rank`
  from the shared OpenAPI file while fixture tests read it. The root command now
  serializes test files (`--test-concurrency=1`); the same full command passes.
- `node scripts/check-android-endpoint-parity.mjs .validation/android --projects-only`:
  passed, all eight required project-facing operations genuinely covered and no
  temporary project waivers. This explicitly focused mode does not weaken the
  default manual-worklog gate.
- From `.validation/android`, all five native Node guardrails passed:
  `node scripts/check-independence.mjs`,
  `node scripts/check-module-boundaries.mjs`,
  `node scripts/check-source-provenance.mjs`,
  `node scripts/check-realtime-parity.mjs ../..`,
  `node scripts/check-endpoint-parity.mjs ../..`.
  Realtime: 85 server events / 85 native routes, no missing/dead listeners.
  Native endpoint baseline: 274/532 proven, 234 waived, 26 pending, zero
  unmatched. The baseline debt is reported, not reclassified as shipped.
- From `.validation/android`,
  `.\gradlew.bat --no-daemon --max-workers=1 --no-parallel testPlayDebugUnitTest
  --tests 'app.aino.mobile.feature.tasks.*'
  --tests 'app.aino.mobile.core.realtime.RealtimeEventRegistryTest'
  testDirectDebugUnitTest --tests 'app.aino.mobile.feature.tasks.*'
  --tests 'app.aino.mobile.core.realtime.RealtimeEventRegistryTest'
  assemblePlayDebug assembleDirectDebug`: passed, **255 Play + 255 Direct tests,
  zero failures/skips**, both assemblies successful.
  The earlier unrestricted concurrent run with `lintPlayDebug` reported
  `ProjectOwnershipViewModelTest.anArchivedTicketCanStillBeCommentedOnWhenTheServerAllowsIt`
  at line 225 (`commentCount`: expected 1, actual 0) in both 244-test runs.
  The unchanged source passed both the isolated project/registry rerun and the
  broader final runs. This timing-sensitive failure is recorded, not erased by
  the later green run. The lint-containing command was stopped after over
  30 minutes on the shared, memory-constrained host; lint has **no completed
  result** here. Device tests were not run.

### PostgreSQL runner defects reproduced and repaired

The original `npm run test:pg -- --runInBand` stalled while Docker was
unresponsive (a bounded `docker ps` probe also timed out after 20 seconds).
After Docker recovered, an unmodified retry ran all 15 suites but all **422 tests
failed authentication**, zero skipped. A minimal new-container probe reproduced
`docker port` returning an empty string immediately after creation: the old
runner built a URL with no port, silently targeting the unrelated local 5432
server, which rejected authentication. No application writes succeeded there.

The runner now waits for a valid published loopback port and fails closed rather
than defaulting to 5432. Its new public Docker-output readiness tests went red
before implementation and now pass (two tests). Docker subprocesses are bounded,
container creation is inside cleanup handling, and the owned container/port are
reported without credentials.

The real test container also spent minutes in `DataFileImmediateSync` on
`TRUNCATE`, confirmed through its own `pg_stat_activity`. Disposable test
containers now disable crash durability (`fsync`, `synchronous_commit`,
`full_page_writes`) while retaining ordinary transaction/constraint/lock rules.
No application database or production configuration is changed. Slow-host
retries use `--testTimeout=60000`; the earlier default 5-second hook failures
were not treated as application assertion failures.

### Cross-branch parity gap closed

The Android project integration initially lacked the separate manual-worklogs
integration. It was merged into Android `integration/projects-own-tickets` at
`74c51fe687bad295a0ad9d0033a5f38df3736c6c`; the merge preserves both project
scope and worklog behavior. No manual-worklog waiver was added.

Final parity checks against that merged Android worktree passed:

- `node scripts/validate-tasks-parity.mjs` with `AINO_ANDROID_REPO` set to the
  selected integration worktree: **55 features across four clients**, no
  violations.
- `node scripts/check-android-endpoint-parity.mjs <android-integration>`:
  **276/532 proven, 234 waived, 3 client-retired, 21 pending, zero unmatched**.
  The platform endpoint check also passed with zero unmatched.
- `node scripts/check-realtime-parity.mjs <platform-integration>`:
  **85 server event types / 85 Android routes**, no missing or dead listeners.
- The merged Android source passed **268 Play + 268 Direct task tests**, all
  five native guardrails, and both debug assemblies.

These are parity and focused Android results, not a claim that the full Android
endpoint baseline debt (waived and pending operations) has been eliminated.

### Integration defects closed through public regressions

- The first correctly connected full PostgreSQL run,
  `cd server; npm run test:pg -- --runInBand --testTimeout=60000`,
  completed **420 passed / 2 failed / 422 total, zero skipped**, across 15 suites
  (659.381s). Both failures were HTTP 409 `INVALID_TRANSITION` in
  `tasks.placementRoutes.integration.test.ts`: cancellation and the complete
  mutation-response journey.
  The root cause was not a transition rule: flag-off capability loading selected
  the org-template graph even for migrated project state IDs. Context loading
  now resolves project graphs independently of the authorization flag; real
  legacy template IDs retain the org fallback. The write guard uses the same
  graph selection. A fixture-order hypothesis did not resolve either failure;
  that temporary fixture change and diagnostic logging were removed.
  The two original public HTTP regressions then passed unchanged in behavior:
  `npx jest tasks.placementRoutes.integration --runInBand --testTimeout=60000
  -t 'bulk and cancellation responses|flag-off project workflow mutation'`
  (**2 passed, 51 intentionally filtered**).
- Worklog creation/edit/deletion, estimate changes and legacy timer-stop still
  invalidated only the old team, missing readers granted access through a
  different project team. The new HTTP-to-WebSocket regression first reproduced
  only user 1 receiving `task_updated`, not the authorized project viewer user 2.
  All five callbacks now share `tasks.effortAudience.ts`, keep after-commit timing,
  and send only `{ taskId, action }`. The regression covers the five write paths,
  excludes another organization, and proves flag-off team compatibility.
  The entire worklog HTTP suite passed (**87 tests**); the accompanying placement
  suite still had the two graph failures before the graph fix (**138 passed,
  2 failed / 140**, zero skipped, 512.175s). These earlier failures are not
  replaced by the later focused green result.

### Full server and web results and baseline separation

- `cd server; npm run test:ci -- --runInBand --testTimeout=60000`, with the real
  owned test database configured: **175 suites passed / 18 failed; 2,346 tests
  passed / 71 failed / 2,417 total, zero skipped** (937.569s). This run preceded
  the project-graph fix above.
- All **69 non-PG failures** were reproduced on a separate clean, detached
  `200ec391` checkout, using only the 17 failed test files:
  the literal baseline command below. Result: **17 failed suites; 69 failed / 325 passed /
  394 tests**, zero skipped (142.934s). The baseline checkout shared only this
  ticket's restored dependencies, not source changes.
  The files were `admin.routes`, `calendar.routes`, `chat.routes`, `export.routes`,
  `leavePolicy.routes`, `notifications.routes`, `organization.routes`,
  `profile.routes`, `projects.routes.characterization`, `search.routes`,
  `selfApproval`, `sprintScheduler`, `tasks.bulkPlacement`, `tasks.routes`,
  `tasks.teamVisibility.routes`, `tracker.deviceCredential`, and `tracker.routes`
  (all `server/__tests__/<name>.test.ts`). Examples include stale fake SQL handling
  of project sprint ownership, missing actor/grant context, and an old project-list
  parameter assertion (`[org, limit, offset]` versus `[org, actor, limit, offset]`).
  They are integration-base failures, not introduced by these ticket14 changes;
  this docs/closeout ticket does not silently rewrite unrelated route fixtures.
- `cd client; npm test -- --maxWorkers=1`: **141 files passed / 5 failed;
  1,027 tests passed / 5 failed / 1,032 total** (1392.54s). Four failures hit
  the unchanged 5-second timeout: `ChatInputBar.camera`, `PollCreator`,
  `PollDisplay` and `Estimates` (create). `tasksNavigation` could not find
  the Projects heading while the app still showed its loading spinner.
  These shared-host timing failures are retained in the record; a focused
  unchanged-source rerun is recorded below.
- `npm --prefix server run build`, `npm --prefix client run build`,
  `node scripts/verify-docker-migrations.mjs`,
  `node scripts/a2-verify-baseline.mjs`, and
  `node scripts/verify-spa-build.mjs client/dist`: passed.
  The baseline guard retains its existing explanatory warning about the
  fresh-tenant-only sprint-retrospectives drop/recreate migration.

The exact baseline replay, from that clean checkout's `server` directory:

```powershell
npm run test:ci -- --runInBand --testTimeout=60000 --runTestsByPath `
  __tests__\admin.routes.test.ts __tests__\calendar.routes.test.ts __tests__\chat.routes.test.ts `
  __tests__\export.routes.test.ts __tests__\leavePolicy.routes.test.ts __tests__\notifications.routes.test.ts `
  __tests__\organization.routes.test.ts __tests__\profile.routes.test.ts __tests__\projects.routes.characterization.test.ts `
  __tests__\search.routes.test.ts __tests__\selfApproval.test.ts __tests__\sprintScheduler.test.ts `
  __tests__\tasks.bulkPlacement.test.ts __tests__\tasks.routes.test.ts __tests__\tasks.teamVisibility.routes.test.ts `
  __tests__\tracker.deviceCredential.test.ts __tests__\tracker.routes.test.ts
```

### Final verification and remaining acceptance gap

- Fresh `cd server; npm run test:pg -- --runInBand --testTimeout=60000`:
  **15/15 suites and 423/423 tests passed, zero skipped**, 277.970s.
  The two Node published-port readiness tests also passed before Jest.
  This run used a newly created disposable container and the final runner.
  A preceding post-fix attempt still failed the bounded Docker health probe;
  the final probe allowance is 60 seconds rather than 15 seconds on this shared
  host. That failed attempt is not counted as a passing PostgreSQL run.
- `cd server; npx jest tasks.workflowGraph tasks.workflowLifecycle.routes
  tasks.cancelNotDelete tasks.bulkCancelCompleted --runInBand
  --testTimeout=60000`: **4 suites / 59 tests passed, zero skipped**, 14.137s.
- The first unchanged-source web retry still had **2 failures / 75 passes**:
  Projects navigation remained at the lazy-loading spinner, and PollDisplay hit
  its unchanged 5-second timeout. The navigation fixture preloaded Tasks but not
  the newly tested Projects lazy page; it now preloads both real pages before
  checking navigation, without changing application routing or permissions.
  The final focused command below passed **5 files / 77 tests, zero skipped**
  (40.190s), with a CLI-only 60-second allowance for this host. At that point,
  the original full 1,032-test web run had **not been rerun** after this
  fixture-only change; see the current full-suite rerun below.
- Final server and client typechecks passed. Final server `lint:deps` passed:
  **361 modules / 1,509 dependencies**, no violations. Server build passed again.
- Final `npm run contracts:validate`: **85 passed, zero skipped**.
  `npm run check:guardrails` passed after staging the new files, and staged
  `git diff --cached --check` passed.
- Actual native checks were repeated against the merged Android branch: project
  HTTP proof **8/8**, realtime **85/85**, native endpoint baseline **276/532**,
  zero unmatched, and tasks-parity **55 features across four clients**.
- The native endpoint baseline still records 234 waived and 21 pending
  operations; project and manual-worklogs behavioral owners are present.

The exact final web retry, from `client`:

```powershell
npm test -- --maxWorkers=1 --testTimeout=60000 `
  src\__tests__\ChatInputBar.camera.test.tsx src\__tests__\tasksNavigation.test.tsx `
  src\components\chat\PollCreator.test.tsx src\components\chat\PollDisplay.test.tsx `
  src\pages\tasks\__tests__\Estimates.test.tsx
```

### Current rerun (2026-11-05)

- `npm --prefix server run test:pg -- --runInBand --testTimeout=60000`:
  **15/15 suites, 424/424 tests passed, zero skipped**.
- `npm --prefix server run test:ci -- --runInBand --testTimeout=60000`:
  **164 suites passed, 17 failed, 15 skipped; 1,941 tests passed, 69 failed,
  424 skipped**. The 69 non-PG failures match the clean-base failures recorded
  above; the dedicated PostgreSQL run covers the skipped integration tests.
- `npm --prefix client test -- --maxWorkers=1 --testTimeout=60000`:
  **146/146 files and 1,032/1,032 tests passed**.
- Contracts passed (**85/85, zero skipped**); repository guardrails, server and
  client typechecks, and server dependency layering passed.

**Ticket14 remains claimed, not resolved.** Documentation, native endpoint and
realtime parity, tasks-parity, focused Android proof, no-skip PostgreSQL
validation, and the full web suite are green. The full server suite still has
the 69 failures reproduced on the clean base, so the original all-green
acceptance condition remains unmet. Ticket13's global parity checkbox is now
checked based on the merged Android branch and the unfiltered parity results
above.

### Phase 2 follow-up (2026-11-07)

- The four project/task HTTP route suites passed: **59 tests, zero failures**.
  Their fixtures now cover the project list's accessible-project bind value,
  project-role reads, project-backed sprint lookup, tenant-isolated task
  status, and a create request that reaches the transactional insert.
- Fresh `npm --prefix server run test:pg -- --runInBand --testTimeout=60000`:
  **15/15 suites and 424/424 tests passed, zero skipped**.
- Fresh full server suite:
  **168 suites passed, 13 failed, 15 skipped; 1,943 tests passed, 67 failed,
  424 skipped**. All 13 failing suites are outside Phase 2's project/ticket
  work and belong to the same non-PostgreSQL baseline-failure set recorded
  above; the full-server all-green acceptance item therefore remains open.
- Contracts passed (**85/85, zero skipped**); all repository guardrails,
  server/client typechecks, and server dependency layering passed.

The roadmap marks Phase 2 shipped as an integrated capability, with activation
and validation caveats linked here. This does not resolve the all-green
closeout gate or authorize merging into the dirty `master` worktree.

The disposable baseline and LF Android validation worktrees and owned PostgreSQL
containers were cleaned up. The pre-existing dirty main checkouts and other
feature worktrees were not edited. Before committing,
`git merge --no-edit integration/projects-own-tickets` reported **Already up to
date**, with integration at `1479e629e1f91d18b19663995a016df44db6e47b` before
the subsequent review-fix commit.

### Final integrated rerun (2026-11-07)

- Focused project/task and baseline HTTP/service fixtures: **13 suites,
  335/335 passed**. The previously failing fixtures now account for the
  project-ownership and team lookups; the sprint scheduler fake also models
  the project-scoped sprint lock.
- Full server Jest suite with `TASKS_SCHEMA_TEST_DATABASE_URL` pointed at the
  disposable PostgreSQL 16 container: **196/196 suites and 2,434/2,434 tests
  passed, zero skipped**. The dedicated PostgreSQL runner also passed
  **15/15 suites, 424/424 tests, zero skipped**.
- Full web suite: **146/146 files, 1,032/1,032 tests passed**.
- Focused Android Plan/detail and realtime unit tests: **279 Play + 279 Direct
  tests passed, zero failures or skips**; Play and Direct debug assemblies
  succeeded.
- Contracts: **85/85 passed, zero skipped**. Tasks parity: **55 features
  across four clients**. Android endpoint parity: all eight required project
  operations covered, zero unmatched. Realtime parity: **85/85 server events
  routed**, with no dead listeners.
- Server/client typechecks, repository guardrails, server dependency layering,
  and Android independence, module-boundary, and source-provenance checks
  passed.

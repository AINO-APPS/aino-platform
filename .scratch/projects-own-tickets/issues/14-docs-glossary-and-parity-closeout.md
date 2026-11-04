# 14: Docs, glossary and parity closeout

**What to build:** the written record matches what shipped:

- The glossary and ADR-017 read cleanly.
- Module docs describe projects owning tickets.
- Every parity and PostgreSQL suite is green on the integrated branch.

**Blocked by:** 01, 02, 03, 04, 05, 06, 07, 08, 09, 10, 11, 12, 13

**Status:** claimed

Claimed 2026-11-04 on `ticket/projects-own-tickets-14`, from clean integration
`200ec391`. Validation seams are the ticket-mandated existing contract/parity
validators, server HTTP/service and PostgreSQL suites, client tests and Android
Plan/detail JVM tests; documentation is checked against the shipped APIs.

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
- [ ] **The full integrated runs pass** with no skips: the PostgreSQL test script, the server suite, the web suite, the focused Android tests, contracts validation, tasks parity, Android endpoint and realtime parity, typechecks and guardrails.

## Answer

Documentation now matches the Phase 2 implementation: see
[Projects](../../../docs/PROJECTS.md), [Service Desk](../../../docs/SERVICE_DESK.md),
the glossary, ADR-013/017 and the tasks module README. The roadmap records shipped
implementation, not automatic activation of every organization.

Android proof uses integration `bbfc1108`, checked out with LF into a disposable
`.validation/android` worktree. The dirty platform/Android mains and other
feature worktrees were not edited. The native source calls the actual current
APIs: accessible projects, `projects/mine`, project-scoped sprints/backlog,
create with `project_id`, move preview/confirm with `project_id`, and by-key
lookup returning the canonical ticket. The matrix names native behavioral
owners for scope, create, move, archived/viewer actions, alias lookup and
`project_updated` refetch. Administration remains deliberately web-only.

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

### Cross-branch parity gap (pre-existing)

The Android projects integration does **not** contain the separate Android
manual-worklogs integration. This is visible only when checking the actual
selected native source rather than assuming a sibling checkout:

- `$env:AINO_ANDROID_REPO = (Resolve-Path .validation/android).Path;
  node scripts/validate-tasks-parity.mjs`: 12 violations, all in the pre-existing
  `time-tracking-on-task/android` entry: missing `TicketWorklogsTest.kt` and its
  11 named behavioral owners. No Phase 2 project owner is missing.
- `node scripts/check-android-endpoint-parity.mjs .validation/android`:
  fails on the five absent manual-worklog/estimate operations (`GET`/`POST`
  worklogs, `PATCH`/`DELETE` worklog, `PATCH` estimates).

No manual-worklog waiver was added and no native source/snapshot was rewritten
to conceal this. Default single-repo `contracts:validate` validates the matrix
shape and platform owners; its green result is not proof of those absent native
worklogs. Merge that separate Android integration and rerun both unfiltered
commands to close the cross-branch gap.

The original native checkout's endpoint check also exposed Windows CRLF-only
snapshot staleness. A clean LF checkout passes; no generated native files were
changed in the existing integration worktree.

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
  (40.190s), with a CLI-only 60-second allowance for this host. The original full
  1,032-test web run was **not rerun** after this fixture-only change; the recorded
  full-run timing failures remain a validation gap, not a full-suite green claim.
- Final server and client typechecks passed. Final server `lint:deps` passed:
  **361 modules / 1,509 dependencies**, no violations. Server build passed again.
- Final `npm run contracts:validate`: **85 passed, zero skipped**.
  `npm run check:guardrails` passed after staging the new files, and staged
  `git diff --cached --check` passed.
- Actual native checks were repeated before cleanup: project HTTP proof **8/8**,
  realtime **85/85**, native endpoint baseline **274/532**, no unmatched.
  The unfiltered worklog endpoint gate and actual native-owner validation still
  fail for the separate integration gap described above.

The exact final web retry, from `client`:

```powershell
npm test -- --maxWorkers=1 --testTimeout=60000 `
  src\__tests__\ChatInputBar.camera.test.tsx src\__tests__\tasksNavigation.test.tsx `
  src\components\chat\PollCreator.test.tsx src\components\chat\PollDisplay.test.tsx `
  src\pages\tasks\__tests__\Estimates.test.tsx
```

**Ticket14 remains claimed, not resolved.** Documentation, project-specific native
proof and no-skip PostgreSQL validation are complete, but the original full-green
acceptance condition is not met: the 69 base server failures, absent Android
manual-worklogs integration, and lack of a subsequent full web green run remain
explicit. Ticket13's global parity checkbox also remains open; it is not checked
on the strength of the focused project gate alone.

The disposable baseline and LF Android validation worktrees and owned PostgreSQL
containers were cleaned up. The pre-existing dirty main checkouts and other
feature worktrees were not edited. Before committing,
`git merge --no-edit integration/projects-own-tickets` reported **Already up to
date**, with integration still at `200ec3915a4d5b0506189adbbc7983e23ff7d1eb`.

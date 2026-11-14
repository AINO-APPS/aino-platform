# 02: Start dates without Scheduled placement

**What to build:** A ticket's planned day becomes its start date. Members can view and edit it, and every date-driven read uses it, while older clients continue to work through the legacy field and request shape.

**Blocked by:** None (can start immediately).

**Status:** resolved

- [x] Tickets have a nullable start date, and existing planned days are copied into it by an idempotent migration.
- [x] Ticket detail and edit behavior use start date; date changes are recorded in history and do not change placement.
- [x] A due date earlier than the start date is refused with a clear error.
- [x] Search, export, notes, manager views, attendance day views, My Work and dashboard date windows use start date.
- [x] Legacy `planned_date` request and response fields remain available and map to start date without losing data.
- [x] Re-running the migration changes nothing after the first successful run.

## Answer

Implemented in `c56025d5` (`feat(tasks): expand independent start dates with legacy aliases`).

- `server/platform/db/migrations/0029_tasks_start_date.sql` expands nullable start date and copies planned days once. Transactional backfill marker prevents a direct replay from restoring a deliberately cleared date. Existing explicit dates, placement and deadlines are retained; 0028 stays reserved for ticket 01.
- `server/modules/tasks/tasks.dates.ts` and `tasks.dateRepository.ts` validate real ISO dates, lock concurrent date edits, persist start-date/history atomically and refuse due-before-start with the specified message. Both create routes, full edits and legacy schedule/unschedule support the field without placement writes. Explicit start date/null wins over the planned-date alias.
- All listed date readers now use start date: task day/week collections, search, export, Notes (including conversion/link summaries), manager/attendance and web My Work/dashboard grouping. Ticket/search/Notes responses and date deltas retain the legacy alias. Web detail displays and edits Start date with edit capability even in a sprint; deadline input has the start-date minimum.
- Expanded OpenAPI/AsyncAPI, generated web model, fixtures, API/module/design docs. Only the shrinking detail file-size baseline was lowered. Original claimed-ticket dirty change was retained.

### Verification

Agreed seams from `../spec.md`: real HTTP/PG, real-PG migration replay, web RTL/API mocks. TDD red failures were observed for migration, start-date editing/alias/history, sprint schedule shim, backlog date validation, date readers, note conversion, detail display, My Work and deadline input before their implementations.

- Backend targeted run: **15 suites, 222 tests passed**, including real PostgreSQL schema expansion and placement-route regression suites. After adding project member/viewer/archive/no-op coverage, final date suites: **2 suites, 10 tests passed** (8 HTTP cases and 2 migration cases).
- Web targeted run: **8 suites, 54 tests passed**, including Start date rendering/edit/save, capability freshness, My Work, schedule/calendar compatibility.
- Server, client and desktop typechecks passed; server dependency layering passed.
- `npm run check:guardrails` and `npm run contracts:validate` passed (**85 contract tests**); `git diff --check` passed.
- Used the user-approved shared loopback PG16 service with the harness's unique disposable databases. No production calls, secrets, installs, pushes or releases. No container created or stopped.
- `git merge --no-edit integration/project-types` into this ticket branch returned **Already up to date**; integration tip `4353ba85` remains an ancestor. Integration itself was not merged or modified.

### Scope and limitations

Legacy routes/shims, Scheduled placement storage and sprint deadline bookkeeping remain for ticket 05 and Contract; no removal, scheduler retirement or sprint-date changes were implemented. Carry-forward remains operational through its retained route and reads/writes start date. No Android code or release was changed; the agreed Phase 2 reference is integration/projects-own-tickets at `74c51fe`.

The real Notes daily-prefill test adds legacy meeting date columns only to its disposable fixture because the existing reader references columns absent from the current tenant schema. That unrelated production drift was not changed. Full repository tests/builds were not run; focused tests, typechecks, guards and contracts above were run. An initial overloaded 5-second legacy PG run timed out; the affected suite and final combined targeted run passed with a bounded 30-second test timeout. One post-merge run transiently failed on the shared PG service; an immediate isolated HTTP rerun and then the combined date rerun both passed (8 and 10 tests respectively).

### Platform integration verification (2026-11-09)

- Verified clean `integration/project-types` at `4353ba8542bcb97b6f4158b1f1d3c0e66ce7d770` and ticket tip `6a14f90ee38f6207c094a68f78ab3e1a36d48058`. Conflict-free non-fast-forward merge `152f84019f920cc81c4fd04d12a952d6e3232191` preserves the ticket tree exactly.
- Reused existing server/client/desktop dependencies through local junctions; no installs. Real PostgreSQL suites used the approved loopback test service and per-suite disposable databases, removed by the harness.
- Backend: **10 suites, 138 tests passed, zero skips**. Run from `server`: `npm test -- --runInBand --testTimeout=30000 --runTestsByPath __tests__/tasks.startDates.integration.test.ts __tests__/tasksStartDateExpand.integration.test.ts __tests__/tasks.placementRoutes.integration.test.ts __tests__/tasks.placementRoutes.test.ts __tests__/tasks.collection.test.ts __tests__/tasks.deltas.test.ts __tests__/tasks.createInsertArity.test.ts __tests__/tasks.editPlacement.test.ts __tests__/tasks.placementEffects.test.ts __tests__/tasks.sprintRepository.test.ts`, with `TASKS_SCHEMA_TEST_DATABASE_URL` set to the approved disposable service. Covers real date-reader HTTP behavior, migration replay, validation/history/concurrency and placement regressions.
- Web: **9 suites, 55 tests passed**. Run from `client`: `npm test -- --reporter=dot src/pages/tasks/__tests__/startDateEdit.test.tsx src/pages/tasks/__tests__/detailLayout.test.tsx src/pages/tasks/__tests__/capabilityFreshness.test.tsx src/components/dashboard/MyWorkCard.test.tsx src/pages/tasks/__tests__/ScheduleCalendar.test.tsx src/pages/tasks/__tests__/calendar.test.ts src/pages/tasks/__tests__/bugScheduledHiddenDuringSprint.test.ts src/pages/tasks/__tests__/useTaskDeltas.test.tsx src/__tests__/scheduledTasks.test.ts`.
- Integration validation initially exposed four calendar fixture failures: spreading the expanded contract fixture supplied `start_date: null`, correctly preventing fallback to the overridden legacy date. Test-only follow-up sets matching start dates and adds coverage for explicit date/null precedence and omitted-field legacy fallback. Production behavior and approved baselines remain unchanged.
- Server/client/desktop typechecks, server dependency layering, root guardrails, **85 contract tests**, and whitespace checks passed. No pushes, releases, other branch merges or Android changes. **Ticket 02's Android slice remains separately running; this verifies platform integration only, not the entire spec.**

## Comments

2026-11-12 closeout reconciliation: Android start-date changes are integrated
and included in ticket 09's verified 0.27.18 publication and green full CI.
The historical platform-only limitation above no longer blocks this ticket.
Compatibility aliases remain until ticket 11's guarded contraction.
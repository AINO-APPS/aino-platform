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
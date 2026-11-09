# 04: Task list views and calendar

**What to build:** Task list members can view and plan project tickets in a sortable list, a workflow board and a date calendar; Android provides a date-grouped upcoming view.

**Blocked by:** 01: Project type controls and lifecycle; 02: Start dates without Scheduled placement; 03: Kanban board and backlog.

**Status:** resolved (server/web + Android)

- [x] Task list projects provide List, Board and Calendar views, while Kanban and Scrum retain their own type-specific views.
- [x] The list can sort and filter by key, title, type, status, assignee, priority, start date and due date.
- [x] The calendar shows open tickets across the inclusive start-to-due span; a ticket with one date appears on that date, and an undated ticket appears in a separate list.
- [x] Calendar drag actions update ticket dates and refuse a due date before the start date.
- [x] Leave, holiday and meeting overlays are shown on the calendar.
- [x] Android provides an upcoming view grouped by start date with overdue work first; calendar remains web-only.
- [x] Tests verify the date-range behavior, filters, date edits and project scoping through the public reads and client interactions.

## Answer

Implemented the server/web slice on `ticket/project-types-04`. Task list projects
render real List and Calendar surfaces next to ticket03's unchanged shared Board.
List exposes all eight columns with server filters/sorts and page controls.
Calendar reads inclusive overlapping spans (including either single date), open
undated work, and read-only approved leave/holiday/meeting overlays. Drag shifts
the whole span without changing workflow, project or sprint; undated drops date
both ends. The keyboard editor also supports clearing dates. Both client and
server refuse due-before-start; server capabilities govern read-only controls.

Public reads use `GET /api/tasks?scope=list|calendar&project_id=…`, with bounded
500-ticket pages; Calendar follows all pages. OpenAPI, generated web models,
contract tests, parity and user/module/API documentation are updated. Legacy
reads preserve their behavior. No ticket04 migration was needed.

Validation after merging integration through `c9e062e9` (including ticket05/06):
- Client and server typechecks pass; dependency layering passes.
- Six focused RTL suites pass: **21 tests** (List, Calendar, real page wiring,
  project tabs, shared Board, start-date editing).
- `projectBoard.integration`, `tasks.collection`, `routes.snapshot` pass:
  **32 tests and one snapshot**, including real PostgreSQL HTTP date/filter/
  sorting/access/history coverage.
- `contracts:validate`: **89 tests pass**; generated models are current.
- `check:guardrails` passes. SQL-in-routes debt was reduced and ratcheted.

PostgreSQL tests used only the supplied disposable local test connection and
per-suite test databases; no PostgreSQL service/container was started or stopped.
No release, production operation, push or merge into integration was performed.

Broader regression probes exposed existing-area fixture failures outside this
slice: `projectPlanning.integration` expects raw null-workflow fixtures on sprint
boards at lines 163/213 (two failures), and `tasks.teamVisibility.routes` expects
200 from the direct detail viewer fixture at line 364 (one failure). Their board/
detail implementations and fixtures are unchanged by ticket04; these are not
counted as passing validation.

Android List, workflow Board and Upcoming are integrated on the Android
`integration/project-types` branch. The ticket branch passed 45 focused tests
and five guardrails; the merged run passed the focused Task list, Kanban,
planning and shared sprint regressions (**113 tests, zero failures**). Calendar
remains web-only; inherited Scrum behavior and hierarchy remain unchanged.

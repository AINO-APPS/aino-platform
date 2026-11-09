# Ticket03 platform + web evidence

Branch: `ticket/project-types-03`.
Base: `83cd4065c8029a7fa534eb1bbd1fa1035ca6e197`, verified as the
`integration/project-types` tip before creating the isolated worktree.

## Delivered

- Shared project board/backlog reads for Kanban, Scrum and Task list, preserving
  capability authorization and the native public-read boundary. Continuous
  boards ignore date placement; Scrum boards use their selected/current sprint.
- Cancelled excluded; Done retained for 14 days. Optional Kanban backlog is off
  by default and separates initial-state visibility without rewriting tickets.
- Strict project-admin settings; project workflow owns per-state limits.
  Occupancy and accepting metadata use the same unfiltered board population.
- Project-before-ticket transactional locking and fresh lifecycle/capacity
  checks protect status PATCH, full edits and bulk status against last-slot races.
  `WIP_EXCEEDED` includes count/limit, preserved by web error rendering.
- Migration0030 copies org WIP to existing projects once; future projects
  default false. Direct replay preserves subsequent project-admin choices.
- Capability-driven web board/backlog, pointer/keyboard moves and confirmations,
  quick creation, settings, retries and realtime invalidation. Non-Scrum has no
  sprint actions. No ineffective legacy filter controls on the new surface.
- Additive OpenAPI/models/route snapshot updates and module documentation.

## TDD observations

Invoked TDD and frontend-design before their relevant implementation slices.
Observed reds included missing board/settings endpoints (404), project WIP
switch ignored, sprint count/window mismatch, and a deliberately delayed
concurrent update admitting both requests to one remaining slot (200/200).
After the final lock/recheck, only one move succeeds. The rendered stale-WIP
test first lost `(1/1)` to generic error copy, then passed after preserving the
server message. Tests assert database/HTTP/rendered behavior, not SQL spelling.

## Final validation

All commands ran in this worktree; server/client dependencies restored from
their existing lockfiles. Real PostgreSQL used only the authorized throwaway
instance at `127.0.0.1:44677`, with suite-owned disposable databases.

- Server: `npm test -- --runInBand projectBoard.integration tasks.board.test
  tasks.workflowGraph tasks.workflowLifecycle.routes --silent`:
  **4 suites, 64 tests pass**, including **9 real-PG board tests**.
- Server: `npm test -- --runInBand webOnly routes.snapshot --silent`:
  **2 suites, 35 tests and 1 snapshot pass**.
- Server: `npm test -- --runInBand sprints.routes -t
  'GET /api/sprints/:id/board' --silent`: **5 tests pass**.
- Server `npm run typecheck`: pass.
- Client: focused `projectBoard`, `sprintBoard`, `planningTabsByProject` and
  `useSprintBoardActions`: **4 files, 17 tests pass**.
- Client `npm run typecheck`: pass.
- Root `npm run contracts:validate`: pass, **87 contract tests**; generated
  inventory includes 536 endpoints and 274 OpenAPI operations.
- Root `npm run check:guardrails`: pass. `git diff --check`: pass.
- Editor diagnostics: no errors on the new board/write services, route and UI.

An earlier broader `sprints.routes` run had **10 failing non-board legacy
sequential-mock cases** (creation/current/delete/retiming/conflict expectations);
this is not claimed as a clean full-suite run. The five relevant board-route
cases pass independently. No unrelated legacy sprint behavior was rewritten.
Shared PG transient connection stalls were retried only after responsiveness
returned; the final PG run passed and cleaned its disposable database.

## Handoff

Android remains the next ticket03 slice; do not mark the combined ticket done.
Migration0031 is reserved by ticket06. Ticket05 owns shared Scrum sprint-end
card display. Ticket11 destructive compatibility removal is untouched.
No push, integration merge into the integration branch, release or production
operation was performed. Before handoff, the latest local integration ref is
merged into this branch (already-current is a valid merge result).

# 07: Show subtasks across planning and effort totals

**What to build:** Subtasks stay with their parent in planning and project moves, remain visible in project views, and contribute to parent effort totals without double-counting story points.

**Blocked by:** 03: Kanban board and backlog; 04: Task list views and calendar; 05: Scrum planning without Scheduled or auto sprints; 06: Enforce ticket hierarchy and create subtasks.

**Status:** resolved (platform + web; Android deferred)

- [x] Moving a parent between backlog and sprints moves all its subtasks in the same transaction, with history for each placement; direct subtask placement remains refused.
- [x] Moving a parent to another project also moves its subtasks, gives each a new ticket key and preserves each old key as an alias.
- [x] Backlogs and sprint plans nest subtasks under parents; boards show subtasks as cards labelled with the parent's key.
- [x] Parent ticket detail shows its own time and remaining estimate alongside totals including non-deleted subtasks.
- [x] Subtask detail shows the number of subtasks and the done count where applicable; subtask time is reflected in the parent totals.
- [x] Subtasks cannot carry story points; sprint points, velocity, capacity, baselines and burndown exclude them.
- [x] Tests cover nested views, placement and project moves, effort totals and sprint metrics across project types.

## Answer

Implemented on `ticket/project-types-07`, including integration tip `637c6e68`
(ticket08). The existing carryover decision rule is unchanged; completion now
places whole parents through the current hierarchy-aware placement seam, preserving
individual history and the returned count of all moved family members.

Shared hierarchy reads drive transactional family placement/project moves and
batched nested backlog reads. Each project-moved member receives its own state
mapping, new key and old-key alias. Trigger-induced child-history failures prove
the entire family rolls back. Canonical start/due dates remain unchanged.

Web/desktop nests planning families, keeps board cards independently visible with
parent keys, exposes done/total subtask counts and separates own from aggregate
spent/remaining effort. Live worklogs exclude soft-deleted work. Subtask point
writes are refused, including zero; shared metric filtering excludes legacy
subtask/epic points without removing child cards from WIP or carryover membership.
No database migration, schedule/timer redesign or Android change was required.

### Verification

- 62 focused server tests passed across baseline, collection, hierarchy reads,
  placement/routes, sprint repository/lifecycle and completion locking.
- 21 real PostgreSQL HTTP tests passed against an isolated database created from
  the authorized disposable URL. Coverage includes all project types, nested
  backlogs/board parent keys, independent state mapping and aliases, individual
  history, rollback, live/deleted effort, baseline/capacity/burndown/velocity,
  preview point totals and ticket08 whole-parent completion.
- 99 web tests passed across 11 suites (single worker, 20-second test timeout
  for shared-machine contention), including nested backlog/sprint plans, cards,
  detail refresh/navigation, worklogs, estimates and reorder regressions.
- Both TypeScript checks, dependency layering, 90 contract tests, generated
  contract/model freshness, root guardrails and whitespace checks passed.
- Legacy `sprints.routes.test.ts` has nine 404-versus-expected failures reproduced
  on the unchanged starting integration tip. Exploratory older project-board/
  planning PG suites also had five population expectations fail; these were not
  changed. The compatibility placement PG retry passed 50 tests with three
  failures in older sprint-due-date/pre-sprint-date and backlog-order expectations;
  canonical ticket02 dates and existing ordering were intentionally preserved.
  A preceding broader rerun lost its disposable connection (`ETIMEDOUT`); the
  final focused 21-test PG acceptance rerun passed.

Android remains a separate requested follow-up. No integration merge-back, push,
release or production operation was performed.

# 06: Enforce ticket hierarchy and create subtasks

**What to build:** Members can create subtasks from stories, tasks or bugs, and every ticket follows the fixed Epic → Story/Task/Bug → Subtask hierarchy across edits and project moves.

**Blocked by:** 01: Project type controls and lifecycle.

**Status:** resolved (platform + web)

- [x] Each organization has one seeded Subtask work item type that cannot be deleted.
- [x] A Subtask is created from a Story, Task or Bug and inherits its parent's project and sprint.
- [x] The server enforces valid parent and child types, same-project subtasks, no children under subtasks and no parent for epics on create, parent changes, type changes and project moves.
- [x] Invalid hierarchy changes are refused with `INVALID_HIERARCHY` and a message that identifies the violated rule.
- [x] Subtasks cannot be placed in a sprint or moved between projects independently; the server returns `SUBTASK_FOLLOWS_PARENT`.
- [x] Ticket detail shows the parent relationship and lets members add and open subtasks.
- [x] Migration repairs legacy parent links according to the hierarchy rules, records each repair for review, and is safe to rerun.

## Platform evidence

Implementation: `073bf2f2` on `ticket/project-types-06`; integration ticket03
is merged before handoff. Migration `0031_ticket_hierarchy.sql` follows ticket03's
`0030_project_board_settings.sql` without changing ticket05's planned `0032`.

TDD began with failing PostgreSQL HTTP, migration and contract tests, then added
the smallest hierarchy service/repository and detail UI to make them pass.
Focused pre-merge verification: 48 server tests, 3 detail UI tests, 88 contract
tests, both typechecks, dependency layering and mandatory guardrails passed.
Post-merge verification also covers ticket03's board HTTP/UI seams and preserves
its transactional lifecycle/WIP guard alongside hierarchy enforcement.

Repairs retain before/after snapshots in `task_hierarchy_repairs`, write system
history, and use an idempotent backfill marker. Existing/new organization
seeding, valid inheritance, access-filtered relationships, protected type edits,
parent/type transitions and independent placement/project denials are covered.
Ticket07 cascading moves, nesting, rollups and point-metric changes remain out
of scope. A parent move that would strand subtasks is refused pending ticket07.

# 06: Enforce ticket hierarchy and create subtasks

**What to build:** Members can create subtasks from stories, tasks or bugs, and every ticket follows the fixed Epic → Story/Task/Bug → Subtask hierarchy across edits and project moves.

**Blocked by:** 01: Project type controls and lifecycle.

**Status:** ready-for-agent

- [ ] Each organization has one seeded Subtask work item type that cannot be deleted.
- [ ] A Subtask is created from a Story, Task or Bug and inherits its parent's project and sprint.
- [ ] The server enforces valid parent and child types, same-project subtasks, no children under subtasks and no parent for epics on create, parent changes, type changes and project moves.
- [ ] Invalid hierarchy changes are refused with `INVALID_HIERARCHY` and a message that identifies the violated rule.
- [ ] Subtasks cannot be placed in a sprint or moved between projects independently; the server returns `SUBTASK_FOLLOWS_PARENT`.
- [ ] Ticket detail shows the parent relationship and lets members add and open subtasks.
- [ ] Migration repairs legacy parent links according to the hierarchy rules, records each repair for review, and is safe to rerun.

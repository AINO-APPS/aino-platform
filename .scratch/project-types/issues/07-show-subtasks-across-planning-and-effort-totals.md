# 07: Show subtasks across planning and effort totals

**What to build:** Subtasks stay with their parent in planning and project moves, remain visible in project views, and contribute to parent effort totals without double-counting story points.

**Blocked by:** 03: Kanban board and backlog; 04: Task list views and calendar; 05: Scrum planning without Scheduled or auto sprints; 06: Enforce ticket hierarchy and create subtasks.

**Status:** ready-for-agent

- [ ] Moving a parent between backlog and sprints moves all its subtasks in the same transaction, with history for each placement; direct subtask placement remains refused.
- [ ] Moving a parent to another project also moves its subtasks, gives each a new ticket key and preserves each old key as an alias.
- [ ] Backlogs and sprint plans nest subtasks under parents; boards show subtasks as cards labelled with the parent's key.
- [ ] Parent ticket detail shows its own time and remaining estimate alongside totals including non-deleted subtasks.
- [ ] Subtask detail shows the number of subtasks and the done count where applicable; subtask time is reflected in the parent totals.
- [ ] Subtasks cannot carry story points; sprint points, velocity, capacity, baselines and burndown exclude them.
- [ ] Tests cover nested views, placement and project moves, effort totals and sprint metrics across project types.

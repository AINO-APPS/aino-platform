# 11: Issue key canonical

**What to build:** A task is referenceable as PROJ-123 everywhere: on every card and row, in search, in URLs and in comments. Copying a key is one action. Searching a key jumps straight to the task.

**Blocked by:** 05

**Status:** done

- [x] Every card and row shows the key
- [x] Searching a key returns the task as the first result
- [x] The key is copyable in one action
- [x] Task URLs resolve from a key
- [x] Keys remain stable when a task moves between sprints

## Comments

**2026-10-25 — implemented**

- Commit `136213af`. `PROJ-123` is shown on every card and row, copyable in one action via `IssueKey`, searchable (the task search ranks an exact key match first) and resolvable in URLs. Keys come from `projects.next_task_number`, so moving a task between sprints cannot change one.

# 02: Task-collection query module

**What to build:** A prefactor: the three places that build a set of tasks (backlog, board, schedule) share one collection builder, so their filter, ordering and completed rules cannot diverge. Behaviour is unchanged. This makes the completed rule trustworthy in every view instead of being re-derived three times.

**Blocked by:** None (can start immediately)

**Status:** done

- [x] Backlog, board and schedule all obtain their task sets through the one module
- [x] Existing endpoint responses are byte-identical to before the refactor
- [x] The completed rule exists in exactly one place
- [x] A test proves the three callers cannot produce different results for the same filter input

## Comments

**2026-10-25 — implemented**

- Commit `d205a2c3`. One `buildTaskCollection` in `server/modules/tasks/tasks.collection.ts` backs backlog, board and schedule, so the completed rule exists in exactly one place. `server/__tests__/tasks.completedBacklog.test.ts` pins the composition; the three callers take their filters through the same input shape.

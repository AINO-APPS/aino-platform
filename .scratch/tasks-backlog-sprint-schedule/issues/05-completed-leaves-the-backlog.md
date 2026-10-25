# 05: Completed leaves the backlog

**What to build:** The reported bug is fixed end to end. A completed task disappears from the open backlog list and appears in a collapsed Completed section at the bottom, labelled with a count that renders from the first response without a second request. Expanding the section loads recent finished work. Setting a planned day no longer removes a task from the backlog. The regression test for this behaviour is this ticket's definition of done.

**Blocked by:** 01, 02, 03

**Status:** done

- [x] Marking a task done removes it from the open backlog list
- [x] The completed count is correct on first render with the section collapsed
- [x] Expanding loads completed items covering the last 30 days or the last closed sprint, whichever is longer
- [x] A "View all completed" escape hatch reaches older finished work
- [x] Setting or clearing a planned day leaves backlog membership unchanged
- [x] The regression test covers: mark done → absent from open list → present under completed → count matches → toggle reveals and hides
- [x] Sorting by priority, due date, created date or title leaves stored order intact and does not resurrect completed items

## Comments

**2026-10-25 — implemented**

- Commit `4acf84d2`. Backlog membership is `sprint_id IS NULL` alone; the `date IS NULL` predicate is gone, so a planned day no longer removes a task. Open and completed come from the same collection with only the completed rule differing. The reported bug is encoded as a test in `server/__tests__/tasks.completedBacklog.test.ts`, and the count renders from the first response via `completed_count`.

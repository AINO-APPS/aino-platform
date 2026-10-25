# 10: Backlog bulk actions

**What to build:** Several backlog tasks can be selected and acted on at once: move to sprint, change status, assign, or delete. The selection is obvious, clearing it is one action, and a bulk change is undoable as a single step.

**Blocked by:** 09

**Status:** done

- [x] Multi-select works with mouse, touch and keyboard
- [x] Bulk move to sprint, status change, assign and delete all succeed
- [x] A selection bar shows the count and clears in one action
- [x] The action applies to exactly the selected set and nothing else
- [x] One undo reverses an entire bulk action
- [x] Selection survives reordering but clears on navigation

## Comments

**2026-10-25 — implemented**

- Commit `6222d861`. `POST /api/tasks/bulk` applies move-to-sprint, status, assign and delete to exactly the selected set and reports what changed so one undo reverses the whole batch. `useBulkSelection` works with mouse, touch and keyboard; the selection bar shows the count and clears in one action, and selection survives reordering but clears on navigation.

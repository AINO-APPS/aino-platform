# 12: Accessible board drag

**What to build:** The board is draggable by mouse, touch and keyboard through the same accessible mechanism as the backlog. Columns come from the organisation's workflow states. Work-in-progress limits warn without blocking. Marking work done with open blockers or unchecked acceptance criteria warns and allows override. Done columns always remain visible.

**Blocked by:** 08

**Status:** done

- [x] Columns reflect the organisation's configured workflow states and their order
- [x] Dragging works with mouse, touch and keyboard, with results announced
- [x] Exceeding a WIP limit warns and still permits the drop
- [x] Entering a done state with open blockers or unchecked acceptance criteria warns and permits "mark done anyway"
- [x] Done columns are always visible on the board
- [x] Completed cards in non-terminal columns obey the show-completed preference
- [x] A dropped card reaches a done state whose completion is recorded by the database, never by the client

## Comments

**2026-10-25 — implemented**

- Commit `3cd03f49`. Columns come from the org workflow states ordered by `sort_order` and filtered to `is_active`. `useBoardDrag` gives mouse, touch and keyboard drag with announced results. WIP limits warn without blocking, entering a done state with open blockers or unchecked acceptance criteria warns with "mark done anyway", and done columns never hide. `completed_at` is written by the database trigger, never by the client.

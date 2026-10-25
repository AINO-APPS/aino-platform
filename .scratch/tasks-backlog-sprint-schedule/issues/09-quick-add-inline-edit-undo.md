# 09: Quick-add, inline edit, undo

**What to build:** Capture and triage stop requiring a modal. Typing a title at the top of the backlog creates a task and keeps focus for the next one. Title, points, assignee and sprint are editable in the row. Every move or delete is reversible from a toast that stays long enough to catch a mistake.

**Blocked by:** 07

**Status:** done

- [x] Quick-add creates a task and retains focus for consecutive entry
- [x] Title, points, assignee and sprint are editable inline without opening the detail view
- [x] Every destructive or moving action produces an undo affordance
- [x] Undo restores the exact prior state, including position
- [x] The undo affordance is reachable and operable by keyboard

## Comments

**2026-10-25 — implemented**

- Commit `2da0f153`. `QuickAdd` creates on Enter and keeps focus for the next item; title, points, assignee and sprint edit inline without the modal. `useUndo` gives every destructive or moving action a 10-second undo that restores the exact prior state including position, and is operable by keyboard.

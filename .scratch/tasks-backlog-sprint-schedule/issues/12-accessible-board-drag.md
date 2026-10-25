# 12: Accessible board drag

**What to build:** The board is draggable by mouse, touch and keyboard through the same accessible mechanism as the backlog. Columns come from the organisation's workflow states. Work-in-progress limits warn without blocking. Marking work done with open blockers or unchecked acceptance criteria warns and allows override. Done columns always remain visible.

**Blocked by:** 08

**Status:** ready-for-agent

- [ ] Columns reflect the organisation's configured workflow states and their order
- [ ] Dragging works with mouse, touch and keyboard, with results announced
- [ ] Exceeding a WIP limit warns and still permits the drop
- [ ] Entering a done state with open blockers or unchecked acceptance criteria warns and permits "mark done anyway"
- [ ] Done columns are always visible on the board
- [ ] Completed cards in non-terminal columns obey the show-completed preference
- [ ] A dropped card reaches a done state whose completion is recorded by the database, never by the client

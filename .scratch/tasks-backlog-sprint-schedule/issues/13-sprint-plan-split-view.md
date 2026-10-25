# 13: Sprint Plan split view

**What to build:** A planning surface where the backlog and one sprint are visible side by side. Dragging pulls work into the sprint or pushes it back out. The sprint goal is visible and editable inline, committed points sit against the sprint's size, recent velocity is visible, and a mini burndown shows the trend without leaving the page.

**Blocked by:** 12

**Status:** done

- [x] Backlog and sprint are visible simultaneously
- [x] Dragging in either direction moves the task and updates both lists
- [x] The goal is visible and editable inline
- [x] Committed points and the sprint's size are shown together
- [x] Recent velocity is shown while planning
- [x] A mini burndown renders from existing snapshot data
- [x] Moving a task into the sprint removes it from the backlog immediately and survives reload

## Comments

**2026-10-25 — implemented**

- Commit `aacf756a`. `SprintPlan` shows the ranked backlog and one sprint side by side with two-way drag that updates both lists immediately. The goal edits inline, committed points sit against the sprint size, recent velocity is shown while planning, and a mini-burndown renders from the existing snapshot data.

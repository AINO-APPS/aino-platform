# 18: Schedule calendar and tray

**What to build:** The schedule becomes a calendar with month and week views and an unscheduled tray of backlog work. Dragging a task onto a day plans it; dragging it back unschedules it. Each day shows its count and point total so overload is visible. Overdue work is pinned above the calendar. The existing day-grouped list remains available.

**Blocked by:** 05, 08

**Status:** done

- [x] Month and week views render planned tasks on their days
- [x] The unscheduled tray lists backlog tasks without a planned date, ranked
- [x] Dragging from tray to day sets the planned date; dragging back clears it
- [x] Each day shows task count and total points
- [x] Overdue tasks appear in a pinned strip, not inside past days
- [x] The previous grouped list remains selectable
- [x] Placing a task on a day does not remove it from the backlog

## Comments

**2026-10-25 — implemented**

- Commit `f2f2f985`. `ScheduleCalendar` renders month and week views plus the unscheduled tray of ranked backlog items without a planned date; dragging between tray and day sets or clears `planned_date`. Each day shows its task count and point total, overdue work sits in a pinned strip above the calendar, and the previous grouped list remains selectable. Placing a task on a day never removes it from the backlog.

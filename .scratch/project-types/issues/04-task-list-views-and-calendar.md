# 04: Task list views and calendar

**What to build:** Task list members can view and plan project tickets in a sortable list, a workflow board and a date calendar; Android provides a date-grouped upcoming view.

**Blocked by:** 01: Project type controls and lifecycle; 02: Start dates without Scheduled placement; 03: Kanban board and backlog.

**Status:** ready-for-agent

- [ ] Task list projects provide List, Board and Calendar views, while Kanban and Scrum retain their own type-specific views.
- [ ] The list can sort and filter by key, title, type, status, assignee, priority, start date and due date.
- [ ] The calendar shows open tickets across the inclusive start-to-due span; a ticket with one date appears on that date, and an undated ticket appears in a separate list.
- [ ] Calendar drag actions update ticket dates and refuse a due date before the start date.
- [ ] Leave, holiday and meeting overlays are shown on the calendar.
- [ ] Android provides an upcoming view grouped by start date with overdue work first; calendar remains web-only.
- [ ] Tests verify the date-range behavior, filters, date edits and project scoping through the public reads and client interactions.

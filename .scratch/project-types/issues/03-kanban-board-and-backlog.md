# 03: Kanban board and backlog

**What to build:** Kanban members can work all open project tickets on a continuous board, with project-scoped WIP limits and an optional backlog that is off by default.

**Blocked by:** 01: Project type controls and lifecycle.

**Status:** resolved (platform + web); Android slice pending

- [x] The project board returns Kanban tickets by workflow state, excluding Cancelled tickets and showing Done tickets only for the 14-day window.
- [x] Project admins can enable or disable the Kanban backlog; when enabled, initial-state tickets appear in the backlog instead of a board column.
- [x] WIP limits can be enabled per project and configured per workflow state; board columns show occupancy and limits.
- [x] A move into a full column is refused with `WIP_EXCEEDED` and the current count and limit, scoped to that project's board.
- [x] Kanban projects expose no sprint actions, and sprint operations are refused with `PROJECT_HAS_NO_SPRINTS`.
- [ ] Web and Android provide the Kanban board and optional backlog using server-provided capabilities and project settings.
- [x] Migration copies the existing organization WIP setting to projects, and tests cover board scope, backlog modes and WIP enforcement.

Web is complete; the combined Web/Android checkbox remains open for Android.
See [platform evidence](../evidence-03-platform.md). Ticket05 owns the shared
Scrum card sprint-end chip; ticket11 compatibility removal is untouched.

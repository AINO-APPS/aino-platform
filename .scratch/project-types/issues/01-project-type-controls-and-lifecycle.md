# 01: Project type controls and lifecycle

**What to build:** Members can create a Scrum, Kanban or Task list project, and project admins can see and change its type. The server enforces which types the organization may create and prevents a type change that would strand sprints.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] Project creation and project settings expose the project's type and the types available to the organization.
- [ ] Without the `agile` feature, new projects and type changes are limited to Task list; existing Scrum and Kanban projects continue to work.
- [ ] Project admins can change a project's type, except that leaving Scrum is refused while it has a planned, active or paused sprint.
- [ ] Project responses include the Plan tabs and type-related capabilities needed by clients; clients render the server's decision.
- [ ] Tests cover type creation and changes, feature restrictions, permissions and open-sprint refusal through project behavior.

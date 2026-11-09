# 09: Report client versions and handle upgrades

**What to build:** Current Android, desktop and web clients identify their versions, and operators can observe adoption before enabling enforcement; clients present an appropriate update action if the server responds with `426`.

**Blocked by:** 03: Kanban board and backlog; 04: Task list views and calendar; 05: Scrum planning without Scheduled or auto sprints; 07: Show subtasks across planning and effort totals; 08: Complete sprints with one carryover rule; Phase 2 ticket 13 (Android project-scope release).

**Status:** ready-for-agent

- [ ] Android, desktop and web requests identify client class and version; desktop forwards its bundled web version.
- [ ] The platform-wide gate supports off and report modes; report mode records observed client versions without blocking requests.
- [ ] Platform admins can view distinct users by client class and version over the previous 30 days.
- [ ] A public version read exposes the current mode and minimum versions and remains available to update flows.
- [ ] Android and web show a blocking update-required or reload experience on `426`; desktop starts its updater and requests a restart.
- [ ] Unrecognized browsers and integrations are not blocked, and requests from recognized clients without a version are reported as version zero.
- [ ] The Android and desktop releases stop using the Scheduled, timer and team-scope paths that are retired in ticket 11.

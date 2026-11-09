# 11: Remove legacy planning and team compatibility

**What to build:** After current clients are enforced and every organization has switched to project ownership, the product and schema no longer carry Scheduled, timer or team-owned planning compatibility.

**Blocked by:** 02: Start dates without Scheduled placement; 03: Kanban board and backlog; 04: Task list views and calendar; 05: Scrum planning without Scheduled or auto sprints; 06: Enforce ticket hierarchy and create subtasks; 07: Show subtasks across planning and effort totals; 08: Complete sprints with one carryover rule; 10: Enforce minimum client versions; Phase 2 ticket 13 (Android project-scope release); project-ownership switch-over completed for every organization.

**Status:** ready-for-agent

- [ ] Removal is refused until the version gate is enforcing the step B client minimums and all organizations have switched to project ownership.
- [ ] Scheduled, schedule/unschedule, carry-forward, ticket timer, team sprint-config and team-transfer endpoints are removed.
- [ ] Legacy team-scope parameters and response fields, `issue_key`, `planned_date`, and stored logged/estimated-minute aliases are removed.
- [ ] Planned-day, pre-sprint due-date, ticket/sprint team, timer, automatic-sprint and team sprint-mode storage is removed after data has been migrated.
- [ ] The project-ownership flag-off path and emergency switch-back are removed; project ownership is unconditional.
- [ ] Contracts, Android endpoint coverage, parity records, documentation and guardrails describe only the supported API.
- [ ] Contract tests verify removed endpoints and fields are absent, and a migration test verifies retained project-owned data.

# 05: Scrum planning without Scheduled or auto sprints

**What to build:** Scrum members have stable Backlog, Sprint and Reports tabs. Sprint membership no longer changes due dates, and automatic sprints and Scheduled planning stop while older clients retain temporary compatibility.

**Blocked by:** 01: Project type controls and lifecycle; 02: Start dates without Scheduled placement.

**Status:** resolved (platform + web)

- [x] Scrum projects keep Backlog, Sprint and Reports tabs whether or not a sprint is active; the empty Sprint state points members to the backlog.
- [x] Joining, leaving or changing a sprint's end date never changes a ticket's due date; the board shows the sprint end date beside the ticket due date.
- [x] Migration restores a saved due date only when the current due date still matches the sprint end date, records the restoration, and preserves hand-edited dates.
- [x] The hourly sprint scheduler and automatic sprint controls are removed; existing open automatic sprints are handled by the migration and completed automatic sprints remain available as history.
- [x] Projects whose sprint history is entirely automatic become Kanban projects with the backlog off.
- [x] The Scheduled screen and controls are removed from the current web client, while legacy Scheduled endpoints remain compatible until ticket 11. (Native client work is maintained separately and is outside this platform/web ticket.)
- [x] Placement tests verify unchanged due dates, and migration tests verify safe restoration and automatic-sprint conversion.

**Validation:** Client typecheck passed; 82 focused UI tests passed, with the remaining sprint-detail test passing in isolation. Server typecheck, contracts and guardrails passed. The ordered `0031_ticket_hierarchy.sql` + `0032_project_types_scrum_planning.sql` migration integration test passed against the disposable PostgreSQL test database, including safe due-date restoration, automatic-sprint retirement, hierarchy-aware backlog moves and repeat-application behavior. The client file-size ratchet passed. The server sprint-route suite retains 9 legacy project-type mock failures unrelated to this ticket.

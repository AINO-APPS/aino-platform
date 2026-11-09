# 05: Scrum planning without Scheduled or auto sprints

**What to build:** Scrum members have stable Backlog, Sprint and Reports tabs. Sprint membership no longer changes due dates, and automatic sprints and Scheduled planning stop while older clients retain temporary compatibility.

**Blocked by:** 01: Project type controls and lifecycle; 02: Start dates without Scheduled placement.

**Status:** ready-for-agent

- [ ] Scrum projects keep Backlog, Sprint and Reports tabs whether or not a sprint is active; the empty Sprint state points members to the backlog.
- [ ] Joining, leaving or changing a sprint's end date never changes a ticket's due date; the board shows the sprint end date beside the ticket due date.
- [ ] Migration restores a saved due date only when the current due date still matches the sprint end date, records the restoration, and preserves hand-edited dates.
- [ ] The hourly sprint scheduler and automatic sprint controls are removed; existing open automatic sprints are handled by the migration and completed automatic sprints remain available as history.
- [ ] Projects whose sprint history is entirely automatic become Kanban projects with the backlog off.
- [ ] The Scheduled screen and controls are removed from current web and Android clients, while legacy Scheduled endpoints remain compatible until ticket 11.
- [ ] Placement tests verify unchanged due dates, and migration tests verify safe restoration and automatic-sprint conversion.

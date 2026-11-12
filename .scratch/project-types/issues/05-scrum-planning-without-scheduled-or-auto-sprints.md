# 05: Scrum planning without Scheduled or auto sprints

**What to build:** Scrum members have stable Backlog, Sprint and Reports tabs. Sprint membership no longer changes due dates, and automatic sprints and Scheduled planning stop while older clients retain temporary compatibility.

**Blocked by:** 01: Project type controls and lifecycle; 02: Start dates without Scheduled placement.

**Status:** resolved

- [x] Scrum projects keep Backlog, Sprint and Reports tabs whether or not a sprint is active; the empty Sprint state points members to the backlog.
- [x] Joining, leaving or changing a sprint's end date never changes a ticket's due date; the board shows the sprint end date beside the ticket due date.
- [x] Migration restores a saved due date only when the current due date still matches the sprint end date, records the restoration, and preserves hand-edited dates.
- [x] The hourly sprint scheduler and automatic sprint controls are removed; existing open automatic sprints are handled by the migration and completed automatic sprints remain available as history.
- [x] Projects whose sprint history is entirely automatic become Kanban projects with the backlog off.
- [x] Scheduled screens and controls are removed from current web and Android clients, while legacy Scheduled endpoints remain compatible until ticket 11.
- [x] Placement tests verify unchanged due dates, and migration tests verify safe restoration and automatic-sprint conversion.

**Validation:** Client typecheck passed; 82 focused UI tests passed, with the remaining sprint-detail test passing in isolation. Server typecheck, contracts and guardrails passed. The ordered `0031_ticket_hierarchy.sql` + `0032_project_types_scrum_planning.sql` migration integration test passed against the disposable PostgreSQL test database, including safe due-date restoration, automatic-sprint retirement, hierarchy-aware backlog moves and repeat-application behavior. The client file-size ratchet passed. The server sprint-route suite retains 9 legacy project-type mock failures unrelated to this ticket.

## Integration evidence

Merged `bdf8f91a67969f20356c6ce7d85a40bbd2cc7b14` into
`integration/project-types` with `--no-ff` as
`f1e327a4c5650d7bed020c76cc5c8b4be2da4f6b` on 2026-11-09.
The merge had no file conflicts; ticket06's migration0031 is unchanged and
ticket05's migration0032 is preserved verbatim. Both typechecks, contracts,
guardrails, dependency layering, 40 focused server tests, one route snapshot
and all 83 changed UI tests passed. No local PostgreSQL test service was
available during integration verification; 45 DB-gated tests skipped, so the
earlier disposable-PG migration result above is not a new integration run.
Legacy Scheduled compatibility remains; ticket11 is untouched.
See [integration verification](../evidence-05-platform.md) for commands and scope.

Android ticket05 is integrated on `integration/project-types`. Its focused run
passed 100 tests across 15 classes, including Scrum planning, Kanban wiring,
the inherited single-tab navigation correction and sprint completion. The
merged Android planning run passed 113 tests with zero failures.

## Comments

2026-11-12 closeout: ticket 09's green full source/release CI and ticket 10's
local 506-test PostgreSQL run across 24 suites with zero skips supersede the
earlier partial integration validation and fixture failures above. Historical
results are retained rather than relabeled as passing. All acceptance is
implemented; legacy server compatibility remains for guarded ticket 11.

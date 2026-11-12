# ADR-018: Project types replace the Scheduled container and automatic sprints

- **Status:** Accepted (supersedes ADR-015)
- **Date:** 2026-11-03
- **Related:** ADR-015, ADR-017

## Context

ADR-015 made sprint, Scheduled and backlog three mutually exclusive containers.
It also added due-date bookkeeping so a ticket's dates survive moving in and out
of sprints. Teams that don't run sprints were served two ways. One was the
day-based Scheduled bucket. The other was "continuous" mode, which creates and
rotates sprints automatically. The Sprint tab and the Scheduled tab replace each
other depending on whether a sprint is running, so the screen changes under
people. Organizations that don't use agile wanted an ordinary ticketing system,
not imitation sprints.

## Decision

Each project picks a **type** when it is created:

- **Scrum:** backlog, sprints, sprint board, sprint reports.
- **Kanban:** one continuous board, WIP limits, no sprints. The backlog is off by
  default and can be switched on per project.
- **Task list:** list, board and calendar views driven by **start date** and
  **due date**.

Sprints exist only in Scrum projects. Scrum's Backlog, Sprint and Reports tabs are
stable regardless of whether a current sprint exists; the empty Sprint view points
members to Backlog. The Scheduled container, `planned_date` as a container, and
automatic sprints (`sprint_mode = auto`) are retired. Dates are fields and never
decide where a ticket lives. Joining or leaving a sprint, moving between sprints,
and editing a sprint's end date never changes a ticket's due date. The sprint board
shows the sprint end date beside each ticket's own due date.

Migration 0032 restores `pre_sprint_due_date` only when the current due date still
equals the sprint end date, records that restoration in history, and preserves a
hand-edited due date. The legacy saved-date value is then cleared. Active and
paused automatic sprints are completed and their open tickets return to Backlog;
planned automatic sprints are removed after their tickets return to Backlog;
completed automatic sprints remain as history. A Scrum project whose sprint
history is entirely automatic becomes Kanban with Backlog disabled.

The hourly sprint scheduler and current web controls for scheduled planning,
carry-forward and automatic sprint configuration are removed. Ticket 11 removes
the remaining compatibility API and storage only through a guarded contraction:
the step-B client-version minimums must be enforced and every organization must
be verified as project-owned before any endpoint or column is contracted. Its
one-shot migration is not part of the automatic tenant migration sweep. The
expand migration resets existing team automatic-sprint settings to manual.

When a sprint completes, its unfinished tickets go to the selected rollover
target or the backlog. Project-type capabilities and ordered Plan tabs come from
the server; clients render that decision without deriving type rules.

### Project-type lifecycle

Project admins may change a non-archived project's type. Leaving Scrum is
refused with `PROJECT_HAS_OPEN_SPRINTS` while any sprint is planned, active or
paused; completed history is retained. The `agile` feature controls only creation
and change destinations (Task list only without it). Existing Scrum and Kanban
projects keep working after feature loss. Project responses carry ordered Plan
tabs and type capabilities; clients render that decision without deriving it.

## Alternatives considered

- **Keep the Scheduled container for teams without sprints.** Rejected because it
  produced the screen that changes under people, and because "planned" and "due"
  were two dates that both looked like deadlines.

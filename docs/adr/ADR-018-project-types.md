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

Sprints exist only in Scrum projects. The Scheduled container, `planned_date` as a
container, and automatic sprints (`sprint_mode = auto`) are removed. Dates are
fields and never decide where a ticket lives. Joining a sprint no longer changes a
ticket's due date. The board shows the sprint's end date beside it instead.

When a sprint completes, its unfinished tickets go to the next planned sprint, a
new sprint created during completion, or the backlog. The default is the next
planned sprint if one exists, otherwise the backlog, and the preview and the
server apply the same default. A parent counts as unfinished while any of its
subtasks is open, and subtasks always move with thei Tickets that are in a sprint
  get back the due date saved in `pre_sprint_due_date`, and that column and the
  re-timing of due dates (ADR-015, amended 2026-11-01) are removed.
- The sprint scheduler is removed.
- Android has native Scheduled and timer screens, so the endpoints are removed in
  three steps. First, an Android release that no longer uses them. Then a
  minimum-client-version gate, where the server answers `426` to builds that are
  too old. Only then are the endpoint

- The `agile` feature flag stops gating the tasks area. It may still decide which
  project types an organization can create.
- `tasks.collection.ts` and `tasks.placement.ts` shrink to sprint ⇄ backlog moves.
- Existing `planned_date` values become start dates.
- What happens to `pre_sprint_due_date` is still open.
- The sprint scheduler is removed.

## Alternatives considered

- **Keep the Scheduled container for teams without sprints.** Rejected because it
  produced the screen that changes under people, and because "planned" and "due"
  were two dates that both looked like deadlines.

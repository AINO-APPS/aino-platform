# ADR-015 — Three exclusive planning containers (sprint, Scheduled, backlog)

- **Status:** Accepted (supersedes D1/D2 of `docs/TASKS_DESIGN_SPEC.md`);
  amended 2026-10-29 — a due date is metadata, only a planned day is a container
- **Date:** 2026-10-28

## Context

D1 treated the sprint as the only container: a ticket was "in a sprint, or in the
backlog", and a date was plain metadata. In practice the Scheduled view showed
dated work beside the backlog, so the same ticket appeared in both, and a ticket
in a sprint could also appear in Scheduled. Owners kept asking where a ticket
"lives" and getting two answers.

## Decision

Three containers, mutually exclusive, decided in the server query builder
(`modules/tasks/tasks.collection.ts`) so web, desktop and mobile cannot drift:

| Container | Predicate |
|-----------|-----------|
| Sprint | `sprint_id = <sprint>` |
| Scheduled | `sprint_id IS NULL AND planned_date IS NOT NULL` |
| Backlog | `sprint_id IS NULL AND planned_date IS NULL` |

- A **sprint wins over a planned day**: a planned ticket in a sprint belongs only
  to that sprint.
- A **planned day wins over the backlog**: scheduling an unsprinted ticket onto a
  day moves it to Scheduled; "Back to backlog" (`PATCH /tasks/:id/unschedule`)
  clears the planned day so it returns.
- **A due date is only a deadline.** It is never a container: it sorts, it renders
  on the card, and it may be set from either surface without moving the ticket.
  The amendment: the first version of this ADR also moved due-dated tickets out
  of the backlog, so a ticket created from the Backlog with a deadline vanished
  from the list it was created in — and, on a sprint team whose Scheduled tab is
  hidden, into no surface at all.
- Joining a sprint overwrites `due_date` with the sprint's end date, so the
  ticket's own date is remembered in `pre_sprint_due_date` and restored when it
  leaves (see `LEAVE_SPRINT`). Without this every ticket that ever left a sprint
  would land in Scheduled at an old sprint's end date.
- Completed unsprinted tickets stay in the backlog's collapsed Completed
  section regardless of dates, and in Scheduled for 30 days after completion.
- The Board landing view needs an **active** sprint; with none the Sprint tab is
  hidden and the team works from Backlog and Scheduled. The Plan split view is a
  Backlog action, not the landing view.

## Consequences

- `GLOSSARY.md` "Backlog" and `TASKS_DESIGN_SPEC.md` D1/D2/§5.2 are amended by
  this ADR; older text that calls a date "metadata" is superseded.
- `GET /api/tasks/scheduled` exists (inventoried in `contracts/`).
- Any new list surface must obtain its set from the collection builder rather
  than re-deriving a container predicate.

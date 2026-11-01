# ADR-015 — Three exclusive planning containers (sprint, Scheduled, backlog)

- **Status:** Accepted (supersedes D1/D2 of `docs/TASKS_DESIGN_SPEC.md`);
  amended 2026-10-29 — a due date is metadata, only a planned day is a container;
  amended 2026-11-01 — sprint end-date moves re-time member due dates, and a
  ticket in a sprint cannot be given a new planned day
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

## Amendment 2026-11-01 — placement rules on the write path

The container rules above were enforced on reads but not on writes: bulk sprint
moves and sprint carry-over skipped the due-date rule, so carried tickets kept the
old sprint's end date and showed as overdue.

- **Every** entry into a sprint applies the due-date rule, including bulk moves and
  sprint → sprint carry-over. The remembered own due date survives sprint → sprint
  moves and is restored only when the ticket leaves sprints altogether.
- **Moving a sprint's end date re-times its tickets.** A member ticket whose due
  date still equals the old end date takes the new one; a due date edited by hand
  inside the sprint is left alone.
- **A ticket in a sprint cannot be given a new planned day.**
  `PATCH /tasks/:id/schedule` returns `409 IN_SPRINT`; `PUT /tasks/:id` ignores
  `planned_date` for a sprinted ticket. A planned day the ticket already had when
  it joined is kept (the sprint still wins) and takes effect again when it leaves.
- Every placement write — create, PUT, joining or leaving a sprint, bulk, schedule,
  unschedule, sprint completion, sprint deletion and team transfer — goes through
  one placement module (`modules/tasks/tasks.placement.ts`), which owns the
  completed-sprint freeze, history and audit in one transaction, and
  realtime/notifications after commit.

## Consequences

- `GLOSSARY.md` "Backlog" and `TASKS_DESIGN_SPEC.md` D1/D2/§5.2 are amended by
  this ADR; older text that calls a date "metadata" is superseded.
- `GET /api/tasks/scheduled` exists (inventoried in `contracts/`).
- Any new list surface must obtain its set from the collection builder rather
  than re-deriving a container predicate.

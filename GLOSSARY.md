# Glossary

The vocabulary used across the Tasks/Plan area. Storage names are noted where
they differ from user-facing terms. See `docs/adr/` for the decisions behind them.

## Ticket

A unit of work shown in the Plan area. Also called a task or work item in the
codebase; the database table is `tasks`. One ticket has one owner team, one
workflow state, and either one sprint or no sprint.

**Avoid:** using "issue" for anything other than an external tracker item.

## Team

An org unit that owns tickets and sprints. A user belongs to at most one team
(`users.team_id`). Membership is the boundary for reading and writing a team's
tickets.

## Team ownership

The rule that a ticket belongs to exactly one team (`tasks.team_id`), independent
of who created or was assigned it. Cross-team movement is an explicit admin
transfer. See [ADR-013](docs/adr/ADR-013-ticket-team-ownership.md).

## Workflow state

The single status of a ticket (`tasks.workflow_state_id`). Org-configurable,
seeded as New, In Progress, In Review, Done and Cancelled. Formerly `tasks.status`,
which no longer exists.

**Avoid:** "column" as a synonym for status.

## Category

A workflow state's reporting bucket: `open`, `in_progress`, `in_review` or
`done`. `completed_at` is derived from the `done` category by the database
trigger. Categories are what reporting and the completed filter mean.

## Transition

An allowed move from one workflow state to another, recorded in
`workflow_transitions` and enforced server-side. Not every pair is legal. See
[ADR-014](docs/adr/ADR-014-workflow-transition-enforcement.md).

## Backlog

The set of tickets with no sprint **and no date** (`sprint_id IS NULL AND
planned_date IS NULL AND due_date IS NULL`). Backlog is a view, not a workflow
state and not a board column. The three planning containers are mutually
exclusive: a sprint wins over a date, and a date wins over the backlog — a
ticket with a planned or due date and no sprint belongs to **Scheduled**, not
the backlog. Adding a date (or a sprint) moves the ticket out of the backlog.

**Avoid:** "Backlog" as the name of a status.

## Sprint

A time-boxed container owned by one team. A ticket is in at most one sprint. The
board shows exactly one sprint at a time. Sprint lifecycle: planned, active,
paused, completed.

## Board

The Kanban view of one sprint, with one column per active workflow state.
Backlog is not a column. Cancelled has no column.

## Column

A board lane representing exactly one workflow state. Columns do not mix states.

## Plan view

The split planning surface at `/tasks/sprint/:id/plan`: backlog on one side,
sprint on the other, with the sprint goal, capacity and burndown. Moving a ticket
between the panels changes sprint membership, not workflow state.

## Cancelled

A terminal workflow state distinct from Done. Reached only by cancellation (never
by `DELETE FROM tasks`), excluded from the board and open backlog, and
irreversible in the current model. Done must be reopened before it can be
cancelled.

## Unassigned

The admin-only bucket for legacy tickets whose owning team could not be
determined during backfill (`tasks.team_id IS NULL`). Not a team and not a state.

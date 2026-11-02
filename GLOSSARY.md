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

## Capability

What the current user may do to a ticket right now, given its workflow state,
container, team and the user's role. Decided by the server and sent with the
ticket; clients render it and never derive it.

**Avoid:** "permission" for the per-ticket answer (a permission is a role's
standing grant); calling the container or column WIP status a capability.

## Backlog

The set of tickets with no sprint **and no planned day** (`sprint_id IS NULL
AND planned_date IS NULL`). Backlog is a view, not a workflow state and not a
board column. The three planning containers are mutually exclusive: a sprint
wins over a planned day, and a planned day wins over the backlog — a ticket
planned onto a day and in no sprint belongs to **Scheduled**, not the backlog.
A **due date** is a deadline, not a container: it never moves a ticket out of
the backlog (ADR-015, amended 2026-10-29).

**Avoid:** "Backlog" as the name of a status.

## Planned day

The day a ticket is planned onto (`tasks.planned_date`). It is what puts an
unsprinted ticket in **Scheduled**. A ticket in a sprint keeps a planned day it
already had but cannot be given a new one.

**Avoid:** "scheduled date" or "date" when the due date might be meant.

## Due date

The ticket's deadline (`tasks.due_date`). Never a container. While a ticket is in
a sprint its due date is the sprint's end date; its own deadline is remembered
and given back when it leaves.

## Placement

Moving a ticket between the three planning containers (sprint, Scheduled,
backlog), together with the due-date bookkeeping that goes with it. A team
transfer that takes a ticket out of its sprint is also a placement.

**Avoid:** "assign" for sprint membership; assignment means the assignee.

## Sprint

A time-boxed container owned by one team. A ticket is in at most one sprint. The
board shows exactly one sprint at a time. Sprint lifecycle: planned, active,
paused, completed.

## Current sprint

The one sprint a team lands on: its active sprint, otherwise its paused sprint,
otherwise none. Planned and completed sprints are never current. Decided by the
server.

**Avoid:** "active sprint" when a paused sprint would also qualify.

## Scope baseline

What a sprint committed to when it started (`sprint_baselines`). Scope change
is the difference between the sprint's current tickets and the latest baseline,
worked out when it is read; moving a ticket does not record a new baseline.

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

# Glossary

The vocabulary used across the Tasks/Plan area. Storage names are noted where
they differ from user-facing terms. See `docs/adr/` for the decisions behind them.

## Project

The container that owns tickets: it gives them their ticket key, board, backlog,
workflow and visibility. Every ticket belongs to exactly one project. See
[ADR-017](docs/adr/ADR-017-projects-own-tickets.md).

## Project type

A stored project classification: `scrum`, `kanban` or `task_list`. Phase 2 records
the type; type-specific planning behaviour is deferred to Phase 3.

## Project role

A project grant to a user or team: **project admin** (settings, workflow and
members), **member** (create, edit, transition, plan, move and log work), or
**viewer** (read and comment). The highest applicable grant wins.

## Ticket

A unit of work owned by one project. Also called a task or work item in the
codebase; the database table is `tasks`. One ticket has one stored ticket key,
one workflow state, and either one sprint or no sprint.

**Avoid:** using "issue" for anything other than an external tracker item.

## Ticket key

A ticket's stored human-readable identifier: a project key and a number, such
as `PLT-123`. Unique within an org and never reused. `issue_key` remains a legacy
API field with the same value.

## Key alias

A former ticket key retained permanently after a project rename or ticket move.
It still resolves to the same ticket.

## Archived project

A read-only project hidden from create and move pickers. Its tickets and keys
remain readable, searchable and open for comments.

## Service Desk project

The active project chosen in org settings for Service Desk copies. `General` is
the fallback when no project is configured.

## Team

A group of people that can receive role grants on any number of projects.
Teams are never tied to one project and do not own tickets or sprints. Legacy
team ownership remains binding until an org enables `project_ownership`; see
[ADR-013](docs/adr/ADR-013-ticket-team-ownership.md).

## Workflow state

The single status of a ticket. Configurable per project, initially copied from
the organization's workflow template. Typical states are New, In Progress,
In Review, Done and Cancelled.

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
container, project role and archive state. Decided by the server and sent with the
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
backlog), together with the due-date bookkeeping that goes with it. A project
move that takes a ticket out of its source project's sprint is also a placement;
it replaces team transfer.

**Avoid:** "assign" for sprint membership; assignment means the assignee.

## Sprint

A time-boxed container owned by one project. While `project_ownership` is off,
the existing team-based visibility and placement rules remain in force. A
ticket is in at most one sprint. The board shows exactly one sprint at a time.
Sprint lifecycle: planned, active, paused, completed.

## Current sprint

The one sprint a project lands on: its active sprint, otherwise its paused sprint,
otherwise none. Planned and completed sprints are never current. Decided by the
server.

**Avoid:** "active sprint" when a paused sprint would also qualify.

## Scope baseline

What a sprint committed to when it started (`sprint_baselines`). Scope change
is the difference between the sprint's current tickets and the latest baseline,
worked out when it is read; moving a ticket does not record a new baseline.

## Board

The view of one project's sprint, with one column per active state in that
project's workflow. Backlog is not a column. Cancelled has no column.

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

## Worklog

A record of time spent on a ticket, attributed to the person who did the work
and the day worked. The person recording it may be a different authorized
person. Correcting or deleting an entry preserves its history.

## Timesheet

A person's worklogs collected over a period. It reports work already recorded;
it is not a ticket container or a separate time-entry source.

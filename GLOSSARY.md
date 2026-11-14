# Glossary

The vocabulary used across the Tasks/Plan area. Storage names are noted where
they differ from user-facing terms. See `docs/adr/` for the decisions behind them.
Current terminology follows ADR-017 to ADR-020.

## Project

The container that owns tickets: it gives them their ticket key, board, backlog
and workflow, and decides who may see them. Every ticket belongs to exactly one
project. See [ADR-017](docs/adr/ADR-017-projects-own-tickets.md).

**Avoid:** "team" for the owner of a ticket.

## Project type

How a project plans its work, chosen when it is created
([ADR-018](docs/adr/ADR-018-project-types.md)):

- **Scrum** — a backlog planned into sprints, with a sprint board and sprint reports.
- **Kanban** — one continuous board, no sprints.
- **Task list** — a plain ticketing project worked from a list, board or calendar
  by start and due dates; for teams that do not run agile.

**Avoid:** "scheduled tasks" for Task list projects; "agile project" for Kanban.

## Project role

What a person may do in one project: **project admin** (settings, workflow,
automation, members), **member** (create, edit, move, log work) or **viewer**
(read and comment). Granted to a user or to a whole team.

**Avoid:** "role" alone, which means the org-wide role (employee to super admin).

## Ticket

A unit of work, owned by one project. Also called a task or work item in the
codebase; the database table is `tasks`. One ticket has one ticket key, one
workflow state, and at most one sprint (only in Scrum projects).

**Avoid:** using "issue" for anything other than an external tracker item.

## Ticket hierarchy

Three fixed levels: **Epic** → Story, Task or Bug → **Subtask**. A subtask lives in
its parent's project and sprint and never moves on its own; its time counts
toward its parent.

**Avoid:** "child task" for a subtask; "parent" for an epic's relationship to its
stories (say "in the epic").

## Ticket key

A ticket's human-readable identifier: its project's key and a number, e.g.
`PLT-123`. Unique within the org and never reused.

**Avoid:** "issue key", "ticket number".

## Key alias

A ticket key the ticket used to have, before its project's key was renamed or the
ticket moved project. It still opens the ticket, forever.

## Archived project

A project closed to new work: read-only and hidden from pickers, with its tickets
and keys kept.

**Avoid:** "deleted project".

## Service Desk project

The project an org chooses to receive the copies of its Service Desk tickets.

## Team

A group of people. Teams can be given access to projects and assigned work in
them, but a team does not own tickets or sprints.

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
sprint, project and the user's role. Decided by the server and sent with the
ticket; clients render it and never derive it.

**Avoid:** "permission" for the per-ticket answer (a permission is a role's
standing grant); calling the container or column WIP status a capability.

## Backlog

The ordered list of a Scrum project's open tickets that are in no sprint. A
view, not a workflow state and not a board column. Dates never move a ticket in
or out of it.

**Avoid:** "Backlog" as the name of a status.

## Start date

The day work on a ticket is expected to begin. A field, never a container.

**Avoid:** "planned day" or using a date as a place a ticket lives.

## Due date

The ticket's deadline. Never a container, and never changed by joining or leaving
a sprint.

## Placement

Moving a ticket between a sprint and the backlog, or between sprints. A project
move that takes a ticket out of its sprint is also a placement. Placement never
changes start or due dates.

**Avoid:** "assign" for sprint membership; assignment means the assignee.

## Sprint

A time-boxed container owned by one Scrum project. A ticket is in at most one
sprint. The board shows exactly one sprint at a time. Sprint lifecycle: planned,
active, paused, completed.

## Current sprint

The one sprint a Scrum project lands on: its active sprint, otherwise its paused
sprint, otherwise none. Planned and completed sprints are never current. Decided
by the What a sprint committed to when it started (`sprint_baselines`). Scope change
is the difference between the sprint's current tickets and the latest baseline,
worked out when it is read; moving a ticket does not record a new baseline.

## Board

A project's column view of its open work: the selected sprint in a Scrum project,
or the project's open work in Kanban and Task list projects. One column per active
workflow state.
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

One entry of time someone spent on a ticket: the day worked, the time spent and
an optional comment. The only way time is recorded against a ticket. See
[ADR-019](docs/adr/ADR-019-manual-worklogs.md).

## Timesheet

People's worklogs laid out by day, for a period. A report, never an approval.

**Avoid:** "timer", "time entry" (attendance owns that term), "effort log".

## Time spent

The sum of a ticket's worklogs. Never entered directly.

**Avoid:** "logged minutes", "actual".

## Original estimate

How much time the ticket was expected to take before work began.

## Remaining estimate

How much time is still expected to be needed. By default each worklog reduces it
by its time spent; the person logging may set it instead or leave it alone.

**Avoid:** "remaining" as estimate minus time spent; the two can differ.

## Code reference

A branch, commit or pull request linked to a ticket because it mentions the
ticket key. Shown on the ticket's Development panel.

**Avoid:** "git ref" in user-facing text.

## Smart commit

A command in a commit message, after a ticket key, that acts on that ticket:
add a comment, log work or make a transition.

## Automation rule

A project setting that makes a transition when a code reference changes, e.g.
pull request opened moves the ticket to In Review.
determined during backfill (`tasks.team_id IS NULL`). Not a team and not a state.

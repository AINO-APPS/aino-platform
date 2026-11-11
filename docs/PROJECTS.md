# Projects and ticket ownership

[ADR-017](adr/ADR-017-projects-own-tickets.md) supersedes team ownership after
the per-organization switch-over. Every ticket has one project and a stored key,
including tickets created before switch-over. Projects own backlog, board,
sprints, workflow and visibility. Teams are groups of people: they may have
access to any number of projects, never an exclusive project owner.

## Access and settings

Creating a project requires **team lead or above** and a web session. The creator becomes project admin and may grant selected
teams member access. `/projects` exposes details, members, workflow, key rename
and archive according to the returned project capabilities.

Personal and team grants combine using the highest role:

| Role | Actions |
|---|---|
| Project admin | Member actions plus settings, grants, workflow, key rename and archive |
| Member | Create, edit, transition, plan, move and log work |
| Viewer | Read and comment |

Organization admins administer all projects. Reporters and assignees can read
and comment on their own tickets even without a project grant; that does not
give them write access to the project. Removing or demoting the final project
admin is refused.

Current web/desktop and Android clients require an active creatable project.
The create picker uses `GET /api/projects/mine`, preferring the current project
and then a valid remembered choice. Plan uses the accessible-project listing
(`GET /api/projects?include_archived=1`); archived projects remain readable.
Clients render server capabilities and denial reasons, not role guesses.

## Project types (ADR-018)

Creation and settings offer **Scrum**, **Kanban** and **Task list**, with a short
explanation of each. The switcher and project cards show the stored type.
Without `agile`, only Task list is offered for creation and type changes;
existing Scrum and Kanban projects keep working, including their sprint routes.

Project admins change type in **Edit project**. Leaving Scrum is refused while
any sprint is planned, active or paused (`PROJECT_HAS_OPEN_SPRINTS`). Completed
history does not block a change. Archived projects cannot change type. Settings
and type save together: a refusal leaves all settings unchanged.

Responses provide `planTabs`, `hasSprints`, `hasBacklog`, `availableTypes`,
`changeableTypes` and `capabilities.canChangeType`. `GET /api/projects/types`
supplies organization choices even before its first project exists. Clients
render the decisions, not a project-type lookup table. Scrum tabs remain
**Backlog, Sprint, Reports** without a current sprint; Kanban uses **Board**
(with **Backlog** when enabled); Task list uses **List, Board, Calendar**.
Service Desk remains separately accessible. Non-Scrum sprint requests are
refused with `PROJECT_HAS_NO_SPRINTS`.

Web/desktop Task list projects provide all three views. **List** shows every
project ticket, with a filter and sort for key, title, type, status, assignee,
priority, start date and due date. Dates do not determine list membership.
**Board** reuses the project-wide workflow board.

**Calendar** has **Month** and **Week** views. Week runs Monday to Sunday,
including weeks crossing month/year boundaries; arrows and Today retain the
selected view. Both show open tickets on every day of their inclusive start-to-due
span. A single date shows on that day; work with neither date stays in the
Undated side list. Drag a ticket to shift its dates together (the duration is
preserved), or drag undated work onto a day to set both dates. **Edit dates**
provides the same planning access without dragging, including clearing dates.
An earlier due date is refused. Viewers and archived projects stay read-only.
Approved leave, holidays and meetings provide independently toggled, read-only
context; none changes a ticket or its workflow.

Android's date-grouped upcoming view is a separate pending ticket04 slice;
the calendar is web-only. Integrated ticket05 removes Scheduled from the web
and retires automatic sprints. Compatibility endpoints remain until ticket11.

## Subtasks in planning

Backlogs and sprint plans nest subtasks under their parent. Move or rank the
parent, not individual subtasks: sprint/backlog placement moves the whole family
atomically, preserving dates and recording history for each ticket. Boards keep
subtasks as individual cards labelled with the parent's key.

Web/desktop and Android parent detail offer **Add subtask** whenever the server
allows it, including before the first subtask exists. A member can add a title;
the server assigns the Subtask type and inherits the parent's project and sprint.
Cancelled parents, archived projects and read-only roles cannot add subtasks.
Parent detail separates **own** time/remaining estimate from totals **including
subtasks**, and shows done/total subtask counts. Deleted worklogs do not contribute.
Subtask detail links back to the parent. Subtasks have no story points; sprint
capacity, baselines, burndown and velocity count ordinary parent points only.
These nested views and effort summaries also ship on Android.

## Keys, moves and archive

Keys are stored, organization-unique and never reused. A project admin previews
and confirms a project-key rename. Published old keys become permanent aliases;
renaming a generated unpublished key before switch-over creates no aliases.
`GET /api/tasks/by-key/:key` resolves current keys and aliases to the canonical
ticket and reports alias resolution. Search and code references also resolve
aliases; the web key URL redirects to the current key.

**Move to project** requires member access in both active projects. The client
previews `POST /api/tasks/:id/move-project/preview { project_id }`, then confirms
`POST /api/tasks/:id/move-project { project_id }`. Preview reserves no key.
Commit assigns a new key and aliases the old one, clears the source sprint,
restores the ticket's personal due date, retains its planned day, and maps the
workflow by active state key, then category, then the initial state. History
and audit commit atomically; realtime invalidation follows commit.
When the ticket has subtasks, the same transaction moves them all, independently
maps their workflow states and preserves every old key as an alias. A failure
leaves the entire family unchanged.

Archive makes a project read-only and removes it from create/move pickers;
reading, search, key lookup and comments remain available. Unarchive requires an
organization admin. Only a super admin may delete a project, and only if it
**never had tickets**, even if previous tickets have moved away. Keys remain
reserved after deletion.

## Migration review and switch-over

Migration creates one project per team plus `General`, grants team access,
assigns sprints and stored keys, copies workflows, and records cross-project
migration moves. Team-generated projects are Scrum when the team had a sprint,
otherwise Task list; this phase stores the type, not Phase 3 planning behavior.
The origin team is a compatibility mapping, not an ownership relationship.

1. A super admin opens **Review project migration** at `/projects`
   (`GET /api/projects/migration/review`).
2. Review generated keys, types, ticket counts, grants, migration moves and
   **Hierarchy repairs**; rename unpublished keys as needed. Hierarchy records
   show original before/after parent, type, project, sprint and points, alongside
   any later correction. They remain available after key renames or ticket removal.
3. **Switch to projects** (`POST /api/projects/migration/switch`) publishes keys,
   enables `project_ownership` and audits the one-time switch atomically.
   Repeated or concurrent switches return 409.

Until switch-over, team visibility/placement stays in force
([ADR-013](adr/ADR-013-ticket-team-ownership.md)); writes still populate project
and stored key. A platform admin alone can use
`POST /api/projects/migration/switch-back` for emergency team visibility.
This does not unpublish keys or permit a second initial publication.
Rollback restores team authorization, not old workflow state IDs: migrated
tickets continue using their project workflow; genuine legacy template states
retain their org graph.

Migration `0034_recover_hierarchy_leaves.sql` corrects eligible leaf links cleared
by `0031` using its stored snapshots, not guessed relationships. It seeds no new
ownership state and never rewrites an original repair or history row. Leaves
inherit the current parent's sprint and lose story points on conversion.
Missing evidence, cross-project links, non-leaves and subsequent human hierarchy/
placement/points edits are not overwritten. Such original repairs remain visible
for administrator review, including ambiguous historical sprint edits. Replays
do not repeat corrections.

Older clients retain `team_id`, `issue_key` (equal to `ticket_key`), team scope
parameters and `/tasks/:id/transfer` until the Phase 3 client-version gate.
Legacy team scope/transfer maps to the team's generated project, not every
project granted to that team. Project moves retain compatibility `team_id`.

Android ships project scope, required create, preview/confirm move, capability
gating and alias lookup. Project administration stays web-only. Desktop and the
iOS scoped webview inherit the web implementation.

See [Service Desk](SERVICE_DESK.md), the [module README](../server/modules/tasks/README.md)
and [contract/parity guidance](../contracts/README.md).

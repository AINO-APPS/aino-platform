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

Ticket 01 establishes type controls and the stable Plan shell. Continuous boards,
Task list view contents, start dates and removal of Scheduled/automatic sprints
ship in subsequent project-types tickets; those surfaces are not replaced here.

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
2. Review generated keys, types, ticket counts, grants and migration moves;
   rename unpublished keys as needed.
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

Older clients retain `team_id`, `issue_key` (equal to `ticket_key`), team scope
parameters and `/tasks/:id/transfer` until the Phase 3 client-version gate.
Legacy team scope/transfer maps to the team's generated project, not every
project granted to that team. Project moves retain compatibility `team_id`.

Android ships project scope, required create, preview/confirm move, capability
gating and alias lookup. Project administration stays web-only. Desktop and the
iOS scoped webview inherit the web implementation.

See [Service Desk](SERVICE_DESK.md), the [module README](../server/modules/tasks/README.md)
and [contract/parity guidance](../contracts/README.md).

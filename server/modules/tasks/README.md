# Tasks module

The service owns task-domain orchestration and the repository is the sole owner
of its SQL. Legacy task route adapters retain authentication, request parsing,
access checks, response serialization, and error compatibility.

## Project access (ADR-017)

`tasks.projectAccess.ts` resolves a request actor's effective project role,
accessible project IDs and role capabilities. Create one resolver per request;
its role memoization is request-local. Personal and team grants are combined
with the most permissive role taking precedence. Organization admins are
treated as project admins.

`tasks.projectAccessRepository.ts` owns SQL for project grants and project
creation. Member writes lock the project row and protect its final project
admin. Project creation grants the creator project-admin and any selected
teams member access in the same transaction.

`tasks.projectKey.ts` validates project-admin `canRenameKey` access and orchestrates
key preview/rename. `tasks.projectKeyRepository.ts` owns the SQL: project row
locking, permanent key reservations, stored ticket-key rewrites, published-key
aliases and one project audit entry all share a transaction. Preview only reads.
The projects route emits `project_updated` after commit; web project lists,
boards and open ticket details refetch rather than deriving keys from the event.
The tenant-wide frame carries only `project_id`; old/new keys and ticket counts
remain in the authorized HTTP response, not the broadcast.
Project creation also claims a unique reservation so competing creates/renames
cannot reuse an earlier key. Run `npm run test:pg -- projectsKeyRename.integration --runInBand`
from `server` for the PostgreSQL route coverage.
Web settings are available at `/projects` (More → Projects); organization-role
gates do not hide settings from project admins. The rename control itself uses
the server-returned `canRenameKey` capability.

## Migration review and publication

At `/projects`, **Review project migration** opens the super-admin review.
`GET /api/projects/migration/review` returns a consistent snapshot of generated
team/General projects, publication state, types, ticket counts, named grants,
and migration moves. `new_key` follows review renames; `migration_key` retains
the original migration target. Inline rename reuses the project-key endpoint.

`tasks.migration.ts` orchestrates review and switch-over; its repository owns SQL.
`POST /api/projects/migration/switch` requires exactly `super_admin`, locks the
organization, publishes every project key, enables `project_ownership`, stamps
the first publication time and inserts an audit entry in one transaction.
Concurrent/repeated switches return 409. A failed audit rolls everything back.
`POST /api/projects/migration/switch-back` requires exactly `platform_admin`,
disables project visibility and audits the emergency action without unpublishing
keys or clearing the first-publication timestamp. Initial publication cannot
be repeated after rollback. All three endpoints require web sessions and an
organization context; HR/project admins cannot administer this switch.

Migration `0023_project_ownership_switch.sql` adds the retained timestamp and
stamps already-enabled organizations. Run
`npm run test:pg -- projectsMigration --runInBand` for the HTTP/PostgreSQL seam.

With project ownership enabled, ticket decisions use project roles rather than
team membership. Viewers, reporters and assignees can comment; only members and
project admins can write. Project admins and org admins can log work for others.
An archived project refuses ticket writes with `PROJECT_ARCHIVED`, but reading,
key lookup, search and comments remain available. Unarchiving requires an org
admin. Deletion remains super-admin-only and refuses any project whose persistent
`has_had_tickets` bit is set, even after its tickets leave. Keys stay reserved.

Placement — any change to a ticket's sprint, planned day, or the due date that
follows sprint membership — goes through `tasks.placement.ts` (rules),
`tasks.placementRepository.ts` (SQL) and `tasks.placementEffects.ts` (realtime
and notifications). See ADR-015. `scripts/check-placement-writes.mjs` enforces it.

## Ticket decisions (ADR-016)

`tasks.capabilities.ts` exposes `loadTicketDecisionContext(db, actor, tickets)`,
`decideTickets(actor, tickets, context)` and `decideTicket(actor, ticket, context)`.
The batch result follows input order; each entry is `{ container, capabilities }`.
The single-ticket form returns the same decision for write-path callers.

Load context once for the whole request. It contains the org lifecycle, a
batch-loaded sprint lookup and, with legacy visibility enabled, a batch-loaded
creator-team lookup. Project mode also loads archived state and the actor's
effective project roles. Pass an already loaded lifecycle as the loader's
`{ lifecycle }` option to reuse it. Both decide forms are synchronous and perform
no database reads. SQL for the supplementary lookups lives in
`tasks.capabilitiesRepository.ts`.

The optional `{ targetSprintId }` loader option evaluates `placeInSprint` against
a specific destination, including access, freeze and team ownership. Without a
destination it describes the general placement action, not permission to enter
every sprint. A requested destination that is missing or inaccessible denies
access. Placement's exported `placementRefusal` shares its existing freeze,
ownership and in-sprint scheduling rules with decisions; the shared predicates
live in `tasks.placementRules.ts` to keep decision loading independent of writes.

Containers use sprint, then planned day, then backlog; deadlines never decide.
Transitions include every other active state. Cancelled is terminal even when
access or freeze would also refuse a move. Otherwise access precedes freeze,
then cancellation permission/completion and transition legality. `changeState`
requires an allowed transition. `delete` means cancellation, matching the
existing DELETE endpoint; tickets are never hard-deleted. WIP capacity is
deliberately excluded and remains a column/write-guard concern.

## Write guards

`tasks.writeGuards.ts` adapts a decision action to a conflict. Access refusals
and `READ_ONLY_ROLE` remain 403 (404 for another org); lifecycle, archived-project
and placement conflicts remain 409.
Guards and placement share capability denial text in `tasks.denialMessages.ts`.
Cancellation of completed work now uses `INVALID_TRANSITION`, and cancellation
or state changes on Cancelled tickets use `CANCELLED_TERMINAL`, matching the
decision rather than the former `TASK_COMPLETED`/graph-only codes. Read access
uses the edit decision's permission while still permitting reads of frozen work.

`assertLifecycleMove` takes the actor as its sixth argument and accepts a loaded
decision context as its seventh to reuse a request/batch lookup. It consults the
ticket's target transition, then enforces WIP as the final check. The graph and
context loader remain exported from `tasks.workflow.ts`; shared implementation
lives in `tasks.workflowRules.ts` so the decision module cannot depend on guards.

User placement contexts carry `ticketActor`; `placeTickets` and `transferTicket`
consult the corresponding decision against locked sprint rows before writing.
Sprint lifecycle maintenance deliberately has no ticket actor: it moves a whole
sprint's membership as a system operation, not as individual ticket edits.
Sprint-target adapters retain their existing 400 status for an invalid or
inaccessible destination; capability refusals carry the decision reason.

The PostgreSQL matrix checks every actor/state/container row against action and
transition guards, user scheduling, destination-specific placement and transfer.
HTTP integration tests preserve access, freeze and org-isolation status codes.
Response enrichment, contracts and client rendering remain separate rollout work.

Run `cd server; npm run test:pg -- tasks.capabilities.integration --runInBand`
with Docker, or set `TASKS_SCHEMA_TEST_DATABASE_URL` and run the suite with Jest.
It skips when that URL is unset.

## Notes ticket responses

`routes/notes/_helpers/tickets.ts` owns Notes' endpoint-specific ticket summaries
and embedded sprint stats. It retains the shared `enrichTaskSummaries` pipeline
for containers and capabilities; Notes routes keep their reads and error handling.
Linked-ticket lookups receive the actor's org from the route's loaded user
context; links to another organization's tickets return no details.
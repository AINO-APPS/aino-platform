# Tasks module

The service owns task-domain orchestration and the repository is the sole owner
of its SQL. Legacy task route adapters retain authentication, request parsing,
access checks, response serialization, and error compatibility.

Tickets belong to exactly one project with a stored key (ADR-017). Projects own
backlog, board, sprints, workflow and access; teams can hold grants in any number
of projects and never own a project. Creating a project requires team lead or
above, grants the creator project-admin and may grant teams member access.
User-facing guides: [Projects](../../../docs/PROJECTS.md) and
[Service Desk](../../../docs/SERVICE_DESK.md). ADR-013 describes only the
flag-off compatibility policy.

## Service Desk copies

`tasks.serviceDesk.ts` creates copies in the platform organization's configured
active Service Desk project, falling back only to General (not the creator's
team). The database allocates the project number and stored key atomically;
creation uses that project's active initial state. Cross-database copy failures
are logged without rejecting the customer submission.

`tasks.serviceDeskRepository.ts` maps source statuses directly to the project's
initial, first in-progress, or first non-cancelled Done state, ordered by
`sort_order, id`. Sync bypasses user transitions and never reopens Cancelled.
Each atomic update/history statement records a null user and `actor_type=system`.
Deleting the source cancels unfinished work, preserves Done, and records
`service_desk_deleted`; it never deletes the platform copy or its work history.

Run `npx jest serviceDeskProject serviceDesk.routes.characterization tasks.serviceDesk
--runInBand` with `TASKS_SCHEMA_TEST_DATABASE_URL` set for route PostgreSQL coverage.

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

When `organizations.project_ownership` is enabled, project lists include only
accessible projects (all for organization admins). Plan backlog, available
sprints and sprint lists accept `project_id`; legacy `team_id` resolves only
to the team's generated project, not all projects granted to the team.
The web Plan project selection also scopes agile configuration, so board
columns and ticket controls use that project's workflow after switching.
`tasks.sprintProjects.ts` adapts project scopes and sprint management rules.
Sprint lookup, lifecycle and placement locks use the project's organization;
`team_id` is nullable compatibility data and team deletion preserves sprints.
Flag-off requests retain team-scoped behavior and the team-deletion work guard.

The web Plan switcher remembers a project per tenant/user, hides Unassigned,
and narrows both backlog requests and sprint/board selection. `/api/profile`
exposes `project_ownership` to select this behavior independently of plan flags.
Run `npm run test:pg -- projectPlanning --runInBand` from `server` for the
project planning PostgreSQL route tests.

`GET /api/projects/mine` is the create-picker listing: only active projects with
the actor's `canCreateTickets` capability are returned. The web create form
requires one, preferring the current project and then the user's last successful
create project; archived and viewer-only defaults are discarded. No available
project leaves an explanatory empty picker and disables creation.

`tasks.ownership.ts` resolves create ownership from the explicit request, then
the sprint's project, then the legacy team project, then General. In project mode
every resolved destination must be active and writable by a member/project admin
(or org admin); an invalid or refused explicit project never falls back.
Create, edit, bulk and plan placement all refuse a sprint from another project
with `SPRINT_PROJECT_MISMATCH`. This replaces the legacy team mismatch code;
flag-off tenants retain their existing team-scoped placement rules.

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
project admins can write. Project admins can log, edit and delete other people's
worklogs only within their administered project, including team-derived grants.
Org admins retain on-behalf access throughout their organization. Worklog
`canEdit`/`canDelete` responses use the same project-role and archive context as
mutation guards; member/viewer grants never confer on-behalf administration.
Logging work and editing estimates also respect project read-only/archive guards.
An archived project refuses ticket writes with `PROJECT_ARCHIVED`, but reading,
key lookup, search and comments remain available. Unarchiving requires an org
admin. Deletion remains super-admin-only and refuses any project whose persistent
`has_had_tickets` bit is set, even after its tickets leave. Keys stay reserved.

Placement — any change to a ticket's sprint, planned day, or the due date that
follows sprint membership — goes through `tasks.placement.ts` (rules),
`tasks.placementRepository.ts` (SQL) and `tasks.placementEffects.ts` (realtime
and notifications). See ADR-015. `scripts/check-placement-writes.mjs` enforces it.

### Moving projects (ticket10)

`previewProjectMove` and `moveTicketProject` share source/target authorization,
archive checks and workflow mapping: active matching key, then first active
category ordered by `sort_order, id`, then initial state. Preview only reads and
returns `{ target_project_id, key_format, workflow_state, leaves_sprint }`; its
key format is not a reservation. The HTTP adapters are
`POST /api/tasks/:id/move-project/preview` and `POST /api/tasks/:id/move-project`,
both accepting `{ project_id }`. They require project ownership to be enabled.

The caller supplies one transaction. Placement locks serialize moves, project
share locks prevent concurrent archive/key changes, and effective personal plus
primary/secondary-team grants are checked on that transaction's connection.
Commit allocates a target sequence, aliases the old key with reason `move`,
maps state, and clears a source-project sprint using the ordinary sprint-exit
due-date rules. A planned day survives. History and audit share the transaction;
effects run only after commit. In project mode both projects' readers receive
a payload-free ticket invalidation so source-only readers do not learn the new
project's key/state. Legacy mode retains field deltas.

`canMoveProject` requires member or higher in an active source project; target
membership is checked by preview/commit. Project moves retain `team_id` for
emergency switch-back. Legacy `/transfer` keeps its envelope and uses the same
move operation against the target team's generated project; only flag-off
transfers update legacy team ownership. After switch-over a retained team ID
does not stop a transfer back into that team's generated project.

Run `npm run test:pg -- tasks.placementRoutes.integration --runInBand -t ticket10`
for move/preview, workflow mapping, permissions, rollback and legacy coverage.

## Ticket decisions (ADR-016)

`tasks.capabilities.ts` exposes `loadTicketDecisionContext(db, actor, tickets)`,
`decideTickets(actor, tickets, context)` and `decideTicket(actor, ticket, context)`.
The batch result follows input order; each entry is `{ container, capabilities }`.
The single-ticket form returns the same decision for write-path callers.

Load context once for the whole request. It contains project lifecycles, the
legacy org-template fallback, a batch-loaded sprint lookup and, with legacy visibility enabled, a batch-loaded
creator-team lookup. Project mode also loads archived state and the actor's
effective project roles. Pass an already loaded lifecycle as the loader's
`{ lifecycle }` option to reuse it. Both decide forms are synchronous and perform
no database reads. SQL for the supplementary lookups lives in
`tasks.capabilitiesRepository.ts`.
Flag-off authorization still evaluates migrated project state IDs against their
project graph; tickets retaining real legacy template state IDs use the org graph.

The optional `{ targetSprintId }` loader option evaluates `placeInSprint` against
a specific destination, including access, freeze and project ownership. Without a
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

## Manual worklogs (ADR-019)

Web/desktop and Android record ticket time only through manual worklogs; there is
no ticket Start/Stop UI. The attendance timer is unrelated and unchanged. Both
clients render server capabilities, author/logged-by attribution, inline original
and remaining estimates, all three remaining choices, and post-save warnings.
Deprecated server timer routes remain available for older-client compatibility.

`tasks.worklogs.ts` is the worklog interface; `tasks.worklogRepository.ts` owns
its SQL. `getTicketWorklogs` returns non-deleted entries newest day worked first
(with creation time/id tie-breaks), author/logged-by identities, and
`time_spent_minutes`, `original_estimate_minutes` and `remaining_estimate_minutes`.
Clients must refresh all three values from this envelope, including null and zero.
`getTimeSpent` batches sums for ticket read surfaces;
`logged_minutes` in responses is a legacy alias, never the stored ticket column.

`logWork` is the manual write seam (`POST /api/tasks/:id/worklogs`). It accepts
`day_worked`, `time_spent`, optional `start_time`, `comment` and `author_id`, and returns
`{ worklog, ticket, warnings }` with authoritative time spent, original/remaining
estimates, and legacy logged/estimated aliases. It locks the org-scoped ticket, checks `can.logWork` through the
capabilities module, and writes worklog/history/audit in one transaction.
Realtime `task_updated` reaches the ticket's people and project readers only after
commit in project mode; flag-off compatibility retains the legacy team audience.
`tasks.effortAudience.ts` shares this audience rule across worklog create/edit/delete,
legacy timer-stop and estimate writes, without broadcasting worklog fields.
Done is allowed; Cancelled returns 403 `WORKLOG_CANCELLED`; frozen sprints remain
read-only. Invalid fields return `INVALID_WORKLOG`, invalid durations
`INVALID_DURATION`, both 400 with no writes. `tasks.duration.ts` is pure: w/d/h/m,
whitespace and decimals; a week is five org working days, rounded to whole minutes.
Web/desktop replace the ticket timer with capability-driven Log work. The Android
projects integration at `bbfc1108` does not yet include the separate manual-worklogs
integration; see the [closeout gap](../../../.scratch/projects-own-tickets/issues/14-docs-glossary-and-parity-closeout.md#cross-branch-parity-gap-pre-existing)
before claiming native worklog parity.
`tasks.worklogWarnings.ts` exports the reusable
`computeWorklogWarnings(db, orgId, { author_id, day_worked }, tenantId)` hook.
Failures retain the error/stack and log tenant, org, saved author, worked day and advisory operation. Call it only
**after** the write transaction commits. Both `logWork` and `editWorklog` call it
with the saved author and recorded day, so changing day or duration recomputes
warnings against the updated aggregate (never counting the replaced entry twice).
It returns `ON_LEAVE` for approved leave
on any recorded day and `EXCEEDS_ATTENDANCE` when the author's non-deleted worklog
minutes across all org tickets that day exceed attendance working minutes.
No attendance entries means no total warning. Attendance reads go through the
attendance service (including its existing per-day summary and author timezone);
worklog aggregation lives in `tasks.worklogWarningRepository.ts`. Both reads are
best-effort so a read failure cannot undo the worklog or turn a saved response
into an error. Web and Android display plain-language warnings after closing the
save dialog/sheet, and clear them on the next clean save or ticket change.

`editWorklog` (`PATCH /api/tasks/:id/worklogs/:worklogId`) accepts any changed
subset of those fields; null clears start time or comment. `deleteWorklog`
(`DELETE` on the same path) soft-deletes, returning the authoritative ticket
summary. Both lock the org-scoped ticket and active worklog, check visibility and
`decideWorklog` in the capabilities module, then write history/audit atomically
before after-commit realtime. `canEdit` / `canDelete` on every worklog are true
for its author, the ticket project's admin or an org admin (HR admin and above),
including after Done or Cancelled. Other members get 403. `getTicketWorklogs` takes the viewer's actor
so serialization and correction guards use the same decision. Missing, deleted
or foreign-ticket worklogs return 404.
Deleted entries leave lists and all computed totals but remain in history.
Web/desktop and Android reuse prefilled Log work forms with changed-fields-only patches;
delete requires confirmation. `can.logWorkForOthers` gates the Person picker.
Any supplied `author_id` on create or edit (even self, null or malformed values)
requires that capability, otherwise 403 `WORKLOG_FOR_OTHERS_DENIED`. Authorized
authors must be integer user ids in the actor's organization; missing/foreign or
malformed people return 400 `INVALID_WORKLOG`. Omitting author uses the caller
on create and keeps the current author on edit. `logged_by_id` always records
the original logger and never changes on correction; history/audit record the
current actor. The list shows both identities when they differ. Estimates and
remaining choices are documented below. All five worklog/estimate routes have
native coverage; no temporary manual-worklog parity waiver remains.

`stopLegacyTimer` locks the org-scoped ticket and timer in one transaction, records a worklog,
persists automatic remaining adjustment, and uses the same `worklog_added` history/audit
semantics and after-commit `task_updated` as manual work. New stops do not duplicate
that history with `time_logged`; existing legacy history remains readable.
The timer-stop response shape and compatibility arithmetic are unchanged.
All estimate, worklog and timer mutations explicitly carry the actor's org filter.
Concurrent stops record only once. The day/start time use the caller's
`X-Timezone-Offset` (JavaScript convention); elapsed minutes round up to at least
one. Start/Stop remain compatibility routes during this rollout. Their legacy time
summary reads original estimate through the compatibility alias.

Migration `0026_task_worklogs` stops running timers and converts timer history,
using the owning organization's timezone (UTC fallback) and the comment
"Migrated from timer". Unique `source_timer_id` prevents duplicate conversion,
including SQL replay independently of the migration ledger. New-tenant baseline
columns, constraints and indexes match. The obsolete total is never written.

Public seams: `tasks.worklogRoutes.integration.test.ts` exercises the mounted
HTTP router on real PostgreSQL; `tasks.worklogMigration.integration.test.ts`
exercises baseline/upgrade/replay. Run `npm run test:pg -- --runInBand tasks.worklog`
in `server/`. Without `TASKS_SCHEMA_TEST_DATABASE_URL`, plain Jest skips PG tests.

## Original and remaining estimates

`tasks.estimates.ts` owns `setEstimates` and the pure `adjustRemaining` seam;
`tasks.estimateRepository.ts` owns estimate SQL. `PATCH /api/tasks/:id/estimates`
accepts `original_estimate` and/or `remaining_estimate` duration strings; empty
text clears, `0m` sets zero. Setting original seeds a null remaining only when
remaining is omitted. `can.canEditEstimate` shares `logWork`'s decision.
The endpoint records `estimate_changed` history and audit in the write transaction,
then emits `task_updated` to the same project-reader audience after commit
(legacy team audience while project ownership is off).

Worklog create/edit/delete accept `remaining_mode` (`auto`, default; `set`; `leave`).
`set` requires `remaining_estimate`; empty clears. `auto` applies the minutes delta,
never below zero, and leaves null forecasts null. Deleting returns time to the
forecast. Work and forecast share the ticket lock and transaction, including audit
failures. Shared compact/comfortable cards show spent, original and remaining effort.
Detail bars use spent / (spent + remaining), hiding unknown forecasts and showing
zero progress for a zero total. Original still determines the overrun indicator.
History renders worklog identity, author/logger, day, start time, duration and comment
from stored before/after metadata; deletions and null/zero estimate changes remain traceable.
Reads and write summaries expose original/remaining minutes and retain
`estimated_minutes` as an alias of original for older clients.

Migration `0027_task_estimates` renames the plan, adds nullable nonnegative remaining,
and backfills from active worklogs. Replaying never resets an edited/cleared forecast.
The new-tenant baseline matches. Web/desktop and Android render
server-capability-gated inline editors, all three remaining choices, and an overrun
bar. Tasks parity points to real web RTL and Android fake-API ticket-view-model
tests. The platform's read-only native parity gate requires coverage for all five
manual-worklog/estimate routes without changing unrelated baseline parity debt.
Tests: `tasks.estimates.test.ts`, `tasks.estimateMigration.integration.test.ts`,
`tasks.worklogRoutes.integration.test.ts`, `tasks.capabilities.integration.test.ts`
(real PostgreSQL), and client `Estimates.test.tsx` / `LogWork.test.tsx` (RTL).

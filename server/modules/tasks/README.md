# Tasks module

The service owns task-domain orchestration and the repository is the sole owner
of its SQL. Legacy task route adapters retain authentication, request parsing,
access checks, response serialization, and error compatibility.

Tickets belong to exactly one project with a stored key (ADR-017). Projects own
backlog, board, sprints, workflow and access; teams can hold grants in any number
of projects and never own a project. Creating a project requires team lead or
above, grants the creator project-admin and may grant teams member access.
User-facing guides: [Projects](../../../docs/PROJECTS.md) and
[Service Desk](../../../docs/SERVICE_DESK.md). Ticket 11 removes team-owned
task/sprint compatibility; the guarded contraction remains blocked until its
production gate and organization ownership preflight pass.
Tenant bootstrap retains the legacy columns required by historical ordered
migrations; `0035_project_types_contraction.sql` removes them only after the
guarded runner verifies the client-version minimums and ownership inventory.
The base schema is not evidence that the contraction has run.

## Ticket hierarchy (project types, Expand)

`tasks.hierarchy.ts` owns Epic → Story/Task/Bug → Subtask validation; its
repository owns hierarchy reads and transactional history. Custom non-epic,
non-subtask types occupy the Story/Task/Bug level. Create, parent/type edits and
project moves validate both the changed ticket and its children under the same
organization placement lock. Epics retain cross-project children. Subtasks
require an ordinary parent in the same project and sprint and cannot move on
their own (`SUBTASK_FOLLOWS_PARENT`); other violations return `INVALID_HIERARCHY`
with the violated rule.
Stored hierarchy classification includes inactive types; only a newly selected
type must be active. Deactivating Epic never turns its existing tickets ordinary.

`POST /api/tasks/:id/subtasks` reuses backlog creation, fixes the parent/type,
and inherits project/sprint. Both older create routes also inherit those fields
when the selected type is Subtask. Creation and parent/type history are atomic.
Detail returns visible `parent` and `subtasks` summaries; `canAddSubtask` is a
server decision, including viewer, archived, frozen-sprint and Cancelled-parent
refusals. The transactional create/conversion guard reuses that decision, so
stale clients receive the same `CANCELLED_TERMINAL` denial before any insert.

Migration `0031_ticket_hierarchy.sql` seeds/protects the unique Subtask type,
including future organizations. It detaches invalid ordinary/epic links;
invalid legacy Subtasks become ordinary Tasks without moving their project or
key, while valid Subtasks' sprint mismatches are aligned. Full before/after
snapshots and reasons remain in `task_hierarchy_repairs`, with system history.
The data marker makes SQL replay safe.
Additive `0034_recover_hierarchy_leaves.sql` recovers the eligible ordinary
leaves that 0031 detached, using only recorded original links and unchanged
hierarchy data. It converts them to Subtask, inherits the current parent sprint,
clears points and records immutable corrections/system history without changing
0031 or its original records. Human hierarchy/placement/points edits and missing
or ambiguous evidence are preserved for review. The complete ordered-chain and
already-applied-0031 upgrade/replay seam is `hierarchyLeafRecovery.integration`.

Parent placement and project moves cascade through `getTicketSubtasks` under the
organization placement lock. Every member gets transactional placement history,
audit and post-commit invalidation. Project moves reserve a key and alias the old
key for each member, mapping each workflow independently. A failed child write
rolls back the entire family; direct Subtask placement, project moves and ranking
remain refused. Sprint completion uses the same placement seam for whole parents.

Planning backlog reads page/count ordinary parents and batch-enrich their nested
`subtasks`. Board reads stay flat and include `is_subtask` and `parent_key`.
Detail preserves own `time_spent_minutes`/`remaining_estimate_minutes` and adds
`subtask_summary` (total/done, using canonical `completed_at`) and `effort`
(own/including-subtasks spent and remaining minutes). Deleted worklogs are excluded;
an entirely unknown remaining forecast stays null. `tasks.points.ts` owns the shared
point predicate: Subtasks cannot carry points, and Subtasks/Epics do not contribute
to sprint points, capacity, baselines, burndown or velocity. Board WIP still counts
cards, including Subtasks.

Real PostgreSQL coverage: `npx jest tasks.hierarchy.integration
tasksHierarchyExpand.integration --runInBand`.

## Start date (project types, Expand)

### Task list reads and calendar

`GET /api/tasks?scope=list&project_id=…` reads all project tickets, without a
date or sprint restriction. `tasks.collection.ts` owns shared SQL, literal
key/title substring filters, type/status/assignee/priority and exact
`start_on`/`due_on` filters, plus allowlisted sorting across all eight fields.
Use `sort=key|title|type|status|assignee|priority|start_date|due_date` and
`direction=asc|desc` (nulls last; ID breaks ties).

`scope=calendar` reads open, non-Cancelled tickets overlapping inclusive
`start_date`/`end_date` or one `date`: missing start/due coalesces to the other.
`undated=1` instead reads open work with neither date. Both scopes require a
positive project ID and project access, reject sprint scope, and return
`{ tasks, stats, pagination: { offset, hasMore } }` in pages of 500.
The calendar client follows all pages; List provides page controls. Remaining
backlog and sprint reads retain their behavior and omit pagination.

The web month and Monday-to-Sunday week calendar share range reads, paging,
overlays, the undated tray and normal `PUT /api/tasks/:id` date edits, not placement.
Drag shifts both dates by the same day offset, preserving null single dates
and duration; undated drops set both dates to the target. An accessible editor
supports precise/cleared dates. Server edit capabilities control dragging and
editing. Existing schedule overlays supply read-only approved leave, holiday
and meeting context. No schema migration is required.

`tasks.start_date` is nullable date metadata, independent of sprint/backlog
placement. `tasks.dateRepository.ts` owns locking, persistence and history SQL;
`tasks.dates.ts` validates real ISO days and refuses a deadline before
start with `Due date cannot be earlier than the start date`. Start-date writes
and their `updated/start_date` history share a transaction. Both creates and the
full edit accept `start_date`; the removed `planned_date` and `date` request
aliases are not accepted. Backlog creation is undated unless a start date is
supplied.

Scheduling and unscheduling routes and the Scheduled container are retired.
Search, export, Notes, manager/attendance day reads and My Work/dashboard windows
use `start_date`; API responses no longer emit `planned_date` or a `date` alias.
Sprint membership is independent of task dates.

Migration `0029_tasks_start_date.sql` copies planned days once, preserving
explicit start dates. Its transactional data marker also prevents direct SQL
replay from resurrecting a cleared start date. New-tenant base schema includes
the column. Run `npx jest tasks.startDates.integration tasksStartDateExpand.integration
--runInBand` with the disposable test database variable for real PostgreSQL HTTP
and migration coverage. No production database is required.

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
Source-driven sync/cancel runs in the platform tenant database, not the submitting
customer's org. Copy locks join the owning project and workflow through the same
organization and project, and acquire multiple ticket locks in id order.
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
Counts, aliases and rewrites also retain the actor's organization predicate;
project workflow reads and writes carry that same request organization explicitly.
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

Project lists include only accessible projects (all for organization admins).
Plan backlog, available sprints and sprint lists are scoped by `project_id`;
team-scoped task and sprint queries are rejected.
The web Plan project selection also scopes agile configuration, so board
columns and ticket controls use that project's workflow after switching.
`tasks.sprintProjects.ts` adapts project scopes and sprint management rules.
Sprint lookup, lifecycle and placement locks use the owning project and its
organization.

The web Plan switcher remembers a project per tenant/user, hides Unassigned,
and narrows both backlog requests and sprint/board selection. `/api/profile`
does not expose an ownership-mode flag.
Run `npm run test:pg -- projectPlanning --runInBand` from `server` for the
project planning PostgreSQL route tests.

`GET /api/projects/mine` is the create-picker listing: only active projects with
the actor's `canCreateTickets` capability are returned. The web create form
requires one, preferring the current project and then the user's last successful
create project; archived and viewer-only defaults are discarded. No available
project leaves an explanatory empty picker and disables creation.

`tasks.ownership.ts` resolves create ownership from the explicit request, then
the sprint's project, then General. Every destination must be active and writable
by a member/project admin (or org admin); an invalid or refused explicit project
never falls back.
Create, edit, bulk and plan placement all refuse a sprint from another project
with `SPRINT_PROJECT_MISMATCH`.

## Project-type policy and lifecycle (ADR-018)

### Project boards and capacity

`GET /api/projects/:id/board` is the project-wide board read for every type.
Kanban and Task list use continuous project populations; Scrum uses its selected
or current active/paused sprint. All boards exclude Cancelled and retain Done
for 14 days. The optional Kanban backlog is off by default; enabling it moves
initial-state visibility to `GET /api/projects/:id/backlog` without changing
ticket state or dates. Scrum backlog remains open, unsprinted work.

Project admins change `kanban_backlog_enabled` and `enable_wip_limits` through
`PATCH /api/projects/:id/board-settings`; existing project workflow settings own
per-state limits. Migration `0030_project_board_settings.sql` copies the former
organization WIP switch once, preserving subsequent project choices on replay.

`tasks.boardRepository.ts` owns shared board-membership and occupancy SQL.
`tasks.workflowWrite.ts` serializes lifecycle moves with the shared organization
placement/lifecycle advisory lock before taking any row lock, then takes
project-before-ticket locks and rechecks the fresh lifecycle and target capacity.
Project/family moves and sprint placement acquire that same advisory lock first,
as do project-key renames, so ticket-before-project moves cannot deadlock with
project-before-ticket status or key writers.
PATCH, full edits and bulk status moves cannot race to overfill the last slot.
Counts are never reduced by client filters; off-board Scrum work, Kanban initial
backlog and Cancelled never consume board capacity. Refusals include
`WIP_EXCEEDED` and the current count/limit.

The web ProjectBoard consumes these reads, capabilities and settings without
exposing sprint actions in non-Scrum projects. It supports pointer/keyboard
state moves, backlog pulling, quick creation and live invalidation; stale
capacity refusals preserve the ticket and show the server's occupancy message.
Run `npx jest projectBoard.integration tasks.board --runInBand` with
`TASKS_SCHEMA_TEST_DATABASE_URL` set to a disposable PostgreSQL instance.

`tasks.projectTypes.ts` is the pure policy seam: ordered Plan tabs, backlog,
board scope, 14-day Done window, Cancelled exclusion and type-change refusal.
`tasks.projectTypeLifecycle.ts` validates choices and coordinates locked changes;
its repository owns sprint-status reads, project locks and type writes. Routes
remain adapters; clients consume `planTabs` and `changeableTypes`. Only project
admins of active projects can change type.

`agile` controls new type destinations only. Workflow, project, board and sprint
endpoints keep existing projects working after feature loss. Sprint requests use
`tasks.projectSprintPolicy.ts` and refuse non-Scrum with `PROJECT_HAS_NO_SPRINTS`.
Ticket placement capabilities ask the same pure policy. Migration
`0028_project_type_lifecycle.sql` adds the default-off Kanban backlog setting;
project-row locks and database triggers serialize open-sprint writers with type
changes, preventing bypass and concurrent orphaning.

Run `npx jest projectTypes.integration tasks.projectTypes tasks.capabilities.integration --runInBand`
with the local test-database variable for pure policy, HTTP and capability seams.
Ticket 01 does not replace subsequent tickets' planning board contents.

## Migration review and publication

At `/projects`, **Review project migration** opens the super-admin review.
`GET /api/projects/migration/review` returns a consistent snapshot of generated
team/General projects, publication state, types, ticket counts, named grants,
and migration moves. `hierarchy_repairs` includes organization-scoped original
repairs and follow-up corrections, with immutable before/after hierarchy fields,
reason and time. A removed ticket retains its record with a null current key.
`new_key` follows review renames; `migration_key` retains
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

Placement — sprint/backlog membership and the sprint exit during project moves —
goes through `tasks.placement.ts` (rules),
`tasks.placementRepository.ts` (SQL) and `tasks.placementEffects.ts` (realtime
and notifications). Dates are independent fields (ADR-018); compatibility date
routes are retired by ticket 11. `scripts/check-placement-writes.mjs` enforces it.

### Moving projects (ticket10)

`previewProjectMove` and `moveTicketProject` share source/target authorization,
archive checks and workflow mapping: active matching key, then first active
category ordered by `sort_order, id`, then initial state. Preview only reads and
returns `{ target_project_id, key_format, workflow_state, leaves_sprint }`; its
key format is not a reservation. The HTTP adapters are
`POST /api/tasks/:id/move-project/preview` and `POST /api/tasks/:id/move-project`,
both accepting `{ project_id }`.

The caller supplies one transaction. Placement locks serialize moves, project
share locks prevent concurrent archive/key changes, and effective personal plus
project grants are checked on that transaction's connection.
Commit allocates a target sequence, aliases the old key with reason `move`,
maps state, and clears a source-project sprint. History and audit share the
transaction; effects run only after commit. Both projects' readers receive a
payload-free ticket invalidation so source-only readers do not learn the new
project's key/state.

`canMoveProject` requires member or higher in an active source project; target
membership is checked by preview/commit. Legacy `/transfer` is retired; use
the project-move routes.

Run `npm run test:pg -- tasks.placementRoutes.integration --runInBand -t ticket10`
for move/preview, workflow mapping, permissions, rollback and legacy coverage.

## Ticket decisions (ADR-016)

`tasks.capabilities.ts` exposes `loadTicketDecisionContext(db, actor, tickets)`,
`decideTickets(actor, tickets, context)` and `decideTicket(actor, ticket, context)`.
The batch result follows input order; each entry is `{ container, capabilities }`.
The single-ticket form returns the same decision for write-path callers.

Load context once for the whole request. It contains project lifecycles and a
batch-loaded sprint lookup. Project metadata supplies container type and
project roles govern ticket capabilities.
Pass an already loaded lifecycle as the loader's
`{ lifecycle }` option to reuse it. Both decide forms are synchronous and perform
no database reads. SQL for the supplementary lookups lives in
`tasks.capabilitiesRepository.ts`.
The optional `{ targetSprintId }` loader option evaluates `placeInSprint` against
a specific destination, including access, freeze and project ownership. Without a
destination it describes the general placement action, not permission to enter
every sprint. A requested destination that is missing or inaccessible denies
access. Placement's exported `placementRefusal` shares its freeze and ownership
rules with decisions; the shared predicates
live in `tasks.placementRules.ts` to keep decision loading independent of writes.

Containers use sprint, then backlog; dates do not decide.
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

User placement contexts carry `ticketActor`; `placeTickets` consults the
corresponding decision against locked sprint rows before writing.
Sprint lifecycle maintenance deliberately has no ticket actor: it moves a whole
sprint's membership as a system operation, not as individual ticket edits.
Sprint-target adapters retain their existing 400 status for an invalid or
inaccessible destination; capability refusals carry the decision reason.

Project capability and placement tests cover access, freeze, destination-specific
placement and organization isolation. Contracts and Android endpoint coverage
must remain aligned with these response fields.

## Notes ticket responses

`routes/notes/_helpers/tickets.ts` owns Notes' endpoint-specific ticket summaries
and embedded sprint stats. It retains the shared `enrichTaskSummaries` pipeline
for containers and capabilities; Notes routes keep their reads and error handling.
Linked-ticket lookups receive the actor's org from the route's loaded user
context; links to another organization's tickets return no details.

## Manual worklogs (ADR-019)

Ticket time is recorded only through manual worklogs; the attendance timer is
unrelated and unchanged. Clients render server capabilities, author/logged-by
attribution, inline original and remaining estimates, all three remaining
choices, and post-save warnings. Ticket timer routes are retired.

`tasks.worklogs.ts` is the worklog interface; `tasks.worklogRepository.ts` owns
its SQL. `getTicketWorklogs` returns non-deleted entries newest day worked first
(with creation time/id tie-breaks), author/logged-by identities, and
`time_spent_minutes`, `original_estimate_minutes` and `remaining_estimate_minutes`.
Clients must refresh all three values from this envelope, including null and zero.
`getTimeSpent` batches sums for ticket read surfaces. Legacy `logged_minutes`
and `estimated_minutes` aliases are not part of the supported response.

`logWork` is the manual write seam (`POST /api/tasks/:id/worklogs`). It accepts
`day_worked`, `time_spent`, optional `start_time`, `comment` and `author_id`, and returns
`{ worklog, ticket, warnings }` with authoritative time spent and
original/remaining estimates. It locks the org-scoped ticket, checks `can.logWork` through the
capabilities module, and writes worklog/history/audit in one transaction.
Realtime `task_updated` reaches the ticket's people and project readers only after
commit to project readers. `tasks.effortAudience.ts` shares this audience rule
across worklog create/edit/delete and estimate writes, without broadcasting
worklog fields.
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
remaining choices are documented below. Ticket 11 removes timer endpoint
coverage and updates the Android parity snapshot; focused and unfiltered parity
checks must both pass before merge.

Migration `0026_task_worklogs` stops running timers and converts timer history,
using the owning organization's timezone (UTC fallback) and the comment
"Migrated from timer". Unique `source_timer_id` prevents duplicate conversion,
including SQL replay independently of the migration ledger. New-tenant baseline
columns, constraints and indexes match. The obsolete total is never written.
Ticket 11 drops the timer table only through its separately guarded contraction
after the client-version gate enforces its minimums and every organization is
verified project-owned. That one-shot path is not automatically run at startup.

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
then emits `task_updated` to the same project-reader audience after commit.

Worklog create/edit/delete accept `remaining_mode` (`auto`, default; `set`; `leave`).
`set` requires `remaining_estimate`; empty clears. `auto` applies the minutes delta,
never below zero, and leaves null forecasts null. Deleting returns time to the
forecast. Work and forecast share the ticket lock and transaction, including audit
failures. Shared compact/comfortable cards show spent, original and remaining effort.
Detail bars use spent / (spent + remaining), hiding unknown forecasts and showing
zero progress for a zero total. Original still determines the overrun indicator.
History renders worklog identity, author/logger, day, start time, duration and comment
from stored before/after metadata; deletions and null/zero estimate changes remain traceable.
Reads and write summaries expose original/remaining minutes; the legacy
`estimated_minutes` alias is retired.

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

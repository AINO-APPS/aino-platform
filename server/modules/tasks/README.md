# Tasks module

The service owns task-domain orchestration and the repository is the sole owner
of its SQL. Legacy task route adapters retain authentication, request parsing,
access checks, response serialization, and error compatibility.

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
creator-team lookup. Pass an already loaded lifecycle as the loader's
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
remain 403 (404 for another org); lifecycle and placement conflicts remain 409.
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

## Worklogs and legacy timers

`tasks.worklogs.ts` is the worklog interface; `tasks.worklogRepository.ts` owns
its SQL. `getTicketWorklogs` returns non-deleted entries newest day worked first
(with creation time/id tie-breaks), author/logged-by identities, and
`time_spent_minutes`. `getTimeSpent` batches sums for ticket read surfaces;
`logged_minutes` in responses is a legacy alias, never the stored ticket column.

`logWork` is the manual write seam (`POST /api/tasks/:id/worklogs`). It accepts
`day_worked`, `time_spent`, optional `start_time` and `comment`, and returns
`{ worklog, ticket, warnings }` with authoritative time spent and the legacy
estimate. It locks the org-scoped ticket, checks `can.logWork` through the
capabilities module, and writes worklog/history/audit in one transaction.
Realtime `task_updated` reaches the ticket's people and team only after commit.
Done is allowed; Cancelled returns 403 `WORKLOG_CANCELLED`; frozen sprints remain
read-only. Invalid fields return `INVALID_WORKLOG`, invalid durations
`INVALID_DURATION`, both 400 with no writes. `tasks.duration.ts` is pure: w/d/h/m,
whitespace and decimals; a week is five org working days, rounded to whole minutes.
Web/desktop replace the ticket timer with the capability-driven Log work dialog.
Edits/deletes, estimates and behalf logging remain owned by later tickets;
unsupported inputs are refused for now.

`tasks.worklogWarnings.ts` exports the reusable
`computeWorklogWarnings(db, orgId, { author_id, day_worked })` hook. Call it only
**after** the write transaction commits. It returns `ON_LEAVE` for approved leave
on any recorded day and `EXCEEDS_ATTENDANCE` when the author's non-deleted worklog
minutes across all org tickets that day exceed attendance working minutes.
No attendance entries means no total warning. Attendance reads go through the
attendance service (including its existing per-day summary and author timezone);
worklog aggregation lives in `tasks.worklogWarningRepository.ts`. Both reads are
best-effort so a read failure cannot undo the worklog or turn a saved response
into an error. The web displays plain-language warnings after closing the save
dialog, and clears them on the next clean save or ticket change.

`stopLegacyTimer` locks the ticket and timer in one transaction, records a worklog
and the legacy history entry, and returns the unchanged timer-stop envelope.
Concurrent stops record only once. The day/start time use the caller's
`X-Timezone-Offset` (JavaScript convention); elapsed minutes round up to at least
one. Start/Stop remain compatibility routes during this rollout. Estimates retain
`estimated_minutes` until manual-worklogs ticket 04.

Migration `0019_task_worklogs` stops running timers and converts timer history,
using the owning organization's timezone (UTC fallback) and the comment
"Migrated from timer". Unique `source_timer_id` prevents duplicate conversion,
including SQL replay independently of the migration ledger. New-tenant baseline
columns, constraints and indexes match. The obsolete total is never written.

Public seams: `tasks.worklogRoutes.integration.test.ts` exercises the mounted
HTTP router on real PostgreSQL; `tasks.worklogMigration.integration.test.ts`
exercises baseline/upgrade/replay. Run `npm run test:pg -- --runInBand tasks.worklog`
in `server/`. Without `TASKS_SCHEMA_TEST_DATABASE_URL`, plain Jest skips PG tests.
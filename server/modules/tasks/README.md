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
ownership and in-sprint scheduling rules with decisions.

Containers use sprint, then planned day, then backlog; deadlines never decide.
Transitions include every other active state. Cancelled is terminal even when
access or freeze would also refuse a move. Otherwise access precedes freeze,
then cancellation permission/completion and transition legality. `changeState`
requires an allowed transition. `delete` means cancellation, matching the
existing DELETE endpoint; tickets are never hard-deleted. WIP capacity is
deliberately excluded and remains a column/write-guard concern.

This module does not enrich responses or replace route guards yet. Those are
separate rollout tickets. The PostgreSQL decision suite compares the existing
access, lifecycle and placement guards where their seams already overlap;
mapping all write refusals (including legacy terminal/cancel codes) onto
decisions belongs to the write-guard rollout.

Run `cd server; npm run test:pg -- tasks.capabilities.integration --runInBand`
with Docker, or set `TASKS_SCHEMA_TEST_DATABASE_URL` and run the suite with Jest.
It skips when that URL is unset.
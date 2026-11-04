# Service Desk project copies

Customer Service Desk tickets remain separate from their platform work copies.
Every new copy belongs to the platform organization's active **Service Desk
project**, selected in organization settings; if unset, it belongs to `General`.
It does not inherit the submitting customer's team. The project must belong to
the platform organization and be active; invalid settings are refused.
The web settings API reads/writes `service_desk_project_id` through
`GET /api/org/settings` and `PUT /api/org/settings`; clearing it selects the
General fallback.

The copy receives a stored ticket key and the project's active initial state.
Its read/write access, roles, alias resolution and archive rules follow
[Projects](PROJECTS.md), just like other project-owned tickets. Project creation
requires team lead or above; organization-setting administration is web-only.

## Lifecycle

Source status changes map directly into the copy's project workflow: initial
state, first active in-progress state, or first non-cancelled Done state,
ordered by workflow order and ID. This is system synchronization, not a user
transition. History attributes it to the system rather than an arbitrary user;
a Cancelled copy is never reopened by status synchronization.

Deleting the source **cancels** unfinished platform work and records
`service_desk_deleted`. A Done copy stays Done and receives the history note.
The copy, stored key, aliases and work history are never deleted.

Copy creation and synchronization cross tenant databases. Failures are logged
without rejecting the customer's submitted Service Desk ticket; they do not
pretend to be one cross-database transaction. Title, description and comment
synchronization is outside Phase 2.

## Switch-over and verification

Project/key backfill precedes the per-organization ownership switch. Review
generated projects and grants before publication; until then normal ticket
visibility follows the legacy team policy. See the [switch-over runbook](PROJECTS.md#migration-review-and-switch-over).

Implementation: `server/modules/tasks/tasks.serviceDesk.ts` and
`tasks.serviceDeskRepository.ts`. PostgreSQL route coverage:

```powershell
cd server
npm run test:pg -- serviceDeskProject --runInBand
npx jest serviceDesk.routes.characterization tasks.serviceDesk --runInBand
```

The server-side copy lifecycle applies to all clients. Native organization
settings remain intentionally web-only, not an unimplemented mobile ticket flow.

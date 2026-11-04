# 05: Rename a project key

**What to build:** a project admin renames their project's key from project settings. Before confirming, they see a warning with the number of tickets that will get a new key. Every ticket gets its new key at once, or none do. Every old key keeps opening its ticket as an alias, and the old project key can never be used again. Boards that are open update to the new keys without a reload.

**Blocked by:** 02, 03

**Status:** resolved

## Claim

Implementing on `ticket/projects-own-tickets-05`, based on integration `507ead77566e0a8c19406da6e5246c5ab8ab3089`.
Testing seams specified by the ticket/spec: authenticated project rename/preview HTTP routes against PostgreSQL (atomicity, permissions, aliases, conflicts), web settings rendered interactions (warning/capability/result), and realtime consumer refresh behavior.

Spec: [projects-own-tickets](../spec.md). Decisions: ADR-017.

- [x] **The rename endpoint** on the projects resource is allowed for project admins and org admins (project-level `canRenameKey`).
- [x] **The new key is checked** for format and against every current project key and every reserved key:
  - A conflict returns 409.
  - Bad formatting returns 400.
- [x] **In one transaction:**
  1. the project key changes;
  2. the old key is added to the reserved project keys;
  3. every ticket's stored key is rewritten;
  4. **only if the key was published**, an alias (reason `rename`) is written for each old ticket key.
  - Unpublished keys, from generated projects before the switch-over, create no aliases.
- [x] **One audit entry per rename** records the old key, the new key and the actor. No history row is written per ticket.
- [x] **A realtime project-updated event is sent after commit.** Web boards, lists and the ticket detail refresh keys when they receive it.
- [x] **A preview call** returns the number of affected tickets for the warning, without writing anything.
- [x] **Web project settings** have a key rename control with the warning and the count. It is hidden without `canRenameKey`.
- [x] **Route test on real PostgreSQL:**
  - A rename rewrites every key.
  - Old keys open the tickets through aliases when the key was published, and create no aliases when it wasn't.
  - A reserved key, a key in use and a badly formatted key are each refused.
  - A failure partway leaves no partial rename.
  - Renaming back to the original key is refused, because that key is now reserved.
- [x] **Web tests:** the warning shows the count, the result updates the keys on screen, and the control is hidden without the capability.
- [x] **Contracts:** the route snapshot, route inventory, OpenAPI and realtime parity are updated, and checks pass.

## Answer

Implemented `POST /api/projects/:id/key/preview` and `POST /api/projects/:id/key`
with project-admin/org-admin authorization, strict key validation, permanent
reservations and row-locked transactional rewrites. Published keys gain aliases;
unpublished keys remain unpublished and create none. One audit entry shares the
transaction; `project_updated` is emitted only after commit. Creation also claims
a unique reservation to prevent reusing a renamed prefix.

Project settings are reachable at `/projects` independently of organization role,
including through More → Projects. Capability-gated settings show the affected
count and warning before confirmation. Project lists, boards, scheduled/backlog
lists, dashboard cards and open ticket details refresh on the realtime event.
OpenAPI, route snapshot/inventory, AsyncAPI and explicit platform parity are updated.
The baseline generator now retains the existing ticket-key/alias contracts.

Validation:
- PostgreSQL: `npm run test:pg -- projectsKeyRename.integration projectsAccess.integration --runInBand` — 11 tests passed.
- Server: `npx jest projects.routes.characterization routes.snapshot --runInBand --forceExit` — 10 tests and route snapshot passed.
- Web: focused project settings/members, navigation/navbar, freshness/deltas/backlog,
  cancelled-section and My Work suites — 78 tests passed.
- Server/client typechecks, server dependency layering, `npm run contracts:validate`
  (60 tests), `npm run check:guardrails`, and `git diff --check` passed.
- Merged latest integration `507ead77566e0a8c19406da6e5246c5ab8ab3089` before final validation (already up to date).

No ticket05 gaps. Native Android settings remain explicitly web-only per the spec;
its project-scoped realtime adoption remains tracked separately in ticket13.

## Privacy follow-up

Merged integration `6a419b0c6f4e5df2f4de41b0c9c438a7310480a3`.
The post-commit tenant-wide `project_updated` frame and matching local browser
event now contain only `project_id`, never old/new keys or affected ticket count.
Authorized HTTP preview/rename responses and audit details retain those fields.
ID-only invalidation still refreshes settings lists, boards and ticket detail.
AsyncAPI forbids additional event-data properties; route and web tests assert
the exact minimized payload. Ticket05 remains resolved.

Follow-up validation:
- `server`: `npm run test:pg -- projectsKeyRename.integration --runInBand` — 7 passed;
  verified red before the payload fix, then green, including post-commit timing.
- `client`: `npm test -- src\components\tasks\__tests__\ProjectKeySettings.test.tsx src\pages\tasks\__tests__\capabilityFreshness.test.tsx` — 10 passed.
- Server and client `npm run typecheck` passed.
- `npm run contracts:validate` — 61 passed; `git diff --check` passed.
- `npm run check:guardrails` encounters inherited integration file-size failures:
  `routes/sprints.ts` 1005/959 and `routes/tasks/crud.ts` 685/682 lines. Neither file
  is modified by this follow-up; no unrelated ratchet changes made.

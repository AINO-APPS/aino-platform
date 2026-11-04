# 11: Service Desk project

**What to build:** a platform org admin chooses the Service Desk project in org settings. New Service Desk copies go there, or to `General` if none is set, and each one gets a ticket key. When the Service Desk ticket's status changes, the copy follows it. Deleting the Service Desk ticket cancels the copy instead of deleting it; a copy that is already Done stays Done. Customers can always submit, even if creating the copy fails.

**Blocked by:** 04

**Status:** resolved

Claimed by `ticket/projects-own-tickets-11` on 2026-11-04 from integration base `fa8118cc45258e7dab78dc547ee9b497f55b660d`.

Spec: [projects-own-tickets](../spec.md). Decisions: ADR-017.

- [x] **Org settings** read and write the Service Desk project, which must be an active project in the org. The web org settings page has a picker.
- [x] **Creating a copy:** the copy goes into the Service Desk project, or `General`. It gets the next number, its stored key and the initial state of that project's workflow. A failure is logged, and the ticket submission still succeeds.
- [x] **Status sync runs one way**, from the Service Desk ticket to the copy, as a system actor, and bypasses the transition graph. Each sync writes a history entry marked as a Service Desk sync.

  | Service Desk status | Copy moves to |
  |---|---|
  | open, acknowledged | the initial state |
  | in progress | the first `in_progress`-category state |
  | resolved, closed | the first non-cancelled `done`-category state |

  A cancelled copy is never synced again.
- [x] **Deleting the Service Desk ticket** moves the copy to Cancelled and writes a history note. A Done copy stays Done and gets only the note. The copy is never deleted.
- [x] **Route test on real PostgreSQL:**
  - The copy lands in the configured project, and in `General` when none is set, with a key.
  - Every status maps correctly.
  - A cancelled copy isn't synced.
  - Delete cancels the copy.
  - A Done copy stays Done.
  - A failure creating the copy still returns 201.
- [x] **The existing Service Desk routes characterization suite** is updated and passes.
- [x] **Web tests:** the org settings picker saves the Service Desk project.
- [x] **Contracts:** OpenAPI and parity checks are updated, and pass.

## Answer

Implemented on `ticket/projects-own-tickets-11` in `fbce163d`, with latest
integration including ticket12 (`a63dd3d2`) merged in `7d566b09`. The only merge
conflict was the contract inventory total (259 operations); the Service Desk
migration is `0024_service_desk_project.sql`.

All ticket11 acceptance behavior is implemented. Post-ticket12 validation:

- Real PostgreSQL Service Desk route tests, existing route characterization and
  focused task tests: **16 passed**.
- Web picker and readable system-history tests: **2 passed**.
- Server/client typechecks and server dependency boundaries: passed.
- OpenAPI, realtime contracts, parity and **60 non-mutating contract tests**:
  passed.
- `check:guardrails` was run; its inherited server-size gate still fails for
  `routes/sprints.ts` (1005/959) and `routes/tasks/crud.ts` (685/682). These files
  are unchanged from integration.
- The full contracts umbrella discovers pre-existing sibling iOS model drift
  via ticket12's updated generator. No iOS change is retained; generated-model
  tests are excluded from the non-mutating contract run because they rewrite
  sibling outputs.
- The additional legacy `organization.routes` suite fails on integration too
  (confirmed on clean `63ed28c3`); ticket11's PostgreSQL settings route coverage
  and Service Desk characterization pass.

No ticket11 implementation gaps remain. No integration branch changes were made.

# 11: Service Desk project

**What to build:** a platform org admin chooses the Service Desk project in org settings. New Service Desk copies go there, or to `General` if none is set, and each one gets a ticket key. When the Service Desk ticket's status changes, the copy follows it. Deleting the Service Desk ticket cancels the copy instead of deleting it; a copy that is already Done stays Done. Customers can always submit, even if creating the copy fails.

**Blocked by:** 04

**Status:** ready-for-agent

Spec: [projects-own-tickets](../spec.md). Decisions: ADR-017.

- [ ] **Org settings** read and write the Service Desk project, which must be an active project in the org. The web org settings page has a picker.
- [ ] **Creating a copy:** the copy goes into the Service Desk project, or `General`. It gets the next number, its stored key and the initial state of that project's workflow. A failure is logged, and the ticket submission still succeeds.
- [ ] **Status sync runs one way**, from the Service Desk ticket to the copy, as a system actor, and bypasses the transition graph. Each sync writes a history entry marked as a Service Desk sync.

  | Service Desk status | Copy moves to |
  |---|---|
  | open, acknowledged | the initial state |
  | in progress | the first `in_progress`-category state |
  | resolved, closed | the first non-cancelled `done`-category state |

  A cancelled copy is never synced again.
- [ ] **Deleting the Service Desk ticket** moves the copy to Cancelled and writes a history note. A Done copy stays Done and gets only the note. The copy is never deleted.
- [ ] **Route test on real PostgreSQL:**
  - The copy lands in the configured project, and in `General` when none is set, with a key.
  - Every status maps correctly.
  - A cancelled copy isn't synced.
  - Delete cancels the copy.
  - A Done copy stays Done.
  - A failure creating the copy still returns 201.
- [ ] **The existing Service Desk routes characterization suite** is updated and passes.
- [ ] **Web tests:** the org settings picker saves the Service Desk project.
- [ ] **Contracts:** OpenAPI and parity checks are updated, and pass.

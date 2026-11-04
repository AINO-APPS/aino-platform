# 13: Android project scope, create and move

**What to build:** the Android app works in projects the way the web does:

- The Plan screen has a project switcher listing every project the person can access.
- Creating a ticket needs a project.
- A ticket can be moved to another project.
- Edit actions appear or hide according to what the server allows, including for archived projects and viewers.
- Searching by an old key finds the ticket.

Project settings, key rename, members and workflow editing stay web-only.

**Blocked by:** 07, 08, 09, 10

**Status:** resolved

Spec: [projects-own-tickets](../spec.md). Decisions: ADR-017, ADR-016.

- [x] **The Plan scope and shell view model** change from team scope to project scope. The project switcher, fed by the projects-you-can-access listing, replaces the team picker and the Unassigned option. If the server doesn't send projects, the app falls back to team scope.
- [x] **Creating a ticket** has a required project picker fed by "my projects", defaulting to the current project.
- [x] **"Move to project"** replaces team transfer: a target picker, the server preview, then confirm.
- [x] **Ticket and project models** carry `ticket_key`, project (id, key, name, archived), key aliases and the new capabilities and denial reasons. All actions are driven by server capabilities.
- [x] **Search by key** resolves aliases through the server's fetch-by-key endpoint.
- [x] **JVM tests** through the Plan shell and ticket detail view models with the fake API client harness:
  - project scope
  - create with a project
  - move with its preview
  - archived and viewer actions hidden
  - alias search
- [ ] **The Android endpoint and realtime parity checks**, and the tasks-parity matrix, are updated and pass (ticket 14 closeout).

## Answer

Implemented on `ticket/projects-own-tickets-13` and merged into Android
`integration/projects-own-tickets` at `bbfc1108b2aa1a3676a1b2a0c2566d7d6094d3bc`.
Plan project scope, project-aware create and move flows, capability-gated actions,
and alias search are in place.

Validation passed: 1,348 Play tests, 1,354 Direct tests, Play lint, both
assemblies, and all five Android guardrails. Device tests were not run.
Platform endpoint/realtime parity and tasks-parity closeout remain with ticket 14.

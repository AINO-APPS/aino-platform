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
- [x] **The Android endpoint and realtime parity checks**, and the tasks-parity matrix, are updated and pass (ticket 14 closeout).

## Answer

Implemented on `ticket/projects-own-tickets-13` and merged into Android
`integration/projects-own-tickets` at `bbfc1108b2aa1a3676a1b2a0c2566d7d6094d3bc`.
The Android manual-worklogs integration was subsequently merged into that branch
at `74c51fe687bad295a0ad9d0033a5f38df3736c6c`, closing the cross-branch parity
gap without replacing project-scoped ticket behavior.

Validation passed: 1,348 Play tests, 1,354 Direct tests, Play lint, both
assemblies, and all five Android guardrails on the project-only implementation.
After the worklog merge, focused task tests passed (268 Play and 268 Direct),
all five guardrails passed, and full native endpoint parity reported 276/532
proven, 234 waived, 3 retired, 21 pending, and zero unmatched operations.
The tasks-parity matrix passed for 55 features across four clients, and realtime
parity passed for all 85 server event types. Device tests were not run. See the
[exact validation results and remaining gaps](14-docs-glossary-and-parity-closeout.md).

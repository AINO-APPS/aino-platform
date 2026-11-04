# 13: Android project scope, create and move

**What to build:** the Android app works in projects the way the web does:

- The Plan screen has a project switcher listing every project the person can access.
- Creating a ticket needs a project.
- A ticket can be moved to another project.
- Edit actions appear or hide according to what the server allows, including for archived projects and viewers.
- Searching by an old key finds the ticket.

Project settings, key rename, members and workflow editing stay web-only.

**Blocked by:** 07, 08, 09, 10

**Status:** ready-for-agent

Spec: [projects-own-tickets](../spec.md). Decisions: ADR-017, ADR-016.

- [ ] **The Plan scope and shell view model** change from team scope to project scope. The project switcher, fed by the projects-you-can-access listing, replaces the team picker and the Unassigned option. If the server doesn't send projects, the app falls back to team scope.
- [ ] **Creating a ticket** has a required project picker fed by "my projects", defaulting to the current project.
- [ ] **"Move to project"** replaces team transfer: a target picker, the server preview, then confirm.
- [ ] **Ticket and project models** carry `ticket_key`, project (id, key, name, archived), key aliases and the new capabilities and denial reasons. All actions are driven by server capabilities.
- [ ] **Search by key** resolves aliases through the server's fetch-by-key endpoint.
- [ ] **JVM tests** through the Plan shell and ticket detail view models with the fake API client harness:
  - project scope
  - create with a project
  - move with its preview
  - archived and viewer actions hidden
  - alias search
- [ ] **The Android endpoint and realtime parity checks**, and the tasks-parity matrix, are updated and pass.

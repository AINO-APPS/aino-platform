# 05: Rename a project key

**What to build:** a project admin renames their project's key from project settings. Before confirming, they see a warning with the number of tickets that will get a new key. Every ticket gets its new key at once, or none do. Every old key keeps opening its ticket as an alias, and the old project key can never be used again. Boards that are open update to the new keys without a reload.

**Blocked by:** 02, 03

**Status:** ready-for-agent

Spec: [projects-own-tickets](../spec.md). Decisions: ADR-017.

- [ ] **The rename endpoint** on the projects resource is allowed for project admins and org admins (project-level `canRenameKey`).
- [ ] **The new key is checked** for format and against every current project key and every reserved key:
  - A conflict returns 409.
  - Bad formatting returns 400.
- [ ] **In one transaction:**
  1. the project key changes;
  2. the old key is added to the reserved project keys;
  3. every ticket's stored key is rewritten;
  4. **only if the key was published**, an alias (reason `rename`) is written for each old ticket key.
  - Unpublished keys, from generated projects before the switch-over, create no aliases.
- [ ] **One audit entry per rename** records the old key, the new key and the actor. No history row is written per ticket.
- [ ] **A realtime project-updated event is sent after commit.** Web boards, lists and the ticket detail refresh keys when they receive it.
- [ ] **A preview call** returns the number of affected tickets for the warning, without writing anything.
- [ ] **Web project settings** have a key rename control with the warning and the count. It is hidden without `canRenameKey`.
- [ ] **Route test on real PostgreSQL:**
  - A rename rewrites every key.
  - Old keys open the tickets through aliases when the key was published, and create no aliases when it wasn't.
  - A reserved key, a key in use and a badly formatted key are each refused.
  - A failure partway leaves no partial rename.
  - Renaming back to the original key is refused, because that key is now reserved.
- [ ] **Web tests:** the warning shows the count, the result updates the keys on screen, and the control is hidden without the capability.
- [ ] **Contracts:** the route snapshot, route inventory, OpenAPI and realtime parity are updated, and checks pass.

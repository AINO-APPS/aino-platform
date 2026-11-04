# 08: Plan screen switches between projects

**What to build:** on the web, the Plan screen has a project switcher instead of the team switcher. It lists every project the person can access, so a team that works in several projects sees all of them. The backlog, sprints and board show one project's work, and each project's sprints belong to that project. The admin-only Unassigned bucket is gone. Deleting a team no longer needs its tickets and sprints moved first, because teams don't own them.

**Blocked by:** 06

**Status:** ready-for-agent

Spec: [projects-own-tickets](../spec.md). Decisions: ADR-017.

- [ ] **Backlog, sprint list, sprint board and plan endpoints** take a project and return only that project's tickets and sprints. Sprint creation and lookups use the sprint's project.
- [ ] **Sprints from one project never appear in another project's views.**
- [ ] **With the flag on, the legacy team scope** resolves to the team's generated project, for older clients.
- [ ] **The project switcher on the web Plan screen:**
  - Lists every project the person can access, plus every project for super admins.
  - Remembers the last project.
  - The team switcher and the Unassigned option are removed.
  - The flag-off org keeps the team switcher.
- [ ] **The team-deletion guard no longer counts tickets or sprints** when the flag is on. Deleting a team removes its project grants.
- [ ] **Route test on real PostgreSQL:**
  - Backlog, sprint and board are scoped by project.
  - A team with grants on two projects sees both in its projects list.
  - Legacy team scope maps to the generated project.
  - A team with tickets can be deleted when the flag is on.
- [ ] **The existing sprint and placement route suites** are updated to project-scoped sprints and pass.
- [ ] **Web tests:** the switcher lists the accessible projects and drives the backlog and board; there is no Unassigned option; the team switcher remains when the flag is off.
- [ ] **Contracts:** the route snapshot, OpenAPI and parity checks are updated, and pass.

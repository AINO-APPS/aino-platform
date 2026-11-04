# 08: Plan screen switches between projects

**What to build:** on the web, the Plan screen has a project switcher instead of the team switcher. It lists every project the person can access, so a team that works in several projects sees all of them. The backlog, sprints and board show one project's work, and each project's sprints belong to that project. The admin-only Unassigned bucket is gone. Deleting a team no longer needs its tickets and sprints moved first, because teams don't own them.

**Blocked by:** 06

**Status:** resolved

Spec: [projects-own-tickets](../spec.md). Decisions: ADR-017.

- [x] **Backlog, sprint list, sprint board and plan endpoints** take a project and return only that project's tickets and sprints. Sprint creation and lookups use the sprint's project.
- [x] **Sprints from one project never appear in another project's views.**
- [x] **With the flag on, the legacy team scope** resolves to the team's generated project, for older clients.
- [x] **The project switcher on the web Plan screen:**
  - Lists every project the person can access, plus every project for super admins.
  - Remembers the last project.
  - The team switcher and the Unassigned option are removed.
  - The flag-off org keeps the team switcher.
- [x] **The team-deletion guard no longer counts tickets or sprints** when the flag is on. Deleting a team removes its project grants.
- [x] **Route test on real PostgreSQL:**
  - Backlog, sprint and board are scoped by project.
  - A team with grants on two projects sees both in its projects list.
  - Legacy team scope maps to the generated project.
  - A team with tickets can be deleted when the flag is on.
- [x] **The existing sprint and placement route suites** are updated to project-scoped sprints and pass.
- [x] **Web tests:** the switcher lists the accessible projects and drives the backlog and board; there is no Unassigned option; the team switcher remains when the flag is off.
- [x] **Contracts:** the route snapshot, OpenAPI and parity checks are updated, and pass.

## Answer

Implemented on `ticket/projects-own-tickets-08` (`2b266882` plus the integration merge).
Project planning, sprint lifecycle/rollover, legacy team mapping, project grants,
team deletion, persisted web project selection and project workflow switching are covered.
Merged integration `a63dd3d2`, including workflow, multi-team membership and ticket12 switch-over.
Focused PostgreSQL, sprint/placement, workflow/membership, Plan UI and route snapshot
tests pass after merged fixture updates; both typechecks, dependency checks and
62 contract checks pass. Final combined validation includes 14 PostgreSQL planning,
workflow, membership and migration-review cases, plus 28 Plan/review UI cases.
Sprint route extraction satisfies its 959-line ceiling.
The unrelated integration `tasks/crud.ts` 685/682 size violation remains for ticket07.

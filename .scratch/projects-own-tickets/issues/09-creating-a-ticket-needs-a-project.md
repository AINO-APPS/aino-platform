# 09: Creating a ticket needs a project; sprints never mix projects

**What to build:** on the web, a person chooses a project when they create a ticket. The picker defaults to the project they're working in, or the one they used last, and leaves out archived projects and projects where they're only a viewer. A ticket can join only a sprint of its own project, with a clear message otherwise. Older clients that don't send a project still work.

**Blocked by:** 07, 08

**Status:** claimed

Claimed by `ticket/projects-own-tickets-09` in `.worktrees/projects-own-tickets-09`.

Spec: [projects-own-tickets](../spec.md). Decisions: ADR-017.

- [ ] **A "my projects" listing for pickers** returns the projects where the actor has `canCreateTickets`, leaving out archived projects.
- [ ] **The ownership module resolves the project on create:**
  - Use the project named in the request, if the actor can create there.
  - Otherwise use the sprint's project.
  - Otherwise use the legacy default: the actor's team project, then `General`.
  - Creating in an archived project, or in one where the actor isn't at least a member, is refused.
- [ ] **The sprint rule:** a ticket may join only a sprint of its own project, on create, edit, bulk and plan moves. The `SPRINT_TEAM_MISMATCH` refusal is replaced by `SPRINT_PROJECT_MISMATCH` in the reason catalogue, the denial messages and every placement path.
- [ ] **The web create form** has a required project picker that defaults to the current or last-used project.
- [ ] **Route test on real PostgreSQL:**
  - Create with a project.
  - Create without a project falls back to the legacy default.
  - Create in an archived or viewer-only project is refused.
  - A sprint from another project is refused with `SPRINT_PROJECT_MISMATCH`, on create, edit and bulk.
- [ ] **The capabilities integration suite** covers `SPRINT_PROJECT_MISMATCH`.
- [ ] **Web tests:** the picker defaults correctly, leaves out archived and viewer-only projects, and the mismatch message shows.
- [ ] **Contracts:** OpenAPI and parity checks are updated, and pass.

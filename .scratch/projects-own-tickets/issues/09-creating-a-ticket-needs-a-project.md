# 09: Creating a ticket needs a project; sprints never mix projects

**What to build:** on the web, a person chooses a project when they create a ticket. The picker defaults to the project they're working in, or the one they used last, and leaves out archived projects and projects where they're only a viewer. A ticket can join only a sprint of its own project, with a clear message otherwise. Older clients that don't send a project still work.

**Blocked by:** 07, 08

**Status:** resolved

Claimed by `ticket/projects-own-tickets-09` in `.worktrees/projects-own-tickets-09`.

Spec: [projects-own-tickets](../spec.md). Decisions: ADR-017.

- [x] **A "my projects" listing for pickers** returns the projects where the actor has `canCreateTickets`, leaving out archived projects.
- [x] **The ownership module resolves the project on create:**
  - Use the project named in the request, if the actor can create there.
  - Otherwise use the sprint's project.
  - Otherwise use the legacy default: the actor's team project, then `General`.
  - Creating in an archived project, or in one where the actor isn't at least a member, is refused.
- [x] **The sprint rule:** a ticket may join only a sprint of its own project, on create, edit, bulk and plan moves. The `SPRINT_TEAM_MISMATCH` refusal is replaced by `SPRINT_PROJECT_MISMATCH` in the reason catalogue, the denial messages and every placement path.
- [x] **The web create form** has a required project picker that defaults to the current or last-used project.
- [x] **Route test on real PostgreSQL:**
  - Create with a project.
  - Create without a project falls back to the legacy default.
  - Create in an archived or viewer-only project is refused.
  - A sprint from another project is refused with `SPRINT_PROJECT_MISMATCH`, on create, edit and bulk.
- [x] **The capabilities integration suite** covers `SPRINT_PROJECT_MISMATCH`.
- [x] **Web tests:** the picker defaults correctly, leaves out archived and viewer-only projects, and the mismatch message shows.
- [x] **Contracts:** OpenAPI and parity checks are updated, and pass.

## Answer

Implemented on `ticket/projects-own-tickets-09`, starting at `ee752b6f` and merging
latest integration `7ce9afb3` (ticket10) before final validation. No integration
branch edits.

- `GET /api/projects/mine` returns active projects with `canCreateTickets`.
- Ownership resolves explicit project, sprint, legacy team project, then General,
  refusing invalid/archived/viewer-only destinations instead of silently falling back.
- Create, edit, bulk, plan and capabilities share `SPRINT_PROJECT_MISMATCH`.
- The web required picker uses current/last successful project, filters stale
  archived/viewer defaults, disables an empty form and preserves scoped quick create.
- OpenAPI, route inventory/snapshot, parity and D55 document the contract.

Final merged checks passed:

- PostgreSQL: `npm run test:pg -- projectPlanning.integration tasks.capabilities.integration tasks.placementRoutes.integration --runInBand --silent --testTimeout=30000 --testNamePattern=project` — 32 passed (230 intentionally filtered).
- Server: create-insert, edit-placement, placement-routes, ownership and route snapshot — 73 passed.
- Web: picker, backlog create/refresh, sprint actions, first render, page wiring and merged move dialog — 36 passed.
- Contracts/parity/model checks — 81 passed; server/client typecheck and guardrails passed.
- Before ticket10 merge, complete create/planning and capabilities PostgreSQL suites also passed (209 tests).

Known unrelated baseline failures were left untouched: mocked viewer detail,
bulk-placement and task-route assertions reproduce at `ee752b6f`. A broader
legacy placement PostgreSQL run hit fixture hook timeouts; the final project
route/capability/placement checks above pass. One fresh-container authentication
failure cleared on retry. Native picker work remains ticket13's documented waiver.

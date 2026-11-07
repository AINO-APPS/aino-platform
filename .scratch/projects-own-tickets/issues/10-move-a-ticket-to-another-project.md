# 10: Move a ticket to another project

**What to build:** from the ticket detail on the web, a member moves a ticket to another project they can create in. A preview first shows:

- the new key format;
- which status the ticket will land in;
- whether it will leave its sprint.

After the move, the ticket has a key from its new project and its old key still opens it. It has left the old project's sprint, and its status fits the new project's workflow. The history records the move. Older clients' "transfer to team" moves the ticket into that team's project.

**Blocked by:** 02, 04, 07

**Status:** resolved

Claimed by `ticket/projects-own-tickets-10` in `.worktrees/projects-own-tickets-10`.

Spec: [projects-own-tickets](../spec.md). Decisions: ADR-017.

- [x] **The placement module gains a "move to project" operation.** In one transaction it:
  1. checks the actor is a member or higher in both the source and target projects, and that neither project is archived;
  2. takes the next number from the target project;
  3. writes the new key and stores the old key as an alias (reason `move`);
  4. maps the workflow state: same key, otherwise the first active state in the same category, otherwise the initial state;
  5. clears a sprint that belongs to the source project, as a placement;
  6. writes ticket history (old and new project and key) and an audit entry.

  `task_updated` is sent after commit.
- [x] **A preview call** returns the target key format, the mapped state and whether the ticket leaves a sprint, without writing anything.
- [x] **The ticket capability `canMoveProject`** needs member or higher in the source project.
- [x] **The legacy transfer endpoint** keeps its path and response shape, and moves the ticket into the target team's generated project.
- [x] **The web ticket detail** has "Move to project": a target picker from "my projects", the preview, then confirm. It is hidden without `canMoveProject`.
- [x] **Route test on real PostgreSQL:**
  - A move gives a new key, and the old key opens the ticket through an alias.
  - The state is mapped by key, by category and by the initial-state fallback.
  - The sprint is cleared.
  - The preview matches the actual result.
  - The target project must allow the actor to create, and must not be archived.
  - The legacy transfer maps to the team's project.
- [x] **The existing transfer and placement suites** are updated and pass.
- [x] **Web tests:** the dialog shows the preview and submits; the action is hidden without the capability.
- [x] **Contracts:** the route snapshot, route inventory, OpenAPI and parity checks are updated, and pass.

## Answer

Implemented on `ticket/projects-own-tickets-10`, based on and merged with
integration `ee752b6f569f58da99a1ad5c02e4775c974651ca` (already up to date;
integration was not changed).

- `tasks.placement.ts` owns shared preview/commit validation and workflow mapping.
  Grants, project locks, target counter/key, alias, sprint exit, history and audit
  run in the caller's transaction. Project moves retain legacy `team_id`.
- `POST /api/tasks/:id/move-project/preview` and `/move-project` take
  `{ project_id }`. Preview reserves nothing; commit returns the enriched ticket.
- Legacy `/transfer` maps to the team's generated project, including transferring
  back to a retained legacy team after switch-over. Flag-off ownership behavior
  and response envelopes remain compatible.
- Post-commit invalidation reaches both projects' readers without exposing the
  new key/state to source-only readers.
- Web picker uses accessible, active projects with `canCreateTickets`; confirmation
  requires a current successful preview. Rejected/stale previews cannot submit.
- Route snapshot/inventory, OpenAPI, generated web types, fixtures, parity and
  directly related domain/module documentation were updated.

Validation after merging integration:

- PostgreSQL placement/routes/capability suites: **282 passed, 2 inherited failures**
  (284 total). All **13 ticket10 cases** and the complete placement/capability
  suites pass, including rollback, secondary-team grants and legacy transfer-back.
- Focused server route/effects/delta/snapshot suites: **48 passed**; snapshot passes.
- Web move/capability suites: **12 passed**.
- Contracts/parity/generated-model checks: **78 passed**.
- Server/client typechecks, server dependency boundaries and repository guardrails pass.

Pre-existing failures were independently reproduced on unchanged integration:
`tasks.placementRoutes.integration.test.ts` cases “bulk and cancellation responses
include the refreshed ticket decision” and “ticket mutation responses carry fresh
decisions after every placement and state change” return 409 rather than 200.
The broader mocked `tasks.teamVisibility.routes.test.ts` project-viewer detail
case also returns 403 rather than 200 on integration. These unrelated baseline
failures were not hidden, skipped or repaired by ticket10.

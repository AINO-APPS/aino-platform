# 10: Move a ticket to another project

**What to build:** from the ticket detail on the web, a member moves a ticket to another project they can create in. A preview first shows:

- the new key format;
- which status the ticket will land in;
- whether it will leave its sprint.

After the move, the ticket has a key from its new project and its old key still opens it. It has left the old project's sprint, and its status fits the new project's workflow. The history records the move. Older clients' "transfer to team" moves the ticket into that team's project.

**Blocked by:** 02, 04, 07

**Status:** ready-for-agent

Spec: [projects-own-tickets](../spec.md). Decisions: ADR-017.

- [ ] **The placement module gains a "move to project" operation.** In one transaction it:
  1. checks the actor is a member or higher in both the source and target projects, and that neither project is archived;
  2. takes the next number from the target project;
  3. writes the new key and stores the old key as an alias (reason `move`);
  4. maps the workflow state: same key, otherwise the first active state in the same category, otherwise the initial state;
  5. clears a sprint that belongs to the source project, as a placement;
  6. writes ticket history (old and new project and key) and an audit entry.

  `task_updated` is sent after commit.
- [ ] **A preview call** returns the target key format, the mapped state and whether the ticket leaves a sprint, without writing anything.
- [ ] **The ticket capability `canMoveProject`** needs member or higher in the source project.
- [ ] **The legacy transfer endpoint** keeps its path and response shape, and moves the ticket into the target team's generated project.
- [ ] **The web ticket detail** has "Move to project": a target picker from "my projects", the preview, then confirm. It is hidden without `canMoveProject`.
- [ ] **Route test on real PostgreSQL:**
  - A move gives a new key, and the old key opens the ticket through an alias.
  - The state is mapped by key, by category and by the initial-state fallback.
  - The sprint is cleared.
  - The preview matches the actual result.
  - The target project must allow the actor to create, and must not be archived.
  - The legacy transfer maps to the team's project.
- [ ] **The existing transfer and placement suites** are updated and pass.
- [ ] **Web tests:** the dialog shows the preview and submits; the action is hidden without the capability.
- [ ] **Contracts:** the route snapshot, route inventory, OpenAPI and parity checks are updated, and pass.

# 04: A workflow per project

**What to build:** each project has its own workflow states and transitions. A project admin edits them in project settings on the web, and the change only affects that project. On day one every project's workflow is an exact copy of what the org had, so nobody notices the switch. New projects start from the default template. Every project keeps a terminal Cancelled state.

**Blocked by:** 01, 03

**Status:** resolved

Spec: [projects-own-tickets](../spec.md). Decisions: ADR-017, ADR-014.

- [x] **A tenant migration, separate from ticket 01**, because copying states gives them new ids and transition enforcement has to change in the same release:
  - Workflow states and transitions gain a project.
  - Uniqueness changes from (org, key) to (project, key).
  - The org's current states and transitions are copied into every project, keeping keys, names, categories, colours, order, WIP limits and flags.
  - Each ticket's workflow state points at its project's copy, matched on key.
  - Every project gets a terminal Cancelled state.
  - The org-level rows become a read-only template.
  - Re-running the migration changes nothing. The baseline schema matches.
- [x] **New projects**, including `General` on new tenants and generated projects created later, copy the template when they are created.
- [x] **Transition enforcement and workflow rules** look up the ticket's project workflow. ADR-014 behaviour is unchanged: there is no way out of Cancelled, and Done must be reopened before it can be cancelled.
- [x] **Project admins and org admins** manage states and transitions under the projects resource. The project-level `canEditWorkflow` capability decides who can.
- [x] **The org-level workflow-state endpoints:**
  - Reads still work and accept an optional project. Without one, they return the workflow of the actor's default project.
  - Writes are refused.
  - Work item types and agile settings stay at org level, unchanged.
- [x] **Board columns, reports by category and the completed filter** read the ticket's project workflow.
- [x] **The web's existing agile workflow panels move into project settings,** scoped to the project.
- [x] **Migration test on real PostgreSQL:** custom org states are copied into every project, each ticket's state is repointed, Cancelled exists everywhere, and a re-run changes nothing.
- [x] **Route test on real PostgreSQL:**
  - A state added in project A doesn't appear in project B.
  - Transitions are enforced against the ticket's own project.
  - Org-level writes are refused.
  - A new project gets the template.
- [x] **The existing workflow-lifecycle and workflow-graph suites** are updated to project-scoped workflows and pass.
- [x] **Web tests:** the workflow panel inside project settings saves states and transitions for that project, and is hidden without `canEditWorkflow`.
- [x] **Contracts:** the route snapshot, route inventory and OpenAPI are updated, and parity checks pass.

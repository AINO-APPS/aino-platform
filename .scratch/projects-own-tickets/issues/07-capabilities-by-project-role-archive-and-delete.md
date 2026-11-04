# 07: Capabilities follow project roles; archive and delete

**What to build:** what a person can do to a ticket depends on their role in its project:

- **viewers** read and comment;
- **members** edit, transition, plan and log work;
- **project admins** can also log work for others.

A project admin can archive a finished project. Its tickets become read-only and are labelled as archived, but they still open and appear in search. Only org admins can unarchive. A project can be deleted only if it never had tickets. Buttons on the web always match what the server allows.

**Blocked by:** 06

**Status:** resolved

Claimed on `ticket/projects-own-tickets-07`. Test seams: the public ticket decision,
HTTP routes against PostgreSQL, web capability rendering, and generated API contracts.
These cover authorization and visible controls; unrelated ticket06 multi-team
ownership behavior remains outside this ticket.

Spec: [projects-own-tickets](../spec.md). Decisions: ADR-017, ADR-016.

- [x] **The capabilities decision context** gains the actor's project role and whether the project is archived.
- [x] **Ticket-level rules:**
  - Existing edit, transition and planning capabilities need member or higher.
  - Comment needs viewer or higher, or being the reporter or assignee.
  - `canLogWorkForOthers` is allowed for project admins as well as org admins.
- [x] **New denial reasons:** `READ_ONLY_ROLE` and `PROJECT_ARCHIVED`, added to the reason catalogue and the denial messages. Every write guard consults the decision.
- [x] **Project responses carry all the project-level capabilities:** `canAdminister`, `canCreateTickets`, `canManageMembers`, `canEditWorkflow`, `canRenameKey` and `canArchive`.
- [x] **Archive:**
  - Project admins and org admins can archive; only org admins can unarchive.
  - Archived projects are hidden from pickers.
  - Every write on their tickets is refused with `PROJECT_ARCHIVED`, while reading, searching, opening by key and commenting still work.
- [x] **Delete** stays super-admin only and is allowed only when the project has never had tickets. Its key stays reserved.
- [x] **The web** shows an archived label on tickets and on project settings. Edit controls follow capabilities.
- [x] **The capabilities integration suite's actor table** replaces team membership with project roles:
  - admin, member and viewer, personal or through a team
  - reporter and assignee with no role
  - org admin
  - people with no access
  - the archived project
- [x] **Route test on real PostgreSQL:**
  - A viewer's edit is refused with `READ_ONLY_ROLE`, but their comment succeeds.
  - Writes on an archived project are refused, while reads succeed.
  - Unarchive is refused for a project admin.
  - A project admin can log work for others.
  - Delete is refused for a project that has had tickets.
- [x] **Web tests:** viewer and archived states hide edit controls, and the archived label shows.
- [x] **Contracts:** the generated models, OpenAPI and parity checks are updated, and pass.

## Answer

Implemented on `ticket/projects-own-tickets-07`, including persistent project
ticket-history tracking in migration `0025_project_ticket_history.sql`. The
legacy actor matrix remains as flag-off regression coverage alongside the new
project-role actor table.

Merged integration `95efd02c`, including tickets04/05/06/08/11/12 and the complete
Phase 1 manual-worklog API. This ticket consumes ticket06's resolver; it does not
own its earlier multi-team caveat. The redundant minimal-worklog experiment was
compared against Phase 1 and not reapplied; no duplicate endpoints or migration
were added. History remains migration0025; Phase 1 owns0026/0027.

Extended the existing worklog API and decision policy: project admins may create,
edit and soft-delete other people's worklogs only in their administered project,
including team-derived grants. Per-worklog `canEdit`/`canDelete` use the same
project context as guards. Members/viewers cannot administer others' worklogs;
grant downgrades and archival immediately remove permissions. Org-admin behavior,
org/ticket isolation, original logged-by attribution and mutation history remain.

Final validation on that integration:
- 86 worklog PostgreSQL HTTP tests pass, including the project-admin CRUD,
  scoped-role, cross-org, downgrade, archival and org-admin cases.
- 14 bounded PostgreSQL capability/archive/deletion acceptance cases pass.
- 35 focused project-capability/access/duration Jest tests pass.
- 43 web tests pass across worklog, capability rendering, project settings,
  membership, migration review and selected-project workflow seams.
- Server/client typechecks, server dependency boundaries, generated-model checks,
  parity and 77 contract tests pass.
- All repository guardrails pass, including server/client file sizes.

An additional regression run found one unrelated pre-existing failure:
`projects.routes.characterization` / “clamps paginated list limits and can include
archived projects” expects SQL parameters `[3,200,0]`, while integration's current
project list includes another nullable parameter. That test and project-list
implementation were not changed here. The other70 tests in that run passed.

All ticket07 acceptance cases, including real on-behalf worklog mutations, are
covered; the prior manual-worklog API gap is closed.

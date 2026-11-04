# 07: Capabilities follow project roles; archive and delete

**What to build:** what a person can do to a ticket depends on their role in its project:

- **viewers** read and comment;
- **members** edit, transition, plan and log work;
- **project admins** can also log work for others.

A project admin can archive a finished project. Its tickets become read-only and are labelled as archived, but they still open and appear in search. Only org admins can unarchive. A project can be deleted only if it never had tickets. Buttons on the web always match what the server allows.

**Blocked by:** 06

**Status:** claimed

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
- [ ] **Route test on real PostgreSQL:**
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

Merged integration `a63dd3d2`, including ticket04 workflows, ticket05's privacy
follow-up, ticket06's persisted multi-team memberships and ticket12's migration
review and publication. This ticket consumes
ticket06's resolver; it does not own its earlier multi-team caveat.

Validation after that merge: 42 focused server tests, 14 real-PostgreSQL actor
and route acceptance cases, 19 web tests (including ticket12's migration review),
both TypeScript checks and 62 contract tests pass. Generated models and parity
checks pass. The CRUD file-size overshoot is fixed by sharing creation-conflict
handling. The aggregate guardrail remains blocked only by inherited
`server/routes/sprints.ts` (1005 lines against 959); ticket08 owns its extraction.
The history migration uses 0025, avoiding ticket12's 0023 and ticket08's 0024.

**Completion gap:** the supplied integration does not contain Phase 1's
manual-worklog API (it exists on the separate `integration/manual-worklogs`
branch). Project-admin `logWorkForOthers` is implemented in decisions and exposed
through ticket HTTP responses, but an actual log-for-others HTTP mutation cannot
be exercised here without importing that separate feature. No replacement API
was invented. This issue stays claimed until that acceptance case is integrated
and verified.

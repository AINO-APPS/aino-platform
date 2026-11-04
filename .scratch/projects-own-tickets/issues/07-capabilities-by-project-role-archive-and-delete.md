# 07: Capabilities follow project roles; archive and delete

**What to build:** what a person can do to a ticket depends on their role in its project:

- **viewers** read and comment;
- **members** edit, transition, plan and log work;
- **project admins** can also log work for others.

A project admin can archive a finished project. Its tickets become read-only and are labelled as archived, but they still open and appear in search. Only org admins can unarchive. A project can be deleted only if it never had tickets. Buttons on the web always match what the server allows.

**Blocked by:** 06

**Status:** ready-for-agent

Spec: [projects-own-tickets](../spec.md). Decisions: ADR-017, ADR-016.

- [ ] **The capabilities decision context** gains the actor's project role and whether the project is archived.
- [ ] **Ticket-level rules:**
  - Existing edit, transition and planning capabilities need member or higher.
  - Comment needs viewer or higher, or being the reporter or assignee.
  - `canLogWorkForOthers` is allowed for project admins as well as org admins.
- [ ] **New denial reasons:** `READ_ONLY_ROLE` and `PROJECT_ARCHIVED`, added to the reason catalogue and the denial messages. Every write guard consults the decision.
- [ ] **Project responses carry all the project-level capabilities:** `canAdminister`, `canCreateTickets`, `canManageMembers`, `canEditWorkflow`, `canRenameKey` and `canArchive`.
- [ ] **Archive:**
  - Project admins and org admins can archive; only org admins can unarchive.
  - Archived projects are hidden from pickers.
  - Every write on their tickets is refused with `PROJECT_ARCHIVED`, while reading, searching, opening by key and commenting still work.
- [ ] **Delete** stays super-admin only and is allowed only when the project has never had tickets. Its key stays reserved.
- [ ] **The web** shows an archived label on tickets and on project settings. Edit controls follow capabilities.
- [ ] **The capabilities integration suite's actor table** replaces team membership with project roles:
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
- [ ] **Web tests:** viewer and archived states hide edit controls, and the archived label shows.
- [ ] **Contracts:** the generated models, OpenAPI and parity checks are updated, and pass.

# 12: Migration review and switch-over

**What to build:** a super admin opens a review screen that lists:

- each generated project, with its key, type, ticket count and grants;
- every ticket the migration moved.

They rename any generated key they don't like; nobody has seen these keys yet, so renaming creates no aliases. When they're ready, they press "Switch to projects". The org moves to project ownership, every key becomes published, and from then on renames create aliases. If something goes wrong, a platform admin can switch the org back to team visibility.

**Blocked by:** 05, 06

**Status:** ready-for-agent

Spec: [projects-own-tickets](../spec.md). Decisions: ADR-017.

- [ ] **An admin endpoint returns the review data:**
  - generated projects, with key, published state, type, ticket count and grants;
  - the migration-moves review table, with each ticket's old key, new key and sprint.
- [ ] **Key rename from the review screen** reuses ticket 05's rename, and creates no aliases while the key is unpublished.
- [ ] **"Switch to projects"** is super-admin only. In one transaction it marks every project key published and turns `project_ownership` on. It is audited and can't be run twice.
- [ ] **The emergency switch-back** is platform-admin only. It turns the flag off, so visibility comes from `team_id` again. It is audited, and keys stay published.
- [ ] **The web super-admin review screen** shows projects and moves, with inline rename and the switch, behind a confirmation.
- [ ] **Route test on real PostgreSQL:**
  - The review lists generated projects and moves.
  - A rename before the switch creates no aliases; a rename after the switch creates aliases.
  - The switch turns the flag on and publishes keys.
  - Non-super-admins are refused.
  - The switch-back restores team visibility.
- [ ] **Web tests:** the review screen renders projects and moves, rename works, and the switch needs confirmation.
- [ ] **Contracts:** the route snapshot, route inventory and OpenAPI are updated, and parity checks pass.

# 12: Migration review and switch-over

**What to build:** a super admin opens a review screen that lists:

- each generated project, with its key, type, ticket count and grants;
- every ticket the migration moved.

They rename any generated key they don't like; nobody has seen these keys yet, so renaming creates no aliases. When they're ready, they press "Switch to projects". The org moves to project ownership, every key becomes published, and from then on renames create aliases. If something goes wrong, a platform admin can switch the org back to team visibility.

**Blocked by:** 05, 06

**Status:** resolved

Claimed on branch `ticket/projects-own-tickets-12`. Public test seams: tenant HTTP review/switch endpoints with real PostgreSQL (authorization, atomic persistence and visibility), existing rename HTTP endpoint (publication aliases), and web review component (render, rename and confirmation).

Spec: [projects-own-tickets](../spec.md). Decisions: ADR-017.

- [x] **An admin endpoint returns the review data:**
  - generated projects, with key, published state, type, ticket count and grants;
  - the migration-moves review table, with each ticket's old key, new key and sprint.
- [x] **Key rename from the review screen** reuses ticket 05's rename, and creates no aliases while the key is unpublished.
- [x] **"Switch to projects"** is super-admin only. In one transaction it marks every project key published and turns `project_ownership` on. It is audited and can't be run twice.
- [x] **The emergency switch-back** is platform-admin only. It turns the flag off, so visibility comes from `team_id` again. It is audited, and keys stay published.
- [x] **The web super-admin review screen** shows projects and moves, with inline rename and the switch, behind a confirmation.
- [x] **Route test on real PostgreSQL:**
  - The review lists generated projects and moves.
  - A rename before the switch creates no aliases; a rename after the switch creates aliases.
  - The switch turns the flag on and publishes keys.
  - Non-super-admins are refused.
  - The switch-back restores team visibility.
- [x] **Web tests:** the review screen renders projects and moves, rename works, and the switch needs confirmation.
- [x] **Contracts:** the route snapshot, route inventory and OpenAPI are updated, and parity checks pass.

## Answer

Implemented on `ticket/projects-own-tickets-12`, based on clean integration
`63ed28c316431346a416f3362b7cf3c3f3caf555`. Latest integration merged before final
validation (already up to date). No integration branch changes.

- Review: `GET /api/projects/migration/review`; generated projects, grants/counts,
  publication state and all migration moves. Current new keys follow review
  renames while `migration_key` retains the historical target.
- Switch: `POST /api/projects/migration/switch` requires exactly `super_admin`.
  Organization locking, key publication, flag, retained timestamp and audit are
  transactional. Concurrent/repeated calls conflict, including after rollback.
- Emergency: `POST /api/projects/migration/switch-back` requires exactly
  `platform_admin`, restores team visibility and audits without unpublishing.
- Migration `0023_project_ownership_switch.sql` retains first-publication time.
  Web entry: Projects → Review project migration. All admin endpoints are web-only.

Verified: real PostgreSQL migration-review lifecycle, authorization, concurrent
switch, audit-failure rollback and actual team-visibility restoration; existing
rename integration and project-route characterization; route snapshot (4 tests);
server typecheck/build/layering; client typecheck and focused UI suites (8 tests);
contract validation, parity and tokens; contract tests excluding native generated
models (57 tests); migration shipping/baseline and all unaffected guardrails.

Inherited validation gaps, not ticket12 changes:
`check:guardrails` stops at server file-size baselines (`sprints.ts` 1005/959 and
`tasks/crud.ts` 685/682). Full `contracts:validate` stops at pre-existing iOS
`TaskModelsGenerated.swift` drift; generated web models remain current. Native
output was not changed. Ticket07/08 are addressing the inherited server ceilings.

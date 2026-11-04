# 06: Visibility follows project roles (behind the flag)

**What to build:** in an org where `project_ownership` is on, a person sees a ticket if any of these is true:

- they are an org admin;
- they have any role in its project, personally or through any of their teams;
- they are its reporter or assignee.

Every surface follows this rule, so a project's tickets are invisible to people with no access. In an org where the flag is off, nothing changes. Older clients that still send a team scope keep working.

**Blocked by:** 03

**Status:** claimed

Spec: [projects-own-tickets](../spec.md). Decisions: ADR-017 (supersedes ADR-013).

- [ ] **The single visibility policy module is rewritten.** With the flag on, it uses the project access module's accessible projects plus reporter and assignee. With the flag off, it keeps today's team and legacy-team behaviour exactly.
- [ ] **The `project_ownership` flag replaces `team_visibility` as the policy switch.**
- [ ] **List requests can narrow to one project or to personal scope.** The team switcher and the Unassigned bucket are removed from the policy when the flag is on.
- [ ] **Legacy list parameters** still work with the flag on:
  - `team_id` resolves to that team's generated project, and only if the actor can access it.
  - `unassigned` returns an empty list.
- [ ] **Every surface that already goes through the policy follows the new rule:** list, detail, history, comments, attachments, dependencies, rank, bulk, search, export, carry-over, the notes picker, mentions, Service Desk lists and sprint lists. No surface adds its own predicate.
- [ ] **Route test on real PostgreSQL**, with the flag on:
  - visibility for a personal grant, a team grant, and the highest of several
  - membership of several teams spanning several projects
  - reporter and assignee with no role
  - org admins
  - people with no access, on each surface group
  - legacy `team_id` and `unassigned`

  With the flag off: results are identical to today.
- [ ] **The existing mocked team-visibility routes suite and the policy unit tests** are rewritten for project roles, with flag-off cases kept.
- [ ] **Contracts:** OpenAPI documents the project scope parameter, and parity checks pass.

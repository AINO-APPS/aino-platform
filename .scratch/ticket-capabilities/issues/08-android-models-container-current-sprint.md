# 08: Android models, container and current sprint

**What to build:** Android reads `container`, `capabilities` and
`currentSprintId` from the server. Lists place tickets by the server's
container and the app lands on the server's current sprint, so a paused-only
team keeps its Sprint view (fixes B7) and the Scheduled rule can no longer drift
(fixes B8).

**Blocked by:** 02, 03

**Status:** complete

## Context

- Spec §Clients render, never derive (Android), §Contracts and rollout; ADR-016.
- Android DTOs are hand-written (generation is disabled); a fixture test guards
  them against contract drift.
- Container is re-derived today by the backlog-item check and the
  `belongsTo*` membership checks; landing uses several "first active sprint"
  helpers. The Scheduled KDoc says "planned or due" (B8).
- Cosmetic sprint-status uses (pills, "days left") are unchanged.

## Acceptance criteria

- [ ] Hand-written DTOs gain `container`, `capabilities` (transitions and `can`
      with reasons), board column WIP and `currentSprintId`.
- [ ] A unit test parses the shared contract fixtures (ticket with capabilities,
      board, sprint list with current sprint) into the DTOs and fails on drift.
- [ ] Backlog, Scheduled and sprint list membership read `container`; the
      backlog-item check and `belongsTo*` membership checks are deleted.
- [ ] Landing, team switching and insights use `currentSprintId`; the "first
      active sprint" helpers used for selection are deleted.
- [ ] A team with only a paused sprint lands on that sprint.
- [ ] No Scheduled description mentions a due date.
- [ ] `tasks-parity.json` records Android status for container and current sprint.

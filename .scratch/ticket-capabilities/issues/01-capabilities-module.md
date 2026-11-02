# 01: Capabilities module and its PostgreSQL suite

**What to build:** One server module that decides, for an actor and a batch of
tickets, each ticket's **container** (`sprint` / `scheduled` / `backlog`) and its
**capabilities** (`transitions` and `can`, with reason codes). Covered by a
table-driven suite against real PostgreSQL. No route uses it yet.

**Blocked by:** None (can start immediately)

**Status:** complete

## Context

- Spec §Implementation Decisions → "Server: one decision module" and
  "Capability shape"; ADR-016.
- The rule functions to compose already exist: transition legality and the
  lifecycle context loader in the workflow module, access / status-change /
  cancel permissions in the policy module and route access helpers, team-sprint
  ownership in the ownership module, sprint freeze, and the in-sprint scheduling
  rule (P4) from the placement module.
- Container predicates must match the collection builder (ADR-015).
- Prior art for the suite: the placement module's PostgreSQL integration suite
  and the tenant-schema integration setup (skipped when the test DB URL is unset).

## Acceptance criteria

- [ ] A batch decide call takes the actor, tickets and a lifecycle context loaded
      once, and returns `{ container, capabilities }` per ticket with no per-ticket
      query. A single-ticket form exists for the write path.
- [ ] `container` follows ADR-015: sprint wins over a planned day, a planned day
      wins over the backlog, a due date never decides.
- [ ] `transitions` has one entry for every active workflow state other than the
      current one, each `{ to, allowed, reason? }`. A Cancelled ticket has every
      entry disallowed with `CANCELLED_TERMINAL`.
- [ ] `can` covers `edit`, `changeState`, `cancel`, `transfer`, `delete`,
      `placeInSprint`, `schedule`, each `{ allowed, reason? }`. `schedule` is
      disallowed with `IN_SPRINT` for a sprinted ticket.
- [ ] Reasons are drawn only from `INVALID_TRANSITION`, `ACCESS_DENIED`,
      `SPRINT_FROZEN`, `IN_SPRINT`, `SPRINT_TEAM_MISMATCH`, `CANCELLED_TERMINAL`.
- [ ] WIP capacity does not affect any ticket's `allowed`.
- [ ] Table-driven PostgreSQL suite: actor role (member, assignee, reporter, org
      admin, non-member) × team membership × workflow state (default, custom,
      Cancelled) × container × sprint status (planned, active, paused, completed)
      → expected container, every transition entry, every `can` entry and reason.

# 06: Team transfer through placement

**What to build:** Admin team transfer calls `transferTicket`, so leaving the
sprint on transfer writes history and realtime like any other placement (B4).

**Blocked by:** 02

**Status:** done (2026-11-02)

## Context

- `tasks.ownership.ts:162-176` clears `sprint_id` and restores the due date in
  inline SQL; `routes/tasks/transfer.ts:55` writes the transfer audit.
- Spec P1, P14.

## Acceptance criteria

- [x] No inline placement SQL remains in `tasks.ownership.ts`.
- [x] Transfer out of a sprint writes sprint history, keeps the planned day,
      restores the own due date and emits `task_updated` to **both** teams after
      commit.
- [x] Transfer from a completed sprint is rejected with `SPRINT_FROZEN`.
- [x] `tasks.teamOwnership.test.ts` passes; transfer rows added to the
      placement suite.

## Comments

- 2026-11-02: Routed admin transfers through transactional `transferTicket`,
  removed the legacy ownership SQL, and retained the transfer response details.
  Verified ownership, route, realtime-effects, and placement PostgreSQL tests,
  server typecheck, dependency layering, and repository guardrails.

# 04: Bulk sprint move through placement

**What to build:** The bulk `sprint` action calls the placement module once for
the whole batch, fixing B1 (bulk never set the due date to the sprint's end).

**Blocked by:** 02

**Status:** done (2026-11-02)

## Context

- `routes/tasks/bulk.ts:112-139` loops tickets, calls `setSprint`, logs history
  and notifies per ticket, no transaction.
- Spec P3, P10, P13.

## Acceptance criteria

- [x] One transaction per bulk request; valid tickets written, skipped tickets
      reported with the module's code in the existing per-ticket `results` shape.
- [x] Each moved ticket's `due_date` equals the target sprint's end; leaving
      restores the own due date.
- [x] An unexpected DB error rolls back the whole batch and returns 500.
- [x] `setSprint` is deleted from `tasks.repository.ts`.
- [x] `tasks.bulkCancelCompleted.test.ts` and other bulk route tests still pass;
      new route test covers mixed valid/skipped mapping.

## Comments

**2026-11-02 — implemented** in `83743834`. Bulk sprint moves pass the
authorized batch to `placeTickets` once inside one transaction; module refusal
codes are preserved in each result, while unexpected transaction errors reach
the route's 500 handler. The route no longer owns sprint due-date writes,
history or notifications, and `setSprint` was removed. The placement-write
ratchet was lowered for the removed repository writes.

Tests: `dbPool.test.ts`, `tasks.bulkPlacement.test.ts`,
`tasks.bulkCancelCompleted.test.ts` and `tasks.placementRoutes.test.ts` passed
(37 tests); `npm run typecheck` and `node scripts/check-placement-writes.mjs`
passed. The PostgreSQL placement integration suite was skipped because its
database environment was unavailable. The branch was merged with
`feat/ticket-placement` (already up to date; no conflicts).

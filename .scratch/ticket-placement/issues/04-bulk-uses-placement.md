# 04: Bulk sprint move through placement

**What to build:** The bulk `sprint` action calls the placement module once for
the whole batch, fixing B1 (bulk never set the due date to the sprint's end).

**Blocked by:** 02

**Status:** ready-for-agent

## Context

- `routes/tasks/bulk.ts:112-139` loops tickets, calls `setSprint`, logs history
  and notifies per ticket, no transaction.
- Spec P3, P10, P13.

## Acceptance criteria

- [ ] One transaction per bulk request; valid tickets written, skipped tickets
      reported with the module's code in the existing per-ticket `results` shape.
- [ ] Each moved ticket's `due_date` equals the target sprint's end; leaving
      restores the own due date.
- [ ] An unexpected DB error rolls back the whole batch and returns 500.
- [ ] `setSprint` is deleted from `tasks.repository.ts`.
- [ ] `tasks.bulkCancelCompleted.test.ts` and other bulk route tests still pass;
      new route test covers mixed valid/skipped mapping.

# 03: Ticket routes place through the module

**What to build:** Create, quick-add, PUT, sprint join/leave and
schedule/unschedule stop writing container columns and call the placement module
inside a transaction.

**Blocked by:** 02

**Status:** ready-for-agent

## Context

- Create `routes/tasks/crud.ts:235-266`; PUT `crud.ts:374-601` (via
  `planSprintEdit`, `tasks.sprintAssignment.ts:57-121`); quick-add
  `routes/tasks/backlog.ts:323-337`; schedule/unschedule `backlog.ts:362-399`;
  assign-sprint `routes/tasks/sprints.ts:123-165`.
- Spec P2, P4, P14.

## Acceptance criteria

- [ ] Create and quick-add insert with no container, then place in the same
      transaction; no route writes `pre_sprint_due_date` directly.
- [ ] PUT routes container changes through placement; `planned_date` is ignored
      for a sprinted ticket.
- [ ] `PATCH /:id/schedule` returns `409 { code: "IN_SPRINT" }` for a sprinted
      ticket and `SPRINT_FROZEN` / 403 as the module decides.
- [ ] `PATCH /:id/assign-sprint` keeps its request/response shape.
- [ ] Realtime for these routes now comes from the module's outbox; no duplicate
      `task_updated` from the handler.
- [ ] Route tests assert HTTP mapping only; mocked-SQL tests that asserted the
      replaced fragments are deleted.

# 03: Ticket routes place through the module

**What to build:** Create, quick-add, PUT, sprint join/leave and
schedule/unschedule stop writing container columns and call the placement module
inside a transaction.

**Blocked by:** 02

**Status:** done (2026-11-02)

## Context

- Note → ticket `routes/notes.ts:541` inserts `sprint_id` / `planned_date`
  directly (spec B10); service-desk mirror `tasks.serviceDesk.ts:30` and
  carry-forward `routes/tasks/carryForward.ts:90` insert `planned_date`.
- Create `routes/tasks/crud.ts:235-266`; PUT `crud.ts:374-601` (via
  `planSprintEdit`, `tasks.sprintAssignment.ts:57-121`); quick-add
  `routes/tasks/backlog.ts:323-337`; schedule/unschedule `backlog.ts:362-399`;
  assign-sprint `routes/tasks/sprints.ts:123-165`.
- Spec P2, P4, P14.

## Acceptance criteria

- [x] Create and quick-add insert with no container, then place in the same
      transaction; no route writes `pre_sprint_due_date` directly.
- [x] PUT routes container changes through placement; `planned_date` is ignored
      for a sprinted ticket.
- [x] `PATCH /:id/schedule` returns `409 { code: "IN_SPRINT" }` for a sprinted
      ticket and `SPRINT_FROZEN` / 403 as the module decides.
- [x] `PATCH /:id/assign-sprint` keeps its request/response shape.
- [x] Realtime for these routes now comes from the module's outbox; no duplicate
      `task_updated` from the handler.
- [x] Route tests assert HTTP mapping only; mocked-SQL tests that asserted the
      replaced fragments are deleted.
- [x] Note → ticket, service-desk mirror and carry-forward create with no
      container and place in the same transaction.
- [x] `node scripts/check-placement-writes.mjs` baseline lowered for every file
      this issue touches.

## Comments

**2026-11-02 — implemented.** Routes use `routes/tasks/_helpers/placement.ts`
(context from the request; refusal codes → HTTP: `IN_SPRINT` / `SPRINT_FROZEN`
/ `SPRINT_TEAM_MISMATCH` 409, `SPRINT_NOT_FOUND` / team codes 400,
`NOT_FOUND` 404). Decisions taken with the user: a ticket created straight
into a sprint gets **no planned day**; creation broadcasts `task_updated` but
sends **no** sprint-added notification (`notify: false`). PUT computes the
move with the pure `editPlacement` (resending the current sprint, or `null`
when there is none, is *not* a sprint change), places first, then writes the
plain fields in the same transaction, so a typed due date wins.
`tasks.sprintDueDate.test.ts` (mocked SQL for the removed helpers) deleted per
P15. Placement-writes baseline 34 → 17. Review fixed: notes route had no
`req.userOrgId` (now passes the user's org), planned day lost on full saves,
typed due date lost when the sprint was resent, empty duplicate broadcast,
double planned-day history on carry-forward.
Tests: `tasks.placementRoutes.test.ts` (seam A), `tasks.editPlacement.test.ts`,
`tasks.placementRoutes.integration.test.ts` (seam B, real PostgreSQL). PG
suites now each get their own database (`server/test-support/pgTestDatabase.ts`):
the tenant schema's idempotence checks are not schema-scoped (ADR-001 assumes a
database per tenant), so suites sharing one database corrupted each other.

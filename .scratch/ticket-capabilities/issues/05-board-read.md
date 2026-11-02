# 05: Board read with column WIP status

**What to build:** `GET /sprints/:id/board` returns the sprint, its columns with
WIP status, and its tickets (with capabilities), Cancelled excluded server-side.
Clients get everything the board needs in one read.

**Blocked by:** 03

**Status:** complete

## Context

- Spec §Board read; ADR-016 decision 3; ADR-014 decision 4 (WIP hard-blocks; the
  board disables over-limit targets); GLOSSARY "Board", "Column", "Cancelled".
- WIP limits live on workflow states and are enforced only when the org enables
  them. WIP status is a column fact, never a ticket capability.
- `GET /tasks?sprint_id=…` keeps working.

## Acceptance criteria

- [ ] Response is `{ sprint, columns, tickets }`; each column is
      `{ stateId, count, limit, accepting }`, one per active workflow state except
      Cancelled, in workflow order.
- [ ] `accepting` is `false` only when the org has WIP limits enabled and the
      column's count has reached its limit.
- [ ] Cancelled tickets are absent from `tickets`; there is no Cancelled column.
- [ ] Tickets carry `container` and `capabilities` (via ticket 03).
- [ ] Access follows existing sprint access rules (403 / 404 as today).
- [ ] OpenAPI documents the endpoint; a shared board fixture validates under
      `contracts:validate`.
- [ ] Route integration tests cover WIP on/off, a full column, Cancelled
      exclusion, and access denial.

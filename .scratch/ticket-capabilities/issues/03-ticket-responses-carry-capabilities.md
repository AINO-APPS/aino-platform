# 03: Every ticket response carries container and capabilities

**What to build:** Every API response that returns tickets includes `container`
and `capabilities` for the requesting user, so any client can render decisions
from whatever ticket it already has.

**Blocked by:** 01

**Status:** ready-for-agent

## Context

- Spec §Where the fields appear, §Contracts and rollout; ADR-016 decisions 1, 5, 6.
- Prefactor: the shared ticket enrichment step currently takes only the tickets
  and a DB handle. It needs the actor (and a lifecycle context loaded once per
  request) to call the capabilities module. All callers pass it.
- Surfaces: list and sprint filter, backlog, Scheduled, quick-add, single ticket,
  detail, by-key, search, My Work / dashboard ticket lists, and every write that
  changes a ticket (create, PUT, PATCH, status change, schedule/unschedule, sprint
  join/leave, bulk, cancel, transfer).
- Additive only: nothing is removed from responses (older Android builds).

## Acceptance criteria

- [ ] The enrichment step receives the actor and evaluates the capabilities module
      once per request; no per-ticket query is added.
- [ ] Every surface listed above returns `container` and `capabilities` on each
      ticket. Bulk returns them per ticket entry.
- [ ] Every write that changes a ticket returns the updated ticket with fresh
      `container` and `capabilities`.
- [ ] OpenAPI gains the `container` and `capabilities` shapes on the ticket
      schema; a shared fixture of a ticket with capabilities validates under
      `contracts:validate`. Web generated models and iOS generated models update.
- [ ] Route integration tests assert the fields on each ticket-returning endpoint
      and on each write response, and that two users see different
      `capabilities` for the same ticket.
- [ ] No existing response field is removed or renamed.

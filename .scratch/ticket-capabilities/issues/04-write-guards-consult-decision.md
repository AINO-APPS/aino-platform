# 04: Write-path guards consult the decision

**What to build:** The server refuses a write exactly when the capabilities
module says the action is not allowed, with the same reason code. What a user is
shown and what the server accepts can no longer diverge.

**Blocked by:** 01

**Status:** ready-for-agent

## Context

- Spec §Server: one decision module; ADR-016 decision 2; ADR-014 (server-side
  enforcement stays authoritative).
- Today the lifecycle move assertion and the route access helpers each evaluate
  rules directly. They should consult the module's single-ticket decision
  instead of re-implementing it.
- WIP stays a write-time check (`409 WIP_EXCEEDED`); it is not part of the
  ticket decision.

## Acceptance criteria

- [ ] The lifecycle move assertion and the access / cancel / transfer / schedule /
      sprint-placement guards obtain their verdict from the capabilities module.
- [ ] For every row of the ticket 01 table, a write the decision disallows is
      rejected, and its error code equals the decision's `reason`; a write the
      decision allows is not rejected on those grounds.
- [ ] `WIP_EXCEEDED` is still returned when a target column is full.
- [ ] Existing HTTP status codes for each denial (403 / 404 / 409) are preserved.
- [ ] Tests that asserted the old guard internals are deleted, not layered.

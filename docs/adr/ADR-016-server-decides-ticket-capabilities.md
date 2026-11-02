# ADR-016: The server decides Ticket capabilities; clients render them

- **Status:** Accepted
- **Date:** 2026-11-02
- **Related:** ADR-013 (ticket team ownership), ADR-014 (workflow transition enforcement), ADR-015 (three planning containers), architecture review 2026-11-01 candidate #2

## Context

The server enforces transitions, WIP limits, team ownership, sprint freeze and
the planning containers. Web/desktop (`workflowTargets.ts`, `boardTargets.ts`,
`status === "active"` sprint picking) and Android (`canTransition`,
`isBacklogItem`, `belongsTo*`, `activeSprintId`) each re-derive the same rules
to decide what to enable and where a ticket belongs. The copies drift: a
fallback graph with `id: 0` states collapses, Android treats an empty graph as
"allowed", both clients lose a team whose only sprint is paused, and Android's
docs describe Scheduled with the wrong rule. iOS would add a fourth copy.

`GET /api/agile/config` already ships the transition graph, so clients *could*
evaluate it locally. But legality also depends on the actor's role, team
membership and sprint freeze, which the graph does not carry.

## Decision

**The server decides; clients render.** No client keeps a fallback copy of the
rules.

1. Every ticket the API returns carries its **container** (`sprint`,
   `scheduled`, `backlog`) and its **capabilities**: one entry per other
   workflow state (`{ to, allowed, reason? }`) and a `can` set (`edit`,
   `changeState`, `cancel`, `transfer`, `delete`, `placeInSprint`, `schedule`).
   Denial reasons are the API's existing error codes.
2. One server module decides capabilities. The serializer and the write-path
   guards use it, so what a client is shown and what the server accepts cannot
   diverge.
3. **WIP status belongs to the column, not the ticket.** A board read returns
   per-column `{ count, limit, accepting }`; the write path still returns
   `409 WIP_EXCEEDED` as the final check.
4. The server names each team's **current sprint** (active, else paused, else
   none).
5. Writes return the fresh ticket; realtime stays `{ taskId, action }` and
   clients refetch, because capabilities are per-user and an event goes to a
   whole team.
6. Rollout is additive: the graph in `/api/agile/config` stays until older
   Android builds are no longer in use.

## Consequences

### Positive

- One place to fix a rule; clients and new platforms (iOS) inherit it.
- ADR-014's "the board disables illegal targets" becomes the same decision the
  server enforces, not a client approximation.
- Rule tests live on the server; client tests only check rendering.

### Negative / accepted trade-offs

- Every ticket payload grows, and each request loads the lifecycle context once.
- Clients cannot answer "may I?" offline; they show the last fetched answer and
  the server rejects stale ones.
- A capability can be stale between a move by someone else and the refetch. The
  server's guard is the source of truth; a stale control only yields a rejected
  write.

## Alternatives considered

- **Clients evaluate the graph from `/api/agile/config`.** Rejected: it keeps a
  rules engine in every client and still misses role, team and freeze checks.
- **Per-ticket WIP flag.** Rejected: it goes stale whenever another ticket
  moves, and realtime carries no counts.
- **Capabilities in realtime events.** Rejected: capabilities are per-user, and
  events are broadcast per team.
- **Keep client logic as a fallback.** Rejected: two sources of truth is the
  drift this ADR removes.

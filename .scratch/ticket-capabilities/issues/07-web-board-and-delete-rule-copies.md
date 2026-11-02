# 07: Web/desktop board on the board read; client rule copies deleted

**What to build:** The web/desktop board loads from the board read. Drop targets
are enabled only where the ticket's transition is allowed and the column is
accepting; column headers show count against limit. The client's own workflow
and board rule copies are deleted (fixes B9 on web/desktop).

**Blocked by:** 05, 06

**Status:** complete

## Context

- Spec §Clients render, never derive; ADR-016; ADR-014 "the board disables
  illegal targets".
- The workflow-target and board-target hooks currently re-derive the transition
  graph, legal targets and WIP occupancy, including fallback states with no real
  id that collapse the graph (B9).
- Realtime: refetch the board when a `task_updated` event touches a ticket on the
  shown board.

## Acceptance criteria

- [ ] The board reads `GET /sprints/:id/board`; Cancelled never appears.
- [ ] While dragging, a column is a valid target only when the dragged ticket's
      transition to that state is allowed **and** the column is `accepting`;
      invalid targets are visibly disabled with reason copy (WIP shows a capacity
      reason).
- [ ] Column headers show `count / limit` when a limit exists.
- [ ] A `task_updated` event for a ticket on the shown board refetches the board.
- [ ] The workflow-target and board-target hooks and their unit tests are deleted;
      no client code evaluates the transition graph or WIP occupancy.
- [ ] Rendering tests drive the board from the shared board fixture.
- [ ] `tasks-parity.json` updated; `contracts:validate` passes.

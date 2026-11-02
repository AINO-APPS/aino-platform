# 09: Android board and actions render server decisions

**What to build:** The Android board loads from the board read and every ticket
action follows `capabilities`: illegal moves and full columns are disabled before
the drop, status menus show every state with reasons, and a change returns the
whole fresh ticket. Android's own transition check is deleted (fixes B9 on
Android).

**Blocked by:** 05, 08

**Status:** complete

## Context

- Spec §Clients render, never derive (Android), §Freshness; ADR-016.
- Android's transition check treats an empty or missing graph as "allowed" (B9).
- The server-patch step currently copies only state and completion time from a
  write response; it should replace the whole ticket.
- Out of scope: the optimistic move and unordered undo (B5) belong to review
  candidate #3.

## Acceptance criteria

- [ ] The board reads `GET /sprints/:id/board`; Cancelled never appears; column
      headers show `count / limit` when a limit exists.
- [ ] A drop target is enabled only when the ticket's transition is allowed and the
      column is `accepting`; disabled targets show reason copy.
- [ ] Status menus, cancel, transfer, delete, add-to-sprint, schedule and bulk
      actions follow `capabilities`, with reason copy from one code → copy mapping
      shared with rejected-write messages.
- [ ] After a write, the whole ticket is replaced from the response; on
      `task_updated` the ticket (and the shown board) is refetched.
- [ ] A ticket missing `capabilities` renders every action disabled.
- [ ] Android's transition check is deleted; no Android code evaluates the
      transition graph or WIP occupancy.
- [ ] Rendering tests (alongside the existing task card tests) drive the UI from
      the shared fixtures; no test asserts rule logic.
- [ ] `tasks-parity.json` records Android capability rendering.

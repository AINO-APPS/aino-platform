# Spec — Ticket capabilities: the server decides, clients render

**Status:** ready-for-agent
**Date:** 2026-11-02
**Branch:** `feat/ticket-capabilities`, cut from main after `feat/ticket-placement` merges
**Surfaces:** server, contracts, web/desktop, Android. iOS is out of scope (it inherits the fields through generated models).
**Decisions:** [ADR-016](../../docs/adr/ADR-016-server-decides-ticket-capabilities.md), [ADR-014](../../docs/adr/ADR-014-workflow-transition-enforcement.md), [ADR-015](../../docs/adr/ADR-015-three-planning-containers.md), [ADR-013](../../docs/adr/ADR-013-ticket-team-ownership.md)
**Vocabulary:** [GLOSSARY.md](../../GLOSSARY.md) — Capability, Current sprint, Transition, Placement, Backlog, Scheduled, Column, Board, Cancelled
**Origin:** architecture review 2026-11-01, candidate #2

---

## Problem Statement

A team member looking at the board, the backlog or a ticket on web, desktop or
Android is shown controls and drop targets that each client works out for
itself. The server is the real authority on Transitions, WIP limits, team
ownership, sprint freeze and planning containers, but every client keeps its own
copy of those rules, and the copies disagree:

- A move the board offers can be refused by the server, so the user drags a card
  and watches it snap back with an error.
- A move the server would accept can be hidden because a client's fallback
  workflow graph collapsed (fallback states with no real id), while Android
  treats an empty graph as "everything allowed".
- A team whose only sprint is paused loses its Sprint view on both clients,
  because both pick the landing sprint by "active" only.
- Android's description of Scheduled says "planned or due date"; the server and
  ADR-015 say planned day only. The next edit will follow the wrong rule.
- Cancelled tickets can leak onto the board, because excluding them is left to
  each client.
- iOS would need a fourth copy of all of this.

Every rule change has to be made in three languages, and drift is found by users.

## Solution

The server decides what the current user may do to each ticket and which
planning container it is in, and sends that decision with the ticket. Clients
render it: a control is enabled when the server says the action is allowed, a
column accepts a drop when the server says it can, and a ticket appears in the
backlog, Scheduled or the sprint because the server says that is its container.
Clients no longer keep any copy of the rules.

The board gets its own read, which returns the sprint's columns with their WIP
status alongside the tickets, Cancelled already excluded. Each team's **current
sprint** (active, else paused, else none) is named by the server, so a paused
sprint is still where the team lands.

The server still enforces every write. If a client shows a decision that went
stale because someone else moved a ticket, the worst case is a rejected write
with the same reason code the disabled control would have shown.

## User Stories

### Moving tickets on the board

1. As a team member, I want columns I cannot move a ticket into to be visibly disabled before I drop it, so that I don't have to try a move to find out it is illegal.
2. As a team member, I want a disabled column to tell me why (illegal transition, frozen sprint, no access), so that I know whether to ask someone or move the ticket elsewhere first.
3. As a team member, I want a column at its WIP limit to refuse drops before I let go, so that WIP limits feel like a rule, not an error after the fact.
4. As a team member, I want the column header to show its count against its WIP limit, so that I can see capacity at a glance.
5. As a team member, I want the board to offer exactly the moves the server will accept, so that a card never snaps back after a drop the board allowed.
6. As a team member, I want Cancelled tickets never to appear on the board, so that the board shows only work in flight.
7. As a team member, I want a ticket I just moved to show its updated actions immediately, so that, for example, a ticket moved to Done offers "reopen" without a refresh.
8. As a team member, I want the board to stay correct when a teammate moves a ticket, so that column counts and allowed moves reflect the latest state.
9. As a team member on a team with custom workflow states, I want the board to reflect my org's real transition graph, so that custom states are not blocked or wrongly allowed by a client fallback.
10. As a team member, I want moving a ticket on Android to obey the same rules as on web, so that I get the same answer on every device.

### Ticket actions

11. As a team member, I want the status menu on a ticket to list every other workflow state with the illegal ones disabled, so that I can see the whole workflow and where this ticket can go.
12. As a ticket's assignee, I want "cancel" to be available only when the server would accept it, so that I am not offered to cancel a Done ticket that must be reopened first.
13. As a team member, I want "schedule on a day" to be disabled for a ticket that is in a sprint, with the reason shown, so that I understand the sprint already decides when it happens.
14. As a team member, I want "add to sprint" to be disabled when the ticket cannot be placed in a sprint (frozen sprint, another team's sprint, no access), so that I don't pick a sprint only to be refused.
15. As a team member, I want edit controls disabled on tickets I can read but not edit, so that I don't type changes that will be rejected.
16. As an org admin, I want "transfer to another team" offered only to people allowed to transfer, so that ordinary members are not shown an action they cannot take.
17. As a team member, I want "delete" offered only where the server allows it, so that destructive actions are not shown to the wrong people.
18. As a team member, I want bulk actions to use each selected ticket's own allowed actions, so that a mixed selection shows clearly which tickets will be skipped and why.
19. As a team member, I want the reason a bulk item was skipped to match the reason its control was disabled, so that the two never contradict each other.
20. As a team member, I want the ticket detail view and the card to agree on what I may do, so that the same ticket never offers different actions in two places.

### Planning containers

21. As a team member, I want a ticket to appear in the backlog, Scheduled or the sprint because the server says that is its container, so that every list on every client agrees.
22. As an Android user, I want Scheduled to contain only tickets with a planned day and no sprint, so that a due date never moves a ticket out of the backlog.
23. As a team member, I want a ticket I just placed into a sprint to leave the backlog list straight away, so that I don't see it in two places.
24. As a team member, I want a ticket that leaves its sprint but keeps its planned day to show up in Scheduled, so that planned work is not lost into the backlog.
25. As a team member, I want My Work and search results to show the same container as the Plan area, so that a ticket's location is consistent across screens.

### Current sprint

26. As a team member on a team whose sprint is paused, I want to land on that paused sprint, so that the team's committed work is still one tap away.
27. As a team member on a team with an active sprint, I want to land on the active sprint, so that nothing changes for the common case.
28. As a team member on a team with only planned or completed sprints, I want to land on the backlog, not a stale sprint, so that I am not shown finished or not-yet-started work as current.
29. As a team member who switches teams, I want the new team's current sprint chosen by the same rule on every client, so that switching teams lands in the same place everywhere.
30. As a team member, I want the sprint header, insights and sprint selector to agree on which sprint is current, so that the app never points at two "current" sprints.

### Freshness and consistency

31. As a team member, I want every change I make to return the updated ticket with its new actions, so that the client never guesses what changed.
32. As a team member, I want realtime updates to refresh the affected ticket and, when needed, the board, so that capacity and allowed moves stay correct without a manual refresh.
33. As a team member, I want a stale action I click to fail with the same reason I would now see, so that a race with a teammate is understandable.
34. As a team member, I want the app to show the last known actions while offline and the server to refuse changes it would reject, so that offline use is honest about what it cannot decide.

### Platform and maintainers

35. As a maintainer, I want one server module to decide capabilities and container, so that a rule is fixed in exactly one place.
36. As a maintainer, I want the write path to use the same decision as the response, so that what the user is shown and what the server accepts cannot diverge.
37. As a maintainer, I want denial reasons to reuse the API's existing error codes, so that clients translate one vocabulary for both disabled controls and rejected writes.
38. As a maintainer, I want the new fields in the OpenAPI contract and shared fixtures, so that web, iOS and Android models are checked against one source.
39. As an Android maintainer, I want a fixture-based contract test over my hand-written models, so that a server shape change fails my build instead of my users.
40. As a maintainer, I want the parity manifest to record that web and desktop render capabilities identically, so that desktop cannot silently drift.
41. As an iOS maintainer, I want the new fields to arrive through generated models, so that iOS can adopt them later with no server work.
42. As a maintainer, I want older Android builds to keep working during rollout, so that shipping the server first breaks nobody.
43. As a maintainer, I want the client rule copies deleted, not kept as fallbacks, so that there is never a second source of truth to drift.
44. As a maintainer, I want the rule tests to run on the server against real PostgreSQL, so that the rules are tested where they live and with real data.
45. As a maintainer, I want client tests to check only rendering, so that client test suites stop re-asserting server rules.
46. As a support engineer, I want a disabled control's reason code to match server logs for a rejected write, so that user reports can be traced.
47. As a product owner, I want ADR-014's "the board disables illegal targets" to be what actually happens, so that the documented lifecycle matches the product.

## Implementation Decisions

### Server: one decision module (deep module)

- A new **capabilities module** in the tasks domain decides, for an actor and a
  batch of tickets, each ticket's **container** and **capabilities**. It loads
  the lifecycle context (workflow states, transitions, WIP setting) once per
  request and evaluates every ticket against it; it does not query per ticket.
- Its interface is small: a batch decide call taking the actor, the tickets and
  the lifecycle context and returning container plus capabilities per ticket,
  and a single-ticket form the write path uses. Precedence between rules stays
  internal.
- The existing rule functions (transition legality, access, status-change
  permission, cancel permission, freeze lookup, team-sprint ownership, the
  in-sprint scheduling rule from placement) become the module's implementation.
  The write-path guard (the lifecycle move assertion and the route access
  helpers) consults the same decision, so the response and the guard cannot
  diverge.
- **Container** is computed from the same predicates the collection builder uses
  (ADR-015): sprint wins over a planned day, a planned day wins over the
  backlog, a due date never decides.

### Capability shape

- `container`: one of `sprint`, `scheduled`, `backlog`.
- `capabilities.transitions`: one entry for **every** active workflow state other
  than the ticket's current state, each `{ to, allowed, reason? }`. Cancelled is
  included as a target where it is a legal destination; a Cancelled ticket has
  every entry disallowed with `CANCELLED_TERMINAL`.
- `capabilities.can`: `edit`, `changeState` (at least one transition allowed),
  `cancel`, `transfer`, `delete`, `placeInSprint`, `schedule`. Each is
  `{ allowed, reason? }`.
- `reason` uses existing API error codes only: `INVALID_TRANSITION`,
  `ACCESS_DENIED`, `SPRINT_FROZEN`, `IN_SPRINT`, `SPRINT_TEAM_MISMATCH`,
  `CANCELLED_TERMINAL`. No server-written display text; clients map codes to
  their own copy.
- WIP is **not** part of a ticket's capabilities. A transition is `allowed` on
  state-machine, permission and freeze grounds only; capacity is a column fact.

### Where the fields appear

- The shared ticket enrichment step adds `container` and `capabilities`, so
  every response that returns tickets carries them: list, sprint filter,
  backlog, Scheduled, single ticket and detail, by-key, search, My Work and
  dashboard ticket lists.
- Every write that changes a ticket (PUT, PATCH, status change, placement,
  bulk — one entry per ticket — cancel, transfer) returns the updated ticket
  with fresh `container` and `capabilities`.

### Board read

- New `GET /sprints/:id/board` returns the sprint, its columns and its tickets.
  Each column is `{ stateId, count, limit, accepting }`, where `accepting` is
  false when WIP limits are enabled for the org and the column is at its limit.
  Cancelled tickets are excluded server-side and Cancelled has no column.
- The write path keeps returning `409 WIP_EXCEEDED` as the final check (ADR-014).
- `GET /tasks?sprint_id=…` keeps working for other callers.

### Current sprint

- The server names each team's **current sprint**: its active sprint, otherwise
  its paused sprint, otherwise none. Planned and completed sprints are never
  current. It is exposed as `currentSprintId` on the team's sprint list response.
- Every client copy of "first sprint whose status is active" used for landing,
  team switching, the sprint header, insights and lifecycle defaults switches to
  `currentSprintId`. Purely cosmetic uses of sprint status (status pills,
  "days left" text) are unchanged.

### Clients render, never derive

- **Web/desktop**: the workflow-target and board-target hooks are deleted. Drop
  targets, status menus, bulk-action availability and action buttons read
  `capabilities`; columns read `accepting`; lists read `container`; landing reads
  `currentSprintId`. The board uses the board read. One error-code-to-copy
  mapping serves both disabled-control tooltips and rejected-write messages.
- **Android**: `canTransition`, `isBacklogItem`, the `belongsTo*` membership
  checks and the "first active sprint" helpers are deleted. Hand-written DTOs
  gain `container`, `capabilities`, column WIP and `currentSprintId`. The
  server-patch step replaces the whole ticket from the write response instead of
  copying only state and completion time. The Scheduled KDoc drift goes with the
  deleted code.
- **No fallback.** A client that receives a ticket without `capabilities` treats
  every action as disallowed rather than computing one.

### Freshness

- Realtime `task_updated` stays `{ taskId, action }`. On receipt, clients refetch
  the ticket and, when the change touches a board they are showing, refetch the
  board. Capabilities are never put in realtime events, because they are
  per-user and events are per-team.

### Contracts and rollout

- `openapi.json` gains the container, capabilities, board and current-sprint
  shapes. Shared JSON fixtures for a ticket with capabilities, a board read and
  a sprint list with a current sprint live under the contracts fixtures and are
  validated by `contracts:validate`.
- `tasks-parity.json` records the capability rendering features for web,
  desktop and Android, with owner tests.
- Rollout is additive: server fields first, then clients. The transition graph in
  `GET /api/agile/config` and the plain sprint-filtered ticket list stay until
  older Android builds are no longer in use; removing them is a later ticket.

## Testing Decisions

- **What a good test is here.** Assert external behaviour at the highest seam:
  given an actor and tickets in a known state, what does the server decide, what
  does the API return, and does a client disable the right control. Do not test
  private helpers, call order or SQL text. Delete tests that assert replaced
  internals rather than layering new tests over them.
- **Seam 1 — capabilities module (primary).** A table-driven suite against real
  PostgreSQL: actor role (member, assignee, reporter, org admin, non-member) ×
  team membership × workflow state (including custom states and Cancelled) ×
  container × sprint status (planned, active, paused, completed) → expected
  `container`, every `transitions` entry, every `can` entry and each `reason`.
  Include the "guard agrees with decision" property: for each row, a write the
  decision disallows is rejected with the same code. Prior art: the placement
  module's PostgreSQL suite, using the existing tenant-schema integration setup
  (skipped when the test database URL is unset).
- **Seam 2 — HTTP contract.** Shared fixtures for a ticket with capabilities, a
  board read and a sprint list with `currentSprintId`, validated against
  `openapi.json` by `contracts:validate`. Web and Android tests both read these
  fixtures. Prior art: the task schedule contract test and the generated-models
  test.
- **Edge — route integration.** Every ticket-returning endpoint includes
  `container` and `capabilities`; the board read reports column WIP status and
  excludes Cancelled; `currentSprintId` picks active over paused and ignores
  planned/completed; each write returns the fresh ticket. Prior art: the
  placement routes integration suite.
- **Edge — client rendering.** Web: given a fixture ticket or board, drop
  targets, status menus, bulk actions and buttons are enabled exactly where
  `allowed` / `accepting` is true, and the reason copy is shown. The existing
  workflow-target unit tests are deleted with the hooks. Android: the same
  rendering checks alongside the existing task card and task sync tests, plus a
  fixture test that parses the shared contract fixtures into the hand-written
  DTOs. Neither client tests rule logic.
- **Parity.** `tasks-parity.json` gains the capability features with owner tests,
  so desktop/web equality is enforced by the existing parity validator.

## Out of Scope

- iOS adopting the new fields (it receives them via generated models; adoption is
  a follow-up ticket).
- Removing the transition graph from `GET /api/agile/config` or the
  sprint-filtered ticket list (after older Android builds age out).
- Client store refactors: Android's TaskViewModel split and the web keyed ticket
  cache (review candidates #3 and #4), including B5 (optimistic move and
  unordered undo) and B6 (stale lists after a board move).
- Re-enabling Android model generation from OpenAPI.
- Capabilities for comments, attachments, assignment and other sub-resources.
- Offline decisions: clients show the last fetched capabilities; there is no
  offline rules engine.
- A batched or capability-carrying realtime event.
- Changes to the transition graph, WIP semantics or placement rules themselves.

## Further Notes

- Resolves review bugs B7 (paused-only sprint loses the Sprint view), B8
  (Android Scheduled KDoc drift) and B9 (fallback states with no id collapse the
  graph; Android treats empty input as allowed) by deleting the code that causes
  them.
- Payloads grow by one capabilities object per ticket. Lifecycle context is
  loaded once per request, so query count per list stays flat; watch payload
  size for large backlogs.
- The glossary terms **Capability** and **Current sprint** were added during
  grilling. Container and column WIP status are deliberately not capabilities.
- After this ships, candidates #3 and #4 can build client stores on server
  decisions instead of client rules.

## Issues

1. [01 — Capabilities module and its PostgreSQL suite](issues/01-capabilities-module.md)
2. [02 — Current sprint on the server and web/desktop](issues/02-current-sprint.md)
3. [03 — Every ticket response carries container and capabilities](issues/03-ticket-responses-carry-capabilities.md) (blocked by 01)
4. [04 — Write-path guards consult the decision](issues/04-write-guards-consult-decision.md) (blocked by 01)
5. [05 — Board read with column WIP status](issues/05-board-read.md) (blocked by 03)
6. [06 — Web/desktop ticket actions and lists render server decisions](issues/06-web-actions-and-lists.md) (blocked by 03)
7. [07 — Web/desktop board on the board read; client rule copies deleted](issues/07-web-board-and-delete-rule-copies.md) (blocked by 05, 06)
8. [08 — Android models, container and current sprint](issues/08-android-models-container-current-sprint.md) (blocked by 02, 03)
9. [09 — Android board and actions render server decisions](issues/09-android-board-and-actions.md) (blocked by 05, 08)

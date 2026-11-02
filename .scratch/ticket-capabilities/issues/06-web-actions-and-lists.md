# 06: Web/desktop ticket actions and lists render server decisions

**What to build:** On web and desktop, every ticket action and list membership
comes from the server: status menus list every other state with illegal ones
disabled and a reason shown, action buttons follow `can`, lists follow
`container`, and a change returns the fresh ticket.

**Blocked by:** 03

**Status:** complete

## Context

- Spec §Clients render, never derive (web/desktop), §Freshness; ADR-016.
- Board drag-and-drop and column WIP are ticket 07; this ticket covers status
  menus, detail view, card actions, bulk-action availability, backlog /
  Scheduled / My Work list membership.
- Desktop is the same web bundle in an Electron shell; parity is enforced by
  `tasks-parity.json`.

## Acceptance criteria

- [ ] Status menus (card, detail, bulk) list every entry in
      `capabilities.transitions`; disallowed entries are disabled with reason copy.
- [ ] Edit, cancel, transfer, delete, add-to-sprint and schedule controls are
      enabled exactly when the matching `can` entry is allowed; disabled ones show
      reason copy.
- [ ] Bulk actions show per-ticket availability from each ticket's capabilities.
- [ ] One reason-code → copy mapping is used for both disabled controls and
      rejected-write messages.
- [ ] Backlog, Scheduled and My Work membership read `container`; no client-side
      container derivation remains on these paths.
- [ ] After any write, the client replaces its ticket with the response; on
      `task_updated` it refetches the ticket.
- [ ] A ticket missing `capabilities` renders every action disabled (no fallback
      computation).
- [ ] Rendering tests drive the UI from the shared contract fixtures; no test
      asserts rule logic.
- [ ] `tasks-parity.json` records capability rendering for web and desktop with
      owner tests.

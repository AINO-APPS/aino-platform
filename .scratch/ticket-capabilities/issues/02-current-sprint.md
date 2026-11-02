# 02: Current sprint on the server and web/desktop

**What to build:** The server names each team's **current sprint** (active,
otherwise paused, otherwise none) as `currentSprintId` on the team's sprint list,
and web/desktop lands on it. A team whose only sprint is paused still lands on
its Sprint view (fixes B7 on web/desktop).

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

## Context

- Spec §Current sprint; GLOSSARY "Current sprint"; ADR-016 decision 4.
- Web/desktop currently picks "first sprint whose status is active" in the
  planning surface, team scope, team-switch navigation, sprint board actions,
  ticket lifecycle defaults and sprint insights.
- Purely cosmetic uses of sprint status (status pills, "Active" labels,
  "days left") are unchanged.

## Acceptance criteria

- [ ] The team sprint list response includes `currentSprintId`: the active sprint,
      else the paused sprint, else `null`. Planned and completed sprints are never
      current.
- [ ] OpenAPI documents the field; a shared contract fixture covers a sprint list
      with a current sprint and `contracts:validate` passes.
- [ ] Route integration test: active beats paused; paused-only returns the paused
      sprint; planned/completed-only returns `null`.
- [ ] Web/desktop landing, team switching, sprint header, insights and lifecycle
      defaults use `currentSprintId`; no "first active sprint" selection remains
      in those paths.
- [ ] A team with only a paused sprint lands on that sprint on web and desktop.
- [ ] `tasks-parity.json` records the current-sprint behaviour for web and
      desktop with an owner test.

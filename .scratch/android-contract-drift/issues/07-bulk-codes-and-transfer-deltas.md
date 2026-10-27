# 07: Machine-readable failures — bulk codes and transfer deltas

**What to build:** Two small consistency fixes so native clients can render failure and change
information without string matching.

**Blocked by:** —

**Status:** ready-for-agent

## Context

**(a) Bulk results drop `code` for one failure kind.** `routes/tasks/bulk.ts:110-121` pushes
`{id, ok: false, error: sprintTeamMismatchBody().error}` for a team mismatch — only the message,
no `code`. The other two failure kinds in the same loop carry `INVALID_TRANSITION` and
`WIP_EXCEEDED`.

A client cannot distinguish "wrong team" from "illegal transition" except by matching English
prose, and Android's bulk result UI must render actionable messages per ticket (see Android
issue 02/03).

Fix: include `code: "SPRINT_TEAM_MISMATCH"` on that result, matching the single-ticket routes
which already send it (`routes/tasks/sprints.ts:149`, `crud.ts:482`).

**(b) Team transfers are invisible over realtime.** `emitTaskUpdated` on a transfer passes
`fields: {team_id: …}` (`routes/tasks/transfer.ts:70`), but `DELTA_FIELDS`
(`modules/tasks/tasks.deltas.ts:12-31`) does not include `team_id`, so `buildTaskDelta` silently
drops it. Clients never learn a ticket moved teams.

Fix: add `team_id` to the allow-list, and confirm every delta consumer tolerates the field —
Android's `DELTA_FIELDS` (`TaskSync.kt:122-127`) ignores unknown fields and refetches on
id-shaped changes (`TaskViewModel.kt:422-427`), so it degrades to a refetch rather than a wrong
row. Prefer id-shaped handling for `team_id` on the Android side.

## Acceptance

- A bulk `move_to_sprint` team mismatch returns `code: "SPRINT_TEAM_MISMATCH"` in `results[]`.
- A transfer emits a delta carrying `team_id` that survives `buildTaskDelta`.
- Existing bulk/notification contract tests updated.

# 04: Enforced ticket lifecycle and cancellation

**What to build:** Turn the existing `workflow_states` configuration into a real
state machine using the already-declared-but-unused `workflow_transitions` table.
Only legal transitions succeed, on every write path; WIP limits hard-block; the
board disables illegal targets; Cancelled becomes a stable terminal state
distinct from Done; transitions notify the right people and reach the team in
real-time.

**Blocked by:** 03

**Status:** ready-for-agent

## Context

- `workflow_states` is org-configurable with categories
  `open | in_progress | in_review | done` (`server/platform/db/tenantSchema/
  configuration.ts:147-168`, seeds `server/platform/db/agileDefaults.ts:44-49`).
  Default: `pending` (New), `in_progress`, `in_review`, `done`.
- `workflow_transitions` (`from_state_id`, `to_state_id`, `required_role`) exists
  in both schema layers (`configuration.ts:179-190`, `0002:110-118`) but no code
  reads or writes it.
- Any state can move to any state today. Enforced pieces are only: access,
  actor permission (assignee/reporter/admin, `access.ts:61-69`), state exists and
  is active (`_helpers/agile.ts:37-48`), sprint freeze (`sprintFreeze.ts:17-33`),
  WIP on PATCH only (`crud.ts:273-302`), and `completed_at` via DB trigger.
- Status write paths: `PATCH /:id/status` (`crud.ts:252-347`), `PUT /:id`
  (`crud.ts:487-505`), bulk `status` (`bulk.ts:100-116`), and the board drag.
- Cancel is `DELETE /:id` → move to a lazily created `cancelled` terminal state
  (`crud.ts:642-689`, `tasks.repository.ts:139-163`). It is creator-only, blocked
  when `completed_at` is set, and connoted with Done.
- Status changes are deliberately silent (`SILENT_ACTIONS` in
  `tasks.notifications.ts:18-20`); realtime `task_updated` goes only to
  creator/assignee/actor (`crud.ts:338-341`).

## Acceptance criteria

- [ ] Migration `0017_workflow_transitions.sql` seeds a stable `cancelled` state
      per org (key `cancelled`, category `done`, terminal) and transition rows for
      the default graph, idempotently.
- [ ] Custom states derive transitions by category/`sort_order` per spec §5.3;
      no org loses a path it has today.
- [ ] One server helper validates a transition (from → to) and WIP capacity; it is
      used by `PATCH /:id/status`, `PUT /:id`, bulk and the cancel path. Create is
      exempt.
- [ ] Illegal transitions return `409` with a stable code and a readable reason;
      client surfaces the reason.
- [ ] Default graph: New → In Progress; In Progress → In Review, New, Done;
      In Review → In Progress, Done; Done → In Progress (reopen); any active →
      Cancelled; Cancelled terminal. Done cannot be cancelled directly.
- [ ] WIP limits hard-block on PATCH, PUT and bulk (`409 WIP_EXCEEDED`); the board
      disables over-limit targets. Create is exempt.
- [ ] Bulk status/move applies valid tickets, skips blocked ones, and returns a
      per-ticket result; the confirmation dialog lists skipped tickets before and
      after.
- [ ] Any owning-team member may cancel; Done and Cancelled reject with existing
      `409 TASK_COMPLETED`; sprint freeze still applies; no `DELETE FROM tasks`.
- [ ] Reopening Done clears `completed_at` through the existing trigger; history
      and audit records every status change.
- [ ] Status transitions notify assignee and reporter (not the actor, not the
      whole team); realtime `task_updated` fans out to owning-team members.
- [ ] Cancelled has no board column, is excluded from board/open backlog, appears
      under the completed/cancelled filter, and is reachable in detail.
- [ ] Tests: full matrix through PATCH/PUT/bulk/cancel; custom-state derivation;
      WIP across paths; bulk partial results; notification and realtime fan-out;
      cancelled visibility; no hard delete.

## Notes

- Board drag consumption of the transition graph is the seam defined in issue 02.
- Keep `required_role` unread for now; the column exists for a future custom
  editor. The settled policy is team-member writes.
- The lazy cancelled-state creation in `tasks.repository.ts` stays as a fallback
  for orgs created between migrations, but must reuse the seeded row.
- Admin workflow configuration (`/api/agile/workflow-states`) must keep the
  "every category has an active state" guard; adding Cancelled must not break it.
- Sprint freeze and completed-backlog semantics are unchanged.

## Comments

**2026-10-27 — specced**

Lifecycle gap and unused transitions table confirmed by exploration. Awaiting
spec sign-off.

# 03: Team-owned tickets and team-wide visibility

**What to build:** Give every ticket a real owning team and make team membership
the single visibility and write boundary. A member of a team sees and edits all
of that team's backlog items, sprint tickets, history and comments — whether or
not they created or were assigned the ticket. Org admins see everything; users
without a team get a personal fallback and an explanatory banner; non-members get
403 from every surface.

**Blocked by:** —

**Status:** ready-for-agent

## Context

- A user belongs to exactly one team (`users.team_id`, `server/platform/db/
  tenantSchema/core.ts:54-77`); there is no membership join table. Sprints are
  team-owned (`sprints.team_id`, `core.ts:297-308`). Projects are org-wide and
  have no team (`integrations.ts:52-67`).
- `tasks.team_id` exists and is indexed (`0011:7-9,189-191`) but **nothing writes
  it**. Every insert omits it: `routes/tasks/backlog.ts:264-274`,
  `routes/tasks/crud.ts:202-211`, `routes/tasks/carryForward.ts:76-86`,
  `routes/notes.ts:541-549`, `modules/tasks/tasks.serviceDesk.ts:26-35`. Sprint
  moves only set `sprint_id`/`due_date` (`tasks.sprintRepository.ts:109-121`,
  `tasks.repository.ts:116-117`).
- The visibility predicate is anchored on the **creator's current team**:
  `tasks.collection.ts:145-153` (`creator = me OR assignee = me OR creator IN
  users with my team_id`). That is the reported symptom.
- Users with no `team_id` fall back to `personal` (`backlog.ts:71-76`,
  `crud.ts:48-55`), the Sprint tab is force-hidden (`Tasks.tsx:292-300`), and
  `/api/sprints` returns `[]` (`sprints.ts:16-33`).
- Surfaces disagree: `/sprints/:id/tasks` is org-wide for anyone on the sprint's
  team (`sprints.ts:159-168`, `tasks.collection.ts:245-260`); `/sprints` hides
  other teams from admins; baseline/completion only check org; search and
  quicksearch differ (`search.ts:32-35,82-94`); export is creator-only
  (`export.ts:148-156`); notes pickers are inconsistent (`tasks.notes.ts:31`);
  service-desk mirrored tickets carry no team (`tasks.serviceDesk.ts:26-35`).
- There is no central task policy (`access.ts:15-69` is the detail ACL); list
  filters are built inline per endpoint.

## Acceptance criteria

- [ ] Migration `0016_tasks_team_ownership.sql` backfills
      `team_id = COALESCE(sprint.team_id, creator.team_id, assignee.team_id)`
      idempotently, logs a conflict count where sprint team ≠ creator team, and
      does not block on NULLs.
- [ ] Every insert sets `team_id`: create (all five paths), carry-forward, notes
      mirror, service desk. Explicit team is honoured for admins only.
- [ ] Every sprint move enforces same-team: `sprint.team_id = task.team_id`.
      Cross-team assignment returns a clear 400/409.
- [ ] `POST /api/tasks/:id/transfer` (admin-only, `{ team_id }`) transfers the
      ticket, clears a now-foreign sprint assignment, writes history and audit.
- [ ] Visibility policy is centralised and applied to board, backlog, schedule,
      detail, history, comments, attachments, dependencies, criteria, timers,
      rank, bulk, search, quicksearch, export, notes pickers, carry-over, service
      desk, `/sprints/:id/tasks`, baseline, completion preview and cumulatives.
- [ ] Team members read/edit all team tickets; org admins read/write all org
      tickets and all sprints; non-members receive 403; no-team users see only
      their own items with a banner.
- [ ] Admin Plan header gains a team switcher, defaulting to the admin's own
      team; non-admins never see it.
- [ ] Legacy `team_id IS NULL` tickets appear only in an admin Unassigned bucket;
      they are not silently hidden from everyone.
- [ ] Team deletion is blocked while the team owns tickets or sprints, with a
      clear error naming the counts.
- [ ] Non-permitted actions are hidden/disabled in the UI as well as rejected
      server-side.
- [ ] `team_visibility` per-org flag defaults off until the backfill report is
      reviewed, then turns on without data loss; off restores old behaviour.
- [ ] Tests: visibility matrix (member, lead, admin, no-team, non-member,
      unassigned), all write paths, transfer, sprint same-team rule, deletion
      guard, flag on/off.

## Notes

- `canAccessTask` (`routes/tasks/_helpers/access.ts:15-42`) must switch from
  creator-team equality to `task.team_id`, and `canChangeTaskStatus` (61-69)
  must permit any owning-team member, not only assignee/reporter.
- Redis caches team/role context for one hour (`middleware/rbac.ts:219-251`);
  transfer and team reassignment must invalidate affected users' cache.
- Do not widen write privileges beyond the team: agile configuration keeps its
  existing `agile_editor_grants` layer.
- Default states and transitions are issue 04; this issue only changes ownership
  and access.

## Comments

**2026-10-27 — specced**

Ownership gap and divergent surfaces confirmed by exploration. Awaiting spec
sign-off.

**2026-10-27 — implemented**

Migration `0016` backfills `tasks.team_id` and records sprint/creator conflicts;
all five create paths write ownership; sprint moves enforce the same-team rule;
`POST /api/tasks/:id/transfer` is admin-only and audited. One policy module
(`server/modules/tasks/tasks.policy.ts`) now backs board, backlog, schedule,
detail, history, comments, attachments, dependencies, criteria, timers, rank,
bulk, search, quicksearch, export, notes pickers, carry-over, service desk,
`/sprints/:id/tasks`, baseline and completion preview. The Plan header has an
admin team switcher and the no-team banner. `team_visibility` stays off by
default; enable it per org after reviewing `task_team_backfill_conflicts`.

**2026-10-27 — root cause found: the feature was dormant**

The work above was correct but never took effect. `team_visibility` defaulted to
`false` on **every** plan, including enterprise (`server/utils/planCatalog.ts`),
and no tenant carried an override. With the flag off `tasks.policy.ts` falls back
to the legacy creator-team predicate — the reported bug — so the shipped default
reproduced the defect exactly, and `canChangeTaskStatus` denied transitions to
every teammate who was not the creator or assignee.

Fix: `team_visibility` now defaults to `true` on standard, pro and enterprise.
The model is still reversible per org with an explicit override. Regression
coverage lives in `server/__tests__/tasks.teamTicketVisibility.test.ts` (16
tests; 12 of them fail if the flag is turned back off).

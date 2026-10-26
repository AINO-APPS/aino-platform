# Spec — Plan: team visibility and the ticket lifecycle

**Status:** ready-for-agent
**Date:** 2026-10-27
**Surfaces:** web SPA (`client/`); the desktop Electron shell (`desktop/`) serves the same bundle; Android/iOS are separate repositories
**Decisions:** [ADR-013](../../docs/adr/ADR-013-ticket-team-ownership.md), [ADR-014](../../docs/adr/ADR-014-workflow-transition-enforcement.md)
**Vocabulary:** [GLOSSARY.md](../../GLOSSARY.md)
**Prior work:** `docs/TASKS_DESIGN_SPEC.md`, `.scratch/tasks-backlog-sprint-schedule/`

---

## 1. Problem

Four defects are reported from the Plan area (`/tasks`). They are independent, and
two of them are the visible edge of a data-model gap rather than UI mistakes.

| # | Report | Verified cause |
|---|--------|----------------|
| 1 | The Plan UI is broken the first time it is opened. | Five independent causes: fallback workflow states carry `id: 0` and can never match a task (`AgileConfigContext.tsx:160-195`, `KanbanBoard.tsx:74-81`); `activeTab` starts as `"backlog"` and is corrected only by an effect (`Tasks.tsx:76`, `useTasksRouteSync.ts:30-47`); the sprint goal is initialised once and never resynced (`SprintPlan.tsx:53`); `.plan-row` declares four grid columns but renders five children in comfortable density (`SprintPlan.module.css:51-58`, `SprintPlan.tsx:98-110,181-203`); the backlog pane has no loading state (`SprintTab.tsx:132-147`, `SprintPlan.tsx:113-115`). |
| 2 | Team members cannot see backlog items, sprints or tickets they did not create or get assigned. | Visibility is anchored on **the creator's current team**, not the ticket's team: `creator = me OR assignee = me OR creator IN (users whose team_id = my team)` (`tasks.collection.ts:145-153`). `tasks.team_id` exists and is indexed but **no insert or update path writes it** — it was only backfilled once in `0011:78-91`. A user with no `team_id` silently falls back to personal visibility and loses the Sprint tab (`backlog.ts:71-76`, `crud.ts:48-55`, `Tasks.tsx:292-300`, `sprints.ts:16-33`). Other surfaces disagree: `/sprints/:id/tasks` returns all sprint tasks to anyone on the sprint's team, while `/sprints` shows even org admins only their own team's sprints. |
| 3 | Dragging a ticket on the Kanban board makes it transparent and invisible. | The board's dimming rule was removed in `acbd1601` and is covered by `boardDragVisibility.test.tsx`; the rule survives only in the **stale Sep 8 client bundle inside `desktop/dist/win-unpacked/resources/client/dist`**. In source, one dimming rule remains on the **backlog** list (`.backlog-card-dragging { opacity: .4 }`, `BacklogTab.module.css:31`), and an aborted drag never clears `useBoardDrag.draggingId` because no `dragEnd` is wired. |
| 4 | Cancelling the move confirmation still moves the ticket. | The board's drop handler dispatches twice: `KanbanBoard.tsx:140` opens the confirmation via `useDragDrop`, and `:141` immediately calls `useBoardDrag.onDrop`, which PATCHes status and refetches (`useBoardDrag.ts:173-182`, `useBoardDragWiring.ts:35-38`). The keyboard path likewise moves immediately on arrow key (`useBoardDrag.ts:121-162`). `confirmDone` returns a promise that never resolves when the dialog is cancelled (`useBoardDragWiring.ts:40-51`, `useConfirmDialog.ts:12-44`). |

Underneath defects 1, 3 and 4 are two structural problems worth fixing rather
than patching: there are **two independent pointer drag systems** wired to the
same cards (native HTML5 `useDragDrop` plus custom `useBoardDrag`, with a third
in the backlog), and the Plan surfaces have **no shared loading/error contract**.

Underneath defect 2 is a missing ownership dimension: one user belongs to exactly
one team (`users.team_id`), sprints are team-owned (`sprints.team_id`), but
projects are org-wide (`projects` has no `team_id`) and tickets are not team-owned
in practice. "The team's backlog" is currently inferred from who created the item.

---

## 2. Solution

Make a ticket **owned by exactly one team**, and make team membership the
visibility and write boundary for that team's tickets — the Jira team-managed
model, expressed through the workflow states that already exist rather than a
second status system.

- Every ticket carries a real `tasks.team_id`. It is written on create, on sprint
  assignment, and on an explicit admin transfer; backfilled once for existing rows.
- Every member of the owning team reads and edits every ticket the team owns,
  including the backlog, all sprints, history, comments and attachments. Org
  admins read and write the whole org. Non-members get 403. Users with no team
  keep a personal fallback with an explanatory banner.
- Backlog stays `sprint_id IS NULL`; it is not a status and does not get a board
  column. Status is the workflow state.
- The existing but unused `workflow_transitions` table becomes the authoritative
  state machine, enforced server-side on every write path and mirrored in the
  board by disabling illegal drop targets.
- The board has **one pointer drag path**, every transition is staged behind the
  confirmation dialog, Cancel is a true no-op, and no card ever changes opacity
  while dragging.
- Plan, board and backlog render from route-derived state on first paint, keep
  the last good data while refetching, and show a skeleton or an error-with-retry
  instead of a broken or empty-looking layout.

---

## 3. Decisions

| # | Decision |
|---|----------|
| D1 | **Scope.** Team-wide visibility, enforced lifecycle, and board correctness. Epics, subtasks, swimlanes, custom workflow editors, watchers, restore-from-cancelled, touch long-press and within-column ranking are out of scope and recorded as follow-ups. |
| D2 | **Ownership anchor.** `tasks.team_id` is authoritative. Set on create from explicit team (admins), else sprint's team, else creator's team. Updated on sprint assignment. Cross-team sprint assignment is rejected unless an admin transfers the ticket first. |
| D3 | **Backfill.** Idempotent migration: `COALESCE(sprint.team_id, creator.team_id, assignee.team_id)`. Sprint team wins conflicts; conflicts are counted and logged. Truly unowned tickets remain `NULL` and appear only in the admin Unassigned bucket. |
| D4 | **Read policy.** Owning-team members read all of the team's tickets; org admins read all org tickets and all sprints; non-members get 403; users with no team read only their creator/assignee tickets, with a banner. |
| D5 | **Write policy.** Any owning-team member creates, edits, transitions, assigns and moves the team's tickets. Only admins transfer teams. No hard delete; cancellation is the removal path. Non-permitted actions are hidden or disabled in the UI as well as rejected server-side. |
| D6 | **Status set.** `workflow_states` remains the single source of truth. Default states: New (`pending`), In Progress, In Review, Done, plus a stable Cancelled state (key `cancelled`, category `done`, terminal). Backlog is not a status. |
| D7 | **Transitions.** Seed `workflow_transitions`; enforce on `PATCH /:id/status`, `PUT /:id`, bulk status/move, and the board. Create is exempt (no from-state). Custom states derive the graph from category and `sort_order`. |
| D8 | **Graph.** To Do → In Progress; In Progress → In Review, To Do, Done; In Review → In Progress, Done; Done → In Progress (reopen); any active state → Cancelled; Cancelled terminal. Done cannot be cancelled without reopening. |
| D9 | **Backlog orthogonality.** Adding to or removing from a sprint never changes workflow status. Dropping into the Backlog column means "remove from sprint". |
| D10 | **Board interaction.** One pointer path (`useDragDrop`); `useBoardDrag` becomes keyboard-only. Every board/keyboard transition confirms. Detail-view dropdown confirms only Done and Cancelled. Cancel never mutates or refetches. Drag state resets on drop, dragEnd and Escape. Illegal targets are disabled during drag. |
| D11 | **WIP limits.** Hard-block consistently on PATCH, PUT, bulk and drag; `409 WIP_EXCEEDED`. Over-limit columns are disabled as drop targets. Create is exempt. |
| D12 | **Cancelled visibility.** No Cancelled board column; excluded from board and open backlog by default; reachable through the completed/cancelled filter and ticket detail. Irreversible in this round. |
| D13 | **Notifications and realtime.** Status transitions notify assignee and reporter unless they are the actor; no team-wide notification for ordinary events. `task_updated` fans out to the ticket's team members. |
| D14 | **Rollout.** New per-org `team_visibility` flag; lifecycle enforcement reuses `agile`. Flags turn on only after the backfill. Desktop ships a freshly built client bundle; version bumps and release commits stay with the maintainer. |
| D15 | **First-load contract.** Route-derived tab/sprint before first paint; fallback columns match by key; shared async section (skeleton → error-with-retry → stale-while-revalidate); sprint goal resyncs on sprint change; plan grid handles five children. |

---

## 4. Visibility and write policy

| Actor | Reads | Writes |
|-------|-------|--------|
| Member of the ticket's team | All tickets, backlog, sprints, history, comments, attachments for that team | Create, edit, transition, assign, move, cancel (unless Done) |
| Team lead (`team_lead`) | Same as member | Same as member; no ticket privileges beyond the team |
| Org admin (`super_admin`, `hr_admin`, `platform_admin`) | All tickets and sprints in the org, including Unassigned | All of the above; transfer team; configure workflow |
| User with no `team_id` | Own created/assigned tickets only | Own created/assigned tickets only |
| Non-member of the team | Nothing for that team (403) | Nothing (403) |

The policy lives in one server helper used by every surface: board/backlog list
(`buildTaskCollection`), schedule, detail (`loadAccessibleTask`), history,
comments, attachments, dependencies, acceptance criteria, timers, rank, bulk,
search, quicksearch, export, notes task pickers, carry-over, service-desk mirrored
tickets, `/sprints/:id/tasks`, baseline, completion preview and cumulatives.
Empty results from a team-scoped query are not a substitute for an authorization
decision.

Admin-only surfaces gain a team switcher in the Plan header, defaulting to the
admin's own team.

---

## 5. Lifecycle

### 5.1 Default states

| Key | Name | Category | Terminal | Notes |
|-----|------|----------|----------|-------|
| `pending` | New / To Do | `open` | no | initial state |
| `in_progress` | In Progress | `in_progress` | no | |
| `in_review` | In Review | `in_review` | no | |
| `done` | Done | `done` | yes | sets `completed_at` via trigger |
| `cancelled` | Cancelled | `done` | yes | excluded from board; no exit |

### 5.2 Transition matrix (default states)

| From \ To | New | In Progress | In Review | Done | Cancelled |
|-----------|-----|-------------|-----------|------|-----------|
| New | — | ✓ | | | ✓ |
| In Progress | ✓ | — | ✓ | ✓ | ✓ |
| In Review | | ✓ | — | ✓ | ✓ |
| Done | | ✓ (reopen) | | — | |
| Cancelled | | | | | — |

Any state change writes `task_history` (`status_change`, field `workflow_state`),
the audit log, and the realtime team event. Reopening Done clears `completed_at`
through the existing database trigger.

### 5.3 Custom states

For orgs with extra states, derive the graph at seed time:

- within the same category: all directions allowed;
- forward: to the next category in `open → in_progress → in_review → done`, or to
  any state in `done` from any active state;
- backward: to the previous category;
- reopen: from any `done` state to the first `in_progress` state;
- any non-terminal state → Cancelled; Cancelled has no outgoing edge.

Admins can later edit the rows directly; a transition editor is out of scope.

### 5.4 Cancellation

`DELETE /api/tasks/:id` remains the cancel action and moves the ticket to the
Cancelled state (never `DELETE FROM tasks`). Any team member may cancel; Done and
Cancelled tickets are rejected with `409 TASK_COMPLETED`. Sprint freeze still
applies. Existing history/audit actions are preserved.

### 5.5 WIP limits

`workflow_states.wip_limit` is enforced before any transition into the state.
The check runs in one helper used by PATCH, PUT and bulk; the board disables
over-limit targets. Bulk applies valid tickets and reports skipped ones.

---

## 6. Data model and migration

- `tasks.team_id` becomes authoritative. Add `NOT NULL` only for newly written
  rows; legacy NULLs are allowed and surfaced as Unassigned. Existing index
  (`0011:189-191`) is reused.
- All insert paths set it: `crud.ts` create, `backlog.ts` create, `carryForward.ts`,
  `routes/notes.ts` mirrored tasks, `tasks.serviceDesk.ts`.
- All sprint-move paths update it: `assign-sprint`, full update `sprint_id`, bulk
  `move_to_sprint`.
- Same-team rule: a ticket may enter a sprint only when `sprint.team_id = task.team_id`.
- Admin transfer: new `POST /api/tasks/:id/transfer` with `{ team_id }`, admin-only,
  audit-logged. If the ticket is in a sprint belonging to the old team, the sprint
  assignment is cleared and the move is recorded in history.
- Team deletion is blocked while the team owns tickets or sprints; the admin must
  transfer or delete them first.
- Migration order: `0016_tasks_team_ownership.sql` (visibility), then
  `0017_workflow_transitions.sql` (lifecycle). Both idempotent and safe to re-run.

---

## 7. First-load contract

1. Tab and sprint are derived from the URL before the first render; no effect
   correction and no stray backlog fetch on a sprint deep link.
2. Fallback workflow states are matched by `key`, never by `id: 0`.
3. A shared async section shows a skeleton on first load, an error with Retry on
   failure, and keeps the last good data during refetch.
4. The Plan backlog pane distinguishes loading from empty.
5. Sprint goal state resyncs when the sprint changes; blur never persists an
   empty goal unless the user explicitly cleared it.
6. `.plan-row` accommodates five children in both densities.
7. `--radius-md` is either defined or replaced by an existing token.

---

## 8. Board interaction

**Pointer:** native HTML5 `useDragDrop` only. `useBoardDrag` keeps keyboard
navigation and announces results, but has no pointer drop path. The duplicate
`onDrop` call is removed.

**Staging:** a drop or keyboard move opens one confirmation dialog naming the
ticket and target status. No state update, no network call and no refetch happen
before acceptance. Accept → optimistic update → PATCH → rollback on failure.
Cancel → no-op.

**Visuals:** no opacity change on any card (board or backlog); feedback is a
placeholder/outline and drop indicator. Drag ghost remains fully visible.
`dragEnd`, outside drop and Escape all clear drag state and `aria-grabbed`.

**Illegal targets:** columns that violate the transition graph or a WIP limit are
visibly disabled and cannot receive a drop; keyboard announces why.

---

## 9. Rollout and implementation order

1. **01 — first-load P0** (independent; ships first).
2. **02 — drag correctness** (independent; ships second).
3. **03 — team visibility** (`team_visibility` flag, migration 0016 + backfill).
4. **04 — lifecycle** (`agile` flag, migration 0017; depends on 03).

The visibility flag turns on per org after the backfill has run and its conflict
report has been reviewed. The lifecycle flag turns on after 03 so transition
checks can rely on team-scoped access. Both are reversible without data loss.

Desktop: rebuild the client, repackage, and verify that
`desktop/dist/win-unpacked/resources/client/dist` contains the current hashed
assets and no `.dragging` opacity rule before release. The maintainer performs the
version bump and release commit.

---

## 10. Non-goals and follow-ups

Explicitly not in this work, but left possible by the model:

- touch long-press board drag;
- within-column ranking/reordering on the board;
- epics, subtasks and swimlanes;
- a custom transition/workflow editor UI;
- watchers and per-ticket privacy;
- restore from Cancelled or hard delete;
- multi-team membership per user;
- Jira-style automation/rules.

---

## 11. Acceptance criteria (roll-up)

- [ ] Direct links to `/tasks/backlog`, `/tasks/sprint/:id`, `/tasks/sprint/:id/plan`
      and `/tasks/schedule` render the correct view on first paint, with no stray
      fetch and no broken plan rows; loading is distinguishable from empty.
- [ ] A team member sees every ticket, backlog item and sprint owned by their
      team, including tickets created by admins, without being assigned.
- [ ] A non-member gets 403 from every ticket and sprint surface; an org admin
      sees every team and can switch teams; a user without a team sees a banner
      and only their own items.
- [ ] Cross-team sprint assignment is rejected; admin transfer works and is
      audited; team deletion is blocked while the team owns work.
- [ ] Only transitions in the graph succeed, on every write path; illegal board
      targets are disabled; bulk reports skipped tickets.
- [ ] WIP limits block consistently and return `409 WIP_EXCEEDED`.
- [ ] Dragging never changes card opacity; cancelling a confirmation never
      mutates status or refetches; drag state always resets.
- [ ] Status transitions notify the assignee/reporter and reach the team in
      realtime; cancelled tickets leave the board and open backlog.
- [ ] Cancelled is terminal; Done must be reopened before it can be cancelled;
      no hard delete exists.
- [ ] The desktop bundle shipped in the release is the current build.

---

## 12. Test plan

**Server integration**

- Visibility matrix: team member / team lead / org admin / no-team / non-member /
  unassigned, across board list, backlog, detail, history, comments, search,
  export, `/sprints/:id/tasks`, baseline, completion preview.
- Ownership write paths: create (all five insert sites), assign-sprint, bulk move,
  full update, transfer, team deletion guard.
- Transition matrix: every legal and illegal pair, through PATCH, PUT, bulk and
  cancel; create exempt.
- WIP: block on PATCH, PUT, bulk and drag-equivalent path.
- Cancellation: any team member, blocked for Done/Cancelled, frozen sprint,
  history/audit retained.
- Notifications: assignee/reporter only, not actor, not team-wide; realtime fan-out
  to team.

**Client**

- First paint with `FALLBACK_CONFIG` and real task state keys.
- Route-first rendering for each deep link.
- Sprint goal resync and no empty write on blur.
- Plan row layout in compact and comfortable density; backlog loading state.
- Drag: single PATCH per accepted move, zero on cancel, zero on Escape and
  outside drop; no opacity rule; illegal target disabled.
- Keyboard: staged confirmation; cancel no-op; announcement.
- Bulk dialog skipped list.

Each reported bug gets one regression test that fails on the pre-fix code.

**Manual**

- Rebuilt desktop app: drag, cancel, first open, team member visibility.

---

## 13. Issue index

| # | Issue | Depends on |
|---|-------|-----------|
| 01 | [First Plan open renders safely](issues/01-first-load-safe-render.md) | — |
| 02 | [Board drag is one staged, cancel-safe interaction](issues/02-board-drag-correctness.md) | — |
| 03 | [Team-owned tickets and team-wide visibility](issues/03-team-ticket-visibility.md) | — |
| 04 | [Enforced ticket lifecycle and cancellation](issues/04-workflow-transition-lifecycle.md) | 03 |

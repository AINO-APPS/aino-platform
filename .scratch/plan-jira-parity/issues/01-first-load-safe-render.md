# 01: First Plan open renders safely and correctly

**What to build:** Opening `/tasks` (Plan) on a first visit — or deep-linking to
backlog, sprint, plan or schedule — must render the correct view immediately,
never a broken or falsely-empty layout. Route-derived state is known before the
first paint, fallback board columns match real tasks, every async section has a
skeleton/error-with-retry contract, and the Plan split view lays out correctly.

**Blocked by:** —

**Status:** ready-for-agent

## Context

Five independent causes were verified:

- `AgileConfigContext` seeds fallback workflow states with `id: 0`
  (`client/src/AgileConfigContext.tsx:160-195`), and `KanbanBoard.getColTasks`
  requires a truthy column id (`client/src/pages/tasks/KanbanBoard.tsx:74-81`), so
  before `/agile` resolves no card can match a column. The legacy `status`
  fallback is dead because `tasks.status` was dropped in `0015`.
- `activeTab` is hard-coded to `"backlog"` (`client/src/pages/Tasks.tsx:76`) and
  corrected only by an effect (`useTasksRouteSync.ts:30-47`), so a sprint/plan
  deep link first renders the backlog and starts a stray fetch.
- `SprintPlan` initialises `goal` once from `sprint?.goal` and never resyncs
  (`SprintPlan.tsx:53`); on first open it can show "Set a goal" and then persist
  an empty goal on blur.
- `.plan-row` declares `auto minmax(0,1fr) auto auto` but renders five children
  in comfortable density (`SprintPlan.module.css:51-58`,
  `SprintPlan.tsx:98-110,181-203`), wrapping onto an implicit second row.
- The Plan backlog pane receives only `backlogTasks`, never `backlogLoading`
  (`SprintTab.tsx:132-147`), so it says "Nothing left in the backlog" while the
  request is in flight.

## Acceptance criteria

- [ ] Initial tab, sprint id and plan/schedule mode are derived from the URL
      before first render; deep links render the right view with no corrective
      flash and no stray request.
- [ ] Fallback workflow columns match tasks by `workflow_state_key`; a task
      appears as soon as it arrives even if `/agile` fails or is slow. No match
      depends on `id: 0`.
- [ ] A shared async section provides: skeleton on first load, error with Retry
      on failure, and last-good-data retention during refetch. Used by the Plan
      view, the board and the backlog pane.
- [ ] The Plan backlog pane distinguishes loading from empty and from error.
- [ ] Sprint goal resyncs when `sprint` arrives or changes; blur persists only a
      real user edit, never the placeholder state.
- [ ] `.plan-row` handles five children in both compact and comfortable density,
      with aligned action buttons.
- [ ] `--radius-md` is defined or replaced with an existing token (no invalid
      declaration).
- [ ] Regression tests cover: first paint with `FALLBACK_CONFIG` plus real task
      state keys; each deep link; goal resync; both densities; backlog loading.

## Notes

- Keep-alive means `/tasks/*` reuses the same mounted component
  (`client/src/App.tsx:117-141`, `KeepAlive.tsx:106-163`); route changes must
  update state without remount tricks.
- Do not change the URL contract: `/tasks/backlog`, `/tasks/sprint/:id`,
  `/tasks/sprint/:id/plan`, `/tasks/schedule`, `/tasks/desk`.
- This is a P0 and ships independently of issues 02–04.

## Comments

**2026-10-27 — specced**

Root causes and acceptance criteria captured from codebase exploration. Awaiting
spec sign-off.

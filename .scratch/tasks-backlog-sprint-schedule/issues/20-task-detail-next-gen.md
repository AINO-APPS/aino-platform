# 20: Task detail next generation

**What to build:** Task detail fits the device: a bottom sheet on a phone, a side panel on a desktop. Planned date and due date are separate fields with distinct labels and distinct effects. Logged time sits against estimate, and the existing timer starts from the task and rolls into the timesheet. Existing dependencies, blockers, parent and children, acceptance criteria, custom fields and code references become reachable rather than hidden.

**Blocked by:** 05

**Status:** done

- [x] Detail presents as a bottom sheet on narrow viewports and a side panel on wide ones
- [x] Planned date and due date are distinct fields with labels explaining their effect
- [x] Logged and estimated time are shown together
- [x] Starting the timer from a task attributes the time to that task and appears in the timesheet
- [x] Dependencies, blockers, parent, children, acceptance criteria, custom fields and code references are all reachable
- [x] Navigating to a related task works and is keyboard accessible
- [x] The sheet contains no keyboard trap and closes with the expected key

## Comments

- `TaskDetailSheet` is the single detail surface: a side panel above 640px and a
  bottom sheet below it, chosen by CSS so there is no viewport-detection flicker.
  Escape closes it, focus moves in on open and returns on close, and `aria-modal`
  is `false` with no focus-trap handler so Tab can leave the sheet.
- `planned_date` and `due_date` are now separate fields in both view and edit
  mode, each with a one-line explanation of its effect. `PUT /api/tasks/:id`
  accepts `planned_date` and keeps the legacy `date` column in step until the
  contract migration in ticket 28 drops it.
- `tasks.estimated_minutes` / `tasks.logged_minutes` (migration 0013) hold the
  plan and the running total; `TaskTimePanel` shows logged against estimated with
  an overrun label and starts/stops the timer from the task.
- `task_timers` (migration 0014) records each run with a partial unique index so
  starting twice is idempotent. Stopping writes the elapsed minutes to the task
  and leaves the row for the timesheet.
- `GET /api/tracker/task-time` reads those rows back grouped by local day, and
  the Analytics page renders them in `TaskTimeTable` — so the time a person logs
  against a task appears in their timesheet.
- `TaskGitRefs` surfaces branches, PRs and commits, which were previously only
  reachable through the API. Dependencies, blockers, parent/child, acceptance
  criteria and custom fields stay where they were.
- `TaskHistoryList` was extracted from `TaskDetailModal` to keep the file under
  its ratchet; the baseline dropped from 925 to 856 lines.
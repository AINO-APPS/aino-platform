# 28: Drop legacy status and date

**What to build:** The contract step of the wide refactor: once no client reads the old status column or the old ambiguous date column, they are removed. One status remains — the workflow state — and one planned date remains. The parallel numeric order column is removed too.

**Blocked by:** 25, 26, 27

**Status:** done

- [x] No client or server code reads the legacy status, date or numeric order columns
- [x] The columns are removed from both the migration layer and the base tenant schema definition
- [x] A newly created tenant and an upgraded tenant still end identical
- [x] Removing the columns leaves every existing task intact and correctly categorised
- [x] Full test suites for all four clients pass after removal
## Comments

**2026-10-25 — implemented**

- `0015_drop_legacy_task_columns.sql` drops `tasks.date`, `tasks.status` and
  `tasks.rank_value`, backfilling `planned_date` and `workflow_state_id` first
  so no task loses its planner day or its category. Every statement is guarded
  on the column existing, so a tenant created after the base schema stopped
  declaring them is a no-op.
- `0011_tasks_schema_expand.sql` is now tolerant of a fresh tenant: its
  legacy-dependent blocks (date validation, `planned_date` backfill, status →
  workflow-state mapping) return early when the column is absent.
- The base tenant schema (`tenantSchema/core.ts`) no longer declares `date`,
  `status` or `due_date TEXT`; `due_date` is `DATE` from creation. The
  `rank_value` column is gone from `tenantSchema/configuration.ts`.
- `seedAgileDefaults` no longer backfills from `tasks.status` — 0011 owns that
  mapping and the trigger owns `completed_at`.
- Server reads/writes moved to the workflow state and `planned_date`:
  `tasks.collection.ts` (status filter now resolves a `workflow_states` key,
  schedule scope uses `planned_date`, ordering uses the state category),
  `crud.ts`, `backlog.ts`, `bulk.ts`, `carryForward.ts`, `dependencies.ts`,
  `search.ts`, `sprints.ts`, `calendar.ts`, `export.ts`, `notes.ts`,
  `manager.ts`, `serviceDesk.ts`, `attendance.*`, `search.repository.ts`.
- `enrichTasks` now attaches `workflow_state_key` / `_name` / `_category` to
  every task, so clients never need a status column.
- Clients: web (`Task` type consumers, `taskStatus.ts`, `calendar.ts`,
  `scheduled.ts`, board drag, cards, detail, header, dashboard, DailyNotes,
  search, Projects, SprintInsights), Android (`Task` model, `TaskSync`,
  `TaskLogic`, `TaskViewModel`, screens) and iOS generated models.
- SQL that had accumulated in route files during this effort moved into
  `modules/tasks/*` repositories (`tasks.enrich.ts`, `tasks.schedule.ts`,
  `tasks.serviceDesk.ts`, `tasks.sprintRepository.ts`, `tasks.notes.ts`,
  `tasks.time.ts`, `tasks.preferences.ts`, `tasks.sprintLifecycle.ts`), so the
  GR1 guard passes with the legacy debt re-pinned at 897 lines.
- `tasksSchemaExpand.integration.test.ts` now simulates an upgraded tenant by
  re-adding the legacy columns, asserts they are gone afterwards, and adds a
  test that every task keeps its category and planner day across the drop.
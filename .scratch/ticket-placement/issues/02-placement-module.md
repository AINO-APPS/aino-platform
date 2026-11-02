# 02: Placement module and its PostgreSQL suite

**What to build:** `server/modules/tasks/tasks.placement.ts`, the one module that
moves tickets between sprint, Scheduled and backlog, with a table-driven test
suite against real PostgreSQL. No route uses it yet.

**Blocked by:** 01

**Status:** done (2026-11-01)

## Context

- Today's fragments: `REMEMBER_DUE_DATE` / `LEAVE_SPRINT` / `setSprintAndDueDate`
  / `clearSprint` (`tasks.sprintRepository.ts:166-212`), `setSprint`
  (`tasks.repository.ts:117-123`), team rules `canMoveIntoTeamSprint` /
  `teamAfterSprintMove` (`tasks.ownership.ts`), freeze lookup
  `findFrozenSprintIds` (`tasks.sprintLifecycle.ts`), baseline helpers
  (`tasks.baseline.ts`, `insertBaseline` in `tasks.sprintRepository.ts:97`).
- Existing real-Postgres pattern: `__tests__/tasksSchemaExpand.integration.test.ts`
  (`TASKS_SCHEMA_TEST_DATABASE_URL`, local DB whose name contains `test`,
  per-test tenant schema, skipped when unset).
- Spec §3 decisions P1, P3–P10, P13 and the §4 truth table.

## Acceptance criteria

- [x] Exports `placeTickets`, `transferTicket` and `retimeSprintDueDates`; takes a
      transaction client and an actor; returns a result per ticket
      (`ok` or `skipped` with a stable code).
- [x] Decide and document in the module header whether "leave sprint" and "back to
      backlog" are one target or two (spec §4).
- [x] Every row of the spec §4 truth table holds, including sprint → sprint
      keeping `pre_sprint_due_date` and setting `due_date` to the new end.
- [x] Rejects with `SPRINT_FROZEN` (origin or destination completed),
      `SPRINT_TEAM_MISMATCH`, `IN_SPRINT` (schedule while sprinted); validation
      happens for all tickets before any write.
- [x] Legacy ticket with `team_id IS NULL` adopts the sprint's team on entry.
- [x] Writes sprint / planned-date / due-date history rows and audit inside the
      transaction.
- [x] ~~Records `scope_add` / `scope_remove` baselines~~ — dropped, see spec P9.
- [x] Registers one `task_updated` per moved ticket and the existing sprint-added
      notification through `afterCommit`; nothing is emitted on rollback.
- [x] `retimeSprintDueDates` moves only members whose `due_date` equals the old
      end.
- [x] Table-driven PostgreSQL suite: from-container × target × due-date state →
      row, history, audit, effects. Skipped cleanly without the env var.

## Notes

Module header comment records why placement is one module (architecture review
2026-11-01) and that rank is deliberately outside it.

## Comments

**2026-11-01 — implemented.** `modules/tasks/tasks.placement.ts` (rules),
`tasks.placementRepository.ts` (SQL, per `modules/tasks/README.md`),
`tasks.placementEffects.ts` (production effects adapter). "Leave sprint"
(`{ sprint: null }`) and "back to backlog" (`"backlog"`) are two targets; the
module header records why. Refusals are `{ ok: false, code, error }` with a
closed `PlacementRefusalCode` union. Ticket rows lock `FOR UPDATE` in id order;
sprint rows `FOR SHARE` so completion cannot race the freeze check. Legacy
fragments (`setSprint`, `setSprintAndDueDate`, `clearSprint`, `LEAVE_SPRINT`,
`REMEMBER_DUE_DATE`) were retained during implementation and removed as issues
03–07 migrated their callers (P14).
Suite: `__tests__/tasks.placement.integration.test.ts` (32 cases, real
PostgreSQL) and `__tests__/tasks.placementEffects.test.ts`.

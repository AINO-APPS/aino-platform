# Ticket05 platform + web integration evidence

Status: integrated on `integration/project-types`, 2026-11-09.

## Merge and compatibility inspection

- Integration started clean at `3ac80aa15df2b490f2a2abc86b711173f018c336`.
- Ticket branch/worktree tip was
  `bdf8f91a67969f20356c6ce7d85a40bbd2cc7b14`. That commit already included
  integration, but was not an ancestor of integration.
- Conflict-free `--no-ff` merge:
  `f1e327a4c5650d7bed020c76cc5c8b4be2da4f6b`, with the integration baseline
  and ticket tip as its two parents and the required co-author trailer.
  Ticket05 is now an ancestor of integration.
- Git blob identity confirms migration0031 is unchanged from the baseline,
  and migration0032 exactly matches the ticket tip. Numbering remains ordered:
  `0031_ticket_hierarchy.sql`, then `0032_project_types_scrum_planning.sql`.
- Migration0032 moves a completed parent with unfinished subtasks, including
  completed sibling subtasks, together when retiring an active automatic
  sprint. It preserves completed sprint history and hand-edited due dates,
  records restorations and uses its one-time backfill marker for safe replay.
- The hierarchy placement checks remain in the shared placement service;
  sprint join/leave no longer writes due dates. Legacy Scheduled reads and
  planned-date placement shims remain, with the public route snapshot unchanged.
  No ticket11 implementation or destructive compatibility removal was added.

## Verification on the merged tree

- `npm --prefix server run typecheck`: passed.
- `npm --prefix client run typecheck`: passed.
- `npm --prefix server run lint:deps`: passed, no dependency violations.
- `npm run contracts:validate`: passed, **88 tests**.
- `npm run check:guardrails`: passed.
- Server `npm test -- --runInBand --silent --runTestsByPath` with
  `tasks.placementEffects.test.ts`, `tasks.placementRoutes.test.ts`,
  `tasks.placement.integration.test.ts`,
  `projectTypesPlanningMigration.integration.test.ts`,
  `tasks.hierarchy.integration.test.ts` and
  `sprintCompletion.integration.test.ts`: **30 passed, 45 skipped** across
  two passing and four skipped suites.
- Server same runner with `routes.snapshot.test.ts` and
  `tasks.sprintLifecycle.test.ts`: **10 tests and one snapshot passed**.
- Client `npm test -- --reporter=dot --maxWorkers=1 --testTimeout=30000`
  with all 17 added/modified ticket05 UI test files: **83 passed**.
  An earlier default-parallel run hit the five-second timeout in the
  sprint-detail test and first axe audit, cascading into "Axe is already
  running" failures. The full focused set passed serially without code changes.
- `git diff --check`: passed.

`TASKS_SCHEMA_TEST_DATABASE_URL` was unset, no PostgreSQL process or standard
test listener was available, and no existing container/service listener was
identified. No containers or services were started, stopped or reconfigured.
The prior implementer's ordered 0031-to-0032 disposable-PostgreSQL pass is
retained in the ticket as prior evidence, not claimed as rerun here.
The known legacy full sprint-route mock failures were not part of this focused
verification. No push, release or production operation was performed.

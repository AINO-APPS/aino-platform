# 07: Re-time due dates when a sprint's end moves

**What to build:** Sprint edit and sprint resume call `retimeSprintDueDates`
whenever `end_date` changes (B6, ADR-015 amendment 2026-11-01).

**Blocked by:** 02

**Status:** done (2026-11-02)

## Context

- Edit `routes/sprints.ts:115-170` (`end_date` at `:145-147`); resume
  `routes/sprints.ts:544-560` shifts `end_date` by the paused duration.
- Spec P7.

## Acceptance criteria

- [x] Changing `end_date` and re-timing members commit together.
- [x] Only members whose `due_date` equals the old end move; hand-edited due
      dates stay.
- [x] Re-timed tickets get a due-date history row and `task_updated` after commit.
- [x] Completed sprints cannot change `end_date` (existing freeze holds).

## Comments

Sprint edits and resume now update the sprint and call
`retimeSprintDueDates` within one transaction. Only tickets whose due date
matches the previous end date are retimed; each receives due-date history and
post-commit `task_updated`. The completed-sprint freeze remains enforced.

Validation: `npx jest __tests__/sprints.routes.test.ts --runInBand` (17 tests),
`npm run typecheck`, and `npm run check:guardrails` passed.

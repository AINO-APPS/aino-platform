# 07: Re-time due dates when a sprint's end moves

**What to build:** Sprint edit and sprint resume call `retimeSprintDueDates`
whenever `end_date` changes (B6, ADR-015 amendment 2026-11-01).

**Blocked by:** 02

**Status:** ready-for-agent

## Context

- Edit `routes/sprints.ts:115-170` (`end_date` at `:145-147`); resume
  `routes/sprints.ts:544-560` shifts `end_date` by the paused duration.
- Spec P7.

## Acceptance criteria

- [ ] Changing `end_date` and re-timing members commit together.
- [ ] Only members whose `due_date` equals the old end move; hand-edited due
      dates stay.
- [ ] Re-timed tickets get a due-date history row and `task_updated` after commit.
- [ ] Completed sprints cannot change `end_date` (existing freeze holds).

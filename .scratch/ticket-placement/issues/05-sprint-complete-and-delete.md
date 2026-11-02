# 05: Transactional sprint completion and deletion

**What to build:** Sprint completion and sprint deletion run in one transaction
each and move their tickets through the placement module, fixing B2, B3 and the
double-completion race.

**Blocked by:** 02

**Status:** ready-for-agent

## Context

- Completion `routes/sprints.ts:409-490`: read-then-check guard (`:416`),
  burndown snapshot, velocity, carry-over raw SQL (`:447-451`) or `LEAVE_SPRINT`
  (`:462`), provenance, status flip, cache invalidation, team notification.
- Deletion `routes/sprints.ts:173-190`: `LEAVE_SPRINT` then delete.
- Auto-sprint rollover `services/sprintScheduler.ts:121-150` (`completeAndRollover`)
  repeats the manual carry-over with raw SQL (spec B9); it moves to placement
  in this issue too.
- Spec P8, P11, P12.

## Acceptance criteria

- [ ] Completion claims the sprint with
      `UPDATE … WHERE id = $1 AND status <> 'completed' RETURNING`; a second
      concurrent request gets 409 and moves nothing.
- [ ] Burndown snapshot, velocity, ticket placement, provenance and status flip
      commit or roll back together.
- [ ] Carried tickets get the **target** sprint's end as `due_date` and keep their
      remembered own due date.
- [ ] Tickets moved out keep their planned day (→ Scheduled) and get their own due
      date back.
- [ ] Cache invalidation and the team notification run after commit.
- [ ] Deletion places members out of the sprint in the same transaction as the
      `DELETE`, with per-ticket history and realtime.
- [ ] PostgreSQL test: two concurrent completions → exactly one succeeds.
- [ ] The scheduler's `completeAndRollover` uses the same transactional path;
      its carried tickets get the next sprint's end as `due_date`.
- [ ] `node scripts/check-placement-writes.mjs` baseline lowered for
      `routes/sprints.ts` and `services/sprintScheduler.ts`.

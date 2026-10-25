# 22: Realtime field deltas

**What to build:** Two people looking at the same backlog or board see each other's changes arrive live. Changes travel as field-level deltas, so simultaneous edits to different fields both survive, and a card visibly indicates who changed it just now.

**Blocked by:** 03, 05

**Status:** done

- [x] A change made by one user appears for another without a refresh
- [x] Deltas carry only changed fields, the actor and a timestamp — never the whole object
- [x] Simultaneous edits to different fields both persist
- [x] The same field edited twice resolves to the later write, deterministically
- [x] The affected card shows a non-blocking indication of who changed it
- [x] An optimistic local change reconciles with the broadcast without visible flicker
- [x] The delta payload is validated by a contract test

## Comments

- `modules/tasks/tasks.deltas.ts` owns the delta rules: an allow-list of fields,
  a diff that compares numerically (Postgres returns NUMERIC as `"5.00"` while
  the client sends `5`), and an apply that patches only the fields present.
- `emitTaskUpdated` now carries `{ fields, actor, at }` alongside `{ taskId,
  action }`. The update and status routes diff the row before and after the
  write, so a broadcast never contains the whole object.
- Two people editing different fields both survive because each delta carries
  only its own field. The same field edited twice resolves to the later `at`,
  and an out-of-order frame is ignored rather than rolling a field back.
- `useTaskDeltas` patches the rows already on screen instead of refetching, so a
  teammate's edit lands without flicker. `task_assigned` still refetches because
  it can add a row that is not on screen yet.
- The affected card shows a short-lived "Updated by <name>" note that fades on
  its own and never blocks interaction.
- The AsyncAPI `TaskUpdatedEvent` documents the delta, and three contract tests
  pin it: the payload shape, the server allow-list, and the client mirror.
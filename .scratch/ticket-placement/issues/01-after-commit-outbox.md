# 01: afterCommit outbox on db.transaction

**What to build:** Let code running inside `db.transaction` register side effects
(realtime emits, notifications) that run only after `COMMIT` succeeds, and never
after `ROLLBACK`.

**Blocked by:** —

**Status:** done (2026-11-01)

## Context

- `makePoolTransaction` (`server/platform/db/pool.ts:47-61`) runs
  `BEGIN → fn(client) → COMMIT`, rolling back on throw. Tenant DBs reuse it
  (`platform/db/tenantPools.ts:165`).
- Realtime is emitted synchronously from handlers via `broadcastTaskUpdated` →
  `emitTaskUpdated` (`routes/tasks/_helpers/statusEvents.ts:53-63`);
  notifications likewise. Nothing waits for commit.
- Spec decision P6.

## Acceptance criteria

- [x] The transaction callback receives a way to register `afterCommit(fn)`
      callbacks without breaking existing `transaction(async (client) => …)`
      callers (all current call sites compile unchanged).
- [x] Callbacks run in registration order only after `COMMIT` resolves.
- [x] On `ROLLBACK` no callback runs.
- [x] A throwing callback is logged and does not fail the request or skip later
      callbacks (best-effort, like today's notifications).
- [x] Unit tests cover commit, rollback and throwing-callback cases with a fake
      client.

## Notes

Keep the outbox a plain list of closures; no persistence, no retry. A durable
outbox is out of scope.

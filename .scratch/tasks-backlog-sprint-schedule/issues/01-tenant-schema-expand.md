# 01: Tenant schema expand

**What to build:** A tenant database, whether newly created or upgraded, gains the new task columns without losing data: a date-only planned date beside the existing one, a backfilled workflow-state reference for every task, a completion timestamp maintained automatically by the database when a task enters or leaves the done category, a per-team order value seeded in creation order, and a table recording what a sprint committed when it started. The old columns stay in place so nothing breaks. A tenant whose existing values cannot be mapped fails the migration loudly rather than being half-upgraded.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] Every task ends with a workflow state whose category matches its former status; no row is skipped or guessed
- [ ] Setting a workflow state in the done category sets the completion timestamp; moving it out clears it; the timestamp cannot be written directly by a client
- [ ] Order values are unique within a team and seed in creation order
- [ ] A newly created tenant and an upgraded tenant end with an identical schema
- [ ] A database seeded with an unmappable status fails the migration with a clear message naming the tenant and the offending value
- [ ] The migration runs on an empty database without error
- [ ] The test seam is a disposable Postgres applying the full tenant schema; run twice to prove idempotency

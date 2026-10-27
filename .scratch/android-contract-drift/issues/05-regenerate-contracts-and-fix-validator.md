# 05: Regenerate contracts and make the validator catch unregistered routes

**What to build:** Restore the promise that a contract change cannot slip past CI.

**Blocked by:** —

**Status:** ready-for-agent

## Context

`POST /api/tasks/:id/transfer` was added in `c8fda557` (`server/routes/tasks/transfer.ts:26`).
It appears in `server/__tests__/__snapshots__/routes.snapshot.test.ts.snap`, but is **absent**
from `contracts/http-route-inventory.json` and `contracts/openapi.json`.

`node scripts/validate-contracts.mjs` still exits 0. It compares OpenAPI ↔ inventory; it never
compares the route snapshot to either. `node scripts/generate-api-models.mjs --check` passes
because the spec was never touched — so the generated models for web, Android and iOS are
frozen at a pre-`c8fda557` contract.

None of the five commits in `6eddadcc..bbecd347` regenerated contracts.

**Why this matters beyond one missing route:** the "a field rename in the contract must break
the build" guarantee covers nothing. Android shipped `task_ids` against a server reading `ids`
for months and every platform guard stayed green.

## Scope

- Regenerate `contracts/openapi.json` and `contracts/http-route-inventory.json`.
- Make the validator compare the route snapshot against the inventory so an unregistered
  route fails CI.
- Verify `generate-api-models.mjs --check` now reports real drift for the affected client
  models rather than passing on an untouched spec.

## Related doc debt (same pass)

- `API_DOCUMENTATION.md:486-491` documents `DELETE /api/tasks/:id` as "Delete a task (creator
  only)" returning `{message: "Task deleted"}`. The route cancels, is team-write, returns
  `{cancelled, id, task}`, and can return three distinct `409`s (`cancel.ts:28-77`).
- `docs/TASKS_DESIGN_SPEC.md` D49 says status changes do not notify; `bbecd347` added
  `status_changed` (`modules/tasks/tasks.notifications.ts:16,154`) and removed `status_change`
  from `SILENT_ACTIONS` (`:25`).

## Acceptance

- Both contract files include every route in the snapshot.
- Adding a route without regenerating fails CI.
- OpenAPI documents the new `409` bodies and codes.
- `API_DOCUMENTATION.md` and D49 match the code.

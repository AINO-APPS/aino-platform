# 08: IN_SPRINT in contracts

**What to build:** Record the new `409 IN_SPRINT` response of
`PATCH /tasks/:id/schedule` in `contracts/` and confirm neither client can hit it.

**Blocked by:** 03

**Status:** done (2026-11-02)

## Context

- Spec P4, P16. Web and Android hide Scheduled for sprinted tickets, so the code
  should be unreachable from UI.

## Acceptance criteria

- [x] `contracts/openapi.json` documents `409` with `code: IN_SPRINT` on the
      schedule endpoint; `npm run contracts:validate` passes and generated models
      are refreshed.
- [x] Web (`client/`) and Android (`aino-android`) schedule callers checked: either
      unreachable for sprinted tickets, or they show the server message.
- [x] Android `TaskRepository.kt:64-66` KDoc corrected to "planned day only"
      (review finding B8).

## Comments

- Added the `409 IN_SPRINT` response example to the schedule contract and confirmed
  generated models are current. Web scheduling uses only backlog/Scheduled
  collections, which exclude sprint tickets; Android task details can attempt a
  schedule, so the view model now displays the server's refusal message.
- Corrected the Android Scheduled KDoc to "planned day only".
- Validation: `npm run contracts:validate` (52 tests), `npm run check:guardrails`,
  and Android `TaskScheduleErrorTest` plus `TaskRepositoryTest` passed.
- Platform commits: `dcca06ee`, `973b7df6`; Android commit: `ba7672c4`.

# 08: IN_SPRINT in contracts

**What to build:** Record the new `409 IN_SPRINT` response of
`PATCH /tasks/:id/schedule` in `contracts/` and confirm neither client can hit it.

**Blocked by:** 03

**Status:** ready-for-agent

## Context

- Spec P4, P16. Web and Android hide Scheduled for sprinted tickets, so the code
  should be unreachable from UI.

## Acceptance criteria

- [ ] `contracts/openapi.json` documents `409` with `code: IN_SPRINT` on the
      schedule endpoint; `npm run contracts:validate` passes and generated models
      are refreshed.
- [ ] Web (`client/`) and Android (`aino-android`) schedule callers checked: either
      unreachable for sprinted tickets, or they show the server message.
- [ ] Android `TaskRepository.kt:64-66` KDoc corrected to "planned day only"
      (review finding B8).

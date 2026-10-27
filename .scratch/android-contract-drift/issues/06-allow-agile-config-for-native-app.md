# 06: Let the native app read agile config

**What to build:** Allow `GET /api/agile/config` for native clients, so the app can render the
tenant's real workflow instead of fallback defaults.

**Blocked by:** —

**Status:** ready-for-human

## Context

`/api/agile` is mounted behind `webOnlyExcept` (`server/http/routes.ts:83`) — the only carve-out
today is `permissions/(requests|grants)`.

`webOnly` refuses any request that looks like the native app: a Bearer token with no cookie, a
token minted with `cli: "mobile"`, or the header `X-AINO-Client: android`
(`server/middleware/webOnly.ts:40-46`). The Android app sends
`X-AINO-Client: android` **on every request** (`RequestHelpers.kt:14`).

So `GET /api/agile/config` always returns `403 {"code": "WEB_ONLY"}` to the app, the failure is
swallowed (`TaskViewModel.kt:337`), and:

- The board's **columns are fallback defaults**, not the tenant's configured `workflowStates`.
- Estimation type, estimation values and unit label are defaults.
- The `transitions` added in `bbecd347` are unreachable, so the app cannot disable illegal
  status moves.

Tenant-defined workflow states have never reached the phone.

## Proposed change

Add the config **read** to the `webOnlyExcept` allow-list:

```js
app.use("/api/agile", apiLimiter, webOnlyExcept((req) =>
    req.method === "GET" && req.path === "/config"
    || !/^\/permissions\/(requests|grants)(\/|$)/.test(req.path)), agileRoutes);
```

Keep every write path (`workflow-states`, `settings`, work item types) web-only. Reading a
tenant's workflow configuration is not administration; editing it is.

Confirm the allow-list predicate composes correctly against the existing one rather than
replacing it — writes must stay gated.

## Acceptance

- `GET /api/agile/config` with `X-AINO-Client: android` returns the `{settings, workItemTypes,
  workflowStates, canEdit, transitions}` body.
- Every `/api/agile` write still returns `403 WEB_ONLY` for the app.
- Contract tests updated for the changed gate.

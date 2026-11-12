# Client-version observation and upgrade readiness

The gate supports OFF, REPORT and ENFORCE. Compatibility server endpoints
remain available until ticket 11's separate rollout prerequisites are met.
Implementing enforcement does not activate it: the default remains OFF.

## Configuration (platform-wide, not tenant-overridable)

| Environment variable | Safe default |
| --- | --- |
| `CLIENT_VERSION_MODE` | `off` |
| `CLIENT_VERSION_MIN_ANDROID` | `0.0.0` |
| `CLIENT_VERSION_MIN_DESKTOP` | `0.0.0` |
| `CLIENT_VERSION_MIN_WEB` | `0.0.0` |

Mode must be exactly `off`, `report` or `enforce`. Missing values use the defaults
above. Invalid modes or minimums are rejected at application startup with the
offending variable named; they never silently disable protection. Prerelease
and build metadata are allowed.

In ENFORCE, recognized clients below their class's minimum receive HTTP 426
before authentication, with `CLIENT_UPGRADE_REQUIRED`, `client`, `min_version`
and `current_version`. Responses are not cacheable. Missing or malformed client
versions count as `0` (the precedence of `0.0.0`). Numeric components and
prerelease identifiers follow semantic-version ordering; build metadata does
not affect precedence. Equal or newer versions pass through. Unknown clients
are never gated. Health and GET/HEAD `/api/client-versions` remain exempt.

For a separately approved rollout, first deploy this implementation with OFF,
then use REPORT to inspect adoption. Only then set ENFORCE and the released
step-B minimums: Android `0.27.18`, desktop and web `3.0.80`. Verify startup,
the public configuration, a refusal below each minimum, and access at the
minimum. Changing configuration requires the normal application restart/deploy;
there is no per-tenant override. Returning to OFF disables enforcement without
removing compatibility APIs. Ticket 11 additionally requires every organization
to have switched to project ownership; do not remove legacy storage or routes
merely because enforcement code exists.

Run the existing master and tenant migration flow before an operator separately
opts in: tenant `0033_client_versions.sql`, master
`0011_client_versions.sql`. Expand only, safe to rerun, no backfilled or invented
usage timestamps. Existing mobile/web session exclusivity is unchanged.

## Reads and interpretation

- Public GET `/api/client-versions`: mode and all three semantic minimums.
  Available before authentication/tenant/maintenance middleware; no-store.
- Tenantless platform-admin GET `/api/admin/client-versions`: distinct users
  per class/version in a rolling 30-day window, using authenticated request
  last-seen, not session creation. Existing console realm, role, web-only and
  recent-MFA guards apply. Response: `{ window_days: 30, versions: [...] }`.
- Unknown clients are never gated or counted. Recognized clients with missing
  or malformed versions count as `0`. Legacy bearer/mobile detection and
  desktop origin remain recognized. Anonymous/forged/revoked/impersonated
  identities are never counted as authenticated users.
- Reports retain observations after logout or session replacement. Identity
  includes the tenant (platform principals use a separate namespace). One user
  can appear under several versions/classes; do not sum rows as unique users.
  Observations refresh on active usage, including long-lived old sessions.
  The table is not purged by this release; only the last 30 days are reported.
- Monitor `Client version observation failed` warnings before trusting adoption.
  REPORT is fail-open and does not change successful API/auth responses.

## Bundled web identity and 426

All first-party API transports send `X-AINO-Client` and
`X-AINO-Client-Version`. Android uses its version name. Browser and Electron
renderer use the immutable web build version, not `client/package.json`'s
`1.0.0` or Electron's runtime shell version. Vite derives it from existing
desktop release metadata plus `+web.<source-revision>` (`GITHUB_SHA`,
`RAILWAY_GIT_COMMIT_SHA` or git). A Docker context without revision metadata
gets a unique build timestamp identifier. It is embedded in JS and
`client-version.json`; the desktop proxy forwards it or uses that bundled
manifest as fallback. Third-party signed-upload requests receive no client or
auth headers. A legacy opaque redirect without a readable Location fails safely
with 502 rather than following with credentials; current servers stream desktop
uploads directly. Build metadata distinguishes observations but has no semver
ordering: release-stage numeric version bumps must precede minimum increases.

In ENFORCE the server can emit the contract clients already handle:

```json
{"code":"CLIENT_UPGRADE_REQUIRED","client":"web","min_version":"3.0.80","current_version":"3.0.79"}
```

Any first-party API failure, including anonymous notes and non-Axios same-origin
fetches, can trigger the global blocking boundary. Web reloads; desktop checks
through its existing updater, keeps failures retryable, and exposes the
existing restart/install action after download. It cannot be dismissed.

## Published EXPAND release (2026-11-12)

- [Desktop v3.0.80](https://github.com/AINO-APPS/aino-platform/releases/tag/v3.0.80)
  and [Android v0.27.18](https://github.com/AINO-APPS/aino-android/releases/tag/android-v0.27.18)
  are published. Android's version code is `27018`; its direct APK and Play AAB
  signatures and actual package/version metadata were verified.
- Web and bundled desktop identity is `3.0.80+web.e218cfca5003`. All desktop
  release files, three updater feeds and Android's published artifacts match
  their checksums. macOS includes both DMG installers and x64/arm64 ZIP updater
  payloads; the feed's ZIP references and SHA-512 values were verified.
- Production GET `/api/client-versions` returns OFF and `0.0.0` minima with
  `no-store`. Web/realtime/worker deployments report SUCCESS. No gate, ownership
  switch, compatibility removal, network or workspace-plan change occurred.
- Released browser requests and blocking reload were verified with a valid
  426 intercepted only inside the isolated browser harness. Production was not
  made to emit 426. Existing native/desktop transport and update/restart tests
  pass; physical-device and installed-desktop acceptance were not run.
- Desktop installers retain the existing unsigned distribution posture.
  Android publication is GitHub plus the R2 direct-update channel, **not a Play
  Store upload**.
- No backup or recovery proof exists. The operator explicitly represented all
  current data as disposable internal testing and accepted the known planning/
  date migration risk, waiving the pre-release backup condition for this
  publication only. This is not a waiver for future customer-data migrations.
- Full source, CI, deployment, asset and runtime evidence is in the local
  [ticket-09 tracker](../.scratch/project-types/issues/09-report-client-versions-and-handle-upgrades.md).

## Separate operator work

Verify project ownership rollout independently. Unswitched tenants retain the
migration-needed state; this release never silently returns to team scope or
changes their switch.

Only after separate operator approval, opt in to REPORT and inspect adoption,
then enforce released minimums. No deployment or operator configuration change
was authorized for ticket 10's code-only implementation. Destructive legacy
endpoint/schema removal belongs to ticket 11 and additionally requires every
organization to have switched ownership.

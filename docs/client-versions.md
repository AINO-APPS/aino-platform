# Client-version observation and upgrade readiness

Ticket 09 implements OFF and REPORT only. No configuration can activate
enforcement in this release. Compatibility server endpoints remain available.
Do not enable REPORT or set production minimums as part of this change.

## Configuration (platform-wide, not tenant-overridable)

| Environment variable | Safe default |
| --- | --- |
| `CLIENT_VERSION_MODE` | `off` |
| `CLIENT_VERSION_MIN_ANDROID` | `0.0.0` |
| `CLIENT_VERSION_MIN_DESKTOP` | `0.0.0` |
| `CLIENT_VERSION_MIN_WEB` | `0.0.0` |

Only exact `report` opts in to observation; absent, invalid or `enforce` values
remain OFF. Invalid/non-semantic minimums fall back to `0.0.0`. Prerelease and
build metadata are allowed. The minima are informational in ticket 09.

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

## Bundled web identity and future 426

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

The server does **not** emit 426 yet. Clients are prepared for:

```json
{"code":"CLIENT_UPGRADE_REQUIRED","client":"web","min_version":"3.0.80","current_version":"3.0.79"}
```

Any first-party API failure, including anonymous notes and non-Axios same-origin
fetches, can trigger the global blocking boundary. Web reloads; desktop checks
through its existing updater, keeps failures retryable, and exposes the
existing restart/install action after download. It cannot be dismissed.

## Release work remains separate

1. Complete/review Android's separate ticket-09 work and shared public contract.
2. Merge the reviewed platform changes, run release validation and use
   `scripts/set-desktop-version.mjs` for desktop `3.0.80` or later with matching
   lock metadata. No version bump, publish, tag or deployment occurs here.
3. Package the new web bundle with its manifest; prove update/restart on an
   installed desktop and blocking reload in a released browser build.
   macOS must ship both DMG installers and ZIP updater payloads for x64 and
   arm64; verify the ZIP references in the published `latest-mac.yml`.
4. Verify project ownership rollout independently; this ticket never changes
   tenant ownership switches.
      Released planning shows a migration-needed state for an unswitched tenant,
      never silently returning to team scope or changing that tenant's switch.
5. Only after client releases and operator approval, opt in to REPORT and
   inspect real adoption. Minimum enforcement belongs to ticket 10, destructive
   legacy endpoint/schema removal to ticket 11.

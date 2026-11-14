# Client versions

The app-wide middleware runs after cookies and
before tenant/authentication middleware. OFF does not inspect identities or
write anything; REPORT never rejects a request. ENFORCE returns an uncacheable
426 upgrade contract for recognized versions below their class's minimum.
Semantic prerelease precedence is honored; build metadata does not affect
ordering. Missing/invalid client versions have the precedence of `0.0.0`.
Malformed operator configuration is rejected at app startup, not defaulted away.
Explicit unknown client headers
are ignored. Missing or invalid versions on recognized clients count as `0`.
Legacy `isMobileClient` and `workpulse://app` origin detection apply only when the
class header is absent.

The public GET `/api/client-versions` is mounted before tenant resolution,
authentication and maintenance checks. Health probes are exempt. Its response is
`{ mode: "off" | "report" | "enforce", minimums: { android, desktop, web } }`.
GET and HEAD recovery reads, including a trailing slash, are exempt.

Authentication calls the service **after** token-version, session and
impersonation checks. Only verified, non-impersonated principals are observed.
Session `observed_client_class`, `client_version` and `client_version_seen_at`
are audit fields, distinct from `client_class` (`mobile`/`web` sign-in
exclusivity). Activity updates refresh their actual last-seen timestamp.

The repository also upserts master observations by tenant-safe identity, class
and version, independent of session lifetime. Logout, replacement and continued
usage do not erase adoption history. GET `/api/admin/client-versions` requires
the existing tenantless platform-admin identity/realm guards and returns
`{ window_days: 30, versions: [{ client, version, users }] }`. Users may appear in
multiple versions/classes; totals must not be summed as unique platform users.
No tenant SQL is exposed through routes.

Expand migrations: tenant `0033_client_versions.sql`, master
`0011_client_versions.sql`. Both are idempotent; new-database baselines include
the same fields. OFF is safe during rolling migration. Observation failures log
and fail open, never turning a valid authenticated request into an auth failure.

See [operator guide](../../../docs/client-versions.md). HTTP tests use a
miniature Express/no-DB seam; service tests exercise the persistence port, and
`clientVersions.integration.test.ts` uses the authorized disposable PostgreSQL
test runner for real upserts, rolling windows, tenant isolation and reruns.

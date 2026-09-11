# ADR-009: Control plane and application plane are separate hosts and realms

- **Status:** Accepted
- **Date:** 2026-09-11
- **Related:** ADR-012 (default tenant has no data privilege),
  `docs/PLATFORM_TENANT_SEPARATION_PLAN.md` (PR-B), Constitution Principle I

## Context

The Platform Console and the tenant product shared one origin, one cookie
(`token`), one auth middleware and one JWT shape. The only marker distinguishing
a control-plane principal was a `platform: true` claim, checked by a single
middleware (`requirePlatformIdentity`) mounted on one router.

Consequences:

- A token was structurally valid on either plane. Nothing but per-router
  middleware discipline stopped a console session being replayed against a
  tenant endpoint, or the reverse.
- `resolveTenant` would happily attach a tenant pool to a console request if the
  JWT carried a `tenant_id`, or if a `tenants.custom_domain` row pointed at the
  console hostname.
- Logging out of one surface logged you out of the other; a password change on
  one re-issued the cookie for both.

AWS's SaaS guidance is explicit that isolation is a **separate layer** from
authentication and authorisation: "a user could be authenticated and authorized,
and still access the resources of another tenant." A `platform: true` boolean is
an authorisation answer to an isolation question.

Every comparable product separates the provider console physically:
`admin.atlassian.com`, `console.aws.amazon.com`, `manage.auth0.com`.

## Decision

**The control plane gets its own hostname and its own authentication realm.**

1. **`CONSOLE_HOST`** (e.g. `console.aino.org.in`) serves the Platform Console.
   Optional: unset keeps single-host behaviour, so the change is backwards
   compatible until DNS is cut over.
2. **Two realms**, `tenant` and `platform`, each with its own cookie —
   `token` and `aino_console`. Neither sets a `domain` attribute, so the browser
   scopes each to its issuing host. **This is the isolation primitive:** the
   console cookie is physically incapable of being sent to the app host, which
   no amount of server-side discipline can guarantee on a shared origin.
3. **JWTs carry the realm in `aud`.** `platform/realm.ts` verifies the signature
   and the realm together, distinguishing "wrong realm" (401 `WRONG_REALM`) from
   "bad signature" so the two produce different metrics and responses.
4. **Reserved hosts never resolve to a tenant.** `platform/reservedHosts.ts` is
   consulted in `resolveTenant` before any JWT claim or custom-domain lookup,
   and `PUT /:id/domain` rejects a reserved hostname with 409 `RESERVED_DOMAIN`.
5. **Realm-scoped session operations.** Login, refresh, logout and password
   change read and write only their own realm's cookie.
6. **Realtime is tenant-only.** A platform-realm token cannot open a WebSocket;
   the control plane has no realtime surface.
7. **Grace window.** Pre-PR-B tokens carry no `aud`. They are accepted as
   *tenant* tokens while `STRICT_REALM` is unset — never as platform tokens — so
   a legacy token can never reach the console. `aino_legacy_realmless_token_total`
   tracks the decay; flip `STRICT_REALM=true` once it hits zero.

Note that `requirePlatformIdentity` now checks two independent things:
`isPlatformUser` answers *who* the principal is, `realm` answers *where the
request arrived*. Requiring both means a stolen token replayed on the wrong
host fails even when the principal is legitimate.

## Consequences

### Positive

- Cross-realm replay is stopped by the browser, not by a code path that could be
  forgotten on the next route.
- Console and tenant sessions coexist independently — the prerequisite for PR-C
  linked principals, where one human holds both.
- A tenant can no longer take over the console via `custom_domain`.
- The plane a request belongs to is knowable before any token is parsed.

### Negative / accepted trade-offs

- Realm switching now requires a cross-host handoff (PR-C) rather than an
  in-page state change; a cookie cannot be set for another host.
- Impersonation mints a **tenant**-realm token from a **platform** request. On a
  single host the cookie is written in place as before; once split, the client
  must carry the returned token to the app host. Documented at the call site.
- Two cookie names to reason about. Mitigated by routing every read through
  `readAuthToken()` and every write through `cookieNameForRealm()`.

## Verification

- `reservedHosts.test.ts` — normalisation (port/case/trailing dot), reservation,
  realm mapping, single-host fallback.
- `realmAudience.test.ts` — matching realms accepted; both cross-realm
  directions rejected; bad signature vs wrong realm distinguished; grace window
  tenant-only and closed by `STRICT_REALM`; array-valued `aud`.
- `realmCookies.test.ts` — no `domain` attribute; console stays SameSite=strict
  even for a desktop origin; no cross-realm cookie fallback; Bearer accepted on
  tenant host only.
- `reservedHostTenantGuard.test.ts` — console host attaches master context and
  never queries `custom_domain`, even with a `tenant_id` claim present.

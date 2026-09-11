# Provisioning `console.aino.org.in`

Ops runbook for the PR-B control-plane host. See
[`PLATFORM_TENANT_SEPARATION_PLAN.md`](PLATFORM_TENANT_SEPARATION_PLAN.md) and
[`adr/ADR-009`](adr/ADR-009-control-plane-vs-application-plane.md).

## What this actually is

**No new service, no new deployment.** The console is served by the same Worker
and the same Railway services as the app. The only thing that changes is the
*hostname*, and the hostname is what makes the isolation real:

> Cookies are scoped by the browser to the host that set them (we set no
> `domain` attribute). Serving the console from its own hostname means the
> control-plane session cookie `aino_console` is **physically incapable** of
> being sent to `aino.org.in`, and the tenant `token` cookie is incapable of
> reaching the console. That is a browser guarantee, not a code path that can
> be forgotten in a future PR.

Everything else — realm `aud` checks, reserved-host guards — is defence in
depth behind that one property.

---

## Step 1 — DNS record (Cloudflare dashboard)

### Verified production target (Railway CLI, 2026-09-11)

The linked Railway project is **`aino-platform-next`**, environment
**`production`**. Its web service is **`aino-next-web`**:

| Railway property | Current value |
|---|---|
| Service | `aino-next-web` |
| Railway service domain | `aino-next-web-production.up.railway.app` |
| Existing custom domain | `next.aino.org.in` |
| Existing custom-domain CNAME target | **`n0kt5sw7.up.railway.app`** |
| Application port | `5000` |

Therefore use **`n0kt5sw7.up.railway.app`** as the exact Cloudflare CNAME
target. Do not use the service's `.up.railway.app` display domain as the CNAME
target when Railway has supplied a distinct custom-domain target.

**DNS → Records → Add record** in the `aino.org.in` zone.

| Field | Value | Why |
|---|---|---|
| Type | `CNAME` | Railway/Worker origins are hostnames, not fixed IPs |
| Name | `console` | Produces `console.aino.org.in` |
| Target | **`n0kt5sw7.up.railway.app`** | Verified target currently used by `next.aino.org.in` |
| Proxy status | **Proxied (orange cloud)** | **Mandatory** — see below |
| TTL | Auto | Ignored while proxied |

> **The orange cloud is not optional.** A grey-cloud (DNS-only) record bypasses
> Cloudflare entirely, so the Worker route never matches, the request goes
> straight to origin, and `X-Forwarded-Host` is never set. The server would then
> see the Railway hostname, resolve the request to the **tenant** realm, and the
> console would silently behave as a tenant surface. Orange cloud, always.

Do not copy the apex `aino.org.in` record blindly: the currently linked
production service exposes `next.aino.org.in`, whose verified target is the
value above.

## Step 2 — Worker route

Already committed in `infra/cloudflare/wrangler.toml`:

```toml
{ pattern = "console.aino.org.in/*", zone_name = "aino.org.in" },
```

Deploy it:

```bash
cd infra/cloudflare
npm test          # router unit tests
npx wrangler deploy
```

Confirm in **Workers & Pages → aino-edge-router → Settings → Domains & Routes**
that all three routes are listed.

Do **not** add `console.aino.org.in` as a second Railway custom domain. The
Cloudflare Worker owns the browser-visible hostname and forwards `/api/*` to
the web origin. Railway only needs to continue serving its existing active
custom domain `next.aino.org.in` on port `5000`.

No `src/router.js` change is needed: routing is by *path*, and the console
consumes exactly the same paths as the app (`/api/*` → web, everything else →
SPA). The plane split is by auth realm, not by origin.

## Step 3 — Railway environment

### Live audit (Railway CLI, 2026-09-11)

The following was read from Railway's `production` environment. Secret values
were not copied into this document.

| Service | Role | `CONSOLE_HOST` | Console in `CORS_ORIGIN` | `VITE_CONSOLE_HOST` | `STRICT_REALM` |
|---|---|---:|---:|---:|---:|
| `aino-next-web` | `web` | **MISSING** | **MISSING** | **MISSING** | missing (correct initially) |
| `aino-next-realtime` | `realtime` | not required | **MISSING** | not required | not required |
| `aino-next-worker` | `worker` | not required | not required | not required | not required |
| `aino-next-rollback` | `all` | **MISSING** | **MISSING** | **MISSING** | missing (correct initially) |

Existing web/realtime/rollback CORS value:

```text
https://aino.org.in,https://www.aino.org.in,https://next.aino.org.in,https://aino-edge-router.workpulse-io.workers.dev
```

Append `https://console.aino.org.in`; do not replace the existing origins.

> **PRE-DEPLOY BLOCKER — `JWT_SECRET`:** Railway's current configured-variable
> API does not list `JWT_SECRET` on the web, realtime, worker or rollback
> services. The running deployments are healthy, which means either the active
> deployment snapshot still has an older value or the deployed revision did
> not enforce the current startup validation. Do **not** assume the next deploy
> will inherit it. Before deploying PR-B, add/verify one shared `JWT_SECRET` on
> **web, realtime, worker and rollback**. Although the worker does not serve
> user HTTP requests, `server/index.ts` calls `validateEnvironment()` before
> dispatching the process role, so the new worker revision also fails startup
> without it. It
> must be the **same existing value** on all three. Do not generate a new value
> as part of this change: rotating it logs out every user and drops every
> WebSocket session. The current code fails fast at startup if it is absent.

Safe presence check (prints only `True`/`False`, never the secret):

```powershell
$services = 'aino-next-web','aino-next-realtime','aino-next-worker','aino-next-rollback'
foreach ($service in $services) {
  $vars = railway variable list --service $service --environment production --json |
    ConvertFrom-Json
  "$service JWT_SECRET configured: $($null -ne $vars.JWT_SECRET)"
}
```

If it reports `False`, recover the **existing production secret** from the
original service/configuration or secrets manager and set that value on all
four services. Never copy the development value from `server/.env`.

On the **web** service (and the rollback `ROLE=all` service, if still running):

```
CONSOLE_HOST=console.aino.org.in
```

Bare hostname — no scheme, port or path. `bootstrap/env.ts` refuses to start
otherwise, rather than silently disabling the split.

Also append the console origin to `CORS_ORIGIN` on the **web**, **realtime** and
rollback services, per the note at the top of `wrangler.toml`:

```
CORS_ORIGIN=https://aino.org.in,https://www.aino.org.in,https://next.aino.org.in,https://aino-edge-router.workpulse-io.workers.dev,https://console.aino.org.in
```

Leave `STRICT_REALM` **unset** for now (step 6).

### Current setup checklist

| Item | Current state | Required action |
|---|---|---|
| `console.aino.org.in` DNS record | **Not resolving** | Add the proxied CNAME from Step 1 |
| Worker route in repository | Added | Deploy `infra/cloudflare/wrangler.toml` with `wrangler deploy` |
| Worker route in Cloudflare account | Not verifiable from this machine (`CLOUDFLARE_API_TOKEN` absent) | Confirm after deploy in Cloudflare dashboard |
| Railway custom domain `next.aino.org.in` | Active on `aino-next-web`, port 5000 | No change |
| Railway custom domain for `console.aino.org.in` | None | **Do not add one**; the Worker owns this hostname |
| `CONSOLE_HOST` | Missing on web + rollback | Add to both |
| Console origin in `CORS_ORIGIN` | Missing on web + realtime + rollback | Append to all three |
| `VITE_CONSOLE_HOST` in R2 SPA build | Added in `.github/workflows/web-release.yml` | Publish the SPA after merge |
| `VITE_CONSOLE_HOST` in Railway Docker fallback | Missing on web + rollback | Add to both |
| `STRICT_REALM` | Missing | Correct initially; add `true` only after the grace window |
| `JWT_SECRET` | Not listed in configured Railway variables | Recover/verify the existing shared production value before deploy |

### Exact Railway CLI changes

These commands modify production variables and normally trigger redeploys.
Run them after the PR-B code is deployed/available, and preserve the existing
CORS entries exactly as shown:

```powershell
# Web service. VITE_CONSOLE_HOST is also set here because the Docker fallback
# build compiles the SPA on Railway. The primary R2 build is configured in
# .github/workflows/web-release.yml (Step 4).
railway variable set --service aino-next-web --environment production `
  CONSOLE_HOST=console.aino.org.in `
  VITE_CONSOLE_HOST=console.aino.org.in `
  CORS_ORIGIN="https://aino.org.in,https://www.aino.org.in,https://next.aino.org.in,https://aino-edge-router.workpulse-io.workers.dev,https://console.aino.org.in"

# Realtime: only CORS is needed. Do NOT add CONSOLE_HOST here.
railway variable set --service aino-next-realtime --environment production `
  CORS_ORIGIN="https://aino.org.in,https://www.aino.org.in,https://next.aino.org.in,https://aino-edge-router.workpulse-io.workers.dev,https://console.aino.org.in"

# Rollback ROLE=all service (needed while retained for rollback)
railway variable set --service aino-next-rollback --environment production `
  CONSOLE_HOST=console.aino.org.in `
  VITE_CONSOLE_HOST=console.aino.org.in `
  CORS_ORIGIN="https://aino.org.in,https://www.aino.org.in,https://next.aino.org.in,https://aino-edge-router.workpulse-io.workers.dev,https://console.aino.org.in"
```

`aino-next-worker` needs no console variable: it serves no HTTP traffic.

After setting them, confirm names/presence without printing secrets:

```powershell
railway variables --service aino-next-web --environment production --kv |
  Select-String 'CONSOLE_HOST|VITE_CONSOLE_HOST|CORS_ORIGIN|STRICT_REALM|JWT_SECRET'
```

## Step 4 — Client build

The SPA needs to know which host is the console so it can pick the right shell:

```
VITE_CONSOLE_HOST=console.aino.org.in
```

Production split mode serves the SPA from **R2**, built by
`.github/workflows/web-release.yml`; setting this only on Railway cannot alter
already-compiled static assets. The workflow now commits the public, non-secret
constant directly:

```yaml
VITE_CONSOLE_HOST: console.aino.org.in
```

Keep the same variable on `aino-next-web` and `aino-next-rollback` because the
Docker image also builds and embeds the SPA for direct-origin validation and
rollback mode. `Dockerfile` declares `ARG VITE_CONSOLE_HOST` and promotes it
before `npm run build`; without that declaration a Railway runtime variable
would be too late to affect Vite's compiled bundle. Without the variable,
`currentRealm()` returns `"tenant"` everywhere and
the UX split does not appear (the server still enforces realms).

## Step 5 — Verify

```bash
# 1. Resolves and is proxied by Cloudflare
dig +short console.aino.org.in
curl -sI https://console.aino.org.in | grep -i '^server:'      # expect: cloudflare

# 2. Serves the SPA
curl -s https://console.aino.org.in | head -c 200              # expect: <!doctype html>

# 3. API reachable on the console host
curl -sI https://console.aino.org.in/api/health                # expect: 200

# 4. THE KEY CHECK — a tenant session must NOT authenticate here.
#    Log in at https://aino.org.in, copy the `token` cookie, then:
curl -s -o /dev/null -w '%{http_code}\n' \
  -H 'Cookie: token=<paste>' \
  https://console.aino.org.in/api/admin/tenants                # expect: 401

# 5. And the reverse: a console session must not work on the app host.
#    Log in at https://console.aino.org.in, copy `aino_console`, then:
curl -s -o /dev/null -w '%{http_code}\n' \
  -H 'Cookie: aino_console=<paste>' \
  https://aino.org.in/api/profile                              # expect: 401
```

Checks 4 and 5 are the ones that matter. A `200` on either means the realm
boundary is not in force — most likely `CONSOLE_HOST` is unset or the DNS record
is grey-cloud.

In the browser: log in at both hosts in the same session and confirm
DevTools → Application → Cookies shows `token` **only** under `aino.org.in` and
`aino_console` **only** under `console.aino.org.in`.

## Step 6 — Close the grace window

Tokens minted before PR-B carry no `aud` claim. They are accepted as **tenant**
tokens only (never platform), so nothing can reach the console with one — but
they should not be accepted forever.

1. After deploy, watch `aino_legacy_realmless_token_total` on `/metrics`.
2. Every refresh re-stamps a token with `aud`, so the rate decays to zero within
   roughly one 8-hour token lifetime.
3. When it is flat at zero, set `STRICT_REALM=true` and redeploy.
4. Watch `aino_realm_mismatch_total` — it should stay at zero. A non-zero rate
   after this point is a client bug or a replay attempt, and is worth an alert.

## Rollback

Unset `CONSOLE_HOST` and redeploy. The server reverts to single-host behaviour
immediately: one cookie, realm checks inert, `requirePlatformIdentity` back to
its pre-PR-B condition. The DNS record and Worker route can stay — they simply
serve the app. No migration to reverse; `0004_platform_roles.sql` is additive.

## Troubleshooting

| Symptom | Cause |
|---|---|
| Console behaves as a tenant surface; `/tenants` 403s | `CONSOLE_HOST` unset or misspelt on the web service |
| Everything 401s on the console | `VITE_CONSOLE_HOST` missing from the client build, so the SPA sends tenant-shaped requests |
| WebSocket/chat breaks after adding the host | Console origin missing from `CORS_ORIGIN` on the **realtime** service |
| Tenant cookie works on the console (check 4 returns 200) | Grey-cloud DNS record — Worker never runs, `X-Forwarded-Host` absent |
| `Error: CONSOLE_HOST must be a bare hostname` at boot | Value includes `https://`, a port, or a trailing path |

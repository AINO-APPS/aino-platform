# Platform / Tenant Separation — Architecture Plan

> **Status:** PR-A + PR-B + PR-C code complete · production rollout gates remain
> **Owner:** platform team · **Created:** 2026-09-11 · **Updated:** 2026-09-11
>
> Progress markers: `[ ]` not started · `[~]` in progress · `[x]` done · `[-]` deferred

---

## 1. Problem statement

A platform admin opening any tenant in the Platform Console can read that
tenant's user rows (PII) **without the tenant super_admin approving access**.
For the default tenant (AINO) this is permanent, unaudited, standing access.

This blocks a second requirement: AINO must host the project's own employees
*and* the platform operators, without the two administration surfaces mixing.

### Root causes (verified in code)

| # | Cause | Evidence |
|---|---|---|
| RC1 | `is_default` unconditionally bypasses the consent gate | `server/utils/impersonationApproval.ts:331` `if (tenant.is_default) return true;` |
| RC2 | One role ladder for two authority domains; `platform_admin` = level 6, above the tenant owner | `server/middleware/rbac.ts:42-59`; promotion at `rbac.ts:217,222,246` |
| RC3 | One identity/session shape for both planes; JWT has no `aud` | `server/routes/auth.ts:392` (only `platform: true`) |
| RC4 | Platform identity **erases** tenant membership on login | `server/routes/auth.ts:123-144` deactivates + hides the employee row |
| RC5 | `scope: 'read'` is stored, signed and displayed but **never enforced** | signed `routes/tenants.ts:1474`; shown `InspectorSessionBanner.tsx:87`; no consumer |
| RC6 | Platform **reads** of tenant data are not audited | `logPlatformAction` called on mutations only |
| RC7 | Impersonation action log is an in-process `Map` | `server/middleware/impersonationAudit.ts:29` |
| RC8 | `is_default` is overloaded across 3 unrelated concerns | service desk `routes/serviceDesk.ts:37-61`; scrub exemption `utils/migrationRunner.ts:85`; consent bypass |

**Scale:** 180 `platform_admin` references server-side, 104 client-side.

---

## 2. Market reference model

| Source | Principle adopted |
|---|---|
| AWS SaaS Architecture Fundamentals | Control plane is **not** multi-tenant and holds no tenant data; isolation is a **separate layer** from authN/authZ — "a user could be authenticated and authorized, and still access another tenant's resources" |
| Microsoft GDAP | Zero standing access; customer **explicitly grants**; time-bound; per-customer partitioned; least privilege by default |
| Google Access Transparency / Access Approval | Justification required; customer approves; **reads logged**; the log is visible **to the customer** |
| Salesforce Grant Login Access | The customer grants, with an automatic expiry |
| Auth0 Organizations | Org-scoped roles; one user may hold **multiple memberships**; explicit context selection at login |
| Atlassian admin hub | Physically separate admin surface; product admins "can't access Atlassian Administration" |

**Dogfooding rule (Slack/Atlassian/GitHub):** the vendor's own workspace is
just another tenant in the application plane, administered through the normal
product admin UI — never through the staff console.

---

## 3. Target architecture

```
  console.aino.org.in                          app.aino.org.in / <tenant>.aino.org.in
┌──────────────────────────────┐            ┌────────────────────────────────────────┐
│  CONTROL PLANE               │            │  APPLICATION PLANE                     │
│  realm: platform             │            │  realm: tenant                         │
│  store: platform_users       │            │  store: <tenant_db>.users              │
│  cookie: aino_console        │            │  cookie: token                         │
│  roles: owner/operator/      │            │  roles: super_admin … employee         │
│         support/auditor      │            │                                        │
│                              │            │  ┌──────────────────────────────────┐  │
│  Sees per tenant:            │            │  │ AINO — just another tenant       │  │
│   name, slug, status, plan,  │            │  │ employees live here, /admin only │  │
│   SEAT COUNT, db size,       │            │  └──────────────────────────────────┘  │
│   storage, migration lag     │            │  ┌──────────────────────────────────┐  │
│  Never: a user row.          │            │  │ acme, globex, … customers        │  │
└──────────┬───────────────────┘            │  └──────────────────────────────────┘  │
           │                                └──────────────▲─────────────────────────┘
           │      THE ONLY CROSSING — GDAP-style bridge    │
           └───────────────────────────────────────────────┘
             request(justification, scope, duration)
           → tenant approves (6-digit code) → JIT session
           → time-boxed · scope-enforced · reads+writes audited · revocable
```

### Design rules

- **R1** No standing access to any tenant, **including AINO**. `is_default` confers zero data privilege.
- **R2** Provider roles are a separate, lower-privilege ladder; an inspector never outranks the approver.
- **R3** Realm-scoped identity; one human may hold two linked principals.
- **R4** One isolation choke point, deny-by-default.
- **R5** Access Transparency: the tenant can read its own record of provider access.

### Locked decisions

| # | Decision |
|---|---|
| D1 | Auth0-style **linked principals with a realm switcher** |
| D2 | Provision **`console.aino.org.in`** as a separate host |
| D3 | AINO's `super_admin` approves platform access via the **same 6-digit flow** as any customer |
| D4 | Ship **Phase 0 + Phase 1 together** before release |

---

## 4. Release train

```
Pre-flight  Verify AINO has a real super_admin      read-only script   BLOCKING
PR-A        Close the leak                          no schema change   ~1 day
PR-B        Console host + realm-scoped sessions    1 master migration ~2 days
PR-C        Linked principals + realm switcher      1 master migration ~3 days
```

**Deferred to Phase 2+ (explicitly NOT in this train):** removing `ROLE_LEVEL` 6,
`support_inspector` rename, cross-org bypass removal in `organization.ts`,
scope enforcement (RC5), audit durability (RC7), `/api/console` route split.

---

## Pre-flight gate — BLOCKING

D3 makes AINO's `super_admin` the approver for platform access to AINO. If AINO
has no active non-platform `super_admin`, PR-A locks us out of our own tenant.

- [x] **PF1** `server/scripts/preflight-default-tenant-admin.ts` — read-only, exits non-zero on failure
  - [x] AINO tenant resolves (`is_default = TRUE`, and exactly one)
  - [x] ≥1 `users` row `role='super_admin' AND is_active AND NOT hidden_from_directory`
  - [x] that user is not also in `platform_users`
  - [x] reports every human in both `platform_users` and `user_directory` (PR-C backfill input)
- [x] **PF2** npm script `preflight:default-admin`
- [ ] **PF3** Wire as a required CI check
- [ ] **PF4** Run against production; sign off — **BLOCKS PR-A DEPLOY**

---

## PR-A — Close the leak

No schema change. AINO staff keep working through `/admin` throughout.
Revertible in isolation.

- [x] **A1** Delete `if (tenant.is_default) return true;` — deny-by-default for every tenant
      · `server/utils/impersonationApproval.ts`
- [x] **A2** Rename `ensureDefaultTenant` → `assertTenantDataAccess`; `NON_DEFAULT_USER_DATA_MSG` → `TENANT_USER_DATA_MSG`;
      `NON_DEFAULT_ACTIVITY_MSG` → `TENANT_ACTIVITY_MSG` · `server/routes/tenants.ts`
- [x] **A3** Audit **reads** — `platform_tenant_user_read`; mutation renamed `platform_tenant_user_deactivated`
      · `server/routes/tenants.ts`
- [x] **A4** `activity_restricted` now applies to AINO too; seat count / db size / storage retained as platform facts
      · `server/routes/tenants.ts`
- [x] **A5** Drop the `is_default` rejection on user-create; AINO uses the same one-shot bootstrap (break-glass path)
      · `server/routes/tenants.ts`
- [x] **A6** Remove Users / Departments / Teams / Chart tabs; drop `getTenantUsers` + `getAdminOrganizations`;
      add "Request access" panel; `TenantSettings` no longer takes `org` · `client/src/pages/tenants/TenantDetail.tsx`
- [x] **A7** Default tenant now denied without a live session (+2 new cases)
      · `server/__tests__/tenantDataConsent.test.ts`
- [x] **A8** New `server/__tests__/platformPlaneIsolation.test.ts` — 8 cases, real consent gate (not mocked)
- [x] **A9** `routes.snapshot` diff empty; **107/107 suites, 1061/1061 tests green**; server typecheck clean
- [x] **A10** ADR-012 — default tenant has no data privilege (+ indexed in `docs/adr/README.md`)

---

## PR-B — Console host + realm-scoped sessions

- [x] **B1** `CONSOLE_HOST` env + fail-fast validation (bare hostname) + prod warning when unset;
      `STRICT_REALM` validated · `bootstrap/env.ts`, `.env.example`
      · Worker route added to `infra/cloudflare/wrangler.toml`
      · Runbook: [`docs/CONSOLE_HOST_SETUP.md`](CONSOLE_HOST_SETUP.md)
      · Railway CLI audit complete: project `aino-platform-next`, service `aino-next-web`,
      active custom domain `next.aino.org.in`, exact CNAME target `n0kt5sw7.up.railway.app`
      · R2 SPA workflow now embeds `VITE_CONSOLE_HOST=console.aino.org.in`
      · ⚠️ **DNS record + `wrangler deploy` + Railway env remain outstanding** — exact commands/checklist in the runbook
      · ⚠️ **Pre-deploy blocker:** `JWT_SECRET` is not listed in current Railway configured variables;
      recover/verify the same existing production value on web, realtime, worker and rollback before deploy
      (`validateEnvironment()` runs before process-role dispatch)
- [x] **B1a** `requestHost()` — resolve realm from `X-Forwarded-Host`, not `Host`.
      **Bug fix:** behind the Cloudflare Worker (`infra/cloudflare/src/index.js` rewrites the
      URL to a Railway origin) the raw `Host` is `*.up.railway.app`, so realm detection would
      have resolved EVERY production request to the tenant realm and the console would never
      have been recognised. Same fix applied to custom-domain resolution.
- [x] **B2** `server/platform/reservedHosts.ts`; three guards:
  - [x] never resolves to a tenant — short-circuit at top of `resolveTenant` + `resolveFromDomain` · `middleware/tenant.ts`
  - [x] cannot be claimed as `custom_domain` → `409 RESERVED_DOMAIN` · `routes/tenants.ts`
  - [x] implies platform realm — `realmForHost()`, enforced in `requirePlatformIdentity` (`PLATFORM_REALM_REQUIRED`)
- [x] **B3** Realm-aware cookies — `TENANT_COOKIE='token'` (unchanged), `PLATFORM_COOKIE='aino_console'`,
      no `domain` attr, console pinned to SameSite=strict, `readAuthToken()` helper · `utils/cookie.ts`
- [x] **B4** JWT `aud` claim + `platform/realm.ts`; `401 WRONG_REALM`; grace window (tenant-realm only)
      w/ `aino_legacy_realmless_token_total` + `aino_realm_mismatch_total`; `STRICT_REALM` flag
      · signed at all 5 mint sites (login, register, refresh, password-change, impersonation)
- [x] **B5** CORS allowlist; `/refresh` + `/logout` + password-change per-realm; realtime rejects platform tokens;
      realm-scoped `must_change_password` guard · client `currentRealm()` + `canMountInRealm()`
- [x] **B6** Master migration `0004_platform_roles.sql` — `platform_role` (4 tiers) + `mfa_required`,
      mirrored in `masterSchema.ts`, surfaced by `GET /platform-users` (**enforced in Phase 2**)
- [x] **B7** ADR-009 — control plane and application plane are separate hosts and realms
- [x] **B8** **111/111 suites, 1103/1103 tests green**; 8/8 Cloudflare Worker tests;
      route snapshot unchanged; server/client targeted typechecks clean

> **Bug caught by the suite:** the auth router's mobile body-token mirror matched
> `name === "token"`, so platform tokens silently stopped being mirrored once
> login moved to `aino_console`. Fixed at source (`AUTH_COOKIE_NAMES`), not in
> the test.

**Note:** dual sessions need no migration — platform sessions live in the master
DB keyed by `platform_users.id`, tenant sessions in the tenant DB keyed by
`users.id`. `UNIQUE(user_id)` (`master/0003`) is not violated across databases.
Redis is already namespaced by `tenantId` (`redis.ts:211`).

---

## PR-C — Linked principals + realm switcher

- [x] **C1** Master migration `0005_platform_user_links.sql` — explicit links, durable single-use
      `realm_handoffs`, durable single-use `realm_login_choices`; mirrored in `masterSchema.ts`
- [x] **C2** Destructive login self-heal removed. Tenant and platform candidates are resolved independently;
      matching email/username alone grants no authority; an explicit link is required
  - [x] `scripts/backfill-platform-user-links.ts` — dry-run default, `--apply`; repairs only the exact historical pollution shape
        and scans tenant databases directly so it can recover rows whose `user_directory` entry the old self-heal deleted
- [x] **C3** Login realm chooser — `409 REALM_CHOICE_REQUIRED`, credential validation against both principals,
      60-second audience-bound and atomically single-use ticket; `POST /auth/login/realm`
- [x] **C4** Cross-host handoff — 30-second signed, audience-bound, atomically single-use Postgres JTI;
      `POST /auth/switch-realm`, `POST /auth/handoff`; source session preserved; token carried in URL fragment
      (not CDN/origin logs); wrong-host presentation does not burn the ticket
- [x] **C5** Owner-only link management APIs + Platform Admins UI. Links target an existing active visible tenant
      user by explicit IDs and never create a user, browse a directory, or copy tenant permissions
- [x] **C6** Client — login realm chooser, `/auth/handoff`, profile-menu realm switcher shown only when linked,
      realm-keyed guards retained; production R2 and Railway fallback builds receive `VITE_CONSOLE_HOST`
- [x] **C7** ADR-011 — linked principals remain separate identities and authority domains
- [x] **C8** Validation — server **112/112 suites, 1111/1111 tests**; client **35/35 files,
      246/246 tests**; production client build and server typecheck pass; route snapshot reviewed (+6 routes)

> **MFA limitation (fail-closed):** `platform_users.mfa_required` exists but provider MFA enrollment/verification
> is not implemented in this train. Realm switching always requires the platform password. Accounts explicitly
> marked `mfa_required=true` receive `MFA_REQUIRED` and cannot switch until Phase 2 adds provider MFA verification.

---

## 5. Test matrix

| File | Asserts | Status |
|---|---|---|
| `platformPlaneIsolation.test.ts` | AINO user list 403 without session; 200 + audit row with one | [x] |
| `tenantDataConsent.test.ts` | default tenant denied without a live session | [x] |
| `realmAudience.test.ts` | cross-realm token rejected; realmless accepted only pre-`STRICT_REALM` | [x] |
| `reservedHosts.test.ts` | host normalisation, reservation, realm mapping, single-host fallback | [x] |
| `reservedHostTenantGuard.test.ts` | console host never attaches a tenant pool; `custom_domain` never consulted | [x] |
| `realmCookies.test.ts` | no `domain` attr; no cross-realm cookie fallback; console SameSite=strict | [x] |
| `realmChoice.test.ts` | dual candidate → no cookie + ticket; ticket non-authenticating | [ ] |
| `realmHandoff.test.ts` | single-use, 30s expiry, only target cookie set, source session alive | [ ] |
| `dualSessionCoexistence.test.ts` | both sessions active; no unique-constraint violation | [ ] |
| `platformUserLinks.test.ts` | login no longer deactivates the tenant row | [ ] |

---

## 6. Rollout

| Step | Gate |
|---|---|
| 1 | Pre-flight green (AINO has a real `super_admin`) — blocks everything |
| 2 | Backfill dry-run reviewed — manual sign-off |
| 3 | Deploy PR-A — watch `TENANT_USER_DATA_RESTRICTED` 403s |
| 4 | DNS live — curl returns SPA, no tenant resolution |
| 5 | Deploy PR-B (`STRICT_REALM` unset) — watch legacy-token counter |
| 6 | Deploy PR-C + backfill `--apply` — verify one dual principal end to end |
| 7 | `STRICT_REALM=true` once the counter reaches 0 (~8h, JWT lifetime) |

**Rollback:** PR-A reverts cleanly. PR-B/C revert by unsetting `CONSOLE_HOST`
and re-enabling the legacy cookie path; both migrations are additive.

---

## 7. Open risks

| Risk | Mitigation | Phase |
|---|---|---|
| Session invalidation for dual principals — a tenant password change must not silently kill the platform session, but a credential compromise should kill both | Per-realm invalidation + explicit `revokeAllRealms(linkId)` for admin-initiated resets | PR-C |
| `must_change_password` on one realm bounces the other (`App.tsx:77`) | Realm-scope the guard | PR-B |
| 284 `platform_admin` references make the Phase 2 role split large | CI grep-gate added when Phase 2 starts | Phase 2 |
| Removing level 6 breaks unnoticed callers | Enumerated list already captured; grep-clean check | Phase 2 |

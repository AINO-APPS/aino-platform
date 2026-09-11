# ADR-012: The default tenant has no data privilege

- **Status:** Accepted
- **Date:** 2026-09-11
- **Supersedes:** the `is_default` exemption in `hasTenantDataConsent()`
- **Related:** `docs/PLATFORM_TENANT_SEPARATION_PLAN.md` (PR-A), Constitution
  Principle I (Multi-Tenancy Isolation)

## Context

`hasTenantDataConsent()` gated platform-admin access to tenant-private data
(user rows / PII, business-activity metrics) behind the consent flow in
`tenant_access_requests` — but opened with:

```ts
if (tenant.is_default) return true;   // server/utils/impersonationApproval.ts:331
```

Consequences for the default (AINO) tenant:

- Every `platform_users` account could read the full employee directory —
  `id, username, full_name, email, role, is_active` — via
  `GET /api/admin/tenants/:id/users`.
- No access request, no tenant super_admin approval, no time bound, no
  revocation, and **no audit record** (reads never called `logPlatformAction`).
- The console UI mirrored the bypass, rendering Users / Departments / Teams /
  Org Chart tabs whenever `tenant.is_default`.

This is standing cross-tenant access. Constitution Principle I permits an
intentional exception only with an explicit ADR; none existed. It also blocked
a product requirement: AINO must host the project's own employees *and* the
platform operators without the two administration surfaces merging.

The flag was overloaded three ways — service-desk home tenant
(`routes/serviceDesk.ts:37-61`), platform-admin scrub exemption
(`utils/migrationRunner.ts:85`), and this consent bypass — so its data-privilege
meaning was invisible at every call site.

### What the market does

- **AWS SaaS Architecture Fundamentals** — the control plane is *not*
  multi-tenant and holds no tenant data; isolation is a layer distinct from
  authN/authZ: "a user could be authenticated and authorized, and still access
  the resources of another tenant."
- **Microsoft GDAP** — zero standing access; the customer must *explicitly
  grant*; access is time-bound and partitioned per customer.
- **Google Access Approval / Access Transparency** — provider access requires a
  justification, is approved by the customer, and is **logged including reads**,
  with the log visible to the customer.
- **Atlassian / Slack / GitHub dogfooding** — the vendor's own workspace is just
  another tenant, administered through the normal product admin UI, never
  through the staff console.

## Decision

**`is_default` confers no data privilege. The default tenant is a customer of
the platform like any other.**

1. `hasTenantDataConsent()` denies by default for every tenant. The only path to
   tenant-private data is an approved, live, unrevoked session owned by the
   calling operator.
2. AINO's own `super_admin` approves platform access through the same 6-digit
   consent flow used for external customers.
3. AINO's staff are administered from the tenant Admin panel (`/admin`) by
   AINO's own admins — never from the Platform Console.
4. Platform **reads** of tenant PII emit `platform_tenant_user_read`; mutations
   emit `platform_tenant_user_deactivated`.
5. The console keeps platform facts: name, slug, status, plan, seat count,
   database size, storage usage. These drive billing, limit enforcement and
   lifecycle, and contain no PII.
6. `POST /:id/users` applies the one-shot bootstrap to all tenants uniformly,
   including the default one. The advisory lock plus the "already bootstrapped"
   check make this safe, and it is the break-glass path if AINO ever loses every
   `super_admin`.
7. `is_default` retains exactly one meaning going forward: **service-desk home
   tenant**.

## Consequences

### Positive

- Closes standing, unaudited access to employee PII.
- Restores Constitution Principle I without an exception.
- Unblocks employee/operator coexistence in AINO: the two roles are separated by
  the consent boundary rather than by a bypass.
- Reads become auditable — the prerequisite for tenant-facing Access
  Transparency (PR-C).
- One uniform code path; no default-tenant special case to reason about.

### Negative / accepted trade-offs

- Operators can no longer glance at AINO's user list from the console. They use
  `/admin` as tenant users, or request access. **Deliberate.**
- AINO must always have an active `super_admin` who is not also a platform
  operator, or nobody can approve access. Enforced before deploy by
  `npm run preflight:default-admin` and monitored at runtime by the existing
  `no_active_super_admin` alert.
- Console org-structure editing for AINO is removed; that is tenant
  configuration and belongs in `/admin`.

### Follow-up (tracked in the separation plan)

- PR-B — realm-scoped identity, `console.aino.org.in`.
- PR-C — linked principals so one human can hold both an AINO employee account
  and a platform operator account.
- Phase 2 — remove `platform_admin` from the tenant role ladder; enforce
  `scope='read'`; durable impersonation audit.

## Verification

- `server/__tests__/tenantDataConsent.test.ts` — the default tenant is denied
  without a live session, allowed only with one owned by the caller.
- `server/__tests__/platformPlaneIsolation.test.ts` — 403 without a session for
  both default and customer tenants; no tenant DB query is issued on denial;
  the read emits an audit row; another operator's session does not widen access.
- `server/__tests__/routes.snapshot.test.ts` — unchanged; no endpoint added,
  renamed or removed.

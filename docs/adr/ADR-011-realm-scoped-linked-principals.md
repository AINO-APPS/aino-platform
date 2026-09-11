# ADR-011: One human may hold linked principals in separate realms

- **Status:** Accepted
- **Date:** 2026-09-11
- **Related:** ADR-009, ADR-012, `PLATFORM_TENANT_SEPARATION_PLAN.md` PR-C

## Context

The same person may be an AINO employee and a platform operator. The previous
login resolver treated this as identity pollution: when an identifier existed
in `platform_users` and `user_directory`, the platform identity won and a
historical self-heal could delete the directory entry and deactivate/hide the
tenant user. That made legitimate coexistence impossible and encouraged the
default-tenant data bypass removed by ADR-012.

## Decision

1. The platform and tenant accounts remain separate principals with separate
   passwords, sessions, token versions and roles.
2. `platform_user_links` records an explicit relationship. Matching email or
   username alone never grants platform authority.
3. When both passwords validate and a link exists, login returns a 60-second,
   single-use realm chooser rather than silently selecting one identity.
4. Cross-host switching requires platform-password step-up and a signed,
   30-second, atomically consumed handoff. The JWT travels in a URL fragment so
   it is not sent to CDN/origin access logs.
5. Handoff and chooser JTIs live in PostgreSQL, not process memory, so replay
   prevention works across replicas and restarts.
6. Link management is platform-owner only, validates an existing active visible
   tenant user, and never creates a tenant user or copies a role.
7. Accounts whose `mfa_required` policy is true fail closed until provider MFA
   verification is implemented; password step-up is mandatory for all others.

## Consequences

- AINO employees and platform operators can coexist without merged authority.
- Source and target sessions coexist; switching does not destroy either one.
- The old destructive login self-heal is removed permanently and regression
  tested.
- Operators must know the tenant/user IDs when linking; the console does not
  regain a cross-tenant directory browser merely for convenience.
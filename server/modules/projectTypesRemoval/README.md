# Guarded project-types API retirement

This is the step-D runtime, not an EXPAND-compatible server. API requests fail
closed with `503 PROJECT_TYPES_REMOVAL_NOT_READY` unless
`PROJECT_TYPES_REMOVAL=api`, the client-version gate enforces at least Android
0.27.18 and desktop/web 3.0.80, and every organization's ownership is verified.
Unset or `off` configuration cannot bypass this check. Health and client-version
recovery reads remain available.

The HTTP guard never executes destructive SQL. The separate guarded contraction
runner migrates storage only after the same preflight; it is excluded from the
automatic tenant migration sweep. Do not deploy this runtime before the rollout
prerequisites have been verified.

Schema bootstrap recognizes the completed contraction marker and does not
reintroduce compatibility columns during subsequent pre-deploy migrations.

A tenant provisioned after the ownership switch was retired is created
project-owned (`platform/db/tenantOrganization.ts`). Left unswitched, it would
fail the all-organization verification and take every other tenant's API down.

On a fresh installation, deployment migrations also create empty legacy tenant
tables in the master database. That initialized legacy master may have zero
organizations, provided its project-owned data checks pass. Cataloged tenant
databases still require at least one switched organization, and any unswitched
organization, missing table or unreadable database still blocks the API. This
allows platform-admin sign-in and first-tenant creation without bypassing the
gate configuration or weakening checks on existing tenant data.

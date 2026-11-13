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

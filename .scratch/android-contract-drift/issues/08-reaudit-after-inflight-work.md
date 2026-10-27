# 08: Re-audit after the uncommitted lifecycle work lands

**What to build:** Nothing yet. This ticket records that the audit excluded in-flight work and
has to be re-run once it is committed.

**Blocked by:** the working tree being committed or stashed

**Status:** needs-info

## Context

When the audit was taken (2026-10-27), `master` had 8 uncommitted files:

```
 M client/src/pages/Tasks.tsx
 M client/src/pages/tasks/hooks/useBacklog.ts
 M client/src/pages/tasks/hooks/useTaskDetail.ts
 M client/src/pages/tasks/hooks/useTasksRoute.ts
 M client/src/pages/tasks/hooks/useTicketLifecycle.ts
 M scripts/client-file-sizes-baseline.json
?? client/src/pages/tasks/__tests__/detailSprintEditRefreshesPlan.test.tsx
?? client/src/pages/tasks/__tests__/sprintMembershipExclusive.test.tsx
```

These look like the follow-up to `bbecd347`: they touch the ticket-lifecycle hook and sprint
membership, which are exactly the areas the Android audit flagged (`INVALID_TRANSITION`,
`SPRINT_TEAM_MISMATCH`, sprint exclusivity).

They were **excluded** from the audit. If they change server routes or response shapes, the
findings in Android issues 03 and 04 may need revising.

Deliberately not regenerating contracts on top of a dirty tree — see issue 05.

## Acceptance

- The working tree is clean.
- The HTTP surface of the committed work is diffed against the audit's findings.
- Any new contract change is propagated to the Android issue list before R2 ships.

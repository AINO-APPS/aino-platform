# 11: Remove legacy planning and team compatibility

**What to build:** After current clients are enforced and every organization has switched to project ownership, the product and schema no longer carry Scheduled, timer or team-owned planning compatibility.

**Blocked by:** 02: Start dates without Scheduled placement; 03: Kanban board and backlog; 04: Task list views and calendar; 05: Scrum planning without Scheduled or auto sprints; 06: Enforce ticket hierarchy and create subtasks; 07: Show subtasks across planning and effort totals; 08: Complete sprints with one carryover rule; 10: Enforce minimum client versions; Phase 2 ticket 13 (Android project-scope release); project-ownership switch-over completed for every organization.

**Status:** resolved

**Delivery scope:** Guarded code-only implementation. **Live rollout:** blocked.
The checklist below records verified code and disposable local-database behavior,
not the state of production organizations or deployed settings.

- [x] Removal is refused until the version gate is enforcing the step B client minimums and all organizations have switched to project ownership.
- [x] Scheduled, schedule/unschedule, carry-forward, ticket timer, team sprint-config and team-transfer endpoints are removed.
- [x] Legacy team-scope parameters and response fields, `issue_key`, `planned_date`, and stored logged/estimated-minute aliases are removed.
- [x] Planned-day, pre-sprint due-date, ticket/sprint team, timer, automatic-sprint and team sprint-mode storage is removed after data has been migrated.
- [x] The project-ownership flag-off path and emergency switch-back are removed; project ownership is unconditional.
- [x] Contracts, Android endpoint coverage, parity records, documentation and guardrails describe only the supported API.
- [x] Contract tests verify removed endpoints and fields are absent, and a migration test verifies retained project-owned data.

## Comments

2026-11-12: The operator authorized code-only implementation of a guarded removal
path. No deployment, live gate/ownership configuration or remote database
operation was authorized. The last verified deployed gate was OFF, and
all-organization project ownership was not verified.

2026-11-13: Guarded implementation completed on `integration/project-types` in
both repositories. Platform fixes: `68e7b383`, `033fddce`; Android:
`3d0ab16a`, `ab8d1931`. The case-insensitive readiness bypass, legacy trigger
dependencies, bootstrap reintroduction of dropped columns, stale route fixtures,
canonical field leakage and Windows parity line endings are fixed. Read-only,
organization-scoped hierarchy repair/correction review remains available on the
Projects page; ownership switch and switch-back operations remain retired.

Validation:
- Server: 186 suites / 1,957 tests and route snapshot passed with coverage
  (`--maxWorkers=2 --testTimeout=30000` on the shared Windows host).
- Real PostgreSQL: all 23 suites / 252 tests passed, zero skips. Tests cover
  refusal before readiness, retained data, post-contraction ticket/sprint writes,
  repeat contraction, schema bootstrap replay and hierarchy audit isolation.
- Web: all 158 files / 1,072 tests passed; typecheck, production build and SPA
  artifact validation passed.
- All 93 contract tests, generated models, guardrails, server build/typecheck
  and dependency-layering checks passed.
- Android Play/Direct unit tests and builds plus Play lint passed. All five Node
  guardrails passed; endpoint parity: 272/540 covered, 236 waived,
  13 client-retired, 21 unrelated pending, zero unmatched.
- Standards review: no findings. All three final Spec review findings were fixed
  and verified with regression tests.

No live operation was performed. Unset/off/unready removal configuration fails
closed rather than exposing the contracted runtime. Do not deploy this step-D
server until the production gate and every organization's ownership have been
independently verified and the operator authorizes the rollout. This resolution
does not represent completed live compatibility removal or rollout of the spec.

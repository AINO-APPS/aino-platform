# 01: Project type controls and lifecycle

**What to build:** Members can create a Scrum, Kanban or Task list project, and project admins can see and change its type. The server enforces which types the organization may create and prevents a type change that would strand sprints.

**Blocked by:** None (can start immediately).

**Status:** resolved

**Acceptance scope:** Platform only: server and web/shared desktop renderer. Android remains separately incomplete and is not accepted by this resolution.

- [x] Project creation and project settings expose the project's type and the types available to the organization.
- [x] Without the `agile` feature, new projects and type changes are limited to Task list; existing Scrum and Kanban projects continue to work.
- [x] Project admins can change a project's type, except that leaving Scrum is refused while it has a planned, active or paused sprint.
- [x] Project responses include the Plan tabs and type-related capabilities needed by clients; clients render the server's decision.
- [x] Tests cover type creation and changes, feature restrictions, permissions and open-sprint refusal through project behavior.

## Answer

Platform implementation `b6963130` was integrated with a verified no-fast-forward merge, `8ab11f960a74c9d8001b3bc711e2d6164f740b43`, onto `integration/project-types` from `50547e65`.

Validation on the merged platform tree:

- Server: 12 suites, 332 tests and 1 route snapshot passed using `npm test -- --runInBand --runTestsByPath`. Suites: `tasks.projectTypes.test.ts`, `projectTypes.integration.test.ts`, `tasks.projectAccess.test.ts`, `projectsAccess.integration.test.ts`, `projects.routes.characterization.test.ts`, `routes.snapshot.test.ts`, `agileGating.test.ts`, `projectPlanning.integration.test.ts`, `sprintCompletion.integration.test.ts`, `tasks.capabilities.integration.test.ts`, `tasks.placementRoutes.integration.test.ts`, and `tasks.startDates.integration.test.ts`.
- Client: 8 suites / 26 tests passed: `ProjectTypeControl`, `ProjectForm`, `planningTabsByProject`, `useProjectScope`, `useTasksRoute`, `useTeamSwitchNavigation`, `planningTabsByTeam`, and `projectPlanningWorkflow`. `npm run typecheck` passed.
- Server `npm run build` and `npm run lint:deps` passed. Root `node scripts/verify-docker-migrations.mjs` and `node scripts/a2-verify-baseline.mjs` passed.
- Root `npm run contracts:validate` passed (87 tests); `npm run check:guardrails` passed.
- PostgreSQL integration tests used only the disposable local PostgreSQL instance at `127.0.0.1:44677`, with `aino_test` as the test database URL and isolated throwaway suite databases.

No integration-coupled fixes were needed. No Android changes, production changes, push or release were performed. Android acceptance remains outstanding.

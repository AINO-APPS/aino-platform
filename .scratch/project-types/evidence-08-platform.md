# Ticket08 platform + web implementation evidence

Status: implemented on `ticket/project-types-08`; Android is being handled in its separate worktree.

## Platform

- `planCarryover` is the shared pure rule used by preview and transactional completion. It moves nonterminal parents and terminal parents with open subtasks, carries every subtask with a moving parent regardless of its state, and leaves other terminal tickets in the closed sprint.
- The default is the next planned sprint in the same project (legacy team scope before project ownership), or Backlog when there is none.
- `GET /api/sprints/:id/completion-preview` accepts `rolloverTo=next|new|backlog` and returns `supportsNewSprint`, `selectedTarget`, `defaultTarget`, `defaultTargetType`, `hasNext`, `nextPlannedSprint`, `moving`, `movingParents`, `movingSubtasks`, `staying`, `movingPoints`, and optional `newSprint` metadata.
- `POST /api/sprints/:id/complete` accepts the same target in `rolloverTo`; omission uses the preview default. Legacy numeric sprint IDs remain accepted. New sprints are planned, project-owned, start the day after completion, and have the closing sprint's inclusive duration. Parent/child placement stays inside the same transaction and only changes sprint membership.
- `API_DOCUMENTATION.md` records the additive endpoint and DTO contract. No migration was needed.

## Web

- `SprintLifecycleControls` opens `SprintCompletionDialog`.
- The dialog defaults from the server preview, requests a refreshed preview for each selected target, uses only server-provided counts/tickets/points/dates, and gates new-sprint support on `supportsNewSprint === true` for older-server compatibility.

## Validation

- Server typecheck passed.
- Server Jest focus: lifecycle, sprint completion service and route snapshot — **14 passed**, one route snapshot passed.
- Client typecheck passed.
- `SprintCompletionDialog` Vitest suite — **6 passed**.
- `npm run contracts:validate` passed.
- `npm run check:guardrails` passed.
- `git diff --check` passed.

The public PostgreSQL HTTP test was added to `server/__tests__/projectPlanning.integration.test.ts`, covering preview, hierarchy-aware movement, new sprint dates/project ownership, and omitted-target default behavior. An attempt with the requested disposable URL (`postgresql://postgres:test@127.0.0.1:44677/aino_test`) timed out connecting, so the real-PostgreSQL assertions could not be executed. No database service was started or managed.

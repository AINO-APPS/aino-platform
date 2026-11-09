# 08: Complete sprints with one carryover rule

**What to build:** Scrum members can choose where unfinished work goes when completing a sprint, and the preview and server always agree, including for parents and subtasks.

**Blocked by:** 05: Scrum planning without Scheduled or auto sprints; 06: Enforce ticket hierarchy and create subtasks.

**Status:** implemented (platform + web)

- [x] The preview and completion operation use the same rule and default to the next planned sprint, or backlog if none exists.
- [x] Members can choose the next planned sprint, a new planned sprint or backlog.
- [x] A new sprint is created in the completing project's scope, starts the day after completion and lasts as long as the completed sprint.
- [x] A parent with any open subtask is treated as unfinished; when a parent moves, every subtask moves with it regardless of its own state.
- [x] The preview identifies moving and staying tickets, moving subtasks, points and the default destination.
- [x] Omitting a destination from the completion request applies the same default as the preview.
- [ ] Web and Android completion dialogs offer the same choices and display the server's preview. Web is implemented here; Android is maintained in its separate worktree.

**Validation:** Server and client typechecks passed; focused server tests (14 passed, including one route snapshot) and SprintCompletionDialog tests (6 passed) passed. Contracts and all repository guardrails passed. The PostgreSQL HTTP integration scenario was added but could not be run: the specified disposable URL `postgresql://postgres:test@127.0.0.1:44677/aino_test` timed out during connection. No database service was started or managed. See [platform evidence](../evidence-08-platform.md).

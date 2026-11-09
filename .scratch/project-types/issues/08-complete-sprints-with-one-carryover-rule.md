# 08: Complete sprints with one carryover rule

**What to build:** Scrum members can choose where unfinished work goes when completing a sprint, and the preview and server always agree, including for parents and subtasks.

**Blocked by:** 05: Scrum planning without Scheduled or auto sprints; 06: Enforce ticket hierarchy and create subtasks.

**Status:** implemented (platform/web + Android completion flow); permission-capability regression verification pending

**Platform acceptance:** accepted for integration. The non-PostgreSQL validation passed; the PostgreSQL-backed HTTP integration test was added but remains unverified because its configured disposable database URL timed out during connection. This is an outstanding validation gate, not a passing test; no database service was started or modified.

**Android acceptance:** completion preview and destination selection are integrated. The focused 58-test JVM run and five guardrails passed before the additional lifecycle-permission capability change; its new focused decoder/authorization test is pending the shared Gradle slot.

**Permission capability validation:** Server project/sprint capability tests (10), web UI tests (3), server/client typechecks, contracts and platform guardrails passed. Android's focused decoder/authorization regression test is pending the shared Gradle slot.

- [x] The preview and completion operation use the same rule and default to the next planned sprint, or backlog if none exists.
- [x] Members can choose the next planned sprint, a new planned sprint or backlog.
- [x] A new sprint is created in the completing project's scope, starts the day after completion and lasts as long as the completed sprint.
- [x] A parent with any open subtask is treated as unfinished; when a parent moves, every subtask moves with it regardless of its own state.
- [x] The preview identifies moving and staying tickets, moving subtasks, points and the default destination.
- [x] Omitting a destination from the completion request applies the same default as the preview.
- [x] Web and Android completion dialogs offer the same choices and display the server's preview.
- [ ] Project-scoped sprint rows expose the server-decided `can_manage` capability, and both clients use it for lifecycle controls. Web tests pass; Android regression test is pending.

**Validation:** Server and client typechecks passed; focused server tests (14 passed, including one route snapshot) and SprintCompletionDialog tests (6 passed) passed. Contracts and all repository guardrails passed. The PostgreSQL HTTP integration scenario was added but could not be run: the specified disposable URL `postgresql://postgres:test@127.0.0.1:44677/aino_test` timed out during connection. No database service was started or managed. See [platform evidence](../evidence-08-platform.md).

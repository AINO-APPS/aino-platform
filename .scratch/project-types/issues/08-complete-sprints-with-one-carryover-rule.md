# 08: Complete sprints with one carryover rule

**What to build:** Scrum members can choose where unfinished work goes when completing a sprint, and the preview and server always agree, including for parents and subtasks.

**Blocked by:** 05: Scrum planning without Scheduled or auto sprints; 06: Enforce ticket hierarchy and create subtasks.

**Status:** ready-for-agent

- [ ] The preview and completion operation use the same rule and default to the next planned sprint, or backlog if none exists.
- [ ] Members can choose the next planned sprint, a new planned sprint or backlog.
- [ ] A new sprint is created in the completing project's scope, starts the day after completion and lasts as long as the completed sprint.
- [ ] A parent with any open subtask is treated as unfinished; when a parent moves, every subtask moves with it regardless of its own state.
- [ ] The preview identifies moving and staying tickets, moving subtasks, points and the default destination.
- [ ] Omitting a destination from the completion request applies the same default as the preview.
- [ ] Web and Android completion dialogs offer the same choices and display the server's preview.

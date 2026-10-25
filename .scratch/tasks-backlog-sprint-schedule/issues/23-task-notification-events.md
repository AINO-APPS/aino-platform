# 23: Task notification events

**What to build:** People are told about the five things that matter: being assigned a task, being added to a sprint, a sprint starting, a sprint completing with a summary of what moved, and a due date approaching. Nothing is emitted for status changes or reordering.

**Blocked by:** 05

**Status:** done

- [x] All five events notify the relevant people
- [x] The sprint-completion notification summarises what moved
- [x] Status changes and reordering emit no notification
- [x] Each notification deep-links to the task or sprint it concerns
- [x] Notification payloads are validated by a contract test

## Comments

- `modules/tasks/tasks.notifications.ts` declares exactly the five events and
  the actions that must stay silent (`status_change`, `reordered`, `ranked`).
  Status changes and reordering emit nothing — at board volume they are noise.
- Being assigned a task already notified (ticket 05's `notifyTaskAssigned`).
  This ticket adds the other four: added to a sprint, sprint started, sprint
  completed, and a due date approaching.
- Sprint events go to the team roster minus the actor; being added to a sprint
  goes to the assignee only, since the rest of the team already sees the board.
- The sprint-completion body says what moved — "8 of 10 tickets done (21
  points). 2 tickets carried over to the backlog." — so the reader does not have
  to open the sprint to find out.
- A daily `due-date-reminders` job notifies the assignee of open tasks due today
  or tomorrow, once per task per day. The queue is registered in the metrics
  collector so the backlog alert sees it.
- Every notification deep-links: tasks to `/tasks?task=<id>`, sprints to
  `/tasks/sprint/<id>`. Both are relative and routable.
- `sprintNotifications.ts` and `sprintBurndown.ts` were extracted from
  `routes/sprints.ts` to keep it under its ratchet (1042 → 938 lines).
- Eight contract tests pin the event set, the silent set, the deep links, the
  completion summary and the presence of each emitter.
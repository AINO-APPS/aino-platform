# Spec: Project types

**Status:** ready-for-agent
**Date:** 2026-11-09
**Surfaces:** server, web/desktop, Android. iOS follows the web through its webview.
**Decisions:** [ADR-018](../../docs/adr/ADR-018-project-types.md) (supersedes ADR-015), [ADR-017](../../docs/adr/ADR-017-projects-own-tickets.md), [ADR-019](../../docs/adr/ADR-019-manual-worklogs.md), [ADR-016](../../docs/adr/ADR-016-server-decides-ticket-capabilities.md), [ADR-014](../../docs/adr/ADR-014-workflow-transition-enforcement.md)
**Vocabulary:** [GLOSSARY.md](../../GLOSSARY.md): Project, Project type, Ticket, Ticket hierarchy, Backlog, Board, Column, Sprint, Current sprint, Start date, Due date, Placement, Workflow state, Category, Capability, Worklog, Time spent
**Origin:** design interview 2026-11-03 (Q2, Q14, Q18, Q23, Q24, Q25). This is Phase 3 of the [Jira-style work-management roadmap](../jira-style-work-management/roadmap.md). It closes gaps G2, G6 and G9, and the board and subtask parts of G3.
**Tickets:** [issues/](issues/), numbered in dependency order; see each ticket's **Blocked by** line. Phase 2 ticket 13 is also required before 09 and 11.

---

## Problem Statement

Phase 2 gave every ticket a project, and every project a stored type (Scrum, Kanban or Task list). Nothing behaves differently by type yet. Planning still follows ADR-015:

- **The screen changes under people.** A project without a running sprint gets a day-based Scheduled bucket. The Sprint tab and the Scheduled tab replace each other depending on whether a sprint is active.
- **Teams that don't run sprints get imitation sprints.** "Continuous" mode creates and rotates sprints automatically every hour. It isn't a real flow board.
- **Two dates both look like deadlines.** A ticket has a planned day, which decides where it lives, and a due date. People can't tell which one matters.
- **Joining a sprint overwrites the due date.** The ticket's own due date is replaced with the sprint's end date and only comes back when it leaves. Changing a sprint's end date silently changes every ticket's deadline.
- **There's no board without a sprint.** A Kanban or plain ticketing team has no column view of its work, and no list or calendar.
- **There are no subtasks.** Any ticket can be the parent of any other, at any depth. Nothing follows its parent into a sprint, and time on child work doesn't add up anywhere.
- **Completing a sprint can surprise people.** The preview says unfinished tickets go to the next planned sprint, but the server sends them to the backlog unless the client says otherwise. There's no way to create the next sprint while completing, and children are ignored.
- **Old endpoints can't be retired.** The server can't tell which app version is calling it, so the Scheduled, timer, team-scope and transfer endpoints, and the columns behind them, have to stay forever.

## Solution

Each project's **type** decides how its work is planned:

- **Scrum:** a backlog planned into sprints, a sprint board and sprint reports. This is the only type that has sprints.
- **Kanban:** one continuous board of the project's open work, with WIP limits and no sprints. The backlog is off by default. A project admin can switch it on, and the project's initial state is then shown as the backlog instead of a board column.
- **Task list:** a plain ticketing project with **list**, **board** and **calendar** views driven by **start date** and **due date**.

The tabs on the Plan screen come from the project type and never swap.

**Dates are fields, never containers**
- The planned day becomes the **start date**. Existing planned days are copied across.
- The Scheduled container, carry-forward and automatic sprints are removed.
- Joining or leaving a sprint never changes a due date. The Scrum board shows the sprint's end date beside each due date instead. Tickets whose due date was overwritten by a sprint get their own date back.

**Subtasks**
- The ticket hierarchy is fixed: **Epic → Story, Task or Bug → Subtask**.
- A subtask lives in its parent's project and sprint and never moves on its own. Its time counts toward its parent.
- Existing parent links that break the rule are repaired by the migration and listed for review.

**Completing a sprint**
- Unfinished tickets go to the next planned sprint, a **new sprint** created during completion, or the backlog.
- The default is the next planned sprint if one exists, otherwise the backlog. The preview and the server use the same rule.
- A parent counts as unfinished while any of its subtasks is open. Subtasks always move with their parent.

**Retiring old endpoints safely** happens in steps, and each step can be released on its own:
1. The server and web ship project types. Older Android builds keep working through compatibility shims.
2. An Android release (and a desktop release) ships project types, stops calling the Scheduled, timer and team-scope endpoints, and sends its version on every request.
3. A **client-version gate** first only records versions, then answers `426 Upgrade Required` to builds that are too old. The apps show an update screen.
4. Only then are the old endpoints, response fields and columns removed.

## User Stories

**Choosing a project type**

1. As a team lead creating a project, I want to choose Scrum, Kanban or Task list, with a one-line description of each, so that the project plans work the way my team works.
2. As a team lead in an org without the `agile` feature, I want to be offered only Task list, so that I'm not shown planning modes my org hasn't enabled.
3. As a project admin, I want to change my project's type later, so that a project the migration typed wrongly can be put right.
4. As a project admin, I want a type change away from Scrum to be refused while the project has an active, paused or planned sprint, with a clear message, so that no sprint is left orphaned.
5. As a project admin, I want to see the project's type in project settings and on the project switcher, so that everyone knows how the project is run.
6. As a member, I want the Plan screen's tabs to come from the project type and never swap, so that the screen doesn't change under me.
7. As an org admin, I want an org losing the `agile` feature to keep its existing Scrum and Kanban projects working, so that switching a flag never breaks live work.

**Scrum**

8. As a Scrum member, I want Backlog, Sprint and Reports tabs, so that I plan, run and review sprints in one place.
9. As a Scrum member, I want the Sprint tab to stay in place when no sprint is running, with an empty state that points to the backlog, so that the screen doesn't change shape.
10. As a Scrum member, I want the sprint board to show the sprint's end date beside each ticket's due date, so that I can see both without either one changing.
11. As a Scrum member, I want a ticket's due date to stay exactly as I set it when it joins or leaves a sprint, so that deadlines mean what people wrote.
12. As a Scrum member, I want changing a sprint's end date to leave every ticket's due date alone, so that one edit doesn't silently move many deadlines.
13. As a Scrum member, I want dates never to move a ticket in or out of the backlog, so that the backlog is exactly the open work that isn't in a sprint.
14. As a Scrum member whose ticket was in the old Scheduled bucket, I want it to show up in the backlog with its start date kept, so that nothing is lost.
15. As a Scrum member, I want WIP limits on the sprint board to count only the current sprint's tickets in that column, so that another sprint's work never fills my column.

**Kanban**

16. As a Kanban member, I want one continuous board of every open ticket in my project, so that I see the whole flow without sprints.
17. As a Kanban member, I want Done to show only tickets finished in the last 14 days, so that the board stays readable.
18. As a Kanban member, I want Cancelled tickets left off the board, so that only live work shows.
19. As a Kanban member, I want WIP limits to stop a move into a full column, with the column's count and limit in the message, so that we don't overload a stage.
20. As a Kanban member, I want to see each column's count and limit in its header, so that I know how close it is to full before I drag.
21. As a project admin, I want to switch WIP limits on or off for my project and set them per column in the project workflow, so that I control them without an org admin.
22. As a Kanban project admin, I want the backlog off by default, so that every open ticket appears on the board.
23. As a Kanban project admin, I want to switch the backlog on, so that ideas wait in a list without cluttering the board.
24. As a Kanban member with the backlog on, I want tickets in the project's initial state shown in the backlog and not as a board column, so that moving a ticket onto the board is an ordinary transition.
25. As a Kanban member, I want no sprint controls anywhere in my project, so that I'm never offered something that doesn't apply.
26. As a member of a team that used continuous mode, I want my project turned into a Kanban project with all my open work on the board, so that the rotating sprints simply stop.

**Task list**

27. As a Task list member, I want List, Board and Calendar tabs, so that I can work the way that suits the moment.
28. As a Task list member, I want the list to show key, title, type, status, assignee, priority, start date and due date, so that I can scan my project's work.
29. As a Task list member, I want to sort and filter the list by any of those fields, so that I find what matters quickly.
30. As a Task list member, I want a board of the project's open tickets with one column per workflow state, so that I can see progress at a glance.
31. As a Task list member, I want the calendar to show each ticket from its start date to its due date, so that I can see what's coming up.
32. As a Task list member, I want a ticket with only one of the two dates to show on that day, so that partly dated work still appears.
33. As a Task list member, I want to drag a ticket on the calendar to change its dates, so that rescheduling is quick.
34. As a Task list member, I want a side list of undated open tickets that I can drag onto the calendar, so that I can plan them.
35. As a Task list member, I want leave, public holidays and meetings shown on the calendar, so that I don't plan work on a day I'm away.
36. As a Task list member, I want the calendar to refuse a due date earlier than the start date, so that dates always make sense.
37. As a member of a team that used the Scheduled bucket, I want my planned days to appear as start dates on the calendar, so that my plan carries over.

**Start date and due date**

38. As a member, I want a start date field beside the due date on every ticket, so that I can say when work should begin.
39. As a member, I want a due date earlier than the start date refused, so that the pair is never impossible.
40. As a member, I want neither date to decide where a ticket lives, so that changing a date never moves my ticket.
41. As a member, I want ticket history to record start date changes, so that I can see how a plan moved.
42. As a member, I want search, filters and export to use the start date wherever they used the planned day, so that nothing goes missing.
43. As an employee, I want the attendance day view and My Work to show tickets by start date, so that my day still lists what I planned.
44. As a member whose due date had been overwritten by a sprint, I want it restored to the date I set, so that my deadline is mine again.
45. As a member, I want a due date I edited myself while the ticket was in a sprint to be kept, so that the repair never undoes my own change.
46. As a member, I want a history note on every ticket whose due date the migration restored, so that I understand why it changed.

**Subtasks**

47. As a member, I want to add a subtask from a story, task or bug, so that I can split work into steps.
48. As a member, I want a new subtask to take its parent's project and sprint automatically, so that I don't have to set them.
49. As a member, I want a subtask's key to come from its project, like any other ticket, so that I can mention it in code and chat.
50. As a member, I want the parent's detail to list its subtasks with their status and a done count, so that I can see progress.
51. As a member, I want the subtask's detail to show its parent and say that it follows the parent's sprint, so that I understand why I can't move it.
52. As a member, I want a subtask to be refused a sprint or project move of its own, with a clear message, so that it never drifts away from its parent.
53. As a member, I want moving a parent between the backlog and sprints to move all its subtasks with it, so that they always stay together.
54. As a member, I want moving a parent to another project to move its subtasks too, each with a new key and its old key kept as an alias, so that nothing is left behind.
55. As a member, I want an epic to hold stories, tasks and bugs, and a story, task or bug to hold subtasks, and nothing else, so that the hierarchy stays simple.
56. As a member, I want a subtask refused children, and an epic refused a parent, so that the hierarchy never grows deeper.
57. As a member, I want a type change refused when the ticket's parent or children would break the hierarchy, so that I can't break it by accident.
58. As a member, I want time logged on subtasks to show on the parent as a total including subtasks, next to the parent's own time, so that I see the whole effort.
59. As a member, I want the parent's remaining estimate to show its subtasks' remaining too, so that I know how much is really left.
60. As a member, I want subtasks shown as their own cards on boards, labelled with the parent's key, so that each step moves through the workflow.
61. As a member, I want subtasks nested under their parent in the backlog and sprint plan and not ranked on their own, so that the plan stays readable.
62. As a Scrum member, I want sprint points, velocity, capacity and burndown to count stories, tasks and bugs only, so that subtasks never count twice.
63. As an org admin, I want every parent link that breaks the hierarchy repaired by the migration and listed for review, so that I can check what changed.
64. As a member, I want a ticket whose parent link the migration cleared to get a history note, so that I know what happened.

**Completing a sprint**

65. As a Scrum member completing a sprint, I want to send unfinished tickets to the next planned sprint, a new sprint or the backlog, so that I choose where the work goes.
66. As a Scrum member, I want the default to be the next planned sprint if there is one, otherwise the backlog, so that the common case takes one click.
67. As a Scrum member, I want the server to apply that same default when no choice is sent, so that the preview never lies.
68. As a Scrum member choosing "new sprint", I want it created as a planned sprint starting the day after completion and as long as the one I'm closing, so that I can start it straight away.
69. As a Scrum member, I want a parent with any open subtask to count as unfinished, so that work isn't reported done too early.
70. As a Scrum member, I want every subtask of a moving parent to move with it, even finished ones, so that a parent and its subtasks never split across sprints.
71. As a Scrum member, I want the preview to list moving parents, how many subtasks move with them, what stays, and the points moving, so that I know the outcome before I confirm.
72. As a Scrum member, I want Done and Cancelled tickets with no open subtasks to stay with the closed sprint, so that sprint reports stay true.

**Automatic sprints and Scheduled removed**

73. As a member of a former continuous team, I want the sprint that was running when the change shipped to be closed, with its open tickets on the board, so that nothing is stuck in a sprint nobody manages.
74. As a member of a former continuous team, I want past automatic sprints kept for history, so that old reports still open.
75. As an org admin, I want the sprint mode controls removed from team settings, so that nobody configures something that no longer exists.
76. As a platform operator, I want the hourly sprint scheduler removed, so that nothing changes sprints behind people's backs.
77. As a member, I want the Scheduled tab, schedule controls and carry-forward gone, so that there's one way to plan a ticket.

**Client-version gate**

78. As a platform operator, I want every Android, desktop and web request to carry its client version, so that the server can tell builds apart.
79. As a platform operator, I want a report-only mode that records which versions are in use without blocking anyone, so that I know when it's safe to enforce.
80. As a platform operator, I want to see how many people used each client version in the last 30 days, so that I can pick a minimum version.
81. As a platform operator, I want to set a minimum version per client (Android, desktop, web), so that I can retire endpoints without breaking current users.
82. As an Android user on a build that's too old, I want a clear "Update required" screen with a button to the store, so that I know what to do.
83. As a desktop user on a build that's too old, I want the app to fetch the update and ask me to restart, so that I'm back to work quickly.
84. As a web or iOS user with a stale tab, I want a prompt to reload, so that I pick up the current version.
85. As an Android user on a build from before the gate, I want to be treated as too old once enforcement starts, so that I'm told to update instead of hitting broken screens.
86. As anyone, I want the health and version-check endpoints left open, so that an update screen can still find out what's needed.
87. As a browser user or integration that sends no client header, I want to keep working, so that the gate only affects the apps it knows.

**Older clients during the compatibility window**

88. As an Android user on an older build, I want the Scheduled tab to keep loading, showing my project's open tickets that have a start date, so that the app still works until I update.
89. As an Android user on an older build, I want "schedule" to set the start date and "unschedule" to clear it, so that the action still does something sensible.
90. As an Android user on an older build, I want the backlog of a Kanban or Task list project to list its open tickets, so that I can still see my work.
91. As an Android user on an older build, I want choosing automatic sprint mode to be refused with a clear message, so that I'm not misled.
92. As an Android user on an older build, I want carry-forward to do nothing and say so, so that it doesn't fail.

**Android (current build)**

93. As an Android user, I want the Plan screen's tabs to follow the project type, so that the app matches the web.
94. As an Android user, I want a Kanban board and a Task list list and board, so that I can work any project from my phone.
95. As an Android user in a Task list project, I want an upcoming view grouped by start date with overdue first, so that I see what's next without a calendar.
96. As an Android user, I want start and due dates on the ticket detail, so that I can plan from my phone.
97. As an Android user, I want to see, add and open subtasks from the ticket detail, so that I can split work on the go.
98. As an Android user completing a sprint, I want the same three choices and default as the web, so that the result is the same on both.
99. As an Android user, I want sprint and move actions on subtasks hidden based on what the server says I can do, so that the app never offers a refused action.

**Removal**

100. As a platform operator, I want the Scheduled, carry-forward, timer, sprint-config and transfer endpoints removed once the gate is enforced, so that the API only offers what the product does.
101. As a platform operator, I want the columns behind removed features dropped, so that the schema matches the product.
102. As a platform operator, I want removal refused until every org has switched to project ownership, so that no org loses its team-based data while it still needs it.

## Implementation Decisions

**Release steps.** Phase 3 ships as four releases, in order. Each can go out on its own.

| Step | Ships | Old clients |
|---|---|---|
| **A. Expand** | Project-type behaviour, start date, subtasks, the shared completion rule, the web UI, the version gate in `off` mode, and the expand migration. | Keep working through compatibility shims. |
| **B. Clients** | An Android release and a desktop release with project types, no Scheduled or timer calls, no team scope, and the version header. The gate moves to `report`. | Still served. |
| **C. Enforce** | The gate moves to `enforce` with the step B builds as the minimums. | Get `426`. |
| **D. Contract** | Old endpoints, fields, columns and the flag-off code path are removed. | Already blocked by step C. |

**Project type module** (grows out of the existing project-types file; pure, no SQL)
- It answers, for a project:
  - whether it has sprints (Scrum only);
  - whether it has a backlog: Scrum always; Kanban when its backlog setting is on; Task list never;
  - which tickets are on its board: the current sprint for Scrum; open tickets for Kanban, minus initial-state tickets when the backlog is on; open tickets for Task list. Done tickets appear only if finished in the last 14 days, and Cancelled never appears;
  - which Plan tabs it has, in order: Scrum `backlog, sprint, reports`; Kanban `board` (plus `backlog` when on); Task list `list, board, calendar`;
  - whether a type change is allowed. Leaving Scrum is refused with `PROJECT_HAS_OPEN_SPRINTS` while any sprint is active, paused or planned. Every other change is allowed.
- Every server rule and the capabilities module ask this module. Clients get the tabs from the project response and never work them out.

**The `agile` feature flag**
- It stops gating the tasks area, the sprint routes and the board.
- It only decides whether an org may create, or change a project to, Scrum or Kanban. Without it, only Task list is offered. Existing projects keep their type.
- Sprint routes check that the sprint's project is Scrum, not the flag. A sprint request on a non-Scrum project is refused with `PROJECT_HAS_NO_SPRINTS`.

**Board** (the existing board module, widened from sprint boards to project boards)
- A new project board read serves every type. For Scrum it returns the current sprint's board, or the sprint named in the request. The existing sprint board read stays and uses the same builder.
- Each column carries its workflow state, its tickets, its count and its WIP limit.
- Scrum board cards carry the sprint end date beside the ticket's due date.

**WIP limits**
- WIP becomes a project setting. Projects gain a "WIP limits on" switch, copied from the org's agile setting by the migration. The org-level switch stops being read.
- The count is the number of tickets in the target column of **that project's board**: the current sprint for Scrum, and the board's tickets for Kanban and Task list. Today it counts every ticket in the state across the org.
- The refusal is unchanged: `409 WIP_EXCEEDED` with the limit and the count. Capabilities still leave WIP out (ADR-016), and the write guard stays the final check.

**Collection** (the existing collection module)
- Scopes become `backlog`, `board` and `list`. The `schedule` and `scheduled` scopes, the planned and unplanned predicates and the Scheduled history window are removed.
- The backlog no longer filters on dates.
- The list read takes a date range and returns tickets whose start-to-due span overlaps it. A ticket with one date matches on that date. The calendar uses this.
- The list read can sort and filter on key, title, type, status, assignee, priority, start date and due date.

**Start date**
- Tickets gain a nullable **start date**. The edit-date rule keeps refusing a due date earlier than the start date, now with the message "Due date cannot be earlier than the start date".
- Changing the start date writes a history row. It is never a placement.
- The planned-day readers move to the start date: search, export, notes, the manager views, the attendance day list, My Work and the dashboard week window.

**Placement** (the existing placement module shrinks, ADR-018)
- Placement is now only sprint ⇄ backlog, sprint ⇄ sprint, and the sprint exit that goes with a project move.
- Removed: placing on a day, the `scheduled` and `unscheduled` history rows, remembering and restoring the due date on sprint join and exit, and re-timing due dates when a sprint's end date changes.
- Joining a sprint is refused with `PROJECT_HAS_NO_SPRINTS` unless the ticket's project is Scrum.
- **Subtasks follow their parent.** Placing a parent places all its subtasks in the same transaction, with one history row each. Placing a subtask directly is refused with `SUBTASK_FOLLOWS_PARENT`.
- The placement-writes guardrail script is updated to match.

**Ticket hierarchy** (a new deep module in the tasks area, with its SQL in a repository)
- Work item types gain an `is_subtask` marker. Every org gets a seeded `Subtask` type. Each org has exactly one subtask type, and it can't be deleted.
- **The rule** (pure):
  - an epic has no parent;
  - a story, task or bug may have no parent, or an epic as its parent;
  - a subtask must have a story, task or bug as its parent, in the same project;
  - a subtask has no children.

  A violation is refused with `INVALID_HIERARCHY` and a message naming the rule.
- The rule is checked on create, on setting a parent, on changing a ticket's type, and on project moves.
- **Creating a subtask** takes the parent. The project and sprint come from the parent, and the type is Subtask.
- **Moving a parent to another project** moves its subtasks in the same transaction. Each subtask gets a new number and key, keeps its old key as an alias with reason `move`, and has its state mapped the same way as the parent. A subtask's own project move is refused with `SUBTASK_FOLLOWS_PARENT`.
- **Roll-up**, computed on read: the parent's detail returns its own time spent and remaining estimate, plus totals that include its non-deleted subtasks. The subtask summary returns the count and the done count. Nothing new is stored.
- **Story points:** subtasks don't carry story points. The field is refused on subtasks, and sprint points, velocity, capacity, baselines and burndown count stories, tasks and bugs only.
- **Lists:** the backlog and sprint plan nest subtasks under their parent and rank only parents. Boards show subtasks as their own cards, with the parent's key.
- Epics keep today's behaviour: their children may sit in any project.

**Sprint completion** (one shared rule)
- `planCarryover` becomes the only completion rule. The preview and the complete endpoint both call it, so their defaults always match.
- **Inputs:** the sprint's tickets with their parent links, the next planned sprint, and an optional override (`<sprint id>`, `"new"` or `"backlog"`).
- **What counts as unfinished:**
  - A parent or standalone ticket is unfinished if its state isn't terminal, or if any of its subtasks isn't terminal.
  - A subtask moves exactly when its parent moves, whatever the subtask's own state.
- **Default target:** the next planned sprint if one exists, otherwise the backlog.
- **The `"new"` target:** completion creates a planned sprint in the same project, in the same transaction. Its name follows the project's sprint numbering, it starts the day after completion, and it lasts as long as the closed sprint. The result returns the new sprint.
- **The preview returns:**
  - the moving parents
  - the number of subtasks moving with them
  - what stays
  - the points moving
  - the default target
  - whether a next planned sprint exists
- Carry-over stamping and sprint linking are unchanged.

**Automatic sprints removed**
- The sprint scheduler and its hourly sweep are removed.
- The team sprint-config endpoints become compatibility shims (see below). Team settings lose their sprint mode controls.
- Team-mode resolution is removed. Planning reads only the project type.

**Client-version gate** (new middleware, mounted app-wide before authentication)
- **Headers.** Requests carry the client class in `X-AINO-Client` (`android`, `desktop` or `web`) and the client version in `X-AINO-Client-Version`, as a semantic version.
  - Android sends its version name.
  - Web and desktop send the web build version, because desktop serves the bundled web client. The desktop proxy forwards both headers.
- **Recognising the client when the headers are missing:**
  - The existing mobile detection (bearer token, mobile token claim) marks a request as Android.
  - The desktop proxy's origin marks a request as desktop.
  - A recognised client with no version counts as version `0`.
  - A request that isn't recognised as any client is never gated. This covers browsers and integrations.
- **Configuration** is platform-wide and set by the operator. It holds a mode (`off`, `report` or `enforce`) and a minimum version for each client class. There is no per-tenant override.
- **In `report` mode,** the gate records the class and version on the user's session and lets every request through.
- **In `enforce` mode,** a request below its class's minimum gets:

  ```json
  { "code": "CLIENT_UPGRADE_REQUIRED", "client": "android", "min_version": "0.30.0", "current_version": "0.27.16" }
  ```

  with status `426`.
- **Exempt routes:** health and a public client-version endpoint, which returns the mode and minimums so clients can check at start-up.
- **Reporting.** A platform-admin read returns, for each client class and version, how many distinct users were seen in the last 30 days. User sessions gain a client-version column.

**Compatibility shims** (step A to step D only, for older Android builds)
- `GET /tasks/scheduled` returns the open, unsprinted tickets that have a start date, in today's shape, scoped by the legacy team scope.
- `PATCH /tasks/:id/schedule` sets the start date. `PATCH /tasks/:id/unschedule` clears it. Neither one moves the ticket.
- `planned_date` in requests writes the start date. Responses carry `planned_date` with the same value as `start_date`.
- `container` is never `scheduled` again.
- The legacy backlog read for a Kanban or Task list project returns its open tickets.
- `POST /tasks/carry-forward` answers `{ carried: 0 }` with a message and writes nothing.
- The team sprint-config read always reports manual mode. A write that asks for automatic mode is refused with `409 AUTO_SPRINTS_REMOVED`; other writes are accepted and ignored.
- The timer endpoints, team scope parameters, transfer endpoint, `issue_key`, `team_id` and the legacy logged and estimated minutes fields stay as Phase 1 and Phase 2 left them.

**Capabilities** (ADR-016: decided in the capabilities module, never on clients)
- **`container`** becomes `sprint`, `backlog` or `board`:
  - Scrum: `sprint` or `backlog`.
  - Kanban: `board`, or `backlog` for initial-state tickets when the backlog is on.
  - Task list: always `board`.
- The `schedule` action is removed.
- **`placeInSprint`** is refused with `PROJECT_HAS_NO_SPRINTS` outside Scrum, and with `SUBTASK_FOLLOWS_PARENT` for subtasks.
- **`canMoveProject`** is refused with `SUBTASK_FOLLOWS_PARENT` for subtasks.
- **New `canAddSubtask`:** the actor is member or higher, the project isn't archived, the ticket is a story, task or bug, and the ticket isn't Cancelled.
- **New project-level `canChangeType`** for project admins, returned with the other project capabilities.
- **New denial reasons:** `PROJECT_HAS_NO_SPRINTS`, `SUBTASK_FOLLOWS_PARENT`, `INVALID_HIERARCHY` and `PROJECT_HAS_OPEN_SPRINTS`. All four are added to the reason catalogue and the denial messages.

**Schema (step A, expand only)**
- Tickets gain `start_date`.
- Projects gain a Kanban backlog switch (default off) and a WIP switch.
- Work item types gain `is_subtask`.
- User sessions gain `client_version`.
- A new hierarchy-repairs review table records each repaired ticket, the change made and the old parent.
- The baseline schema for new tenants matches. A new tenant gets the Subtask type.

**Migration (step A, idempotent and safe to re-run)**
1. **Start dates.** Copy each ticket's planned day into its start date.
2. **Due dates.**
   - The affected tickets are those in a sprint whose due date still equals that sprint's end date. Each one gets back its saved pre-sprint due date, which may be empty, and a history note marked as a migration.
   - A due date that differs from the sprint's end date was changed by a person and is kept.
   - The saved column stops being written and stays until step D.
3. **Automatic sprints.**
   - Open automatic sprints:
     - An active or paused one is completed, and its unfinished tickets leave the sprint.
     - Planned ones lose their tickets to the backlog and are removed.
   - Completed automatic sprints are kept as history.
   - A project whose sprints were all automatic becomes Kanban, with the backlog off.
4. **Hierarchy.** Seed the Subtask type. Then repair each parent link:
   - A ticket under an epic is unchanged.
   - A non-epic ticket under a non-epic parent becomes a subtask when it has no children of its own and is in the same project. If its sprint differs from its parent's, it follows the parent.
   - Every other broken link is cleared: deeper chains, cross-project links, and epics that have a parent.
   - Each repair writes a history note and a hierarchy-repairs row.
5. **WIP.** Copy the org's WIP switch onto each of its projects.

The migration review screen from Phase 2 gains a hierarchy-repairs section for super admins.

**Removal (step D)**
- **Precondition:** every org has switched to project ownership (Phase 2), and the gate has been enforcing the step B minimums.
- **Endpoints removed:**
  - `GET /tasks/scheduled`, `PATCH /tasks/:id/schedule`, `PATCH /tasks/:id/unschedule`
  - `POST /tasks/carry-forward`
  - the ticket timer read, start and stop
  - the team sprint-config read and write
  - `POST /tasks/:id/transfer`
  - the legacy team scope parameters (`team_id`, `unassigned`) on list, backlog and sprint reads
- **Fields removed from responses and requests:** `planned_date`, `issue_key`, ticket and sprint `team_id`, and the legacy logged and estimated minutes aliases.
- **Columns and tables dropped:**
  - tickets: the planned day, the saved pre-sprint due date, the team, and the stored logged-minutes total
  - the timer table
  - sprints: the team and the automatic marker
  - teams: the sprint mode, paused, start date and duration columns
  - the org project-ownership flag
- **Code removed:** the flag-off team-visibility path and the platform-admin switch-back. Project ownership becomes unconditional.
- The schedule-overlays read stays, because the calendar uses it.

**API (step A)**
- Project create and update take the type. Update refuses a type change with `PROJECT_HAS_OPEN_SPRINTS` or without the `agile` feature.
- Project responses gain the type, the Plan tabs, the Kanban backlog and WIP switches, and `canChangeType`.
- New reads: the project board, and the date-ranged, sortable project list.
- Ticket responses gain `start_date`, the parent summary and the subtask summary. The parent detail gains time and remaining totals that include subtasks.
- Ticket create accepts a parent. Subtask creation inherits project and sprint.
- Sprint completion accepts `"new"` as a target. The completion preview returns the shared plan.
- New public client-version read and platform-admin version report.

**Web / desktop**
- **Plan tabs** follow the project's tabs. The Scheduled tab, the schedule controls, carry-forward and the Sprint/Scheduled swap are removed.
- **Scrum:** the board shows the sprint end date beside due dates. The Sprint tab has an empty state when no sprint is running.
- **Kanban:** a project board with column counts and limits.
- **Task list:**
  - the list view, which is sortable and filterable;
  - the board;
  - a month and week calendar showing start-to-due spans, with drag to change dates, an undated side list, and leave, holiday and meeting overlays from the existing overlays read.
- **Ticket detail:**
  - a start date beside the due date;
  - a subtask list with a done count and "Add subtask";
  - totals that include subtasks;
  - on a subtask, its parent and a "follows the parent's sprint" note.
- **Backlog and sprint plan** nest subtasks under parents.
- **Sprint completion dialog:** next planned sprint, new sprint or backlog, defaulting from the preview, showing the subtasks that move with parents.
- **Project settings:** type (with the open-sprint refusal), the Kanban backlog switch, and the WIP switch beside the per-column limits.
- **Project creation** offers the types the org may create.
- **Team settings** lose the sprint mode controls.
- **Client version:** sends both headers. On `426` it shows a reload prompt.
- **Desktop** gets the web changes through its bundled client. On `426` it runs the existing auto-updater and asks to restart.

**Android**
- `planningTabs` comes from the project's tabs, not from `agile` and sprint state.
- New screens: a Kanban board, and a Task list list, board and upcoming view (grouped by start date, overdue first; this reuses the Scheduled layout).
- Removed: the Scheduled screen, carry-forward and the team sprint-config editor.
- The ticket detail gains a start date, a subtask list and Add subtask, and roll-up totals.
- The completion dialog offers the three choices.
- Actions follow server capabilities.
- Every request sends the client class and version name. A `426` from any request opens a blocking "Update required" screen with a store link.
- The calendar and project settings stay web-only.

**Contracts and docs**
- **Contracts:** regenerate the API models and update the route snapshot, route inventory and OpenAPI for every step. Mark the shimmed endpoints deprecated at step A and remove them at step D. Update the tasks-parity, Android endpoint and realtime parity entries, and retire the removed routes in the Android coverage.
- **ADR-018:** repair the garbled completion and consequences paragraphs. Record that `pre_sprint_due_date` is restored where the sprint overwrote it and then dropped. Record that project type can change.
- **ADR-015:** add a cross-reference saying it is superseded.
- **GLOSSARY:**
  - Placement covers sprint and backlog moves only.
  - Remove Unassigned and any Scheduled wording.
  - Board covers all three types.
  - Fix the entries that run together.
- **Module docs:** update the tasks module README and the placement section.

## Testing Decisions

A good test exercises behaviour through the public seam and checks outcomes: HTTP responses, which tickets appear on a board, list or calendar, stored dates, history rows, and what the completion moved. It never checks internal calls or the shape of the SQL. The owner agreed these seams on 2026-11-09.

**Primary seam: tasks, projects and sprints HTTP routes on real PostgreSQL**
- **Setup:** a mini Express app with the auth, RBAC and tenant middleware stubbed by test headers, the real routers mounted, and a throwaway database per suite. The suite is skipped when the test database variable is unset. Run it with the PostgreSQL test script.
- **Prior art:** the placement routes integration suite and the sprint completion integration suite.
- **Covers:**
  - project create and type change, including `PROJECT_HAS_OPEN_SPRINTS` and the `agile` rule
  - the Plan tabs for each type
  - the project board for each type, including the Kanban backlog on and off, the 14-day Done window and Cancelled left out
  - WIP counted per board, and `WIP_EXCEEDED`
  - list sorting and filtering, and the date-range overlap
  - start-date edits, the due-before-start refusal and history
  - due dates unchanged on sprint join, exit and sprint end-date edits
  - sprint routes refused outside Scrum
  - the subtask hierarchy rule on create, parent change, type change and project move, including `INVALID_HIERARCHY`
  - subtasks following parent placement and project moves, with aliases
  - roll-up totals, and points left out for subtasks
  - completion with each target, including `"new"`, with the default matching the preview, a parent with open subtasks moving with every subtask, and the endpoint applying the default when no target is sent
  - every compatibility shim
  - after step D, the removed routes return 404 and the dropped fields are absent
- **Existing suites to update:** the placement, placement routes, sprint completion and collection suites lose the Scheduled and due-date bookkeeping cases. The sprint scheduler suite is deleted with the scheduler.

**Client-version gate seam: a mini Express app with the gate mounted, no database**
- **Prior art:** the web-only middleware tests.
- **Covers:**
  - each mode
  - each client class
  - missing headers with and without client recognition
  - the boundary at the minimum version
  - exempt routes
  - the `426` body
  - recording in `report` mode
  - unrecognised requests never gated

**Migration seam: real PostgreSQL**
- **Prior art:** the tasks schema-expand integration suite.
- **Steps:**
  1. Seed planned days, sprint tickets with overwritten and hand-edited due dates, automatic and manual sprints in every status, and parent chains of every shape (epic children, two-level chains, deeper chains, cross-project links, epics with parents).
  2. Run the migration twice.
- **Assert:**
  - start dates are copied
  - only overwritten due dates are restored, with notes
  - automatic sprints are closed or removed, and all-automatic projects become Kanban
  - hierarchy repairs follow the rule and are listed
  - WIP switches are copied
  - the second run changes nothing
- Step D's contract migration gets its own run against a seeded step A database.

**Capabilities seam: the existing capabilities integration suite**
- The actor table gains:
  - project type × container values
  - `placeInSprint` outside Scrum
  - subtask placement and move denials
  - `canAddSubtask` by role, type, archive and Cancelled
  - project-level `canChangeType`

**Pure seams**
- **Completion rule:** extend the sprint lifecycle unit test, table-driven over parent and subtask states × next planned sprint present or absent × override.
- **Hierarchy rule:** table-driven over parent type × child type × same or different project.
- **Project type module:** tabs, backlog, board scope and allowed type changes for each type.
- **Version comparison:** ordering, missing values and malformed input.

**Clients**
- **Web:** Vitest and React Testing Library with the API modules mocked.
  - **Prior art:** the completion dialog test and the planning tabs test.
  - **Covers:**
    - the tabs for each type, with no swap when a sprint starts or ends
    - the Kanban board with counts and limits
    - list sort and filter
    - the calendar placing spans and dragging to change dates
    - the start date field
    - the subtask list and Add subtask
    - the completion dialog's three choices and default
    - the type setting with its refusal
    - the reload prompt on `426`
  - The Scheduled tab tests are deleted.
- **Android:** JVM tests through the Plan shell and ticket detail view models, using the existing fake API client harness.
  - **Covers:** the tabs from the project, the Kanban board, the Task list list and upcoming view, the start date, subtasks, the completion choices, capability-driven actions, the version header on every request, and the update screen on `426`.
  - The Scheduled view model tests are deleted.

**Contract checks**
- Contracts validation, the tasks-parity check and the Android endpoint and realtime parity checks must pass at every step.

## Out of Scope

- **GitHub App, Development panel, smart commits and automation rules (Phase 4).**
- **Admin home widget, My Work across projects, and timesheets (Phase 5).** This phase only moves My Work's date field to the start date.
- **Blocking a parent's move to Done while subtasks are open.** Only sprint completion treats such a parent as unfinished.
- **Cancelling a parent's subtasks when the parent is cancelled.**
- **Workflows per ticket type**, and different workflows for subtasks.
- **Kanban reports** such as cumulative flow and control charts, swimlanes, quick filters and board configuration beyond columns and WIP.
- **Releases or versions, components, watchers and saved filters.**
- **Restricting epics to one project.** Epics keep today's cross-project behaviour.
- **A calendar or project settings on Android.**
- **Boards that span projects.**
- **Per-tenant minimum client versions, and forcing iOS native updates.** iOS is a webview.

## Further Notes

- **Phase 2 status.** The projects-own-tickets issue Status lines are behind the code: the schema, migration review and switch, and most tickets have shipped, but several files still say `ready-for-agent`. Step A only needs the shipped Phase 2 schema. Step D needs every org switched to project ownership and the Android project-scope release (Phase 2 ticket 13), because it drops `team_id` and the switch-back.
- **ADR text.** ADR-018's Decision and Consequences paragraphs run together around "subtasks always move with thei…", "the endpoint…" and the `pre_sprint_due_date` bullets. This spec reads them as: subtasks always move with their parent; the endpoints are removed only after the gate; tickets in a sprint get back the saved due date, then the column and the re-timing are removed. The ADR still says `pre_sprint_due_date` is open. The design interview (Q24) settled it: due dates are left alone and the bookkeeping is dropped. The restore-only-if-unchanged rule protects dates people edited by hand.
- **Why desktop is gated.** Desktop serves a web bundle packaged with the app, so an old desktop build calls old endpoints just like an old Android build. Browsers always load the current bundle, so a stale tab only needs a reload.
- **Why type change is allowed.** ADR-018 says a project picks its type when it's created. The Phase 2 migration picked types automatically from sprint history, so admins need a way to fix them. Leaving Scrum is guarded so that no sprint is orphaned.
- **Kanban backlog.** Showing the initial state as the backlog, as Jira does, avoids a new container or a placement for Kanban. Moving a ticket onto the board is an ordinary transition with ADR-014 enforcement.
- **Phase 1 handover.** The stored logged-minutes total, the timer table and the timer endpoints were kept for old Android builds "until the Phase 3 version gate". They go in step D.
- **Bugs fixed as a side effect:**
  - The completion default differed between the preview and the server (G6).
  - WIP occupancy counted a state across the whole org.
  - Editing a sprint's end date rewrote every member ticket's due date.
  - Parent links could form chains of any depth.

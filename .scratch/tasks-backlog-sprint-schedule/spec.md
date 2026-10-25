# Spec — Tasks: Backlog, Sprint, Schedule

**Status:** ready-for-agent
**Date:** 2026-10-25
**Design spec:** `docs/TASKS_DESIGN_SPEC.md`
**Parity matrix:** `contracts/tasks-parity.json`\r

---

## Problem Statement

A team using the Tasks area cannot trust its backlog. When a task is completed
it stays visible in the backlog, mixed in with open work and merely dimmed, so
the list a person triages every morning is not a list of what is left to do. The
same list also silently loses work: giving a task a planned day removes it from
the backlog entirely and it reappears only inside the Schedule tab, so "where did
that ticket go" is a recurring question and the backlog and the schedule compete
to own the same task.

Underneath both symptoms is a vocabulary problem. "Backlog", "Scheduled" and
"in a sprint" all behave like containers, and a task can be pushed out of one by
the act of describing it in another. "Completed" has three different definitions
in the system that do not have to agree, so two screens can disagree about whether
the same task is done.

People planning work find the remaining gaps just as costly. The sprint view is a
board and nothing else: there is no place to look at the backlog and the sprint
side by side and decide what to pull in, and no sign of the sprint's goal, its
committed size, or how much has been added since it started. The schedule is a
list grouped by day rather than a calendar, so nobody can see the shape of a week
or notice that one day is overloaded. Nothing can be reordered by hand, nothing
can be bulk-edited, and a drag-and-drop drop is a one-way door with no undo.

The same product is used on web, desktop, Android and iOS, and none of the four
currently behaves the same way as the others. iOS has no task screens at all.
Android has its own implementation that will drift from web. Design tokens
diverge per platform, so identical screens look subtly different.

## Solution

Make the backlog the single, trustworthy list of work not currently in a sprint,
and make completion mean one thing.

A task belongs to a sprint or to the backlog — that is the only container
dimension there is. A planned day and a due date are descriptions of a task, not
places to put it, so setting them never moves a task out of the backlog.

Completed work leaves the open list entirely and lives in a collapsible section
at the bottom of the backlog, collapsed by default and labelled with a count, so
it stays discoverable without ever being in the way. One user preference decides
whether completed work is shown, and it is stored on the server so the same
person sees the same thing on every device.

Planning gets the surfaces it is missing. The sprint view gains a Plan mode: the
backlog on one side, the sprint on the other, drag to pull work in and push it
back out, with the sprint goal, committed size and a mini burndown visible while
deciding. The schedule becomes a real calendar with an unscheduled tray, so work
is placed by dragging it onto a day and un-placed by dragging it back, and
approved leave, holidays and meetings show through as read-only context. Epics
become first class, because the data already exists and is almost entirely hidden.

Everything that mutates work becomes reversible: manual ranking that survives
concurrent drags, bulk actions in the backlog, inline editing, and an undo for
every destructive or moving action.

The four clients converge on one intended experience, guaranteed by generated
design tokens and a machine-checked parity matrix rather than by intention. Web
is canonical. Desktop already renders the web bundle, so it follows for free.
iOS gains the whole Tasks area in a scoped webview with a purpose-built session
handoff. Android keeps its native implementation, which is good, and ports the
features to match.

## User Stories

**Trust in the backlog**

1. As a team member, I want completed tasks out of the open backlog list, so that the list I triage is a list of what is left to do.
2. As a team member, I want a collapsed "Completed" section with a count at the bottom of the backlog, so that finished work is discoverable without being in the way.
3. As a team member, I want that section collapsed by default, so that the backlog is calm when I open it.
4. As a team member, I want to expand the Completed section and see recent finished work without a page reload, so that I can check what shipped this week.
5. As a team member, I want the Completed section to show the last 30 days or the last closed sprint, whichever is longer, so that it is useful without growing without bound.
6. As a team member, I want a "View all completed" escape hatch, so that I can still reach older finished work.
7. As a team member, I want to choose whether completed work is shown, so that I can work either way depending on what I am doing.
8. As a team member, I want that choice remembered on the server, so that my phone and my laptop agree.
9. As a team member, I want to override the choice for a single shared link, so that a link I send shows what I meant it to show.
10. As a new user, I want completed work hidden by default with a visible count, so that the default is clean but nothing feels missing.
11. As a team member, I want one rule about completed visibility across backlog, board, schedule and search, so that I learn it once.

**Where a task lives**

12. As a team member, I want a task to be either in a sprint or in the backlog and never in both, so that I am never unsure where to find it.
13. As a team member, I want to set a planned day on a backlog task without it leaving the backlog, so that describing my intent does not move my work.
14. As a team member, I want to clear a planned day without the task disappearing, so that unscheduling is safe.
15. As a team member, I want planned day and due date to be clearly different things, so that I know which one drives the calendar and which one drives overdue warnings.
16. As a team member, I want dragging a task into a sprint to remove it from the backlog, so that the two lists never duplicate.
17. As a team member, I want dragging a task out of a sprint to return it to the backlog in a predictable position, so that I do not lose my place.
18. As a team member, I want "where did that task go" to be answerable, so that I can trust the tool.

**One meaning of completed**

19. As a team member, I want "completed" to mean the task's workflow state is in the done category, so that every screen agrees.
20. As a team member, I want the completion timestamp maintained automatically, so that no client can set it inconsistently.
21. As an org admin, I want every custom workflow state to belong to exactly one category, so that reporting stays computable.
22. As a team member, I want moving a task out of a done state to clear its completion, so that re-opening work is honest.
23. As a team member, I want the notion of "not started", "in progress" and "complete" preserved in the interface, so that the vocabulary I know still works.

**Backlog as a working surface**

24. As a team member, I want to reorder the backlog by dragging a row, so that priority is what I say it is.
25. As a team member, I want my order preserved when two people drag at once, so that collaboration does not scramble the list.
26. As a team member, I want to add a task at the top of the backlog by typing a title, so that capture is fast.
27. As a team member, I want to keep typing to add several tasks in a row, so that a triage session flows.
28. As a team member, I want to edit a task's title, points, assignee and sprint inline, so that triage does not require a modal.
29. As a team member, I want an undo after any move or delete, so that a mis-drag is recoverable.
30. As a team member, I want to select several tasks and move them to a sprint at once, so that bulk planning is possible.
31. As a team member, I want to select several tasks and change status, assign or delete them at once, so that bulk editing is possible.
32. As a team member, I want to clear a selection easily, so that I do not act on the wrong set.
33. As a team member, I want the backlog to paginate or load more without collapsing the list, so that long backlogs remain usable.
34. As a team member, I want to sort by priority, due date, created date or title when I want to, so that manual order is not the only option.
35. As a team member, I want sorting to be temporary and manual order preserved, so that exploring a sort does not destroy my ranking.
36. As a team member, I want to reference a task as PROJ-123 everywhere, so that I can talk about it unambiguously.
37. As a team member, I want to search for a task by its key, so that I can jump straight to it.
38. As a team member, I want the key on every card, so that screen-sharing and standups are unambiguous.
39. As a team member, I want to filter the backlog by assignee, project, epic, type, priority, label and status, so that I can focus.
40. As a team member, I want my filters in the URL, so that I can bookmark and share a view.
41. As a team member, I want to save a personal view, so that recurring questions are one click.
42. As a team member, I want an empty backlog to tell me what lands there, so that a new team understands the model.

**Sprint: Board**

43. As a team member, I want the board's columns to come from my organization's workflow states, so that the board matches how we actually work.
44. As a team member, I want to drag cards between columns on a mouse, a touchscreen and a keyboard, so that the board works on every device.
45. As a team member, I want work-in-progress limits shown and warned about, so that I notice when we overload a column.
46. As a team member, I want a WIP warning not to block my drop, so that the tool does not argue with me.
47. As a team member, I want to be warned when I mark work done with open blockers or unchecked acceptance criteria, so that I catch it — and to be able to mark it done anyway, so that I am not blocked by a formality.
48. As a team member, I want done columns to stay visible on the board, so that the board shows the whole flow.
49. As a team member, I want cards to show key, title, points, assignee and priority by default, so that a card is readable at a glance.
50. As a team member, I want a compact card option, so that dense columns stay legible.
51. As a team member, I want to see who changed a card while I was looking, so that I understand sudden movement.

**Sprint: Plan**

52. As a team member, I want the backlog and the sprint side by side, so that I can decide what to pull in.
53. As a team member, I want to drag a task from the backlog into the sprint and back, so that planning is direct manipulation.
54. As a team member, I want to see the sprint goal, so that I know what the sprint is for.
55. As a team member, I want to edit the goal inline, so that setting it is not a separate task.
56. As a team member, I want to see committed points against the sprint's size, so that I can tell whether it is full.
57. As a team member, I want to see recent velocity while planning, so that I size to reality rather than optimism.
58. As a team member, I want a mini burndown while planning, so that I see the trend without leaving the page.
59. As a team member, I want epics with progress rollups, so that I can see what each theme has left.
60. As a team member, I want to filter the plan by epic, so that I can plan one theme at a time.

**Sprint: lifecycle**

61. As a team lead, I want to start a sprint, so that its work becomes current.
62. As a team lead, I want to pause and resume a sprint, so that an interrupted sprint is honest about its state.
63. As a team member, I want a paused sprint presented as active everywhere, so that its metrics are not distorted.
64. As a team lead, I want completing a sprint to show me a pre-flight summary, so that I know exactly what will move and what will be dropped.
65. As a team lead, I want unfinished work to default to the next planned sprint and otherwise to the backlog, so that carrying over is predictable.
66. As a team lead, I want to choose the carryover target explicitly when the default is wrong, so that I stay in control.
67. As a team member, I want finished work to stay with the sprint it finished in, so that history is accurate.
68. As a team member, I want a completed sprint to stop changing, so that velocity is trustworthy.
69. As a team member, I still want to write the retrospective for a completed sprint, so that closure is possible.

**Sprint: insight**

70. As a team lead, I want committed size recorded when a sprint starts, so that scope change is measurable.
71. As a team lead, I want scope added and removed since the start shown on the sprint, so that "why didn't we finish" has an answer.
72. As a team lead, I want burndown, cumulative flow, cycle time and velocity available in one place, so that I can analyse without a second tool.

**Schedule**

73. As a team member, I want a month calendar, so that I can see the shape of the month.
74. As a team member, I want a week view, so that I can plan the next few days closely.
75. As a team member, I want the old day-grouped list still available, so that nothing I relied on disappeared.
76. As a team member, I want an unscheduled tray of backlog items, so that I can drag work onto days.
77. As a team member, I want to drag a card from a day back to the tray, so that unscheduling is symmetric with scheduling.
78. As a team member, I want per-day counts and point totals, so that I can see an overloaded day.
79. As a team member, I want approved leave, holidays and booked meetings shown behind my tasks, so that I understand why a day has no capacity.
80. As a team member, I want those overlays to be independently toggleable and read-only, so that they inform without cluttering.
81. As a team member, I want overdue tasks pinned above the calendar, so that they are not hidden in the past.
82. As a team member, I want the calendar usable on a phone as a single scrollable day column, so that it works on a small screen.

**Task detail**

83. As a team member, I want task detail as a bottom sheet on a phone and a panel on a desktop, so that it fits the device.
84. As a team member, I want planned date and due date as separate fields with clear labels, so that I set the right one.
85. As a team member, I want to see dependencies, blockers, parent, acceptance criteria and custom fields, so that the existing capability is actually reachable.
86. As a team member, I want a logged-versus-estimated time row, so that I can see effort against the estimate.
87. As a team member, I want to start the existing timer from a task, so that my time is attributed without extra typing.
88. As a team member, I want that time to roll into my timesheet, so that task effort and attendance agree.
89. As a team member, I want to navigate from a dependency to the linked task, so that relationships are usable.

**Keyboard and accessibility**

90. As a power user, I want one command palette that searches tasks and jumps to views and actions, so that I rarely need the mouse.
91. As a power user, I want to move cards between columns with the keyboard, so that the board is usable without a pointer.
92. As a power user, I want an undo shortcut, so that recovery is muscle memory.
93. As a power user, I want a shortcut help overlay, so that I can learn the set.
94. As a person using assistive technology, I want drag results and undo announced, so that I know what happened.
95. As a person using assistive technology, I want no keyboard traps in the palette or the sheet, so that I can always leave.
96. As a person with low vision, I want all badges and chips to meet contrast requirements, so that status is readable.

**Across clients**

97. As an Android user, I want the same backlog, board, plan and schedule features as on web, so that my device does not decide what I can do.
98. As an iOS user, I want the Tasks area at all, so that I am not locked out of planning on my phone.
99. As an iOS user, I want it to open already signed in, so that the handoff is invisible.
100. As an iOS user, I want to leave the Tasks area and have my session survive, so that it does not feel like a different product.
101. As a desktop user, I want the same experience as web automatically, so that I am never a version behind.
102. As a user on any client, I want deep links to open the right view and the right task, so that notifications are actionable.
103. As a user on any client, I want identical spacing, colour and type, so that the product feels like one product.
104. As an iOS user, I want agile configuration to send me to web rather than half-work, so that I am not confused.
105. As an Android user, I want agile configuration read-only, so that I do not hit a wall I cannot pass.

**Notifications and collaboration**

106. As a team member, I want to be told when I am assigned a task and when I am added to a sprint, so that I notice new work.
107. As a team member, I want to be told when a sprint starts and when it completes with a summary of what moved, so that I am not surprised.
108. As a team member, I want a warning before a due date, so that I can act.
109. As a team member, I want no notification for status changes or reordering, so that the important alerts are not drowned out.
110. As a team member, I want to see another person's change arrive live on the backlog and board, so that we are looking at the same thing.
111. As a team member, I want concurrent edits on different fields both to survive, so that we do not overwrite each other.

**Teams and modes**

112. As a team lead, I want my team's backlog and sprints scoped to my team, so that we do not see everyone's work.
113. As a team lead, I want a Continuous mode where a rolling sprint carries work without sprint ceremony, so that a team that does not want sprints is not forced into them.
114. As a team lead, I want to choose the mode per team on web, so that configuration stays where configuration lives.

**Rollout and safety**

115. As an org admin, I want the redesign behind a flag with the old interface available, so that I can migrate on my own schedule.
116. As an engineer, I want the schema change to be one auditable migration, so that I can reason about the risk.
117. As an engineer, I want the migration to fail loudly on a tenant whose data does not map, so that a silent partial upgrade is impossible.
118. As an engineer, I want a newly created tenant to get the same schema as an upgraded one, so that the known drift bug does not recur.
119. As an engineer, I want generated API models per client, so that a field rename breaks the build instead of the product.
120. As a release manager, I want a parity checklist enforced in CI, so that "same features everywhere" stays true after the first sprint.

## Implementation Decisions

### Vocabulary (must be captured in the domain glossary)

- **Task** — a unit of work, referenceable as `PROJ-123`.
- **Backlog** — the set of tasks with no sprint. Never defined by dates.
- **Schedule** — the calendar view of tasks that have a planned date.
- **Sprint** — a timeboxed batch of tasks owned by a team.
- **Board** — workflow-state columns for one sprint.
- **Plan** — the split backlog-and-sprint planning surface.
- **Completed** — a task whose workflow state belongs to the done category.
- **Workflow state / category** — an org-configured status; the category is one of open, in progress, in review, done.
- **Rank** — the per-team ordering value.
- **Epic** — a work item type flagged as an epic.
- **Team** — the scope that owns a backlog and a sequence of sprints.
- **Continuous mode** — a team setting in which a rolling sprint replaces sprint ceremony.

The existing term "Scheduled" is retired in favour of **Schedule**, because it named a container rather than a view.

### Domain and schema

- A task is in the backlog if and only if it has no sprint. There is no third container and no date condition.
- The planned date replaces the current ambiguous date field, which is renamed and narrowed to a date-only column. The due date is likewise date-only. Date-only values are deliberate: a task must not drift across a day boundary by timezone. Burndown and reminders resolve "today" using the team's timezone; everywhere else uses the viewer's local day.
- The task's workflow state becomes the single status. The legacy status column is backfilled into it and then dropped.
- Completion is the done category, and the completion timestamp becomes a derived value maintained by the database whenever a task's workflow state changes. Clients never write it.
- The four categories are retained. The familiar three-way model survives as a presentation grouping.
- Ordering uses a single per-team string rank column, computed so that inserting between two neighbours rewrites one row. The existing numeric rank is retained for one release as a deprecated parallel write and then dropped; nothing reads it.
- A sprint baseline table records committed points and the committed task set when a sprint starts, and re-records on explicit scope change, so scope change is measurable.
- Sprints are scoped by team. Projects and work item types become filters, not containers. No board entity is introduced.
- A completed sprint rejects task writes. Only its retrospective stays writable.
- Rigid permissions are unchanged: agile and workflow configuration remains web-only by existing platform policy; native clients read configuration and never write it.

### Migration

- The change is a new numbered tenant migration, not a re-squash: the baseline migration is already recorded as applied in every existing tenant's migration ledger, so the baseline cannot be edited in place.
- Migrations run per tenant database and are tracked per database, so the migration must be correct on an empty database and on a populated one, and must fail loudly per tenant if any row cannot be mapped to a workflow state.
- The change must also be applied where base tenant schema is defined, so that a newly created tenant matches an upgraded tenant. Past drift in exactly this area is documented as the reason migrations were flattened to SQL files.
- The backfill maps legacy status values to the team's workflow states, backfills the completion timestamp, seeds rank values per team in creation order, and creates the baseline table and the completion trigger.
- Deployment order: migration first, then server, then clients. The server tolerates a not-yet-migrated tenant only by refusing writes, never by guessing.

### API contracts

- The backlog endpoint loses its date condition and gains filters for project, work item type and epic, plus a completed-inclusion flag and a completed-window parameter. Its response reports an incomplete total and a completed count, so the collapsed section can render its badge from the first response without a second request.
- Completed items are served by that flag, lazily on expand. No separate completed endpoint is introduced.
- A rank endpoint accepts the intended neighbours and returns the computed rank. Clients never invent rank strings.
- The schedule and unschedule operations now set and clear the planned date and have no effect on backlog membership.
- The status operation returns the derived completion timestamp and rejects writes on a completed sprint.
- A user-preferences endpoint stores completed visibility, card density and default team per user per org. Not local storage.
- A webview session exchange: a bearer-authenticated call returns a single-use, sixty-second code; the webview redeems it for a normal cookie session. Tokens never enter JavaScript. Redemption rejects native clients.
- Sprint stats add committed, scope-added and scope-removed points.
- Every mutating request keeps the existing CSRF-style header requirement.

### Realtime

- The existing task update event gains a field-level delta payload with the changed fields, the actor and a timestamp. Whole-object overwrite is prohibited.
- New events: sprint started, sprint completed, task ranked.
- Delta application is last-write-wins per field, with a non-blocking attribution flash on the affected card or row.
- Backlog and board both subscribe. Optimistic update, broadcast, reconcile.

### Information architecture

- Tabs become routes: backlog, sprint board for a sprint, sprint plan for a sprint, schedule, and the existing service desk.
- Filters live in the query string; the stored preference is the default when a parameter is absent.
- Sorting defaults to manual rank; choosing another sort is temporary for the session and does not reorder stored rank.

### Per-view behaviour

- Backlog: single ranked column, drag reorder with keyboard and touch sensors, quick-add at the top that keeps focus, inline edit, bulk selection with a selection bar, undo toasts, load-more pagination, and the collapsible completed section at the bottom.
- Board: columns from workflow states, advisory WIP limits, advisory done-transition checks, done columns always visible, completed cards hidden in non-terminal columns when the preference is off, two densities.
- Plan: two panes with drag both ways, editable goal, committed versus sprint size, recent velocity, mini burndown, epic rollup, epic filter.
- Schedule: month, week and list modes; unscheduled tray; drag to place and to unplace; per-day counts and points; leave, holiday and meeting overlays; overdue strip; phone layout as a single scrollable day column.
- Task detail: bottom sheet on narrow viewports; planned and due dates as distinct fields; logged versus estimated with a timer start; existing dependencies, blockers, acceptance criteria, custom fields, parent, children and Git references surfaced.

### Interaction infrastructure

- Drag and drop moves to one accessible library with mouse, touch and keyboard sensors, used by the backlog, the plan and the board. Native platforms use their own equivalent but assert the same interaction rules.
- A single command palette binds the primary modifier plus K and covers tasks, views and actions.
- A documented shortcut set ships with the feature, and WCAG 2.1 AA is a release gate for the whole Tasks area.

### Cross-platform

- Web is canonical. Desktop renders the web bundle, so it follows automatically and must never be tracked as a separate implementation.
- iOS renders the Tasks area in a scoped webview, using the session exchange, because no Tasks implementation exists there to preserve.
- Android keeps its native implementation, which is already substantial, and ports features to match. If it falls more than one release behind twice, it moves to the webview route; this is pre-agreed, not to be re-litigated.
- Design tokens have one machine-readable source that generates CSS variables, Compose theme objects and SwiftUI theme, with a CI drift check. No platform hand-maintains values.
- A machine-checked parity matrix lists every feature per client and fails the build when web ships something another client has neither shipped nor explicitly waived.
- Agile configuration stays web-only; native clients deep-link to web rather than presenting a half-working editor.

### Delivery

- Four phases. Phase zero: migration, contracts, generated models, design tokens. Phase one: the container fix, one meaning of completed, the collapsible section and shared preference, ranking, routes, bulk actions, undo, keys. Phase two: board and plan, epics, schedule calendar, density, carryover pre-flight, scope baseline, inline insight, time tracking, palette, realtime, notifications. Phase three: responsive pass, token rollout, iOS webview, Android port, parity gate, accessibility audit.
- Phase one alone is a complete fix for the reported symptom and ships independently.
- The whole redesign sits behind a per-org flag with the current interface as fallback.
- The phase zero schema work is a wide refactor rather than a vertical slice: the rename and the status removal touch every client at once. It must be sequenced as expand-then-contract, keeping the build green between batches, rather than forced into a single tracer bullet.

## Testing Decisions

**What makes a good test here.** Test observable behaviour at the highest seam that can express it: an HTTP request and its response, a rendered view and what the user can see, or a contract file and whether it validates. Do not assert on internal query text, private helpers or component internals. A test should fail for a reason a user would recognise.

**Seam one — HTTP behaviour.** Exercise the express app through supertest with the database layer mocked, as the existing agile gating tests do. This is the primary seam and covers by far the most: backlog membership, the completed split and its counts, rank computation, immutable completed sprints, preference persistence, the schedule operation's independence from backlog membership, and the whole reported regression.

**Seam two — components.** Render with Testing Library and mocked contexts, as the existing status-control tests do. Covers the collapsible section, density, the selection bar, empty and error states, and the palette's keyboard behaviour.

**Seam three — contracts.** Validate JSON and generated artefacts with the built-in test runner, as the parity matrix tests already do. Covers the parity gate, token generation drift, and the realtime delta payload shapes.

**Seam four — ephemeral Postgres, new, narrowly scoped.** The mocked database cannot prove the backfill mapping or the completion trigger, and those are the two highest-risk changes in the work. Stand up a disposable Postgres, apply the full tenant schema, and assert: legacy statuses map to the right workflow-state category; completion is set on entering a done category and cleared on leaving; rank values seed in creation order and remain unique per team; a newly created tenant and an upgraded tenant end with the same schema. Keep this seam to migration and trigger tests only — do not let it become a second place where feature behaviour is tested.

**The regression test is mandatory.** The reported bug becomes one end-to-end assertion at seam one: mark a task done, confirm it is absent from the incomplete backlog, confirm it appears under completed, confirm the count matches, confirm the shared preference reveals and hides it. That single test is the definition of done for phase one.

**Also required per phase:** contract tests for every changed endpoint, and an accessibility check on backlog, board, plan and schedule.

**Prior art:** server route tests driven by supertest with mocked database access; client component tests driven by Testing Library with mocked contexts; contract tests driven by the built-in Node test runner with no third-party dependency.

## Out of Scope

- Watchers and notification subscriptions.
- Versions and releases.
- Roadmap or timeline (Gantt) view.
- Workload and resource views, and per-member capacity planning. Duration is the planned dates plus historical velocity.
- Swimlanes on the board.
- An inline sub-task checklist interface. Parent and child relationships remain, without a new checklist surface.
- Shared or organisation-level saved views. Personal views only.
- Offline writes on mobile.
- Planner-style buckets.
- Bulk actions on the board.
- Any change to the Service Desk tab.
- Collapsing the four workflow categories to three.

## Further Notes

- **Glossary gap.** This spec fixes the vocabulary in its own text, but the repository has no domain glossary and no ADR capturing the container decision. Both should be created before implementation starts: the vocabulary above belongs in a glossary, and "a task belongs to a sprint or the backlog, dates are metadata" plus "workflow state is the only status, completion is derived" deserve ADRs. The reported bug was a vocabulary failure as much as a code defect.
- **Configuration boundary.** Because agile configuration is web-only by existing platform policy, several user stories resolve to a deep link rather than a native editor. Recording this as a decision now avoids it being discovered as a bug late.
- **Migration ordering constraint.** The existing baseline migration is already recorded as applied everywhere, so the only correct route is a new numbered migration applied in both the migration layer and the base tenant schema definition. Editing the baseline would make new tenants differ from upgraded ones — the exact drift bug this repository already fixed once.
- **Parity matrix is the guarantee.** The design spec and parity matrix already exist in the repository. The matrix's validator currently passes and is wired into contract validation. Tickets should keep it green rather than reinventing the check.
- **Android is the expensive client.** The intuition that mobile parity is cheapest by webview is wrong here: Android has a working native implementation to preserve, while iOS has nothing. The parity strategy follows that asymmetry.

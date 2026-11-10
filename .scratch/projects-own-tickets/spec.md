# Spec: Projects own tickets

**Status:** ready-for-agent
**Date:** 2026-11-04
**Surfaces:** server, web/desktop, Android. iOS follows the web through its webview.
**Decisions:** [ADR-017](../../docs/adr/ADR-017-projects-own-tickets.md) (supersedes ADR-013), [ADR-014](../../docs/adr/ADR-014-workflow-transition-enforcement.md), [ADR-016](../../docs/adr/ADR-016-server-decides-ticket-capabilities.md)
**Vocabulary:** [GLOSSARY.md](../../GLOSSARY.md): Project, Project role, Ticket, Ticket key, Key alias, Archived project, Service Desk project, Team, Workflow state, Transition, Capability, Placement, Sprint
**Origin:** design interview 2026-11-03 (Q1–Q27). This is Phase 2 of the [Jira-style work-management roadmap](../jira-style-work-management/roadmap.md). It closes gaps G1, G8 and the per-project-workflow, key-rename and project-delete parts of G3.
**Tickets:** [issues/](issues/). 01 first. Then 02 and 03 in parallel. Then 04, 05 and 06. Then 07 and 08 (after 06). 09 after 07 and 08. 10 after 02, 04 and 07. 11 after 04. 12 after 05 and 06. 13 after 07–10. 14 last.

---

## Problem Statement

Today a ticket belongs to a **team**. A project only hands out an optional ticket key. This causes several problems:

- **Work that crosses teams has no home.** A ticket must belong to exactly one team, so a stream of work shared by two teams has to be split or kept in one team where the other can't see it.
- **One team can't run two streams of work.** All of a team's tickets share one backlog, one set of sprints and one board.
- **Many tickets have no key.** Only tickets that someone put in a project get one, so many tickets show as `#1234`. Branches, commits and pull requests can't mention them, so GitHub can never link them.
- **Keys are fragile.** The key is worked out from the project's current key on every read. It can't be renamed safely, and deleting a project drops every key it gave out.
- **There is only one workflow per org.** A support queue and a product team are forced to use the same statuses.
- **Access is all or nothing.** You see a ticket if you're in its team. There's no way to give someone read-only access, or to let a whole second team help on a project.
- **Legacy tickets are hidden.** Tickets whose team couldn't be worked out sit in an admin-only Unassigned bucket.
- **Service Desk copies are second-class.** When a customer raises a Service Desk ticket, the copy in the platform backlog:
  - has no project and no key;
  - doesn't follow the Service Desk ticket's status;
  - disappears completely when the Service Desk ticket is deleted.

People coming from Jira expect every ticket to live in a project. They expect a key like `PLT-123` that never breaks, project roles, and a workflow per project.

## Solution

Every ticket belongs to exactly one **project**. The project gives the ticket:

- its ticket key
- its board and backlog
- its sprints
- its workflow
- who may see it

Teams become groups of people. A team can be given access to projects and can be assigned work, but it no longer owns tickets or sprints. **A team is never tied to one project.** When a team takes on a new stream of work, a team lead creates a new project and gives the team access, and that work's tickets live there. A team can work in any number of projects.

**Projects**
- Each project has a key, such as `PLT`. Each ticket's key (`PLT-123`) is stored on the ticket and is unique in the org.
- A project admin can **rename the key**. Every ticket gets a new key, and every old key keeps working forever as a **key alias**.
- Opening an old key, or mentioning it in a branch, commit or pull request, still finds the ticket.
- A project can be **archived**. It becomes read-only and disappears from pickers, but its tickets and keys stay visible and searchable.
- A project can only be deleted while it has no tickets. A key that was ever used is never handed out again.

**Access**
- Each project has three **project roles**:
  - **project admin:** settings, key, workflow, members, archive
  - **member:** create, edit, move, transition, plan and log work
  - **viewer:** read and comment
- A role can be granted to a single person or to a whole team.
- Super admins and HR admins see and administer every project.
- A ticket's reporter and assignee can always read and comment on it.

**Workflow**
- Each project has its own workflow. Each project starts with a copy of the org's current workflow, so nothing changes for anyone on day one. Project admins then change it as they need.

**Tickets**
- Creating a ticket needs a project. The picker remembers your last project.
- Moving a ticket to another project replaces the old "transfer to team":
  - The ticket gets a new key, and the old key becomes an alias.
  - It leaves a sprint that belonged to the old project.
  - Its status is mapped onto the new project's workflow.
- The Plan screen switches between projects instead of teams. The Unassigned bucket is removed.

**Service Desk**
- Org settings has a **Service Desk project**. New Service Desk copies go there, or to `General` if none is set.
- Every copy gets a key, and its status follows the Service Desk ticket.
- Deleting the Service Desk ticket **cancels** the copy instead of deleting it.

**Migration and switch-over**
- One migration creates a project for every team, plus a `General` project for tickets that have no team. It stores a key on every ticket, moves sprints and workflows to projects, and grants each team access to its project.
- Project ownership then stays **off** behind a per-org flag. A super admin uses a review screen to check the generated projects and rename their keys. These keys have never been shown to anyone, so renaming them creates no aliases.
- The admin then switches the org to project ownership. Until the switch, everyone keeps today's team-based behaviour.

Older Android builds keep working until the Phase 3 client-version gate:

- Their team scope maps to the team's project.
- Their team transfer maps to a project move.
- Ticket responses still carry the old field names.

## User Stories

**Projects and ownership**

1. As a member, I want every ticket I see to belong to exactly one project, so that I always know where a piece of work lives.
2. As a member, I want work shared by two teams to live in one project both teams can access, so that it doesn't have to be split or hidden.
3. As a team lead, I want my team to run more than one project, so that separate streams of work get separate backlogs, sprints and boards.
4. As a team lead or above, I want to create a project with a name, key, description, colour and lead, and give one or more teams access as I create it, so that a new stream of work has a home straight away.
4a. As a team lead, I want my team's access to one project to have no effect on its access to others, so that my team is never tied to a single project.
5. As the person who creates a project, I want to become its project admin automatically, so that I can set it up straight away.
6. As a member, I want to choose a project when I create a ticket, so that it lands in the right place.
7. As a member, I want the create form to pre-select the project I'm working in, or the one I used last, so that I don't have to pick it every time.
8. As a member, I want archived projects and projects where I'm only a viewer left out of the create picker, so that I can't pick somewhere I can't create.
9. As a member, I want to see the project name and key on every ticket card and on the ticket detail, so that I can tell where the work belongs.

**Ticket keys and aliases**

10. As a member, I want every ticket, including old ones that never had a key, to have a ticket key, so that I can refer to any ticket the same way.
11. As a member, I want a ticket's key to stay the same when other tickets are deleted or moved, so that references in chat and documents stay correct.
12. As a member, I want to open a ticket by typing or pasting its key, so that I can jump to it straight away.
13. As a member, I want a ticket's former key to open the ticket and show its current key, so that old links still work.
14. As a member, I want the ticket detail to list the ticket's former keys, so that I can recognise it under the name I remember.
15. As a member, I want search and the command palette to find a ticket by its current key or any former key, so that renames never hide work.
16. As a developer, I want branches, commits and pull requests that mention a former key to still link to the ticket, so that code history isn't broken by a rename or move.
17. As an org admin, I want a key that was ever used, whether as a project key or a ticket key, to never be given out again, so that an old reference can never open the wrong ticket.
18. As a project admin, I want new ticket numbers in my project to keep counting up and never reuse a number, so that keys are predictable.

**Key rename**

19. As a project admin, I want to rename my project's key, so that it matches the project's real name.
20. As a project admin, I want a clear warning, with the number of tickets that will get a new key, before I rename, so that I understand the effect.
21. As a project admin, I want the rename to apply to every ticket at once or not at all, so that a project never ends up with mixed keys.
22. As a project admin, I want a rename to be refused if the new key is badly formatted, already in use or reserved, so that keys stay unique.
23. As a member viewing the board while the key is renamed, I want the cards to update to the new keys without a reload, so that I'm never looking at stale keys.
24. As an auditor, I want every key rename recorded with the old key, the new key and who made the change, so that it can be traced.

**Moving tickets between projects**

25. As a member of two projects, I want to move a ticket from one to the other, so that misplaced work can be put right.
26. As a member, I want a moved ticket to get a key from its new project and keep its old key as an alias, so that both keys open it.
27. As a member, I want a moved ticket to leave its old project's sprint and show that it did, so that sprint scope stays honest.
28. As a member, I want a moved ticket's status mapped to the matching status in the new project, falling back to the same category and then to the initial state, so that it never ends up in a status the project doesn't have.
29. As a member, I want to see where the status will land before I confirm a move, so that I'm not surprised.
30. As a member, I want a move to be refused unless I can create tickets in the target project, so that I can't push work into projects I don't belong to.
31. As a member, I want a ticket to join only a sprint of its own project, with a clear message otherwise, so that sprints never mix projects.
32. As an auditor, I want every project move recorded in the ticket history with the old and new project and key, so that the move can be traced.

**Project roles and visibility**

33. As a project admin, I want to grant project admin, member or viewer to a person, so that I control who works on my project.
34. As a project admin, I want to grant a role to a whole team, so that people who join the team get access automatically and people who leave lose it.
35. As a person with both a personal grant and a team grant, I want the higher of the two roles to apply, so that access is never accidentally reduced.
36. As a project admin, I want to change or remove grants, so that access follows how the work changes.
37. As a project admin, I want to be stopped from removing the last project admin, so that a project is never left with nobody to run it.
38. As a viewer, I want to read tickets and add comments but not edit, move or transition them, so that I can follow and contribute safely.
39. As a member, I want to create, edit, transition, plan, move between sprints and log work in my project, so that I can do my job.
40. As a person with no role in a project, I want its tickets hidden from every list, search, board, export, notes picker and mention, so that confidential work stays private.
41. As a reporter or assignee without a role in the project, I want to still read and comment on that ticket, so that I'm never shut out of my own work.
42. As a super admin or HR admin, I want to see and administer every project without being granted a role, so that I can always help.
43. As a project admin, I want to log, edit and delete work for other people in my project, so that I can correct time without an org admin. Phase 1 gave this to org admins only.
44. As a member, I want the buttons I see to match exactly what the server will allow, so that I never press a button that then fails.

**Workflow per project**

45. As a project admin, I want my project to have its own workflow states and transitions, so that it fits how my project works.
46. As a project admin, I want to add, rename, recolour, reorder and deactivate states, and edit transitions, from project settings, so that I don't need an org admin.
47. As a member of another project, I want a workflow change in someone else's project to leave my board alone, so that projects stay independent.
48. As a member, I want my project's workflow on day one to match exactly what the org had before, so that the switch-over changes nothing for me.
49. As a manager creating a new project, I want it to start from the default workflow template, so that it works straight away.
50. As a project admin, I want every project to keep a Cancelled state with no way out of it, so that cancelling works the same everywhere.
51. As a reporting user, I want reports to group tickets by category across projects, so that "done" means the same in every project.

**Archive and delete**

52. As a project admin, I want to archive a finished project, so that it stops showing up in pickers without losing its history.
53. As a member, I want an archived project's tickets to be read-only and labelled as archived, so that nobody changes closed work by mistake.
54. As a member, I want an archived project's tickets and keys to still open and appear in search, so that history stays reachable.
55. As an org admin, I want to unarchive a project, so that work can start again there.
56. As a super admin, I want to delete a project only if it has never had tickets, so that keys are never lost.

**Plan screen and boards**

57. As a member, I want the Plan screen to switch between my projects instead of teams, so that the backlog, sprints and board show one project's work.
58. As a super admin, I want the project switcher to list every project, so that I can look at any of them.
59. As a member, I want each project's sprints to belong to that project, so that two projects never share a sprint.
60. As an org admin, I want the Unassigned bucket gone, because every ticket now has a project, so that no work is hidden in a special admin view.
61. As a team lead, I want to delete a team without first moving its tickets and sprints, because the team no longer owns them, so that I can reorganise freely.

**Service Desk**

62. As a platform org admin, I want to choose the Service Desk project in org settings, so that customer tickets land where my support people work.
63. As a platform org admin, I want new Service Desk copies to go to `General` when no Service Desk project is set, so that none are lost.
64. As a support member, I want every Service Desk copy to have a key, so that I can mention it in code and chat.
65. As a support member, I want a copy's status to follow the Service Desk ticket (open, acknowledged, in progress, resolved, closed), so that both sides agree.
66. As a support member, I want deleting a Service Desk ticket to cancel the copy, with a history note, instead of deleting it, so that the work and its time are kept.
67. As a support member, I want a Done copy to stay Done when its Service Desk ticket is deleted, with a history note, so that finished work isn't changed backwards.
68. As a customer submitting a ticket, I want submission to succeed even if creating the copy fails, so that my request is never lost.

**Migration and switch-over**

69. As an org admin, I want the migration to create one project per team, named after the team, so that every team keeps its own space.
70. As an org admin, I want a generated project to be Scrum if the team ever had a sprint and Task list otherwise, so that its type matches how the team worked. The type is stored now; its behaviour arrives in Phase 3.
71. As an org admin, I want tickets with no team gathered into a `General` project, so that nothing is left without an owner.
72. As an org admin, I want tickets that already had a project and key to keep them, so that published keys never change.
73. As an org admin, I want each team granted member access to its generated project, and existing project leads made project admins, so that everyone keeps seeing what they saw before.
74. As an org admin, I want each existing project to grant member access to every team that owned tickets in it, so that nobody loses access to work they could see before.
75. As an org admin, I want each sprint to move to the project that holds most of its tickets, so that sprints keep their contents.
76. As an org admin, I want any ticket that had to move project for its sprint to keep its old key as an alias, with the move listed for review, so that the change is visible and safe.
77. As a super admin, I want a review screen listing each generated project with its key, type, ticket count and any migration moves, so that I can check the result before anyone sees it.
78. As a super admin, I want to rename generated keys before the switch without creating aliases, so that nobody ever sees the temporary keys.
79. As a super admin, I want to switch my org to project ownership when I'm ready, so that the change happens at a time I choose.
80. As a member in an org that hasn't switched yet, I want everything to work exactly as before, so that the migration doesn't disrupt my work.
81. As a platform operator, I want running the migration a second time to change nothing, so that a retried deploy is safe.
82. As a platform operator, I want to turn the flag off in an emergency and get team-based visibility back, so that a bad switch-over can be rolled back.

**Older clients**

83. As an Android user on an older build, I want my team-scoped backlog, sprint and board to keep loading, showing my team's project, so that I can keep working until I update.
84. As an Android user on an older build, I want creating a ticket without a project to land it in my team's project, or `General`, so that my ticket isn't rejected.
85. As an Android user on an older build, I want "transfer to team" to move the ticket into that team's project, so that the action still works.
86. As an Android user on an older build, I want tickets to keep their old key field, so that keys still show.

**Android (current build)**

87. As an Android user, I want a project switcher on the Plan screen, so that I work in the same projects as on the web.
88. As an Android user, I want to choose a project when I create a ticket, so that it lands in the right place.
89. As an Android user, I want to move a ticket to another project, so that I can fix misplaced work from my phone.
90. As an Android user, I want archived and read-only tickets to hide their edit actions based on what the server says I can do, so that the app matches the web.
91. As an Android user, I want searching by an old key to find the ticket, so that old links work on mobile too.

## Implementation Decisions

**Schema (expand only; nothing is dropped in this phase).** There are two tenant migrations. The first does projects, keys, roles and sprints. The second copies workflows into each project; it ships with the change to project-scoped transition enforcement, because copying states gives them new ids.
- `projects` gains four fields:
  - a type: `scrum`, `kanban` or `task_list`. Kanban isn't produced by the migration. In this phase the type only sets the workflow template and is shown on screen.
  - an origin team, set only on generated projects. It's used only by the migration and to map old clients' team scope. It is **not** an ownership link: the team's access to the project comes only from its grant, and the team can hold grants on any number of projects.
  - a "key published" marker, which is false for generated projects until the switch.
  - an `is_general` marker.
- **Project members** is a new table with one row per grant. Each row holds:
  - the project
  - exactly one of a user or a team
  - the role: `project_admin`, `member` or `viewer`
  - who granted it, and when

  Each user and each team can hold at most one grant per project.
- **Tickets** gain a stored, non-null **ticket key**, unique within the org. `project_id` becomes non-null, and its foreign key stops nulling on delete. `task_number` stays unique within each project.
- **Key aliases** is a new table holding old ticket keys. Each row holds the org, the key, the ticket, the reason (`rename` / `move` / `migration`) and when it was created. Each key is unique within the org.
- **Reserved project keys** is a new table that records every key a project has ever had. A new project key, or a rename, must not match any current key or any reserved key. Together with the alias table, this keeps the rule that keys are never reused.
- **Sprints** gain a project. In this phase the old `team_id` is kept and filled in for old clients; Phase 3 drops it.
- **Workflow states** and **transitions** gain a project. Org-level rows (with no project) become the template that new projects copy from; they're seeded and can't be edited in this phase. Uniqueness changes from (org, key) to (project, key).
- **Org settings** gain the Service Desk project.
- The baseline schema for new tenants matches. A new tenant gets a `General` project and the template workflow.

**Migration (idempotent and safe to re-run)**
1. **Projects.** Create one project per team that doesn't have one yet (matched on origin team):
   - Name it after the team.
   - Generate a key from the team name: 2–10 uppercase characters, with a numeric suffix if it collides with an existing project key.
   - Make it Scrum if the team ever owned a sprint, otherwise Task list.
   - Leave its key marked unpublished.

   Also create `General` (a Task list project, key `GEN` with a suffix if taken). Existing projects get a type by the same sprint rule, keep their keys, and are marked published.
2. **Sprints.** Each sprint goes to the project that holds most of its tickets. On a tie, or when the sprint has no tickets, it goes to its team's generated project; a sprint with no team goes to `General`. A ticket in the sprint that belongs to another project is moved into the sprint's project. It gets a new number, keeps its old key as an alias with reason `migration`, and is written to a migration-moves review table.
3. **Tickets.** A ticket without a project goes to its team's project, or to `General` if it has no team. It's numbered from that project's counter in creation order. Every ticket then gets its stored key.
4. **Workflows.** Copy the org's current states and transitions into every project, keeping keys, names, categories, colours, order, WIP limits and flags. Point each ticket's workflow state at its project's copy, matching on key. Make sure every project has a terminal Cancelled state. Leave the org-level rows as the template.
5. **Roles.**
   - Each team gets **member** on its generated project.
   - Each existing project gives its lead **project admin**, and gives **member** to every team that owned tickets in it.
   - The team lead of a generated project's team gets **project admin**, where the data has one.
   - `General` gets no grants; org admins see it, as they saw the Unassigned bucket before.
6. Leave the per-org `project_ownership` flag **off**.

**Switch-over (per-org `project_ownership` flag; this replaces the `team_visibility` flag)**
- **While the flag is off:**
  - Visibility, ownership and sprint rules stay exactly as they are today (ADR-013).
  - Writes still fill in project, ticket key and sprint project. A new ticket goes to the actor's team project, or to `General`. A team transfer also moves the ticket to the target team's project.
  - Renaming an unpublished key changes ticket keys without creating aliases.
- **The review screen** (super admins) lists:
  - generated projects with key, type, ticket count and grants
  - migration moves
  - key-rename controls

  "Switch to projects" turns the flag on and marks every key published. From then on, every rename creates aliases.
- **Turning the flag back off** is a platform-admin emergency action. It brings back team visibility from `team_id`, which is still filled in on create (with the creator's team) but isn't updated by project moves.

**Project access module** (a new deep module in the tasks area, with its SQL in a repository)
- It answers three questions:
  - the actor's effective role in a project: the highest of their personal grant and their teams' grants, with org admins treated as project admin;
  - the set of projects the actor can see;
  - whether an action is allowed by role.
- It is resolved once per request and passed into the policy and capabilities modules.
- Org admins are super admin, HR admin and platform admin, as today.

**Visibility policy** (the existing single policy module, rewritten)
- With the flag on, a ticket is visible if any of these is true:
  - the actor is an org admin
  - the actor has any role in the ticket's project
  - the actor is the reporter or the assignee
- List requests can narrow to a single project or to personal scope. The team switcher and the Unassigned bucket are removed from the policy.
- Every surface that already goes through the policy picks this up: list, detail, history, comments, attachments, dependencies, rank, bulk, search, export, carry-over, the notes picker, Service Desk and sprints.
- Legacy `team_id` and `unassigned` list parameters still work. `team_id` resolves to that team's generated project, and `unassigned` returns an empty list.

**Ownership** (the existing ownership module, rewritten around projects)
- **Resolving the project on create:**
  - Use the project named in the request, if the actor can create there.
  - Otherwise use the sprint's project.
  - Otherwise use the legacy default: the actor's team project, then `General`.
  - The request is refused if the resolved project is archived or the actor isn't at least a member.
- **Sprint rule:** a ticket may join only a sprint of its own project. The `SPRINT_TEAM_MISMATCH` refusal is replaced by `SPRINT_PROJECT_MISMATCH`.
- **Moving to another project** is a new operation in the placement module, and it replaces the team transfer. In one transaction it:
  1. checks the actor is a member in both the source and target projects;
  2. takes the next number from the target project;
  3. writes the new key and stores the old key as an alias;
  4. maps the workflow state: same key, otherwise the first active state in the same category, otherwise the initial state;
  5. clears a sprint that belongs to the source project, as a placement;
  6. writes ticket history and an audit entry.

  `task_updated` is sent after commit. A preview call returns the target key format, the mapped state and whether the ticket leaves a sprint, without writing anything.
- The legacy transfer endpoint keeps its path and response shape. It moves the ticket into the target team's project.

**Ticket key module** (grows out of the existing issue-key helper)
- Pure functions: parse keys from text (same pattern as today), format a key, and validate a project key.
- Resolving a key looks at current ticket keys first, then aliases, and returns the ticket id and whether the key was an alias.
- Code-reference linking and search both use this resolution, so links made through an alias still work.
- Keys are always read from the stored column; they're no longer worked out on each read.

**Key rename** (inside the projects area)
- Only project admins can rename.
- The new key is checked for format and against every current and reserved key.
- In one transaction:
  1. the project key changes;
  2. the old key is reserved;
  3. each ticket gets its new key;
  4. if the key was published, an alias is written for each old ticket key.
- One audit entry is written for the project. No history row is written per ticket; the ticket detail lists its aliases instead.
- A realtime project-updated event is sent after commit so that clients refresh keys.

**Workflow per project** (the existing workflow-rules and transition enforcement, now scoped by project)
- Transition checks look up the ticket's project workflow. ADR-014 behaviour is unchanged.
- Project admins manage states and transitions under the project resource. The org-level workflow-state endpoints:
  - still answer reads, and accept an optional project. Without one, they return the workflow of the actor's default project.
  - refuse writes now that the web has moved to project settings.
- Work item types and agile settings stay at org level under the existing agile editor grants. Workflows per ticket type are deferred.

**Archive and delete**
- Project admins and org admins can archive. Only org admins can unarchive.
- Archived projects are hidden from the create, move and sprint pickers. Every write on their tickets is refused with the new capability reason `PROJECT_ARCHIVED`; reading, searching, opening by key and commenting still work.
- Delete stays super-admin only and is allowed only when the project has never had tickets. Its key stays reserved.

**Capabilities** (ADR-016: decided in the capabilities module, never on clients)
- The decision context gains the actor's project role and whether the project is archived.
- **Ticket-level changes:**
  - Existing edit, transition and planning capabilities require member or higher.
  - Comment requires viewer or higher, or being the reporter or assignee.
  - The new `canMoveProject` capability requires member or higher in the source project; the target is checked when the move is made.
  - `canLogWorkForOthers` now allows project admins as well as org admins.
- **Project-level capabilities** come back on project responses: `canAdminister`, `canCreateTickets`, `canManageMembers`, `canEditWorkflow`, `canRenameKey` and `canArchive`.
- **New denial reasons:** `PROJECT_ARCHIVED`, `SPRINT_PROJECT_MISMATCH` (replacing `SPRINT_TEAM_MISMATCH`) and `READ_ONLY_ROLE`. All three are added to the reason catalogue and the denial messages.

**Service Desk**
- **Creating a copy:** the copy goes into the Service Desk project, or `General` if none is set. It gets a number, its key and the initial state of that project's workflow. If creation fails, the ticket submission still succeeds and the failure is logged.
- **Status sync** runs one way, from the Service Desk ticket to the copy, as a system actor. It writes a history entry marked as a Service Desk sync and bypasses the transition graph.

  | Service Desk status | Copy moves to |
  |---|---|
  | open, acknowledged | the initial state |
  | in progress | the first `in_progress`-category state |
  | resolved, closed | the first non-cancelled `done`-category state |

  A cancelled copy is never synced again.
- **Deleting the Service Desk ticket** moves the copy to Cancelled and writes a history note. A copy that is already Done stays Done and gets only the note. The copy is never deleted.

**API**
- **Creating a project** needs the org role team lead or above (it was manager before). The create request can grant member access to one or more teams. The creator becomes project admin.
- **Projects resource gains:**
  - members: list, grant, change and remove
  - key rename
  - workflow: states and transitions
  - archive and unarchive, using the existing endpoint
  - project-level capabilities on every project response
  - a "my projects" listing for pickers, which leaves out archived projects and projects where the actor can't create
- **Tickets resource gains:**
  - fetch by key, current or alias, with a marker when the key was an alias
  - move to project, plus its preview
  - `ticket_key`, `project` (id, key, name, archived) and `key_aliases` on detail responses
- Ticket create needs a project from current clients and falls back to the legacy default for older ones.
- Backlog, sprint, board and list endpoints take a project.
- **Kept for older clients until Phase 3:**
  - the `issue_key` response field, with the same value as `ticket_key`
  - the `team_id` response field
  - the team scope parameters
  - the transfer endpoint
- Org settings gain the Service Desk project.
- An admin endpoint serves the migration review and the switch.

**Web / desktop**
- **The Projects page becomes project settings**, with these sections:
  - details
  - key rename, with a warning and the number of affected tickets
  - members and roles, granted to users or teams
  - workflow: the existing agile workflow panels, moved here and scoped to the project
  - archive
- **The Plan screen** has a project switcher instead of the team switcher, and the Unassigned option is removed.
- **Creating a ticket** needs a project picker, which defaults to the current or last-used project.
- **Ticket detail** gains "Move to project", with a preview, and lists former keys.
- **A web URL by ticket key** opens the ticket. An alias rewrites the URL to the current key.
- **Search and the command palette** match aliases.
- **Org settings** gain the Service Desk project picker.
- **A super-admin review screen** handles the migration review and the switch.
- Desktop gets all of this automatically because it serves the web client.

**Android**
- `PlanScope` and the shell view model change from team scope to project scope. The project switcher replaces the team picker.
- Creating a ticket needs a project.
- "Move to project" replaces team transfer.
- Edit actions follow server capabilities, including archived and read-only states.
- Search by key resolves aliases through the server.
- Project settings, key rename, members and workflow editing stay web-only.

**Contracts and docs**
- **Contracts:** regenerate the API models and update the route snapshot, route inventory and OpenAPI. Update the tasks-parity, Android endpoint and realtime parity entries.
- **GLOSSARY:** remove the Unassigned entry, and change Placement so that a project move replaces team transfer.
- **Module docs:** update the tasks module README and the ADR-013 cross-references.

## Testing Decisions

A good test exercises behaviour through the public seam and checks outcomes: HTTP responses, which tickets a given actor can see, stored keys and aliases, and history rows. It never checks internal calls or the shape of the SQL. The owner agreed these seams on 2026-11-04.

**Primary seam: tasks, projects and Service Desk HTTP routes on real PostgreSQL**
- **Setup:** a mini Express app with the auth, RBAC and tenant middleware stubbed by test headers, the real routers mounted, and a throwaway database per suite. The suite is skipped when the test database variable is unset. Run it with the PostgreSQL test script.
- **Prior art:** the placement routes integration suite.
- **Covers:**
  - creating a ticket with a mandatory project, including the legacy default for project-less requests
  - visibility for each role, with personal and team grants and the highest one winning
  - org-admin, reporter and assignee access
  - fetching by current key and by alias
  - key rename: aliases created only for published keys, and conflicts and reserved keys refused
  - project move: new key and alias, state mapping, sprint cleared, preview matching the actual move
  - `SPRINT_PROJECT_MISMATCH`
  - archived-project writes refused and reads allowed
  - delete allowed only for a project that never had tickets
  - per-project workflow transitions enforced
  - project member management and the last-project-admin guard
  - legacy `team_id` scope, transfer endpoint and `issue_key` field
  - behaviour with the flag off matching today's team model
  - Service Desk copies: project and key, status sync for every status, cancel on delete, Done copy left Done
- **Existing suites to update:** the mocked team-visibility routes suite, the projects routes characterization suite and the Service Desk routes characterization suite are rewritten for project ownership. Existing placement and workflow suites are updated to project-scoped sprints and workflows.

**Migration seam: real PostgreSQL**
- **Prior art:** the tasks schema-expand integration suite.
- **Steps:**
  1. Seed teams with and without sprints, project-less tickets, tickets in existing projects, tickets with no team, sprints that mix projects, and custom workflow states.
  2. Run the migration twice.
- **Assert:**
  - one project per team, plus `General`
  - the type rule
  - grants
  - every ticket has a project and a unique stored key, and existing keys are unchanged
  - sprints are assigned by majority, and migration moves are aliased and listed for review
  - workflows are copied, and each ticket's state points at its project's copy
  - the second run changes nothing

**Capabilities seam: the existing capabilities integration suite**
- The actor table replaces team membership with project roles: admin, member and viewer, personal or through a team; reporter and assignee with no role; org admin; and people with no access.
- It also covers the archived project and the new denial reasons.

**Pure seam: ticket key**
- Extend the existing issue-key unit test with key formatting, project-key validation and parsing.

**Clients**
- **Web:** Vitest and React Testing Library with the API modules mocked.
  - **Prior art:** the IssueKey and ticket detail tests.
  - **Covers:** the project picker on create, the switcher replacing the team picker, move to project with its preview, the key rename warning and its result, members and roles, an alias URL redirecting, and controls hidden when the capability is missing.
- **Android:** JVM tests through the Plan shell and ticket detail view models, using the existing fake API client harness.
  - **Covers:** project scope, create with a project, move to project and capability-driven actions.

**Contract checks**
- Contracts validation, the tasks-parity check and the Android endpoint and realtime parity checks must pass.

## Out of Scope

- **Project type behaviour (Phase 3):** Kanban boards and WIP behaviour, removing the Scheduled container and automatic sprints, start dates, subtasks and the shared sprint-completion rule. Phase 2 only stores the type and uses it to pick the workflow template.
- **Cleanup that needs the Phase 3 client-version gate:** dropping `tasks.team_id`, `sprints.team_id`, the team scope parameters, the transfer endpoint and the `issue_key` field.
- **GitHub App, Development panel, smart commits and automation rules (Phase 4).** Phase 2 only makes sure every ticket has a key and that aliases still resolve code references.
- **Admin home widget, My Work across projects, and timesheets (Phase 5).**
- **More permission options:** workflows per ticket type, per-project work item types, custom permission schemes beyond the three project roles, and per-project role restrictions on transitions.
- **Bulk moves:** moving several tickets to another project at once. Phase 2 moves one ticket at a time.
- **More Service Desk syncing:** syncing title, description, priority or comments, and any sync from the copy back to the Service Desk ticket.
- **Sharing a project with another tenant.**
- **Project categories, project templates other than the default workflow, and project avatars.**
- **Editing project settings, members or workflow on Android.**

## Further Notes

- **ADR text.** ADR-017's Consequences section has a bullet about workflows that runs into the Service Desk text. This spec reads it as "workflows move from one per org to one per project; workflows per ticket type are deferred". [GLOSSARY.md](../../GLOSSARY.md) also has a few entries that run together (Placement/Sprint, Current sprint, Board, Unassigned, Worklog/Timesheet). They should be fixed when the glossary is updated for this phase.
- **Why a flag.** The flag follows the `team_visibility` rollout from ADR-013. Admins get to fix generated keys before anyone sees them, so temporary keys never become permanent aliases.
- **Teams are not bound to projects** (owner decision, 2026-11-04). A team takes on new work by creating a new project, not by stretching its generated one. Old clients that send a team scope see only that team's generated project. To see other projects, people need a current client.
- **Phase 1 handover.** Phase 1 let only org admins log work for others, until project roles existed. Phase 2 extends `canLogWorkForOthers` to project admins.
- **Bugs fixed as a side effect:**
  - Keys disappeared when a project was deleted, because the foreign key nulled on delete.
  - Keys were worked out on every read, so they couldn't be renamed.
  - Service Desk copies were hard-deleted.
  - The admin-only Unassigned bucket hid legacy tickets.
- **Phase 3 dependency.** ADR-018 still leaves `pre_sprint_due_date` open. That question belongs to Phase 3 and is not affected by this spec.

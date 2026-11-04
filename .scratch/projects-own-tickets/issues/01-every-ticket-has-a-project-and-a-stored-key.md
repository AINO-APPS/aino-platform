# 01: Every ticket has a project and a stored ticket key

**What to build:** after this ticket, every ticket in every tenant belongs to a project and has a stored ticket key, including legacy tickets that never had one. Each team gets a generated project, and tickets with no team go into `General`. Every sprint belongs to a project. Nothing changes for anyone yet: visibility, ownership and sprint rules still follow the team (ADR-013), because the per-org `project_ownership` flag stays off. Tickets that used to show as `#1234` now show a real key on the web and on Android.

**Blocked by:** None (can start immediately)

**Status:** resolved

**Owner:** `ticket/projects-own-tickets-01` (`.worktrees/projects-own-tickets-01`).
**Test seams:** tenant migration runner on real PostgreSQL (schema/backfill/rerun); HTTP ticket and sprint routes with project ownership off (write compatibility and stored-key responses); existing visibility, placement and capability route suites; generated contracts and endpoint parity. These are the ticket's specified public seams; Android source changes are reserved for ticket 13.

Spec: [projects-own-tickets](../spec.md). Decisions: ADR-017.

- [x] One new tenant migration, expand only:
  - **Projects** gain: a type (`scrum` / `kanban` / `task_list`), an origin team, a "key published" marker and an `is_general` marker.
  - **Project members** is a new table. Each grant holds exactly one of a user or a team; the role is `project_admin`, `member` or `viewer`; each user and each team holds at most one grant per project.
  - **Key aliases** and **reserved project keys** are new tables.
  - **Org settings** gain the Service Desk project.
  - **Sprints** gain a project.
  - **Tickets** gain a stored ticket key, unique within the org.
  - The baseline schema for new tenants matches, and a new tenant gets a `General` project.
- [x] **Generated projects.** The migration creates one project per team that doesn't have one yet:
  - Named after the team.
  - Its key is generated from the team name: 2–10 characters, with a numeric suffix if it collides with an existing key.
  - Scrum if the team ever owned a sprint, otherwise Task list.
  - Its key is marked unpublished.
  - The origin team is recorded only so the migration and old clients can map team scope; it is not an ownership link.

  It also creates `General` (Task list, key `GEN` with a suffix if taken). Existing projects keep their keys, get a type by the same rule, and are marked published.
- [x] **Sprints.** Each sprint goes to the project that holds most of its tickets. On a tie, or when the sprint has no tickets, it goes to its team's generated project; a sprint with no team goes to `General`. A ticket moved into its sprint's project gets a new number, keeps its old key as an alias with reason `migration`, and is recorded in a migration-moves review table.
- [x] **Tickets.** Each ticket without a project goes to its team's project, or to `General` if it has no team. It's numbered from that project's counter in creation order. Every ticket then gets its stored key, and existing keys are unchanged. `project_id` becomes non-null, and its foreign key stops nulling on delete.
- [x] **Grants:**
  - Each team gets **member** on its generated project.
  - Each existing project gives its lead **project admin**, and gives **member** to every team that owned tickets in it.
  - Where the data has a team lead, they get **project admin** on their team's generated project.
- [x] **The `project_ownership` per-org flag exists and is off for every org.**
- [x] **Writes keep everything filled in while the flag is off:**
  - Creating a ticket takes a project from the request, otherwise the sprint's project, otherwise the actor's team project, otherwise `General`. It takes the next number and stores the key.
  - A team transfer also moves the ticket into the target team's project, with a new key and the old key as an alias.
  - Creating a sprint sets its project.
  - Visibility and ownership behaviour is unchanged.
- [x] **Keys are read from the stored column**, no longer worked out on each read. Ticket responses carry `ticket_key`, and `issue_key` keeps the same value for older clients.
- [x] **Migration test on real PostgreSQL** (prior art: the tasks schema-expand suite):
  1. Seed teams with and without sprints, project-less tickets, tickets in existing projects, tickets with no team, and sprints that mix projects.
  2. Assert one project per team plus `General`, the type rule, grants, a unique stored key on every ticket with existing keys unchanged, sprint majority, and migration moves aliased and listed.
  3. Re-run the migration and assert it changes nothing.
- [x] **Existing team-visibility, placement and capability suites still pass unchanged with the flag off.**
- [x] **Contracts:** the generated models, route snapshot and OpenAPI are updated. Contracts validation and the Android endpoint parity check pass.

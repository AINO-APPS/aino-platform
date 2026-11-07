# ADR-017: Projects own tickets; teams are groups of people

- **Status:** Accepted (supersedes ADR-013)
- **Date:** 2026-11-03
- **Related:** [ADR-013](ADR-013-ticket-team-ownership.md), [ADR-018](ADR-018-project-types.md)

## Context

ADR-013 made the team the owner of a ticket and the boundary for seeing it.
Projects only hand out ticket keys, and a ticket may have none. That fails in two
ways. Work that crosses teams has no natural home. And a ticket with no project
has no key, so GitHub can never link it. Jira-style tools solve both by making
the project the owner.

## Decision

Every ticket belongs to exactly one **project**. The project gives the ticket its
**ticket key**, board, backlog, workflow and visibility. Project access is granted
to users and teams, and teams become groups of people. The ticket key is stored on the
ticket and is unique within its organization. Moving a ticket to another project gives it a new key, and
renaming a project's key gives all its tickets new keys. Every earlier key is kept
as a permanent **alias** that still opens the ticket and still links code
references. Projects are **archived** (read-only, hidden from pickers), never
deleted, unless they have never had tickets. Even an emptied project retains
its ticket history marker and cannot be deleted; its keys remain reserved.

Each project has three **project roles**: project admin, member and viewer. A role
can be granted to a user or to a whole team. Super admins and HR admins see every
project. Creating a project requires the organization role **team lead or above**;
the creator becomes its project admin and may grant member access to teams.
A team can hold grants on any number of projects and is never tied to one.
Each project has its own workflow, initially copied from the organization's
current workflow template. Type-specific planning behavior follows in Phase 3.

## Consequences

- `projects` gains members/roles and becomes mandatory on `tasks`. The migration
  creates one project per existing team. It is Scrum if the team ever had a
  sprint, otherwise Task list. Admins see the generated keys and can rename them
  after migration and before switch-over publishes them. Tickets with no team
  go into a `General` project.
- Sprints move from team ownership to project ownership.
- Workflows move from one per org to one per project. Workflows per ticket type
  are deferred.
- Service Desk copies go to a Service Desk project chosen in org settings, or to
  `General` if none is set. Each copy gets a key, its status follows the Service
  Desk ticket, and deleting the Service Desk ticket cancels the copy instead of
  deleting it. An already Done copy stays Done and receives the history note.
- Visibility rules in `tasks.policy.ts`, ownership in `tasks.ownership.ts` and the
  "Unassigned" bucket are rewritten.
- Phase 2 ships behind the per-org `project_ownership` switch. Super admins
  review generated projects and publish keys once; platform admins alone may
  switch back in an emergency. ADR-013 remains the compatibility model while
  the switch is off. Legacy team scope, transfer and `issue_key` survive until
  the Phase 3 client-version gate.

## Alternatives considered

- **Keep teams as owners and give each team a key.** Rejected because one team
  could not run two streams of work, and work spanning several teams would still
  have no home.

## Implementation guidance

See [Projects](../PROJECTS.md) for role, alias, archive and switch-over behavior,
and [Service Desk](../SERVICE_DESK.md) for keyed copies and source lifecycle.

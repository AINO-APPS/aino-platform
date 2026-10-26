# ADR-013: Tickets are owned by exactly one team; team membership is the visibility boundary

- **Status:** Accepted
- **Date:** 2026-10-27
- **Related:** ADR-014 (workflow transition enforcement), `docs/TASKS_DESIGN_SPEC.md`, `.scratch/plan-jira-parity/spec.md`

## Context

Users belong to exactly one team (`users.team_id`), and sprints are team-owned
(`sprints.team_id`). Projects, however, are org-wide and have no team
(`projects` in `tenantSchema/integrations.ts`). The `tasks.team_id` column was
added and backfilled once by migration `0011` but **no insert or update path
writes it**, so it is normally `NULL`.

With no ticket-level ownership, list visibility has been inferred from authorship:

```sql
t.user_id = $me
OR t.assigned_to = $me
OR t.user_id IN (SELECT id FROM users WHERE team_id = $my_team)
```

That anchors visibility on **the creator's current team**, not the ticket's team.
Consequences observed in production:

- A ticket created by a manager, admin, or a person who later changed teams is
  invisible to the team that owns the work.
- A user with no team silently falls back to personal visibility and loses the
  Sprint tab and sprint list, with no explanation.
- Every surface invents its own rule. `/sprints/:id/tasks` returns all sprint
  tasks to anyone on the sprint's team; `/sprints` shows even org admins only
  their own team's sprints; search, export, notes and service-desk mirrors differ.

The product requirement is Jira's team-managed behaviour: members of a team see
the team's backlog, sprints and tickets regardless of who created or was assigned
them.

## Decision

**A ticket is owned by exactly one team, and team membership is the read/write
boundary for that ticket.**

1. `tasks.team_id` is authoritative. It is set on create from, in order: an
   explicit team chosen by an admin, the sprint's team, the creator's team. It is
   updated when a ticket is assigned to a sprint.
2. A ticket may enter a sprint only when `sprint.team_id = task.team_id`.
   Crossing teams is an explicit admin transfer, never a side effect of sprint
   assignment.
3. Visibility: members of the owning team read all of the team's tickets,
   backlog, sprints, history and comments; org admins read all org tickets and
   all sprints; non-members receive 403; users with no team read only tickets
   they created or are assigned, with an explicit banner.
4. Write authority: any owning-team member may create, edit, transition, assign,
   move and cancel the team's tickets. Only admins transfer teams or configure
   the workflow. There is no hard delete.
5. Legacy rows are backfilled once with
   `COALESCE(sprint.team_id, creator.team_id, assignee.team_id)`; sprint team wins
   conflicts. Remaining `NULL` rows are visible only in an admin Unassigned
   bucket. A team that still owns tickets or sprints cannot be deleted.
6. One server policy helper is used by every list, detail and export surface;
   inline per-endpoint predicates are removed.

## Consequences

### Positive

- The reported symptom disappears by construction: ownership is a property of
  the ticket, not of who happens to have created it.
- All surfaces can agree, because there is one policy and one data anchor.
- Admins can finally see and switch between teams' plans.
- Cross-team moves become auditable and deliberate.
- The model leaves room for multi-team membership or project ownership later.

### Negative / accepted trade-offs

- Existing rows with no sprint, no creator team and no assignee team remain
  unowned and are visible only to admins until assigned.
- Team deletion now requires prior transfer, which is an extra admin step.
- Some historical tickets may appear in a team's backlog for the first time after
  backfill; the conflict report must be reviewed before enabling the flag.
- The visibility change is gated by a per-org flag so rollout is reversible.

## Alternatives considered

- **Keep creator-team visibility.** Rejected: it is the reported bug, and it
  breaks whenever a ticket is created by someone outside the team.
- **Derive the team from the sprint, with no `tasks.team_id`.** Rejected:
  backlog tickets have no sprint, and a ticket moved between sprints would
  silently change owners.
- **Make projects team-owned and anchor on project.** Rejected for this round:
  projects are currently org-wide, and retrofitting ownership would be a larger
  migration with no product requirement yet.
- **Per-ticket ACLs or watchers.** Rejected: heavier than the requirement, and
  explicitly out of scope.

## Verification

- Visibility matrix tests across board, backlog, detail, history, comments,
  search, export, sprint and baseline surfaces.
- Every insert and sprint-move path sets `team_id`.
- Cross-team assignment rejected; admin transfer audited; team deletion blocked.

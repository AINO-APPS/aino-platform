# ADR-014: Workflow transitions are enforced server-side by the existing transitions table

- **Status:** Accepted
- **Date:** 2026-10-27
- **Related:** ADR-013 (ticket team ownership), `docs/TASKS_DESIGN_SPEC.md`, `.scratch/plan-jira-parity/spec.md`

## Context

Status is a single configurable concept: `tasks.workflow_state_id` referencing
`workflow_states`, which carries `category` (`open | in_progress | in_review |
done`), `is_initial`, `is_terminal`, WIP limit and order. The legacy `tasks.status`
column was dropped in `0015`.

A `workflow_transitions` table (`from_state_id`, `to_state_id`, `required_role`)
was created alongside it in migration `0002` and declared in the TypeScript tenant
schema — but **no application code reads or writes it**. In practice any state can
move to any other state.

What is enforced today is scattered and inconsistent:

- access and actor permission (assignee, reporter or org admin);
- the destination state must exist, belong to the org and be active;
- sprint freeze;
- WIP limit on `PATCH /:id/status` only, not on `PUT` or bulk;
- `completed_at` derived by a database trigger.

The product requirement is a Jira-like lifecycle: a ticket moves through a defined
workflow, illegal moves are refused, and WIP limits mean something.

## Decision

**The `workflow_transitions` table is the authoritative state machine, enforced
server-side on every status write.**

1. A migration seeds transitions for the default states and derives them for
   custom states from category and `sort_order`. The seed is idempotent.
2. Default graph: To Do → In Progress; In Progress → In Review, To Do, Done; In
   Review → In Progress, Done; Done → In Progress (reopen); any active state →
   Cancelled; Cancelled is terminal. Done cannot be cancelled without reopening.
3. One helper validates transition legality and WIP capacity. It is used by
   `PATCH /:id/status`, `PUT /:id`, bulk status/move and the cancel path.
   Creation is exempt because there is no from-state.
4. WIP limits hard-block consistently and return `409 WIP_EXCEEDED`; the board
   disables over-limit targets. There is no "allow anyway" path.
5. Cancelled becomes a stable seeded terminal state (`key = 'cancelled'`,
   category `done`), not a lazily created special case. It has no board column and
   no outgoing transitions. Cancellation remains cancel-not-delete.
6. Bulk operations apply valid tickets and report skipped ones per ticket,
   rather than failing the batch.
7. Transitions write history and audit, notify the assignee and reporter (unless
   they are the actor), and broadcast realtime updates to the owning team.

## Consequences

### Positive

- The board, detail view, API and bulk operations share one rule set.
- WIP limits become trustworthy instead of advisory on one endpoint.
- Cancelled and Done stop being conflated; reporting can distinguish them.
- The unused table becomes the extension point for a future workflow editor.
- Illegal transitions fail loudly with a stable code instead of silently
  corrupting state.

### Negative / accepted trade-offs

- Existing orgs may have custom states with no obvious edges; the category-based
  derivation must preserve every path they use today. The migration is
  conservative: within-category moves and one-step category moves remain legal.
- Workflow configuration changes must now consider transitions; deleting a state
  can orphan edges. The existing category-coverage guard is extended.
- More write-path tests are required, and every new status surface must call the
  helper rather than update the column directly.

## Alternatives considered

- **Client-side-only validation.** Rejected: API and bulk callers would bypass
  it, and the board is not the only writer.
- **Hard-code the five states and graph.** Rejected: statuses are already
  per-org configurable; hardcoding would break existing custom states.
- **Category-only rules with no transition table.** Rejected: it cannot express
  deliberate exceptions or a future editor, and the table already exists.
- **Keep WIP as a warning.** Rejected: the requirement is a real lifecycle, and
  the current patch-only enforcement is inconsistent.
- **Hard delete instead of Cancelled.** Rejected: destroys history and conflicts
  with the existing cancel-not-delete decision.

## Verification

- Transition matrix tests through PATCH, PUT, bulk and cancel for every legal and
  illegal pair, including custom states.
- WIP tests on each write path; board target disabled.
- Cancelled terminality and Done/Cancelled distinction.
- Notification and realtime fan-out tests.

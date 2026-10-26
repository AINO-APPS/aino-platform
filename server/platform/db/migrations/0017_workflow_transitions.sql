-- Enforce the ticket lifecycle: a stable Cancelled state and the transition
-- graph every write path validates against.
--
-- Idempotent and safe to re-run. It seeds:
--
--   1. A per-org `cancelled` state (category `done`, terminal) next to the
--      existing terminal states. An org that already created one keeps its
--      name, colour and order; only the terminal invariants are enforced.
--
--   2. Transition rows derived from the workflow categories (spec §5.3):
--        * within a category: every direction;
--        * forward or backward to the adjacent category;
--        * to any Done state from any state except the initial one;
--        * from Done, reopen into the first in_progress state;
--        * from any non-terminal state to Cancelled;
--        * Cancelled has no outgoing edge.
--
--      For the default states this reproduces the spec's default matrix:
--        New → In Progress;
--        In Progress → New, In Review, Done;
--        In Review → In Progress, Done;
--        Done → In Progress;
--        any non-terminal → Cancelled; Done is never cancelled directly.
--
--      Custom states get the same rules, so no state becomes a dead end.

-- Reuse an existing terminal state that is only named "Cancelled" (a tenant
-- may have created one under another key). Renaming it instead of inserting a
-- second row keeps one canonical cancelled state, so the lazy lookup and the
-- seeded edges can never disagree about which row a cancellation targets.
UPDATE workflow_states ws
   SET key = 'cancelled'
 WHERE ws.is_active = TRUE
   AND ws.is_terminal = TRUE
   AND ws.key <> 'cancelled'
   AND LOWER(ws.name) = 'cancelled'
   AND NOT EXISTS (
       SELECT 1 FROM workflow_states existing
        WHERE existing.org_id = ws.org_id AND existing.key = 'cancelled'
   );

INSERT INTO workflow_states (org_id, key, name, category, color, sort_order, is_initial, is_terminal)
SELECT o.id,
       'cancelled',
       'Cancelled',
       'done',
       '#6b7280',
       COALESCE((SELECT MAX(s.sort_order) FROM workflow_states s WHERE s.org_id = o.id), 0) + 1,
       FALSE,
       TRUE
  FROM organizations o
ON CONFLICT (org_id, key) DO UPDATE
   -- Keep the invariant Cancelled is a terminal Done-category state. An org
   -- that already created one lazily keeps its name, colour and order.
   SET category = 'done',
       is_terminal = TRUE,
       is_active = TRUE;

WITH ranked AS (
    SELECT id,
           org_id,
           key,
           category,
           is_initial,
           is_terminal,
           sort_order,
           CASE category
               WHEN 'open' THEN 0
               WHEN 'in_progress' THEN 1
               WHEN 'in_review' THEN 2
               WHEN 'done' THEN 3
           END AS rank
      FROM workflow_states
     WHERE is_active = TRUE
),
first_in_progress AS (
    SELECT DISTINCT ON (org_id) org_id, id
      FROM ranked
     WHERE category = 'in_progress'
     ORDER BY org_id, sort_order ASC, id ASC
),
edges AS (
    SELECT f.org_id, f.id AS from_state_id, t.id AS to_state_id
      FROM ranked f
      JOIN ranked t
        ON t.org_id = f.org_id
       AND t.id <> f.id
      LEFT JOIN first_in_progress ip ON ip.org_id = f.org_id
     WHERE f.key <> 'cancelled' -- Cancelled is terminal: no outgoing edge.
       AND CASE
               WHEN t.key = 'cancelled' THEN
                   f.is_terminal = FALSE AND f.category <> 'done'
               WHEN f.category = 'done' THEN
                   t.category = 'done' OR (t.category = 'in_progress' AND t.id = ip.id)
               WHEN f.category = t.category THEN
                   TRUE
               WHEN t.rank = f.rank + 1 OR t.rank = f.rank - 1 THEN
                   TRUE
               WHEN t.category = 'done' AND (f.rank >= 1 OR f.is_initial = FALSE) THEN
                   TRUE
               ELSE
                   FALSE
           END
)
INSERT INTO workflow_transitions (org_id, from_state_id, to_state_id)
SELECT org_id, from_state_id, to_state_id
  FROM edges
ON CONFLICT (from_state_id, to_state_id) DO NOTHING;

-- Make `tasks.team_id` authoritative for ticket visibility.
--
-- Before this migration the column existed (0011) but nothing wrote it, and
-- list visibility was inferred from the creator's *current* team. This
-- backfill gives every determinable ticket a real owner. It is idempotent and
-- safe to re-run:
--
--   * only rows with `team_id IS NULL` are touched;
--   * the sprint's team wins over the creator's, which wins over the
--     assignee's;
--   * rows with no derivable team stay NULL and surface only in the admin
--     Unassigned bucket — the statement never blocks on NULL.
--
-- Conflicts (sprint team different from creator team) are recorded once in
-- `task_team_backfill_conflicts` so an admin can review them before turning on
-- the `team_visibility` feature flag.

-- Defensive: 0011 already adds this column, but a fresh tenant may reach here
-- through a different path.
ALTER TABLE tasks
    ADD COLUMN IF NOT EXISTS team_id INTEGER REFERENCES teams(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS task_team_backfill_conflicts (
    task_id          INTEGER PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
    sprint_id        INTEGER,
    sprint_team_id   INTEGER,
    creator_team_id  INTEGER,
    assignee_team_id INTEGER,
    detected_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Record ownership conflicts for review. Re-runs do not duplicate rows.
INSERT INTO task_team_backfill_conflicts
    (task_id, sprint_id, sprint_team_id, creator_team_id, assignee_team_id)
SELECT t.id,
       t.sprint_id,
       s.team_id,
       creator.team_id,
       assignee.team_id
  FROM tasks t
  JOIN sprints s      ON s.id = t.sprint_id
  LEFT JOIN users creator  ON creator.id = t.user_id
  LEFT JOIN users assignee ON assignee.id = t.assigned_to
 WHERE s.team_id IS DISTINCT FROM creator.team_id
ON CONFLICT (task_id) DO NOTHING;

DO $do$
DECLARE
    conflict_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO conflict_count FROM task_team_backfill_conflicts;
    IF conflict_count > 0 THEN
        RAISE NOTICE 'tasks team backfill: % ticket(s) had a sprint team different from the creator team; the sprint team wins', conflict_count;
    ELSE
        RAISE NOTICE 'tasks team backfill: no sprint/creator team conflicts';
    END IF;
END
$do$;

-- Sprint team wins; then the creator's current team; then the assignee's.
WITH resolved AS (
    SELECT t.id,
           COALESCE(s.team_id, creator.team_id, assignee.team_id) AS resolved_team_id
      FROM tasks t
      LEFT JOIN sprints s      ON s.id = t.sprint_id
      LEFT JOIN users creator  ON creator.id = t.user_id
      LEFT JOIN users assignee ON assignee.id = t.assigned_to
     WHERE t.team_id IS NULL
)
UPDATE tasks t
   SET team_id = resolved.resolved_team_id
  FROM resolved
 WHERE resolved.id = t.id
   AND resolved.resolved_team_id IS NOT NULL;

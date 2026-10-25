/**
 * Daily burndown snapshots.
 *
 * One row per sprint × day, upserted so re-running the sweep on the same day is
 * idempotent. Used by the sprint start/complete flows and the daily job.
 */
export async function snapshotBurndown(db: any, sprintId: number): Promise<void> {
    const tasks = (await db.query(
        `SELECT t.story_points, ws.is_terminal, t.is_blocked
           FROM tasks t
           LEFT JOIN workflow_states ws ON ws.id = t.workflow_state_id
          WHERE t.sprint_id = $1`,
        [sprintId],
    )).rows;

    const num = (v: any) => (v == null ? 0 : Number(v));
    let total = 0;
    let done = 0;
    let blocked = 0;
    let openCount = 0;
    for (const t of tasks) {
        const sp = num(t.story_points);
        total += sp;
        if (t.is_terminal) done += sp;
        else openCount += 1;
        if (t.is_blocked) blocked += sp;
    }
    const remaining = total - done;

    await db.query(
        `INSERT INTO sprint_burndown_snapshots (sprint_id, snapshot_date, total_points, done_points, remaining_points, blocked_points, open_tasks)
         VALUES ($1, CURRENT_DATE, $2, $3, $4, $5, $6)
         ON CONFLICT (sprint_id, snapshot_date)
         DO UPDATE SET total_points = EXCLUDED.total_points,
                       done_points = EXCLUDED.done_points,
                       remaining_points = EXCLUDED.remaining_points,
                       blocked_points = EXCLUDED.blocked_points,
                       open_tasks = EXCLUDED.open_tasks`,
        [sprintId, total, done, remaining, blocked, openCount],
    );
}

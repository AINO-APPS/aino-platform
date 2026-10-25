/**
 * Daily burndown snapshots.
 *
 * One row per sprint × day, upserted so re-running the sweep on the same day is
 * idempotent. Used by the sprint start/complete flows and the daily job.
 */
const { findSprintBurndownInputs, upsertBurndownSnapshot } = require("../../modules/tasks/tasks.sprintRepository");

export async function snapshotBurndown(db: any, sprintId: number): Promise<void> {
    const tasks = await findSprintBurndownInputs(db, sprintId);

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

    await upsertBurndownSnapshot(db, sprintId, {
        total,
        done,
        remaining: total - done,
        blocked,
        openTasks: openCount,
    });
}

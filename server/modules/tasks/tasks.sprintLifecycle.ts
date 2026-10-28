/**
 * Sprint lifecycle rules.
 *
 * A completed sprint is immutable: no task edits, moves or re-opening. The one
 * writable artefact is the retrospective. Paused sprints are presented and
 * counted as active everywhere.
 */

export interface SprintLike {
    id: number | string;
    status?: string | null;
    team_id?: number | string | null;
}

/** A sprint that accepts no task writes. */
export function isSprintFrozen(sprint: SprintLike | null | undefined): boolean {
    return sprint?.status === "completed";
}

/** Paused sprints count as active for planning and charts. */
export function isSprintActive(sprint: SprintLike | null | undefined): boolean {
    return sprint?.status === "active" || sprint?.status === "paused";
}

/** The status a client should display for a sprint. */
export function displaySprintStatus(sprint: SprintLike | null | undefined): string {
    if (!sprint) return "unknown";
    return isSprintActive(sprint) ? "active" : (sprint.status ?? "unknown");
}

export interface CarryoverTask {
    id: number | string;
    title?: string;
    story_points?: number | null;
    completed?: boolean;
}

/** Database port for the sprint lifecycle queries. */
export interface SprintDb {
    query(sql: string, params?: unknown[]): Promise<{ rows: any[]; rowCount: number }>;
}

/** The ids among `sprintIds` that are completed, i.e. frozen. */
export async function findFrozenSprintIds(db: SprintDb, sprintIds: number[]): Promise<number[]> {
    if (sprintIds.length === 0) return [];
    return (await db.query(
        `SELECT id FROM sprints WHERE id = ANY($1::int[]) AND status = 'completed'`,
        [sprintIds],
    )).rows.map((row: { id: number }) => row.id);
}

export interface CarryoverPlan {
    /** Unfinished work that will move. */
    moving: CarryoverTask[];
    /** Finished work that stays with the closed sprint. */
    staying: CarryoverTask[];
    /** Where the unfinished work goes: a sprint id, or "backlog". */
    target: number | string | "backlog";
    movingPoints: number;
}

/**
 * Decide what happens when a sprint completes.
 *
 * The default target is the next planned sprint, otherwise the backlog. Done
 * items always stay with the sprint they finished in and are never carried.
 */
export function planCarryover(
    tasks: CarryoverTask[],
    nextPlannedSprintId: number | string | null,
    override?: number | string | "backlog" | null,
): CarryoverPlan {
    const moving = tasks.filter((task) => !task.completed);
    const staying = tasks.filter((task) => task.completed);
    const target = override ?? nextPlannedSprintId ?? "backlog";

    return {
        moving,
        staying,
        target,
        movingPoints: moving.reduce((sum, task) => sum + (Number(task.story_points) || 0), 0),
    };
}

/** Longest time a sprint may stay paused. */
export const MAX_SPRINT_PAUSE_DAYS = 14;

export interface RunningSprint {
    id: number;
    name: string;
}

export interface SprintDbLike {
    query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }>;
}

/**
 * One active sprint per team.
 *
 * `start`, `PUT status=active` and `resume` all activate a sprint, so they all
 * ask here first. A paused sprint is not running, so it never blocks another
 * from starting; the resume of a paused sprint is refused while one runs.
 */
export async function findOtherActiveSprint(
    db: SprintDbLike,
    teamId: unknown,
    exceptSprintId: unknown,
): Promise<RunningSprint | null> {
    const rows = (await db.query(
        "SELECT id, name FROM sprints WHERE team_id = $1 AND status = 'active' AND id != $2 LIMIT 1",
        [teamId, exceptSprintId],
    )).rows;
    return rows[0] ?? null;
}

/** The 409 body every activation path returns. */
export function sprintAlreadyActiveBody(running: RunningSprint) {
    return {
        error: `${running.name} is still active. Complete it before starting another sprint.`,
        code: "SPRINT_ALREADY_ACTIVE" as const,
        active_sprint_id: running.id,
    };
}

/**
 * Activate a sprint and record what it committed.
 *
 * Callers resolve the sprint, check access and ask `findOtherActiveSprint`
 * first; this owns the two writes plus the baseline, so `start` and any future
 * activation path cannot record different baselines.
 */
export async function activateSprint(
    db: SprintDbLike & { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount?: number }> },
    sprintId: unknown,
    commit: (tasks: Array<{ id: number; story_points: number | null }>) => {
        committed_points: number;
        committed_task_ids: number[];
    },
): Promise<void> {
    await db.query(
        "UPDATE sprints SET status = 'active', started_at = COALESCE(started_at, NOW()) WHERE id = $1",
        [sprintId],
    );
    const tasks = (await db.query("SELECT id, story_points FROM tasks WHERE sprint_id = $1", [sprintId])).rows;
    const baseline = commit(tasks as Array<{ id: number; story_points: number | null }>);
    await db.query(
        "INSERT INTO sprint_baselines (sprint_id, committed_points, committed_task_ids, reason) VALUES ($1, $2, $3::jsonb, 'start')",
        [sprintId, baseline.committed_points, JSON.stringify(baseline.committed_task_ids)],
    );
}

/**
 * The end date a resumed sprint gets: the original deadline pushed out by the
 * whole days it sat paused, so the team keeps its full working window.
 */
export function resumedEndDate(endDate: string, pausedAt: string | Date | null | undefined, now = new Date()): string {
    if (!pausedAt) return String(endDate).slice(0, 10);
    const pausedDays = Math.max(0, Math.floor((now.getTime() - new Date(pausedAt).getTime()) / 86400000));
    return new Date(new Date(endDate).getTime() + pausedDays * 86400000).toISOString().slice(0, 10);
}

export interface ActivationDeps {
    db: SprintDbLike;
    tenantId: unknown;
    invalidateActiveSprint: (tenantId: unknown, teamId: unknown) => Promise<unknown>;
    snapshotBurndown: (db: SprintDbLike, sprintId: number) => Promise<unknown>;
    notifyStarted: (sprint: any) => Promise<unknown>;
    commit: (tasks: Array<{ id: number; story_points: number | null }>) => {
        committed_points: number;
        committed_task_ids: number[];
    };
}

/** Why a sprint cannot be activated, or null when it can. */
export function activationRefusal(sprint: { status?: string | null }): { status: number; body: { error: string } } | null {
    if (sprint.status === "active") return { status: 400, body: { error: "Sprint is already active" } };
    if (sprint.status === "completed") return { status: 400, body: { error: "Cannot restart a completed sprint" } };
    return null;
}

/**
 * Start a sprint: the one-active rule, the activation write, the committed
 * baseline, the burndown snapshot, the cache invalidation and the team
 * notification, in the order the team sees them.
 */
export async function startSprint(
    deps: ActivationDeps,
    sprint: { id: unknown; team_id: unknown; status?: string | null },
): Promise<{ sprint?: any; error?: { status: number; body: Record<string, unknown> } }> {
    const refusal = activationRefusal(sprint);
    if (refusal) return { error: refusal };
    const running = await findOtherActiveSprint(deps.db, sprint.team_id, sprint.id);
    if (running) return { error: { status: 409, body: sprintAlreadyActiveBody(running) } };
    await activateSprint(deps.db, sprint.id, deps.commit);
    await deps.snapshotBurndown(deps.db, parseInt(String(sprint.id), 10));
    await deps.invalidateActiveSprint(deps.tenantId, sprint.team_id);
    await deps.notifyStarted(sprint);
    return { sprint };
}

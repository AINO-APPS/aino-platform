/**
 * Sprint lifecycle scheduler.
 *
 * Industry-standard automated sprint cadence. For every team that has opted
 * into AUTO mode (`teams.sprint_mode = 'auto'`) and configured a duration +
 * start date, this engine keeps a single `active` sprint row in lock-step with
 * the configured cadence:
 *
 *   1. Computes the current sprint window from `sprint_start_date` +
 *      `sprint_duration_weeks` (the same math the read-only sprint-config
 *      endpoint used to surface, now made authoritative).
 *   2. Ensures the current window's sprint row EXISTS and is `active`
 *      (auto-creating it the first time the window opens).
 *   3. When the previous auto sprint's window has ended, it:
 *        - takes a final burndown snapshot,
 *        - computes velocity (= completed story points),
 *        - marks it `completed`,
 *        - ROLLS incomplete (non-terminal) tickets into the NEW sprint,
 *          stamping `tasks.carried_over_from_sprint_id` so Sprint Insights can
 *          show a "Carried Forward" list that links back to the origin sprint,
 *        - links the new sprint via `carried_from_sprint_id`.
 *   4. Teams that are PAUSED (`teams.sprint_paused = true`) or in MANUAL mode
 *      are skipped entirely — manual lifecycle stays under human control.
 *
 * The job is idempotent and concurrency-safe: it keys auto sprints by
 * `(team_id, sprint_number)` (unique index) so a double-run can never create
 * duplicate windows.
 *
 * Exposed as `runSprintLifecycle({ db, tenantId })` so it can be driven by the
 * background job runner (per tenant) and unit-tested directly with a mock db.
 */
import { logger } from "../utils/logger";
import { snapshotBurndown } from "../modules/tasks/tasks.sprintRepository";
import { realtimeEffects } from "../modules/tasks/tasks.placementEffects";
import { completeSprint } from "./sprintCompletion";
import type { PlacementDb } from "../modules/tasks/tasks.placement";
import type { TransactionContext } from "../types/domain";

interface Db extends PlacementDb {
    transaction<T>(
        callback: (client: PlacementDb, context: TransactionContext) => Promise<T>,
    ): Promise<T>;
}

const DAY_MS = 86400000;

/** Parse a YYYY-MM-DD string into a UTC-midnight epoch ms. */
function parseDateUTC(dateStr: string): number {
    const [y, m, d] = dateStr.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
}

/** Format an epoch ms as YYYY-MM-DD (UTC). */
function fmtDateUTC(ms: number): string {
    const d = new Date(ms);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

export interface SprintWindow {
    number: number;
    startDate: string;
    endDate: string;
    durationWeeks: number;
    /** Days remaining until the end of this window (>= 0). */
    daysRemaining: number;
}

/**
 * Compute the sprint window that contains `today` for a team configured with
 * `startDate` (YYYY-MM-DD) and `durationWeeks`. Sprint numbers are 1-based.
 * If today is before the configured start date, returns window #1 (the upcoming
 * sprint) so the scheduler can pre-create it.
 */
export function computeCurrentWindow(startDate: string, durationWeeks: number, today: string): SprintWindow {
    const durationDays = Math.max(1, durationWeeks) * 7;
    const startMs = parseDateUTC(startDate);
    const todayMs = parseDateUTC(today);
    const daysSinceStart = Math.floor((todayMs - startMs) / DAY_MS);
    const number = daysSinceStart < 0 ? 1 : Math.floor(daysSinceStart / durationDays) + 1;
    const windowStartMs = startMs + (number - 1) * durationDays * DAY_MS;
    const windowEndMs = windowStartMs + (durationDays - 1) * DAY_MS;
    return {
        number,
        startDate: fmtDateUTC(windowStartMs),
        endDate: fmtDateUTC(windowEndMs),
        durationWeeks,
        daysRemaining: Math.max(0, Math.ceil((windowEndMs - todayMs) / DAY_MS)),
    };
}

/**
 * Complete an auto sprint: snapshot, compute velocity, mark completed, and roll
 * incomplete tickets into `nextSprintId` (stamping carry-over provenance).
 * Returns the number of tickets rolled over.
 */
async function completeAndRollover(
    db: Db,
    sprintId: number,
    nextSprintId: number,
    orgId: number | null,
    tenantId?: number | null,
): Promise<number> {
    const result = await completeSprint(db, {
        sprintId,
        targetSprintId: nextSprintId,
        orgId,
        effects: realtimeEffects({ db: db as any, tenantId }),
    });
    return result?.rolledOver ?? 0;
}

/**
 * Ensure the auto sprint for `window` exists and is active for a team, rotating
 * the previous active sprint if the window has advanced. Returns the active
 * sprint id (or null if nothing changed and there was no existing row to make
 * active — should not happen in practice).
 */
async function reconcileTeam(
    db: Db,
    team: { id: number; org_id: number | null; sprint_duration_weeks: number; sprint_start_date: string },
    today: string,
    tenantId?: number | null,
): Promise<{ activeSprintId: number | null; transitioned: boolean }> {
    const window = computeCurrentWindow(team.sprint_start_date, team.sprint_duration_weeks, today);

    // Is there already an auto sprint row for this window?
    let current = (await db.query(
        `SELECT * FROM sprints WHERE team_id = $1 AND sprint_number = $2 AND auto_managed = TRUE`,
        [team.id, window.number]
    )).rows[0];

    // Find any currently-active auto sprint for the team (could be a previous
    // window that needs completing).
    const activePrev = (await db.query(
        `SELECT * FROM sprints
          WHERE team_id = $1 AND auto_managed = TRUE AND status = 'active'
          ORDER BY sprint_number DESC LIMIT 1`,
        [team.id]
    )).rows[0];

    let transitioned = false;

    if (!current) {
        // Create the current-window sprint as planned. We'll set carry origin
        // below if we roll a previous sprint into it.
        const name = `Sprint ${window.number}`;
        const inserted = (await db.query(
            `INSERT INTO sprints (team_id, name, start_date, end_date, status, auto_managed, sprint_number)
             VALUES ($1, $2, $3, $4, 'planned', TRUE, $5)
             ON CONFLICT (team_id, sprint_number) WHERE sprint_number IS NOT NULL DO NOTHING
             RETURNING *`,
            [team.id, name, window.startDate, window.endDate, window.number]
        )).rows[0];
        // If the ON CONFLICT no-op fired (race), re-read.
        current = inserted || (await db.query(
            `SELECT * FROM sprints WHERE team_id = $1 AND sprint_number = $2 AND auto_managed = TRUE`,
            [team.id, window.number]
        )).rows[0];
    }

    if (!current) {
        return { activeSprintId: activePrev ? activePrev.id : null, transitioned: false };
    }

    // If a previous auto sprint is still active and it's NOT the current window,
    // complete + roll it into the current window's sprint.
    if (activePrev && activePrev.id !== current.id && activePrev.sprint_number < window.number) {
        await completeAndRollover(db, activePrev.id, current.id, team.org_id, tenantId);
        transitioned = true;
    }

    // Activate the current window's sprint if it isn't already active. We don't
    // touch sprints the user manually paused — but a paused team is filtered
    // out before we get here, so any non-active current sprint should start.
    if (current.status === "planned") {
        await db.query(
            `UPDATE sprints SET status = 'active', started_at = COALESCE(started_at, NOW()) WHERE id = $1`,
            [current.id]
        );
        await snapshotBurndown(db, current.id, team.org_id);
        transitioned = true;
    }

    return { activeSprintId: current.id, transitioned };
}

/**
 * Run the sprint lifecycle for a single tenant DB. Invalidates the active-sprint
 * cache for any team that transitioned so the board "Active" label refreshes.
 */
export async function runSprintLifecycle(
    ctx: { db: Db; tenantId?: number | null },
    redisLike?: { invalidateActiveSprint: (tenantId: number | null | undefined, teamId: number) => Promise<void> },
): Promise<{ teamsProcessed: number; transitions: number }> {
    const { db, tenantId } = ctx;
    const today = new Date().toISOString().slice(0, 10);

    const teams = (await db.query(
        `SELECT id, org_id, sprint_duration_weeks, sprint_start_date
           FROM teams
          WHERE sprint_mode = 'auto'
            AND sprint_paused = FALSE
            AND sprint_start_date IS NOT NULL
            AND sprint_start_date <> ''`
    )).rows;

    let transitions = 0;
    for (const team of teams) {
        try {
            const { transitioned } = await reconcileTeam(db, team, today, tenantId);
            if (transitioned) {
                transitions++;
                if (redisLike) {
                    await redisLike.invalidateActiveSprint(tenantId, team.id).catch(() => { /* best-effort */ });
                }
            }
        } catch (err: any) {
            logger.warn({ err: err.message, teamId: team.id, tenantId }, "Sprint lifecycle reconcile failed for team");
        }
    }

    return { teamsProcessed: teams.length, transitions };
}

export const __test__ = { snapshotBurndown, completeAndRollover, reconcileTeam, parseDateUTC, fmtDateUTC };
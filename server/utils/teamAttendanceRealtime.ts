/**
 * `team_attendance_update` fan-out: when a user's attendance changes (clock
 * in/out, breaks, manual entries, deleted entries) their direct manager and
 * resolved approver get `{ userId, action }` so Team Attendance views refresh
 * live. Delivery is tenant-scoped via sendToUser and strictly best-effort.
 */
const { sendToUser } = require("../realtime/fanout");
import { findApprover } from "./approver";

interface DbLike {
    query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }>;
}

export type TeamAttendanceAction =
    | "clock_in"
    | "clock_out"
    | "break_start"
    | "break_end"
    | "manual_entry"
    | "work_mode_request"
    | "entry_deleted";

export async function emitTeamAttendanceUpdate(
    db: DbLike | null | undefined,
    tenantId: number | null | undefined,
    userId: number | null | undefined,
    action: TeamAttendanceAction,
): Promise<void> {
    if (!db || !userId) return;
    try {
        const user = (await db.query("SELECT manager_id, org_id FROM users WHERE id = $1", [userId])).rows[0];
        if (!user) return;
        const approver = await findApprover(db, userId, user.org_id ?? null).catch(() => null);
        const recipients = new Set<number>();
        for (const id of [user.manager_id, approver?.id]) {
            const n = Number(id);
            if (id && Number.isFinite(n) && n !== Number(userId)) recipients.add(n);
        }
        for (const id of recipients) {
            sendToUser(tenantId, id, "team_attendance_update", { userId: Number(userId), action });
        }
    } catch {
        /* best-effort — never fail the attendance action */
    }
}

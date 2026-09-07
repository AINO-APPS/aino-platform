/**
 * Attendance persistence boundary.
 *
 * This is the only file in the module that contains SQL. It has no knowledge
 * of Express, Request, Response, cookies or status codes.
 */
import type { AttendanceDb, CreateOvertimeInput, Theme } from "./attendance.types";

export async function hasPendingOvertime(
    db: AttendanceDb,
    userId: number,
    date: string,
): Promise<boolean> {
    const result = await db.query(
        `SELECT id FROM approval_requests
         WHERE requester_id = $1 AND type = 'overtime' AND status = 'pending'
           AND metadata::jsonb->>'date' = $2`,
        [userId, date],
    );
    return result.rowCount > 0;
}

export async function insertOvertimeRequest(
    db: AttendanceDb,
    actor: { userId: number; orgId: number | null },
    approverId: number | null,
    input: CreateOvertimeInput,
): Promise<void> {
    await db.query(
        `INSERT INTO approval_requests
            (org_id, requester_id, approver_id, type, reference_id, reason, metadata)
         VALUES ($1,$2,$3,'overtime',NULL,$4,$5)`,
        [actor.orgId, actor.userId, approverId, input.reason,
            JSON.stringify({ date: input.date, hours: input.hours })],
    );
}

export async function getUserDisplayName(db: AttendanceDb, userId: number): Promise<string> {
    const row = (await db.query("SELECT full_name FROM users WHERE id = $1", [userId])).rows[0];
    return row?.full_name || "A team member";
}

export async function insertOvertimeNotification(
    db: AttendanceDb,
    approverId: number,
    requesterName: string,
    input: CreateOvertimeInput,
): Promise<void> {
    await db.query(
        "INSERT INTO notifications (user_id, type, title, body) VALUES ($1, $2, $3, $4)",
        [approverId, "approval", "Overtime Request",
            `${requesterName} requested ${input.hours}h overtime for ${input.date}.`],
    );
}

export async function listOvertimeRequests(db: AttendanceDb, userId: number): Promise<any[]> {
    return (await db.query(
        `SELECT ar.id, ar.status, ar.reason, ar.metadata, ar.created_at, ar.reject_reason,
                u.full_name as approver_name
         FROM approval_requests ar
         LEFT JOIN users u ON u.id = ar.approver_id
         WHERE ar.requester_id = $1 AND ar.type = 'overtime'
         ORDER BY ar.created_at DESC
         LIMIT 50`,
        [userId],
    )).rows;
}

export async function getUserTheme(db: AttendanceDb, userId: number): Promise<Theme> {
    const row = (await db.query("SELECT theme FROM users WHERE id = $1", [userId])).rows[0];
    return row?.theme === "light" ? "light" : "dark";
}

export async function updateUserTheme(db: AttendanceDb, userId: number, theme: Theme): Promise<void> {
    await db.query("UPDATE users SET theme = $1 WHERE id = $2", [theme, userId]);
}

export async function listTimeEntriesForDateRange(
    db: AttendanceDb,
    userId: number,
    fromDate: string,
    toDate: string,
    timezoneModifier: string,
    excludeRejected = false,
): Promise<any[]> {
    // PostgreSQL interprets $4 as an interval value; no SQL interpolation of
    // user input is needed in the module repository.
    return (await db.query(
        `SELECT * FROM time_entries
         WHERE user_id = $1
           AND (timestamp + $4::interval)::date BETWEEN $2::date AND $3::date
           ${excludeRejected ? "AND (approval_status IS NULL OR approval_status != 'rejected')" : ""}
         ORDER BY timestamp ASC`,
        [userId, fromDate, toDate, timezoneModifier],
    )).rows;
}

export async function listTasksForDate(
    db: AttendanceDb,
    userId: number,
    date: string,
): Promise<any[]> {
    return (await db.query(
        `SELECT * FROM tasks
         WHERE (user_id = $1 OR assigned_to = $1) AND date = $2
         ORDER BY priority DESC, created_at ASC`,
        [userId, date],
    )).rows;
}

export async function getUserOrgId(db: AttendanceDb, userId: number): Promise<number | null> {
    return (await db.query("SELECT org_id FROM users WHERE id = $1", [userId])).rows[0]?.org_id || null;
}

export async function getOrgWorkConfig(db: AttendanceDb, orgId: number | null) {
    if (!orgId) return { work_hours_per_day: 8, work_days: "1,2,3,4,5", min_hours_present: null };
    return (await db.query(
        "SELECT work_hours_per_day, work_days, min_hours_present FROM organizations WHERE id = $1",
        [orgId],
    )).rows[0] || { work_hours_per_day: 8, work_days: "1,2,3,4,5", min_hours_present: null };
}

export async function listEntriesForLocalDay(
    db: AttendanceDb,
    userId: number,
    date: string,
    timezoneModifier: string,
): Promise<any[]> {
    return (await db.query(
        `SELECT * FROM time_entries
         WHERE user_id = $1 AND (timestamp + $3::interval)::date = $2::date
           AND (approval_status IS NULL OR approval_status != 'rejected')
         ORDER BY timestamp ASC, id ASC`,
        [userId, date, timezoneModifier],
    )).rows;
}

export async function autoClockOutIfOpen(
    db: AttendanceDb,
    userId: number,
    date: string,
    timezoneModifier: string,
): Promise<boolean> {
    if (!db.transaction) throw new Error("Attendance transaction is unavailable");
    return db.transaction(async (client) => {
        const latest = (await client.query(
            `SELECT entry_type FROM time_entries
             WHERE user_id = $1 AND (timestamp + $3::interval)::date = $2::date
             ORDER BY timestamp DESC, id DESC LIMIT 1 FOR UPDATE`,
            [userId, date, timezoneModifier],
        )).rows[0];
        if (!latest || latest.entry_type === "clock_out") return false;
        await client.query(
            "INSERT INTO time_entries (user_id, entry_type) VALUES ($1, $2)",
            [userId, "clock_out"],
        );
        return true;
    });
}

export async function listRecentEntries(
    db: AttendanceDb,
    userId: number,
    today: string,
    timezoneModifier: string,
): Promise<any[]> {
    return (await db.query(
        `SELECT * FROM time_entries
         WHERE user_id = $1
           AND (timestamp + $3::interval)::date >= ($2::date - INTERVAL '30 days')
           AND (approval_status IS NULL OR approval_status != 'rejected')
         ORDER BY timestamp ASC`,
        [userId, today, timezoneModifier],
    )).rows;
}

export async function listApprovedLeaveDates(
    db: AttendanceDb,
    userId: number,
    today: string,
): Promise<string[]> {
    return (await db.query(
        `SELECT date FROM leaves
         WHERE user_id = $1 AND status = 'approved'
           AND date::date >= $2::date - INTERVAL '60 days'
           AND date::date <= $2::date`,
        [userId, today],
    )).rows.map((row) => row.date);
}

export async function appendBreakTransition(
    db: AttendanceDb,
    userId: number,
    date: string,
    timezoneModifier: string,
    transition: "break_start" | "break_end",
): Promise<{ error?: string }> {
    if (!db.transaction) throw new Error("Attendance transaction is unavailable");
    return db.transaction(async (client) => {
        const last = (await client.query(
            `SELECT * FROM time_entries
             WHERE user_id = $1 AND (timestamp + $3::interval)::date = $2::date
               AND (approval_status IS NULL OR approval_status != 'rejected')
             ORDER BY timestamp DESC, id DESC LIMIT 1`,
            [userId, date, timezoneModifier],
        )).rows[0];

        if (transition === "break_start") {
            if (!last || last.entry_type === "clock_out") return { error: "You must login first" };
            if (last.entry_type === "break_start") return { error: "Already on break" };
        } else if (!last || last.entry_type !== "break_start") {
            return { error: "You are not on break" };
        }

        await client.query(
            "INSERT INTO time_entries (user_id, entry_type) VALUES ($1, $2)",
            [userId, transition],
        );
        return {};
    });
}

export async function listManualEntryRequests(db: AttendanceDb, userId: number): Promise<any[]> {
    return (await db.query(
        `SELECT ar.id as request_id, ar.status as approval_status, ar.metadata, ar.created_at,
                ar.reviewed_at, ar.reject_reason, u.full_name as approver_name
         FROM approval_requests ar
         LEFT JOIN users u ON u.id = ar.approver_id
         WHERE ar.requester_id = $1 AND ar.type = 'manual_entry'
         ORDER BY ar.created_at DESC
         LIMIT 50`,
        [userId],
    )).rows;
}

export async function listEntriesForDate(
    db: AttendanceDb,
    userId: number,
    date: string,
    timezoneModifier: string,
): Promise<any[]> {
    return (await db.query(
        `SELECT * FROM time_entries
         WHERE user_id = $1 AND (timestamp + $3::interval)::date = $2::date
         ORDER BY timestamp ASC`,
        [userId, date, timezoneModifier],
    )).rows;
}

export async function findLockedPayPeriod(
    db: AttendanceDb,
    orgId: number,
    date: string,
): Promise<{ label: string } | null> {
    return (await db.query(
        "SELECT label FROM pay_periods WHERE org_id = $1 AND start_date <= $2 AND end_date >= $2",
        [orgId, date],
    )).rows[0] || null;
}

export async function hasProtectedEntries(
    db: AttendanceDb,
    userId: number,
    date: string,
    timezoneModifier: string,
): Promise<boolean> {
    const result = await db.query(
        `SELECT 1 FROM time_entries
         WHERE user_id = $1 AND (timestamp + $3::interval)::date = $2::date
           AND approval_status IN ('pending','approved')
         LIMIT 1`,
        [userId, date, timezoneModifier],
    );
    return result.rowCount > 0;
}

export async function deleteEntriesForDate(
    db: AttendanceDb,
    userId: number,
    date: string,
    timezoneModifier: string,
): Promise<number> {
    return (await db.query(
        `DELETE FROM time_entries
         WHERE user_id = $1 AND (timestamp + $3::interval)::date = $2::date`,
        [userId, date, timezoneModifier],
    )).rowCount;
}


export async function countEntriesForDate(
    db: AttendanceDb,
    userId: number,
    date: string,
    timezoneModifier: string,
): Promise<number> {
    const row = (await db.query(
        `SELECT COUNT(*) AS count FROM time_entries
         WHERE user_id = $1 AND (timestamp + $3::interval)::date = $2::date`,
        [userId, date, timezoneModifier],
    )).rows[0];
    return parseInt(row?.count || "0", 10);
}

export async function findLeaveForDate(
    db: AttendanceDb,
    userId: number,
    date: string,
): Promise<{ id: number; leave_type: string } | null> {
    return (await db.query(
        "SELECT id, leave_type FROM leaves WHERE user_id = $1 AND date = $2",
        [userId, date],
    )).rows[0] || null;
}

export async function hasProtectedManualEditData(
    db: AttendanceDb,
    userId: number,
    date: string,
    timezoneModifier: string,
): Promise<boolean> {
    const result = await db.query(
        `SELECT 1 FROM time_entries
         WHERE user_id = $1 AND (timestamp + $3::interval)::date = $2::date
           AND (approval_status = 'approved' OR is_manual IS NOT TRUE)
         LIMIT 1`,
        [userId, date, timezoneModifier],
    );
    return result.rowCount > 0;
}

interface PersistManualDayOptions {
    userId: number;
    orgId: number | null;
    approverId: number | null;
    date: string;
    clockIn: string;
    clockOut: string | null;
    breaks: Array<{ start: string; end: string }>;
    workMode: string;
    approvalStatus: string;
    toUtc: (time: string) => string;
    reason: string;
    metadata: object;
    replaceExisting?: boolean;
    timezoneModifier?: string;
    createApproval: boolean;
}

export async function persistManualDay(
    db: AttendanceDb,
    options: PersistManualDayOptions,
): Promise<void> {
    if (!db.transaction) throw new Error("Attendance transaction is unavailable");
    await db.transaction(async (client) => {
        if (options.replaceExisting) {
            await supersedePendingManualEdits(client, options.userId, options.date);
            await client.query(
                `DELETE FROM time_entries
                 WHERE user_id = $1 AND (timestamp + $3::interval)::date = $2::date`,
                [options.userId, options.date, options.timezoneModifier],
            );
        }
        await insertManualEntry(client, options.userId, "clock_in", options.toUtc(options.clockIn), options.workMode, options.approvalStatus);
        for (const brk of options.breaks) {
            await insertManualEntry(client, options.userId, "break_start", options.toUtc(brk.start), null, options.approvalStatus);
            await insertManualEntry(client, options.userId, "break_end", options.toUtc(brk.end), null, options.approvalStatus);
        }
        if (options.clockOut) {
            await insertManualEntry(client, options.userId, "clock_out", options.toUtc(options.clockOut), null, options.approvalStatus);
        }
        if (options.createApproval) {
            await insertManualApproval(client, options);
        }
    });
}

export async function persistProtectedManualEdit(
    db: AttendanceDb,
    options: Omit<PersistManualDayOptions, "replaceExisting" | "timezoneModifier" | "createApproval">,
): Promise<void> {
    if (!db.transaction) throw new Error("Attendance transaction is unavailable");
    await db.transaction(async (client) => {
        await supersedePendingManualEdits(client, options.userId, options.date);
        await insertManualApproval(client, options);
    });
}

export async function insertManualEntryNotification(
    db: AttendanceDb,
    approverId: number,
    requesterName: string,
    date: string,
    edit: boolean,
): Promise<void> {
    await db.query(
        "INSERT INTO notifications (user_id, type, title, body) VALUES ($1, $2, $3, $4)",
        [
            approverId,
            "approval",
            edit ? "Manual Entry Updated" : "New Manual Entry Request",
            edit
                ? `${requesterName} updated a manual time entry for ${date}.`
                : `${requesterName} submitted a manual time entry for ${date}.`,
        ],
    );
}

async function supersedePendingManualEdits(
    db: AttendanceDb,
    userId: number,
    date: string,
): Promise<void> {
    await db.query(
        `UPDATE approval_requests
         SET status = 'rejected', reject_reason = 'Superseded by edit'
         WHERE requester_id = $1 AND type = 'manual_entry' AND status = 'pending'
           AND metadata::jsonb->>'date' = $2`,
        [userId, date],
    );
}

async function insertManualEntry(
    db: AttendanceDb,
    userId: number,
    type: string,
    timestamp: string,
    workMode: string | null,
    approvalStatus: string,
): Promise<void> {
    await db.query(
        `INSERT INTO time_entries
            (user_id, entry_type, timestamp, work_mode, is_manual, approval_status)
         VALUES ($1,$2,$3,$4,TRUE,$5)`,
        [userId, type, timestamp, workMode || null, approvalStatus],
    );
}

async function insertManualApproval(
    db: AttendanceDb,
    options: Pick<PersistManualDayOptions, "orgId" | "userId" | "approverId" | "reason" | "metadata">,
): Promise<void> {
    await db.query(
        `INSERT INTO approval_requests
            (org_id, requester_id, approver_id, type, reference_id, reason, metadata)
         VALUES ($1,$2,$3,'manual_entry',NULL,$4,$5)`,
        [options.orgId, options.userId, options.approverId, options.reason, JSON.stringify(options.metadata)],
    );
}

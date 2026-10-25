/**
 * Schedule overlays: the read-only context behind the Schedule calendar.
 *
 * Approved leave, holidays and booked meetings are drawn behind the planner
 * grid. They never affect task counts or point totals, so they are fetched
 * separately from the task collection.
 */

export interface ScheduleDb {
    query(sql: string, params?: unknown[]): Promise<{ rows: any[]; rowCount: number }>;
}

export interface ScheduleOverlays {
    leave: any[];
    holidays: any[];
    meetings: any[];
}

/**
 * Overlays overlapping the inclusive `from`..`to` day range.
 *
 * Holidays and meetings are optional tables in older tenants, so a missing
 * table yields an empty band rather than failing the whole calendar.
 */
export async function findScheduleOverlays(
    db: ScheduleDb,
    from: string,
    to: string,
): Promise<ScheduleOverlays> {
    const [leave, holidays, meetings] = await Promise.all([
        db.query(
            `SELECT l.id, l.user_id, l.date, l.end_date, l.leave_type, l.status,
                    u.full_name AS user_name
               FROM leaves l
               LEFT JOIN users u ON u.id = l.user_id
              WHERE l.status = 'approved'
                AND l.date <= $2
                AND COALESCE(l.end_date, l.date) >= $1`,
            [from, to],
        ),
        db.query(
            `SELECT id, name, date FROM holidays
              WHERE date >= $1 AND date <= $2
              ORDER BY date ASC`,
            [from, to],
        ).catch(() => ({ rows: [] })),
        db.query(
            `SELECT id, title, start_time, end_time FROM calendar_events
              WHERE start_time >= $1::date AND start_time < ($2::date + INTERVAL '1 day')
              ORDER BY start_time ASC`,
            [from, to],
        ).catch(() => ({ rows: [] })),
    ]);

    return {
        leave: leave.rows,
        holidays: holidays.rows,
        meetings: meetings.rows,
    };
}

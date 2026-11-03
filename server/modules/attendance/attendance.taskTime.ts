/**
 * Task time in the timesheet.
 *
 * Recorded worklogs appear next to attendance, grouped by day worked.
 */
import type { AttendanceDb } from "./attendance.types";
import * as repository from "./attendance.repository";
import { summariseTaskTime } from "../tasks/tasks.timesheet";

export async function getTaskTime(
    db: AttendanceDb,
    userId: number,
    fromDate: string,
    toDate: string,
    _timezoneOffset: number,
) {
    const rows = await repository.listTaskWorklogsForDateRange(db, userId, fromDate, toDate);
    return summariseTaskTime(rows);
}

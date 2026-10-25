/**
 * Task time in the timesheet.
 *
 * A timer started from a task is stored as a `task_timers` row; this reads the
 * stopped ones back so the time a person logged against tasks shows up next to
 * their attendance instead of living only on the task.
 */
import type { AttendanceDb } from "./attendance.types";
import * as repository from "./attendance.repository";
import { summariseTaskTime } from "../tasks/tasks.timesheet";

export async function getTaskTime(
    db: AttendanceDb,
    userId: number,
    fromDate: string,
    toDate: string,
    timezoneOffset: number,
) {
    const rows = await repository.listTaskTimersForDateRange(
        db, userId, fromDate, toDate, `${-timezoneOffset} minutes`,
    );
    return summariseTaskTime(rows, timezoneOffset);
}

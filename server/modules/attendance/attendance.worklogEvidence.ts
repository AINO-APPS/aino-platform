import type { AttendanceDb } from './attendance.types';
import * as repository from './attendance.repository';
import { computeDaySummary, endOfLocalDayMs } from '../../utils/timeCalc';

/** Attendance evidence for a worklog's author and recorded local day; never the viewer's timezone. */
export async function getWorklogDayAttendance(db: AttendanceDb, userId: number, orgId: number | null,
    date: string, nowMs = Date.now()): Promise<{ hasEntries: boolean; floorMinutes: number }> {
    const offset = await repository.getAuthorTimezoneOffset(db, userId, orgId);
    if (offset === null) return { hasEntries: false, floorMinutes: 0 };
    const entries = await repository.listEntriesForLocalDay(db, userId, date, `${-offset} minutes`);
    const today = new Date(nowMs - offset * 60000).toISOString().slice(0, 10);
    const summary = computeDaySummary(entries, true, date >= today ? nowMs : endOfLocalDayMs(date, offset));
    return { hasEntries: entries.length > 0, floorMinutes: summary.floorMinutes };
}

/** Cross-module leave read for any recorded day, independent of the recent-history window. */
export const hasApprovedLeaveForDate = repository.hasApprovedLeaveForDate;

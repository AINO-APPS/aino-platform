import type { TasksDb } from './tasks.types';
import { getWorklogDayAttendance, hasApprovedLeaveForDate } from '../attendance/attendance.service';
import { readAuthorDayMinutes } from './tasks.worklogWarningRepository';
import { logger } from '../../utils/logger';

export type WorklogWarning = 'ON_LEAVE' | 'EXCEEDS_ATTENDANCE';

/** Call only after the worklog commits: advisory reads must never roll back a save. */
export async function computeWorklogWarnings(db: TasksDb, orgId: number | null,
    worklog: { author_id: number; day_worked: string }, tenantId?: number | null): Promise<WorklogWarning[]> {
    const context = { tenant_id: tenantId ?? null, org_id: orgId, author_id: worklog.author_id, day_worked: worklog.day_worked };
    const warnings: WorklogWarning[] = [];
    try {
        if (await hasApprovedLeaveForDate(db, worklog.author_id, orgId, worklog.day_worked)) warnings.push('ON_LEAVE');
    } catch (err) {
        logger.warn({ err, ...context, operation: 'approved_leave' }, 'Could not compute worklog attendance warnings; worklog is saved');
    }
    try {
        const attendance = await getWorklogDayAttendance(db, worklog.author_id, orgId, worklog.day_worked);
        if (attendance.hasEntries && await readAuthorDayMinutes(db, worklog.author_id, orgId, worklog.day_worked) > attendance.floorMinutes)
            warnings.push('EXCEEDS_ATTENDANCE');
    } catch (err) {
        logger.warn({ err, ...context, operation: 'attendance_comparison' }, 'Could not compare worklog attendance; worklog is saved');
    }
    return warnings;
}

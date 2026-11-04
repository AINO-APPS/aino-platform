import type { DbContext } from '../../types/domain';
import type { TasksDb } from './tasks.types';
import type { TaskActor } from './tasks.policy';
import { parseDuration, InvalidDuration } from './tasks.duration';
import { lockWorklogTicket, workingHoursPerDay, readTimeSpent } from './tasks.worklogRepository';
import { writeEstimates, writeRemaining, recordEstimateChange } from './tasks.estimateRepository';
import { ticketActionConflict } from './tasks.writeGuards';
import { findEffortReaders } from './tasks.effortAudience';
import { emitTaskUpdated } from '../../utils/taskNotifications';

export interface RemainingAdjustment { mode: 'auto' | 'set' | 'leave'; value?: number | null }
export interface RemainingInput { remaining_mode?: 'auto' | 'set' | 'leave'; remaining_estimate?: string }
export interface EstimateInput { original_estimate?: string; remaining_estimate?: string }
export class InvalidEstimate extends Error { readonly code = 'INVALID_ESTIMATE'; }

export function parseEstimate(value: unknown, hours: number): number | null {
    if (typeof value !== 'string') throw new InvalidEstimate('Enter an estimate duration, or empty text to clear it.');
    if (!value.trim()) return null;
    if (/^0+(?:\.0+)?\s*m$/.test(value.trim())) return 0;
    try { return parseDuration(value, hours); }
    catch (err) { if (err instanceof InvalidDuration) throw new InvalidEstimate('Enter an estimate using w, d, h or m, or 0m.'); throw err; }
}

export async function applyRemaining(db: TasksDb, task: any, before: number, after: number, input: RemainingInput, orgId: number | null) {
    const mode = input.remaining_mode === undefined ? 'auto' : input.remaining_mode;
    if (!['auto','set','leave'].includes(mode) || (mode !== 'set' && input.remaining_estimate !== undefined))
        throw new InvalidEstimate('Choose auto, set or leave for the remaining estimate.');
    const value = mode === 'set' ? parseEstimate(input.remaining_estimate, await workingHoursPerDay(db, orgId)) : undefined;
    const remaining = adjustRemaining(task.remaining_estimate_minutes ?? null, before, after, { mode, value });
    await writeRemaining(db, task.id, remaining, orgId);
    task.remaining_estimate_minutes = remaining;
}

export function estimateSummary(task: any, timeSpent: number) {
    return { id: task.id, time_spent_minutes: timeSpent, logged_minutes: timeSpent,
        original_estimate_minutes: task.original_estimate_minutes ?? null,
        remaining_estimate_minutes: task.remaining_estimate_minutes ?? null,
        estimated_minutes: task.original_estimate_minutes ?? null };
}

export async function setEstimates(db: TasksDb & Pick<DbContext,'transaction'>, taskId: number, actor: TaskActor,
    input: EstimateInput, source: { tenantId?: number | null; ip?: string; userAgent?: string } = {}) {
    if (!Number.isInteger(taskId) || taskId < 1 || taskId > 2_147_483_647) throw new InvalidEstimate('Enter a valid ticket identifier.');
    return db.transaction(async (client,context) => {
        const tx = client as TasksDb;
        const task = await lockWorklogTicket(tx,taskId,actor.orgId);
        if (!task) return { conflict:{status:404,body:{error:'Task not found'}} };
        const conflict = await ticketActionConflict(tx,actor,task,'canEditEstimate');
        if (conflict) return { conflict };
        if (!input || typeof input !== 'object' || Array.isArray(input) || !Object.keys(input).length
            || Object.keys(input).some(key => !['original_estimate','remaining_estimate'].includes(key)))
            throw new InvalidEstimate('Enter original and/or remaining estimates.');
        const hours = await workingHoursPerDay(tx,actor.orgId);
        const before = { original_estimate_minutes: task.original_estimate_minutes ?? null, remaining_estimate_minutes: task.remaining_estimate_minutes ?? null };
        const original = 'original_estimate' in input ? parseEstimate(input.original_estimate,hours) : before.original_estimate_minutes;
        const remaining = 'remaining_estimate' in input ? parseEstimate(input.remaining_estimate,hours)
            : before.remaining_estimate_minutes == null && 'original_estimate' in input ? original : before.remaining_estimate_minutes;
        await writeEstimates(tx,taskId,original,remaining,actor.orgId);
        const after = { original_estimate_minutes:original, remaining_estimate_minutes:remaining };
        await recordEstimateChange(tx,taskId,actor.userId,actor.orgId,before,after,source.ip,source.userAgent);
        const total = (await readTimeSpent(tx,[taskId],actor.orgId))[taskId] ?? 0;
        context.afterCommit(async () => {
            const members = await findEffortReaders(db, task, actor);
            emitTaskUpdated(source.tenantId,taskId,'updated',[task.user_id,task.assigned_to,actor.userId,...members]);
        });
        return { ticket:estimateSummary({...task,...after},total) };
    });
}

/** Before/after effort are zero for an addition/deletion respectively. */
export function adjustRemaining(current: number | null, before: number, after: number,
    adjustment: RemainingAdjustment): number | null {
    if (adjustment.mode === 'set') return adjustment.value ?? null;
    if (adjustment.mode === 'leave' || current == null) return current;
    return Math.max(0, current + before - after);
}

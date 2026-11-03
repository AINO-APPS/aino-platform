import type { DbContext } from "../../types/domain";
import type { TasksDb } from "./tasks.types";
import type { TaskActor } from "./tasks.policy";
import * as repository from "./tasks.worklogRepository";
import { summariseTime } from "./tasks.time";
import { localDate } from "./tasks.timesheet";
import { parseDuration } from "./tasks.duration";
import { ticketActionConflict } from "./tasks.writeGuards";
import { findTeamMemberIds } from "./tasks.repository";
import { emitTaskUpdated } from "../../utils/taskNotifications";
import { decideWorklog } from "./tasks.capabilities";

export interface LogWorkInput {
    day_worked: string;
    time_spent: string;
    start_time?: string | null;
    comment?: string | null;
}

export class InvalidWorklog extends Error {
    readonly code = "INVALID_WORKLOG";
}

function validateWorklog(input: LogWorkInput) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new InvalidWorklog('Enter worklog fields.');
    const day = input.day_worked;
    if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day)
        || !Number.isFinite(Date.parse(`${day}T00:00:00Z`)) || new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) !== day)
        throw new InvalidWorklog('Enter a valid day worked.');
    if (input.start_time != null && input.start_time !== '' && (typeof input.start_time !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(input.start_time)))
        throw new InvalidWorklog('Enter a valid start time.');
    if (input.comment != null && (typeof input.comment !== 'string' || input.comment.length > 10_000))
        throw new InvalidWorklog('Comment must be text of at most 10000 characters.');
    if (Object.keys(input).some(key => !['day_worked', 'time_spent', 'start_time', 'comment'].includes(key)))
        throw new InvalidWorklog('Unsupported worklog field.');
}

/** Permission is rechecked under the ticket lock; all durable records precede realtime. */
export async function logWork(db: TasksDb & Pick<DbContext, 'transaction'>, taskId: number, actor: TaskActor,
    input: LogWorkInput, source: { tenantId?: number | null; ip?: string; userAgent?: string } = {}) {
    return db.transaction(async (client, context) => {
        const tx = client as TasksDb;
        const task = await repository.lockWorklogTicket(tx, taskId, actor.orgId);
        if (!task) return { conflict: { status: 404, body: { error: 'Task not found' } } };
        const conflict = await ticketActionConflict(tx, actor, task, 'logWork');
        if (conflict) return { conflict };
        validateWorklog(input);
        const minutes = parseDuration(input.time_spent, await repository.workingHoursPerDay(tx, actor.orgId));
        const id = await repository.insertWorklog(tx, taskId, actor.userId, input, minutes);
        const list = await getTicketWorklogs(tx, taskId, actor.orgId, actor.userId);
        const worklog = list.worklogs.find(row => row.id === id)!;
        await repository.recordWorklogAddition(tx, taskId, actor.userId, actor.orgId, worklog, source.ip, source.userAgent);
        context.afterCommit(async () => {
            const members = task.team_id == null ? [] : await findTeamMemberIds(db as TasksDb, task.team_id, actor.orgId);
            emitTaskUpdated(source.tenantId, taskId, 'updated', [task.user_id, task.assigned_to, actor.userId, ...members]);
        });
        return { worklog, ticket: { id: taskId, time_spent_minutes: list.time_spent_minutes,
            logged_minutes: list.time_spent_minutes, estimated_minutes: task.estimated_minutes }, warnings: [] };
    });
}

export async function editWorklog(db: TasksDb & Pick<DbContext, 'transaction'>, taskId: number, worklogId: number,
    actor: TaskActor, input: Partial<LogWorkInput>, source: { tenantId?: number | null; ip?: string; userAgent?: string } = {}) {
    return db.transaction(async (client, context) => {
        const tx = client as TasksDb;
        const task = await repository.lockWorklogTicket(tx, taskId, actor.orgId);
        if (!task) return { conflict: { status: 404, body: { error: 'Task not found' } } };
        const access = await ticketActionConflict(tx, actor, task, 'edit');
        if (access && access.body.code !== 'SPRINT_FROZEN') return { conflict: access };
        const before = await repository.lockWorklog(tx, taskId, worklogId);
        if (!before) return { conflict: { status: 404, body: { error: 'Worklog not found' } } };
        if (!decideWorklog(actor.userId, before).canEdit)
            return { conflict: { status: 403, body: { code: 'ACCESS_DENIED', error: 'Only the worklog author can edit it.' } } };
        if (!input || typeof input !== 'object' || Array.isArray(input) || !Object.keys(input).length)
            throw new InvalidWorklog('Enter changed worklog fields.');
        const fields = { day_worked: before.day_worked, start_time: before.start_time,
            comment: before.comment, time_spent: `${before.minutes}m`, ...input };
        validateWorklog(fields);
        const minutes = parseDuration(fields.time_spent, await repository.workingHoursPerDay(tx, actor.orgId));
        await repository.updateWorklog(tx, worklogId, fields, minutes);
        const list = await getTicketWorklogs(tx, taskId, actor.orgId, actor.userId);
        const worklog = list.worklogs.find(row => row.id === worklogId)!;
        await repository.recordWorklogChange(tx, taskId, actor.userId, actor.orgId, 'worklog_updated', before, worklog, source.ip, source.userAgent);
        context.afterCommit(async () => {
            const members = task.team_id == null ? [] : await findTeamMemberIds(db as TasksDb, task.team_id, actor.orgId);
            emitTaskUpdated(source.tenantId, taskId, 'updated', [task.user_id, task.assigned_to, actor.userId, ...members]);
        });
        return { worklog, ticket: { id: taskId, time_spent_minutes: list.time_spent_minutes,
            logged_minutes: list.time_spent_minutes, estimated_minutes: task.estimated_minutes }, warnings: [] };
    });
}

export async function deleteWorklog(db: TasksDb & Pick<DbContext, 'transaction'>, taskId: number, worklogId: number,
    actor: TaskActor, input: Record<string, never> = {}, source: { tenantId?: number | null; ip?: string; userAgent?: string } = {}) {
    return db.transaction(async (client, context) => {
        const tx = client as TasksDb;
        const task = await repository.lockWorklogTicket(tx, taskId, actor.orgId);
        if (!task) return { conflict: { status: 404, body: { error: 'Task not found' } } };
        const access = await ticketActionConflict(tx, actor, task, 'edit');
        if (access && access.body.code !== 'SPRINT_FROZEN') return { conflict: access };
        const before = await repository.lockWorklog(tx, taskId, worklogId);
        if (!before) return { conflict: { status: 404, body: { error: 'Worklog not found' } } };
        if (!decideWorklog(actor.userId, before).canDelete)
            return { conflict: { status: 403, body: { code: 'ACCESS_DENIED', error: 'Only the worklog author can delete it.' } } };
        if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length)
            throw new InvalidWorklog('Unsupported worklog field.');
        const deleted = await repository.softDeleteWorklog(tx, worklogId);
        await repository.recordWorklogChange(tx, taskId, actor.userId, actor.orgId, 'worklog_deleted', before, deleted, source.ip, source.userAgent);
        const total = (await getTimeSpent(tx, [taskId], actor.orgId))[taskId] ?? 0;
        context.afterCommit(async () => {
            const members = task.team_id == null ? [] : await findTeamMemberIds(db as TasksDb, task.team_id, actor.orgId);
            emitTaskUpdated(source.tenantId, taskId, 'updated', [task.user_id, task.assigned_to, actor.userId, ...members]);
        });
        return { ticket: { id: taskId, time_spent_minutes: total, logged_minutes: total, estimated_minutes: task.estimated_minutes } };
    });
}

/** Batched read: missing and empty tickets have zero time, never the obsolete stored total. */
export const getTimeSpent = repository.readTimeSpent;

export async function getTicketWorklogs(db: TasksDb, taskId: number, orgId: number | null, viewerId?: number) {
    const rows = await repository.listWorklogs(db, taskId, orgId);
    const worklogs = rows.map(({ username, full_name, avatar, logged_by_username, logged_by_name, logged_by_avatar, source_timer_id: _source, ...row }) => ({
        ...row,
        ...decideWorklog(viewerId, row),
        author: { id: row.author_id, username, full_name, avatar },
        logged_by: { id: row.logged_by_id, username: logged_by_username, full_name: logged_by_name, avatar: logged_by_avatar },
    }));
    return { worklogs, time_spent_minutes: worklogs.reduce((sum, row) => sum + row.minutes, 0) };
}

/** One transaction owns stopping, recording and history, so repeated/concurrent stops cannot add time twice. */
export async function stopLegacyTimer(db: Pick<DbContext, "transaction">, taskId: number, actor: TaskActor,
    offset: number, stoppedAt = new Date()) {
    return db.transaction(async client => {
        const task = await repository.lockTicket(client as TasksDb, taskId, actor.orgId);
        if (!task) return null;
        const running = await repository.lockRunningTimer(client as TasksDb, taskId, actor.userId, actor.orgId);
        if (!running) return null;
        const previous = (await getTimeSpent(client as TasksDb, [taskId], actor.orgId))[taskId] ?? 0;
        const started = new Date(running.started_at);
        const minutes = Math.max(1, Math.ceil((stoppedAt.getTime() - started.getTime()) / 60_000));
        const localStart = new Date(started.getTime() - offset * 60_000);
        await repository.recordTimerWorklog(client as TasksDb, running.id, taskId, actor.userId,
            stoppedAt.toISOString(), minutes, localDate(started, offset), localStart.toISOString().slice(11, 19));
        const total = (await getTimeSpent(client as TasksDb, [taskId], actor.orgId))[taskId] ?? 0;
        await repository.recordLegacyHistory(client as TasksDb, taskId, actor.userId, previous, total);
        return { minutes, time: summariseTime({ ...task, logged_minutes: total }) };
    });
}

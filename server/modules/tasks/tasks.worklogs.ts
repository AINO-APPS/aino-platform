import type { DbContext } from "../../types/domain";
import type { TasksDb } from "./tasks.types";
import type { TaskActor } from "./tasks.policy";
import * as repository from "./tasks.worklogRepository";
import { summariseTime } from "./tasks.time";
import { localDate } from "./tasks.timesheet";

/** Batched read: missing and empty tickets have zero time, never the obsolete stored total. */
export const getTimeSpent = repository.readTimeSpent;

export async function getTicketWorklogs(db: TasksDb, taskId: number, orgId: number | null) {
    const rows = await repository.listWorklogs(db, taskId, orgId);
    const worklogs = rows.map(({ username, full_name, avatar, logged_by_username, logged_by_name, logged_by_avatar, source_timer_id: _source, ...row }) => ({
        ...row,
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

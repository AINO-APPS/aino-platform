// Helpers that hydrate raw task rows with labels, comment counts, assignee
// info, creator info and sprint summaries. Batched to avoid N+1 queries.
const {
    findLabelsForTasks,
    findCommentCounts,
    findUsersByIds,
    findSprintsByIds,
    findProjectsByIds,
    findWorkflowStatesByIds,
} = require("../../../modules/tasks/tasks.enrich");
const { findTicketKeyAliasesByTaskIds } = require("../../../modules/tasks/tasks.repository");
const { loadTicketDecisionContext, decideTickets } = require("../../../modules/tasks/tasks.capabilities");
const { loadLifecycleContext } = require("../../../modules/tasks/tasks.workflow");
const { getTimeSpent } = require("../../../modules/tasks/tasks.worklogs");
import type { TaskActor } from "../../../modules/tasks/tasks.policy";
import type { LifecycleContext } from "../../../modules/tasks/tasks.workflow";

interface DbLike {
    query: (sql: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount: number }>;
}

async function getLabelsForTasks(taskIds: number[], db: DbLike): Promise<Record<number, any[]>> {
    const rows = await findLabelsForTasks(db, taskIds);
    const map: Record<number, any[]> = {};
    for (const r of rows) {
        if (!map[r.task_id]) map[r.task_id] = [];
        map[r.task_id].push({ id: r.id, name: r.name, color: r.color });
    }
    return map;
}

async function getCommentCounts(taskIds: number[], db: DbLike): Promise<Record<number, number>> {
    const rows = await findCommentCounts(db, taskIds);
    const map: Record<number, number> = {};
    for (const r of rows) map[r.task_id] = parseInt(r.count, 10);
    return map;
}

async function enrichTasks(
    tasks: any[],
    db: DbLike,
    actor: TaskActor,
    lifecycle?: LifecycleContext,
): Promise<any[]> {
    if (!tasks.length) return [];
    const taskIds = tasks.map(t => t.id);

    const [labelsMap, commentMap, aliasRows, timeSpent] = await Promise.all([
        getLabelsForTasks(taskIds, db),
        getCommentCounts(taskIds, db),
        findTicketKeyAliasesByTaskIds(db, taskIds),
        getTimeSpent(db, taskIds, actor.orgId),
    ]);

    const assigneeIds = [...new Set(tasks.map(t => t.assigned_to).filter(Boolean))];
    const creatorIds = [...new Set(tasks.map(t => t.user_id))];
    const sprintIds = [...new Set(tasks.map(t => t.sprint_id).filter(Boolean))];
    // Collect project ids for the lightweight project summary.
    const projectIds = [...new Set(tasks.map(t => t.project_id).filter(Boolean))];
    const allUserIds = [...new Set([...assigneeIds, ...creatorIds])];
    // The workflow state is the only status (D4), so every task carries its
    // key, name and category. Clients read these instead of a status column.
    const stateIds = [...new Set(tasks.map(t => t.workflow_state_id).filter(Boolean))];

    const [userRows, sprintRows, projectRows, stateRows] = await Promise.all([
        findUsersByIds(db, allUserIds),
        findSprintsByIds(db, sprintIds),
        findProjectsByIds(db, projectIds),
        findWorkflowStatesByIds(db, stateIds),
    ]);
    const sharedLifecycle = lifecycle ?? await loadLifecycleContext(db, actor.orgId, actor.projectOwnership ? undefined : null);
    const decisionContext = await loadTicketDecisionContext(db, actor, tasks, { lifecycle: sharedLifecycle });
    const decisions = decideTickets(actor, tasks, decisionContext);

    const userMap: Record<number, any> = {};
    for (const u of userRows) userMap[u.id] = u;
    const sprintMap: Record<number, any> = {};
    for (const s of sprintRows) sprintMap[s.id] = s;
    const projectMap: Record<number, any> = {};
    for (const p of projectRows) projectMap[p.id] = p;
    const stateMap: Record<number, any> = {};
    for (const s of stateRows) stateMap[s.id] = s;
    const aliasesByTaskId: Record<number, string[]> = {};
    for (const alias of aliasRows) {
        if (!aliasesByTaskId[alias.task_id]) aliasesByTaskId[alias.task_id] = [];
        aliasesByTaskId[alias.task_id].push(alias.key);
    }

    return tasks.map((t, index) => {
        const project = t.project_id ? (projectMap[t.project_id] || null) : null;
        const ticketKey = t.ticket_key ?? null;
        const state = t.workflow_state_id ? (stateMap[t.workflow_state_id] || null) : null;
        return {
            ...t,
            start_date: t.start_date ?? null,
            planned_date: t.start_date ?? null,
            time_spent_minutes: timeSpent[t.id] ?? 0,
            logged_minutes: timeSpent[t.id] ?? 0,
            estimated_minutes: t.original_estimate_minutes ?? null,
            original_estimate_minutes: t.original_estimate_minutes ?? null,
            remaining_estimate_minutes: t.remaining_estimate_minutes ?? null,
            workflow_state_key: state?.key ?? null,
            workflow_state_name: state?.name ?? null,
            workflow_state_category: state?.category ?? null,
            labels: labelsMap[t.id] || [],
            comment_count: commentMap[t.id] || 0,
            assignee: t.assigned_to
                ? (userMap[t.assigned_to]
                    ? { username: userMap[t.assigned_to].username, full_name: userMap[t.assigned_to].full_name, avatar: userMap[t.assigned_to].avatar }
                    : null)
                : null,
            creator: userMap[t.user_id]
                ? { username: userMap[t.user_id].username, full_name: userMap[t.user_id].full_name, avatar: userMap[t.user_id].avatar }
                : null,
            sprint: t.sprint_id ? (sprintMap[t.sprint_id] || null) : null,
            project,
            ticket_key: ticketKey,
            issue_key: ticketKey,
            key_aliases: aliasesByTaskId[t.id] || [],
            ...decisions[index],
        };
    });
}

async function enrichTaskSummaries(
    tasks: any[],
    db: DbLike,
    actor: TaskActor,
    lifecycle?: LifecycleContext,
): Promise<any[]> {
    const enriched = await enrichTasks(tasks, db, actor, lifecycle);
    return tasks.map((task, index) => ({
        ...task,
        start_date: enriched[index].start_date,
        planned_date: enriched[index].planned_date,
        time_spent_minutes: enriched[index].time_spent_minutes,
        logged_minutes: enriched[index].logged_minutes,
        estimated_minutes: enriched[index].estimated_minutes,
        original_estimate_minutes: enriched[index].original_estimate_minutes,
        remaining_estimate_minutes: enriched[index].remaining_estimate_minutes,
        container: enriched[index].container,
        capabilities: enriched[index].capabilities,
        ticket_key: enriched[index].ticket_key,
        issue_key: enriched[index].issue_key,
        key_aliases: enriched[index].key_aliases,
        project: enriched[index].project,
    }));
}

export = { enrichTasks, enrichTaskSummaries, getLabelsForTasks, getCommentCounts };
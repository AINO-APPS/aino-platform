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

async function enrichTasks(tasks: any[], db: DbLike): Promise<any[]> {
    if (!tasks.length) return [];
    const taskIds = tasks.map(t => t.id);

    const [labelsMap, commentMap] = await Promise.all([
        getLabelsForTasks(taskIds, db),
        getCommentCounts(taskIds, db),
    ]);

    const assigneeIds = [...new Set(tasks.map(t => t.assigned_to).filter(Boolean))];
    const creatorIds = [...new Set(tasks.map(t => t.user_id))];
    const sprintIds = [...new Set(tasks.map(t => t.sprint_id).filter(Boolean))];
    // Stage 3: collect project ids so we can surface `issue_key` (PROJ-123)
    // and the lightweight project summary on every enriched task.
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

    const userMap: Record<number, any> = {};
    for (const u of userRows) userMap[u.id] = u;
    const sprintMap: Record<number, any> = {};
    for (const s of sprintRows) sprintMap[s.id] = s;
    const projectMap: Record<number, any> = {};
    for (const p of projectRows) projectMap[p.id] = p;
    const stateMap: Record<number, any> = {};
    for (const s of stateRows) stateMap[s.id] = s;

    return tasks.map(t => {
        const project = t.project_id ? (projectMap[t.project_id] || null) : null;
        // Issue key is only set for tasks that have both a project and a
        // task_number (legacy tasks remain key-less even if they get a
        // project assigned, until a number is generated for them).
        const issueKey = project && t.task_number ? `${project.key}-${t.task_number}` : null;
        const state = t.workflow_state_id ? (stateMap[t.workflow_state_id] || null) : null;
        return {
            ...t,
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
            issue_key: issueKey,
        };
    });
}

export = { enrichTasks, getLabelsForTasks, getCommentCounts };
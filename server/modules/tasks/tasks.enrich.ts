/**
 * Batched reads used to hydrate raw task rows.
 *
 * Enrichment needs labels, comment counts, people, sprint summaries, projects
 * and the workflow state for a whole page of tasks. Every read here takes the
 * full id list so a page costs a fixed number of queries rather than one per
 * task.
 */

export interface EnrichDb {
    query(sql: string, params?: unknown[]): Promise<{ rows: any[]; rowCount: number }>;
}

export async function findLabelsForTasks(db: EnrichDb, taskIds: number[]): Promise<any[]> {
    if (!taskIds.length) return [];
    return (await db.query(
        `SELECT tlm.task_id, tl.id, tl.name, tl.color
           FROM task_label_map tlm
           JOIN task_labels tl ON tl.id = tlm.label_id
          WHERE tlm.task_id = ANY($1)`,
        [taskIds],
    )).rows;
}

export async function findCommentCounts(db: EnrichDb, taskIds: number[]): Promise<any[]> {
    if (!taskIds.length) return [];
    return (await db.query(
        `SELECT task_id, COUNT(*) as count FROM task_comments
          WHERE task_id = ANY($1)
          GROUP BY task_id`,
        [taskIds],
    )).rows;
}

export async function findUsersByIds(db: EnrichDb, userIds: number[]): Promise<any[]> {
    if (!userIds.length) return [];
    return (await db.query(
        "SELECT id, username, full_name, avatar FROM users WHERE id = ANY($1)",
        [userIds],
    )).rows;
}

export async function findSprintsByIds(db: EnrichDb, sprintIds: number[]): Promise<any[]> {
    if (!sprintIds.length) return [];
    return (await db.query(
        "SELECT id, name, status, start_date, end_date FROM sprints WHERE id = ANY($1)",
        [sprintIds],
    )).rows;
}

export async function findProjectsByIds(db: EnrichDb, projectIds: number[]): Promise<any[]> {
    if (!projectIds.length) return [];
    return (await db.query(
        "SELECT id, key, name, color FROM projects WHERE id = ANY($1)",
        [projectIds],
    )).rows;
}

/** The workflow states behind a page of tasks — the only status (D4). */
export async function findWorkflowStatesByIds(db: EnrichDb, stateIds: number[]): Promise<any[]> {
    if (!stateIds.length) return [];
    return (await db.query(
        "SELECT id, key, name, category FROM workflow_states WHERE id = ANY($1)",
        [stateIds],
    )).rows;
}

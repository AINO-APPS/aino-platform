interface WorkflowQueryResult {
    rows: any[];
    rowCount?: number | null;
}

export interface WorkflowDb {
    query: (sql: string, params?: unknown[]) => Promise<WorkflowQueryResult>;
    transaction: <T = unknown>(fn: (client: WorkflowDb) => Promise<T>) => Promise<T>;
}

export interface WorkflowActor {
    userId: number | null;
    userRole: string | null;
    teamIds: number[];
}

export class WorkflowProjectSelectionError extends Error {
    constructor(readonly status: 400 | 404, message: string) {
        super(message);
    }
}

export async function resolveWorkflowProjectId(
    db: WorkflowDb,
    orgId: number | null,
    rawProjectId: unknown,
    actor: WorkflowActor,
): Promise<number | null> {
    if (!orgId) return null;
    if (rawProjectId !== undefined) {
        const projectId = Number.parseInt(String(rawProjectId), 10);
        if (!Number.isInteger(projectId) || projectId <= 0) {
            throw new WorkflowProjectSelectionError(400, "Invalid project id");
        }
        const project = (await db.query(
            "SELECT id FROM projects WHERE id = $1 AND org_id = $2",
            [projectId, orgId],
        )).rows[0];
        if (!project) throw new WorkflowProjectSelectionError(404, "Project not found");
        return Number(project.id);
    }

    const project = (await db.query(
        `SELECT p.id
           FROM projects p
      LEFT JOIN project_members pm ON pm.project_id = p.id
          WHERE p.org_id = $1
            AND (p.is_general = TRUE OR p.lead_user_id = $2 OR pm.user_id = $2
                 OR pm.team_id = ANY($3::int[]) OR $4 = ANY(ARRAY['super_admin','hr_admin','platform_admin']))
       ORDER BY p.is_general DESC, LOWER(p.name), p.id
          LIMIT 1`,
        [orgId, actor.userId, actor.teamIds, actor.userRole],
    )).rows[0];
    return project ? Number(project.id) : null;
}

export const findProjectInOrg = async (db: WorkflowDb, orgId: number, projectId: number) =>
    (await db.query("SELECT id FROM projects WHERE id = $1 AND org_id = $2", [projectId, orgId])).rows[0] ?? null;

export const listProjectWorkflowStates = async (db: WorkflowDb, orgId: number, projectId: number) =>
    (await db.query(
        `SELECT id, project_id, key, name, category, color, icon, wip_limit, is_initial, is_terminal,
                is_active, sort_order, created_at
           FROM workflow_states
          WHERE org_id = $1 AND project_id = $2
          ORDER BY sort_order ASC, id ASC`,
        [orgId, projectId],
    )).rows;

export async function missingProjectWorkflowCategories(
    db: WorkflowDb,
    orgId: number,
    projectId: number,
    stateId?: number,
    proposed?: { category?: string; is_active?: boolean },
): Promise<string[]> {
    const states = (await db.query(
        "SELECT id, category, is_active FROM workflow_states WHERE project_id = $1 AND org_id = $2",
        [projectId, orgId],
    )).rows;
    const active = states.filter((state) => {
        if (Number(state.id) !== stateId) return state.is_active;
        return proposed?.is_active ?? state.is_active;
    }).map((state) => Number(state.id) === stateId ? (proposed?.category ?? state.category) : state.category);
    return ["open", "in_progress", "in_review", "done"].filter((category) => !active.includes(category));
}

export const findProjectWorkflowState = async (db: WorkflowDb, orgId: number, projectId: number, stateId: number) =>
    (await db.query(
        "SELECT * FROM workflow_states WHERE id = $1 AND project_id = $2 AND org_id = $3",
        [stateId, projectId, orgId],
    )).rows[0] ?? null;

export async function createProjectWorkflowState(
    db: WorkflowDb,
    input: {
        orgId: number;
        projectId: number;
        key: string;
        name: string;
        category: string;
        color: string;
        icon: string | null;
        wipLimit: number | null;
        isInitial: boolean;
        isTerminal: boolean;
    },
): Promise<any> {
    return db.transaction(async (client) => {
        const sortOrder = Number((await client.query(
            "SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM workflow_states WHERE project_id = $1 AND org_id = $2",
            [input.projectId, input.orgId],
        )).rows[0]?.next ?? 1);
        if (input.isInitial) {
            await client.query("UPDATE workflow_states SET is_initial = FALSE WHERE project_id = $1 AND org_id = $2", [input.projectId, input.orgId]);
        }
        return (await client.query(
            `INSERT INTO workflow_states
                (org_id, project_id, key, name, category, color, icon, wip_limit, is_initial, is_terminal, sort_order)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
             RETURNING *`,
            [input.orgId, input.projectId, input.key, input.name, input.category, input.color, input.icon,
                input.wipLimit, input.isInitial, input.isTerminal, sortOrder],
        )).rows[0];
    });
}

export async function reorderProjectWorkflowStates(db: WorkflowDb, orgId: number, projectId: number, order: unknown[]): Promise<void> {
    await db.transaction(async (client) => {
        for (let index = 0; index < order.length; index += 1) {
            const stateId = Number.parseInt(String(order[index]), 10);
            if (!Number.isInteger(stateId)) continue;
            await client.query(
                "UPDATE workflow_states SET sort_order = $1 WHERE id = $2 AND project_id = $3 AND org_id = $4",
                [index + 1, stateId, projectId, orgId],
            );
        }
    });
}

export async function updateProjectWorkflowState(
    db: WorkflowDb,
    orgId: number,
    projectId: number,
    stateId: number,
    updates: Record<string, unknown>,
): Promise<void> {
    const allowedColumns: Record<string, string> = {
        name: "name",
        category: "category",
        color: "color",
        icon: "icon",
        wip_limit: "wip_limit",
        is_active: "is_active",
        is_terminal: "is_terminal",
        is_initial: "is_initial",
    };
    const sets: string[] = [];
    const params: unknown[] = [];
    for (const [key, value] of Object.entries(updates)) {
        const column = allowedColumns[key];
        if (!column) continue;
        params.push(value);
        sets.push(`${column} = $${params.length}`);
    }
    if (!sets.length) return;
    params.push(stateId, projectId, orgId);
    await db.query(
        `UPDATE workflow_states SET ${sets.join(", ")} WHERE id = $${params.length - 2} AND project_id = $${params.length - 1} AND org_id = $${params.length}`,
        params,
    );
}

export const setOtherProjectWorkflowStatesNonInitial = (db: WorkflowDb, orgId: number, projectId: number, stateId: number) =>
    db.query(
        "UPDATE workflow_states SET is_initial = FALSE WHERE project_id = $1 AND id <> $2 AND org_id = $3",
        [projectId, stateId, orgId],
    );

export const countTasksInWorkflowState = async (db: WorkflowDb, orgId: number, stateId: number): Promise<number> =>
    Number((await db.query(
        "SELECT COUNT(*)::int AS count FROM tasks WHERE workflow_state_id = $1 AND org_id = $2",
        [stateId, orgId],
    )).rows[0]?.count ?? 0);

export const deleteProjectWorkflowState = (db: WorkflowDb, orgId: number, projectId: number, stateId: number) =>
    db.query("DELETE FROM workflow_states WHERE id = $1 AND project_id = $2 AND org_id = $3", [stateId, projectId, orgId]);

export const listActiveProjectWorkflowStates = async (db: WorkflowDb, orgId: number, projectId: number) =>
    (await db.query(
        "SELECT id, key, category, is_terminal FROM workflow_states WHERE project_id = $1 AND org_id = $2 AND is_active = TRUE",
        [projectId, orgId],
    )).rows;

export async function replaceProjectWorkflowTransitions(
    db: WorkflowDb,
    orgId: number,
    projectId: number,
    edges: Array<{ from_state_id: number; to_state_id: number }>,
): Promise<void> {
    await db.transaction(async (client) => {
        await client.query("DELETE FROM workflow_transitions WHERE project_id = $1 AND org_id = $2", [projectId, orgId]);
        for (const edge of edges) {
            await client.query(
                `INSERT INTO workflow_transitions (org_id, project_id, from_state_id, to_state_id)
                 VALUES ($1, $2, $3, $4) ON CONFLICT (from_state_id, to_state_id) DO NOTHING`,
                [orgId, projectId, edge.from_state_id, edge.to_state_id],
            );
        }
    });
}

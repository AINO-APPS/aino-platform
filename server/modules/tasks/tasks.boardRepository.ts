import { projectTypePolicy, type TypedProject } from "./tasks.projectTypes";
import type { LifecycleDb } from "./tasks.workflowRules";
import { PLANNING_PARENT_SQL } from "./tasks.hierarchyRepository";
import { acquirePlacementLifecycleLock } from "./tasks.placementRepository";

export interface BoardProject extends TypedProject {
    id: number;
    org_id: number;
    is_archived?: boolean;
    enable_wip_limits?: boolean;
}

export async function findBoardProject(db: LifecycleDb, orgId: number | null, projectId: number) {
    return (await db.query("SELECT * FROM projects WHERE id = $1 AND org_id = $2", [projectId, orgId])).rows[0] as BoardProject | undefined;
}

export async function findBoardSprint(db: LifecycleDb, projectId: number, sprintId?: number) {
    return (await db.query(
        `SELECT * FROM sprints WHERE project_id = $1
            AND ${sprintId == null ? "status IN ('active', 'paused')" : "id = $2"}
         ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END, start_date DESC, id DESC LIMIT 1`,
        sprintId == null ? [projectId] : [projectId, sprintId],
    )).rows[0] ?? null;
}

/** The unfiltered board population is also the capacity population. */
export function boardPopulation(project: BoardProject, sprintId: number | null, backlog = false) {
    const policy = projectTypePolicy(project);
    const params: unknown[] = [project.org_id, project.id];
    const conditions = [
        "t.org_id = $1", "t.project_id = $2", "ws.is_active = TRUE", "ws.key <> 'cancelled'",
    ];
    if (backlog) {
        conditions.push(PLANNING_PARENT_SQL);
        conditions.push("t.completed_at IS NULL");
        conditions.push(policy.hasSprints ? "t.sprint_id IS NULL" : "ws.is_initial = TRUE");
    } else {
        conditions.push("(t.completed_at IS NULL OR t.completed_at >= NOW() - INTERVAL '14 days')");
        if (policy.hasSprints) {
            params.push(sprintId);
            conditions.push("t.sprint_id = $3");
        } else if (policy.hasBacklog) {
            conditions.push("ws.is_initial = FALSE");
        }
    }
    return { whereSql: conditions.join(" AND "), params };
}

export async function listProjectBoardTickets(db: LifecycleDb, project: BoardProject, sprintId: number | null, backlog = false) {
    const scope = boardPopulation(project, sprintId, backlog);
    return (await db.query(
        `SELECT t.*, ws.key AS workflow_state_key, ws.name AS workflow_state_name,
                ws.category AS workflow_state_category
           FROM tasks t JOIN workflow_states ws ON ws.id = t.workflow_state_id
          WHERE ${scope.whereSql}
          ORDER BY ${backlog ? "t.rank ASC NULLS LAST, t.created_at DESC" : "t.created_at ASC, t.id ASC"}`,
        scope.params,
    )).rows;
}

export async function writeBoardSettings(db: LifecycleDb, projectId: number, patch: { kanban_backlog_enabled?: boolean; enable_wip_limits?: boolean }) {
    return (await db.query(
        `UPDATE projects SET kanban_backlog_enabled = COALESCE($2, kanban_backlog_enabled),
                enable_wip_limits = COALESCE($3, enable_wip_limits), updated_at = NOW()
          WHERE id = $1 RETURNING *`,
        [projectId, patch.kanban_backlog_enabled ?? null, patch.enable_wip_limits ?? null],
    )).rows[0];
}

export async function targetBoardOccupancy(db: LifecycleDb, project: BoardProject,
    task: { id: number; sprint_id?: number | null }, targetId: number): Promise<number | null> {
    const sprint = projectTypePolicy(project).hasSprints ? await findBoardSprint(db, project.id) : null;
    if (projectTypePolicy(project).hasSprints && (sprint == null || Number(task.sprint_id) !== Number(sprint.id))) return null;
    const scope = boardPopulation(project, sprint?.id ?? null);
    const index = scope.params.length + 1;
    return Number((await db.query(
        `SELECT COUNT(*)::int AS c FROM tasks t JOIN workflow_states ws ON ws.id = t.workflow_state_id
          WHERE ${scope.whereSql} AND t.workflow_state_id = $${index} AND t.id <> $${index + 1}`,
        [...scope.params, targetId, task.id],
    )).rows[0]?.c ?? 0);
}

export async function lockBoardWrite(db: LifecycleDb, projectId: number, taskId: number, orgId: number | null) {
    await acquirePlacementLifecycleLock(db, orgId);
    await db.query("SELECT id FROM projects WHERE id = $1 AND org_id = $2 FOR UPDATE", [projectId, orgId]);
    return (await db.query("SELECT * FROM tasks WHERE id = $1 AND org_id = $2 FOR UPDATE", [taskId, orgId])).rows[0];
}

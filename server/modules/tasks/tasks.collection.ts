/**
 * The single builder for a set of tasks.
 *
 * Backlog, board and schedule all obtain their task sets here so the filter,
 * ordering and completed rules cannot drift apart. Callers supply the scope
 * (which container they are looking at) and the user's visibility; everything
 * else is shared.
 */

export type TaskCollectionScope = "backlog" | "board" | "schedule";

export type TaskVisibility =
    | { kind: "org-admin" }
    | { kind: "team"; userId: number; teamId: number }
    | { kind: "personal"; userId: number };

export interface TaskCollectionFilters {
    assignee?: string;
    label?: string;
    priority?: string;
    status?: string;
    search?: string;
    projectId?: string;
    workItemTypeId?: string;
    epicId?: string;
    includeCompleted?: boolean;
    completedSince?: string;
    /** Return only completed tasks (used for the collapsed Completed section). */
    completedOnly?: boolean;
    /**
     * Which completion states to return. Defaults to `all` so callers that have
     * not adopted the completed rule yet keep their existing behaviour.
     */
    completed?: "all" | "incomplete" | "completed";
    /** Schedule scope: also match tasks whose due date is the requested day. */
    includeDue?: boolean;
}

export interface TaskCollectionInput {
    scope: TaskCollectionScope;
    orgId: number | null;
    visibility: TaskVisibility;
    filters?: TaskCollectionFilters;
    /** Board scope only: the sprint whose tasks are being listed. */
    sprintId?: number;
    /** Schedule scope only: inclusive planned-date range. */
    startDate?: string;
    endDate?: string;
    /** Schedule scope only: a single planned date. */
    date?: string;
}

export interface TaskCollectionQuery {
    whereSql: string;
    params: unknown[];
    orderSql: string;
}

/**
 * The one definition of "complete" in the task domain.
 *
 * `completed_at` is maintained by the database from the workflow-state
 * category (see migration 0011), so it is the only field any query needs to
 * read. Nothing else may re-derive completion from `status` or a state join.
 */
export const COMPLETED_PREDICATE = "t.completed_at IS NOT NULL";
export const INCOMPLETE_PREDICATE = "t.completed_at IS NULL";

const PRIORITY_ORDER = `CASE t.priority WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 END`;
// Schedule ordering groups by workflow-state category, which is the only
// status the schema has (D4). A scalar subquery keeps the ordering usable by
// every caller without forcing a join into the collection SQL.
const STATUS_ORDER = `CASE (SELECT ws.category FROM workflow_states ws WHERE ws.id = t.workflow_state_id) WHEN 'in_progress' THEN 1 WHEN 'in_review' THEN 2 WHEN 'open' THEN 3 WHEN 'done' THEN 4 END`;

const ORDER_BY: Record<TaskCollectionScope, string> = {
    // Manual rank is the stored order; priority is a temporary sort the client
    // applies without touching it.
    backlog: "t.rank ASC NULLS LAST, t.created_at DESC",
    board: "t.created_at ASC",
    schedule: `${PRIORITY_ORDER}, ${STATUS_ORDER}, t.created_at ASC`,
};

const VALID_PRIORITIES = ["low", "medium", "high"];
/** Workflow-state keys are tenant-defined, so only the shape is validated. */
const STATUS_KEY_PATTERN = /^[A-Za-z0-9_-]{1,40}$/;

function parseId(value: string | undefined): number | null {
    if (value === undefined || value === null || value === "") return null;
    const parsed = Number.parseInt(String(value), 10);
    return Number.isNaN(parsed) ? null : parsed;
}

function escapeLike(value: string): string {
    return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

/**
 * Build the WHERE clause, parameters and ordering for a task collection.
 *
 * The returned SQL always aliases the tasks table as `t`.
 */
export function buildTaskCollection(input: TaskCollectionInput): TaskCollectionQuery {
    const conditions: string[] = [];
    const params: unknown[] = [];
    let pi = 1;

    const push = (sql: string, ...values: unknown[]) => {
        conditions.push(sql);
        params.push(...values);
        pi += values.length;
    };

    // ── Container scope ────────────────────────────────────────────────────
    if (input.scope === "backlog") {
        // Backlog is the only container dimension: not in a sprint. A planned
        // date is metadata and never removes a task from the backlog.
        conditions.push("t.sprint_id IS NULL");
    } else if (input.scope === "board") {
        push(`t.sprint_id = $${pi}`, input.sprintId);
    } else {
        if (input.sprintId !== undefined) {
            push(`t.sprint_id = $${pi}`, input.sprintId);
        } else if (input.startDate && input.endDate) {
            push(`t.planned_date >= $${pi} AND t.planned_date <= $${pi + 1}`, input.startDate, input.endDate);
        } else if (input.date) {
            if (input.filters?.includeDue) {
                push(
                    `(t.sprint_id IS NULL AND t.planned_date IS NOT NULL AND (t.planned_date = $${pi} OR t.due_date = $${pi}))`,
                    input.date,
                );
            } else {
                push(`t.planned_date = $${pi}`, input.date);
            }
        }
    }

    // ── Tenant ─────────────────────────────────────────────────────────────
    if (input.orgId) {
        push(`t.org_id = $${pi}`, input.orgId);
    } else {
        conditions.push("t.org_id IS NULL");
    }

    // ── Visibility ─────────────────────────────────────────────────────────
    if (input.visibility.kind === "team") {
        push(
            `(t.user_id = $${pi} OR t.assigned_to = $${pi} OR t.user_id IN (SELECT id FROM users WHERE team_id = $${pi + 1}))`,
            input.visibility.userId,
            input.visibility.teamId,
        );
    } else if (input.visibility.kind === "personal") {
        push(`(t.user_id = $${pi} OR t.assigned_to = $${pi})`, input.visibility.userId);
    }

    // ── Filters ────────────────────────────────────────────────────────────
    const filters = input.filters || {};

    if (filters.assignee) {
        const assigneeId = filters.assignee === "me"
            ? (input.visibility.kind === "org-admin" ? null : input.visibility.userId)
            : parseId(filters.assignee);
        if (assigneeId !== null) {
            push(
                `(t.assigned_to = $${pi} OR (t.user_id = $${pi} AND t.assigned_to IS NULL))`,
                assigneeId,
            );
        }
    }

    if (filters.priority && VALID_PRIORITIES.includes(filters.priority)) {
        push(`t.priority = $${pi}`, filters.priority);
    }

    if (filters.status && STATUS_KEY_PATTERN.test(filters.status)) {
        push(
            `t.workflow_state_id IN (SELECT id FROM workflow_states WHERE org_id = t.org_id AND key = $${pi})`,
            filters.status,
        );
    }

    if (filters.search && filters.search.trim()) {
        push(
            `(t.title ILIKE $${pi} ESCAPE '\\' OR t.description ILIKE $${pi} ESCAPE '\\')`,
            `%${escapeLike(filters.search.trim())}%`,
        );
    }

    const labelId = parseId(filters.label);
    if (labelId !== null) {
        push(`EXISTS (SELECT 1 FROM task_label_map tlm WHERE tlm.task_id = t.id AND tlm.label_id = $${pi})`, labelId);
    }

    const projectId = parseId(filters.projectId);
    if (projectId !== null) {
        push(`t.project_id = $${pi}`, projectId);
    }

    const workItemTypeId = parseId(filters.workItemTypeId);
    if (workItemTypeId !== null) {
        push(`t.work_item_type_id = $${pi}`, workItemTypeId);
    }

    const epicId = parseId(filters.epicId);
    if (epicId !== null) {
        push(`t.parent_task_id = $${pi}`, epicId);
    }

    // ── Completed rule ─────────────────────────────────────────────────────
    const completedMode = filters.completedOnly
        ? "completed"
        : filters.completed || (filters.includeCompleted ? "all" : "all");

    if (completedMode === "completed") {
        conditions.push(COMPLETED_PREDICATE);
        if (filters.completedSince) {
            push(`t.completed_at >= $${pi}`, filters.completedSince);
        }
    } else if (completedMode === "incomplete") {
        conditions.push(INCOMPLETE_PREDICATE);
    } else if (filters.completedSince) {
        push(`(${INCOMPLETE_PREDICATE} OR t.completed_at >= $${pi})`, filters.completedSince);
    }

    return {
        whereSql: conditions.join(" AND "),
        params,
        orderSql: ORDER_BY[input.scope],
    };
}

/** Completed tasks matching the same filters, for the collapsed section. */
export function buildCompletedQuery(input: TaskCollectionInput): TaskCollectionQuery {
    return buildTaskCollection({
        ...input,
        filters: { ...input.filters, includeCompleted: true, completedOnly: true },
    });
}

/** Minimal database port for the collection queries. */
export interface CollectionDb {
    query(sql: string, params?: unknown[]): Promise<{ rows: any[] }>;
}

/** Every task in one sprint, in board order, with its workflow state. */
export async function listSprintTasks(db: CollectionDb, orgId: number | null, sprintId: number) {
    const collection = buildTaskCollection({
        scope: "board",
        orgId,
        visibility: { kind: "org-admin" },
        sprintId,
    });
    return (await db.query(
        `SELECT t.*, ws.key AS workflow_state_key, ws.name AS workflow_state_name,
                ws.category AS workflow_state_category
           FROM tasks t
           LEFT JOIN workflow_states ws ON ws.id = t.workflow_state_id
          WHERE ${collection.whereSql}
          ORDER BY ${collection.orderSql}`,
        collection.params,
    )).rows;
}

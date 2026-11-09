/**
 * The single builder for a set of tasks.
 *
 * Backlog, board and schedule all obtain their task sets here so the filter,
 * ordering and completed rules cannot drift apart. Callers supply the scope
 * (which container they are looking at) and the user's visibility; everything
 * else is shared.
 */

import { buildVisibilityPredicate, type TaskVisibility } from "./tasks.policy";
import { PLANNING_PARENT_SQL } from "./tasks.hierarchyRepository";

export type { TaskVisibility };

/**
 * Project views are independent of legacy placement:
 *  - `list`     — every ticket in the selected project, regardless of dates.
 *  - `calendar` — open date spans overlapping a range, or undated open work.
 *
 * Compatibility collection scopes remain for older callers until retirement:
 * a sprint wins over a day, and a day wins over the backlog.
 *  - `backlog`   — no sprint, no planned day. A due date is a deadline, not a
 *                  container: it never moves a ticket out of the backlog.
 *  - `scheduled` — no sprint, a planned day (the Scheduled tab).
 *  - `board`     — one sprint.
 *  - `schedule`  — the legacy day/range lookup used by the planner and calendar.
 *
 * A due date used to win over the backlog too, so a ticket created from the
 * Backlog with a deadline vanished into Scheduled (and, on a sprint team whose
 * Scheduled tab is hidden, into nowhere). It is now metadata: it sorts, it
 * renders on the card, and it is never a reason to leave the backlog.
 */
export type TaskCollectionScope = "backlog" | "board" | "schedule" | "scheduled" | "list" | "calendar";

/** Completed scheduled work older than this drops out of the Scheduled tab. */
export const SCHEDULED_HISTORY_DAYS = 30;

const UNSPRINTED = "t.sprint_id IS NULL";
const UNPLANNED = "t.planned_date IS NULL";

function isoDaysBefore(iso: string, days: number): string {
    const d = new Date(`${iso}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - days);
    return d.toISOString().slice(0, 10);
}

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
    key?: string;
    title?: string;
    startOn?: string;
    dueOn?: string;
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
    /** Scheduled scope only: the caller's local today (YYYY-MM-DD). */
    today?: string;
    undated?: boolean;
    sort?: string;
    direction?: string;
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
    scheduled: `COALESCE(t.start_date, t.due_date) ASC, ${PRIORITY_ORDER}, t.created_at ASC`,
    schedule: `${PRIORITY_ORDER}, ${STATUS_ORDER}, t.created_at ASC`,
    list: "t.ticket_key ASC, t.id ASC",
    calendar: "COALESCE(t.start_date, t.due_date) ASC, t.id ASC",
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
    if (input.scope === "list" || input.scope === "calendar") {
        if (input.scope === "calendar") {
            conditions.push(INCOMPLETE_PREDICATE,
                "NOT EXISTS (SELECT 1 FROM workflow_states ws WHERE ws.id = t.workflow_state_id AND ws.key = 'cancelled')");
            if (input.undated) {
                conditions.push("t.start_date IS NULL", "t.due_date IS NULL");
            } else {
                const from = input.date ?? input.startDate;
                const to = input.date ?? input.endDate;
                push(`COALESCE(t.start_date, t.due_date) <= $${pi} AND COALESCE(t.due_date, t.start_date) >= $${pi + 1}`, to, from);
            }
        }
    } else if (input.scope === "backlog") {
        conditions.push(PLANNING_PARENT_SQL);
        // The collapsed Completed section lists every finished unsprinted
        // ticket, dated or not; the open list is unplanned only.
        if (input.filters?.completedOnly || input.filters?.completed === "completed") conditions.push(UNSPRINTED);
        else conditions.push(UNSPRINTED, UNPLANNED);
    } else if (input.scope === "scheduled") {
        conditions.push(UNSPRINTED, "t.start_date IS NOT NULL");
        if (input.today) {
            push(
                `(t.completed_at IS NULL OR t.completed_at >= $${pi})`,
                isoDaysBefore(input.today, SCHEDULED_HISTORY_DAYS),
            );
        }
    } else if (input.scope === "board") {
        push(`t.sprint_id = $${pi}`, input.sprintId);
    } else {
        if (input.sprintId !== undefined) {
            push(`t.sprint_id = $${pi}`, input.sprintId);
        } else if (input.startDate && input.endDate) {
            push(
                `t.start_date >= $${pi} AND t.start_date <= $${pi + 1}`,
                input.startDate,
                input.endDate,
            );
        } else if (input.date) {
            if (input.filters?.includeDue) {
                push(
                    `(t.start_date = $${pi} OR t.due_date = $${pi})`,
                    input.date,
                );
            } else {
                push(`t.start_date = $${pi}`, input.date);
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
    // One predicate builder for every surface (see tasks.policy). `team`
    // anchors on the ticket's own team; `legacy-team` is the flag-off
    // creator-team rule; org admins add no restriction.
    const visibility = buildVisibilityPredicate(input.visibility, pi);
    if (visibility.sql) {
        conditions.push(visibility.sql);
        params.push(...visibility.params);
        pi = visibility.nextIndex;
    }

    // ── Filters ────────────────────────────────────────────────────────────
    const filters = input.filters || {};

    for (const [value, column] of [[filters.key, "t.ticket_key"], [filters.title, "t.title"]] as const) {
        if (value?.trim()) push(`${column} ILIKE $${pi} ESCAPE '\\'`, `%${escapeLike(value.trim())}%`);
    }
    if (filters.startOn) push(`t.start_date = $${pi}`, filters.startOn);
    if (filters.dueOn) push(`t.due_date = $${pi}`, filters.dueOn);

    if (filters.assignee) {
        if (filters.assignee === "unassigned") {
            conditions.push("t.assigned_to IS NULL");
        } else {
            const visibilityUserId = "userId" in input.visibility ? input.visibility.userId : null;
            const assigneeId = filters.assignee === "me"
                ? visibilityUserId
                : parseId(filters.assignee);
            if (assigneeId !== null) {
                push(
                    input.scope === "list" || input.scope === "calendar"
                        ? `t.assigned_to = $${pi}`
                        : `(t.assigned_to = $${pi} OR (t.user_id = $${pi} AND t.assigned_to IS NULL))`,
                    assigneeId,
                );
            }
        }
    }

    if (filters.priority && VALID_PRIORITIES.includes(filters.priority)) {
        push(`t.priority = $${pi}`, filters.priority);
    }

    if (filters.status && STATUS_KEY_PATTERN.test(filters.status)) {
        push(
            `t.workflow_state_id IN (SELECT id FROM workflow_states WHERE org_id = t.org_id AND project_id = t.project_id AND key = $${pi})`,
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
        orderSql: input.scope === "list" && input.sort && Object.hasOwn(LIST_SORT, input.sort)
            ? `${LIST_SORT[input.sort]} ${input.direction === "desc" ? "DESC" : "ASC"} NULLS LAST, t.id ASC`
            : ORDER_BY[input.scope],
    };
}

const LIST_SORT: Record<string, string> = {
    key: "t.ticket_key", title: "LOWER(t.title)",
    type: "(SELECT name FROM work_item_types WHERE id = t.work_item_type_id)",
    status: "(SELECT name FROM workflow_states WHERE id = t.workflow_state_id)",
    assignee: "(SELECT LOWER(COALESCE(full_name, username)) FROM users WHERE id = t.assigned_to)",
    priority: PRIORITY_ORDER, start_date: "t.start_date", due_date: "t.due_date",
};

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

export async function readTaskCollection(db: CollectionDb, collection: TaskCollectionQuery, offset = 0, paginated = false) {
    return (await db.query(
        `SELECT t.* FROM tasks t WHERE ${collection.whereSql}
         ORDER BY ${collection.orderSql} LIMIT ${paginated ? 501 : 500} OFFSET $${collection.params.length + 1}`,
        [...collection.params, offset],
    )).rows;
}

/**
 * Every task in one sprint, in board order, with its workflow state.
 *
 * The caller must already have authorised the sprint; `visibility` then
 * applies the same ticket policy as every other list.
 */
export async function listSprintTasks(
    db: CollectionDb,
    orgId: number | null,
    sprintId: number,
    visibility: TaskVisibility = { kind: "org-admin" },
) {
    const collection = buildTaskCollection({
        scope: "board",
        orgId,
        visibility,
        sprintId,
    });
    // Cancelled is a terminal outcome, not a board column: the ticket stays
    // readable in detail and under the completed filter, but it never sits in
    // a column. The exclusion lives here rather than in the shared builder so
    // the backlog's completed rule stays the single "complete" definition.
    return (await db.query(
        `SELECT t.*, ws.key AS workflow_state_key, ws.name AS workflow_state_name,
                ws.category AS workflow_state_category
           FROM tasks t
           LEFT JOIN workflow_states ws ON ws.id = t.workflow_state_id
          WHERE ${collection.whereSql}
            AND NOT EXISTS (
                SELECT 1 FROM workflow_states active
                 WHERE active.id = t.workflow_state_id AND active.key = 'cancelled'
            )
          ORDER BY ${collection.orderSql}`,
        collection.params,
    )).rows;
}

/**
 * The board's column vocabulary and the seam to its target rules.
 *
 * Issue 04 turns the workflow graph and WIP limits into hard rules; the board
 * then refuses a column and explains why. Until then every rendered column is
 * legal, so the default policy allows all of them.
 */

export interface BoardColumn {
    id?: number | string;
    key?: string;
    name?: string;
    category?: string;
    is_terminal?: boolean;
    wip_limit?: number | null;
    [key: string]: unknown;
}

export interface BoardTask {
    id: number | string;
    title?: string;
    /** The workflow state is the only status (D4). */
    workflow_state_id?: number | string | null;
    workflow_state_key?: string | null;
    is_blocked?: boolean;
    acceptance_criteria?: unknown[] | null;
    [key: string]: unknown;
}

/**
 * A policy returns `null` when the column may take the ticket, or a short
 * reason when it may not.
 */
export type TargetPolicy = (task: BoardTask, column: BoardColumn) => string | null;

/** Every column is a legal target: the behaviour before the lifecycle lands. */
export const allowAllTargets: TargetPolicy = () => null;

function hasKey(column: BoardColumn): boolean {
    return typeof column.key === "string" && column.key !== "";
}

/**
 * Keys identify a workflow state; ids are not unique before `/agile` resolves
 * (every fallback state shares `id: 0`), so a key always wins.
 */
export function sameColumn(
    a: BoardColumn | undefined,
    b: BoardColumn | undefined,
): boolean {
    if (!a || !b) return false;
    if (hasKey(a) && hasKey(b)) return a.key === b.key;
    return a.id != null && b.id != null && a.id === b.id;
}

/** The stable handle for a column: its key, else its id. */
export function columnRef(column: BoardColumn): string | number | null {
    return hasKey(column) ? (column.key as string) : (column.id ?? null);
}

/** Resolve a stored key-or-id back to the rendered column. */
export function findColumn(
    columns: BoardColumn[],
    ref: string | number | null,
): BoardColumn | undefined {
    if (ref == null) return undefined;
    return (
        columns.find((column) => hasKey(column) && column.key === ref) ??
        columns.find((column) => column.id === ref)
    );
}

/** The column a ticket currently sits in. */
export function columnOf(
    task: BoardTask,
    columns: BoardColumn[],
): BoardColumn | undefined {
    if (task.workflow_state_key) {
        const byKey = columns.find(
            (column) => column.key === task.workflow_state_key,
        );
        if (byKey) return byKey;
    }
    if (task.workflow_state_id) {
        return columns.find((column) => column.id === task.workflow_state_id);
    }
    return undefined;
}

function isDoneColumn(column: BoardColumn | undefined): boolean {
    return Boolean(column && (column.category === "done" || column.is_terminal));
}

/** An advisory shown when a ticket enters a done state with loose ends. */
export function doneAdvisory(
    task: BoardTask,
    column: BoardColumn,
): string | null {
    if (!isDoneColumn(column)) return null;
    if (task.is_blocked) return "This ticket has an open blocker.";
    const criteria = task.acceptance_criteria;
    const unchecked =
        Array.isArray(criteria) &&
        criteria.some(
            (item: any) => item && typeof item === "object" && item.done === false,
        );
    return unchecked ? "This ticket has unchecked acceptance criteria." : null;
}

/** The ticket count of a column, matched the same way the board matches it. */
function occupancyOf(column: BoardColumn, tasks: BoardTask[]): number {
    return tasks.filter(
        (task) =>
            (hasKey(column) && task.workflow_state_key === column.key) ||
            (column.id != null &&
                column.id !== 0 &&
                task.workflow_state_id === column.id),
    ).length;
}

/** Advisory when a column is already at or over its WIP limit. */
export function wipAdvisory(
    column: BoardColumn,
    tasks: BoardTask[],
): string | null {
    if (!column.wip_limit) return null;
    const occupancy = occupancyOf(column, tasks);
    if (occupancy < column.wip_limit) return null;
    return `${column.name ?? "This column"} is over its WIP limit (${occupancy}/${column.wip_limit}).`;
}

/** Everything worth warning about before a move is confirmed. */
export function moveAdvisory(
    task: BoardTask,
    column: BoardColumn,
    tasks: BoardTask[],
): string | null {
    return (
        [doneAdvisory(task, column), wipAdvisory(column, tasks)]
            .filter(Boolean)
            .join(" ") || null
    );
}

/** The columns the board shows: every workflow state except Cancelled. */
export function boardColumns(
    states: any[] | null | undefined,
): BoardColumn[] {
    return (states || []).filter(
        (state) => state && state.key !== "cancelled",
    );
}

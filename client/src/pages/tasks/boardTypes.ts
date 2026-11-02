import type { TicketTransitionCapability } from "../../types/generated/tasks";

export interface BoardColumn {
    id: number;
    stateId: number;
    key?: string;
    name?: string;
    category?: string;
    is_initial?: boolean;
    is_terminal?: boolean;
    count: number;
    limit: number | null;
    accepting: boolean;
    color?: string;
}

export interface BoardTask {
    id: number | string;
    title?: string;
    workflow_state_id?: number | string | null;
    workflow_state_key?: string | null;
    is_blocked?: boolean;
    acceptance_criteria?: unknown[] | null;
    capabilities?: { transitions: TicketTransitionCapability[] } | null;
    [key: string]: unknown;
}

export function sameColumn(
    a: BoardColumn | undefined,
    b: BoardColumn | undefined,
): boolean {
    if (!a || !b) return false;
    return String(a.stateId) === String(b.stateId);
}

export function columnRef(column: BoardColumn): string | number {
    return column.key ?? column.stateId;
}

export function findColumn(
    columns: BoardColumn[],
    ref: string | number | null,
): BoardColumn | undefined {
    if (ref == null) return undefined;
    return columns.find(
        (column) => String(column.key ?? column.stateId) === String(ref),
    );
}

export function columnOf(
    task: BoardTask,
    columns: BoardColumn[],
): BoardColumn | undefined {
    const byKey = task.workflow_state_key
        ? columns.find((column) => column.key === task.workflow_state_key)
        : undefined;
    if (byKey) return byKey;
    return columns.find(
        (column) =>
            task.workflow_state_id != null &&
            String(column.stateId) === String(task.workflow_state_id),
    );
}

/** Advisory shown before moving a ticket into a done state with loose ends. */
export function doneAdvisory(
    task: BoardTask,
    column: BoardColumn,
): string | null {
    if (column.category !== "done" && !column.is_terminal) return null;
    if (task.is_blocked) return "This ticket has an open blocker.";
    const unchecked = task.acceptance_criteria?.some(
        (item: any) => item && typeof item === "object" && item.done === false,
    );
    return unchecked ? "This ticket has unchecked acceptance criteria." : null;
}

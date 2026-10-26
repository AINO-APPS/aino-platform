/**
 * The board's view of the enforced lifecycle.
 *
 * The server is authoritative: an illegal move returns `409 INVALID_TRANSITION`
 * or `409 WIP_EXCEEDED` and the card snaps back. The board uses the same graph
 * and WIP capacity to refuse the target before the user drops on it, so the
 * confirmation never offers a move that will fail.
 *
 * The rules mirror `server/modules/tasks/tasks.workflow.ts` and spec §5.3:
 *   - within a category: every direction;
 *   - forward or backward to the adjacent category;
 *   - to any Done state from any state except the initial one;
 *   - from Done, reopen into the first in-progress state;
 *   - from any non-terminal state to Cancelled; Cancelled has no exit.
 *
 * Stored `workflow_transitions` rows win for every origin state that has them;
 * an origin without rows falls back to the derivation.
 */

import {
    wipAdvisory,
    type BoardColumn,
    type BoardTask,
    type TargetPolicy,
} from "./boardTargets";

export interface WorkflowStateLike {
    id?: number | string;
    key: string;
    name?: string;
    category?: string;
    is_initial?: boolean;
    is_terminal?: boolean;
    is_active?: boolean;
    sort_order?: number;
    wip_limit?: number | null;
}

export interface WorkflowTransitionLike {
    from_state_id: number | string;
    to_state_id: number | string;
}

export interface WorkflowGraphInput {
    states?: WorkflowStateLike[] | null;
    transitions?: WorkflowTransitionLike[] | null;
}

const CATEGORY_RANK: Record<string, number> = {
    open: 0,
    in_progress: 1,
    in_review: 2,
    done: 3,
};

export const CANCELLED_KEY = "cancelled";

function rankOf(category: string | undefined): number {
    return category && CATEGORY_RANK[category] != null ? CATEGORY_RANK[category] : 0;
}

function isCancelled(state: { key?: string }): boolean {
    return state.key === CANCELLED_KEY;
}

function bySortOrder(a: WorkflowStateLike, b: WorkflowStateLike): number {
    const order = (a.sort_order ?? 0) - (b.sort_order ?? 0);
    if (order !== 0) return order;
    return Number(a.id ?? 0) - Number(b.id ?? 0);
}

/** Derive the allowed target keys for every origin key. */
export function deriveTransitionTargets(
    states: WorkflowStateLike[] = [],
): Map<string, Set<string>> {
    const active = states.filter((state) => state.is_active !== false);
    const targets = new Map<string, Set<string>>();
    const add = (from: WorkflowStateLike, to: WorkflowStateLike) => {
        const set = targets.get(from.key) ?? new Set<string>();
        set.add(to.key);
        targets.set(from.key, set);
    };
    const firstInProgress = active
        .filter((state) => state.category === "in_progress")
        .sort(bySortOrder)[0];

    for (const from of active) {
        if (isCancelled(from)) continue;

        for (const to of active) {
            if (from === to || from.key === to.key) continue;

            if (isCancelled(to)) {
                if (!from.is_terminal && from.category !== "done") add(from, to);
                continue;
            }

            if (from.category === "done") {
                if (to.category === "done" || (firstInProgress && to.key === firstInProgress.key)) {
                    add(from, to);
                }
                continue;
            }

            const fromRank = rankOf(from.category);
            const toRank = rankOf(to.category);

            if (from.category === to.category) {
                add(from, to);
            } else if (toRank === fromRank + 1 || toRank === fromRank - 1) {
                add(from, to);
            } else if (to.category === "done" && !(fromRank === 0 && from.is_initial)) {
                // Any state may finish work except the initial one, which must
                // start moving first (the default matrix's New row).
                add(from, to);
            }
        }
    }

    return targets;
}

function keyById(states: WorkflowStateLike[]): Map<string, string> {
    const map = new Map<string, string>();
    for (const state of states) {
        if (state.id != null) map.set(String(state.id), state.key);
    }
    return map;
}

/** The target keys reachable from one origin key. */
export function allowedTargetKeys(
    fromKey: string,
    input: WorkflowGraphInput = {},
): Set<string> {
    const states = input.states ?? [];
    const transitions = input.transitions ?? [];
    const ids = keyById(states);
    const explicit = new Map<string, Set<string>>();
    for (const edge of transitions) {
        const from = ids.get(String(edge.from_state_id));
        const to = ids.get(String(edge.to_state_id));
        if (!from || !to) continue;
        const set = explicit.get(from) ?? new Set<string>();
        set.add(to);
        explicit.set(from, set);
    }

    const stored = explicit.get(fromKey);
    if (stored && stored.size > 0) return stored;
    return deriveTransitionTargets(states).get(fromKey) ?? new Set<string>();
}

/** The state a ticket currently sits in, matched by key then id. */
function stateOfTask(
    task: BoardTask,
    states: WorkflowStateLike[],
): WorkflowStateLike | undefined {
    if (task.workflow_state_key) {
        const byKey = states.find((state) => state.key === task.workflow_state_key);
        if (byKey) return byKey;
    }
    if (task.workflow_state_id != null) {
        return states.find((state) => String(state.id) === String(task.workflow_state_id));
    }
    return undefined;
}

/**
 * Why this ticket may not move to that state, or null.
 *
 * `occupancy` is only consulted when WIP is enabled and the target has a
 * limit; the board passes its own tickets so the check matches what the user
 * sees in the column.
 */
export function workflowTargetReason(
    task: BoardTask,
    target: { key?: string; name?: string; wip_limit?: number | null } & BoardColumn,
    graph: WorkflowGraphInput,
    tasks: BoardTask[] = [],
    wipEnabled = false,
): string | null {
    if (!target?.key) return null;
    if (isCancelled(target)) return "Cancelled is not a board column.";

    const stateStates = graph.states ?? [];
    const from = stateOfTask(task, stateStates);
    // Before the config resolves there is no graph; never block the board.
    if (!from) return null;
    if (from.key === target.key) return null;

    if (!allowedTargetKeys(from.key, { states: stateStates, transitions: graph.transitions ?? [] }).has(target.key)) {
        return `"${from.name ?? from.key}" cannot move to "${target.name ?? target.key}".`;
    }

    if (wipEnabled && target.wip_limit) {
        const advisory = wipAdvisory(target as BoardColumn, tasks);
        if (advisory) return advisory;
    }
    return null;
}

/** A `TargetPolicy` wired to the tenant's graph and WIP setting. */
export function workflowTargetPolicy(
    input: WorkflowGraphInput & { tasks?: BoardTask[]; wipEnabled?: boolean } = {},
): TargetPolicy {
    const states = input.states ?? [];
    const transitions = input.transitions ?? [];
    const tasks = input.tasks ?? [];
    const wipEnabled = !!input.wipEnabled;
    return (task, column) =>
        workflowTargetReason(task, column as any, { states, transitions }, tasks, wipEnabled);
}

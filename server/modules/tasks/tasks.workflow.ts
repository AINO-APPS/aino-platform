/**
 * The enforced ticket lifecycle.
 *
 * One module owns the answers to "may this ticket move there?" and "is there
 * room in that column?". Every write path (PATCH status, full update, bulk,
 * cancel) asks it, so the rules cannot drift between routes.
 *
 * The graph comes from `workflow_transitions` rows when an origin state has
 * them. Otherwise it is derived from the workflow categories (spec §5.3), which
 * covers orgs that predate the seed migration and custom states added after it.
 *
 * Create is deliberately exempt: a ticket has no "from" state yet.
 */

export type WorkflowCategory = "open" | "in_progress" | "in_review" | "done";

export interface WorkflowState {
    id: number;
    key: string;
    name: string;
    category: WorkflowCategory;
    is_initial?: boolean;
    is_terminal?: boolean;
    is_active?: boolean;
    sort_order?: number;
    wip_limit?: number | null;
}

export interface Transition {
    from: number;
    to: number;
}

export interface LifecycleContext {
    states: WorkflowState[];
    stateById: Map<number, WorkflowState>;
    /** Explicit rows, grouped by origin state. */
    rowsByFrom: Map<number, Set<number>>;
    /** The graph derived from categories, for origins without rows. */
    derivedByFrom: Map<number, Set<number>>;
    wipEnabled: boolean;
}

export interface Conflict {
    status: number;
    body: { error: string; code: string; [key: string]: unknown };
}

export const CANCELLED_KEY = "cancelled";
export const INVALID_TRANSITION = "INVALID_TRANSITION";
export const WIP_EXCEEDED = "WIP_EXCEEDED";

const CATEGORY_RANK: Record<WorkflowCategory, number> = {
    open: 0,
    in_progress: 1,
    in_review: 2,
    done: 3,
};

function rankOf(category: WorkflowCategory | undefined): number {
    return category ? CATEGORY_RANK[category] : 0;
}

export function isCancelled(state: Pick<WorkflowState, "key"> | null | undefined): boolean {
    return !!state && state.key === CANCELLED_KEY;
}

function bySortOrder(a: WorkflowState, b: WorkflowState): number {
    const order = (a.sort_order ?? 0) - (b.sort_order ?? 0);
    return order !== 0 ? order : a.id - b.id;
}

/**
 * Derive the allowed (from → to) edges from the state categories.
 *
 * The rules, which reproduce the default matrix in the spec exactly:
 *   - within a category, every direction;
 *   - forward or backward to the adjacent category;
 *   - to any Done state from any state except the initial one (spec §5.3 says
 *     "any active state"; the default matrix forbids New → Done, so the
 *     initial state is the one exception);
 *   - from Done, reopen into the first in-progress state;
 *   - from any non-terminal state to Cancelled; Cancelled has no exit.
 */
export function deriveTransitions(states: WorkflowState[]): Transition[] {
    const active = states.filter((state) => state.is_active !== false);
    const firstInProgress = active
        .filter((state) => state.category === "in_progress")
        .sort(bySortOrder)[0];
    const edges: Transition[] = [];

    for (const from of active) {
        if (isCancelled(from)) continue; // Cancelled is terminal.

        for (const to of active) {
            if (from.id === to.id) continue;

            if (isCancelled(to)) {
                // Done cannot be cancelled directly; every other live state can.
                if (!from.is_terminal && from.category !== "done") {
                    edges.push({ from: from.id, to: to.id });
                }
                continue;
            }

            if (from.category === "done") {
                // Done reopens into the first in-progress state. Another Done
                // state is reachable within the category.
                if (to.category === "done" || (firstInProgress && to.id === firstInProgress.id)) {
                    edges.push({ from: from.id, to: to.id });
                }
                continue;
            }

            const fromRank = rankOf(from.category);
            const toRank = rankOf(to.category);

            if (from.category === to.category) {
                edges.push({ from: from.id, to: to.id });
            } else if (toRank === fromRank + 1 || toRank === fromRank - 1) {
                edges.push({ from: from.id, to: to.id });
            } else if (to.category === "done" && !(fromRank === 0 && from.is_initial)) {
                // Any state may finish work except the initial one, which must
                // start moving first (the default matrix's New row).
                edges.push({ from: from.id, to: to.id });
            }
        }
    }

    return edges;
}

function group(edges: Transition[]): Map<number, Set<number>> {
    const grouped = new Map<number, Set<number>>();
    for (const edge of edges) {
        const targets = grouped.get(edge.from) ?? new Set<number>();
        targets.add(edge.to);
        grouped.set(edge.from, targets);
    }
    return grouped;
}

export function buildLifecycleContext(
    states: WorkflowState[],
    transitions: Transition[] = [],
    wipEnabled = false,
): LifecycleContext {
    const active = states.filter((state) => state.is_active !== false);
    return {
        states: active,
        stateById: new Map(active.map((state) => [Number(state.id), state])),
        rowsByFrom: group(transitions),
        derivedByFrom: group(deriveTransitions(active)),
        wipEnabled,
    };
}

/**
 * May a ticket move from `fromId` to `toId`?
 *
 * A state the server cannot see (inactive, deleted, or not loaded) is never
 * second-guessed: there is no graph to apply, so the move is allowed.
 */
export function allowsTransition(
    context: LifecycleContext,
    fromId: number | string | null | undefined,
    toId: number | string | null | undefined,
): boolean {
    if (fromId == null || fromId === "" || toId == null || toId === "") return true;
    const from = Number(fromId);
    const to = Number(toId);
    if (from === to) return true;
    if (!context.stateById.has(from) || !context.stateById.has(to)) return true;

    const explicit = context.rowsByFrom.get(from);
    const graph = explicit && explicit.size > 0
        ? explicit
        : context.derivedByFrom.get(from);
    return graph ? graph.has(to) : false;
}

/** The state a ticket currently occupies, or null when it has none. */
export function stateOf(
    context: LifecycleContext | null | undefined,
    task: { workflow_state_id?: number | string | null } | null | undefined,
): WorkflowState | null {
    if (!context || task?.workflow_state_id == null) return null;
    return context.stateById.get(Number(task.workflow_state_id)) ?? null;
}

/**
 * The full graph the server enforces: stored rows plus derived edges for every
 * origin that has none. Used to hand the client the same graph it will be held
 * to, so the board does not need its own copy of the rules.
 */
export function effectiveTransitionRows(
    context: LifecycleContext,
): Array<{ from_state_id: number; to_state_id: number }> {
    return effectiveTransitions(context).map((edge) => ({
        from_state_id: edge.from,
        to_state_id: edge.to,
    }));
}

export function effectiveTransitions(context: LifecycleContext): Transition[] {
    const edges: Transition[] = [];
    for (const [from, targets] of context.rowsByFrom) {
        for (const to of targets) edges.push({ from, to });
    }
    for (const [from, targets] of context.derivedByFrom) {
        if (context.rowsByFrom.get(from)?.size) continue; // explicit rows win
        for (const to of targets) edges.push({ from, to });
    }
    return edges;
}

function targetNames(context: LifecycleContext, fromId: number): string[] {
    const graph = context.rowsByFrom.get(fromId)?.size
        ? context.rowsByFrom.get(fromId)!
        : context.derivedByFrom.get(fromId);
    if (!graph) return [];
    return [...graph]
        .map((id) => context.stateById.get(id)?.name)
        .filter((name): name is string => !!name);
}

/**
 * The refusal for an illegal move, or null when it is allowed.
 *
 * The message names both ends and the legal alternatives, because the client
 * shows it verbatim next to the ticket.
 */
export function transitionConflict(
    context: LifecycleContext,
    fromId: number | string | null | undefined,
    target: Pick<WorkflowState, "id" | "name"> | null | undefined,
): Conflict | null {
    if (!target) return null;
    if (allowsTransition(context, fromId, target.id)) return null;

    const from = fromId == null ? undefined : context.stateById.get(Number(fromId));
    const fromName = from?.name ?? "its current state";
    const alternatives = from ? targetNames(context, from.id) : [];
    const suffix = alternatives.length
        ? ` Allowed from "${fromName}": ${alternatives.join(", ")}.`
        : "";
    return {
        status: 409,
        body: {
            error: `"${fromName}" cannot move to "${target.name}".${suffix}`,
            code: INVALID_TRANSITION,
            from_state_id: from?.id ?? null,
            to_state_id: target.id,
        },
    };
}

/** The refusal when the destination column is full, or null. */
export function wipConflict(
    context: LifecycleContext,
    target: { id: number; name?: string; wip_limit?: number | null } | null | undefined,
    occupancy: number,
): Conflict | null {
    if (!target || !target.wip_limit) return null;
    if (!context.wipEnabled) return null;
    if (occupancy < target.wip_limit) return null;
    return {
        status: 409,
        body: {
            error: `WIP limit reached for "${target.name ?? "this column"}" (${occupancy}/${target.wip_limit}). ` +
                "Move a ticket out of this column first.",
            code: WIP_EXCEEDED,
            wip_limit: target.wip_limit,
            occupancy,
        },
    };
}

export interface LifecycleDb {
    query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }>;
}

/** Load the org's states, explicit rows and WIP setting in three queries. */
export async function loadLifecycleContext(
    db: LifecycleDb,
    orgId: number | null | undefined,
): Promise<LifecycleContext> {
    if (!orgId) return buildLifecycleContext([], [], false);

    const states = (await db.query(
        `SELECT id, key, name, category, is_initial, is_terminal, is_active, sort_order, wip_limit
           FROM workflow_states
          WHERE org_id = $1 AND is_active = TRUE
          ORDER BY sort_order ASC, id ASC`,
        [orgId],
    )).rows as WorkflowState[];

    const transitions = (await db.query(
        "SELECT from_state_id, to_state_id FROM workflow_transitions WHERE org_id = $1",
        [orgId],
    )).rows.map((row: any) => ({
        from: Number(row.from_state_id),
        to: Number(row.to_state_id),
    }));

    const settings = (await db.query(
        "SELECT enable_wip_limits FROM org_agile_settings WHERE org_id = $1",
        [orgId],
    )).rows[0];

    return buildLifecycleContext(states, transitions, !!settings?.enable_wip_limits);
}

/**
 * Persist the derived graph for an org.
 *
 * Called when an admin adds, edits or removes a workflow state so the explicit
 * rows keep up with the category rules. Existing rows are never deleted: an
 * admin may have narrowed an origin deliberately.
 */
export async function seedOrgTransitions(
    db: LifecycleDb,
    orgId: number | null | undefined,
): Promise<void> {
    if (!orgId) return;
    const states = (await db.query(
        `SELECT id, key, name, category, is_initial, is_terminal, is_active, sort_order
           FROM workflow_states
          WHERE org_id = $1 AND is_active = TRUE
          ORDER BY sort_order ASC, id ASC`,
        [orgId],
    )).rows as WorkflowState[];
    const edges = deriveTransitions(states);
    if (edges.length === 0) return;
    await db.query(
        `INSERT INTO workflow_transitions (org_id, from_state_id, to_state_id)
         SELECT $1, edge.from_state_id, edge.to_state_id
           FROM UNNEST($2::int[], $3::int[]) AS edge(from_state_id, to_state_id)
         ON CONFLICT (from_state_id, to_state_id) DO NOTHING`,
        [orgId, edges.map((edge) => edge.from), edges.map((edge) => edge.to)],
    );
}

async function occupancyOf(db: LifecycleDb, orgId: number | null, stateId: number, taskId: number) {
    const row = (await db.query(
        `SELECT COUNT(*)::int AS c FROM tasks
          WHERE workflow_state_id = $1 AND id != $2 AND org_id = $3`,
        [stateId, taskId, orgId],
    )).rows[0];
    return Number(row?.c ?? 0);
}

/**
 * Validate one move, end to end: the transition graph and the WIP capacity of
 * the destination. Returns null when the move may proceed.
 */
export async function assertLifecycleMove(
    db: LifecycleDb,
    orgId: number | null | undefined,
    task: { id: number; workflow_state_id?: number | string | null },
    target: (Pick<WorkflowState, "id" | "name"> & { wip_limit?: number | null }) | null | undefined,
    context?: LifecycleContext,
): Promise<Conflict | null> {
    if (!target) return null;
    // Re-entering the same state changes nothing, so neither the graph nor
    // the column's capacity applies.
    if (task.workflow_state_id != null && Number(task.workflow_state_id) === Number(target.id)) return null;

    const lifecycle = context ?? await loadLifecycleContext(db, orgId);

    const transition = transitionConflict(lifecycle, task.workflow_state_id, target);
    if (transition) return transition;

    if (!lifecycle.wipEnabled || !target.wip_limit) return null;
    const occupancy = await occupancyOf(db, orgId ?? null, target.id, task.id);
    return wipConflict(lifecycle, target, occupancy);
}

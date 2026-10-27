/**
 * Field-level task deltas.
 *
 * Two people editing the same ticket must not overwrite each other's unrelated
 * changes, so a broadcast carries only the fields that actually changed plus
 * who changed them and when. Clients apply the delta to whatever they already
 * hold instead of replacing the whole object.
 */

/** Fields a delta may carry. Anything else is dropped before broadcast. */
export const DELTA_FIELDS = [
    "title",
    "description",
    "priority",
    "assigned_to",
    "due_date",
    "planned_date",
    "sprint_id",
    "story_points",
    "work_item_type_id",
    "workflow_state_id",
    "status",
    "parent_task_id",
    "is_blocked",
    "blocked_reason",
    "project_id",
    "rank",
    "estimated_minutes",
    "logged_minutes",
    "acceptance_criteria",
        // A transfer changes the ticket's owning team. Without this the delta
        // dropped the field and clients never learned a ticket moved teams.
        "team_id",
    ] as const;

export type DeltaField = (typeof DELTA_FIELDS)[number];

export interface TaskDelta {
    taskId: number;
    /** Only the fields that changed, with their new values. */
    fields: Partial<Record<DeltaField, unknown>>;
    /** Who made the change, so the card can attribute it. */
    actor: { id: number; name: string | null } | null;
    /** ISO timestamp of the write; the later write wins on conflict. */
    at: string;
}

const FIELD_SET = new Set<string>(DELTA_FIELDS);

function same(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (a === null || a === undefined) return b === null || b === undefined || b === "";
    if (b === null || b === undefined) return a === "";
    // Postgres returns NUMERIC as a string ("8.00") while the client sends a
    // number (8); compare numerically so an unchanged value is not a delta.
    const na = Number(a);
    const nb = Number(b);
    if (Number.isFinite(na) && Number.isFinite(nb)) return na === nb;
    if (typeof a === "object" || typeof b === "object") {
        return JSON.stringify(a) === JSON.stringify(b);
    }
    return String(a) === String(b);
}

/**
 * The fields that differ between two snapshots of the same task.
 *
 * Only allow-listed fields are considered, so a caller cannot smuggle an
 * arbitrary column into a broadcast.
 */
export function diffTask(
    before: Record<string, unknown> | null | undefined,
    after: Record<string, unknown> | null | undefined,
): Partial<Record<DeltaField, unknown>> {
    if (!after) return {};
    const fields: Partial<Record<DeltaField, unknown>> = {};
    for (const field of DELTA_FIELDS) {
        if (!FIELD_SET.has(field)) continue;
        if (!same(before?.[field], after[field])) {
            fields[field] = after[field] ?? null;
        }
    }
    return fields;
}

/** True when a delta carries nothing worth broadcasting. */
export function isEmptyDelta(fields: Partial<Record<DeltaField, unknown>>): boolean {
    return Object.keys(fields).length === 0;
}

/**
 * Apply a delta to a task the client already holds.
 *
 * Fields absent from the delta are left alone, which is what makes two
 * simultaneous edits to different fields both survive. A delta older than the
 * one already applied is ignored, so the later write wins deterministically.
 */
export function applyTaskDelta<T extends Record<string, any>>(
    task: T,
    delta: { fields: Partial<Record<DeltaField, unknown>>; at?: string | null },
    lastAppliedAt?: string | null,
): T {
    if (delta.at && lastAppliedAt && delta.at < lastAppliedAt) return task;
    const next: Record<string, any> = { ...task };
    for (const [field, value] of Object.entries(delta.fields || {})) {
        if (!FIELD_SET.has(field)) continue;
        next[field] = value;
    }
    return next as T;
}

/**
 * Build the broadcast payload.
 *
 * `fields` is omitted entirely when nothing changed so a no-op write does not
 * wake every client.
 */
export function buildTaskDelta(
    taskId: number,
    fields: Partial<Record<DeltaField, unknown>>,
    actor: { id: number; name?: string | null } | null,
    at: string = new Date().toISOString(),
): TaskDelta | null {
    if (isEmptyDelta(fields)) return null;
    return {
        taskId,
        fields,
        actor: actor ? { id: actor.id, name: actor.name ?? null } : null,
        at,
    };
}

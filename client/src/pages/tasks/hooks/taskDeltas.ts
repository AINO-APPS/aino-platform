/**
 * Field-level task deltas, mirrored from the server module.
 *
 * A broadcast carries only the fields that changed, so a client patches the
 * card it already holds instead of replacing the whole object. Two people
 * editing different fields of the same ticket both survive; the same field
 * edited twice resolves to the later write.
 */

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
        // A transfer changes the ticket's owning team.
        "team_id",
    ] as const;

export type DeltaField = (typeof DELTA_FIELDS)[number];

const FIELD_SET = new Set<string>(DELTA_FIELDS);

/**
 * Apply a delta to a task the client already holds.
 *
 * Fields absent from the delta are left alone. A delta older than the one
 * already applied is ignored, so the later write wins deterministically.
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

/** True when a delta carries nothing worth applying. */
export function isEmptyDelta(fields: Partial<Record<DeltaField, unknown>>): boolean {
    return Object.keys(fields || {}).length === 0;
}

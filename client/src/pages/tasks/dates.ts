/** Expand compatibility: explicit null is a cleared date, not a fallback. */
export function startDateOf(task: { start_date?: string | null; planned_date?: string | null }): string | null {
    return (task.start_date !== undefined ? task.start_date : task.planned_date)?.slice(0, 10) ?? null;
}

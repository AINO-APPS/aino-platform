export function startDateOf(task: { start_date?: string | null }): string | null {
    return task.start_date?.slice(0, 10) ?? null;
}

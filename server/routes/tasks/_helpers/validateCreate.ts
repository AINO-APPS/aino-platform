/**
 * Field validation for both create paths.
 *
 * `POST /tasks` and `POST /tasks/backlog` accepted the same rules written out
 * twice; one copy here keeps a new limit from landing on only one of them.
 */
export function validateCreatedFields(input: {
    title?: unknown;
    description?: unknown;
}): { status: number; body: { error: string } } | null {
    const title = typeof input.title === "string" ? input.title : "";
    const description = typeof input.description === "string" ? input.description : "";
    if (!title.trim()) return { status: 400, body: { error: "Task title is required" } };
    if (title.trim().length > 200) return { status: 400, body: { error: "Task title must be 200 characters or less" } };
    if (description.length > 5000) return { status: 400, body: { error: "Task description must be 5000 characters or less" } };
    return null;
}

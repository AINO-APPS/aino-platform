/**
 * The title and description limits on both create paths.
 *
 * `POST /tasks` and `POST /tasks/backlog` accepted the same three rules written
 * out twice; one copy here keeps a new limit from landing on only one of them.
 */
/**
 * The optional project on `POST /tasks` and `POST /tasks/backlog`: resolved
 * inside the caller's org, archived projects refused, a missing id allowed.
 */
export async function resolveCreateProject(
    db: { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> },
    projectId: unknown,
    orgId: number | null,
): Promise<{ projectId: number | null; error?: { status: number; body: { error: string } } }> {
    if (projectId === undefined || projectId === null || projectId === "") return { projectId: null };
    const numeric = parseInt(String(projectId), 10);
    if (Number.isNaN(numeric) || !orgId) return { projectId: null };
    // The query itself lives in the tasks module (no SQL in route files).
    const { findActiveProject } = require("../../modules/tasks/tasks.repository");
    const project = await findActiveProject(db, numeric, orgId);
    if (!project) return { projectId: null, error: { status: 400, body: { error: "Invalid project or project is archived" } } };
    return { projectId: project.id };
}

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

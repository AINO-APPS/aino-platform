/** Database port used by the task domain. */
export interface TasksDb {
    query(sql: string, params?: unknown[]): Promise<{ rows: any[]; rowCount: number }>;
}

export interface GitRefInput {
    ref_type: "branch" | "pull_request" | "commit";
    external_id?: unknown;
    title?: unknown;
    url?: unknown;
    repository?: unknown;
    ref_name?: unknown;
    status?: unknown;
}
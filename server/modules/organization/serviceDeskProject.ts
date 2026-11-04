interface SettingsDb {
    query(sql: string, params?: unknown[]): Promise<{ rows: any[] }>;
}

export async function isActiveServiceDeskProject(db: SettingsDb, projectId: number, orgId: number) {
    return (await db.query(
        "SELECT id FROM projects WHERE id = $1 AND org_id = $2 AND is_archived = FALSE",
        [projectId, orgId],
    )).rows.length > 0;
}

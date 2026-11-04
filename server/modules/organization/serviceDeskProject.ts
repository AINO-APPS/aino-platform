interface SettingsDb {
    query(sql: string, params?: unknown[]): Promise<{ rows: any[] }>;
}

export async function isValidServiceDeskProjectSetting(db: SettingsDb, projectId: unknown, orgId: number) {
    if (projectId === null) return true;
    if (typeof projectId !== "number" || !Number.isSafeInteger(projectId) || projectId <= 0) return false;
    return (await db.query(
        "SELECT id FROM projects WHERE id = $1 AND org_id = $2 AND is_archived = FALSE",
        [projectId, orgId],
    )).rows.length > 0;
}

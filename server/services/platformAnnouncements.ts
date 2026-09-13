import { masterQuery } from "./masterDatabase";

const VALID_TYPES = new Set(["info", "warning", "success", "urgent", "quote"]);

function normalizeType(value: unknown): string {
    return typeof value === "string" && VALID_TYPES.has(value) ? value : "info";
}

function expirationFromDuration(value: unknown): string | null {
    const hours = Number(value);
    return value !== null && value !== "" && Number.isFinite(hours) && hours > 0
        ? new Date(Date.now() + hours * 3_600_000).toISOString()
        : null;
}

async function listPlatformAnnouncements(activeOnly = false): Promise<any[]> {
    const where = activeOnly
        ? "WHERE a.is_active = TRUE AND (a.expires_at IS NULL OR a.expires_at > NOW())"
        : "";
    return (await masterQuery(
        `SELECT a.*, u.full_name AS created_by_name
           FROM platform_announcements a
           LEFT JOIN platform_users u ON u.id = a.created_by
           ${where}
          ORDER BY a.created_at DESC
          LIMIT ${activeOnly ? 20 : 100}`,
    )).rows;
}

async function createPlatformAnnouncement(actorId: number, body: any): Promise<any> {
    const message = typeof body?.message === "string" ? body.message.trim() : "";
    if (!message) throw new Error("MESSAGE_REQUIRED");
    return (await masterQuery(
        `INSERT INTO platform_announcements (created_by, message, type, expires_at)
         VALUES ($1, $2, $3, $4) RETURNING *`,
        [actorId, message.slice(0, 500), normalizeType(body?.type), expirationFromDuration(body?.duration)],
    )).rows[0];
}

async function updatePlatformAnnouncement(id: number, body: any): Promise<any | null> {
    const updates: string[] = [];
    const params: unknown[] = [];
    if (body?.message !== undefined) {
        const message = typeof body.message === "string" ? body.message.trim() : "";
        if (!message) throw new Error("MESSAGE_REQUIRED");
        params.push(message.slice(0, 500));
        updates.push(`message = $${params.length}`);
    }
    if (body?.type !== undefined) {
        if (typeof body.type !== "string" || !VALID_TYPES.has(body.type)) throw new Error("INVALID_TYPE");
        params.push(body.type);
        updates.push(`type = $${params.length}`);
    }
    if (body?.is_active !== undefined) {
        params.push(Boolean(body.is_active));
        updates.push(`is_active = $${params.length}`);
    }
    if (body?.duration !== undefined) {
        params.push(expirationFromDuration(body.duration));
        updates.push(`expires_at = $${params.length}`);
    }
    if (!updates.length) throw new Error("NO_FIELDS");
    params.push(id);
    return (await masterQuery(
        `UPDATE platform_announcements SET ${updates.join(", ")} WHERE id = $${params.length} RETURNING *`,
        params,
    )).rows[0] || null;
}

async function deletePlatformAnnouncement(id: number): Promise<boolean> {
    return Boolean((await masterQuery(
        "DELETE FROM platform_announcements WHERE id = $1 RETURNING id",
        [id],
    )).rows[0]);
}

export {
    listPlatformAnnouncements,
    createPlatformAnnouncement,
    updatePlatformAnnouncement,
    deletePlatformAnnouncement,
};
/** Persistence boundary for global search. */
import type { SearchDb } from "./search.types";

export async function searchTasks(db: SearchDb, userId: number, tsQuery: string) {
    return (await db.query(
        `SELECT id, title, description, status, priority, date, due_date, sprint_id,
                ts_headline('english', title || ' ' || COALESCE(description, ''),
                    to_tsquery('english', $2), 'MaxFragments=1, MaxWords=10, MinWords=3') AS snippet
         FROM tasks
         WHERE (user_id = $1 OR assigned_to = $1)
           AND to_tsvector('english', title || ' ' || COALESCE(description, '')) @@ to_tsquery('english', $2)
         ORDER BY created_at DESC LIMIT 20`, [userId, tsQuery],
    )).rows;
}

export async function getNotebookData(db: SearchDb, userId: number): Promise<unknown> {
    return (await db.query("SELECT data FROM notebooks WHERE user_id = $1", [userId])).rows[0]?.data;
}

export async function searchUsers(db: SearchDb, orgId: number, userId: number, pattern: string) {
    return (await db.query(
        `SELECT id, username, full_name, email, avatar, role FROM users
         WHERE org_id = $1 AND id != $2 AND is_active = TRUE
           AND (full_name ILIKE $3 OR username ILIKE $3 OR email ILIKE $3)
         ORDER BY full_name ASC LIMIT 10`, [orgId, userId, pattern],
    )).rows;
}

export async function searchEvents(db: SearchDb, userId: number, pattern: string) {
    return (await db.query(
        `SELECT id, title, description, start_time, end_time, all_day FROM calendar_events
         WHERE user_id = $1 AND (title ILIKE $2 OR description ILIKE $2)
         ORDER BY start_time ASC LIMIT 7`, [userId, pattern],
    )).rows;
}

export async function searchLeaves(db: SearchDb, userId: number, pattern: string) {
    return (await db.query(
        `SELECT id, date, leave_type, duration, status, reason FROM leaves
         WHERE user_id = $1 AND (leave_type ILIKE $2 OR COALESCE(reason, '') ILIKE $2)
         ORDER BY date DESC LIMIT 7`, [userId, pattern],
    )).rows;
}

export async function findTeamId(db: SearchDb, userId: number): Promise<number | null> {
    return (await db.query("SELECT team_id FROM users WHERE id = $1", [userId])).rows[0]?.team_id || null;
}

export async function searchSprints(db: SearchDb, teamId: number, pattern: string) {
    return (await db.query(
        `SELECT id, name, goal, status, start_date, end_date FROM sprints
         WHERE team_id = $1 AND (name ILIKE $2 OR COALESCE(goal, '') ILIKE $2)
         ORDER BY start_date DESC LIMIT 7`, [teamId, pattern],
    )).rows;
}

export async function searchAuditLogs(db: SearchDb, orgId: number, pattern: string) {
    return (await db.query(
        `SELECT al.id, al.action, al.entity_type, al.entity_id, al.details, al.created_at,
                u.full_name AS actor_name
         FROM audit_logs al LEFT JOIN users u ON u.id = al.actor_id
         WHERE al.org_id = $1
           AND (al.action ILIKE $2 OR al.entity_type ILIKE $2 OR al.details ILIKE $2)
         ORDER BY al.created_at DESC LIMIT 10`, [orgId, pattern],
    )).rows;
}
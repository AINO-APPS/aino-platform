/**
 * The profile row, resolved against tenant DBs of different vintages.
 *
 * `GET /api/profile` is what hydrates every client's session, so a single
 * missing column cannot be allowed to fail it: a 500 there leaves the app on a
 * degraded user and the user effectively signed out of their own context.
 *
 * `users.notification_prefs` is optional on older tenant databases. Each
 * attempt drops only that column, so older tenants still hydrate a profile.
 */

interface DbLike {
    query: (sql: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount: number }>;
}

const BASE_COLUMNS = [
    "u.id", "u.username", "u.full_name", "u.email", "u.avatar", "u.role",
    "u.org_id", "u.team_id", "u.department_id", "u.must_change_password",
    "t.name as team_name",
].join(", ");

const FROM = "FROM users u LEFT JOIN teams t ON u.team_id = t.id WHERE u.id = $1";

/** Most complete first; fallback drops the optional notification preference. */
const ATTEMPTS: { sql: string; drops: string }[] = [
    { sql: `SELECT ${BASE_COLUMNS}, u.notification_prefs ${FROM}`, drops: "nothing" },
    { sql: `SELECT ${BASE_COLUMNS} ${FROM}`, drops: "notification_prefs" },
];

export interface ProfileRowResult {
    user: any;
}

/**
 * Read the caller's profile row, degrading one optional column at a time.
 *
 * Returns `{ user: undefined }` only when the user genuinely does not exist;
 * throws when no query could run at all, because that is a real failure.
 */
export async function loadProfileRow(db: DbLike, userId: number, onFallback: (missing: string, err: unknown) => void): Promise<ProfileRowResult> {
    const last = ATTEMPTS.length - 1;
    for (const [index, attempt] of ATTEMPTS.entries()) {
        try {
            const user = (await db.query(attempt.sql, [userId])).rows[0];
            return { user };
        } catch (err) {
            // The last attempt failing is not a fallback, it is the response.
            if (index === last) throw err;
            onFallback(attempt.drops, err);
        }
    }
    // Unreachable: the loop either returns or throws.
    throw new Error("GET /profile: no column set is queryable");
}

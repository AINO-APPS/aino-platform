/**
 * The profile row, resolved against tenant DBs of different vintages.
 *
 * `GET /api/profile` is what hydrates every client's session, so a single
 * missing column cannot be allowed to fail it: a 500 there leaves the app on a
 * degraded user and the user effectively signed out of their own context.
 *
 * Two columns are optional. `users.notification_prefs` arrives with a later
 * migration, and `teams.sprint_start_date` (which `team_sprint_enabled` is
 * derived from) predates neither a fresh tenant nor a very old one. Each attempt
 * drops one optional column, so the worst case is a response with fewer fields
 * rather than an error.
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

/**
 * The team's sprint config, not the tenant's agile feature: a team works in
 * sprints once an admin has set a start date, even before any sprint row has
 * been materialised. Clients use it to choose between the Sprint and Schedule
 * planning surfaces.
 */
const SPRINT_ENABLED = "(t.sprint_start_date IS NOT NULL AND t.sprint_start_date <> '') as team_sprint_enabled";

/** Most complete first; each fallback drops one optional column. */
const ATTEMPTS: { sql: string; drops: string }[] = [
    { sql: `SELECT ${BASE_COLUMNS}, u.notification_prefs, ${SPRINT_ENABLED} ${FROM}`, drops: "nothing" },
    { sql: `SELECT ${BASE_COLUMNS}, ${SPRINT_ENABLED} ${FROM}`, drops: "notification_prefs" },
    { sql: `SELECT ${BASE_COLUMNS} ${FROM}`, drops: "notification_prefs and sprint_start_date" },
];

export interface ProfileRowResult {
    user: any;
    /** False when the tenant DB predates `teams.sprint_start_date`; the field is then absent, not false. */
    sprintEnabledReported: boolean;
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
            return { user, sprintEnabledReported: index < last };
        } catch (err) {
            // The last attempt failing is not a fallback, it is the response.
            if (index === last) throw err;
            onFallback(attempt.drops, err);
        }
    }
    // Unreachable: the loop either returns or throws.
    throw new Error("GET /profile: no column set is queryable");
}

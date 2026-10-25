/**
 * Per-user Tasks preferences.
 *
 * One server-side record decides whether completed work is shown and how dense
 * cards are, so the same person sees the same thing on web, desktop, Android
 * and iOS. A URL parameter may override the stored choice for a single view;
 * that override never persists.
 */

export type CardDensity = "comfortable" | "compact";

export interface TaskPreferences {
    show_completed: boolean;
    card_density: CardDensity;
    default_team_id: number | null;
}

export const DEFAULT_TASK_PREFERENCES: TaskPreferences = {
    show_completed: false,
    card_density: "comfortable",
    default_team_id: null,
};

const DENSITIES: CardDensity[] = ["comfortable", "compact"];

function asBoolean(value: unknown, fallback: boolean): boolean {
    if (typeof value === "boolean") return value;
    if (value === "true" || value === "1") return true;
    if (value === "false" || value === "0") return false;
    return fallback;
}

function asTeamId(value: unknown): number | null {
    if (value === null || value === undefined || value === "") return null;
    const parsed = Number.parseInt(String(value), 10);
    return Number.isNaN(parsed) ? null : parsed;
}

/** Coerce stored or submitted values into a complete, valid preference set. */
export function normaliseTaskPreferences(raw: unknown): TaskPreferences {
    const source = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const density = DENSITIES.includes(source.card_density as CardDensity)
        ? (source.card_density as CardDensity)
        : DEFAULT_TASK_PREFERENCES.card_density;

    return {
        show_completed: asBoolean(source.show_completed, DEFAULT_TASK_PREFERENCES.show_completed),
        card_density: density,
        default_team_id: asTeamId(source.default_team_id),
    };
}

/**
 * Merge a partial update over the stored preferences.
 *
 * Unknown keys are dropped so a stale client cannot smuggle state into the
 * record, and an invalid value falls back to the stored one rather than
 * resetting the whole object.
 */
export function mergeTaskPreferences(
    stored: unknown,
    update: unknown,
): TaskPreferences {
    const current = normaliseTaskPreferences(stored);
    const patch = (update && typeof update === "object" ? update : {}) as Record<string, unknown>;
    const merged: Record<string, unknown> = { ...current };

    if ("show_completed" in patch) {
        merged.show_completed = asBoolean(patch.show_completed, current.show_completed);
    }
    if ("card_density" in patch) {
        merged.card_density = DENSITIES.includes(patch.card_density as CardDensity)
            ? patch.card_density
            : current.card_density;
    }
    if ("default_team_id" in patch) {
        merged.default_team_id = asTeamId(patch.default_team_id);
    }

    return normaliseTaskPreferences(merged);
}

/**
 * Resolve the effective value for one view.
 *
 * A URL parameter wins for that view only; it is never written back. An
 * unrecognised parameter is ignored rather than treated as an error.
 */
export function resolveShowCompleted(
    stored: TaskPreferences,
    urlValue: string | null | undefined,
): boolean {
    if (urlValue === "1" || urlValue === "true") return true;
    if (urlValue === "0" || urlValue === "false") return false;
    return stored.show_completed;
}

/** Database port for the preference record. */
export interface PreferencesDb {
    query(sql: string, params?: unknown[]): Promise<{ rows: any[]; rowCount: number }>;
}

/** The stored preference record, or the defaults when none has been written. */
export async function readTaskPreferences(db: PreferencesDb, userId: number): Promise<unknown> {
    const row = (await db.query(
        "SELECT task_prefs FROM users WHERE id = $1",
        [userId],
    )).rows[0];
    return row?.task_prefs ?? DEFAULT_TASK_PREFERENCES;
}

export async function writeTaskPreferences(
    db: PreferencesDb,
    userId: number,
    preferences: TaskPreferences,
): Promise<void> {
    await db.query(
        "UPDATE users SET task_prefs = $1::jsonb WHERE id = $2",
        [JSON.stringify(preferences), userId],
    );
}

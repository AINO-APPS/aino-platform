import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { getTaskPreferences, updateTaskPreferences } from "../../../api/organization";

export type CardDensity = "comfortable" | "compact";

export interface TaskPreferences {
    show_completed: boolean;
    card_density: CardDensity;
    default_team_id: number | null;
}

const DEFAULTS: TaskPreferences = {
    show_completed: false,
    card_density: "compact",
    default_team_id: null,
};

/**
 * The per-user Tasks preferences, stored server-side so every client agrees.
 *
 * `showCompleted` is the effective value for the current view: a `completed`
 * URL parameter overrides the stored choice for that view only and is never
 * written back.
 */
export function useTaskPreferences() {
    const [searchParams] = useSearchParams();
    const [preferences, setPreferences] = useState<TaskPreferences>(DEFAULTS);
    const [loaded, setLoaded] = useState(false);

    useEffect(() => {
        let cancelled = false;
        getTaskPreferences()
            .then((res) => {
                if (cancelled) return;
                setPreferences({ ...DEFAULTS, ...(res.data || {}) });
            })
            .catch(() => {
                // A failed read falls back to the defaults rather than blocking
                // the Tasks page.
            })
            .finally(() => {
                if (!cancelled) setLoaded(true);
            });
        return () => {
            cancelled = true;
        };
    }, []);

    const save = useCallback(async (patch: Partial<TaskPreferences>) => {
        // Optimistic: the toggle responds immediately, then reconciles with
        // whatever the server stored.
        setPreferences((current) => ({ ...current, ...patch }));
        try {
            const res = await updateTaskPreferences(patch);
            if (res?.data) setPreferences({ ...DEFAULTS, ...res.data });
        } catch {
            // Keep the optimistic value; the next read reconciles it.
        }
    }, []);

    const urlOverride = searchParams.get("completed");
    const showCompleted =
        urlOverride === "1" || urlOverride === "true"
            ? true
            : urlOverride === "0" || urlOverride === "false"
                ? false
                : preferences.show_completed;

    return {
        preferences,
        loaded,
        showCompleted,
        /** True when the current view is showing a URL override. */
        overridden: urlOverride === "1" || urlOverride === "true" || urlOverride === "0" || urlOverride === "false",
        setShowCompleted: (value: boolean) => save({ show_completed: value }),
        setCardDensity: (value: CardDensity) => save({ card_density: value }),
    };
}

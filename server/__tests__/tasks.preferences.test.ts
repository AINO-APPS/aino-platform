import {
    DEFAULT_TASK_PREFERENCES,
    mergeTaskPreferences,
    normaliseTaskPreferences,
    resolveShowCompleted,
} from "../modules/tasks/tasks.preferences";

describe("task preferences", () => {
    test("defaults to hidden completed work and comfortable cards", () => {
        expect(normaliseTaskPreferences(undefined)).toEqual(DEFAULT_TASK_PREFERENCES);
        expect(DEFAULT_TASK_PREFERENCES.show_completed).toBe(false);
    });

    test("round-trips a stored preference unchanged", () => {
        const stored = { show_completed: true, card_density: "compact", default_team_id: 4 };
        expect(normaliseTaskPreferences(stored)).toEqual(stored);
    });

    test("merges a partial update without wiping unrelated keys", () => {
        const stored = { show_completed: true, card_density: "compact", default_team_id: 4 };
        expect(mergeTaskPreferences(stored, { show_completed: false })).toEqual({
            show_completed: false,
            card_density: "compact",
            default_team_id: 4,
        });
    });

    test("ignores unknown keys and invalid values", () => {
        const stored = { show_completed: true, card_density: "compact", default_team_id: 4 };
        expect(mergeTaskPreferences(stored, {
            show_completed: "not-a-boolean",
            card_density: "enormous",
            injected: "value",
        })).toEqual(stored);
    });

    test("a URL parameter overrides the stored choice for one view", () => {
        const stored = { ...DEFAULT_TASK_PREFERENCES, show_completed: false };
        expect(resolveShowCompleted(stored, "1")).toBe(true);
        expect(resolveShowCompleted(stored, "true")).toBe(true);
        expect(resolveShowCompleted({ ...stored, show_completed: true }, "0")).toBe(false);
        expect(resolveShowCompleted({ ...stored, show_completed: true }, "nonsense")).toBe(true);
        expect(resolveShowCompleted({ ...stored, show_completed: true }, null)).toBe(true);
    });

    test("the override never mutates the stored preference", () => {
        const stored = { ...DEFAULT_TASK_PREFERENCES, show_completed: false };
        resolveShowCompleted(stored, "1");
        expect(stored.show_completed).toBe(false);
    });
});

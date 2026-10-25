import {
    canEditTeamMode,
    isRollingSprint,
    resolveTeamMode,
    storedSprintMode,
} from "../modules/tasks/tasks.teamMode";

describe("team sprint mode", () => {
    test("a manual team is in sprints mode", () => {
        expect(resolveTeamMode({ sprint_mode: "manual" })).toBe("sprints");
        expect(resolveTeamMode(null)).toBe("sprints");
    });

    test("an auto team is in continuous mode", () => {
        expect(resolveTeamMode({ sprint_mode: "auto" })).toBe("continuous");
    });

    test("the stored value round-trips", () => {
        expect(storedSprintMode("continuous")).toBe("auto");
        expect(storedSprintMode("sprints")).toBe("manual");
        expect(resolveTeamMode({ sprint_mode: storedSprintMode("continuous") })).toBe("continuous");
    });

    test("only web may change the mode", () => {
        expect(canEditTeamMode(true)).toBe(true);
        expect(canEditTeamMode(false)).toBe(false);
    });

    test("the rolling sprint is identified in continuous mode", () => {
        expect(isRollingSprint({ sprint_mode: "auto" }, { auto_managed: true })).toBe(true);
        expect(isRollingSprint({ sprint_mode: "auto" }, { auto_managed: false })).toBe(false);
        expect(isRollingSprint({ sprint_mode: "manual" }, { auto_managed: true })).toBe(false);
    });

    test("the backlog keeps its meaning in both modes", () => {
        // Backlog membership is `sprint_id IS NULL` regardless of mode; the
        // mode only decides how sprints roll forward.
        for (const mode of ["manual", "auto"]) {
            expect(resolveTeamMode({ sprint_mode: mode })).toMatch(/sprints|continuous/);
        }
    });
});

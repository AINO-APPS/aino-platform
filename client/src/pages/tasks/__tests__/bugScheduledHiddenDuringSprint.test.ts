/**
 * [LOOP] A team with a current sprint must not be offered Scheduled.
 *
 * Sprint and Scheduled are alternative planning surfaces: a team that plans in
 * a sprint plans there, and the dated list beside it is noise. This is the
 * reported bug — with a running sprint the Scheduled tab still appears.
 */
import { describe, expect, test } from "vitest";
import { planningTabs } from "../hooks/usePlanningSurface";
import { paletteViews } from "../hooks/useCommandPalette";

describe("[LOOP] planning surfaces are exclusive", () => {
    test("a current sprint offers Sprint, Backlog and Service Desk — no Scheduled", () => {
        expect(planningTabs({ agileEnabled: true, currentSprintId: 12 }).tabs).toEqual([
            "sprint",
            "backlog",
            "service-desk",
        ]);
    });

    test("no current sprint offers Backlog and Scheduled — no Sprint", () => {
        expect(planningTabs({ agileEnabled: true, currentSprintId: null }).tabs).toEqual([
            "backlog",
            "scheduled",
            "service-desk",
        ]);
    });

    test("the palette does not offer Schedule on a sprint team either", () => {
        // A second entry point: the palette used to list Schedule for everyone,
        // so hiding the tab alone would still leave a way in.
        const tabs = planningTabs({ agileEnabled: true, currentSprintId: 12 }).tabs;
        const palette = paletteViews("12", tabs);
        expect(palette.some((view) => view.id === "view-schedule")).toBe(false);
        expect(palette.some((view) => view.id === "view-board")).toBe(true);
    });

    test("the palette still offers Schedule to a team with no running sprint", () => {
        const tabs = planningTabs({ agileEnabled: true, currentSprintId: null }).tabs;
        expect(paletteViews(null, tabs).some((view) => view.id === "view-schedule")).toBe(true);
    });

    test("a paused current sprint still offers the sprint board", () => {
        expect(planningTabs({ agileEnabled: true, currentSprintId: 19 }).tabs).toContain("sprint");
    });
});

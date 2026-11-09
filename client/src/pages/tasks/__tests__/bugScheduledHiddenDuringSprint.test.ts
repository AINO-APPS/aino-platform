/**
 * Scheduled is not a current planning surface, whether or not a sprint exists.
 */
import { describe, expect, test } from "vitest";
import { planningTabs } from "../hooks/usePlanningSurface";
import { paletteViews } from "../hooks/useCommandPalette";

describe("planning surfaces omit Scheduled", () => {
    test("a current sprint offers Sprint, Backlog and Service Desk", () => {
        expect(planningTabs({ agileEnabled: true, currentSprintId: 12 }).tabs).toEqual([
            "sprint",
            "backlog",
            "service-desk",
        ]);
    });

    test("no current sprint still offers the stable sprint tab", () => {
        expect(planningTabs({ agileEnabled: true, currentSprintId: null }).tabs).toEqual([
            "sprint",
            "backlog",
            "service-desk",
        ]);
    });

    test("the palette never offers Schedule", () => {
        const tabs = planningTabs({ agileEnabled: true, currentSprintId: 12 }).tabs;
        const palette = paletteViews("12", tabs);
        expect(palette.some((view) => view.id === "view-schedule")).toBe(false);
        expect(palette.some((view) => view.id === "view-board")).toBe(true);
        expect(paletteViews(null, tabs).some((view) => view.id === "view-schedule")).toBe(false);
    });

    test("a paused current sprint still offers the sprint board", () => {
        expect(planningTabs({ agileEnabled: true, currentSprintId: 19 }).tabs).toContain("sprint");
    });
});

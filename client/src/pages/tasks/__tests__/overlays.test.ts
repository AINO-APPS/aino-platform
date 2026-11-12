import { describe, expect, test } from "vitest";
import { DEFAULT_OVERLAYS, overlayItems, overlaysForDay, toggleOverlay } from "../overlays";

describe("calendar overlays", () => {
    test("keeps approved leave, holidays, and meetings as read-only date context", () => {
        const items = overlayItems({
            leave: [{ id: 1, date: "2026-11-12", user_name: "Ada", leave_type: "annual" }],
            holidays: [{ id: 2, date: "2026-11-12", name: "Founders Day" }],
            meetings: [{ id: 3, start_time: "2026-11-12T10:00:00Z", title: "Planning" }],
        });
        expect(items.map(item => [item.type, item.date])).toEqual([
            ["leave", "2026-11-12"],
            ["holidays", "2026-11-12"],
            ["meetings", "2026-11-12"],
        ]);
        expect(overlaysForDay(items, "2026-11-12", DEFAULT_OVERLAYS).map(item => item.type))
            .toEqual(["leave", "holidays"]);
    });

    test("toggles one overlay type without changing the others", () => {
        expect(toggleOverlay(DEFAULT_OVERLAYS, "meetings"))
            .toEqual({ leave: true, holidays: true, meetings: true });
    });
});

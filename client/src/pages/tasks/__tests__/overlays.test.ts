import { describe, expect, test } from "vitest";
import {
    DEFAULT_OVERLAYS,
    hasAllDayAbsence,
    overlayItems,
    overlaysForDay,
    toggleOverlay,
} from "../overlays";

const payload = {
    leave: [
        { id: 1, date: "2026-10-25", end_date: "2026-10-26", leave_type: "Annual", user_name: "Priya" },
    ],
    holidays: [{ id: 2, name: "Diwali", date: "2026-10-27" }],
    meetings: [{ id: 3, title: "Standup", start_time: "2026-10-25T09:00:00Z" }],
};

describe("calendar overlays", () => {
    test("leave, holidays and meetings become day items", () => {
        const items = overlayItems(payload);
        expect(items.filter((item) => item.type === "leave")).toHaveLength(2);
        expect(items.find((item) => item.type === "holidays")?.label).toBe("Diwali");
        expect(items.find((item) => item.type === "meetings")?.date).toBe("2026-10-25");
    });

    test("each overlay type toggles independently", () => {
        const withoutLeave = toggleOverlay(DEFAULT_OVERLAYS, "leave");
        expect(withoutLeave.leave).toBe(false);
        expect(withoutLeave.holidays).toBe(DEFAULT_OVERLAYS.holidays);
        expect(withoutLeave.meetings).toBe(DEFAULT_OVERLAYS.meetings);
    });

    test("hidden overlays do not render for a day", () => {
        const items = overlayItems(payload);
        const visible = overlaysForDay(items, "2026-10-25", {
            ...DEFAULT_OVERLAYS,
            leave: false,
            meetings: true,
        });
        expect(visible.some((item) => item.type === "leave")).toBe(false);
        expect(visible.some((item) => item.type === "meetings")).toBe(true);
    });

    test("overlays are read-only data with no mutation surface", () => {
        const items = overlayItems(payload);
        expect(Object.keys(items[0]).sort()).toEqual(["date", "id", "label", "type"]);
    });

    test("a day with an all-day absence still renders", () => {
        const items = overlayItems(payload);
        expect(hasAllDayAbsence(items, "2026-10-27")).toBe(true);
        expect(hasAllDayAbsence(items, "2026-10-28")).toBe(false);
    });

    test("an empty payload yields no overlays", () => {
        expect(overlayItems(null)).toEqual([]);
        expect(overlayItems({})).toEqual([]);
    });
});

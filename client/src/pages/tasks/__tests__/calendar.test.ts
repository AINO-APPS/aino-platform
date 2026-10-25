import { describe, expect, test } from "vitest";
import {
    addDays,
    dayTotals,
    groupByDay,
    monthGrid,
    overdueTasks,
    plannedDay,
    startOfMonth,
    startOfWeek,
    toDateString,
    unscheduledTasks,
    weekDays,
} from "../calendar";

describe("calendar maths", () => {
    test("dates are date-only strings with no timezone shift", () => {
        expect(toDateString(new Date(2026, 9, 25))).toBe("2026-10-25");
        expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
        expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    });

    test("weeks start on Monday", () => {
        // 2026-10-25 is a Sunday.
        expect(startOfWeek("2026-10-25")).toBe("2026-10-19");
        expect(startOfMonth("2026-10-25")).toBe("2026-10-01");
    });

    test("a month grid covers whole weeks", () => {
        const days = monthGrid("2026-10-25", "2026-10-25");
        expect(days).toHaveLength(42);
        expect(days[0].date).toBe("2026-09-28");
        expect(days.filter((day) => day.inMonth)).toHaveLength(31);
        expect(days.find((day) => day.isToday)?.date).toBe("2026-10-25");
    });

    test("a week strip has seven days", () => {
        const days = weekDays("2026-10-25", "2026-10-25");
        expect(days).toHaveLength(7);
        expect(days[0].date).toBe("2026-10-19");
        expect(days[6].date).toBe("2026-10-25");
    });

    test("tasks group by their planned day", () => {
        const groups = groupByDay([
            { id: 1, planned_date: "2026-10-25" },
            { id: 2, planned_date: "2026-10-25" },
            { id: 3, planned_date: "2026-10-26" },
            { id: 4 },
        ]);
        expect(groups.get("2026-10-25")?.map((task) => task.id)).toEqual([1, 2]);
        expect(groups.get("2026-10-26")?.map((task) => task.id)).toEqual([3]);
        expect(groups.size).toBe(2);
    });

    test("each day reports its count and point total", () => {
        expect(dayTotals([
            { id: 1, story_points: 5 },
            { id: 2, story_points: 3 },
            { id: 3 },
        ])).toEqual({ count: 3, points: 8 });
    });

    test("overdue work is planned before today and unfinished", () => {
        const overdue = overdueTasks([
            { id: 1, planned_date: "2026-10-20" },
            { id: 2, planned_date: "2026-10-20", completed_at: "2026-10-21T00:00:00Z" },
            { id: 3, planned_date: "2026-10-25" },
        ], "2026-10-25");
        expect(overdue.map((task) => task.id)).toEqual([1]);
    });

    test("the tray holds backlog work with no planned day", () => {
        expect(unscheduledTasks([
            { id: 1 },
            { id: 2, planned_date: "2026-10-25" },
            { id: 3, planned_date: null },
        ]).map((task) => task.id)).toEqual([1, 3]);
    });

    test("the planned day is the only scheduling field", () => {
        expect(plannedDay({ id: 1, planned_date: "2026-10-25" })).toBe("2026-10-25");
        expect(plannedDay({ id: 1 })).toBeNull();
    });
});

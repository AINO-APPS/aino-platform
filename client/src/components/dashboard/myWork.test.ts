/**
 * The home "My Work" card's rules: which tickets are the viewer's, how the
 * week is bucketed, and what the 6-row cap drops.
 *
 * The rules live here rather than in the component so the sprint and week
 * modes cannot drift, and so "cancelled is not counted" has one home.
 */
import { describe, expect, test } from "vitest";
import {
    CANCELLED_STATE_KEY,
    MY_WORK_ROW_LIMIT,
    capGroups,
    myDoneCount,
    myOpenTasks,
    myWorkCount,
    previousWeekEnd,
    rowDayLabel,
    sprintGroups,
    weekGroups,
    weekRange,
    type MyWorkTask,
} from "./myWork";

const ME = 7;

function task(overrides: Partial<MyWorkTask> & { id: number }): MyWorkTask {
    return { title: `T${overrides.id}`, assigned_to: ME, ...overrides };
}

describe("weekRange", () => {
    test("runs Monday to Sunday", () => {
        expect(weekRange(new Date(2026, 9, 28))).toEqual({ start: "2026-10-26", end: "2026-11-01" });
    });

    test("a Sunday is the last day of its own week, not the first of the next", () => {
        expect(weekRange(new Date(2026, 10, 1))).toEqual({ start: "2026-10-26", end: "2026-11-01" });
    });

    test("crosses a month and year boundary", () => {
        expect(weekRange(new Date(2027, 0, 1))).toEqual({ start: "2026-12-28", end: "2027-01-03" });
    });

    test("the overdue range ends the Sunday before", () => {
        expect(previousWeekEnd("2026-10-26")).toBe("2026-10-25");
    });
});

describe("mine", () => {
    const tasks = [
        task({ id: 1 }),
        task({ id: 2, assigned_to: 999 }),
        // The server's `assignee=me` also returns the viewer's own unassigned
        // creations; "my work" must not.
        task({ id: 3, assigned_to: null }),
        task({ id: 4, completed_at: "2026-10-27T10:00:00Z" }),
        task({ id: 5, workflow_state_key: CANCELLED_STATE_KEY }),
        task({ id: 6, workflow_state_key: CANCELLED_STATE_KEY, completed_at: "2026-10-27T10:00:00Z" }),
    ];

    test("only my open, uncancelled tickets are listed", () => {
        expect(myOpenTasks(tasks, ME).map((t) => t.id)).toEqual([1]);
    });

    test("cancelled is neither done nor counted", () => {
        expect(myDoneCount(tasks, ME)).toBe(1);
        expect(myWorkCount(tasks, ME)).toBe(2);
    });
});

describe("weekGroups", () => {
    test("overdue first, then each day that has work, Monday through Sunday", () => {
        const groups = weekGroups(
            [task({ id: 1, planned_date: "2026-10-21" })],
            [
                task({ id: 2, planned_date: "2026-10-28" }),
                task({ id: 3, planned_date: "2026-10-26" }),
                task({ id: 4, planned_date: "2026-10-28" }),
            ],
            "2026-10-26",
        );

        expect(groups.map((g) => g.key)).toEqual(["overdue", "2026-10-26", "2026-10-28"]);
        expect(groups.map((g) => g.label)).toEqual(["Overdue", "Monday", "Wednesday"]);
        expect(groups[2].tasks.map((t) => t.id)).toEqual([2, 4]);
    });

    test("a week with only overdue work still renders the overdue group", () => {
        const groups = weekGroups([task({ id: 1, planned_date: "2026-10-21" })], [], "2026-10-26");
        expect(groups).toHaveLength(1);
        expect(groups[0].label).toBe("Overdue");
    });
});

describe("sprintGroups", () => {
    test("sorts by priority — the board endpoint orders by created_at, not priority", () => {
        const groups = sprintGroups([
            task({ id: 1, priority: "low" }),
            task({ id: 2, priority: "high" }),
            task({ id: 3, priority: "medium" }),
        ]);
        expect(groups[0].tasks.map((t) => t.id)).toEqual([2, 3, 1]);
    });

    test("no tickets means no block, so the card can show its empty sentence", () => {
        expect(sprintGroups([])).toEqual([]);
    });
});

describe("rowDayLabel", () => {
    test("an overdue row carries its own day", () => {
        expect(rowDayLabel(task({ id: 1, planned_date: "2026-10-21" }), "overdue")).toBe("Oct 21");
    });

    test("rows in a day group do not repeat the header's day", () => {
        expect(rowDayLabel(task({ id: 1, planned_date: "2026-10-26" }), "2026-10-26")).toBeNull();
    });
});

describe("capGroups", () => {
    test(`shows at most ${MY_WORK_ROW_LIMIT} rows and reports the rest`, () => {
        const rows = Array.from({ length: 8 }, (_, i) => task({ id: i + 1, planned_date: "2026-10-26" }));
        const { groups, hidden } = capGroups([{ key: "mon", label: "Monday", tasks: rows }]);

        expect(groups[0].tasks).toHaveLength(MY_WORK_ROW_LIMIT);
        expect(hidden).toBe(2);
    });

    test("a group trimmed away entirely is not rendered", () => {
        const monday = Array.from({ length: 6 }, (_, i) => task({ id: i + 1 }));
        const tuesday = [task({ id: 99 })];
        const { groups, hidden } = capGroups([
            { key: "mon", label: "Monday", tasks: monday },
            { key: "tue", label: "Tuesday", tasks: tuesday },
        ]);

        expect(groups.map((g) => g.key)).toEqual(["mon"]);
        expect(hidden).toBe(1);
    });
});

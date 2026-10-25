import { describe, expect, test, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ScheduleCalendar from "../ScheduleCalendar";

const tasks = [
    { id: 1, title: "Refund webhook", planned_date: "2026-10-25", story_points: 5 },
    { id: 2, title: "Ledger fix", planned_date: "2026-10-25", story_points: 3 },
    { id: 3, title: "Overdue item", planned_date: "2026-10-20", story_points: 2 },
];

const backlogTasks = [
    { id: 9, title: "Unscheduled work", story_points: 8 },
];

function renderCalendar(overrides: Record<string, unknown> = {}) {
    const props = {
        tasks,
        backlogTasks,
        mode: "month" as const,
        onModeChange: vi.fn(),
        onPlan: vi.fn(),
        onUnschedule: vi.fn(),
        onOpenDetail: vi.fn(),
        today: "2026-10-25",
        ...overrides,
    };
    render(<ScheduleCalendar {...(props as any)} />);
    return props;
}

describe("ScheduleCalendar", () => {
    test("month view renders planned tasks on their days", () => {
        renderCalendar();
        expect(screen.getByRole("grid", { name: "Month" })).toBeTruthy();
        expect(screen.getByText("Refund webhook")).toBeTruthy();
        expect(screen.getByText("Ledger fix")).toBeTruthy();
    });

    test("week view renders seven days", () => {
        renderCalendar({ mode: "week" });
        expect(screen.getByRole("grid", { name: "Week" })).toBeTruthy();
        expect(screen.getAllByRole("gridcell")).toHaveLength(7);
    });

    test("the tray lists backlog tasks without a planned date, ranked", () => {
        renderCalendar();
        const tray = screen.getByRole("complementary", { name: "Unscheduled" });
        expect(tray.textContent).toContain("Unscheduled work");
    });

    test("each day shows its count and point total", () => {
        renderCalendar();
        expect(screen.getByText("2 · 8 pts")).toBeTruthy();
    });

    test("overdue tasks appear in a pinned strip, not inside past days", () => {
        renderCalendar();
        const strip = screen.getByRole("status");
        expect(strip.textContent).toContain("Overdue");
        expect(strip.textContent).toContain("Overdue item");
    });

    test("dragging a tray item onto a day plans it", () => {
        const props = renderCalendar();
        const trayItem = screen.getByRole("button", { name: /Unscheduled work/ });
        fireEvent.dragStart(trayItem);

        const cells = screen.getAllByRole("gridcell");
        fireEvent.drop(cells[0]);

        expect(props.onPlan).toHaveBeenCalledWith(9, expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/));
    });

    test("dragging a card back to the tray clears its day", () => {
        const props = renderCalendar();
        const card = screen.getByRole("button", { name: /Refund webhook/ });
        fireEvent.dragStart(card);

        const tray = screen.getByRole("complementary", { name: "Unscheduled" });
        fireEvent.drop(tray);

        expect(props.onUnschedule).toHaveBeenCalledWith(1);
    });

    test("the grouped list remains selectable", () => {
        const props = renderCalendar();
        fireEvent.click(screen.getByRole("button", { name: "List" }));
        expect(props.onModeChange).toHaveBeenCalledWith("list");
    });
});

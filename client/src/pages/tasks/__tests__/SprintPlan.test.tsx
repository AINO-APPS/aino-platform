import { describe, expect, test, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import SprintPlan from "../SprintPlan";

const backlogTasks = [
    { id: 1, issue_key: "PAY-1", title: "Refund webhook", story_points: 5 },
    { id: 2, issue_key: "PAY-2", title: "Ledger fix", story_points: 3 },
];
const sprintTasks = [
    { id: 3, issue_key: "PAY-3", title: "Retry backoff", story_points: 8 },
];

function renderPlan(overrides: Record<string, unknown> = {}) {
    const props = {
        backlogTasks,
        sprintTasks,
        sprint: { id: 9, name: "Sprint 24", goal: "Refunds never double", velocity_points: 20 },
        velocity: { sprints: [], average: 18 },
        burndown: [
            { snapshot_date: "2026-10-01", remaining_points: 20 },
            { snapshot_date: "2026-10-02", remaining_points: 12 },
        ],
        unitLabel: "SP",
        onMoveToSprint: vi.fn(),
        onMoveToBacklog: vi.fn(),
        onSaveGoal: vi.fn(),
        onOpenDetail: vi.fn(),
        ...overrides,
    };
    render(<SprintPlan {...(props as any)} />);
    return props;
}

describe("SprintPlan", () => {
    test("backlog and sprint are visible simultaneously", () => {
        renderPlan();
        expect(screen.getByRole("region", { name: "Backlog" })).toBeTruthy();
        expect(screen.getByRole("region", { name: "Sprint" })).toBeTruthy();
        expect(screen.getByText("Refund webhook")).toBeTruthy();
        expect(screen.getByText("Retry backoff")).toBeTruthy();
    });

    test("moving a task into the sprint calls back", () => {
        const props = renderPlan();
        fireEvent.click(screen.getByRole("button", { name: /Move Refund webhook into the sprint/ }));
        expect(props.onMoveToSprint).toHaveBeenCalledWith(1);
    });

    test("moving a task back to the backlog calls back", () => {
        const props = renderPlan();
        fireEvent.click(screen.getByRole("button", { name: /Move Retry backoff back to the backlog/ }));
        expect(props.onMoveToBacklog).toHaveBeenCalledWith(3);
    });

    test("committed points sit against the sprint's size", () => {
        renderPlan();
        expect(screen.getByText("8/20 SP")).toBeTruthy();
        expect(screen.getByText(/8 committed of 20 SP/)).toBeTruthy();
    });

    test("the goal is visible and editable inline", () => {
        const props = renderPlan();
        fireEvent.click(screen.getByRole("button", { name: "Refunds never double" }));

        const input = screen.getByLabelText("Sprint goal") as HTMLInputElement;
        fireEvent.change(input, { target: { value: "Ship refunds" } });
        fireEvent.blur(input);

        expect(props.onSaveGoal).toHaveBeenCalledWith("Ship refunds");
    });

    test("recent velocity and a mini burndown are shown", () => {
        renderPlan();
        expect(screen.getByText("Recent velocity")).toBeTruthy();
        expect(screen.getByRole("img", { name: "Mini burndown" })).toBeTruthy();
    });

    test("an empty sprint renders sensibly", () => {
        renderPlan({ sprintTasks: [] });
        expect(screen.getByText("Pull work in from the backlog.")).toBeTruthy();
    });

    test("scope added and removed are shown in points", () => {
        renderPlan({ scope: { addedPoints: 8, removedPoints: 3 } });
        expect(screen.getByText("+8 / −3 scope")).toBeTruthy();
    });

    test("a sprint with no scope change shows zero, not a blank", () => {
        renderPlan();
        expect(screen.getByText("+0 / −0 scope")).toBeTruthy();
    });
});

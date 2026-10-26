import { describe, expect, test, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";
import SprintPlan from "../SprintPlan";
import { TaskProvider } from "../TaskContext";

const backlogTasks = [
    { id: 1, issue_key: "PAY-1", title: "Refund webhook", story_points: 5 },
    { id: 2, issue_key: "PAY-2", title: "Ledger fix", story_points: 3 },
];
const sprintTasks = [
    { id: 3, issue_key: "PAY-3", title: "Retry backoff", story_points: 8 },
];

function planProps(overrides: Record<string, unknown> = {}): any {
    return {
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
}

function renderPlan(overrides: Record<string, unknown> = {}) {
    const props = planProps(overrides);
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

describe("SprintPlan async states", () => {
    test("a backlog that is still loading is not reported as empty", () => {
        renderPlan({ backlogTasks: [], backlogLoading: true });

        expect(screen.queryByText("Nothing left in the backlog.")).toBeNull();
        expect(screen.getByRole("status", { name: "Loading backlog" })).toBeTruthy();
    });

    test("a failed backlog load offers a retry", () => {
        const props = renderPlan({
            backlogTasks: [],
            backlogError: "Failed to load backlog",
            onRetryBacklog: vi.fn(),
        });

        expect(screen.getByText("Failed to load backlog")).toBeTruthy();
        fireEvent.click(screen.getByRole("button", { name: "Retry" }));
        expect(props.onRetryBacklog).toHaveBeenCalledTimes(1);
    });

    test("a backlog refetch keeps the last good rows on screen", () => {
        renderPlan({ backlogLoading: true, backlogError: "Failed to load backlog" });

        expect(screen.getByText("Refund webhook")).toBeTruthy();
        expect(screen.queryByRole("status", { name: "Loading backlog" })).toBeNull();
        // The stale warning keeps the failure visible without hiding the data.
        expect(screen.getByRole("status", { name: "Backlog out of date" })).toBeTruthy();
    });

    test("a sprint that is still loading is not reported as empty", () => {
        renderPlan({ sprintTasks: [], sprintLoading: true });

        expect(screen.queryByText("Pull work in from the backlog.")).toBeNull();
        expect(screen.getByRole("status", { name: "Loading sprint" })).toBeTruthy();
    });

    test("a failed sprint load offers a retry", () => {
        const props = renderPlan({
            sprintTasks: [],
            sprintError: "Failed to load tasks",
            onRetrySprint: vi.fn(),
        });

        expect(screen.getByText("Failed to load tasks")).toBeTruthy();
        fireEvent.click(screen.getByRole("button", { name: "Retry" }));
        expect(props.onRetrySprint).toHaveBeenCalledTimes(1);
    });
});

describe("SprintPlan row layout", () => {
    const assignedBacklog = [
        { ...backlogTasks[0], assignee: { full_name: "Ada Lovelace" } },
        { ...backlogTasks[1], assignee: { full_name: "Grace Hopper" } },
    ];

    function renderWithDensity(density: "comfortable" | "compact") {
        const props = planProps({
            backlogTasks: assignedBacklog,
            sprintTasks: [{ ...sprintTasks[0], assignee: { full_name: "Ada Lovelace" } }],
        });
        render(
            <TaskProvider
                assignableUsers={[]}
                orgLabels={[]}
                availableSprints={[]}
                availableProjects={[]}
                currentUser={null}
                activeTab="sprint"
                cardDensity={density}
            >
                <SprintPlan {...(props as any)} />
            </TaskProvider>,
        );
        return props;
    }

    function cellCount(label: string) {
        return screen.getByText(label).closest("li")!.children.length;
    }

    function lastCellLabel(label: string) {
        const row = screen.getByText(label).closest("li")!;
        return row.children[row.children.length - 1].getAttribute("aria-label");
    }

    test("a comfortable row carries key, title, points, assignee and action", () => {
        renderWithDensity("comfortable");

        expect(cellCount("Refund webhook")).toBe(5);
        expect(cellCount("Retry backoff")).toBe(5);
    });

    test("a compact row drops the assignee and keeps four cells", () => {
        renderWithDensity("compact");

        expect(cellCount("Refund webhook")).toBe(4);
        expect(cellCount("Retry backoff")).toBe(4);
        expect(screen.queryByText("Ada Lovelace")).toBeNull();
    });

    test("a comfortable row without an assignee still keeps its action in the last column", () => {
        const props = planProps({ backlogTasks: [backlogTasks[0]] });
        render(<SprintPlan {...(props as any)} />);

        const row = screen.getByText("Refund webhook").closest("li")!;
        expect(row.children).toHaveLength(4);
        expect(row.children[3].getAttribute("aria-label")).toMatch(/into the sprint/);
    });

    test("both panes put the action button in the same, last cell", () => {
        renderWithDensity("comfortable");

        expect(lastCellLabel("Refund webhook")).toMatch(/Move Refund webhook into the sprint/);
        expect(lastCellLabel("Retry backoff")).toMatch(/Move Retry backoff back to the backlog/);
    });

    test("the stylesheet declares one column for every cell in both densities", () => {
        const css = fs.readFileSync(
            path.join(__dirname, "..", "SprintPlan.module.css"),
            "utf8",
        );
        const tracks = (className: string) => {
            const block = css.match(new RegExp(`\\.${className}\\s*\\{([^}]*)\\}`))?.[1] ?? "";
            const value = block.match(/grid-template-columns:\s*([^;]+);/)?.[1] ?? "";
            // A `minmax(0, 1fr)` track contains a space; count it as one.
            return value.trim().replace(/minmax\([^)]*\)/g, "track").split(/\s+/).filter(Boolean);
        };

        expect(tracks("plan-row")).toHaveLength(5);
        expect(tracks("plan-row-compact")).toHaveLength(4);

        // The action is pinned to the last track, which holds for both the
        // five-cell comfortable row and the four-cell compact row.
        const action = css.match(/\.plan-move\s*\{([^}]*)\}/)?.[1] ?? "";
        expect(action).toMatch(/grid-column:\s*-2\s*\/\s*-1/);
    });
});

describe("SprintPlan goal synchronisation", () => {
    function rerenderWith(
        rerender: (ui: React.ReactElement) => void,
        overrides: Record<string, unknown>,
    ) {
        rerender(<SprintPlan {...(planProps(overrides) as any)} />);
    }

    test("the goal appears when the sprint arrives after the first render", () => {
        const { rerender } = render(<SprintPlan {...(planProps({ sprint: undefined }) as any)} />);
        expect(screen.getByRole("button", { name: "Set a goal" })).toBeTruthy();

        rerenderWith(rerender, {
            sprint: { id: 9, name: "Sprint 24", goal: "Refunds never double", velocity_points: 20 },
        });
        expect(screen.getByRole("button", { name: "Refunds never double" })).toBeTruthy();
    });

    test("the goal follows the selected sprint", () => {
        const { rerender } = render(<SprintPlan {...(planProps() as any)} />);

        rerenderWith(rerender, {
            sprint: { id: 10, name: "Sprint 25", goal: "Ship the ledger", velocity_points: 20 },
        });
        expect(screen.getByRole("button", { name: "Ship the ledger" })).toBeTruthy();
    });

    test("blurring an untouched placeholder never writes the placeholder", () => {
        const props = planProps({ sprint: undefined });
        render(<SprintPlan {...(props as any)} />);

        fireEvent.click(screen.getByRole("button", { name: "Set a goal" }));
        fireEvent.blur(screen.getByLabelText("Sprint goal"));

        expect(props.onSaveGoal).not.toHaveBeenCalled();
    });

    test("an arriving sprint is adopted when the user was only looking", () => {
        const props = planProps({ sprint: undefined });
        const { rerender } = render(<SprintPlan {...(props as any)} />);

        fireEvent.click(screen.getByRole("button", { name: "Set a goal" }));
        rerenderWith(rerender, {
            sprint: { id: 9, name: "Sprint 24", goal: "Refunds never double", velocity_points: 20 },
        });
        fireEvent.blur(screen.getByLabelText("Sprint goal"));

        expect(props.onSaveGoal).not.toHaveBeenCalled();
        expect(screen.getByRole("button", { name: "Refunds never double" })).toBeTruthy();
    });

    test("Escape restores the sprint goal without saving", () => {
        const props = renderPlan();
        fireEvent.click(screen.getByRole("button", { name: "Refunds never double" }));
        const input = screen.getByLabelText("Sprint goal");

        fireEvent.change(input, { target: { value: "Something else" } });
        fireEvent.keyDown(input, { key: "Escape" });

        expect(props.onSaveGoal).not.toHaveBeenCalled();
        expect(screen.getByRole("button", { name: "Refunds never double" })).toBeTruthy();
    });
});

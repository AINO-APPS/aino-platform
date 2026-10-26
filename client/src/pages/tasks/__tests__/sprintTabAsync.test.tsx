/**
 * The Sprint tab never mistakes "still loading" for "empty".
 *
 * The plan's backlog pane and the board each load independently of the sprint
 * tasks. Both surfaces share one async contract: a skeleton on first load, an
 * error with Retry on failure, and the last good data during a refetch.
 */
import { describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import SprintTab from "../SprintTab";
import { ToastProvider } from "../../../components/common/Toast";

const noop = vi.fn();

function renderTab(overrides: Record<string, unknown> = {}) {
    const props: any = {
        stats: { done: 0, total: 0, percent: 0 },
        sprintStats: null,
        features: {},
        unitLabel: "SP",
        availableSprints: [],
        selectedSprintId: null,
        currentUser: null,
        getColTasks: () => [],
        onSprintChanged: noop,
        carriedCount: 0,
        error: "",
        sprintImportOpen: false,
        backlog: {
            backlogTasks: [],
            backlogLoading: false,
            backlogError: null,
            fetchBacklog: noop,
            importConfigTask: null,
        },
        assignableUsers: [],
        onCloseImport: noop,
        loading: false,
        tasks: [],
        drag: {
            dragOverCol: null, onDragOver: noop, onDragLeave: noop,
            onDrop: noop, onDragStart: noop, onDragEnd: noop,
        },
        sprintMode: true,
        onOpenDetail: noop,
        onOpenComments: noop,
        boardDrag: {
            draggingId: null, overColumn: null, onKeyDown: noop,
            onDragStart: noop, onDragOver: noop, onDrop: noop,
        },
        boardAnnouncement: "",
        plan: true,
        sprintPlan: {
            velocity: { sprints: [], average: 0 },
            burndown: [],
            moveToSprint: noop,
            moveToBacklog: noop,
            saveGoal: noop,
            scope: { addedPoints: 0, removedPoints: 0 },
        },
        epics: [],
        selectedEpicId: null,
        onSelectEpic: noop,
        onRetry: noop,
        ...overrides,
    };
    render(
        <ToastProvider>
            <SprintTab {...props} />
        </ToastProvider>,
    );
    return props;
}

describe("SprintTab async states", () => {
    test("the plan backlog pane shows loading, not an empty backlog", () => {
        renderTab({ backlog: { backlogTasks: [], backlogLoading: true, backlogError: null, fetchBacklog: noop } });

        expect(screen.getByRole("status", { name: "Loading backlog" })).toBeTruthy();
        expect(screen.queryByText("Nothing left in the backlog.")).toBeNull();
    });

    test("the plan backlog pane offers retry when the load fails", () => {
        const fetchBacklog = vi.fn();
        renderTab({ backlog: { backlogTasks: [], backlogLoading: false, backlogError: "Failed to load backlog", fetchBacklog } });

        expect(screen.getByText("Failed to load backlog")).toBeTruthy();
        fireEvent.click(screen.getByRole("button", { name: "Retry" }));
        expect(fetchBacklog).toHaveBeenCalledTimes(1);
    });

    test("the board shows a skeleton on first load instead of 'no items'", () => {
        renderTab({ plan: false, loading: true });

        expect(screen.getByRole("status", { name: "Loading sprint board" })).toBeTruthy();
        expect(screen.queryByText("No items in this sprint")).toBeNull();
    });

    test("the board keeps arrived tasks visible during a refetch", () => {
        renderTab({
            plan: false,
            loading: true,
            tasks: [{ id: 3, title: "Retry backoff", workflow_state_key: "in_progress" }],
        });

        expect(screen.getByText("Retry backoff")).toBeTruthy();
        expect(screen.queryByRole("status", { name: "Loading sprint board" })).toBeNull();
    });

    test("a failed board load offers retry", () => {
        const onRetry = vi.fn();
        renderTab({ plan: false, error: "Failed to load tasks", onRetry });

        expect(screen.getByRole("alert")).toHaveTextContent("Failed to load tasks");
        fireEvent.click(screen.getByRole("button", { name: "Retry" }));
        expect(onRetry).toHaveBeenCalledTimes(1);
    });
});

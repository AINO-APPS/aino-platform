/**
 * Board drag is one confirmed, cancel-safe interaction.
 *
 * Pointer drag (@dnd-kit): the card lands in the target column at once — the
 * board shows the move the user made — and a confirmation follows. Accept sends
 * exactly one PATCH; Cancel animates the card back and sends nothing; a refused
 * PATCH snaps it back.
 *
 * Keyboard moves keep the ask-first contract: arrow keys choose a column and
 * nothing changes until the dialog is accepted.
 */
import React from "react";
import { describe, expect, test, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { updateTaskStatus } from "../../../api/tasks";
import { useConfirmDialog } from "../hooks/useConfirmDialog";
import { useDragDrop } from "../hooks/useDragDrop";
import { useBoardDragWiring } from "../hooks/useBoardDragWiring";
import KanbanBoard from "../KanbanBoard";
import TasksConfirmDialogs from "../TasksConfirmDialogs";

const { columns } = vi.hoisted(() => ({
    columns: [
        { id: 1, key: "pending", name: "New", category: "open", is_initial: true },
        { id: 2, key: "in_progress", name: "In Progress", category: "in_progress" },
        { id: 3, key: "done", name: "Done", category: "done", is_terminal: true },
    ],
}));

vi.mock("../../../AgileConfigContext", () => ({
    useAgileConfig: () => ({ workflowStates: columns, features: {} }),
}));

// The card is not what these tests exercise; the column is the drop target.
vi.mock("../TaskCard", () => ({
    default: ({ task }: any) => <div id={`task-${task.id}`} data-testid={`task-${task.id}`} />,
}));

vi.mock("../../../api/tasks", () => ({
    updateTaskStatus: vi.fn().mockResolvedValue({ data: {} }),
}));

const pendingTask = {
    id: 42,
    title: "Refund webhook retries",
    workflow_state_key: "pending",
    workflow_state_id: 1,
};


const harness: { drop?: (taskId: number | string, column: any) => void } = {};

/** The real board, the real hooks, the real dialog. */
function BoardHarness({
    task = pendingTask,
    onTasks,
}: {
    task?: any;
    onTasks: (tasks: any[]) => void;
}) {
    const [tasks, setTasks] = React.useState<any[]>([task]);
    const record = (updater: any) =>
        setTasks((previous) => {
            const next = typeof updater === "function" ? updater(previous) : updater;
            onTasks(next);
            return next;
        });

    const { confirmDialog, showConfirm, closeConfirm, cancelConfirm } = useConfirmDialog();
    const drag = useDragDrop({
        tasks,
        setTasks: record,
        showConfirm,
        closeConfirm,
        setError: vi.fn(),
    });
    const { boardDrag, announcement } = useBoardDragWiring({
        tasks,
        columns,
        showConfirm,
        closeConfirm,
        onMove: (moved: any, column: any) => drag.commitMove(moved, column),
    });
    // @dnd-kit's pointer sensors need real layout; tests drive the drop the
    // board's onDragEnd performs.
    harness.drop = (taskId, column) => {
        boardDrag.reset?.();
        drag.dropOnColumn(taskId, column);
    };

    return (
        <>
            <KanbanBoard
                tasks={tasks}
                drag={drag}
                onOpenDetail={vi.fn()}
                onOpenComments={vi.fn()}
                boardDrag={boardDrag}
                announcement={announcement}
            />
            <TasksConfirmDialogs
                taskToCancel={null}
                onConfirmCancel={vi.fn()}
                onDismissCancel={vi.fn()}
                confirmDialog={confirmDialog}
                onCancelConfirm={cancelConfirm}
            />
        </>
    );
}

function column(key: string) {
    return screen.getByText(
        columns.find((candidate) => candidate.key === key)!.name,
    ).closest("[data-column-key]")!;
}

describe("pointer drop lands the card, then confirms", () => {
    beforeEach(() => vi.clearAllMocks());

    function drop(key: string) {
        act(() => harness.drop!(pendingTask.id, columns.find((c) => c.key === key)));
    }

    test("a drop moves the card at once but sends nothing before the answer", () => {
        const onTasks = vi.fn();
        render(<BoardHarness onTasks={onTasks} />);

        drop("in_progress");

        expect(onTasks).toHaveBeenCalledTimes(1);
        expect(onTasks.mock.calls[0][0][0].workflow_state_key).toBe("in_progress");
        expect(updateTaskStatus).not.toHaveBeenCalled();
        expect(screen.getByText(/Move "Refund webhook retries" to In Progress\?/)).toBeInTheDocument();
    });

    test("accepting sends exactly one PATCH and keeps the card", async () => {
        const onTasks = vi.fn();
        render(<BoardHarness onTasks={onTasks} />);

        drop("in_progress");
        fireEvent.click(screen.getByRole("button", { name: "Move" }));

        await waitFor(() =>
            expect(updateTaskStatus).toHaveBeenCalledWith(pendingTask.id, "in_progress"),
        );
        expect(updateTaskStatus).toHaveBeenCalledTimes(1);
        expect(onTasks.mock.calls.at(-1)![0][0].workflow_state_key).toBe("in_progress");
    });

    test("cancelling puts the card back and sends nothing", () => {
        const onTasks = vi.fn();
        render(<BoardHarness onTasks={onTasks} />);

        drop("in_progress");
        fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

        expect(updateTaskStatus).not.toHaveBeenCalled();
        expect(onTasks.mock.calls.at(-1)![0][0].workflow_state_key).toBe("pending");
    });

    test("a drop on the card's own column does nothing", () => {
        const onTasks = vi.fn();
        render(<BoardHarness onTasks={onTasks} />);

        drop("pending");

        expect(onTasks).not.toHaveBeenCalled();
        expect(screen.queryByRole("button", { name: "Move" })).toBeNull();
    });

    test("a move into Done carries the blocker advisory, and Cancel still restores", () => {
        const blocked = {
            ...pendingTask,
            workflow_state_key: "in_progress",
            workflow_state_id: 2,
            is_blocked: true,
        };
        const onTasks = vi.fn();
        render(<BoardHarness task={blocked} onTasks={onTasks} />);

        act(() => harness.drop!(blocked.id, columns[2]));

        expect(screen.getByText(/This ticket has an open blocker/)).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

        expect(updateTaskStatus).not.toHaveBeenCalled();
        expect(onTasks.mock.calls.at(-1)![0][0].workflow_state_key).toBe("in_progress");
    });

    test("a refused move rolls the card back to its original column", async () => {
        (updateTaskStatus as any).mockRejectedValueOnce({
            response: { data: { error: "WIP limit reached", code: "WIP_EXCEEDED" } },
        });
        const onTasks = vi.fn();
        render(<BoardHarness onTasks={onTasks} />);

        drop("in_progress");
        fireEvent.click(screen.getByRole("button", { name: "Move" }));

        await waitFor(() =>
            expect(onTasks.mock.calls.at(-1)![0][0].workflow_state_key).toBe("pending"),
        );
        expect(updateTaskStatus).toHaveBeenCalledTimes(1);
    });
});
describe("keyboard moves are staged the same way", () => {
    beforeEach(() => vi.clearAllMocks());

    function liftAndChooseInProgress() {
        const card = screen.getByTestId(`task-${pendingTask.id}`);
        fireEvent.keyDown(card, { key: " " });
        fireEvent.keyDown(card, { key: "ArrowRight" });
        // Arrow keys only choose a column; the drop stages the dialog.
        fireEvent.keyDown(card, { key: " " });
    }

    test("arrow keys choose a target and the drop asks before changing anything", () => {
        const onTasks = vi.fn();
        render(<BoardHarness onTasks={onTasks} />);

        const card = screen.getByTestId(`task-${pendingTask.id}`);
        fireEvent.keyDown(card, { key: " " });
        expect(card.parentElement!.getAttribute("aria-grabbed")).toBe("true");

        fireEvent.keyDown(card, { key: "ArrowRight" });
        expect(updateTaskStatus).not.toHaveBeenCalled();
        expect(onTasks).not.toHaveBeenCalled();

        fireEvent.keyDown(card, { key: " " });
        expect(updateTaskStatus).not.toHaveBeenCalled();
        expect(onTasks).not.toHaveBeenCalled();
        expect(screen.getByRole("button", { name: "Move" })).toBeInTheDocument();
        expect(screen.getByText(/Move "Refund webhook retries" to In Progress\?/)).toBeInTheDocument();
    });

    test("accepting a keyboard move sends exactly one PATCH", async () => {
        const onTasks = vi.fn();
        render(<BoardHarness onTasks={onTasks} />);

        liftAndChooseInProgress();
        fireEvent.click(screen.getByRole("button", { name: "Move" }));

        await waitFor(() =>
            expect(updateTaskStatus).toHaveBeenCalledWith(pendingTask.id, "in_progress"),
        );
        expect(updateTaskStatus).toHaveBeenCalledTimes(1);
        expect(onTasks).toHaveBeenCalledTimes(1);
    });

    test("cancelling a keyboard move changes nothing", async () => {
        const onTasks = vi.fn();
        render(<BoardHarness onTasks={onTasks} />);

        liftAndChooseInProgress();
        await act(async () => {
            fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
        });

        expect(updateTaskStatus).not.toHaveBeenCalled();
        expect(onTasks).not.toHaveBeenCalled();
    });

    test("escape clears the lift, aria-grabbed and the drop indicator", () => {
        render(<BoardHarness onTasks={vi.fn()} />);

        const card = screen.getByTestId(`task-${pendingTask.id}`);
        fireEvent.keyDown(card, { key: " " });
        fireEvent.keyDown(card, { key: "ArrowRight" });
        expect(screen.getByText("Drop here")).toBeInTheDocument();

        fireEvent.keyDown(card, { key: "Escape" });

        expect(card.parentElement!.getAttribute("aria-grabbed")).toBe("false");
        expect(screen.queryByText("Drop here")).toBeNull();
        expect(updateTaskStatus).not.toHaveBeenCalled();
    });
});

describe("a keyboard lift is cleared by a pointer drag", () => {
    beforeEach(() => vi.clearAllMocks());

    test("starting a pointer drag drops an active keyboard lift", () => {
        render(<BoardHarness onTasks={vi.fn()} />);
        const card = screen.getByTestId(`task-${pendingTask.id}`);

        fireEvent.keyDown(card, { key: " " });
        fireEvent.keyDown(card, { key: "ArrowRight" });
        expect(screen.getByText("Drop here")).toBeInTheDocument();

        act(() => harness.drop!(pendingTask.id, columns[0]));

        expect(card.parentElement!.getAttribute("aria-grabbed")).toBe("false");
        expect(updateTaskStatus).not.toHaveBeenCalled();
    });
});
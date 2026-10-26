/**
 * Board drag is one staged, cancel-safe interaction.
 *
 * The board used to run two pointer drag systems over the same cards. A drop
 * opened the confirmation through `useDragDrop` and *also* called
 * `useBoardDrag.onDrop`, which PATCHed the status and refetched before the user
 * answered. Cancelling the dialog therefore still moved the ticket.
 *
 * These tests render the real board with the real hooks and assert the
 * contract: nothing is mutated or sent until the dialog is accepted, exactly
 * one PATCH follows an accepted move, and Cancel changes nothing.
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
    default: ({ task, onDragStart, onDragEnd }: any) => (
        <div
            id={`task-${task.id}`}
            data-testid={`task-${task.id}`}
            draggable
            onDragStart={(event: any) => onDragStart?.(event, task.id)}
            onDragEnd={(event: any) => onDragEnd?.(event, task.id)}
        />
    ),
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

function dataTransfer(id: number | string) {
    return {
        getData: () => String(id),
        setData: vi.fn(),
        dropEffect: "",
        effectAllowed: "",
    };
}

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

    return (
        <>
            <KanbanBoard
                tasks={tasks}
                dragOverCol={drag.dragOverCol}
                draggingTaskId={drag.draggingTaskId}
                onDragOver={drag.onDragOver}
                onDragLeave={drag.onDragLeave}
                onDrop={drag.onDrop}
                onDragStart={drag.onDragStart}
                onDragEnd={drag.onDragEnd}
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

describe("pointer drop is staged behind one confirmation", () => {
    beforeEach(() => vi.clearAllMocks());

    test("a drop sends nothing until the move is accepted", () => {
        const onTasks = vi.fn();
        render(<BoardHarness onTasks={onTasks} />);

        fireEvent.drop(column("in_progress"), { dataTransfer: dataTransfer(pendingTask.id) });

        expect(updateTaskStatus).not.toHaveBeenCalled();
        expect(onTasks).not.toHaveBeenCalled();
        expect(screen.getByRole("button", { name: "Move" })).toBeInTheDocument();
        expect(
            screen.getByText(/Move "Refund webhook retries" to In Progress\?/),
        ).toBeInTheDocument();
    });

    test("accepting performs one optimistic update and exactly one PATCH", async () => {
        const onTasks = vi.fn();
        render(<BoardHarness onTasks={onTasks} />);

        fireEvent.drop(column("in_progress"), { dataTransfer: dataTransfer(pendingTask.id) });
        fireEvent.click(screen.getByRole("button", { name: "Move" }));

        await waitFor(() =>
            expect(updateTaskStatus).toHaveBeenCalledWith(pendingTask.id, "in_progress"),
        );
        expect(updateTaskStatus).toHaveBeenCalledTimes(1);
        expect(onTasks).toHaveBeenCalledTimes(1);
        expect(onTasks.mock.calls[0][0][0].workflow_state_key).toBe("in_progress");
    });

    test("cancelling mutates nothing, sends nothing and refetches nothing", () => {
        const onTasks = vi.fn();
        render(<BoardHarness onTasks={onTasks} />);

        fireEvent.drop(column("in_progress"), { dataTransfer: dataTransfer(pendingTask.id) });
        fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

        expect(updateTaskStatus).not.toHaveBeenCalled();
        expect(onTasks).not.toHaveBeenCalled();
    });

    test("cancelling the confirmation does not resolve into a later move", async () => {
        const onTasks = vi.fn();
        render(<BoardHarness onTasks={onTasks} />);

        fireEvent.drop(column("in_progress"), { dataTransfer: dataTransfer(pendingTask.id) });
        fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
        await Promise.resolve();

        expect(updateTaskStatus).not.toHaveBeenCalled();
        expect(onTasks).not.toHaveBeenCalled();
    });

    test("a pointer move into Done carries the blocker advisory, and Cancel still wins", () => {
        // New → Done is not a legal transition (issue 04); active work may go
        // straight to Done, so the advisory path starts from In Progress.
        const blocked = {
            ...pendingTask,
            workflow_state_key: "in_progress",
            workflow_state_id: 2,
            is_blocked: true,
        };
        const onTasks = vi.fn();
        render(<BoardHarness task={blocked} onTasks={onTasks} />);

        fireEvent.drop(column("done"), { dataTransfer: dataTransfer(blocked.id) });

        expect(screen.getByText(/This ticket has an open blocker/)).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

        expect(updateTaskStatus).not.toHaveBeenCalled();
        expect(onTasks).not.toHaveBeenCalled();
    });

    test("a refused move rolls the card back to its original column", async () => {
        (updateTaskStatus as any).mockRejectedValueOnce({
            response: { data: { error: "WIP limit reached", code: "WIP_EXCEEDED" } },
        });
        const onTasks = vi.fn();
        render(<BoardHarness onTasks={onTasks} />);

        fireEvent.drop(column("in_progress"), { dataTransfer: dataTransfer(pendingTask.id) });
        fireEvent.click(screen.getByRole("button", { name: "Move" }));

        await waitFor(() => expect(onTasks).toHaveBeenCalledTimes(2));
        expect(onTasks.mock.calls[0][0][0].workflow_state_key).toBe("in_progress");
        expect(onTasks.mock.calls[1][0][0].workflow_state_key).toBe("pending");
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

describe("an aborted pointer drag resets the board", () => {
    beforeEach(() => vi.clearAllMocks());

    test("dragEnd clears the drop indicator and leaves the ticket alone", () => {
        render(<BoardHarness onTasks={vi.fn()} />);
        const card = document.getElementById(`task-${pendingTask.id}`)!;

        fireEvent.dragStart(card, {
            dataTransfer: { setData: vi.fn(), effectAllowed: "" },
        });
        fireEvent.dragOver(column("in_progress"), {
            dataTransfer: { dropEffect: "" },
        });
        expect(screen.getByText("Drop here")).toBeInTheDocument();

        // Dropping outside the board (or pressing Escape) ends with dragEnd
        // and no drop event at all.
        fireEvent.dragEnd(card);

        expect(screen.queryByText("Drop here")).toBeNull();
        expect(updateTaskStatus).not.toHaveBeenCalled();
    });

    test("dragEnd also drops an active keyboard lift", () => {
        render(<BoardHarness onTasks={vi.fn()} />);
        const card = screen.getByTestId(`task-${pendingTask.id}`);

        fireEvent.keyDown(card, { key: " " });
        fireEvent.keyDown(card, { key: "ArrowRight" });
        expect(screen.getByText("Drop here")).toBeInTheDocument();

        fireEvent.dragEnd(card);

        expect(card.parentElement!.getAttribute("aria-grabbed")).toBe("false");
        expect(screen.queryByText("Drop here")).toBeNull();
        expect(updateTaskStatus).not.toHaveBeenCalled();
    });
});

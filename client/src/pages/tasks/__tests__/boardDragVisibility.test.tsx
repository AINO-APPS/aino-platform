/**
 * Dragging a board card must not make it disappear.
 *
 * The board wires two drag systems to the same card: the legacy HTML5
 * `useDragDrop` (which toggles a `dragging` class on `#task-<id>`) and the
 * accessible `useBoardDrag` (which tracks `draggingId` in React state). The
 * card is also the drag image the browser paints under the cursor, so any
 * opacity applied to it makes the ticket the user is moving vanish.
 *
 * The card must stay fully opaque while it is being dragged.
 */
import { describe, expect, test, vi } from "vitest";
import { fireEvent, render, renderHook } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import TaskCard from "../TaskCard";
import { TaskProvider } from "../TaskContext";
import { ToastProvider } from "../../../components/common/Toast";
import { useDragDrop } from "../hooks/useDragDrop";
import cardStyles from "../TaskCard.module.css";
import fs from "node:fs";
import path from "node:path";

const task = {
    id: 42,
    title: "Refund webhook retries",
    issue_key: "PAY-142",
    priority: "high",
    workflow_state_key: "in_progress",
    due_date: "2099-11-01",
};

function renderCard() {
    return render(
        <MemoryRouter>
            <ToastProvider>
                <TaskProvider
                    assignableUsers={[]}
                    orgLabels={[]}
                    availableSprints={[]}
                    availableProjects={[]}
                    currentUser={null}
                    activeTab="sprint"
                >
                    <TaskCard
                        task={task}
                        sprintMode
                        onOpenDetail={vi.fn()}
                        onOpenComments={vi.fn()}
                        onDragStart={vi.fn()}
                        onDragEnd={vi.fn()}
                    />
                </TaskProvider>
            </ToastProvider>
        </MemoryRouter>,
    );
}

describe("board card drag affordance", () => {
    test("the card stays opaque while it is being dragged", () => {
        renderCard();
        const card = document.getElementById(`task-${task.id}`);
        expect(card).not.toBeNull();

        fireEvent.dragStart(card!);

        // The card is the browser's drag image; dimming it hides the ticket.
        expect(card!.className).not.toContain(cardStyles.dragging);
        expect(card!.style.opacity === "" || card!.style.opacity === "1").toBe(true);
    });

    test("useDragDrop does not dim the card it is moving", () => {
        renderCard();
        const card = document.getElementById(`task-${task.id}`)!;

        const { result } = renderHook(() =>
            useDragDrop({
                tasks: [task] as any,
                setTasks: vi.fn(),
                showConfirm: vi.fn(),
                closeConfirm: vi.fn(),
                setError: vi.fn(),
            }),
        );

        result.current.onDragStart(
            { dataTransfer: { setData: vi.fn(), effectAllowed: "" } } as any,
            task.id,
        );

        expect(card.className).not.toContain(cardStyles.dragging);
    });

    test("the stylesheet does not dim a card that is being dragged", () => {
        const css = fs.readFileSync(
            path.join(__dirname, "..", "TaskCard.module.css"),
            "utf8",
        );
        // A `.dragging` rule that lowers opacity is the bug: the card under the
        // cursor becomes see-through and the ticket is unreadable mid-move.
        const dimmingRule = /\.task-card\.dragging\s*\{[^}]*opacity\s*:\s*(0?\.\d+)/;
        expect(css).not.toMatch(dimmingRule);
    });

    test("the backlog does not dim the row being reordered", () => {
        const css = fs.readFileSync(
            path.join(__dirname, "..", "BacklogTab.module.css"),
            "utf8",
        );
        // The dragged row is the one the user is reading; a placeholder or an
        // outline marks it without making the ticket disappear.
        const dimmingRule = /\.backlog-card-dragging[^{]*\{[^}]*opacity\s*:\s*(0?\.\d+)/;
        expect(css).not.toMatch(dimmingRule);
        expect(css).toMatch(/\.backlog-card-dragging[^{]*\{[^}]*outline/);
    });

    test("a keyboard-lifted board card is outlined, never dimmed", () => {
        const css = fs.readFileSync(
            path.join(__dirname, "..", "KanbanBoard.module.css"),
            "utf8",
        );
        expect(css).toMatch(/\.card-lifted\s*\{[^}]*outline/);
        expect(css).not.toMatch(/\.card-lifted\s*\{[^}]*opacity\s*:\s*(0?\.\d+)/);
    });
});

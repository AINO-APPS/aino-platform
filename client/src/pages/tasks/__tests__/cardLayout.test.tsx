/**
 * The card anatomy, locked down.
 *
 * The redesign's rules are structural, not cosmetic: the title is the anchor,
 * secondary detail (creator, timestamps) lives in the fullscreen view, labels
 * are capped at two, and the exceptions (blocked, overdue) survive compact. Each test below fails
 * if one of those rules regresses.
 */
import { describe, expect, test, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import BacklogCard from "../BacklogCard";
import TaskCard from "../TaskCard";
import { TaskProvider } from "../TaskContext";
import { ToastProvider } from "../../../components/common/Toast";

const baseTask = {
    id: 7,
    title: "Refund webhook retries",
    issue_key: "PAY-142",
    priority: "high",
    story_points: 5,
    status: "pending",
    workflow_state_key: "in_progress",
    assignee: { id: 2, full_name: "Ada Lovelace", username: "ada" },
    labels: [
        { id: 1, name: "payments", color: "#22c55e" },
        { id: 2, name: "billing", color: "#3b82f6" },
        { id: 3, name: "urgent", color: "#ef4444" },
    ],
    description: "<p>A long description that cards no longer preview.</p>",
    due_date: "2026-11-01",
    created_at: "2026-10-20T09:00:00Z",
};

function wrap(density: "comfortable" | "compact", node: React.ReactNode) {
    return render(
        <MemoryRouter>
            <ToastProvider>
                <TaskProvider
                    assignableUsers={[]}
                    orgLabels={[]}
                    availableSprints={[]}
                    availableProjects={[]}
                    currentUser={null}
                    activeTab="backlog"
                    cardDensity={density}
                >
                    {node}
                </TaskProvider>
            </ToastProvider>
        </MemoryRouter>,
    );
}

const boardCard = (task: any = baseTask) => (
    <TaskCard
        task={task}
        onOpenDetail={vi.fn()}
        onOpenComments={vi.fn()}
        onDragStart={vi.fn()}
        onDragEnd={vi.fn()}
    />
);

const backlogCard = (task: any = baseTask) => (
    <BacklogCard
        task={task}
        workflowStates={[]}
        scheduleTaskId={null}
        scheduleDate=""
        setScheduleTaskId={vi.fn()}
        setScheduleDate={vi.fn()}
        onOpenDetail={vi.fn()}
        onScheduleTask={vi.fn()}
    />
);

describe("card anatomy", () => {
    test("the description is not previewed on a compact card", () => {
        wrap("compact", boardCard());
        expect(screen.queryByText(/A long description/)).toBeNull();
    });

    test("the creator and relative timestamps are not on a card", () => {
        const task = {
            ...baseTask,
            creator: { id: 9, full_name: "Grace Hopper", username: "grace" },
            assigned_to: 2,
            user_id: 9,
        };
        wrap("comfortable", boardCard(task));
        expect(screen.queryByText("Grace Hopper")).toBeNull();
    });

    test("at most two labels show, with the rest behind a count", () => {
        wrap("comfortable", boardCard());
        expect(screen.getByText("payments")).toBeTruthy();
        expect(screen.getByText("billing")).toBeTruthy();
        expect(screen.queryByText("urgent")).toBeNull();
        expect(screen.getByRole("button", { name: "Show all 3 labels" })).toBeTruthy();
    });

    test("expanding the label overflow reveals the remaining labels", () => {
        wrap("comfortable", boardCard());
        fireEvent.click(screen.getByRole("button", { name: "Show all 3 labels" }));
        expect(screen.getByText("urgent")).toBeTruthy();
    });

    test("the card exposes one overflow menu instead of a row of buttons", () => {
        wrap("comfortable", boardCard());
        const trigger = screen.getByRole("button", { name: "Actions for PAY-142" });
        expect(trigger.getAttribute("aria-haspopup")).toBe("menu");
        fireEvent.click(trigger);
        expect(screen.getByRole("menu")).toBeTruthy();
        expect(screen.getByRole("menuitem", { name: "Open task" })).toBeTruthy();
    });

    test("the overflow menu closes on escape and returns focus", () => {
        wrap("comfortable", boardCard());
        const trigger = screen.getByRole("button", { name: "Actions for PAY-142" });
        fireEvent.click(trigger);
        fireEvent.keyDown(document, { key: "Escape" });
        expect(screen.queryByRole("menu")).toBeNull();
        expect(document.activeElement).toBe(trigger);
    });
});

describe("exceptions survive compact density", () => {
    const blockedOverdue = {
        ...baseTask,
        is_blocked: true,
        blocked_reason: "Waiting on API access",
        due_date: "2020-01-01",
    };

    test("a compact board card still shows blocked and overdue", () => {
        wrap("compact", boardCard(blockedOverdue));
        expect(screen.getByText("Blocked")).toBeTruthy();
        expect(screen.getByText(/Overdue/)).toBeTruthy();
    });

    test("a compact backlog row still shows blocked and overdue", () => {
        wrap("compact", backlogCard(blockedOverdue));
        expect(screen.getByText("Blocked")).toBeTruthy();
        expect(screen.getByText(/Overdue/)).toBeTruthy();
    });

    test("compact shows the assignee as an avatar, not a name", () => {
        wrap("compact", boardCard());
        expect(screen.queryByText("Ada Lovelace")).toBeNull();
        expect(screen.getByLabelText("Assigned to Ada Lovelace")).toBeTruthy();
    });
});

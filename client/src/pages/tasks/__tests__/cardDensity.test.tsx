import { describe, expect, test, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
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
    assignee: { id: 2, full_name: "Ada Lovelace", username: "ada" },
    labels: [{ id: 1, name: "payments", color: "#22c55e" }],
    description: "<p>A long description that compact mode hides.</p>",
    due_date: "2026-11-01",
    created_at: "2026-10-20T09:00:00Z",
};

function renderWithDensity(
    density: "comfortable" | "compact",
    node: React.ReactNode,
) {
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

const backlogCard = (
    <BacklogCard
        task={baseTask}
        workflowStates={[]}
        scheduleTaskId={null}
        scheduleDate=""
        setScheduleTaskId={vi.fn()}
        setScheduleDate={vi.fn()}
        onOpenDetail={vi.fn()}
        onScheduleTask={vi.fn()}
    />
);

const boardCard = (
    <TaskCard
        task={baseTask}
        onOpenDetail={vi.fn()}
        onOpenComments={vi.fn()}
        onDragStart={vi.fn()}
        onDragEnd={vi.fn()}
    />
);

describe("card density", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    test.each([
        ["backlog row", backlogCard],
        ["board card", boardCard],
    ])("compact %s keeps the full scannable anatomy", (_name, card) => {
        renderWithDensity("compact", card);
        expect(screen.getByText("PAY-142")).toBeTruthy();
        expect(screen.getByText("Refund webhook retries")).toBeTruthy();
        expect(screen.getByText("5")).toBeTruthy();
        expect(screen.getByLabelText("Assigned to Ada Lovelace")).toBeTruthy();
        expect(screen.getByLabelText("High priority")).toBeTruthy();
        expect(screen.getByText("payments")).toBeTruthy();
        expect(screen.queryByText(/A long description/)).toBeNull();
    });

    test.each([
        ["backlog row", backlogCard],
        ["board card", boardCard],
    ])("comfortable %s adds the description preview", (_name, card) => {
        renderWithDensity("comfortable", card);
        expect(screen.getByText(/A long description/)).toBeTruthy();
    });

    test("compact still renders the title at full contrast for legibility", () => {
        renderWithDensity("compact", boardCard);
        const title = screen.getByText("Refund webhook retries");
        expect(title.className).toContain("task-title");
    });
});
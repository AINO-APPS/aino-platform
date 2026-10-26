/**
 * First paint with the fallback Agile config.
 *
 * Before `/agile` resolves (or when it fails) the board renders FALLBACK_CONFIG
 * columns, whose ids are all 0. Tickets carry a real `workflow_state_key` from
 * the task list, so a column can only match them by key. Matching by id — or by
 * the `status` column dropped in migration 0015 — leaves every column empty
 * even though the tickets have already arrived.
 */
import { describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { AgileConfigProvider } from "../../../AgileConfigContext";
import KanbanBoard from "../KanbanBoard";
import { TaskProvider } from "../TaskContext";
import { ToastProvider } from "../../../components/common/Toast";

vi.mock("../../../AuthContext", () => ({
    useAuth: () => ({ isAuthenticated: true, user: { id: 1, tenant_id: 1 } }),
    hasTenantContext: () => true,
}));

// The slow / failed config request must not stop the board from showing tasks.
vi.mock("../../../api/tasks", () => ({
    getAgileConfig: vi.fn().mockRejectedValue(new Error("offline")),
}));

const noop = vi.fn();

function renderBoard(tasks: any[]) {
    return render(
        <ToastProvider>
            <AgileConfigProvider>
                <TaskProvider
                    assignableUsers={[]}
                    orgLabels={[]}
                    availableSprints={[]}
                    availableProjects={[]}
                    currentUser={null}
                    activeTab="sprint"
                    cardDensity="compact"
                >
                    <KanbanBoard
                        tasks={tasks}
                        dragOverCol={null}
                        sprintMode
                        onDragOver={noop}
                        onDragLeave={noop}
                        onDrop={noop}
                        onDragStart={noop}
                        onDragEnd={noop}
                        onOpenDetail={noop}
                        onOpenComments={noop}
                    />
                </TaskProvider>
            </AgileConfigProvider>
        </ToastProvider>,
    );
}

const ticket = (id: number, workflowStateKey: string) => ({
    id,
    title: `Ticket ${id}`,
    workflow_state_key: workflowStateKey,
    story_points: 1,
});

describe("board columns with the fallback Agile config", () => {
    test("every task lands in its column by workflow state key", () => {
        renderBoard([
            ticket(1, "pending"),
            ticket(2, "in_progress"),
            ticket(3, "in_review"),
            ticket(4, "done"),
        ]);

        expect(screen.getByText("Ticket 1")).toBeTruthy();
        expect(screen.getByText("Ticket 2")).toBeTruthy();
        expect(screen.getByText("Ticket 3")).toBeTruthy();
        expect(screen.getByText("Ticket 4")).toBeTruthy();
    });

    test("a task whose state is not in the fallback config is not misfiled", () => {
        renderBoard([ticket(9, "blocked")]);

        expect(screen.queryByText("Ticket 9")).toBeNull();
    });
});

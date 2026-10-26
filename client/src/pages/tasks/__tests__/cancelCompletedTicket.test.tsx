/**
 * Cancelling is for open work.
 *
 * A completed ticket already reached a terminal state, so the detail view must
 * not offer "Cancel ticket" for it — the server refuses the move, and offering
 * a button that always fails is worse than not offering it. An open ticket
 * still shows the action.
 */
import { describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import TaskDetailModal from "../TaskDetailModal";
import { ToastProvider } from "../../../components/common/Toast";

vi.mock("../../../AgileConfigContext", () => ({
    useAgileConfig: () => ({
        workflowStates: [
            { id: 11, key: "pending", name: "New", category: "open" },
            { id: 12, key: "done", name: "Done", category: "done", is_terminal: true },
        ],
        typeById: {},
        unitLabel: "pts",
        features: {},
        initialState: { key: "pending" },
        terminalStates: [{ key: "done" }],
    }),
}));

vi.mock("../TaskContext", () => ({
    useTaskCtx: () => ({
        assignableUsers: [],
        orgLabels: [],
        availableSprints: [],
        availableProjects: [],
        currentUser: { id: 1, role: "employee" },
        activeTab: "backlog",
    }),
}));

vi.mock("../../../CustomFieldsContext", () => ({
    useCustomFields: () => ({ fields: [] }),
}));

vi.mock("../../../api/customFields", () => ({
    getTaskCustomValues: vi.fn().mockResolvedValue({ data: { values: {} } }),
}));

const baseTask = {
    id: 7,
    title: "Refund webhook retries",
    issue_key: "PAY-142",
    priority: "high",
    user_id: 1,
    workflow_state_id: 11,
    workflow_state_key: "pending",
    workflow_state_name: "New",
    workflow_state_category: "open",
    labels: [],
    comments: [],
};

function renderModal(task: Record<string, unknown>) {
    return render(
        <MemoryRouter>
            <ToastProvider>
                <TaskDetailModal
                    detailTask={task}
                    detailComments={[]}
                    detailLoading={false}
                    detailEditing={false}
                    detailTab="comments"
                    setDetailTab={vi.fn()}
                    detailHistory={[]}
                    onClose={vi.fn()}
                    onStartEdit={vi.fn()}
                    onSaveEdit={vi.fn()}
                    onCancelEdit={vi.fn()}
                    onDelete={vi.fn()}
                    onAddComment={vi.fn()}
                    onEditComment={vi.fn()}
                    onDeleteComment={vi.fn()}
                    onSchedule={vi.fn()}
                    onUnschedule={vi.fn()}
                    onStatusChange={vi.fn()}
                />
            </ToastProvider>
        </MemoryRouter>,
    );
}

describe("cancel ticket affordance", () => {
    test("an open ticket offers Cancel ticket", () => {
        renderModal(baseTask);
        expect(screen.queryByText("Cancel ticket")).not.toBeNull();
    });

    test("a completed ticket does not offer Cancel ticket", () => {
        renderModal({
            ...baseTask,
            workflow_state_id: 12,
            workflow_state_key: "done",
            workflow_state_name: "Done",
            workflow_state_category: "done",
            completed_at: "2026-10-20T10:00:00.000Z",
        });
        expect(screen.queryByText("Cancel ticket")).toBeNull();
    });
});

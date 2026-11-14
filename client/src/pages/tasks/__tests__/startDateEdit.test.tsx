/** Cancellation renders the server decision, not completion or actor rules. */
import { describe, expect, test, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import TaskDetailModal from "../TaskDetailModal";
import { ToastProvider } from "../../../components/common/Toast";
import ticket from "../../../../../contracts/fixtures/ticket-with-capabilities.json";

vi.mock("../../../AgileConfigContext", () => ({
    useAgileConfig: () => ({
        workflowStates: [
            { id: 11, key: "pending", name: "New", category: "open" },
            { id: 12, key: "done", name: "Done", category: "done", is_terminal: true },
        ],
        typeById: {},
        workItemTypes: [],
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
    ...ticket,
    id: 7,
    title: "Refund webhook retries",
    ticket_key: "PAY-142",
    priority: "high",
    user_id: 1,
    workflow_state_id: 11,
    workflow_state_key: "pending",
    workflow_state_name: "New",
    workflow_state_category: "open",
    labels: [],
    comments: [],
};

function renderModal(task: Record<string, unknown>, onSaveEdit = vi.fn()) {
    return render(
        <MemoryRouter>
            <ToastProvider>
                <TaskDetailModal
                    detailTask={task}
                    detailComments={[]}
                    detailLoading={false}
                    detailEditing={true}
                    detailTab="comments"
                    setDetailTab={vi.fn()}
                    detailHistory={[]}
                    onClose={vi.fn()}
                    onStartEdit={vi.fn()}
                    onSaveEdit={onSaveEdit}
                    onCancelEdit={vi.fn()}
                    onDelete={vi.fn()}
                    onAddComment={vi.fn()}
                    onEditComment={vi.fn()}
                    onDeleteComment={vi.fn()}
                    onStatusChange={vi.fn()}
                />
            </ToastProvider>
        </MemoryRouter>,
    );
}

test("a sprint member edits Start date under edit capability and the deadline cannot precede it", () => {
    const onSave = vi.fn();
    renderModal({ ...baseTask, sprint_id: 10, start_date: "2026-11-10", planned_date: "2026-01-01", due_date: "2026-11-14",
        capabilities: { ...ticket.capabilities, can: { ...ticket.capabilities.can, schedule: { allowed: false, reason: "IN_SPRINT" } } },
    }, onSave);
    const start = screen.getByLabelText("Start date");
    expect(start).toHaveValue("2026-11-10");
    expect(start).not.toBeDisabled();
    expect(screen.getByLabelText("Due date")).toHaveAttribute("min", "2026-11-10");
    fireEvent.change(start, { target: { value: "2026-11-11" } });
    fireEvent.click(screen.getByRole("button", { name: /Save/ }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ startDate: "2026-11-11", sprintId: 10, dueDate: "2026-11-14" }));
});

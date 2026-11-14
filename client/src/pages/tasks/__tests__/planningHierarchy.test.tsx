import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { expect, test, vi } from "vitest";
import BacklogTab from "../BacklogTab";
import { TaskProvider } from "../TaskContext";
import { ToastProvider } from "../../../components/common/Toast";
import ticket from "../../../../../contracts/fixtures/ticket-with-capabilities.json";

vi.mock("../../../AgileConfigContext", () => ({
    useAgileConfig: () => ({ workflowStates: [], workItemTypes: [], typeById: {}, unitLabel: "pts", features: {} }),
}));

test("backlog nests navigable children without independent selection, ranking or placement controls", () => {
    const child = { ...ticket, id: 8, title: "Nested piece", ticket_key: "PAY-143", is_subtask: true, parent_task_id: 7 };
    const parent = { ...ticket, id: 7, title: "Parent story", ticket_key: "PAY-142", subtasks: [child] };
    const open = vi.fn();
    render(<MemoryRouter><ToastProvider><TaskProvider
        assignableUsers={[]} orgLabels={[]} availableSprints={[]} availableProjects={[]} currentUser={null} activeTab="backlog">
        <BacklogTab {...{
            backlogTasks: [parent], sortedBacklogTasks: [parent], backlogSummary: { total: 1 },
            backlogSort: "rank", backlogLimit: 25, backlogOffset: 0, completedCount: 0, completedTasks: [], canQuickCreate: false,
            onOpenDetail: open, onAddToSprint: vi.fn(),
            selection: { isSelected: () => false, toggle: vi.fn() },
            reorder: { draggingId: null, overId: null },
        } as any} />
    </TaskProvider></ToastProvider></MemoryRouter>);
    const nested = screen.getByRole("list", { name: "Subtasks of Parent story" });
    expect(within(nested).getByText("PAY-143")).toBeTruthy();
    expect(within(nested).queryByRole("checkbox")).toBeNull();
    expect(within(nested).queryByRole("menuitem")).toBeNull();
    expect(screen.getAllByRole("checkbox")).toHaveLength(1);
    fireEvent.click(within(nested).getByRole("button", { name: "Nested piece" }));
    expect(open).toHaveBeenCalledWith(child);
});

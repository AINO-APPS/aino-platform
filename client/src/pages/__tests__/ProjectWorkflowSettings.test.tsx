import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  createProjectWorkflowState,
  getProjectWorkflow,
  updateProjectWorkflowTransitions,
} from "../../api/tasks";
import ProjectWorkflowSettings from "../ProjectWorkflowSettings";

vi.mock("../../api/tasks", () => ({
  createProjectWorkflowState: vi.fn(),
  deleteProjectWorkflowState: vi.fn(),
  getProjectWorkflow: vi.fn(),
  updateProjectWorkflowState: vi.fn(),
  updateProjectWorkflowTransitions: vi.fn(),
}));

const workflow = {
  canEditWorkflow: true,
  workflowStates: [
    { id: 101, key: "pending", name: "New", category: "open", color: "#6b7280", is_initial: true, is_active: true },
    { id: 102, key: "in_progress", name: "In Progress", category: "in_progress", color: "#f59e0b", is_active: true },
    { id: 103, key: "cancelled", name: "Cancelled", category: "done", color: "#6b7280", is_terminal: true, is_active: true },
  ],
  transitions: [{ from_state_id: 101, to_state_id: 102 }],
};

function renderEditor(canEditWorkflow = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ProjectWorkflowSettings
        project={{ id: 7, name: "Checkout", key: "SHOP", capabilities: { canEditWorkflow } }}
        onClose={vi.fn()}
      />
    </QueryClientProvider>,
  );
}

describe("project workflow settings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getProjectWorkflow).mockResolvedValue({ data: workflow } as any);
    vi.mocked(createProjectWorkflowState).mockResolvedValue({ data: {} } as any);
    vi.mocked(updateProjectWorkflowTransitions).mockResolvedValue({ data: {} } as any);
  });

  test("saves project-scoped states and transition edits", async () => {
    renderEditor();
    await screen.findByRole("dialog");

    fireEvent.click(await screen.findByRole("button", { name: /Add State/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "State name" }), { target: { value: "QA" } });
    fireEvent.change(screen.getByRole("combobox", { name: "State category" }), { target: { value: "in_progress" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(createProjectWorkflowState).toHaveBeenCalledWith(7, expect.objectContaining({
      name: "QA", category: "in_progress",
    })));

    fireEvent.click(screen.getByRole("checkbox", { name: "New to In Progress" }));
    fireEvent.click(screen.getByRole("button", { name: /Save transitions/ }));
    await waitFor(() => expect(updateProjectWorkflowTransitions).toHaveBeenCalledWith(7, []));
  });

  test("hides workflow settings when the project capability is absent", () => {
    renderEditor(false);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(getProjectWorkflow).not.toHaveBeenCalled();
  });
});

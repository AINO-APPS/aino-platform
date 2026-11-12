import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import ProjectForm from "../ProjectForm";
import { createProject, updateProject, getProjectTypes } from "../../api/tasks";
vi.mock("../../api/tasks", () => ({ createProject: vi.fn(), updateProject: vi.fn(), getProjectTypes: vi.fn() }));
vi.mock("../../components/common/Toast", () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));
const props = { styles: {}, users: [], teams: [], onClose: vi.fn(), onSaved: vi.fn() };
function form(project: any = null) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><ProjectForm {...props} project={project} /></QueryClientProvider>);
}
beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getProjectTypes).mockResolvedValue({ data: { availableTypes: ["task_list"], defaultType: "task_list" } } as any);
    vi.mocked(createProject).mockResolvedValue({ data: {} } as any);
});
test("create saves the server-offered Task list type", async () => {
    form();
    await screen.findByRole("option", { name: "Task list" });
    await waitFor(() => expect((screen.getByRole("button", { name: "Create" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Helpdesk" } });
    fireEvent.change(screen.getByLabelText(/^Key/), { target: { value: "HELP" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(createProject).toHaveBeenCalledWith(expect.objectContaining({ key: "HELP", type: "task_list" })));
});
test("settings send a changed type and preserve form when server refuses open sprints", async () => {
    vi.mocked(updateProject).mockRejectedValue({ response: { data: { code: "PROJECT_HAS_OPEN_SPRINTS", error: "Complete open sprints before leaving Scrum." } } });
    form({ id: 10, key: "ONE", name: "One", type: "scrum", availableTypes: ["scrum", "kanban", "task_list"], changeableTypes: ["scrum", "kanban", "task_list"], capabilities: { canChangeType: true } });
    fireEvent.change(screen.getByRole("combobox", { name: "Project type" }), { target: { value: "kanban" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(updateProject).toHaveBeenCalledWith(10, expect.objectContaining({ type: "kanban" })));
    expect((await screen.findByRole("alert")).textContent).toBe("Complete open sprints before leaving Scrum.");
    expect(props.onSaved).not.toHaveBeenCalled();
});

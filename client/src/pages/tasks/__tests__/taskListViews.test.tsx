import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, test, vi } from "vitest";
import API from "../../../api/client";
import TaskListView from "../TaskListView";

vi.mock("../../../api/client", () => ({ default: { get: vi.fn(), put: vi.fn() } }));
vi.mock("../../../AgileConfigContext", () => ({
    useAgileConfig: () => ({ workItemTypes: [{ id: 1, name: "Task" }], workflowStates: [{ id: 10, key: "pending", name: "New" }] }),
}));

const ticket = { id: 1, ticket_key: "OPS-1", title: "Plan the launch", work_item_type_id: 1,
    workflow_state_name: "New", priority: "high", assignee: { full_name: "Alice" }, assigned_to: 2,
    start_date: "2026-11-09", due_date: "2026-11-12", capabilities: { can: { edit: { allowed: true } } } };

beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(API.get).mockImplementation(async (url: string) => ({
        data: url === "/tasks/assignable-users" ? [{ id: 2, full_name: "Alice" }] : { tasks: [ticket] },
    }) as any);
});

function show() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const onOpenDetail = vi.fn();
    render(<QueryClientProvider client={client}><TaskListView project={{ id: 10 }} onOpenDetail={onOpenDetail} /></QueryClientProvider>);
    return onOpenDetail;
}

test("List shows all eight fields, opens a ticket and filters/sorts in the selected project", async () => {
    const open = show();
    fireEvent.click(await screen.findByRole("button", { name: "Plan the launch" }, { timeout: 10_000 }));
    expect(open).toHaveBeenCalledWith(ticket);
    for (const name of ["Key", "Title", "Type", "Status", "Assignee", "Priority", "Start date", "Due date"]) {
        expect(screen.getByRole("columnheader", { name })).toBeInTheDocument();
        expect(screen.getByLabelText(`Filter ${name.toLowerCase()}`)).toBeInTheDocument();
    }
    expect(within(screen.getAllByRole("row")[2]).getByText("Task")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Filter title"), { target: { value: "launch" } });
    fireEvent.click(screen.getByRole("button", { name: "Due date" }));
    await waitFor(() => expect(API.get).toHaveBeenLastCalledWith("/tasks", expect.objectContaining({
        params: expect.objectContaining({ scope: "list", project_id: 10, title: "launch", sort: "due_date", direction: "asc" }),
    })));
}, 20_000);

test("every list field forwards its filter and sort, and a second sort reverses direction", async () => {
    show();
    await screen.findByText("Plan the launch", {}, { timeout: 10_000 });
    for (const [label, field, value, sort] of [
        ["key", "key", "OPS", "key"], ["title", "title", "launch", "title"],
        ["type", "work_item_type_id", "1", "type"], ["status", "status", "pending", "status"],
        ["assignee", "assignee", "2", "assignee"], ["priority", "priority", "high", "priority"],
        ["start date", "start_on", "2026-11-09", "start_date"], ["due date", "due_on", "2026-11-12", "due_date"],
    ]) {
        fireEvent.change(screen.getByLabelText(`Filter ${label}`), { target: { value } });
        const header = screen.getByRole("columnheader", { name: new RegExp(label, "i") });
        fireEvent.click(within(header).getByRole("button"));
        await waitFor(() => expect(API.get).toHaveBeenLastCalledWith("/tasks", expect.objectContaining({
            params: expect.objectContaining({ [field]: value, sort, project_id: 10 }),
        })));
    }
    fireEvent.click(screen.getByRole("button", { name: "Due date" }));
    await waitFor(() => expect(API.get).toHaveBeenLastCalledWith("/tasks", expect.objectContaining({
        params: expect.objectContaining({ sort: "due_date", direction: "desc" }),
    })));
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    await waitFor(() => expect(API.get).toHaveBeenLastCalledWith("/tasks", expect.objectContaining({
        params: { scope: "list", project_id: 10, sort: "due_date", direction: "desc", offset: 0 },
    })));
}, 20_000);

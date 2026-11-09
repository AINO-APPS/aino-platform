import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, test, vi } from "vitest";
import ProjectBoard from "../ProjectBoard";
import { addTask, getProjectBoard, getProjectBacklog, updateProjectBoardSettings, updateTaskStatus } from "../../../api/tasks";

vi.mock("../../../api/tasks", () => ({
    getProjectBoard: vi.fn(), getProjectBacklog: vi.fn(), updateProjectBoardSettings: vi.fn(),
    updateTaskStatus: vi.fn(), addTask: vi.fn(),
}));
vi.mock("../TaskCard", () => ({
    default: ({ task, onOpenDetail }: any) => <button onClick={() => onOpenDetail(task)}>{task.title}</button>,
}));
vi.mock("../../../hooks/useViewportWidth", () => ({ useIsPhone: () => false }));

const project = { id: 10, key: "FLOW", name: "Flow", type: "kanban", hasSprints: false,
    kanban_backlog_enabled: false, enable_wip_limits: true, capabilities: { canEditWorkflow: true, canCreateTickets: true } };
const state = { id: 102, key: "in_progress", name: "Doing", category: "in_progress", color: "#b7791f" };
const board = { project, sprint: null, tickets: [{ id: 201, title: "Ship the continuous board", workflow_state_id: 102,
    capabilities: { can: { edit: { allowed: true } }, transitions: [] } }],
    columns: [{ stateId: 102, state, count: 1, limit: 1, accepting: false }] };

beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getProjectBoard).mockResolvedValue({ data: board } as any);
    vi.mocked(getProjectBacklog).mockResolvedValue({ data: { ...board, tickets: [{ ...board.tickets[0], title: "Plan the next change" }] } } as any);
    vi.mocked(updateProjectBoardSettings).mockResolvedValue({ data: { ...project, kanban_backlog_enabled: true } } as any);
});

function show(props = {}) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const onOpenDetail = vi.fn();
    render(<QueryClientProvider client={client}>
        <ProjectBoard project={project} onOpenDetail={onOpenDetail} onOpenComments={vi.fn()}
            showConfirm={vi.fn()} closeConfirm={vi.fn()} {...props} />
    </QueryClientProvider>);
    return { onOpenDetail };
}

test("renders a continuous board with server occupancy and no sprint actions", async () => {
    const { onOpenDetail } = show();
    fireEvent.click(await screen.findByText("Ship the continuous board"));
    expect(onOpenDetail).toHaveBeenCalledWith(board.tickets[0]);
    expect(screen.getByText("1 / 1")).toBeInTheDocument();
    expect(screen.getByText(/Done.*14 days/i)).toBeInTheDocument();
    expect(screen.queryByText(/Plan sprint|Start sprint|Import from Backlog/i)).not.toBeInTheDocument();
});

test("admin backlog setting is persisted and viewers never see settings", async () => {
    show();
    fireEvent.click(await screen.findByLabelText("Kanban backlog"));
    await waitFor(() => expect(updateProjectBoardSettings).toHaveBeenCalledWith(10, { kanban_backlog_enabled: true }));
});

test("optional backlog uses the project backlog read and opens tickets", async () => {
    show({ backlog: true });
    expect(await screen.findByText("Plan the next change")).toBeInTheDocument();
    expect(getProjectBacklog).toHaveBeenCalled();
    expect(getProjectBoard).not.toHaveBeenCalled();
    expect(screen.queryByText("1 / 1")).not.toBeInTheDocument();
});

test("viewers get a read-only board without creation or settings", async () => {
    vi.mocked(getProjectBoard).mockResolvedValue({ data: { ...board, project: { ...project, capabilities: { canEditWorkflow: false, canCreateTickets: false } } } } as any);
    show();
    await screen.findByText("Ship the continuous board");
    expect(screen.queryByLabelText("Kanban backlog")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New ticket" })).not.toBeInTheDocument();
});

test("a stale capacity refusal preserves the ticket and explains the count and limit", async () => {
    vi.mocked(getProjectBacklog).mockResolvedValue({ data: {
        ...board, columns: [{ ...board.columns[0], accepting: true, count: 0 }],
        tickets: [{ ...board.tickets[0], workflow_state_id: 101, capabilities: {
            can: { edit: { allowed: true } }, transitions: [{ to: 102, allowed: true }],
        } }],
    } } as any);
    vi.mocked(updateTaskStatus).mockRejectedValue({ response: { data: {
        code: "WIP_EXCEEDED", error: 'WIP limit reached for "Doing" (1/1). Move a ticket out of this column first.',
    } } });
    show({ backlog: true, showConfirm: (_title: string, _message: string, confirm: () => void) => confirm() });
    const select = await screen.findByLabelText("Move 201 to board");
    fireEvent.change(select, { target: { value: "102" } });
    expect(await screen.findByRole("alert")).toHaveTextContent("(1/1)");
    expect(screen.getByText("Ship the continuous board")).toBeInTheDocument();
});

test("new tickets use the selected project and refresh the continuous board", async () => {
    vi.mocked(addTask).mockResolvedValue({ data: { id: 202 } } as any);
    show();
    fireEvent.click(await screen.findByRole("button", { name: "New ticket" }));
    fireEvent.change(screen.getByLabelText("Ticket title"), { target: { value: "A new flow ticket" } });
    fireEvent.click(screen.getByRole("button", { name: "Create ticket" }));
    await waitFor(() => expect(addTask).toHaveBeenCalledWith({ title: "A new flow ticket", project_id: 10 }));
});

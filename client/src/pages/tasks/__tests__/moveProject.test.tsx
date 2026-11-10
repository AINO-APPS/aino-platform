import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import TicketDetailActions from "../TicketDetailActions";
import { getProjects, moveTaskProject, previewTaskProjectMove } from "../../../api/tasks";

vi.mock("../../../api/tasks", () => ({
    getProjects: vi.fn(),
    previewTaskProjectMove: vi.fn(),
    moveTaskProject: vi.fn(),
    transferTask: vi.fn(),
}));

const props = { onEdit: vi.fn(), onCancel: vi.fn(), onReplaced: vi.fn(), onError: vi.fn() };
const task = { id: 42, project_id: 1, ticket_key: "SRC-7", capabilities: { can: { edit: { allowed: true }, canMoveProject: { allowed: true } } } };

beforeEach(() => vi.resetAllMocks());

test("the project move action is hidden without the server capability", () => {
    const { rerender } = render(<TicketDetailActions task={task} {...props} />);
    expect(screen.getByRole("button", { name: "Move to project" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Transfer to team" })).toBeNull();
    rerender(<TicketDetailActions task={{ ...task, capabilities: undefined }} {...props} />);
    expect(screen.queryByRole("button", { name: "Move to project" })).toBeNull();
    rerender(<TicketDetailActions task={{ ...task, capabilities: { can: { canMoveProject: { allowed: false } } } }} {...props} />);
    expect(screen.queryByRole("button", { name: "Move to project" })).toBeNull();
});

test("the dialog loads creatable projects, previews consequences and confirms the move", async () => {
    vi.mocked(getProjects).mockResolvedValue({ data: { projects: [
        { id: 1, name: "Source", capabilities: { canCreateTickets: true } },
        { id: 2, name: "Destination", capabilities: { canCreateTickets: true } },
        { id: 3, name: "Read only", capabilities: { canCreateTickets: false } },
        { id: 4, name: "Archived", is_archived: true, capabilities: { canCreateTickets: true } },
    ] } } as any);
    vi.mocked(previewTaskProjectMove).mockResolvedValue({ data: {
        target_project_id: 2, key_format: "DEST-<number>", workflow_state: { id: 20, key: "ready", name: "Ready", category: "open" }, leaves_sprint: true,
    } } as any);
    vi.mocked(moveTaskProject).mockResolvedValue({ data: { task: { id: 42, ticket_key: "DEST-1" } } } as any);
    render(<TicketDetailActions task={task} {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Move to project" }));
    const picker = await screen.findByRole("combobox", { name: "Destination project" });
    expect(screen.queryByRole("option", { name: "Read only" })).toBeNull();
    expect(screen.queryByRole("option", { name: "Archived" })).toBeNull();
    fireEvent.change(picker, { target: { value: "2" } });
    expect(await screen.findByText("DEST-<number>")).toBeVisible();
    expect(screen.getByText("Ready")).toBeVisible();
    expect(screen.getByText("Leaves its current sprint")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Confirm move" }));
    await waitFor(() => expect(moveTaskProject).toHaveBeenCalledWith(42, 2));
    expect(previewTaskProjectMove).toHaveBeenCalledWith(42, 2);
    await waitFor(() => expect(props.onReplaced).toHaveBeenCalledWith({ id: 42, ticket_key: "DEST-1" }));
    expect(screen.queryByRole("dialog")).toBeNull();
});

test("a rejected preview cannot be confirmed and reports the server reason", async () => {
    vi.mocked(getProjects).mockResolvedValue({ data: [{ id: 2, name: "Destination", capabilities: { canCreateTickets: true } }] } as any);
    vi.mocked(previewTaskProjectMove).mockRejectedValue({ response: { data: { code: "PROJECT_ARCHIVED" } } });
    render(<TicketDetailActions task={task} {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Move to project" }));
    fireEvent.change(await screen.findByRole("combobox", { name: "Destination project" }), { target: { value: "2" } });
    expect(await screen.findByRole("alert")).toHaveTextContent("This project is archived.");
    expect(screen.getByRole("button", { name: "Confirm move" })).toBeDisabled();
    expect(moveTaskProject).not.toHaveBeenCalled();
});

test("a slow preview for a previous selection cannot replace the current destination", async () => {
    vi.mocked(getProjects).mockResolvedValue({ data: [
        { id: 2, name: "Destination", capabilities: { canCreateTickets: true } },
        { id: 3, name: "Other", capabilities: { canCreateTickets: true } },
    ] } as any);
    let finishFirst!: (result: any) => void;
    vi.mocked(previewTaskProjectMove).mockImplementationOnce(() => new Promise((resolve) => { finishFirst = resolve; }));
    vi.mocked(previewTaskProjectMove).mockResolvedValueOnce({ data: {
        target_project_id: 3, key_format: "OTHER-<number>", workflow_state: { id: 30, key: "ready", name: "Ready", category: "open" }, leaves_sprint: false,
    } } as any);
    render(<TicketDetailActions task={task} {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Move to project" }));
    const picker = await screen.findByRole("combobox", { name: "Destination project" });
    fireEvent.change(picker, { target: { value: "2" } });
    fireEvent.change(picker, { target: { value: "3" } });
    expect(await screen.findByText("OTHER-<number>")).toBeVisible();
    await act(async () => finishFirst({ data: { target_project_id: 2, key_format: "STALE-<number>", workflow_state: { id: 20, name: "Stale" } } }));
    expect(screen.queryByText("STALE-<number>")).toBeNull();
    expect(screen.getByText("OTHER-<number>")).toBeVisible();
});

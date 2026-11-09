import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SubtasksPanel from "../SubtasksPanel";

const createSubtask = vi.hoisted(() => vi.fn());
vi.mock("../../../api/tasks", () => ({ createTaskSubtask: createSubtask }));

describe("ticket detail subtasks", () => {
    beforeEach(() => vi.clearAllMocks());
    it("adds a titled subtask through the parent endpoint, then opens the returned ticket", async () => {
        createSubtask.mockResolvedValue({ data: { id: 8, title: "Handle retries", ticket_key: "ONE-8" } });
        const open = vi.fn();
        render(<SubtasksPanel task={{ id: 4, subtasks: [], capabilities: { can: { canAddSubtask: { allowed: true } } } }} onOpenTask={open} />);
        fireEvent.click(screen.getByRole("button", { name: "Add subtask" }));
        fireEvent.change(screen.getByLabelText("Subtask title"), { target: { value: "Handle retries" } });
        fireEvent.click(screen.getByRole("button", { name: "Create subtask" }));
        await waitFor(() => expect(createSubtask).toHaveBeenCalledWith(4, { title: "Handle retries" }));
        fireEvent.click(await screen.findByRole("link", { name: "ONE-8 Handle retries" }));
        expect(open).toHaveBeenCalledWith(8);
    });
    it("shows links but no add action for a server-denied viewer", () => {
        render(<SubtasksPanel task={{ id: 4, subtasks: [{ id: 8, title: "Retry", ticket_key: "ONE-8" }],
            capabilities: { can: { canAddSubtask: { allowed: false, reason: "READ_ONLY_ROLE" } } } }} />);
        expect(screen.getByRole("link", { name: "ONE-8 Retry" })).toBeTruthy();
        expect(screen.queryByRole("button", { name: "Add subtask" })).toBeNull();
    });
    it("keeps the form open with the server refusal and does not add a phantom ticket", async () => {
        createSubtask.mockRejectedValue({ response: { data: { error: "This sprint is completed." } } });
        render(<SubtasksPanel task={{ id: 4, subtasks: [], capabilities: { can: { canAddSubtask: { allowed: true } } } }} />);
        fireEvent.click(screen.getByRole("button", { name: "Add subtask" }));
        fireEvent.change(screen.getByLabelText("Subtask title"), { target: { value: "Retry" } });
        fireEvent.click(screen.getByRole("button", { name: "Create subtask" }));
        expect(await screen.findByRole("alert")).toHaveTextContent("This sprint is completed.");
        expect(screen.getByLabelText("Subtask title")).toHaveValue("Retry");
        expect(screen.queryByRole("link")).toBeNull();
    });
});

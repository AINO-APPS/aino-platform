import { describe, expect, test, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import SprintCompletionDialog from "../SprintCompletionDialog";

const getSprintCompletionPreview = vi.fn();

vi.mock("../../../api/tasks", () => ({
    getSprintCompletionPreview: (...args: unknown[]) => getSprintCompletionPreview(...args),
}));

const preview = {
    sprint: { id: 9, name: "Sprint 24", status: "active" },
    defaultTarget: 12,
    moving: [
        { id: 1, title: "Refund webhook", story_points: 5 },
        { id: 2, title: "Ledger fix", story_points: 3 },
    ],
    staying: [{ id: 3, title: "Retry backoff", story_points: 8 }],
    movingPoints: 8,
};

describe("SprintCompletionDialog", () => {
    beforeEach(() => {
        getSprintCompletionPreview.mockReset();
        getSprintCompletionPreview.mockResolvedValue({ data: preview });
    });

    test("shows what moves and what stays before committing", async () => {
        render(
            <SprintCompletionDialog
                sprintId={9}
                sprintName="Sprint 24"
                onCancel={vi.fn()}
                onConfirm={vi.fn()}
            />,
        );

        await waitFor(() => expect(screen.getByText("Refund webhook")).toBeTruthy());
        expect(screen.getByText("Retry backoff")).toBeTruthy();
        expect(screen.getByText(/Moves \(2 · 8 pts\)/)).toBeTruthy();
    });

    test("defaults to the next planned sprint", async () => {
        const onConfirm = vi.fn();
        render(
            <SprintCompletionDialog
                sprintId={9}
                sprintName="Sprint 24"
                onCancel={vi.fn()}
                onConfirm={onConfirm}
            />,
        );

        await waitFor(() => expect(screen.getByText("Refund webhook")).toBeTruthy());
        fireEvent.click(screen.getByRole("button", { name: "Complete sprint" }));
        expect(onConfirm).toHaveBeenCalledWith(12);
    });

    test("the target can be overridden to the backlog", async () => {
        const onConfirm = vi.fn();
        render(
            <SprintCompletionDialog
                sprintId={9}
                sprintName="Sprint 24"
                onCancel={vi.fn()}
                onConfirm={onConfirm}
            />,
        );

        await waitFor(() => expect(screen.getByText("Refund webhook")).toBeTruthy());
        fireEvent.change(screen.getByRole("combobox"), { target: { value: "backlog" } });
        fireEvent.click(screen.getByRole("button", { name: "Complete sprint" }));
        expect(onConfirm).toHaveBeenCalledWith("backlog");
    });

    test("cancelling commits nothing", async () => {
        const onConfirm = vi.fn();
        const onCancel = vi.fn();
        render(
            <SprintCompletionDialog
                sprintId={9}
                sprintName="Sprint 24"
                onCancel={onCancel}
                onConfirm={onConfirm}
            />,
        );

        await waitFor(() => expect(screen.getByText("Refund webhook")).toBeTruthy());
        fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
        expect(onCancel).toHaveBeenCalled();
        expect(onConfirm).not.toHaveBeenCalled();
    });

    test("finished work is listed as staying, never as moving", async () => {
        render(
            <SprintCompletionDialog
                sprintId={9}
                sprintName="Sprint 24"
                onCancel={vi.fn()}
                onConfirm={vi.fn()}
            />,
        );

        await waitFor(() => expect(screen.getByText("Retry backoff")).toBeTruthy());
        const stayingSection = screen.getByText(/Stays with this sprint/).closest("section")!;
        expect(stayingSection.textContent).toContain("Retry backoff");
    });
});

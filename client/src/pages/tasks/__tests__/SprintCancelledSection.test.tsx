import { describe, expect, test, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

const getTasks = vi.fn();
vi.mock("../../../api/tasks", () => ({ getTasks: (...a: unknown[]) => getTasks(...a) }));
const realtime = vi.hoisted(() => ({ current: () => {} }));
vi.mock("../../../hooks/useRealtimeEvent", () => ({
    default: (_events: string[], callback: () => void) => { realtime.current = callback; },
}));

import SprintCancelledSection from "../SprintCancelledSection";

beforeEach(() => {
    vi.clearAllMocks();
});

describe("SprintCancelledSection", () => {
    test("asks for the sprint's cancelled tickets in scope and opens one from the collapsed list", async () => {
        getTasks.mockResolvedValue({
            data: { tasks: [{ id: 13, issue_key: "DEV-13", title: "Dropped idea", workflow_state_key: "cancelled" }] },
        });
        const onOpenDetail = vi.fn();

        render(<SprintCancelledSection sprintId={4} scopeParams={{ team_id: 2 }} onOpenDetail={onOpenDetail} />);

        const toggle = await screen.findByRole("button", { name: /Cancelled/ });
        expect(getTasks).toHaveBeenCalledWith(undefined, { team_id: 2, sprint_id: 4, status: "cancelled" });
        expect(toggle).toHaveAttribute("aria-expanded", "false");
        expect(screen.queryByText("Dropped idea")).toBeNull();

        fireEvent.click(toggle);
        fireEvent.click(screen.getByText("Dropped idea"));

        expect(onOpenDetail).toHaveBeenCalledWith(expect.objectContaining({ id: 13 }));
    });

    test("renders nothing when the sprint has no cancelled tickets", async () => {
        getTasks.mockResolvedValue({ data: { tasks: [] } });

        const { container } = render(<SprintCancelledSection sprintId={4} onOpenDetail={vi.fn()} />);

        await waitFor(() => expect(getTasks).toHaveBeenCalled());
        expect(container).toBeEmptyDOMElement();
    });

    test("hides the previous team's history immediately and reports a failed new scope", async () => {
        getTasks.mockResolvedValueOnce({
            data: { tasks: [{ id: 13, title: "Previous team", workflow_state_key: "cancelled" }] },
        });
        const { rerender } = render(<SprintCancelledSection sprintId={4} scopeParams={{ team_id: 2 }} onOpenDetail={vi.fn()} />);
        fireEvent.click(await screen.findByRole("button", { name: /Cancelled/ }));
        expect(screen.getByText("Previous team")).toBeInTheDocument();

        let reject: (error: Error) => void = () => {};
        getTasks.mockImplementationOnce(() => new Promise((_resolve, rejectPromise) => { reject = rejectPromise; }));
        rerender(<SprintCancelledSection sprintId={4} scopeParams={{ team_id: 3 }} onOpenDetail={vi.fn()} />);
        expect(screen.queryByText("Previous team")).toBeNull();
        await act(async () => { reject(new Error("offline")); });
        expect(await screen.findByRole("alert")).toHaveTextContent("Could not load cancelled tickets");
        expect(screen.queryByText("Previous team")).toBeNull();
        expect(getTasks).toHaveBeenLastCalledWith(undefined, { sprint_id: 4, team_id: 3, status: "cancelled" });
    });

    test("ignores an old sprint response after the selected sprint changes", async () => {
        let resolveOld: (value: unknown) => void = () => {};
        getTasks.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }));
        const { rerender } = render(<SprintCancelledSection sprintId={4} onOpenDetail={vi.fn()} />);
        getTasks.mockResolvedValueOnce({
            data: { tasks: [{ id: 14, title: "Current sprint", workflow_state_key: "cancelled" }] },
        });
        rerender(<SprintCancelledSection sprintId={5} onOpenDetail={vi.fn()} />);
        fireEvent.click(await screen.findByRole("button", { name: /Cancelled/ }));
        await act(async () => {
            resolveOld({ data: { tasks: [{ id: 13, title: "Old sprint", workflow_state_key: "cancelled" }] } });
        });
        expect(screen.getByText("Current sprint")).toBeInTheDocument();
        expect(screen.queryByText("Old sprint")).toBeNull();
    });

    test("keeps same-scope history on refresh failure and allows retry", async () => {
        getTasks.mockResolvedValueOnce({
            data: { tasks: [{ id: 13, title: "Kept history", workflow_state_key: "cancelled" }] },
        });
        render(<SprintCancelledSection sprintId={4} onOpenDetail={vi.fn()} />);
        fireEvent.click(await screen.findByRole("button", { name: /Cancelled/ }));
        getTasks.mockRejectedValueOnce(new Error("offline"));
        act(() => { realtime.current(); });
        expect(await screen.findByRole("alert")).toHaveTextContent("Could not load cancelled tickets");
        expect(screen.getByText("Kept history")).toBeInTheDocument();
        getTasks.mockResolvedValueOnce({ data: { tasks: [] } });
        fireEvent.click(screen.getByRole("button", { name: "Retry" }));
        await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
        expect(screen.queryByText("Kept history")).toBeNull();
    });
});

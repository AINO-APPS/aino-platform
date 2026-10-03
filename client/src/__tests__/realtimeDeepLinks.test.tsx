import { act, render, renderHook, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, test, vi } from "vitest";
import { REALTIME_EVENT } from "../hooks/useWebSocket";
import useRealtimeEvent from "../hooks/useRealtimeEvent";

const getApprovals = vi.fn();
vi.mock("../api/organization", () => ({
    getApprovals: (...args: any[]) => getApprovals(...args),
    approveRequest: vi.fn(),
    rejectRequest: vi.fn(),
    bulkApproval: vi.fn(),
    getTeamAttendance: vi.fn().mockResolvedValue({ data: [] }),
}));

import ManagerDashboard from "../pages/manager";

function emit(type: string, data: unknown = {}) {
    act(() => {
        window.dispatchEvent(new CustomEvent(REALTIME_EVENT, { detail: { type, data } }));
    });
}

describe("useRealtimeEvent", () => {
    test("invokes the handler only for subscribed event types", () => {
        const handler = vi.fn();
        const { unmount } = renderHook(() => useRealtimeEvent(["leave_update"], handler));
        emit("task_updated");
        emit("leave_update", { id: 3, status: "pending" });
        expect(handler).toHaveBeenCalledTimes(1);
        expect(handler.mock.calls[0][0]).toEqual({ type: "leave_update", data: { id: 3, status: "pending" } });
        unmount();
        emit("leave_update");
        expect(handler).toHaveBeenCalledTimes(1);
    });

    test("does not subscribe when disabled", () => {
        const handler = vi.fn();
        renderHook(() => useRealtimeEvent(["leave_update"], handler, false));
        emit("leave_update");
        expect(handler).not.toHaveBeenCalled();
    });
});

describe("Manager dashboard approvals deep link", () => {
    function renderAt(url: string) {
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        return render(
            <QueryClientProvider client={client}>
                <MemoryRouter initialEntries={[url]}>
                    <ManagerDashboard />
                </MemoryRouter>
            </QueryClientProvider>,
        );
    }

    test("opens the approvals tab and highlights the requested approval", async () => {
        getApprovals.mockResolvedValue({
            data: [
                { id: 4, type: "leave", status: "pending", created_at: "2026-10-01", requester_name: "Ann" },
                { id: 5, type: "manual_entry", status: "pending", created_at: "2026-10-01", requester_name: "Ben" },
            ],
        });
        const { container } = renderAt("/manager?tab=approvals&request=5");
        expect(await screen.findByText("Ben")).toBeInTheDocument();
        const highlighted = container.querySelectorAll("tr[data-highlighted]");
        expect(highlighted).toHaveLength(1);
        expect(highlighted[0]).toHaveTextContent("Ben");
    });

    test("refetches approvals on approval_update", async () => {
        getApprovals.mockReset().mockResolvedValue({ data: [] });
        renderAt("/manager?tab=approvals");
        await waitFor(() => expect(getApprovals).toHaveBeenCalledTimes(1));
        emit("approval_update", { id: 9, type: "leave", status: "approved" });
        await waitFor(() => expect(getApprovals).toHaveBeenCalledTimes(2));
    });

    test("widens to status=all when the linked request was already decided", async () => {
        getApprovals.mockReset().mockImplementation(async ({ status }: { status?: string }) => ({
            data: status === "all"
                ? [{ id: 7, type: "leave", status: "approved", created_at: "2026-10-01", requester_name: "Cara" }]
                : [],
        }));
        const { container } = renderAt("/manager?tab=approvals&request=7");
        expect(await screen.findByText("Cara")).toBeInTheDocument();
        expect(getApprovals).toHaveBeenCalledWith({ status: "all" });
        expect(container.querySelectorAll("tr[data-highlighted]")).toHaveLength(1);
    });
});

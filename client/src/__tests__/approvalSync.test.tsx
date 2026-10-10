import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, test, vi } from "vitest";
import PendingApprovalsCard from "../components/dashboard/PendingApprovalsCard";
import AdminHome from "../pages/admin/AdminHome";
import { ToastProvider } from "../components/common/Toast";
import useApprovalSync from "../hooks/useApprovalSync";
import { REALTIME_EVENT, REALTIME_CONNECTED_EVENT } from "../hooks/useWebSocket";

const { getApprovals, approveRequest, rejectRequest, getAdminStats } = vi.hoisted(() => ({
    getApprovals: vi.fn(), approveRequest: vi.fn(), rejectRequest: vi.fn(), getAdminStats: vi.fn(),
}));
vi.mock("../api/organization", () => ({
    getApprovals, approveRequest, rejectRequest, getAdminStats,
    getRoleChangeRequests: vi.fn().mockResolvedValue({ data: [] }),
    getCurrentOrg: vi.fn(), getOrgDepartments: vi.fn(), getOrgTeams: vi.fn(), getLeavePolicies: vi.fn(),
}));

function Sync({ sessionKey = "1:1" }: { sessionKey?: string | null }) {
    useApprovalSync(sessionKey);
    return null;
}

function harness(client: QueryClient) {
    return function Wrapper({ children }: { children: React.ReactNode }) {
        return <QueryClientProvider client={client}><ToastProvider><MemoryRouter>{children}</MemoryRouter></ToastProvider></QueryClientProvider>;
    };
}
function client() {
    return new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 60_000 } } });
}
function emit(type: string, data: unknown = {}) {
    act(() => window.dispatchEvent(new CustomEvent(REALTIME_EVENT, { detail: { type, data } })));
}

beforeEach(() => vi.clearAllMocks());

describe("approval synchronization", () => {
    test.each(["leave", "leave_withdraw", "manual_entry", "overtime", "work_mode_change"])(
        "removes remotely approved %s from a fresh dashboard cache", async (type) => {
            const cache = client();
            getApprovals.mockResolvedValue({ data: [{ id: 7, type, requester_name: "Ann" }] });
            render(<><Sync /><PendingApprovalsCard /></>, { wrapper: harness(cache) });
            expect(await screen.findByText("Ann")).toBeInTheDocument();
            getApprovals.mockResolvedValue({ data: [] });
            emit("approval_update", { id: 7, type, status: "approved" });
            await waitFor(() => expect(screen.queryByText("Ann")).not.toBeInTheDocument());
            expect(cache.getQueryData(["manager", "approvals", "pending"])).toEqual([]);
        },
    );

    test.each(["rejected", "pending", "bulk"])("reconciles %s events and all dependent counts", async (status) => {
        const cache = client();
        const fetch = vi.fn().mockResolvedValue(0);
        const keys = [["manager", "approvals", "pending"], ["admin", "home", "stats"], ["manager", "teamAnalytics", "7"]];
        for (const queryKey of keys) await cache.fetchQuery({ queryKey, queryFn: fetch });
        render(<Sync />, { wrapper: harness(cache) });
        emit("approval_update", { status });
        await waitFor(() => expect(keys.every((key) => cache.getQueryState(key)?.isInvalidated)).toBe(true));
        expect(fetch).toHaveBeenCalledTimes(3);
    });

    test.each(["focus", "online", REALTIME_CONNECTED_EVENT, "visibilitychange"])(
        "%s reconciles the visible list even with a fresh cache", async (eventName) => {
            const cache = client();
            getApprovals.mockResolvedValue({ data: [{ id: 7, type: "leave", requester_name: "Ann" }] });
            render(<><Sync /><PendingApprovalsCard /></>, { wrapper: harness(cache) });
            expect(await screen.findByText("Ann")).toBeInTheDocument();
            getApprovals.mockResolvedValue({ data: [] });
            act(() => (eventName === "visibilitychange" ? document : window).dispatchEvent(new Event(eventName)));
            await waitFor(() => expect(screen.queryByText("Ann")).not.toBeInTheDocument());
            expect(getApprovals).toHaveBeenCalledTimes(2);
        },
    );

    test("updates admin pending counts after a remote decision", async () => {
        const cache = client();
        getApprovals.mockResolvedValue({ data: [{ id: 7, type: "leave", requester_name: "Ann" }] });
        getAdminStats.mockResolvedValue({ data: { pendingApprovals: 1 } });
        render(<><Sync /><AdminHome /></>, { wrapper: harness(cache) });
        expect(await screen.findByText("leave / overtime approval pending")).toBeInTheDocument();
        getApprovals.mockResolvedValue({ data: [] });
        getAdminStats.mockResolvedValue({ data: { pendingApprovals: 0 } });
        emit("approval_update", { id: 7, status: "approved" });
        await waitFor(() => expect(screen.queryByText("leave / overtime approval pending")).not.toBeInTheDocument());
        expect(screen.queryByText("pending approvals across the organization")).not.toBeInTheDocument();
        expect(cache.getQueryData(["admin", "home", "stats"])).toMatchObject({ pendingApprovals: 0 });
    });

    test("failed realtime refresh is visible instead of showing stale approvals as current", async () => {
        const cache = client();
        getApprovals.mockResolvedValue({ data: [{ id: 7, type: "leave", requester_name: "Ann" }] });
        render(<><Sync /><PendingApprovalsCard /></>, { wrapper: harness(cache) });
        expect(await screen.findByText("Ann")).toBeInTheDocument();
        const log = vi.spyOn(console, "error").mockImplementation(() => {});
        getApprovals.mockRejectedValue(new Error("Offline"));
        emit("approval_update");
        expect(await screen.findByText("Could not refresh pending approvals.")).toBeInTheDocument();
        expect(await screen.findByText("Could not refresh approvals. Please try again.")).toBeInTheDocument();
        expect(screen.queryByText("Ann")).not.toBeInTheDocument();
        log.mockRestore();
    });
    test.each(["focus", REALTIME_CONNECTED_EVENT])("a failed background %s reconcile does not toast", async (eventName) => {
        const cache = client();
        getApprovals.mockResolvedValue({ data: [{ id: 7, type: "leave", requester_name: "Ann" }] });
        render(<><Sync /><PendingApprovalsCard /></>, { wrapper: harness(cache) });
        expect(await screen.findByText("Ann")).toBeInTheDocument();
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        getApprovals.mockRejectedValue(new Error("Offline"));
        act(() => window.dispatchEvent(new Event(eventName)));
        expect(await screen.findByText("Could not refresh pending approvals.")).toBeInTheDocument();
        await waitFor(() => expect(warn).toHaveBeenCalledWith("Background approval refresh failed:", expect.any(Error)));
        expect(screen.queryByText("Could not refresh approvals. Please try again.")).not.toBeInTheDocument();
        warn.mockRestore();
    });
    test("a coalesced batch containing an approval update still toasts on failure", async () => {
        const cache = client();
        getApprovals.mockResolvedValue({ data: [{ id: 7, type: "leave", requester_name: "Ann" }] });
        render(<><Sync /><PendingApprovalsCard /></>, { wrapper: harness(cache) });
        expect(await screen.findByText("Ann")).toBeInTheDocument();
        const log = vi.spyOn(console, "error").mockImplementation(() => {});
        getApprovals.mockRejectedValue(new Error("Offline"));
        act(() => window.dispatchEvent(new Event("focus")));
        emit("approval_update");
        expect(await screen.findByText("Could not refresh approvals. Please try again.")).toBeInTheDocument();
        log.mockRestore();
    });
    test("coalesces desktop restore/socket events and unsubscribes on logout", async () => {
        const cache = client();
        let shown: (() => void) | undefined;
        const unsubscribe = vi.fn();
        const onWindowShown = vi.fn((handler: () => void) => { shown = handler; return unsubscribe; });
        const previous = window.electronAPI;
        Object.defineProperty(window, "electronAPI", { value: { onWindowShown }, configurable: true });
        try {
            const invalidate = vi.spyOn(cache, "invalidateQueries");
            const { rerender, unmount } = render(<Sync />, { wrapper: harness(cache) });
            act(() => {
                shown?.();
                window.dispatchEvent(new Event("focus"));
                window.dispatchEvent(new Event(REALTIME_CONNECTED_EVENT));
            });
            await waitFor(() => expect(invalidate).toHaveBeenCalledTimes(3));
            rerender(<Sync sessionKey={null} />);
            expect(unsubscribe).toHaveBeenCalledTimes(1);
            emit("approval_update");
            await new Promise((resolve) => setTimeout(resolve, 150));
            expect(invalidate).toHaveBeenCalledTimes(3);
            unmount();
        } finally {
            Object.defineProperty(window, "electronAPI", { value: previous, configurable: true });
        }
    });

    test("cancels queued refresh on identity change and ignores unrelated events", async () => {
        const cache = client();
        const invalidate = vi.spyOn(cache, "invalidateQueries");
        const { rerender } = renderHook(({ key }) => useApprovalSync(key), {
            initialProps: { key: "1:1" }, wrapper: harness(cache),
        });
        emit("approval_update");
        rerender({ key: "2:2" });
        emit("task_updated");
        await new Promise((resolve) => setTimeout(resolve, 150));
        expect(invalidate).not.toHaveBeenCalled();
    });

    test("revalidates restored data and reports an action failure", async () => {
        const cache = client();
        cache.setQueryData(["manager", "approvals", "pending"], [{ id: 9, type: "leave", requester_name: "Old" }]);
        getApprovals.mockResolvedValue({ data: [{ id: 10, type: "leave", requester_name: "New" }] });
        approveRequest.mockRejectedValue(new Error("Denied"));
        const log = vi.spyOn(console, "error").mockImplementation(() => {});
        render(<PendingApprovalsCard />, { wrapper: harness(cache) });
        expect(await screen.findByText("New")).toBeInTheDocument();
        fireEvent.click(screen.getByTitle("Approve"));
        expect(await screen.findByText("Failed to approve request.")).toBeInTheDocument();
        expect(screen.getByText("New")).toBeInTheDocument();
        log.mockRestore();
    });
});

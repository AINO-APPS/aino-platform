import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, test, vi } from "vitest";

const getNotifications = vi.fn();
const markNotificationRead = vi.fn();
let wsHandler: ((msg: any) => void) | null = null;

vi.mock("../AuthContext", () => ({
    hasTenantContext: () => true,
    useAuth: () => ({ user: { id: 1, role: "employee", tenant_id: 7 } }),
}));
vi.mock("../api/notes", () => ({
    getNotifications: (...args: any[]) => getNotifications(...args),
    markNotificationRead: (...args: any[]) => markNotificationRead(...args),
    markAllNotificationsRead: vi.fn(),
    deleteNotification: vi.fn(),
}));
vi.mock("../hooks/useWebSocket", () => ({
    default: (handler: any) => {
        wsHandler = handler;
        return { sendMessage: vi.fn(), connected: true };
    },
}));
vi.mock("../hooks/useChatNotification", () => ({
    default: () => ({ notifyGeneral: vi.fn(), requestPermission: vi.fn() }),
}));

import NotificationBell from "../components/notifications/NotificationBell";

function LocationProbe() {
    const location = useLocation();
    return <div data-testid="location">{location.pathname + location.search + location.hash}</div>;
}

function renderBell() {
    return render(
        <MemoryRouter initialEntries={["/"]}>
            <NotificationBell />
            <Routes>
                <Route path="*" element={<LocationProbe />} />
            </Routes>
        </MemoryRouter>,
    );
}

function respondWith(notifications: any[]) {
    getNotifications.mockResolvedValue({
        data: { notifications, unread: notifications.filter((n) => !n.is_read).length },
    });
}

async function openAndClick(title: string) {
    fireEvent.click(screen.getByRole("button", { name: /notifications/i }));
    fireEvent.click(await screen.findByText(title));
}

describe("NotificationBell deep links", () => {
    beforeEach(() => {
        getNotifications.mockReset();
        markNotificationRead.mockReset().mockResolvedValue({});
        wsHandler = null;
    });

    test("navigates to the server-provided relative link", async () => {
        respondWith([{
            id: 1, type: "approval", title: "New Leave Request", is_read: true,
            link: "/manager?tab=approvals&request=5", link_task_id: null,
        }]);
        renderBell();
        await openAndClick("New Leave Request");
        await waitFor(() =>
            expect(screen.getByTestId("location")).toHaveTextContent("/manager?tab=approvals&request=5"));
    });

    test("ignores non-relative links and falls back to the task link", async () => {
        respondWith([{
            id: 2, type: "task", title: "Task Assigned: X", is_read: true,
            link: "https://evil.example/phish", link_task_id: 42,
        }]);
        renderBell();
        await openAndClick("Task Assigned: X");
        await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/tasks?task=42"));
    });

    test("refetches when notifications change on another device", async () => {
        respondWith([]);
        renderBell();
        await waitFor(() => expect(getNotifications).toHaveBeenCalledTimes(1));
        expect(wsHandler).toBeTypeOf("function");
        wsHandler!({ type: "notifications_changed", data: { action: "read_all" } });
        await waitFor(() => expect(getNotifications).toHaveBeenCalledTimes(2));
    });
});

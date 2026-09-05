import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, test, vi } from "vitest";

const getNotifications = vi.fn();
const useWebSocket = vi.fn();

vi.mock("../AuthContext", () => ({
    hasTenantContext: (user: any) =>
        user?.tenant_id !== null && user?.tenant_id !== undefined,
    useAuth: () => ({
        user: { id: 1, role: "platform_admin", tenant_id: null },
    }),
}));
vi.mock("../api", () => ({
    getNotifications: (...args: any[]) => getNotifications(...args),
    markNotificationRead: vi.fn(),
    markAllNotificationsRead: vi.fn(),
    deleteNotification: vi.fn(),
}));
vi.mock("../hooks/useWebSocket", () => ({
    default: (...args: any[]) => useWebSocket(...args),
}));
vi.mock("../hooks/useChatNotification", () => ({
    default: () => ({ notifyGeneral: vi.fn(), requestPermission: vi.fn() }),
}));
vi.mock("../ChatContext", () => ({
    useChatUnread: () => ({ refreshUnread: vi.fn() }),
}));

import NotificationBell from "../components/notifications/NotificationBell";

describe("NotificationBell tenantless behavior", () => {
    test("renders without polling or opening a tenant WebSocket", async () => {
        render(
            <MemoryRouter>
                <NotificationBell />
            </MemoryRouter>,
        );

        expect(screen.getByRole("button", { name: /notifications/i })).toBeInTheDocument();
        await waitFor(() => expect(useWebSocket).toHaveBeenCalledWith(null));
        expect(getNotifications).not.toHaveBeenCalled();
    });
});
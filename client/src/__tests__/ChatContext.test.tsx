import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

const getConversations = vi.fn();
vi.mock("../api/chat", () => ({ getConversations: (...args: unknown[]) => getConversations(...args) }));
vi.mock("../AuthContext", () => ({
    hasTenantContext: () => true,
    useAuth: () => ({ isAuthenticated: true, user: { id: 1, tenant_id: 7 } }),
}));

import { ChatProvider, useChatUnread } from "../ChatContext";
import { REALTIME_EVENT } from "../hooks/useWebSocket";

function Count() {
    const { unreadCount } = useChatUnread();
    return <span>{unreadCount}</span>;
}

describe("ChatProvider realtime unread synchronization", () => {
    beforeEach(() => {
        getConversations.mockReset()
            .mockResolvedValueOnce({ data: [{ unread_count: 1 }] })
            .mockResolvedValueOnce({ data: [{ unread_count: 3 }] });
    });

    test("refreshes the authoritative total after an incoming chat event", async () => {
        render(<ChatProvider><Count /></ChatProvider>);
        await waitFor(() => expect(screen.getByText("1")).toBeInTheDocument());
        window.dispatchEvent(new CustomEvent(REALTIME_EVENT, { detail: { type: "chat_message", data: { id: 9 } } }));
        await waitFor(() => expect(screen.getByText("3")).toBeInTheDocument());
        expect(getConversations).toHaveBeenCalledTimes(2);
    });
});
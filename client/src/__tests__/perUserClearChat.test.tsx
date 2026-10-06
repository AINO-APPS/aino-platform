import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

const mockClearChat = vi.fn();
const mockDeleteConversation = vi.fn();

vi.mock("../api/chat", () => ({
    clearChat: (...args: unknown[]) => mockClearChat(...args),
    deleteConversation: (...args: unknown[]) => mockDeleteConversation(...args),
}));

import useConversationActions from "../pages/chat/useConversationActions";
import { getClearedAt } from "../pages/chat/chatLocalDeletes";
import { applyRealtimeChatCleared } from "../pages/chat/chatRealtimeReducers";

function makeState(activeId: number | null = 10) {
    let conversations: any[] = [
        { id: 10, last_message: "hi", last_sender_id: 2, unread_count: 3 },
        { id: 11, last_message: "yo", last_sender_id: 3, unread_count: 1 },
    ];
    const state = {
        activeConv: activeId === null ? null : { id: activeId },
        conversations,
        setActiveConv: vi.fn(),
        setMessages: vi.fn(),
        setConversations: vi.fn((update: any) => {
            conversations = typeof update === "function" ? update(conversations) : update;
        }),
        setHasMore: vi.fn(),
        setDeleteConfirm: vi.fn(),
        setConvMenu: vi.fn(),
        setShowGroupModal: vi.fn(),
        setGroupEditData: vi.fn(),
        refreshUnread: vi.fn(),
    };
    return { state, list: () => conversations };
}

describe("per-user clear / delete chat", () => {
    beforeEach(() => {
        mockClearChat.mockReset().mockResolvedValue({ data: { ok: true } });
        mockDeleteConversation.mockReset().mockResolvedValue({ data: { ok: true } });
        localStorage.clear();
    });

    test("clear chat calls the server and empties only this conversation locally", async () => {
        const { state, list } = makeState();
        const { result } = renderHook(() => useConversationActions(state as any));

        await act(async () => {
            await result.current.handleClearChat(10);
        });

        expect(mockClearChat).toHaveBeenCalledWith(10);
        expect(getClearedAt(10)).toBeNull();
        expect(state.setMessages).toHaveBeenCalledWith([]);
        expect(state.setHasMore).toHaveBeenCalledWith(false);
        expect(list()[0]).toMatchObject({ id: 10, last_message: null, last_sender_id: null, unread_count: 0 });
        expect(list()[1]).toMatchObject({ id: 11, last_message: "yo", unread_count: 1 });
        expect(state.refreshUnread).toHaveBeenCalled();
    });

    test("falls back to the local cutoff when the server request fails", async () => {
        mockClearChat.mockRejectedValueOnce(new Error("offline"));
        const { state, list } = makeState(null);
        const { result } = renderHook(() => useConversationActions(state as any));

        await act(async () => {
            await result.current.handleClearChat(10);
        });

        expect(getClearedAt(10)).not.toBeNull();
        expect(state.setMessages).not.toHaveBeenCalled();
        expect(list()[0].last_message).toBeNull();
    });

    test("delete chat calls the server and removes it from this user's list", async () => {
        const { state, list } = makeState();
        const { result } = renderHook(() => useConversationActions(state as any));

        await act(async () => {
            await result.current.handleDeleteConv(10);
        });

        expect(mockDeleteConversation).toHaveBeenCalledWith(10);
        expect(list().map((c) => c.id)).toEqual([11]);
        expect(state.setActiveConv).toHaveBeenCalledWith(null);
    });

    test("chat_cleared from another of my devices clears only that conversation", () => {
        const conv = { id: 10, last_message: "hi", last_sender_id: 2, unread_count: 4 };
        expect(applyRealtimeChatCleared(conv, 10)).toEqual({
            id: 10, last_message: null, last_sender_id: null, unread_count: 0,
        });
        expect(applyRealtimeChatCleared(conv, 11)).toBe(conv);
    });
});

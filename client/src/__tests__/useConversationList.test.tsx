import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getConversations: vi.fn(), getPresence: vi.fn() }));
vi.mock("../api/chat", () => ({ getConversations: mocks.getConversations, getPresence: mocks.getPresence }));

import useConversationList from "../pages/chat/useConversationList";

const updateUnread = vi.fn();

beforeEach(() => {
    vi.clearAllMocks();
    mocks.getConversations.mockResolvedValue({ data: [{ id: 1, other_user_id: 7, unread_count: 2 }] });
    mocks.getPresence.mockResolvedValue({ data: { 7: { presence: "online", userStatus: "busy" } } });
});

test("shows loading only for the initial load; reloads update the list in place", async () => {
    const { result } = renderHook(() => useConversationList({ updateUnreadFromConversations: updateUnread }));
    expect(result.current.loadingConversations).toBe(true);
    await waitFor(() => expect(result.current.loadingConversations).toBe(false));
    expect(result.current.conversations).toHaveLength(1);

    let resolveReload: (value: unknown) => void = () => {};
    mocks.getConversations.mockImplementationOnce(() => new Promise((done) => { resolveReload = done; }));
    const loadingStates: boolean[] = [];
    let reload: Promise<void> = Promise.resolve();
    act(() => { reload = result.current.loadConversations(); });
    loadingStates.push(result.current.loadingConversations);
    expect(result.current.conversations).toHaveLength(1);

    await act(async () => {
        resolveReload({ data: [{ id: 1, other_user_id: 7, unread_count: 0 }, { id: 2 }] });
        await reload;
    });
    loadingStates.push(result.current.loadingConversations);
    expect(loadingStates).toEqual([false, false]);
    expect(result.current.conversations.map((c) => c.id)).toEqual([1, 2]);
    expect(result.current.userStatusMap[7]).toBe("busy");
});

test("keeps showing loading until a first load succeeds", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.getConversations.mockRejectedValueOnce(new Error("offline"));
    const { result } = renderHook(() => useConversationList({ updateUnreadFromConversations: updateUnread }));
    await waitFor(() => expect(result.current.loadingConversations).toBe(false));

    let resolveRetry: (value: unknown) => void = () => {};
    mocks.getConversations.mockImplementationOnce(() => new Promise((done) => { resolveRetry = done; }));
    let retry: Promise<void> = Promise.resolve();
    act(() => { retry = result.current.loadConversations(); });
    expect(result.current.loadingConversations).toBe(true);
    await act(async () => { resolveRetry({ data: [] }); await retry; });
    expect(result.current.loadingConversations).toBe(false);
});

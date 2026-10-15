import { act, renderHook } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({ api: { post: vi.fn() }, toastError: vi.fn() }));
vi.mock("../api/client", () => ({ default: mocks.api }));
vi.mock("../components/common/Toast", () => ({ useToast: () => ({ error: mocks.toastError }) }));
import { canTogglePin, canUnpinMessage, pinErrorMessage } from "../pages/chat/pinPermissions";
import { buildMessageActions } from "../components/chat/messageActions";
import useMessageActions from "../pages/chat/useMessageActions";

const pinned = (pinned_by: number | null) => ({ id: 1, pinned_at: "2026-10-01T00:00:00Z", pinned_by });

describe("canUnpinMessage", () => {
    test("the pinner can always unpin", () => {
        expect(canUnpinMessage(pinned(7), { userId: 7, isGroup: true, myRole: "member" })).toBe(true);
        expect(canUnpinMessage(pinned(7), { userId: "7", isGroup: false })).toBe(true);
    });
    test("group owner/admin can unpin others' pins; members cannot", () => {
        expect(canUnpinMessage(pinned(2), { userId: 7, isGroup: true, myRole: "admin" })).toBe(true);
        expect(canUnpinMessage(pinned(2), { userId: 7, isGroup: true, myRole: "owner" })).toBe(true);
        expect(canUnpinMessage(pinned(2), { userId: 7, isGroup: true, myRole: "member" })).toBe(false);
        expect(canUnpinMessage(pinned(null), { userId: 7, isGroup: true, myRole: "member" })).toBe(false);
    });
    test("1:1: only the pinner, except legacy pins without pinned_by", () => {
        expect(canUnpinMessage(pinned(2), { userId: 7, isGroup: false })).toBe(false);
        expect(canUnpinMessage(pinned(null), { userId: 7, isGroup: false })).toBe(true);
    });
    test("anyone can pin an unpinned message", () => {
        expect(canTogglePin({ pinned_at: null, pinned_by: null }, { userId: 7, isGroup: true, myRole: "member" })).toBe(true);
    });
});

describe("message actions", () => {
    const noop = () => undefined;
    test("Unpin is hidden when no pin handler is offered for a pinned message", () => {
        expect(buildMessageActions(pinned(2), false, {}).map((i) => i.label)).not.toContain("Unpin");
        expect(buildMessageActions(pinned(2), false, { onPin: noop }).map((i) => i.label)).toContain("Unpin");
        expect(buildMessageActions({ id: 2, content: "hi" }, false, {}).map((i) => i.label)).toContain("Pin");
    });
});

test("pinErrorMessage surfaces the server error", () => {
    expect(pinErrorMessage({ response: { data: { error: "Only the person who pinned this message or a group admin can unpin it" } } }))
        .toBe("Only the person who pinned this message or a group admin can unpin it");
    expect(pinErrorMessage(new Error("network"))).toBe("Couldn't update the pin. Please try again.");
});

test("a 403 unpin toasts the server message and leaves the pin in place", async () => {
    const error = "Only the person who pinned this message or a group admin can unpin it";
    mocks.api.post.mockRejectedValue({ response: { status: 403, data: { error } } });
    const setMessages = vi.fn();
    const state = { activeConv: { id: 7 }, setMessages, user: { id: 1 }, mentionInputRef: { current: null },
        selectedMessageIds: new Set(), pendingCounter: { current: 0 } } as any;
    const { result } = renderHook(() => useMessageActions(state));
    await act(async () => { await result.current.handleUnpin(5); });
    await act(async () => { await result.current.handlePin({ id: 5, pinned_at: "2026-10-01", pinned_by: 2 }); });
    expect(mocks.api.post).toHaveBeenCalledWith("/chat/messages/5/pin");
    expect(mocks.toastError).toHaveBeenCalledTimes(2);
    expect(mocks.toastError).toHaveBeenCalledWith(error);
    expect(setMessages).not.toHaveBeenCalled();
});

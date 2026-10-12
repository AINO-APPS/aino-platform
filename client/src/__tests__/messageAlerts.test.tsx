import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { DEFAULT_PREFS } from "../utils/sounds";
import { REALTIME_EVENT } from "../hooks/useWebSocket";
import GlobalMessageNotifications from "../components/notifications/GlobalMessageNotifications";
import MessagePopup from "../components/notifications/MessagePopup";
import useVisibleChat from "../pages/chat/useVisibleChat";
import { useOpenConversationFromQuery } from "../pages/chat/useOpenConversationFromQuery";
import { canAlert, mergeAlert, privateAlert, isConversationMuted, messagePreview, type MessageAlert } from "../components/notifications/messageAlerts";

const mocks = vi.hoisted(() => ({
    auth: { isAuthenticated: true, user: { id: 1, tenant_id: 2 } },
    active: null as number | null, effective: "available", prefsLoaded: true,
    getConversations: vi.fn(), sendQuickReply: vi.fn(), markConversationRead: vi.fn(),
    refreshUnread: vi.fn(), setActive: vi.fn(), messageTone: vi.fn(), mentionTone: vi.fn(),
}));
let prefs = { ...DEFAULT_PREFS };
vi.mock("../AuthContext", () => ({ useAuth: () => mocks.auth, hasTenantContext: () => true }));
vi.mock("../ChatContext", () => ({ useChatUnread: () => ({ activeConversationId: mocks.active, refreshUnread: mocks.refreshUnread, setActiveConversationId: mocks.setActive }) }));
vi.mock("../NotificationPrefsContext", () => ({ useNotificationPrefs: () => ({ prefs, prefsLoaded: mocks.prefsLoaded, playMessageTone: mocks.messageTone, playMentionTone: mocks.mentionTone }) }));
vi.mock("../ThemeContext", () => ({ useTheme: () => ({ theme: "dark" }) }));
vi.mock("../status/useStatus", () => ({ useStatus: () => ({ effective: mocks.effective }) }));
vi.mock("../api/chat", () => ({ getConversations: mocks.getConversations, sendQuickReply: mocks.sendQuickReply,
    markConversationRead: mocks.markConversationRead }));

const fixture = (id = "7"): MessageAlert => ({ conversationId: id, messageId: "11", title: "Asha", sender: "Asha",
    preview: "Hello", avatar: "/asha.png", members: [], isGroup: false, count: 1, updatedAt: Date.now(),
    replyText: "", draftId: "pending-1", replyOpen: false, busy: false, error: "" });
function emit(id = 11, conversationId = 7, extra: Record<string, unknown> = {}, type = "chat_message") {
    act(() => window.dispatchEvent(new CustomEvent(REALTIME_EVENT, { detail: {
        type, data: { id, messageId: id, conversationId, senderId: 3, senderName: "Asha", content: `Message ${id}`, ...extra },
    } })));
}
async function mount(path = "/tasks") {
    const result = render(<MemoryRouter initialEntries={[path]}><GlobalMessageNotifications /></MemoryRouter>);
    await act(async () => { await Promise.resolve(); });
    return result;
}
beforeEach(() => {
    vi.clearAllMocks();
    prefs = { ...DEFAULT_PREFS };
    mocks.auth.isAuthenticated = true;
    mocks.active = null;
    mocks.effective = "available";
    mocks.prefsLoaded = true;
    mocks.getConversations.mockResolvedValue({ data: [7, 8, 9, 10].map((id) => ({ id, other_full_name: "Asha", is_muted: false })) });
    mocks.sendQuickReply.mockResolvedValue({ data: { id: 55 } });
    mocks.markConversationRead.mockResolvedValue({ data: { ok: true } });
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    Object.defineProperty(window, "electronAPI", { value: undefined, configurable: true });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe("message alert policy", () => {
    test("suppression rules and timed mute expiry", () => {
        const options = { own: false, focusedChat: false, muted: false, dnd: false, enabled: true };
        expect(canAlert(options)).toBe(true);
        for (const field of ["own", "focusedChat", "muted", "dnd"] as const) expect(canAlert({ ...options, [field]: true })).toBe(false);
        expect(canAlert({ ...options, enabled: false })).toBe(false);
        expect(isConversationMuted({ is_muted: true })).toBe(true);
        expect(isConversationMuted({ is_muted: true, muted_until: new Date(100).toISOString() }, 200)).toBe(false);
        expect(messagePreview({ fileType: "image/jpeg", content: "" })).toBe("Sent a photo");
    });
    test("grouping preserves reply state and does not count duplicates; privacy removes identifying fields", () => {
        const card = { ...fixture(), replyText: "Draft", replyOpen: true };
        expect(mergeAlert([card], card)).toEqual([card]);
        const next = mergeAlert([card], { ...fixture(), messageId: "12" })[0];
        expect(next).toMatchObject({ count: 2, replyText: "Draft", replyOpen: true });
        const sanitized = privateAlert({ ...card, members: [{ name: "Private", avatar: "/private.png" }] });
        expect(sanitized).toMatchObject({ title: "New message", sender: "", avatar: null, members: [] });
        expect(JSON.stringify(sanitized)).not.toContain("Asha");
    });
});
describe("global message notifications", () => {
    test("notifies outside chat, deduplicates sockets and plays only the mention tone for a mention", async () => {
        await mount();
        emit(); emit(); emit(11, 7, {}, "chat_mention");
        await screen.findByText("Message 11");
        expect(screen.getAllByLabelText("Dismiss notification")).toHaveLength(1);
        await waitFor(() => expect(mocks.mentionTone).toHaveBeenCalledTimes(1));
        expect(mocks.messageTone).not.toHaveBeenCalled();
    });
    test("an ordinary message plays the message tone once", async () => {
        await mount(); emit(); emit();
        await waitFor(() => expect(mocks.messageTone).toHaveBeenCalledTimes(1));
        expect(mocks.mentionTone).not.toHaveBeenCalled();
    });
    test("suppresses focused chat, own messages, mute and DND", async () => {
        mocks.active = 7;
        await mount("/chat");
        emit(); emit(12, 8, { senderId: 1 });
        expect(screen.queryByLabelText("Dismiss notification")).toBeNull();
        cleanup();
        mocks.active = null;
        mocks.getConversations.mockResolvedValue({ data: [{ id: 7, is_muted: true }] });
        await mount();
        emit();
        expect(screen.queryByLabelText("Dismiss notification")).toBeNull();
        mocks.effective = "dnd";
        emit(12);
        expect(mocks.messageTone).not.toHaveBeenCalled();
    });
    test("queues beyond three cards and promotes the next on dismiss without marking read", async () => {
        await mount();
        [7, 8, 9, 10].forEach((id) => emit(id + 10, id));
        await waitFor(() => expect(screen.getAllByLabelText("Dismiss notification")).toHaveLength(3));
        expect(screen.queryByText("Message 20")).toBeNull();
        fireEvent.click(screen.getAllByLabelText("Dismiss notification")[0]);
        expect(await screen.findByText("Message 20")).toBeInTheDocument();
        expect(mocks.markConversationRead).not.toHaveBeenCalled();
    });
    test("keeps a reply draft on a new message and retries failed sends using the same id", async () => {
        vi.spyOn(console, "error").mockImplementation(() => {});
        mocks.sendQuickReply.mockRejectedValueOnce(new Error("offline"));
        await mount();
        emit();
        fireEvent.click(await screen.findByText("Reply"));
        fireEvent.change(screen.getByLabelText("Reply to Asha"), { target: { value: "Quick answer" } });
        emit(12);
        expect(screen.getByLabelText("Reply to Asha")).toHaveValue("Quick answer");
        fireEvent.click(screen.getByLabelText("Send reply"));
        await screen.findByRole("alert");
        fireEvent.click(screen.getByLabelText("Send reply"));
        await waitFor(() => expect(mocks.sendQuickReply).toHaveBeenCalledTimes(2));
        expect(mocks.sendQuickReply.mock.calls[0]).toEqual(mocks.sendQuickReply.mock.calls[1]);
        await waitFor(() => expect(screen.queryByLabelText("Dismiss notification")).toBeNull());
    });
    test("snapshot mark-read keeps a newer arrival while the request is in flight", async () => {
        let resolve: (() => void) | undefined;
        mocks.markConversationRead.mockImplementationOnce(() => new Promise<void>((done) => { resolve = done; }));
        await mount(); emit();
        fireEvent.click(await screen.findByText("Mark as read"));
        expect(mocks.markConversationRead).toHaveBeenCalledWith("7", "11");
        emit(12);
        await act(async () => resolve?.());
        expect(screen.getByText("Message 12")).toBeInTheDocument();
    });
    test("clears pending messages on logout and rejects late action completion", async () => {
        let resolve: (() => void) | undefined;
        mocks.markConversationRead.mockImplementationOnce(() => new Promise<void>((done) => { resolve = done; }));
        const view = await mount(); emit();
        fireEvent.click(await screen.findByText("Mark as read"));
        mocks.auth.isAuthenticated = false;
        view.rerender(<MemoryRouter><GlobalMessageNotifications /></MemoryRouter>);
        await act(async () => resolve?.());
        expect(screen.queryByLabelText("Dismiss notification")).toBeNull();
    });
    test("sanitizes native window state before IPC when preview privacy is enabled", async () => {
        prefs.hideSensitiveContent = true;
        const publish = vi.fn();
        Object.defineProperty(window, "electronAPI", { configurable: true, value: {
            messageAlerts: { publish, clear: vi.fn(), onAction: () => () => {} },
        } });
        await mount(); emit();
        await waitFor(() => expect(publish.mock.calls.at(-1)?.[0].cards).toHaveLength(1));
        const state = publish.mock.calls.at(-1)![0];
        expect(state.cards[0]).toMatchObject({ title: "New message", avatar: null });
        expect(JSON.stringify(state)).not.toContain("Asha");
        expect(JSON.stringify(state)).not.toContain("Message 11");
    });
    test("a native-window action for the previously shown message still sends after a newer message arrives", async () => {
        let onAction: ((action: unknown) => void) | undefined;
        const publish = vi.fn();
        Object.defineProperty(window, "electronAPI", { configurable: true, value: {
            showAndFocus: vi.fn(),
            messageAlerts: { publish, clear: vi.fn(), onAction: (cb: (action: unknown) => void) => { onAction = cb; return () => {}; } },
        } });
        await mount(); emit();
        await waitFor(() => expect(publish.mock.calls.at(-1)?.[0].cards).toHaveLength(1));
        const session = publish.mock.calls.at(-1)![0].session;
        emit(12);
        await waitFor(() => expect(publish.mock.calls.at(-1)?.[0].cards[0].messageId).toBe("12"));
        await act(async () => onAction?.({ session, conversationId: "7", messageId: "11", action: "reply", text: "On it" }));
        expect(mocks.sendQuickReply).toHaveBeenCalledWith("7", "On it", expect.any(String));
        await act(async () => onAction?.({ session, conversationId: "7", messageId: "11", action: "read" }));
        expect(mocks.markConversationRead).toHaveBeenCalledWith("7", "11");
        expect(publish.mock.calls.at(-1)![0].cards[0].messageId).toBe("12");
    });
    test("popup enablement is independent of the existing sound controls", async () => {
        prefs.messagePopups = false;
        await mount(); emit();
        expect(screen.queryByLabelText("Dismiss notification")).toBeNull();
        await waitFor(() => expect(mocks.messageTone).toHaveBeenCalledTimes(1));
    });
    test("the simple card offers only reply and mark as read alongside open and dismiss", async () => {
        await mount(); emit();
        await screen.findByText("Message 11");
        expect(screen.getByRole("button", { name: "Reply" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Mark as read" })).toBeInTheDocument();
        expect(screen.queryByLabelText(/mute/i)).toBeNull();
        expect(screen.queryByText(/AINO/)).toBeNull();
    });
    test("waits for canonical preferences before exposing an early-arriving message", async () => {
        mocks.prefsLoaded = false;
        const view = await mount(); emit();
        expect(screen.queryByLabelText("Dismiss notification")).toBeNull();
        expect(mocks.messageTone).not.toHaveBeenCalled();
        prefs.hideSensitiveContent = true;
        mocks.prefsLoaded = true;
        view.rerender(<MemoryRouter><GlobalMessageNotifications /></MemoryRouter>);
        await screen.findByText("Open chat to view this message");
        expect(screen.queryByText("Message 11")).toBeNull();
        expect(screen.queryByText("Asha")).toBeNull();
    });
});
test("popup does not expire while composing and exposes reply/send keyboard controls", () => {
    vi.useFakeTimers();
    const act = vi.fn();
    render(<MessagePopup cards={[{ ...fixture(), replyOpen: true }]} act={act} />);
    fireEvent.change(screen.getByLabelText("Reply to Asha"), { target: { value: "Hello" } });
    fireEvent.keyDown(screen.getByLabelText("Reply to Asha"), { key: "Enter", shiftKey: false });
    expect(act).toHaveBeenCalledWith("reply", expect.any(Object), "Hello");
    act.mockClear();
    vi.advanceTimersByTime(20_000);
    expect(act).not.toHaveBeenCalled();
});

test("typing stays local when actions are asynchronous, as in the native popup window", () => {
    const act = vi.fn();
    const card = { ...fixture(), replyOpen: true };
    const view = render(<MessagePopup cards={[card]} act={act} />);
    const input = screen.getByLabelText("Reply to Asha") as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "Hllo" } });
    input.setSelectionRange(1, 1);
    fireEvent.change(input, { target: { value: "Hello", selectionStart: 2, selectionEnd: 2 } });
    expect(input).toHaveValue("Hello");
    expect(input.selectionStart).toBe(2);
    expect(act).not.toHaveBeenCalled();
    view.rerender(<MessagePopup cards={[{ ...card, messageId: "12", count: 2 }]} act={act} />);
    expect(screen.getByLabelText("Reply to Asha")).toHaveValue("Hello");
    view.rerender(<MessagePopup cards={[{ ...card, replyOpen: false }]} act={act} />);
    view.rerender(<MessagePopup cards={[card]} act={act} />);
    expect(screen.getByLabelText("Reply to Asha")).toHaveValue("");
});

test("opening the same conversation from a query again works after another chat was selected", () => {
    const open = vi.fn();
    const conversations = [{ id: 7 }, { id: 8 }];
    let navigate: ((to: string) => void) | undefined;
    function Probe() {
        useOpenConversationFromQuery(conversations, open);
        navigate = useNavigate();
        return null;
    }
    render(<MemoryRouter initialEntries={["/chat?conv=7"]}><Probe /></MemoryRouter>);
    expect(open).toHaveBeenCalledTimes(1);
    act(() => navigate?.("/chat?conv=7"));
    expect(open).toHaveBeenCalledTimes(2);
    expect(open.mock.calls.map((call) => call[0])).toEqual([7, 7]);
});

test("a kept-alive hidden chat stays unread until its page is focused", async () => {
    const onRead = vi.fn();
    function ChatVisibility() { useVisibleChat(7, 2, onRead); return null; }
    const hidden = render(<MemoryRouter initialEntries={["/tasks"]}><ChatVisibility /></MemoryRouter>);
    await act(async () => { await Promise.resolve(); });
    expect(mocks.markConversationRead).not.toHaveBeenCalled();
    hidden.unmount();
    expect(mocks.setActive).toHaveBeenLastCalledWith(null);
    vi.mocked(document.hasFocus).mockReturnValue(false);
    const view = render(<MemoryRouter initialEntries={["/chat"]}><ChatVisibility /></MemoryRouter>);
    await act(async () => { await Promise.resolve(); });
    expect(mocks.markConversationRead).not.toHaveBeenCalled();
    vi.mocked(document.hasFocus).mockReturnValue(true);
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    expect(mocks.markConversationRead).toHaveBeenCalledWith(7);
    expect(onRead).toHaveBeenCalledWith(7);
    view.unmount();
});

test("focusing an already-read chat does not send another read receipt", async () => {
    function ChatVisibility() { useVisibleChat(7, 0, vi.fn()); return null; }
    render(<MemoryRouter initialEntries={["/chat"]}><ChatVisibility /></MemoryRouter>);
    await act(async () => { window.dispatchEvent(new Event("focus")); document.dispatchEvent(new Event("visibilitychange")); });
    expect(mocks.markConversationRead).not.toHaveBeenCalled();
});
